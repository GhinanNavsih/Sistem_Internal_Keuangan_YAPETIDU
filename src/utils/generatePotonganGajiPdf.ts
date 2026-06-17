import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface PotonganGajiRow {
  noUrut: number;
  name: string;
  kopRochmad: number;
  bpjs: number;
  tht: number;
  tabungan: number;
  zis: number;
  revisiGaji: number;
  pinlu: number;
  pinjamanKopUnipdu: number;
  potPresensi: number;
  potBonusPresensi: number;
  iuranWajibKopUnipdu: number;
  jumlah: number;
}

export interface PotonganGajiData {
  department: string;
  period: string; // e.g. "MEI 2026"
  rows: PotonganGajiRow[];
}

interface DeductionColDef {
  key: keyof Omit<PotonganGajiRow, 'noUrut' | 'name' | 'jumlah'>;
  header: string;
  width: number;
}

const ALL_DEDUCTION_COLS: DeductionColDef[] = [
  { key: 'kopRochmad', header: 'KOP.\nROCHMAD', width: 18 },
  { key: 'bpjs', header: 'BPJS', width: 18 },
  { key: 'tht', header: 'THT BNI\nSIMPONI', width: 21 },
  { key: 'tabungan', header: 'TABUNGAN', width: 18 },
  { key: 'zis', header: 'ZAKAT\nINFAQ\nSHODAQOH', width: 18 },
  { key: 'revisiGaji', header: 'REVISI\nGAJI', width: 18 },
  { key: 'pinlu', header: 'PINLU/\nTAGIHAN', width: 18 },
  { key: 'pinjamanKopUnipdu', header: 'PINJAMAN\nKOP.\nUNIPDU', width: 21 },
  { key: 'potPresensi', header: 'POTONGAN\nPRESENSI', width: 21 },
  { key: 'potBonusPresensi', header: 'POT. BONUS\nPRESENSI', width: 21 },
  { key: 'iuranWajibKopUnipdu', header: 'IURAN\nWAJIB KOP.\nUNIPDU', width: 21 },
];

export function generatePotonganGajiPdf(data: PotonganGajiData, saveToFile = true): jsPDF {
  // Folio paper dimensions (216x330mm)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [216, 330],
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const formatIDR = (amount: number): string => {
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatValue = (val: number): string => {
    if (val === 0) return '';
    return formatIDR(val);
  };

  // Determine visible columns: only columns where at least one row has a value > 0
  const visibleCols = ALL_DEDUCTION_COLS.filter(col => 
    data.rows.some(row => (row[col.key] as number) > 0)
  );

  // Measure text width of the longest name in data.rows to size NAMA column dynamically
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5); // body text font size
  let maxNameWidth = 0;
  data.rows.forEach(row => {
    const w = doc.getTextWidth(row.name);
    if (w > maxNameWidth) {
      maxNameWidth = w;
    }
  });

  // Calculate NAMA column width (longest name + 5mm padding, bounded between 35mm and 95mm)
  const nameWidth = Math.max(35, Math.min(95, maxNameWidth + 5));

  // Determine width distribution
  const totalTableWidth = 300; // Landscape Folio table width
  const marginSide = Math.max(10, (pageWidth - totalTableWidth) / 2);

  // Remaining space divided equally among visible deduction columns + JUMLAH column
  const numVisible = visibleCols.length;
  const equalColWidth = (totalTableWidth - 10 - nameWidth) / (numVisible + 1);

  // Compile Header Row
  const headerRow = [
    { content: 'NO.', styles: { halign: 'center' as const, valign: 'middle' as const } },
    { content: 'NAMA', styles: { halign: 'center' as const, valign: 'middle' as const } },
    ...visibleCols.map(col => ({
      content: col.header,
      styles: { halign: 'center' as const, valign: 'middle' as const }
    })),
    { content: 'JUMLAH', styles: { halign: 'center' as const, valign: 'middle' as const } },
  ];

  // Compile Body Rows
  const bodyRows = data.rows.map(row => [
    row.noUrut.toString(),
    row.name,
    ...visibleCols.map(col => formatValue(row[col.key] as number)),
    formatIDR(row.jumlah),
  ]);

  // Compute Column-wise Totals and Grand Total
  const colTotals = visibleCols.reduce((acc, col) => {
    acc[col.key] = data.rows.reduce((sum, row) => sum + (row[col.key] as number), 0);
    return acc;
  }, {} as Record<string, number>);

  const grandTotal = data.rows.reduce((sum, row) => sum + row.jumlah, 0);

  // Compile Totals Row
  const totalsRow = [
    { content: 'JUMLAH', colSpan: 2, styles: { halign: 'center' as const, fontStyle: 'bold' as const } },
    ...visibleCols.map(col => ({
      content: colTotals[col.key] > 0 ? formatIDR(colTotals[col.key]) : '',
      styles: { fontStyle: 'bold' as const }
    })),
    { content: formatIDR(grandTotal), styles: { fontStyle: 'bold' as const } },
  ];

  // Set up Column Styles mapping dynamically
  const columnStyles: { [key: number]: any } = {
    0: { cellWidth: 10, halign: 'center' as const, fontSize: 8 },
    1: { cellWidth: nameWidth, halign: 'left' as const, fontSize: 7.5 }
  };

  visibleCols.forEach((col, idx) => {
    columnStyles[2 + idx] = { cellWidth: equalColWidth, halign: 'right' as const, fontSize: 7.5 };
  });

  columnStyles[2 + visibleCols.length] = {
    cellWidth: equalColWidth,
    halign: 'right' as const,
    fontStyle: 'bold',
    fontSize: 8,
  };

  // Add logos at top left
  doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 10, 8, 18, 18);
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 30, 8, 18, 18);

  // Header text (shifted right to accommodate logos)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 53, 11);
  doc.text('LAPORAN POTONGAN GAJI', 53, 17);
  doc.text(data.department.toUpperCase(), 53, 23);
  doc.text(`BULAN  ${data.period.toUpperCase()}`, 53, 29);

  // Table setup
  autoTable(doc, {
    startY: 37,
    margin: { left: marginSide, right: marginSide },
    head: [headerRow],
    body: [...bodyRows, totalsRow],
    theme: 'grid',
    headStyles: {
      fillColor: [225, 225, 225],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
      fontSize: 7.5,
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
    },
    tableWidth: totalTableWidth,
    columnStyles,
  });

  // Add Page Numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(String(i), pageWidth - 10, pageHeight - 10, { align: 'right' });
  }

  if (saveToFile) {
    const filename = `Laporan_Potongan_Gaji_${data.department.replace(/\s+/g, '_')}_${data.period.replace(/\s+/g, '_')}.pdf`;
    doc.save(filename);
  }

  return doc;
}
