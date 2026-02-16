import XLSX from 'xlsx';
import { db } from '../server/db';
import { colorPanels, colorPanelHistory, skuColorPanels, skus, vendors } from '../shared/schema';
import { eq, ilike, or, sql } from 'drizzle-orm';

interface ImportResult {
  panelsImported: number;
  historyRecordsImported: number;
  skuLinksCreated: number;
  skuLinksNotFound: string[];
  bySheet: { [key: string]: { panels: number; skuLinks: number } };
  errors: string[];
}

const excelDateToJS = (excelDate: number | string | null | undefined): Date | null => {
  if (!excelDate) return null;
  if (typeof excelDate === 'string') {
    const parsed = new Date(excelDate);
    if (!isNaN(parsed.getTime())) return parsed;
    return null;
  }
  if (typeof excelDate === 'number') {
    const date = new Date((excelDate - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
};

const parseSkuCell = (cellValue: string | number | null | undefined): string[] => {
  if (!cellValue) return [];
  const text = String(cellValue);
  let cleaned = text
    .replace(/\([^)]*\)/g, '')
    .replace(/[A-Za-z\s]+:/g, ' ')
    .replace(/\r\n|\r|\n/g, ',')
    .replace(/;/g, ',');
  const codes = cleaned.split(',')
    .map(s => s.trim())
    .filter(s => /^\d{5,12}$/.test(s));
  return [...new Set(codes)];
};

const parseValidityMonths = (value: string | number | null | undefined): number => {
  if (!value) return 12;
  const text = String(value).toLowerCase();
  const match = text.match(/(\d+)/);
  if (match) return parseInt(match[1]);
  return 12;
};

async function getVendorByName(name: string) {
  const results = await db.select().from(vendors).where(
    or(eq(vendors.name, name), ilike(vendors.name, `%${name}%`))
  ).limit(1);
  return results[0];
}

async function getSkuByCode(skuCode: string) {
  const results = await db.select().from(skus).where(eq(skus.sku, skuCode)).limit(1);
  return results[0];
}

async function importMCPFile(filePath: string): Promise<ImportResult> {
  console.log(`Reading file: ${filePath}`);
  const workbook = XLSX.readFile(filePath);
  
  const results: ImportResult = {
    panelsImported: 0,
    historyRecordsImported: 0,
    skuLinksCreated: 0,
    skuLinksNotFound: [],
    bySheet: {},
    errors: [],
  };

  const sheetConfigs: { [key: string]: any } = {
    'MCP-CB2': {
      brandCol: 0, vendorCol: 2, collectionCol: 3, skuDescCol: 4,
      materialCol: 5, finishNameCol: 6, sheenLevelCol: 7, finishSystemCol: 8,
      paintSupplierCol: 9, validityCol: 10, latestMcpCol: 11, latestApprovalCol: 12,
      latestExpirationCol: 13, skuNumberCol: null, statusCol: 29, remarksCol: 30,
      mcpHistoryStart: 14, headerRow: 1, isDiscontinued: false,
    },
    'CB-CB2 DISCONTINUED MCP': {
      brandCol: 0, vendorCol: 2, collectionCol: 3, skuDescCol: 4,
      materialCol: 5, finishNameCol: 6, sheenLevelCol: 7, finishSystemCol: 8,
      paintSupplierCol: 9, validityCol: 10, latestMcpCol: 11, latestApprovalCol: 12,
      latestExpirationCol: 13, skuNumberCol: null, statusCol: 29, remarksCol: 30,
      mcpHistoryStart: 14, headerRow: 1, isDiscontinued: true,
    },
    'MCP-CB': {
      brandCol: 1, vendorCol: 2, collectionCol: 3, skuDescCol: 4,
      finishNameCol: 5, materialCol: 6, sheenLevelCol: 7, finishSystemCol: 8,
      paintSupplierCol: 9, validityCol: 10, latestMcpCol: 11, latestApprovalCol: 12,
      latestExpirationCol: 13, skuNumberCol: null, statusCol: null, remarksCol: null,
      mcpHistoryStart: 14, headerRow: 1, isDiscontinued: false,
    },
    'MCP-CK': {
      brandCol: 0, vendorCol: 2, collectionCol: 4, skuDescCol: 4,
      finishNameCol: 5, materialCol: 6, sheenLevelCol: 7, finishSystemCol: 8,
      paintSupplierCol: 9, validityCol: null, latestMcpCol: 10, latestApprovalCol: 11,
      latestExpirationCol: 12, skuNumberCol: 3, statusCol: null, remarksCol: null,
      mcpHistoryStart: 14, headerRow: 1, isDiscontinued: false,
    },
    'CK-MCP Handle': {
      brandCol: 0, vendorCol: 2, collectionCol: 4, skuDescCol: 4,
      finishNameCol: 5, materialCol: 6, sheenLevelCol: 7, finishSystemCol: 8,
      paintSupplierCol: 9, validityCol: null, latestMcpCol: 10, latestApprovalCol: 11,
      latestExpirationCol: 12, skuNumberCol: 3, statusCol: null, remarksCol: null,
      mcpHistoryStart: 14, headerRow: 0, isDiscontinued: false,
    },
  };

  console.log(`Sheets in workbook: ${workbook.SheetNames.join(', ')}`);

  for (const sheetName of workbook.SheetNames) {
    const config = sheetConfigs[sheetName];
    if (!config) {
      console.log(`Skipping unknown sheet: ${sheetName}`);
      continue;
    }

    console.log(`\nProcessing sheet: ${sheetName}`);
    const sheet = workbook.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    if (data.length <= config.headerRow + 1) {
      console.log(`Sheet ${sheetName} is empty`);
      continue;
    }

    results.bySheet[sheetName] = { panels: 0, skuLinks: 0 };
    let rowsProcessed = 0;

    for (let rowIndex = config.headerRow + 1; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      
      const brand = String(row[config.brandCol] || '').trim();
      const vendorName = String(row[config.vendorCol] || '').trim();
      if (!brand && !vendorName) continue;
      if (brand.toLowerCase() === 'brand' || vendorName.toLowerCase() === 'vendor name') continue;

      try {
        const latestMcpNumber = String(row[config.latestMcpCol] || '').trim().replace(/\n.*/g, '');
        if (!latestMcpNumber || latestMcpNumber === '' || latestMcpNumber === '0') continue;

        const expirationDate = excelDateToJS(row[config.latestExpirationCol]);
        let status = config.isDiscontinued ? 'archived' : 'active';
        if (expirationDate) {
          const today = new Date();
          const daysUntilExpiry = Math.floor((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (daysUntilExpiry < 0) status = 'expired';
          else if (daysUntilExpiry <= 30) status = 'expiring';
        }

        const panelData = {
          brand: brand || null,
          vendorName: vendorName || null,
          collection: String(row[config.collectionCol] || '').trim() || null,
          skuDescription: String(row[config.skuDescCol] || '').trim() || null,
          material: String(row[config.materialCol] || '').trim() || null,
          finishName: String(row[config.finishNameCol] || '').trim() || null,
          sheenLevel: String(row[config.sheenLevelCol] || '').trim() || null,
          finishSystem: String(row[config.finishSystemCol] || '').trim() || null,
          paintSupplier: String(row[config.paintSupplierCol] || '').trim() || null,
          validityMonths: config.validityCol !== null ? parseValidityMonths(row[config.validityCol]) : 12,
          currentMcpNumber: latestMcpNumber.replace(/[^\d]/g, '') || latestMcpNumber,
          currentApprovalDate: excelDateToJS(row[config.latestApprovalCol]),
          currentExpirationDate: expirationDate,
          status,
          notes: config.remarksCol !== null ? String(row[config.remarksCol] || '').trim() || null : null,
          vendorId: null as number | null,
          merchandiserId: null as number | null,
        };

        if (panelData.vendorName) {
          const vendor = await getVendorByName(panelData.vendorName);
          if (vendor) {
            panelData.vendorId = vendor.id;
          }
        }

        const [createdPanel] = await db.insert(colorPanels).values(panelData).returning();
        results.panelsImported++;
        results.bySheet[sheetName].panels++;
        rowsProcessed++;

        const historyRecords: any[] = [];
        let versionNumber = 1;
        for (let col = config.mcpHistoryStart; col < Math.min(row.length - 2, config.mcpHistoryStart + 45); col += 3) {
          const mcpNum = String(row[col] || '').trim().replace(/\n.*/g, '');
          const approvalDate = excelDateToJS(row[col + 1]);
          const expDate = excelDateToJS(row[col + 2]);
          
          if (mcpNum && mcpNum !== '' && mcpNum !== '0' && /\d+/.test(mcpNum)) {
            historyRecords.push({
              colorPanelId: createdPanel.id,
              mcpNumber: mcpNum.replace(/[^\d]/g, '') || mcpNum,
              approvalDate,
              expirationDate: expDate,
              versionNumber,
            });
            versionNumber++;
            if (versionNumber > 15) break;
          }
        }

        if (historyRecords.length > 0) {
          await db.insert(colorPanelHistory).values(historyRecords);
          results.historyRecordsImported += historyRecords.length;
        }

        if (config.skuNumberCol !== null) {
          const skuCodes = parseSkuCell(row[config.skuNumberCol]);
          for (const skuCode of skuCodes) {
            const existingSku = await getSkuByCode(skuCode);
            if (existingSku) {
              await db.insert(skuColorPanels).values({
                skuId: existingSku.id,
                colorPanelId: createdPanel.id,
              }).onConflictDoNothing();
              results.skuLinksCreated++;
              results.bySheet[sheetName].skuLinks++;
            } else {
              results.skuLinksNotFound.push(skuCode);
            }
          }
        }

        if (rowsProcessed % 50 === 0) {
          console.log(`  Processed ${rowsProcessed} rows...`);
        }
      } catch (rowError: any) {
        results.errors.push(`${sheetName} Row ${rowIndex + 1}: ${rowError.message}`);
      }
    }
    
    console.log(`  Completed: ${results.bySheet[sheetName].panels} panels, ${results.bySheet[sheetName].skuLinks} SKU links`);
  }

  results.skuLinksNotFound = [...new Set(results.skuLinksNotFound)];
  
  return results;
}

async function main() {
  const filePath = 'attached_assets/WEC VIETNAM - CBH MCP Library Record Keeping Form_1764032795110.xlsx';
  
  console.log('Starting MCP Import...\n');
  
  try {
    const results = await importMCPFile(filePath);
    
    console.log('\n========== IMPORT RESULTS ==========');
    console.log(`Total Panels Imported: ${results.panelsImported}`);
    console.log(`History Records Created: ${results.historyRecordsImported}`);
    console.log(`SKU Links Created: ${results.skuLinksCreated}`);
    console.log(`SKUs Not Found: ${results.skuLinksNotFound.length}`);
    
    console.log('\nBy Sheet:');
    for (const [sheet, data] of Object.entries(results.bySheet)) {
      console.log(`  ${sheet}: ${data.panels} panels, ${data.skuLinks} SKU links`);
    }
    
    if (results.errors.length > 0) {
      console.log(`\nErrors (${results.errors.length}):`);
      results.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
      if (results.errors.length > 10) {
        console.log(`  ... and ${results.errors.length - 10} more`);
      }
    }
    
    if (results.skuLinksNotFound.length > 0) {
      console.log(`\nSKUs not found in database (first 20):`);
      console.log(`  ${results.skuLinksNotFound.slice(0, 20).join(', ')}`);
    }
    
    console.log('\n========================================');
    console.log('Import completed successfully!');
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

main();
