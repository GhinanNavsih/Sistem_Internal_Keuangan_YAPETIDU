import * as XLSX from 'xlsx';
import { LegalitasPimpinanData } from './generateLegalitasPimpinanPdf';

export function generateLegalitasPimpinanXlsx(data: LegalitasPimpinanData): void {
  // Find all unique earnings and deductions labels across all employees
  const earningLabelsSet = new Set<string>();
  const deductionLabelsSet = new Set<string>();

  data.employees.forEach(emp => {
    emp.earnings.forEach(e => {
      if (e.label !== 'Gapok' && e.label !== 'Gaji Pokok') {
        earningLabelsSet.add(e.label);
      }
    });
    emp.deductions.forEach(d => deductionLabelsSet.add(d.label));
  });

  const earningLabels = Array.from(earningLabelsSet);
  const deductionLabels = Array.from(deductionLabelsSet);
  // The tax column is emitted only when someone here is actually taxed, so an
  // untaxed export keeps the column layout it always had.
  const showTax = data.employees.some(emp => (emp.totalTax || 0) > 0);

  // Headers
  const header1 = [
    'NO',
    'NAMA',
    'GAPOK',
    'VAKASI',
    ...Array(earningLabels.length > 0 ? earningLabels.length - 1 : 0).fill(''),
    'JUMLAH',
    'POTONGAN',
    ...Array(deductionLabels.length > 0 ? deductionLabels.length - 1 : 0).fill(''),
    'JUMLAH POTONGAN',
    ...(showTax ? ['PAJAK'] : []),
    'GAJI BERSIH'
  ];

  const header2 = [
    '',
    '',
    '',
    ...earningLabels.map(l => l.toUpperCase()),
    '',
    ...deductionLabels.map(l => l.toUpperCase()),
    '',
    ...(showTax ? [''] : []),
    ''
  ];

  const rows: any[][] = [];
  
  // To compute grand totals
  let totalGapok = 0;
  const totalEarningsMap = new Map<string, number>();
  let grandTotalEarnings = 0;
  const totalDeductionsMap = new Map<string, number>();
  let grandTotalDeductions = 0;
  let grandTotalTax = 0;
  let grandNetSalary = 0;

  earningLabels.forEach(l => totalEarningsMap.set(l, 0));
  deductionLabels.forEach(l => totalDeductionsMap.set(l, 0));

  data.employees.forEach((emp, idx) => {
    totalGapok += emp.gapok;
    grandTotalEarnings += emp.totalEarnings;
    grandTotalDeductions += emp.totalDeductions;
    grandTotalTax += emp.totalTax || 0;
    grandNetSalary += emp.netSalary;

    const row: any[] = [
      idx + 1,
      emp.name,
      emp.gapok
    ];

    // Earnings
    earningLabels.forEach(label => {
      const field = emp.earnings.find(e => e.label === label);
      const amount = field ? field.amount : 0;
      row.push(amount);
      totalEarningsMap.set(label, (totalEarningsMap.get(label) || 0) + amount);
    });

    row.push(emp.totalEarnings);

    // Deductions
    deductionLabels.forEach(label => {
      const field = emp.deductions.find(d => d.label === label);
      const amount = field ? field.amount : 0;
      row.push(amount);
      totalDeductionsMap.set(label, (totalDeductionsMap.get(label) || 0) + amount);
    });

    row.push(emp.totalDeductions);
    if (showTax) {
      row.push(emp.totalTax || 0);
    }
    row.push(emp.netSalary);

    rows.push(row);
  });

  // Grand Total Row
  const grandTotalRow: any[] = [
    '',
    'JUMLAH',
    totalGapok
  ];

  earningLabels.forEach(label => {
    grandTotalRow.push(totalEarningsMap.get(label) || 0);
  });
  grandTotalRow.push(grandTotalEarnings);

  deductionLabels.forEach(label => {
    grandTotalRow.push(totalDeductionsMap.get(label) || 0);
  });
  grandTotalRow.push(grandTotalDeductions);
  if (showTax) {
    grandTotalRow.push(grandTotalTax);
  }
  grandTotalRow.push(grandNetSalary);

  const worksheetData = [
    ['UNIVERSITAS PESANTREN TINGGI DARUL ULUM'],
    [`VAKASI ${data.jobCategory.toUpperCase()}`],
    [`BULAN ${data.period.toUpperCase()}`],
    [],
    header1,
    header2,
    ...rows,
    [],
    grandTotalRow
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  const numEarnings = earningLabels.length;
  const numDeductions = deductionLabels.length;

  const merges = [
    // NO
    { s: { r: 4, c: 0 }, e: { r: 5, c: 0 } },
    // NAMA
    { s: { r: 4, c: 1 }, e: { r: 5, c: 1 } },
    // GAPOK
    { s: { r: 4, c: 2 }, e: { r: 5, c: 2 } },
    // VAKASI
    ...(numEarnings > 0 ? [{ s: { r: 4, c: 3 }, e: { r: 4, c: 3 + numEarnings - 1 } }] : []),
    // JUMLAH
    { s: { r: 4, c: 3 + numEarnings }, e: { r: 5, c: 3 + numEarnings } },
    // POTONGAN
    ...(numDeductions > 0 ? [{ s: { r: 4, c: 3 + numEarnings + 1 }, e: { r: 4, c: 3 + numEarnings + numDeductions } }] : []),
    // JUMLAH POTONGAN
    { s: { r: 4, c: 3 + numEarnings + numDeductions + 1 }, e: { r: 5, c: 3 + numEarnings + numDeductions + 1 } },
    // PAJAK (only present when someone is taxed)
    ...(showTax
      ? [{ s: { r: 4, c: 3 + numEarnings + numDeductions + 2 }, e: { r: 5, c: 3 + numEarnings + numDeductions + 2 } }]
      : []),
    // GAJI BERSIH
    {
      s: { r: 4, c: 3 + numEarnings + numDeductions + 2 + (showTax ? 1 : 0) },
      e: { r: 5, c: 3 + numEarnings + numDeductions + 2 + (showTax ? 1 : 0) },
    }
  ];
  worksheet['!merges'] = merges;

  // Widths
  const colWidths = [
    { wch: 6 }, // NO
    { wch: 30 }, // NAMA
    { wch: 15 }, // GAPOK
    ...Array(numEarnings).fill({ wch: 15 }), // Vakasi categories
    { wch: 15 }, // JUMLAH
    ...Array(numDeductions).fill({ wch: 15 }), // Potongan categories
    { wch: 18 }, // JUMLAH POTONGAN
    ...(showTax ? [{ wch: 18 }] : []), // PAJAK
    { wch: 18 } // GAJI BERSIH
  ];
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Legalitas Pimpinan');

  const filename = `Legalitas_Pimpinan_${data.jobCategory}_${data.period.replace(/\s+/g, '_')}.xlsx`;
  XLSX.writeFile(workbook, filename);
}
