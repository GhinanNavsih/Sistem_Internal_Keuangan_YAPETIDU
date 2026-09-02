import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface RekapCategoryData {
  categoryName: string;
  totalEarnings: number; // JUMLAH
  deductions: Record<string, number>; // Maps sanitized deduction label to amount
  totalDeductions: number; // JML POTONGAN
  /** Income tax, its own column between Potongan and Gaji Bersih. */
  totalTax: number; // PAJAK
  netSalary: number; // GAJI BERSIH
}

export interface RekapGajiData {
  period: string; // e.g. "APRIL 2026"
  categories: RekapCategoryData[];
  deductionKeys: string[]; // Ordered list of deduction column headers (sanitized)
  isLoyalis?: boolean;
}

/** Fetch a public-folder image and return a base64 data-URL. */
async function loadImageAsDataUrl(publicPath: string): Promise<string> {
  const res = await fetch(publicPath);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function generateRekapGajiPdf(data: RekapGajiData): Promise<void> {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [216, 330], // Folio paper dimensions (216x330mm)
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  const formatIDR = (amount: number): string => {
    if (amount === 0) return '0';
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Load logos
  let logoYapetidu: string | null = null;
  let logoUnipdu: string | null = null;
  try {
    [logoYapetidu, logoUnipdu] = await Promise.all([
      loadImageAsDataUrl('/Logo YAPETIDU (Transparent bg).png'),
      loadImageAsDataUrl('/Logo UNIPDU.png'),
    ]);
  } catch {
    // Continue without logos
  }

  const hasLogos = !!(logoYapetidu && logoUnipdu);
  const marginLeft = hasLogos ? 48 : 5;
  const marginRight = 5;
  let y = hasLogos ? 16 : 15;

  if (logoYapetidu) {
    doc.addImage(logoYapetidu, 'PNG', 5, 8, 18, 18);
  }
  if (logoUnipdu) {
    doc.addImage(logoUnipdu, 'PNG', 25, 8, 18, 18);
  }

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  const title = data.isLoyalis ? 'REKAPITULASI GAJI LOYALIS' : 'REKAPITULASI GAJI PEKARYA';
  doc.text(title, marginLeft, y);
  doc.text(`BULAN ${data.period.toUpperCase()}`, pageWidth - marginRight, y, { align: 'right' });
  y += hasLogos ? 15 : 10;

  // Calculate Grand Totals
  const grandTotal = data.categories.reduce(
    (acc, cat) => {
      acc.totalEarnings += cat.totalEarnings;
      acc.totalDeductions += cat.totalDeductions;
      acc.totalTax += cat.totalTax || 0;
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
      totalTax: 0,
      netSalary: 0,
    }
  );

  // The tax column appears only when a category is actually taxed, so an
  // untaxed rekap keeps its existing layout.
  const showTax = data.categories.some(cat => (cat.totalTax || 0) > 0);

  const head = [
    [
      { content: 'NO', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'URAIAN', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'JUMLAH', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'POTONGAN', colSpan: data.deductionKeys.length + 1, styles: { halign: 'center' as const, valign: 'middle' as const } },
      ...(showTax
        ? [{ content: 'PAJAK', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } }]
        : []),
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
      { content: formatIDR(cat.totalEarnings), styles: { halign: 'center' as const } },
    ];

    // Add deductions
    data.deductionKeys.forEach(key => {
      row.push({ content: formatIDR(cat.deductions[key] || 0), styles: { halign: 'center' as const } });
    });

    // Add totalDeductions and netSalary
    row.push({ content: formatIDR(cat.totalDeductions), styles: { halign: 'center' as const } });
    if (showTax) {
      row.push({ content: formatIDR(cat.totalTax || 0), styles: { halign: 'center' as const } });
    }
    row.push({ content: formatIDR(cat.netSalary), styles: { halign: 'center' as const } });

    body.push(row);
  });

  // Grand Total Row
  const grandTotalRow: any[] = [
    { content: '', styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255] } },
    { content: 'JUMLAH', styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255] } },
    { content: formatIDR(grandTotal.totalEarnings), styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'center' as const } },
  ];

  data.deductionKeys.forEach(key => {
    grandTotalRow.push({
      content: formatIDR(grandTotal.deductions[key] || 0),
      styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'center' as const },
    });
  });

  grandTotalRow.push({
    content: formatIDR(grandTotal.totalDeductions),
    styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'center' as const },
  });
  if (showTax) {
    grandTotalRow.push({
      content: formatIDR(grandTotal.totalTax),
      styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'center' as const },
    });
  }
  grandTotalRow.push({
    content: formatIDR(grandTotal.netSalary),
    styles: { fillColor: [168, 85, 126], textColor: [255, 255, 255], halign: 'center' as const },
  });

  body.push(grandTotalRow);

  autoTable(doc, {
    startY: y,
    margin: { left: 5, right: 5 },
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

  const filename = `Rekap_Gaji_${data.isLoyalis ? 'Loyalis' : 'Pekarya'}_${data.period.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}
