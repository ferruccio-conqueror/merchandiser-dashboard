import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../server/db';
import { colorPanels, colorPanelHistory, skuColorPanels, inspections, qualityTests, vendors, skus, purchaseOrders } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';

function parseDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  
  const str = String(value).trim();
  if (!str || str.toLowerCase() === 'n/a' || str === '') return null;
  
  // Handle Excel serial date numbers
  if (!isNaN(Number(str))) {
    const num = Number(str);
    if (num > 30000 && num < 50000) {
      // Excel date serial
      return new Date((num - 25569) * 86400 * 1000);
    }
  }
  
  // Handle various date formats
  const formats = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/,  // M/D/YY or M/D/YYYY
    /^(\d{4})-(\d{2})-(\d{2})$/,           // YYYY-MM-DD
    /^(\d{1,2})-(\w{3})$/,                  // DD-Mon (e.g., "17-Nov")
  ];
  
  // M/D/YY format
  const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    let year = parseInt(mdyMatch[3]);
    if (year < 100) year += 2000;
    return new Date(year, parseInt(mdyMatch[1]) - 1, parseInt(mdyMatch[2]));
  }
  
  // Try native parsing
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed;
  
  return null;
}

function parseValidityMonths(value: any): number {
  if (!value) return 12;
  const str = String(value).toLowerCase();
  if (str.includes('n/a') || str === '') return 12;
  
  const numMatch = str.match(/(\d+)/);
  if (numMatch) {
    return parseInt(numMatch[1]);
  }
  return 12;
}

async function importMCPData() {
  console.log('Starting MCP import...');
  
  const filePath = path.join(process.cwd(), 'attached_assets/WEC VIETNAM - CBH MCP Library Record Keeping Form_1764033150647.xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  
  // Get data starting from row 2 (skip header row)
  const rawData = XLSX.utils.sheet_to_json(sheet, { 
    header: 1,
    raw: false,
    defval: null 
  }) as any[][];
  
  // Row 0 is the group header, Row 1 is the column names
  const headers = rawData[1];
  const dataRows = rawData.slice(2);
  
  console.log(`Found ${dataRows.length} MCP rows to process`);
  
  let imported = 0;
  let errors: string[] = [];
  
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row || row.length === 0) continue;
    
    // Skip rows without brand
    const brand = row[1]; // Column B is Brand
    if (!brand || String(brand).trim() === '' || String(brand).toLowerCase() === 'brand') continue;
    
    try {
      // Map columns based on the Excel structure
      // B=Brand, C=Vendor Name, D=Collection, E=SKU Description, F=Material
      // G=Finish Name, H=Sheen Level, I=Finish System, J=Paint supplier, K=Validity
      // L=Latest MCP No., M=Latest Approval, N=Latest Expiration
      // O=1st MCP No., P=1st Approval, Q=1st Expiration
      // R=2nd MCP No., etc.
      
      const panelData = {
        brand: String(row[1] || '').trim(),
        vendorName: String(row[2] || '').trim(),
        collection: String(row[3] || '').trim(),
        skuDescription: String(row[4] || '').trim(),
        material: String(row[5] || '').trim(),
        finishName: String(row[6] || '').trim(),
        sheenLevel: String(row[7] || '').trim() || null,
        finishSystem: String(row[8] || '').trim() || null,
        paintSupplier: String(row[9] || '').trim() || null,
        validityMonths: parseValidityMonths(row[10]),
        currentMcpNumber: String(row[11] || '').trim() || null,
        currentApprovalDate: parseDate(row[12]),
        currentExpirationDate: parseDate(row[13]),
        status: 'active',
        notes: String(row[29] || '').trim() || null, // Status column
      };
      
      // Skip if no valid data
      if (!panelData.brand && !panelData.vendorName && !panelData.finishName) continue;
      
      // Determine status based on expiration date
      if (panelData.currentExpirationDate) {
        const now = new Date();
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        
        if (panelData.currentExpirationDate < now) {
          panelData.status = 'expired';
        } else if (panelData.currentExpirationDate < thirtyDaysFromNow) {
          panelData.status = 'expiring';
        }
      }
      
      // Try to find vendor
      let vendorId = null;
      if (panelData.vendorName) {
        const vendorResult = await db.select().from(vendors)
          .where(eq(vendors.name, panelData.vendorName))
          .limit(1);
        if (vendorResult.length > 0) {
          vendorId = vendorResult[0].id;
        }
      }
      
      // Insert color panel
      const [insertedPanel] = await db.insert(colorPanels).values({
        brand: panelData.brand,
        vendorName: panelData.vendorName,
        vendorId: vendorId,
        collection: panelData.collection,
        skuDescription: panelData.skuDescription,
        material: panelData.material,
        finishName: panelData.finishName,
        sheenLevel: panelData.sheenLevel,
        finishSystem: panelData.finishSystem,
        paintSupplier: panelData.paintSupplier,
        validityMonths: panelData.validityMonths,
        currentMcpNumber: panelData.currentMcpNumber,
        currentApprovalDate: panelData.currentApprovalDate,
        currentExpirationDate: panelData.currentExpirationDate,
        status: panelData.status,
        notes: panelData.notes,
      }).returning();
      
      // Import history records (1st through 5th MCP)
      const historyVersions = [
        { mcpCol: 14, approvalCol: 15, expirationCol: 16, version: 1 },
        { mcpCol: 17, approvalCol: 18, expirationCol: 19, version: 2 },
        { mcpCol: 20, approvalCol: 21, expirationCol: 22, version: 3 },
        { mcpCol: 23, approvalCol: 24, expirationCol: 25, version: 4 },
        { mcpCol: 26, approvalCol: 27, expirationCol: 28, version: 5 },
      ];
      
      for (const hv of historyVersions) {
        const mcpNumber = row[hv.mcpCol];
        if (mcpNumber && String(mcpNumber).trim()) {
          await db.insert(colorPanelHistory).values({
            colorPanelId: insertedPanel.id,
            mcpNumber: String(mcpNumber).trim(),
            approvalDate: parseDate(row[hv.approvalCol]),
            expirationDate: parseDate(row[hv.expirationCol]),
            versionNumber: hv.version,
          });
        }
      }
      
      imported++;
    } catch (error: any) {
      errors.push(`Row ${i + 3}: ${error.message}`);
    }
  }
  
  console.log(`MCP Import complete: ${imported} panels imported`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.slice(0, 10).join('\n')}`);
  }
  return imported;
}

async function importInspectionData() {
  console.log('\nStarting Inspection/Quality Test import...');
  
  const filePath = path.join(process.cwd(), 'attached_assets/2025-11-24 - OS 630 INSPECTION-TESTING_1763984144658.xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: null }) as any[];
  
  console.log(`Found ${rows.length} inspection rows to process`);
  
  let inspectionsImported = 0;
  let testsImported = 0;
  let errors: string[] = [];
  
  // Parse inspection date and result from combined field like "2024-12-09\n(Passed)"
  function parseInspectionField(value: any): { date: Date | null; result: string | null } {
    if (!value) return { date: null, result: null };
    const str = String(value);
    const lines = str.split('\n').map(l => l.trim()).filter(l => l);
    
    let date: Date | null = null;
    let result: string | null = null;
    
    for (const line of lines) {
      // Check for result in parentheses
      const resultMatch = line.match(/\(([^)]+)\)/);
      if (resultMatch) {
        result = resultMatch[1];
      }
      // Check for date
      const dateMatch = line.match(/^\d{4}-\d{2}-\d{2}$/);
      if (dateMatch) {
        date = parseDate(line);
      }
    }
    
    return { date, result };
  }
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const poNumber = String(row['PO'] || '').trim();
      if (!poNumber) continue;
      
      const style = String(row['Style'] || '').trim();
      const vendorName = String(row['Vendor'] || '').trim();
      
      // Find PO
      let poId = null;
      const poResult = await db.select().from(purchaseOrders)
        .where(eq(purchaseOrders.poNumber, poNumber))
        .limit(1);
      if (poResult.length > 0) {
        poId = poResult[0].id;
      }
      
      // Find vendor
      let vendorId = null;
      if (vendorName) {
        const vendorResult = await db.select().from(vendors)
          .where(eq(vendors.name, vendorName))
          .limit(1);
        if (vendorResult.length > 0) {
          vendorId = vendorResult[0].id;
        }
      }
      
      // Import inspections
      const inspectionTypes = [
        { field: 'Material Inspection', type: 'Material' },
        { field: 'Initial', type: 'Initial' },
        { field: 'Inline Inspection', type: 'Inline' },
        { field: 'Final Inspection', type: 'Final' },
        { field: 'Re-Final Inspetion', type: 'Re-Final' },
      ];
      
      for (const insp of inspectionTypes) {
        const fieldValue = row[insp.field];
        if (fieldValue) {
          const parsed = parseInspectionField(fieldValue);
          if (parsed.date || parsed.result) {
            await db.insert(inspections).values({
              poId,
              poNumber,
              style,
              vendorId,
              vendorName,
              inspectionType: insp.type,
              inspectionDate: parsed.date,
              result: parsed.result,
            });
            inspectionsImported++;
          }
        }
      }
      
      // Import quality tests
      // Mandatory test
      const mandatoryReport = row['Product Lab Test Report (Mandatory + Performance)'];
      const mandatoryResult = row['mandatory Tst Result'];
      const mandatoryExpiry = row['Mandatory test Expiry Date'];
      const mandatoryStatus = row['Mandatory test Status'];
      const mandatoryCap = row['Mandatory test Corrective Action Plan'];
      
      if (mandatoryReport || mandatoryResult) {
        await db.insert(qualityTests).values({
          poId,
          poNumber,
          style,
          testType: 'Mandatory',
          reportNumber: mandatoryReport ? String(mandatoryReport).trim() : null,
          result: mandatoryResult ? String(mandatoryResult).trim() : null,
          expiryDate: parseDate(mandatoryExpiry),
          status: mandatoryStatus ? String(mandatoryStatus).trim() : null,
          correctiveActionPlan: mandatoryCap ? String(mandatoryCap).trim() : null,
        });
        testsImported++;
      }
      
      // Performance test
      const perfResult = row['Performance test result'];
      const perfExpiry = row['Performance test Expiry Date'];
      const perfStatus = row['Performance test Status'];
      const perfCap = row['Prefromance test Corrective Action Plan'];
      
      if (perfResult) {
        await db.insert(qualityTests).values({
          poId,
          poNumber,
          style,
          testType: 'Performance',
          result: perfResult ? String(perfResult).trim() : null,
          expiryDate: parseDate(perfExpiry),
          status: perfStatus ? String(perfStatus).trim() : null,
          correctiveActionPlan: perfCap ? String(perfCap).trim() : null,
        });
        testsImported++;
      }
      
      // Transit test
      const transitDate = row['Transit Report Date'];
      const transitResult = row['Transit test Result'];
      const transitReport = row['Transit test Report Number'];
      const transitCap = row['Transit Test Corrective Action Plan'];
      
      if (transitResult || transitReport) {
        await db.insert(qualityTests).values({
          poId,
          poNumber,
          style,
          testType: 'Transit',
          reportDate: parseDate(transitDate),
          reportNumber: transitReport ? String(transitReport).trim() : null,
          result: transitResult ? String(transitResult).trim() : null,
          correctiveActionPlan: transitCap ? String(transitCap).trim() : null,
        });
        testsImported++;
      }
      
      // Transit Retest
      const retestDate = row['Transit Test Retest\nReport Date'];
      const retestResult = row['Transit Test Retest\nResult'];
      const retestReport = row['Transit Test Retest\nReport Number'];
      const retestCap = row['Transit Test Retest\nCorrective Action Plan'];
      
      if (retestResult || retestReport) {
        await db.insert(qualityTests).values({
          poId,
          poNumber,
          style,
          testType: 'Retest',
          reportDate: parseDate(retestDate),
          reportNumber: retestReport ? String(retestReport).trim() : null,
          result: retestResult ? String(retestResult).trim() : null,
          correctiveActionPlan: retestCap ? String(retestCap).trim() : null,
        });
        testsImported++;
      }
      
    } catch (error: any) {
      errors.push(`Row ${i + 2}: ${error.message}`);
    }
  }
  
  console.log(`Inspection Import complete: ${inspectionsImported} inspections, ${testsImported} quality tests imported`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.slice(0, 10).join('\n')}`);
  }
  return { inspectionsImported, testsImported };
}

async function main() {
  try {
    console.log('=== Starting Data Import ===\n');
    
    // Clear existing data to avoid duplicates (optional - comment out if you want to append)
    console.log('Clearing existing inspection and MCP data...');
    await db.delete(skuColorPanels);
    await db.delete(colorPanelHistory);
    await db.delete(colorPanels);
    await db.delete(qualityTests);
    await db.delete(inspections);
    
    // Import MCP data
    const mcpCount = await importMCPData();
    
    // Import inspection data
    const { inspectionsImported, testsImported } = await importInspectionData();
    
    console.log('\n=== Import Summary ===');
    console.log(`MCPs imported: ${mcpCount}`);
    console.log(`Inspections imported: ${inspectionsImported}`);
    console.log(`Quality tests imported: ${testsImported}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

main();
