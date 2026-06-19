import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

function main() {
  const filePath = path.resolve(process.cwd(), 'Pegawai + Email.xlsx');
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['White Collar Loyalis'];
  const data: any[] = XLSX.utils.sheet_to_json(sheet);
  
  let telpHasEmailCount = 0;
  let telpHasPhoneCount = 0;
  let emailHasEmailCount = 0;
  let emailHasPhoneCount = 0;
  
  const anomalies: any[] = [];
  
  data.forEach((row, i) => {
    const telp = String(row['Nomor Telepon'] || '').trim();
    const email = String(row['Email'] || '').trim();
    
    const telpIsEmail = telp.includes('@');
    const emailIsEmail = email.includes('@');
    
    const telpIsPhone = telp && !telpIsEmail;
    const emailIsPhone = email && !emailIsEmail;
    
    if (telpIsEmail) telpHasEmailCount++;
    if (telpIsPhone) telpHasPhoneCount++;
    if (emailIsEmail) emailHasEmailCount++;
    if (emailIsPhone) emailHasPhoneCount++;
    
    // Check if there is any row where we have both email and phone in unexpected columns,
    // or if the columns are actually swapped, or if they are both emails/phones.
    if (telpIsPhone || emailIsEmail) {
      anomalies.push({
        rowIndex: i + 1,
        id: row['ID Pegawai'],
        name: row['Nama Lengkap'],
        telp,
        email
      });
    }
  });
  
  console.log(`Summary of analysis:`);
  console.log(`- Nomor Telepon contains '@' (email): ${telpHasEmailCount} rows`);
  console.log(`- Nomor Telepon does NOT contain '@' but is not empty (phone): ${telpHasPhoneCount} rows`);
  console.log(`- Email contains '@' (email): ${emailHasEmailCount} rows`);
  console.log(`- Email does NOT contain '@' but is not empty (phone): ${emailHasPhoneCount} rows`);
  console.log(`- Total anomalies (where telp has phone, or email has email): ${anomalies.length}`);
  
  if (anomalies.length > 0) {
    console.log('\n--- Anomalies Detail ---');
    console.log(JSON.stringify(anomalies, null, 2));
  }
}

main();
