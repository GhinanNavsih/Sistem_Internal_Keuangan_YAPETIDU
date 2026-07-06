import * as XLSX from 'xlsx';

export interface KebutuhanEmployee {
  id: string;
  name: string;
  departmentUnit: string;
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
}

export interface KebutuhanReportData {
  period: string; // e.g., "Juni 2026"
  employees: KebutuhanEmployee[];
}

const SATKERS = [
  'REKTORAT',
  'PASCASARJANA',
  'FAK. AGAMA ISLAM',
  'FAK. BISNIS, BAHASA DAN PENDIDIKAN',
  'FAK. SAINS DAN TEKNOLOGI',
  'FAK. ILMU KESH',
  'UPT & LEMBAGA'
];

const getSatkerIndex = (dept: string): number => {
  if (!dept) return 6; // Default to UPT & LEMBAGA if empty
  const clean = dept.trim().toUpperCase();
  if (clean.includes('REKTORAT')) return 0;
  if (clean.includes('PASCASARJANA') || clean.includes('PASCA')) return 1;
  if (clean.includes('AGAMA ISLAM') || clean.includes('FAI')) return 2;
  if (clean.includes('BISNIS') || clean.includes('FEB') || clean.includes('FBS') || clean.includes('FIP') || clean.includes('FBBP')) return 3;
  if (clean.includes('SAINS') || clean.includes('TEKNOLOGI') || clean.includes('FST') || clean.includes('FT') || clean.includes('FSP')) return 4;
  if (clean.includes('KESEHATAN') || clean.includes('KESH') || clean.includes('FIK')) return 5;
  return 6; // Default to UPT & LEMBAGA (BAK, Satpam, Yayasan, UPT, etc.)
};

interface StandardRowDef {
  name: string;
  match: (label: string) => boolean;
}

const GAJI_UTAMA_ROWS: StandardRowDef[] = [
  { name: 'GAJI POKOK', match: (l) => /Gaji Pokok/i.test(l) },
  { name: 'T. KELUARGA', match: (l) => /Keluarga/i.test(l) },
  { name: 'T. FUNGSIONAL', match: (l) => /Fungsional/i.test(l) },
  { name: 'KEPANGKATAN', match: (l) => /Kepangkatan/i.test(l) },
  { name: 'T. HARI TUA', match: (l) => /Hari Tua/i.test(l) },
  { name: 'T. BPJS TK', match: (l) => /BPJS.*TK|BPJS.*Ketenagakerjaan.*\(U\)/i.test(l) },
  { name: 'T. BPJS KES', match: (l) => /BPJS.*Kes|BPJS.*Kesehatan.*\(U\)/i.test(l) },
  { name: 'BERAS', match: (l) => /Beras/i.test(l) },
  { name: 'PRESENSI', match: (l) => /^Presensi$|^Tunjangan Presensi$/i.test(l) },
  { name: 'BONUS PRESENSI', match: (l) => /Bonus Presensi/i.test(l) },
  { name: 'PIKET', match: (l) => /Piket/i.test(l) },
  { name: 'LEMBUR', match: (l) => /Lembur/i.test(l) },
];

const TUNJANGAN_JABATAN_ROW: StandardRowDef = {
  name: 'TUNJANGAN JABATAN',
  match: (l) => /Jabatan|Struktural/i.test(l),
};

const POTONGAN_ROWS: StandardRowDef[] = [
  { name: 'KOPERASI ROCHMAD', match: (l) => /Rochmad/i.test(l) },
  { name: 'BPJS', match: (l) => /BPJS/i.test(l) },
  { name: 'THT', match: (l) => /THT|Hari Tua/i.test(l) },
  { name: 'TABUNGAN', match: (l) => /Tabungan/i.test(l) },
  { name: 'ZIZ', match: (l) => /ZIS|ZIZ|Zakat/i.test(l) },
  { name: 'REVISI GAJI', match: (l) => /Revisi/i.test(l) },
  { name: 'PINLU/TAGIHAN', match: (l) => /Pinlu|Tagihan/i.test(l) },
  { name: 'KOPERASI UNIPDU REJOSO GEMILANG', match: (l) => /Unipdu Rejoso|Rejoso Gemilang|Koperasi Unipdu/i.test(l) },
  { name: 'POTONGAN PRESENSI', match: (l) => /Potongan Presensi/i.test(l) },
  { name: 'POTONGAN BONUS PRESENSI', match: (l) => /Potongan Bonus Presensi/i.test(l) },
];

export function generateKebutuhanDanaGajiXlsx(data: KebutuhanReportData): void {
  // Collect other earnings dynamic labels
  const otherEarningLabels = new Set<string>();
  data.employees.forEach(emp => {
    emp.earnings.forEach(earn => {
      const isGajiUtama = GAJI_UTAMA_ROWS.some(r => r.match(earn.label));
      const isTunjanganJabatan = TUNJANGAN_JABATAN_ROW.match(earn.label);
      if (!isGajiUtama && !isTunjanganJabatan && earn.amount > 0) {
        otherEarningLabels.add(earn.label);
      }
    });
  });
  const sortedOtherEarningLabels = Array.from(otherEarningLabels).sort();

  // Collect other deductions dynamic labels
  const otherDeductionLabels = new Set<string>();
  data.employees.forEach(emp => {
    emp.deductions.forEach(ded => {
      const isStandard = POTONGAN_ROWS.some(r => r.match(ded.label));
      if (!isStandard && ded.amount > 0) {
        otherDeductionLabels.add(ded.label);
      }
    });
  });
  const sortedOtherDeductionLabels = Array.from(otherDeductionLabels).sort();

  // Initialize value arrays (7 SatKers per row)
  const mainSalaryValues = GAJI_UTAMA_ROWS.map(() => new Array(7).fill(0));
  const tunjanganJabatanValues = new Array(7).fill(0);
  const otherEarningValues = sortedOtherEarningLabels.map(() => new Array(7).fill(0));
  const standardDeductionValues = POTONGAN_ROWS.map(() => new Array(7).fill(0));
  const otherDeductionValues = sortedOtherDeductionLabels.map(() => new Array(7).fill(0));

  // Process data from all employees
  data.employees.forEach(emp => {
    const sIdx = getSatkerIndex(emp.departmentUnit);

    // Earnings
    emp.earnings.forEach(earn => {
      let matched = false;
      for (let i = 0; i < GAJI_UTAMA_ROWS.length; i++) {
        if (GAJI_UTAMA_ROWS[i].match(earn.label)) {
          mainSalaryValues[i][sIdx] += earn.amount;
          matched = true;
          break;
        }
      }
      if (!matched) {
        if (TUNJANGAN_JABATAN_ROW.match(earn.label)) {
          tunjanganJabatanValues[sIdx] += earn.amount;
        } else {
          const oIdx = sortedOtherEarningLabels.indexOf(earn.label);
          if (oIdx !== -1) {
            otherEarningValues[oIdx][sIdx] += earn.amount;
          }
        }
      }
    });

    // Deductions
    emp.deductions.forEach(ded => {
      let matched = false;
      for (let i = 0; i < POTONGAN_ROWS.length; i++) {
        if (POTONGAN_ROWS[i].match(ded.label)) {
          standardDeductionValues[i][sIdx] += ded.amount;
          matched = true;
          break;
        }
      }
      if (!matched) {
        const oIdx = sortedOtherDeductionLabels.indexOf(ded.label);
        if (oIdx !== -1) {
          otherDeductionValues[oIdx][sIdx] += ded.amount;
        }
      }
    });
  });

  // Calculate totals per SatKer
  const gajiUtamaTotals = new Array(7).fill(0);
  for (let s = 0; s < 7; s++) {
    for (let r = 0; r < GAJI_UTAMA_ROWS.length; r++) {
      gajiUtamaTotals[s] += mainSalaryValues[r][s];
    }
  }

  const gajiTambahanTotals = new Array(7).fill(0);
  for (let s = 0; s < 7; s++) {
    for (let r = 0; r < sortedOtherEarningLabels.length; r++) {
      gajiTambahanTotals[s] += otherEarningValues[r][s];
    }
  }

  const gajiTotalValues = new Array(7).fill(0);
  for (let s = 0; s < 7; s++) {
    gajiTotalValues[s] = gajiUtamaTotals[s] + tunjanganJabatanValues[s] + gajiTambahanTotals[s];
  }

  const potonganTotals = new Array(7).fill(0);
  for (let s = 0; s < 7; s++) {
    for (let r = 0; r < POTONGAN_ROWS.length; r++) {
      potonganTotals[s] += standardDeductionValues[r][s];
    }
    for (let r = 0; r < sortedOtherDeductionLabels.length; r++) {
      potonganTotals[s] += otherDeductionValues[r][s];
    }
  }

  const gajiBersihValues = new Array(7).fill(0);
  for (let s = 0; s < 7; s++) {
    gajiBersihValues[s] = gajiTotalValues[s] - potonganTotals[s];
  }

  // Construct worksheets array of arrays (AOA)
  const worksheetData: any[][] = [
    ['KEBUTUHAN DANA GAJI'],
    [`BULAN ${data.period.toUpperCase()}`],
    [],
    [
      'NO',
      'URAIAN',
      ...SATKERS,
      'JUMLAH'
    ]
  ];

  // 1. PENDAPATAN / GAJI Section
  const earnRowIndices: number[] = []; // track 0-based row indices
  let earnNo = 1;
  GAJI_UTAMA_ROWS.forEach((rowDef, idx) => {
    const rowValues = mainSalaryValues[idx];
    const rowTotal = rowValues.reduce((sum, v) => sum + v, 0);
    earnRowIndices.push(worksheetData.length);
    worksheetData.push([
      earnNo++,
      rowDef.name,
      ...rowValues,
      rowTotal
    ]);
  });
  
  // Tunjangan Jabatan (listed immediately in the same sequence)
  const totalTunjanganJabatanVal = tunjanganJabatanValues.reduce((sum, v) => sum + v, 0);
  earnRowIndices.push(worksheetData.length);
  worksheetData.push([
    earnNo++,
    'TUNJANGAN JABATAN',
    ...tunjanganJabatanValues,
    totalTunjanganJabatanVal
  ]);

  // Dynamic Variable Earnings (Vakasi/Instruksional/etc.)
  sortedOtherEarningLabels.forEach((label) => {
    const idx = sortedOtherEarningLabels.indexOf(label);
    const rowValues = otherEarningValues[idx];
    const rowTotal = rowValues.reduce((sum, v) => sum + v, 0);
    earnRowIndices.push(worksheetData.length);
    worksheetData.push([
      earnNo++,
      label.toUpperCase(),
      ...rowValues,
      rowTotal
    ]);
  });

  // JUMLAH GAJI TOTAL summary row
  const totalGajiTotalVal = gajiTotalValues.reduce((sum, v) => sum + v, 0);
  worksheetData.push([
    '',
    'JUMLAH GAJI TOTAL',
    ...gajiTotalValues,
    totalGajiTotalVal
  ]);

  worksheetData.push([]); // spacer below Jumlah Gaji Total

  // 5. POTONGAN Section
  const dedRowIndices: number[] = []; // track 0-based row indices
  worksheetData.push(['', 'POTONGAN']);
  let potNo = 1;
  POTONGAN_ROWS.forEach((rowDef, idx) => {
    const rowValues = standardDeductionValues[idx];
    const rowTotal = rowValues.reduce((sum, v) => sum + v, 0);
    dedRowIndices.push(worksheetData.length);
    worksheetData.push([
      potNo++,
      rowDef.name,
      ...rowValues,
      rowTotal
    ]);
  });

  sortedOtherDeductionLabels.forEach((label, idx) => {
    const rowValues = otherDeductionValues[idx];
    const rowTotal = rowValues.reduce((sum, v) => sum + v, 0);
    dedRowIndices.push(worksheetData.length);
    worksheetData.push([
      potNo++,
      label.toUpperCase(),
      ...rowValues,
      rowTotal
    ]);
  });

  // Potongan Gaji summary row
  const totalPotonganVal = potonganTotals.reduce((sum, v) => sum + v, 0);
  const totPotRowIdx = worksheetData.length;
  worksheetData.push([
    '',
    'TOTAL POTONGAN GAJI',
    ...potonganTotals,
    totalPotonganVal
  ]);

  worksheetData.push([]); // spacer

  // 6. JUMLAH GAJI BERSIH summary row
  const totalGajiBersihVal = gajiBersihValues.reduce((sum, v) => sum + v, 0);
  worksheetData.push([
    '',
    'JUMLAH GAJI BERSIH',
    ...gajiBersihValues,
    totalGajiBersihVal
  ]);

  // 7. DITERIMAKAN BANK / TUNAI rows
  worksheetData.push([
    '',
    'DITERIMAKAN BANK',
    ...gajiBersihValues,
    totalGajiBersihVal
  ]);

  worksheetData.push([
    '',
    'DITERIMAKAN TUNAI',
    0, 0, 0, 0, 0, 0, 0, 0
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Apply faint green fill to earning rows and faint red fill to deduction rows
  const EARN_FILL = { patternType: 'solid', fgColor: { rgb: 'EBFAEB' } }; // faint green
  const DED_FILL  = { patternType: 'solid', fgColor: { rgb: 'FFEBEB' } }; // faint red
  const NUM_COLS = 10; // A-J
  const ALPHA = 'ABCDEFGHIJ';
  earnRowIndices.forEach(r => {
    for (let c = 0; c < NUM_COLS; c++) {
      const ref = `${ALPHA[c]}${r + 1}`;
      if (worksheet[ref]) {
        worksheet[ref].s = { ...(worksheet[ref].s || {}), fill: EARN_FILL };
      }
    }
  });
  dedRowIndices.forEach(r => {
    for (let c = 0; c < NUM_COLS; c++) {
      const ref = `${ALPHA[c]}${r + 1}`;
      if (worksheet[ref]) {
        worksheet[ref].s = { ...(worksheet[ref].s || {}), fill: DED_FILL };
      }
    }
  });
  // Yellow fill for TOTAL POTONGAN GAJI (same as JUMLAH GAJI TOTAL)
  const TOT_POT_FILL = { patternType: 'solid', fgColor: { rgb: 'FCF3CF' } };
  for (let c = 0; c < NUM_COLS; c++) {
    const ref = `${ALPHA[c]}${totPotRowIdx + 1}`;
    if (worksheet[ref]) {
      worksheet[ref].s = { ...(worksheet[ref].s || {}), fill: TOT_POT_FILL };
    }
  }

  // Setup title merges: Columns A to J (index 0 to 9)
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }
  ];
  worksheet['!merges'] = merges;

  // Set column widths
  const colWidths = [
    { wch: 6 },  // NO
    { wch: 35 }, // URAIAN
    ...Array(7).fill({ wch: 18 }), // SatKers
    { wch: 20 }  // JUMLAH
  ];
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Kebutuhan Dana Gaji');

  const filename = `Kebutuhan_Dana_Gaji_${data.period.replace(/\s+/g, '_')}.xlsx`;
  XLSX.writeFile(workbook, filename);
}
