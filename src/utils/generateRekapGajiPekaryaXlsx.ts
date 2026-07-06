import * as XLSX from 'xlsx';
import { RekapGajiData } from './generateRekapGajiPdf';

export function generateRekapGajiPekaryaXlsx(data: RekapGajiData): void {
  // Calculate Grand Totals
  const grandTotal = data.categories.reduce(
    (acc, cat) => {
      acc.totalEarnings += cat.totalEarnings;
      acc.totalDeductions += cat.totalDeductions;
      acc.netSalary += cat.netSalary;
      data.deductionKeys.forEach(key => {
        acc.deductions[key] = (acc.deductions[key] || 0) + (cat.deductions[key] || 0);
      });
      return acc;
    },
    {
      totalEarnings: 0,
      deductions: {} as Record<string, number>,
      totalDeductions: 0,
      netSalary: 0,
    }
  );

  // Headers
  // Row 1: ['NO', 'URAIAN', 'JUMLAH', 'POTONGAN', ...empty cells..., 'GAJI BERSIH']
  // Row 2: ['', '', '', ...data.deductionKeys, 'JML POTONGAN', '']
  const header1 = [
    'NO',
    'URAIAN',
    'JUMLAH',
    'POTONGAN',
    ...Array(data.deductionKeys.length).fill(''), // empty cells for colspan
    'GAJI BERSIH'
  ];

  const header2 = [
    '',
    '',
    '',
    ...data.deductionKeys.map(key => key.toUpperCase()),
    'JML POTONGAN',
    ''
  ];

  const rows: any[][] = [];

  // Data Rows
  data.categories.forEach((cat, idx) => {
    const row: any[] = [
      idx + 1,
      cat.categoryName,
      cat.totalEarnings
    ];

    // Add deductions
    data.deductionKeys.forEach(key => {
      row.push(cat.deductions[key] || 0);
    });

    // Add totalDeductions and netSalary
    row.push(cat.totalDeductions);
    row.push(cat.netSalary);

    rows.push(row);
  });

  // Grand Total Row
  const grandTotalRow: any[] = [
    '',
    'JUMLAH',
    grandTotal.totalEarnings
  ];

  data.deductionKeys.forEach(key => {
    grandTotalRow.push(grandTotal.deductions[key] || 0);
  });

  grandTotalRow.push(grandTotal.totalDeductions);
  grandTotalRow.push(grandTotal.netSalary);

  const worksheetData = [
    [data.isLoyalis ? 'REKAPITULASI GAJI LOYALIS' : 'REKAPITULASI GAJI PEKARYA'],
    [`BULAN ${data.period.toUpperCase()}`],
    [],
    header1,
    header2,
    ...rows,
    [],
    grandTotalRow
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  
  const numDeductions = data.deductionKeys.length;
  const merges = [
    // NO (col 0)
    { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } },
    // URAIAN (col 1)
    { s: { r: 3, c: 1 }, e: { r: 4, c: 1 } },
    // JUMLAH (col 2)
    { s: { r: 3, c: 2 }, e: { r: 4, c: 2 } },
    // POTONGAN (col 3 to 3 + numDeductions)
    { s: { r: 3, c: 3 }, e: { r: 3, c: 3 + numDeductions } },
    // GAJI BERSIH (col 3 + numDeductions + 1)
    { s: { r: 3, c: 3 + numDeductions + 1 }, e: { r: 4, c: 3 + numDeductions + 1 } }
  ];
  worksheet['!merges'] = merges;

  // Let's set some column widths so that it looks neat.
  // Col 0: 5, Col 1: 30, Col 2: 15, then each deduction: 15, Jml Potongan: 15, Gaji Bersih: 15
  const colWidths = [
    { wch: 6 },
    { wch: 30 },
    { wch: 15 },
    ...Array(numDeductions + 2).fill({ wch: 15 })
  ];
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Rekap Gaji');

  const filename = `Rekap_Gaji_${data.isLoyalis ? 'Loyalis' : 'Pekarya'}_${data.period.replace(/\s+/g, '_')}.xlsx`;
  XLSX.writeFile(workbook, filename);
}
