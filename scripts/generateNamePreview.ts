import * as fs from 'fs';
import * as path from 'path';

// Using the previous preview file to get current names for the summary
const currentDataPath = path.resolve(process.cwd(), 'tmp/blue-collar-preview.json');
const csvPath = path.resolve(process.cwd(), 'Revised Names of Blue Collar workers - Sheet1.csv');
const outputPath = path.resolve(process.cwd(), 'tmp/name-update-preview.json');

async function generateNameUpdatePreview() {
  if (!fs.existsSync(currentDataPath)) {
    console.error('❌ Current data preview not found at tmp/blue-collar-preview.json');
    process.exit(1);
  }

  const currentEmployees = JSON.parse(fs.readFileSync(currentDataPath, 'utf8'));
  const employeeMap = new Map();
  currentEmployees.forEach((emp: any) => {
    employeeMap.set(emp.employeeId, emp);
  });

  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n');
  const headers = lines[0].split(',');
  
  const previewData = [];

  // Start from line 1 (skip headers)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(',');
    const no = parts[0];
    // "Nama" is the last column, convert to upper case and normalize spaces
    const newName = parts[parts.length - 1].toUpperCase().replace(/\s+/g, ' ').trim();
    
    if (!no || !newName) continue;

    const employeeId = `BC_${no.padStart(3, '0')}`;
    const currentEmp = employeeMap.get(employeeId);

    if (currentEmp) {
      if (currentEmp.name !== newName) {
        previewData.push({
          employeeId,
          nik: currentEmp.nik,
          oldName: currentEmp.name,
          newName: newName,
        });
      }
    } else {
      console.warn(`⚠️ No current employee found for ID: ${employeeId}`);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(previewData, null, 2));
  console.log(`✅ Preview generated with ${previewData.length} changes.`);
  console.log(`📄 See: tmp/name-update-preview.json`);
}

generateNameUpdatePreview().catch(console.error);
