import XLSX from 'xlsx';

const workbook = XLSX.readFile('attached_assets/2025-11-24 - OS650 SHIPMENT TRACKER_1763992762303.xlsx');
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

console.log('Sheet name:', sheetName);
console.log('Range:', sheet['!ref']);
console.log('\nFirst 10 rows:');

// Convert to JSON to see structure
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

// Show first 10 rows
data.slice(0, 10).forEach((row: any, idx: number) => {
  console.log(`Row ${idx}:`, JSON.stringify(row));
});

console.log('\n\nColumn Headers (Row 0):');
console.log(JSON.stringify(data[0], null, 2));

console.log('\n\nSample data rows (1-3):');
data.slice(1, 4).forEach((row: any, idx: number) => {
  console.log(`Row ${idx + 1}:`, JSON.stringify(row, null, 2));
});

console.log('\n\nTotal rows:', data.length);
