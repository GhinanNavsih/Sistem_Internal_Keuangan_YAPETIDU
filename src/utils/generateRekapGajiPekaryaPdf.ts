import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface RekapCategoryData {
  categoryName: string;
  totalEarnings: number; // JUMLAH
  bpjs: number;
  kopRochmad: number;
  kopUnipdu: number;
  tunai: number;
  danaSosial: number;
  totalDeductions: number; // JML POTONGAN
  netSalary: number; // GAJI BERSIH
}

export interface RekapGajiPekaryaData {
  period: string; // e.g. "APRIL 2026"
  categories: RekapCategoryData[];
}

export function generateRekapGajiPekaryaPdf(data: RekapGajiPekaryaData): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  const formatIDR = (amount: number): string => {
    if (amount === 0) return '0';
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('REKAPITULASI GAJI PEKARYA', 14, y);
  doc.text(`BULAN ${data.period.toUpperCase()}`, pageWidth - 14, y, { align: 'right' });
  y += 10;

  // Calculate Grand Totals
  const grandTotal = data.categories.reduce(
    (acc, cat) => {
      acc.totalEarnings += cat.totalEarnings;
      acc.bpjs += cat.bpjs;
      acc.kopRochmad += cat.kopRochmad;
      acc.kopUnipdu += cat.kopUnipdu;
      acc.tunai += cat.tunai;
      acc.danaSosial += cat.danaSosial;
      acc.totalDeductions += cat.totalDeductions;
      acc.netSalary += cat.netSalary;
      return acc;
    },
    {
      totalEarnings: 0,
      bpjs: 0,
      kopRochmad: 0,
      kopUnipdu: 0,
      tunai: 0,
      danaSosial: 0,
      totalDeductions: 0,
      netSalary: 0,
    }
  );

  const head = [
    [
      { content: 'NO', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'URAIAN', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'JUMLAH', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'POTONGAN', colSpan: 6, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'GAJI BERSIH', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
    ],
    [
      { content: 'BPJS', styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'KOP ROCHMAD', styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'KOP. REJOSO GEMILANG', styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'TUNAI', styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'DANA SOSIAL', styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'JML POTONGAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
    ],
  ];

  const body = [];

  // Data Rows
  data.categories.forEach((cat, idx) => {
    body.push([
      { content: (idx + 1).toString(), styles: { halign: 'center' as const } },
      { content: cat.categoryName },
      { content: formatIDR(cat.totalEarnings), styles: { halign: 'right' as const } },
      { content: formatIDR(cat.bpjs), styles: { halign: 'right' as const } },
      { content: formatIDR(cat.kopRochmad), styles: { halign: 'right' as const } },
      { content: formatIDR(cat.kopUnipdu), styles: { halign: 'right' as const } },
      { content: formatIDR(cat.tunai), styles: { halign: 'right' as const } },
      { content: formatIDR(cat.danaSosial), styles: { halign: 'right' as const } },
      { content: formatIDR(cat.totalDeductions), styles: { halign: 'right' as const } },
      { content: formatIDR(cat.netSalary), styles: { halign: 'right' as const } },
    ]);
  });

  // Grand Total Row (Now at the bottom with mauve background)
  body.push([
    { content: '', styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255] } },
    { content: 'JUMLAH', styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255] } },
    { content: formatIDR(grandTotal.totalEarnings), styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const } },
    { content: formatIDR(grandTotal.bpjs), styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const } },
    { content: formatIDR(grandTotal.kopRochmad), styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const } },
    { content: formatIDR(grandTotal.kopUnipdu), styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const } },
    { content: formatIDR(grandTotal.tunai), styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const } },
    { content: formatIDR(grandTotal.danaSosial), styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const } },
    { content: formatIDR(grandTotal.totalDeductions), styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const } },
    { content: formatIDR(grandTotal.netSalary), styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const } },
  ]);

  autoTable(doc, {
    startY: y,
    head: head as any,
    body: body as any,
    theme: 'grid',
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 8,
    },
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 40 },
    },
  });

  const filename = `Rekap_Gaji_Pekarya_${data.period.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}
