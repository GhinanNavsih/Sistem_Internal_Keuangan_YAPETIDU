import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface RekapCategoryData {
  categoryName: string;
  totalEarnings: number; // JUMLAH
  deductions: Record<string, number>; // Maps sanitized deduction label to amount
  totalDeductions: number; // JML POTONGAN
  netSalary: number; // GAJI BERSIH
}

export interface RekapGajiPekaryaData {
  period: string; // e.g. "APRIL 2026"
  categories: RekapCategoryData[];
  deductionKeys: string[]; // Ordered list of deduction column headers (sanitized)
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

  const head = [
    [
      { content: 'NO', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'URAIAN', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'JUMLAH', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'POTONGAN', colSpan: data.deductionKeys.length + 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'GAJI BERSIH', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
    ],
    [
      ...data.deductionKeys.map(key => ({
        content: key.toUpperCase(),
        styles: { halign: 'center' as const, valign: 'middle' as const },
      })),
      { content: 'JML POTONGAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
    ],
  ];

  const body: any[] = [];

  // Data Rows
  data.categories.forEach((cat, idx) => {
    const row: any[] = [
      { content: (idx + 1).toString(), styles: { halign: 'center' as const } },
      { content: cat.categoryName },
      { content: formatIDR(cat.totalEarnings), styles: { halign: 'right' as const } },
    ];

    // Add deductions
    data.deductionKeys.forEach(key => {
      row.push({ content: formatIDR(cat.deductions[key] || 0), styles: { halign: 'right' as const } });
    });

    // Add totalDeductions and netSalary
    row.push({ content: formatIDR(cat.totalDeductions), styles: { halign: 'right' as const } });
    row.push({ content: formatIDR(cat.netSalary), styles: { halign: 'right' as const } });

    body.push(row);
  });

  // Grand Total Row
  const grandTotalRow: any[] = [
    { content: '', styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255] } },
    { content: 'JUMLAH', styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255] } },
    { content: formatIDR(grandTotal.totalEarnings), styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const } },
  ];

  data.deductionKeys.forEach(key => {
    grandTotalRow.push({
      content: formatIDR(grandTotal.deductions[key] || 0),
      styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const },
    });
  });

  grandTotalRow.push({
    content: formatIDR(grandTotal.totalDeductions),
    styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const },
  });
  grandTotalRow.push({
    content: formatIDR(grandTotal.netSalary),
    styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'right' as const },
  });

  body.push(grandTotalRow);

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
