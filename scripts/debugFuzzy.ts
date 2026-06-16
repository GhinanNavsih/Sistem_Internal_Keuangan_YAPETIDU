const dbKeys = [ 'm. masrur', 'muhammad miftakhul syakhuddin' ];
const normExcelName = 'khoiro ummah';

dbKeys.forEach(k => {
  const cond1 = k.includes(normExcelName);
  const cond2 = normExcelName.includes(k);
  console.log(`Key: "${k}" | Excel Name: "${normExcelName}"`);
  console.log(`  k.includes(normExcelName):`, cond1);
  console.log(`  normExcelName.includes(k):`, cond2);
});

// Let's run the actual find
const matched = dbKeys.find(k => k.includes(normExcelName) || normExcelName.includes(k));
console.log('Result of find:', matched);
