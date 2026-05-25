const standardLevels = [
  "S3-Kesehatan",
  "S2-Kesehatan",
  "S1-Kesehatan",
  "D4-Kesehatan",
  "D3-Kesehatan",
  "S3-Eksakta",
  "S2-Eksakta",
  "S1-Eksakta",
  "S3-Sosial",
  "S2-Sosial",
  "S1-Sosial",
  "S2-Administrasi",
  "S1-Administrasi",
  "D3-Administrasi",
  "D2-Administrasi/SLTA",
  "Khusus",
  "S3-FT",
  "S2-FT",
  "S1-FT",
  "S3-fia",
  "S2-fia",
  "S1-fia"
];

const currentLevels = [
  "S2-Adm",
  "Khusus",
  "S1-Adm",
  "D2-Adm/SLTA",
  "S3-Sos",
  "S2-Sos",
  "S2-Eks",
  "S2-Kes",
  "S1-Sos",
  "D4-Kes",
  "S1-Kes",
  "D3-Kes",
  "D3-Adm",
  "S1-Eks"
];

console.log('📌 SIMULATING MATCHES USING 6-CHAR PREFIX:');
for (const current of currentLevels) {
  const currentPrefix = current.trim().substring(0, 6).toUpperCase();
  const matched = standardLevels.find(std => 
    std.trim().substring(0, 6).toUpperCase() === currentPrefix
  );
  console.log(`- "${current}" (Prefix: "${currentPrefix}") -> "${matched || '❌ NO MATCH!'}"`);
}
