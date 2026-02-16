import XLSX from 'xlsx';
import { db } from '../server/db';
import { colorPanels, colorPanelHistory, skuColorPanels, skus, vendors } from '../shared/schema';
import { eq, sql, desc } from 'drizzle-orm';
import * as fs from 'fs';

interface PanelWithDetails {
  id: number;
  brand: string | null;
  vendorName: string | null;
  vendorId: number | null;
  collection: string | null;
  skuDescription: string | null;
  material: string | null;
  finishName: string | null;
  sheenLevel: string | null;
  finishSystem: string | null;
  paintSupplier: string | null;
  validityMonths: number;
  currentMcpNumber: string | null;
  currentApprovalDate: Date | null;
  currentExpirationDate: Date | null;
  status: string;
  notes: string | null;
}

interface VersionRecord {
  panelId: number;
  versionNumber: number;
  mcpNumber: string;
  approvalDate: Date | null;
  expirationDate: Date | null;
}

interface SkuLink {
  panelId: number;
  skuId: number;
  skuCode: string;
}

function formatDate(date: Date | string | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

function generatePanelUID(panel: PanelWithDetails): string {
  const parts = [
    panel.brand || 'NOBRAND',
    (panel.collection || '').substring(0, 20).replace(/[^a-zA-Z0-9]/g, ''),
    (panel.finishName || '').substring(0, 15).replace(/[^a-zA-Z0-9]/g, ''),
    panel.currentMcpNumber || panel.id.toString()
  ];
  return parts.join('-');
}

async function exportMCPData() {
  console.log('Fetching data from database...\n');

  const allPanels = await db.select().from(colorPanels).orderBy(colorPanels.brand, colorPanels.collection);
  console.log(`Found ${allPanels.length} color panels`);

  const allHistory = await db.select().from(colorPanelHistory).orderBy(colorPanelHistory.colorPanelId, colorPanelHistory.versionNumber);
  console.log(`Found ${allHistory.length} version history records`);

  const allSkuLinks = await db
    .select({
      panelId: skuColorPanels.colorPanelId,
      skuId: skuColorPanels.skuId,
      skuCode: skus.sku,
    })
    .from(skuColorPanels)
    .innerJoin(skus, eq(skuColorPanels.skuId, skus.id));
  console.log(`Found ${allSkuLinks.length} SKU links`);

  const allVendors = await db.select().from(vendors);
  const vendorMap = new Map(allVendors.map(v => [v.id, v.name]));

  const historyByPanel = new Map<number, any[]>();
  for (const h of allHistory) {
    if (!historyByPanel.has(h.colorPanelId)) {
      historyByPanel.set(h.colorPanelId, []);
    }
    historyByPanel.get(h.colorPanelId)!.push(h);
  }

  const skusByPanel = new Map<number, string[]>();
  for (const link of allSkuLinks) {
    if (!skusByPanel.has(link.panelId)) {
      skusByPanel.set(link.panelId, []);
    }
    skusByPanel.get(link.panelId)!.push(link.skuCode);
  }

  const workbook = XLSX.utils.book_new();

  console.log('\nBuilding MCP Master sheet...');
  const masterRows: any[] = [];
  for (const panel of allPanels) {
    const linkedSkus = skusByPanel.get(panel.id) || [];
    const history = historyByPanel.get(panel.id) || [];
    const vendorDisplayName = panel.vendorId ? vendorMap.get(panel.vendorId) : panel.vendorName;
    
    masterRows.push({
      'Panel ID': panel.id,
      'Brand': panel.brand || '',
      'Status': panel.status || '',
      'Vendor': vendorDisplayName || panel.vendorName || '',
      'Collection': panel.collection || '',
      'SKU Description': panel.skuDescription || '',
      'Material': panel.material || '',
      'Finish Name': panel.finishName || '',
      'Sheen Level': panel.sheenLevel || '',
      'Finish System': panel.finishSystem || '',
      'Paint Supplier': panel.paintSupplier || '',
      'Validity (Months)': panel.validityMonths || 12,
      'Current MCP #': panel.currentMcpNumber || '',
      'Current Approval Date': formatDate(panel.currentApprovalDate),
      'Current Expiration Date': formatDate(panel.currentExpirationDate),
      'Version Count': history.length,
      'Linked SKU Count': linkedSkus.length,
      'Linked SKUs': linkedSkus.join(', '),
      'Needs SKU Review': linkedSkus.length === 0 ? 'YES' : '',
      'Notes': panel.notes || '',
    });
  }
  
  const masterSheet = XLSX.utils.json_to_sheet(masterRows);
  masterSheet['!cols'] = [
    { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 25 }, { wch: 25 },
    { wch: 35 }, { wch: 40 }, { wch: 25 }, { wch: 12 }, { wch: 15 },
    { wch: 20 }, { wch: 12 }, { wch: 15 }, { wch: 18 }, { wch: 18 },
    { wch: 12 }, { wch: 15 }, { wch: 50 }, { wch: 15 }, { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(workbook, masterSheet, 'MCP Master');

  console.log('Building MCP Version History sheet...');
  const versionRows: any[] = [];
  for (const panel of allPanels) {
    const history = historyByPanel.get(panel.id) || [];
    for (const version of history) {
      versionRows.push({
        'Panel ID': panel.id,
        'Brand': panel.brand || '',
        'Collection': panel.collection || '',
        'Finish Name': panel.finishName || '',
        'Version #': version.versionNumber,
        'MCP Number': version.mcpNumber || '',
        'Approval Date': formatDate(version.approvalDate),
        'Expiration Date': formatDate(version.expirationDate),
      });
    }
  }
  
  const versionSheet = XLSX.utils.json_to_sheet(versionRows);
  versionSheet['!cols'] = [
    { wch: 10 }, { wch: 8 }, { wch: 25 }, { wch: 25 },
    { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
  ];
  XLSX.utils.book_append_sheet(workbook, versionSheet, 'MCP Versions');

  console.log('Building SKU Links sheet...');
  const skuLinkRows: any[] = [];
  for (const panel of allPanels) {
    const linkedSkus = skusByPanel.get(panel.id) || [];
    if (linkedSkus.length > 0) {
      for (const sku of linkedSkus) {
        skuLinkRows.push({
          'Panel ID': panel.id,
          'Brand': panel.brand || '',
          'Collection': panel.collection || '',
          'Finish Name': panel.finishName || '',
          'Current MCP #': panel.currentMcpNumber || '',
          'SKU Code': sku,
          'Status': 'Matched',
        });
      }
    }
  }
  
  const skuLinkSheet = XLSX.utils.json_to_sheet(skuLinkRows);
  skuLinkSheet['!cols'] = [
    { wch: 10 }, { wch: 8 }, { wch: 25 }, { wch: 25 },
    { wch: 15 }, { wch: 15 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(workbook, skuLinkSheet, 'SKU Links');

  console.log('Building Panels Needing SKU Review sheet...');
  const needsReviewRows: any[] = [];
  for (const panel of allPanels) {
    const linkedSkus = skusByPanel.get(panel.id) || [];
    if (linkedSkus.length === 0) {
      const vendorDisplayName = panel.vendorId ? vendorMap.get(panel.vendorId) : panel.vendorName;
      needsReviewRows.push({
        'Panel ID': panel.id,
        'Brand': panel.brand || '',
        'Vendor': vendorDisplayName || panel.vendorName || '',
        'Collection': panel.collection || '',
        'SKU Description': panel.skuDescription || '',
        'Finish Name': panel.finishName || '',
        'Material': panel.material || '',
        'Current MCP #': panel.currentMcpNumber || '',
        'Status': panel.status || '',
        'SKU Codes to Add': '',
      });
    }
  }
  
  const needsReviewSheet = XLSX.utils.json_to_sheet(needsReviewRows);
  needsReviewSheet['!cols'] = [
    { wch: 10 }, { wch: 8 }, { wch: 25 }, { wch: 25 },
    { wch: 35 }, { wch: 25 }, { wch: 40 }, { wch: 15 }, { wch: 10 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(workbook, needsReviewSheet, 'Needs SKU Review');

  const brandSheets: { [key: string]: { brand: string; filter: (p: any) => boolean }[] } = {
    'CB2': [{ brand: 'CB2', filter: (p) => p.brand === 'CB2' && p.status !== 'archived' }],
    'CB2 Discontinued': [{ brand: 'CB2', filter: (p) => p.brand === 'CB2' && p.status === 'archived' }],
    'CB': [{ brand: 'CB', filter: (p) => p.brand === 'CB' || p.brand === 'C&B' }],
    'CK': [{ brand: 'CK', filter: (p) => p.brand === 'CK' && !p.collection?.toLowerCase().includes('handle') }],
    'CK Handle': [{ brand: 'CK', filter: (p) => p.brand === 'CK' && p.collection?.toLowerCase().includes('handle') }],
  };

  for (const [sheetName, configs] of Object.entries(brandSheets)) {
    console.log(`Building ${sheetName} sheet...`);
    const sheetRows: any[] = [];
    
    for (const panel of allPanels) {
      const matches = configs.some(c => c.filter(panel));
      if (!matches) continue;
      
      const linkedSkus = skusByPanel.get(panel.id) || [];
      const history = historyByPanel.get(panel.id) || [];
      const vendorDisplayName = panel.vendorId ? vendorMap.get(panel.vendorId) : panel.vendorName;
      
      const sortedHistory = [...history].sort((a, b) => a.versionNumber - b.versionNumber);
      
      const row: any = {
        'Brand': panel.brand || '',
        'Vendor': vendorDisplayName || panel.vendorName || '',
        'Collection': panel.collection || '',
        'SKU Description': panel.skuDescription || '',
        'Material': panel.material || '',
        'Finish Name': panel.finishName || '',
        'Sheen Level': panel.sheenLevel || '',
        'Finish System': panel.finishSystem || '',
        'Paint Supplier': panel.paintSupplier || '',
        'Validity (Months)': panel.validityMonths || 12,
        'Latest MCP #': panel.currentMcpNumber || '',
        'Latest Approval': formatDate(panel.currentApprovalDate),
        'Latest Expiration': formatDate(panel.currentExpirationDate),
      };

      for (let i = 0; i < 5; i++) {
        const v = sortedHistory[i];
        row[`MCP ${i + 1}`] = v?.mcpNumber || '';
        row[`Approval ${i + 1}`] = v ? formatDate(v.approvalDate) : '';
        row[`Expiration ${i + 1}`] = v ? formatDate(v.expirationDate) : '';
      }

      row['SKU Numbers'] = linkedSkus.join(', ');
      row['Status'] = panel.status || '';
      row['Notes'] = panel.notes || '';
      
      sheetRows.push(row);
    }
    
    if (sheetRows.length > 0) {
      const brandSheet = XLSX.utils.json_to_sheet(sheetRows);
      brandSheet['!cols'] = [
        { wch: 8 }, { wch: 25 }, { wch: 25 }, { wch: 35 }, { wch: 40 },
        { wch: 25 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }, { wch: 15 },
        { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 12 }, { wch: 12 }, { wch: 12 },
        { wch: 40 }, { wch: 10 }, { wch: 40 },
      ];
      XLSX.utils.book_append_sheet(workbook, brandSheet, sheetName);
    }
  }

  console.log('\nBuilding Instructions sheet...');
  const instructionRows = [
    { 'Instructions': 'MCP Library Export - Data Review Guide' },
    { 'Instructions': '' },
    { 'Instructions': '=== SHEET DESCRIPTIONS ===' },
    { 'Instructions': '' },
    { 'Instructions': '1. MCP Master - Complete consolidated view of all color panels with linked SKUs' },
    { 'Instructions': '   - "Needs SKU Review" column = YES means no SKUs are linked to this panel' },
    { 'Instructions': '   - "Linked SKUs" column shows all currently matched SKU codes' },
    { 'Instructions': '' },
    { 'Instructions': '2. MCP Versions - Complete version history for all panels (one row per version)' },
    { 'Instructions': '   - Use this to audit renewal history for any panel' },
    { 'Instructions': '' },
    { 'Instructions': '3. SKU Links - All successfully matched SKU-to-panel relationships' },
    { 'Instructions': '   - These links were created during import from MCP-CK and CK-MCP Handle sheets' },
    { 'Instructions': '' },
    { 'Instructions': '4. Needs SKU Review - Panels that have NO linked SKUs' },
    { 'Instructions': '   - Fill in the "SKU Codes to Add" column with comma-separated SKU numbers' },
    { 'Instructions': '   - These will be imported to create the missing links' },
    { 'Instructions': '' },
    { 'Instructions': '5-9. Brand Sheets (CB2, CB2 Discontinued, CB, CK, CK Handle)' },
    { 'Instructions': '   - Replicate the original Excel structure with MCP 1-5 history columns' },
    { 'Instructions': '   - SKU Numbers column shows linked SKUs' },
    { 'Instructions': '' },
    { 'Instructions': '=== HOW TO ADD MISSING SKUs ===' },
    { 'Instructions': '' },
    { 'Instructions': '1. Go to "Needs SKU Review" sheet' },
    { 'Instructions': '2. For each row, fill in the "SKU Codes to Add" column' },
    { 'Instructions': '3. Use comma-separated values for multiple SKUs (e.g., "123456, 789012, 345678")' },
    { 'Instructions': '4. Return the completed file for import' },
    { 'Instructions': '' },
    { 'Instructions': '=== STATISTICS ===' },
    { 'Instructions': `Total Panels: ${allPanels.length}` },
    { 'Instructions': `Total Version Records: ${allHistory.length}` },
    { 'Instructions': `Total SKU Links: ${allSkuLinks.length}` },
    { 'Instructions': `Panels Needing SKU Review: ${needsReviewRows.length}` },
    { 'Instructions': '' },
    { 'Instructions': `Export Date: ${new Date().toISOString().split('T')[0]}` },
  ];
  
  const instructionSheet = XLSX.utils.json_to_sheet(instructionRows);
  instructionSheet['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, instructionSheet, 'Instructions');

  const outputPath = 'attached_assets/MCP_Library_Export.xlsx';
  XLSX.writeFile(workbook, outputPath);
  
  console.log(`\n========================================`);
  console.log(`Export completed successfully!`);
  console.log(`File saved to: ${outputPath}`);
  console.log(`========================================`);
  console.log(`\nSummary:`);
  console.log(`  - MCP Master: ${masterRows.length} panels`);
  console.log(`  - MCP Versions: ${versionRows.length} history records`);
  console.log(`  - SKU Links: ${skuLinkRows.length} matched links`);
  console.log(`  - Needs SKU Review: ${needsReviewRows.length} panels without SKUs`);
}

exportMCPData().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Export failed:', error);
  process.exit(1);
});
