import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

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
  if (!dept) return 6;
  const clean = dept.trim().toUpperCase();
  if (clean.includes('REKTORAT')) return 0;
  if (clean.includes('PASCASARJANA') || clean.includes('PASCA')) return 1;
  if (clean.includes('AGAMA ISLAM') || clean.includes('FAI')) return 2;
  if (clean.includes('BISNIS') || clean.includes('FEB') || clean.includes('FBS') || clean.includes('FIP') || clean.includes('FBBP')) return 3;
  if (clean.includes('SAINS') || clean.includes('TEKNOLOGI') || clean.includes('FST') || clean.includes('FT') || clean.includes('FSP')) return 4;
  if (clean.includes('KESEHATAN') || clean.includes('KESH') || clean.includes('FIK')) return 5;
  return 6;
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

export function generateKebutuhanDanaGajiPdf(data: KebutuhanReportData): void {
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

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [216, 330], // Folio
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  const formatIDR = (amount: number): string => {
    if (amount === 0) return '-';
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Kop Surat (Header Logos and Text)
  doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 12, 10, 18, 18);
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 32, 10, 18, 18);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 55, 14);
  doc.setFontSize(12);
  doc.text('REKAPITULASI KEBUTUHAN DANA GAJI PEGAWAI LOYALIS', 55, 19);
  doc.setFontSize(10);
  doc.text(`BULAN: ${data.period.toUpperCase()}`, 55, 24);

  // AutoTable Data compilation
  const head = [
    [
      { content: 'NO', styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'URAIAN', styles: { halign: 'left' as const, valign: 'middle' as const } },
      ...SATKERS.map(s => ({ content: s, styles: { halign: 'right' as const, valign: 'middle' as const } })),
      { content: 'JUMLAH', styles: { halign: 'right' as const, valign: 'middle' as const } }
    ]
  ];

  const body: any[] = [];

  // Section helper
  const addSectionHeader = (title: string) => {
    body.push([
      { content: '', styles: { fillColor: [245, 247, 250], fontStyle: 'bold' } },
      { content: title, styles: { fillColor: [245, 247, 250], fontStyle: 'bold' } },
      ...Array(8).fill({ content: '', styles: { fillColor: [245, 247, 250] } })
    ]);
  };

  // 1. GAJI UTAMA Section
  addSectionHeader('GAJI UTAMA');
  GAJI_UTAMA_ROWS.forEach((rowDef, idx) => {
    const rowValues = mainSalaryValues[idx];
    const rowTotal = rowValues.reduce((sum, v) => sum + v, 0);
    body.push([
      { content: (idx + 1).toString(), styles: { halign: 'center' as const } },
      { content: rowDef.name },
      ...rowValues.map(v => ({ content: formatIDR(v), styles: { halign: 'right' as const } })),
      { content: formatIDR(rowTotal), styles: { halign: 'right' as const, fontStyle: 'bold' } }
    ]);
  });

  // Jumlah Gaji Utama summary row
  const totalGajiUtamaVal = gajiUtamaTotals.reduce((sum, v) => sum + v, 0);
  body.push([
    { content: '', styles: { fillColor: [226, 239, 218], fontStyle: 'bold' } },
    { content: 'JUMLAH GAJI UTAMA', styles: { fillColor: [226, 239, 218], fontStyle: 'bold' } },
    ...gajiUtamaTotals.map(v => ({ content: formatIDR(v), styles: { fillColor: [226, 239, 218], halign: 'right' as const, fontStyle: 'bold' } })),
    { content: formatIDR(totalGajiUtamaVal), styles: { fillColor: [226, 239, 218], halign: 'right' as const, fontStyle: 'bold' } }
  ]);

  // 2. TUNJANGAN JABATAN
  const totalTunjanganJabatanVal = tunjanganJabatanValues.reduce((sum, v) => sum + v, 0);
  body.push([
    { content: '', styles: { fontStyle: 'bold' } },
    { content: 'TUNJANGAN JABATAN', styles: { fontStyle: 'bold' } },
    ...tunjanganJabatanValues.map(v => ({ content: formatIDR(v), styles: { halign: 'right' as const, fontStyle: 'bold' } })),
    { content: formatIDR(totalTunjanganJabatanVal), styles: { halign: 'right' as const, fontStyle: 'bold' } }
  ]);

  // 3. VAKASI LAIN-LAIN Section
  addSectionHeader('VAKASI LAIN-LAIN');
  sortedOtherEarningLabels.forEach((label, idx) => {
    const rowValues = otherEarningValues[idx];
    const rowTotal = rowValues.reduce((sum, v) => sum + v, 0);
    body.push([
      { content: (idx + 1).toString(), styles: { halign: 'center' as const } },
      { content: label.toUpperCase() },
      ...rowValues.map(v => ({ content: formatIDR(v), styles: { halign: 'right' as const } })),
      { content: formatIDR(rowTotal), styles: { halign: 'right' as const, fontStyle: 'bold' } }
    ]);
  });

  // Jumlah Gaji Tambahan summary row
  const totalGajiTambahanVal = gajiTambahanTotals.reduce((sum, v) => sum + v, 0);
  body.push([
    { content: '', styles: { fillColor: [226, 239, 218], fontStyle: 'bold' } },
    { content: 'JUMLAH GAJI TAMBAHAN', styles: { fillColor: [226, 239, 218], fontStyle: 'bold' } },
    ...gajiTambahanTotals.map(v => ({ content: formatIDR(v), styles: { fillColor: [226, 239, 218], halign: 'right' as const, fontStyle: 'bold' } })),
    { content: formatIDR(totalGajiTambahanVal), styles: { fillColor: [226, 239, 218], halign: 'right' as const, fontStyle: 'bold' } }
  ]);

  // 4. JUMLAH GAJI TOTAL summary row
  const totalGajiTotalVal = gajiTotalValues.reduce((sum, v) => sum + v, 0);
  body.push([
    { content: '', styles: { fillColor: [252, 243, 207], fontStyle: 'bold' } },
    { content: 'JUMLAH GAJI TOTAL', styles: { fillColor: [252, 243, 207], fontStyle: 'bold' } },
    ...gajiTotalValues.map(v => ({ content: formatIDR(v), styles: { fillColor: [252, 243, 207], halign: 'right' as const, fontStyle: 'bold' } })),
    { content: formatIDR(totalGajiTotalVal), styles: { fillColor: [252, 243, 207], halign: 'right' as const, fontStyle: 'bold' } }
  ]);

  // 5. POTONGAN Section
  addSectionHeader('POTONGAN');
  let potNo = 1;
  POTONGAN_ROWS.forEach((rowDef, idx) => {
    const rowValues = standardDeductionValues[idx];
    const rowTotal = rowValues.reduce((sum, v) => sum + v, 0);
    body.push([
      { content: (potNo++).toString(), styles: { halign: 'center' as const } },
      { content: rowDef.name },
      ...rowValues.map(v => ({ content: formatIDR(v), styles: { halign: 'right' as const } })),
      { content: formatIDR(rowTotal), styles: { halign: 'right' as const, fontStyle: 'bold' } }
    ]);
  });

  sortedOtherDeductionLabels.forEach((label, idx) => {
    const rowValues = otherDeductionValues[idx];
    const rowTotal = rowValues.reduce((sum, v) => sum + v, 0);
    body.push([
      { content: (potNo++).toString(), styles: { halign: 'center' as const } },
      { content: label.toUpperCase() },
      ...rowValues.map(v => ({ content: formatIDR(v), styles: { halign: 'right' as const } })),
      { content: formatIDR(rowTotal), styles: { halign: 'right' as const, fontStyle: 'bold' } }
    ]);
  });

  // Potongan Gaji summary row
  const totalPotonganVal = potonganTotals.reduce((sum, v) => sum + v, 0);
  body.push([
    { content: '', styles: { fillColor: [249, 231, 233], fontStyle: 'bold' } }, // light gray/red tint
    { content: 'POTONGAN GAJI', styles: { fillColor: [249, 231, 233], fontStyle: 'bold' } },
    ...potonganTotals.map(v => ({ content: formatIDR(v), styles: { fillColor: [249, 231, 233], halign: 'right' as const, fontStyle: 'bold' } })),
    { content: formatIDR(totalPotonganVal), styles: { fillColor: [249, 231, 233], halign: 'right' as const, fontStyle: 'bold' } }
  ]);

  // 6. JUMLAH GAJI BERSIH summary row
  const totalGajiBersihVal = gajiBersihValues.reduce((sum, v) => sum + v, 0);
  body.push([
    { content: '', styles: { fillColor: [214, 234, 248], fontStyle: 'bold' } },
    { content: 'JUMLAH GAJI BERSIH', styles: { fillColor: [214, 234, 248], fontStyle: 'bold' } },
    ...gajiBersihValues.map(v => ({ content: formatIDR(v), styles: { fillColor: [214, 234, 248], halign: 'right' as const, fontStyle: 'bold' } })),
    { content: formatIDR(totalGajiBersihVal), styles: { fillColor: [214, 234, 248], halign: 'right' as const, fontStyle: 'bold' } }
  ]);

  // 7. DITERIMAKAN BANK / TUNAI rows
  body.push([
    { content: '', styles: { fontStyle: 'bold' } },
    { content: 'DITERIMAKAN BANK', styles: { fontStyle: 'bold' } },
    ...gajiBersihValues.map(v => ({ content: formatIDR(v), styles: { halign: 'right' as const, fontStyle: 'bold' } })),
    { content: formatIDR(totalGajiBersihVal), styles: { halign: 'right' as const, fontStyle: 'bold' } }
  ]);

  body.push([
    { content: '', styles: { fontStyle: 'bold' } },
    { content: 'DITERIMAKAN TUNAI', styles: { fontStyle: 'bold' } },
    ...Array(8).fill({ content: '-', styles: { halign: 'right' as const, fontStyle: 'bold' } })
  ]);

  autoTable(doc, {
    startY: 32,
    margin: { left: 8, right: 8 },
    head: head as any,
    body: body as any,
    theme: 'grid',
    headStyles: {
      fillColor: [230, 235, 240],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [100, 100, 100],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    styles: {
      fontSize: 7,
      cellPadding: 1.2,
      lineColor: [150, 150, 150],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 50 },
      2: { cellWidth: 28 },
      3: { cellWidth: 28 },
      4: { cellWidth: 28 },
      5: { cellWidth: 32 },
      6: { cellWidth: 32 },
      7: { cellWidth: 28 },
      8: { cellWidth: 28 },
      9: { cellWidth: 32 },
    },
  });

  const filename = `Kebutuhan_Dana_Gaji_${data.period.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}
