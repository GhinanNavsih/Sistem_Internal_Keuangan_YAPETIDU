import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface VakasiLainLainRow {
  noUrut: number;
  name: string;
  position: string;
  tStruktural: number;
  tInstruksional: number;
  vakasiTambahan: number;
  endOfMonthPays: number[]; // Array of pays for each event in the order of endOfMonthEvents prop
  jumlah: number;
}

export interface VakasiLainLainData {
  department: string;
  period: string; // e.g. "MEI 2026"
  rows: VakasiLainLainRow[];
  endOfMonthEvents: string[]; // List of dynamic column names
}

export function generateVakasiLainLainPdf(data: VakasiLainLainData, saveToFile = true): jsPDF {
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

  // Sum totals
  let totalTStruktural = 0;
  let totalTInstruksional = 0;
  let totalVakasiTambahan = 0;
  let totalJumlah = 0;
  const totalEndOfMonthPays = Array(data.endOfMonthEvents.length).fill(0);

  data.rows.forEach(row => {
    totalTStruktural += row.tStruktural;
    totalTInstruksional += row.tInstruksional;
    totalVakasiTambahan += row.vakasiTambahan;
    totalJumlah += row.jumlah;
    row.endOfMonthPays.forEach((pay, idx) => {
      totalEndOfMonthPays[idx] += pay;
    });
  });

  // Add logos at top left
  doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 10, 8, 18, 18);
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 30, 8, 18, 18);

  // Header text (shifted right to accommodate logos)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 53, 11);
  doc.text('VAKASI LAIN-LAIN', 53, 17);
  doc.text(data.department.toUpperCase(), 53, 23);
  doc.text(`BULAN  ${data.period.toUpperCase()}`, 53, 29);

  // Header row setup
  const headerRow = [
    { content: 'NO.', styles: { halign: 'center' as const, valign: 'middle' as const } },
    { content: 'NAMA', styles: { halign: 'center' as const, valign: 'middle' as const } },
    { content: 'TUNJANGAN\nSTRUKTURAL', styles: { halign: 'center' as const, valign: 'middle' as const } },
    { content: 'TUNJANGAN\nINSTRUKSIONAL', styles: { halign: 'center' as const, valign: 'middle' as const } },
    { content: 'VAKASI\nTAMBAHAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
    // Dynamic end-of-month headers
    ...data.endOfMonthEvents.map(evtName => ({
      content: evtName.substring(0, 15).toUpperCase(),
      styles: { halign: 'center' as const, valign: 'middle' as const }
    })),
    { content: 'JUMLAH', styles: { halign: 'center' as const, valign: 'middle' as const } }
  ];

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

  // Remaining space divided equally among all remaining columns (T. Struktural, T. Instruksional, Vakasi Tambahan, dynamic event columns, and JUMLAH)
  const numEvents = data.endOfMonthEvents.length;
  const equalColWidth = (totalTableWidth - 10 - nameWidth) / (4 + numEvents);

  const columnStyles: { [key: number]: any } = {
    0: { cellWidth: 10, halign: 'center' as const, fontSize: 8 },
    1: { cellWidth: nameWidth, halign: 'left' as const }
  };

  columnStyles[2] = { cellWidth: equalColWidth, halign: 'right' as const, fontSize: 7.5 };
  columnStyles[3] = { cellWidth: equalColWidth, halign: 'right' as const, fontSize: 7.5 };
  columnStyles[4] = { cellWidth: equalColWidth, halign: 'right' as const, fontSize: 7.5 };

  for (let i = 0; i < numEvents; i++) {
    columnStyles[5 + i] = { cellWidth: equalColWidth, halign: 'right' as const, fontSize: 7.5 };
  }

  columnStyles[5 + numEvents] = { cellWidth: equalColWidth, halign: 'right' as const, fontStyle: 'bold', fontSize: 8 };

  // Table setup
  autoTable(doc, {
    startY: 37,
    margin: { left: marginSide, right: marginSide },
    head: [headerRow],
    body: [
      ...data.rows.map(row => [
        row.noUrut.toString(),
        row.name,
        formatValue(row.tStruktural),
        formatValue(row.tInstruksional),
        formatValue(row.vakasiTambahan),
        ...row.endOfMonthPays.map(amt => formatValue(amt)),
        formatIDR(row.jumlah)
      ]),
      [
        { content: 'JUMLAH', colSpan: 2, styles: { halign: 'center' as const, fontStyle: 'bold' as const } },
        { content: totalTStruktural > 0 ? formatIDR(totalTStruktural) : '', styles: { fontStyle: 'bold' as const } },
        { content: totalTInstruksional > 0 ? formatIDR(totalTInstruksional) : '', styles: { fontStyle: 'bold' as const } },
        { content: totalVakasiTambahan > 0 ? formatIDR(totalVakasiTambahan) : '', styles: { fontStyle: 'bold' as const } },
        ...totalEndOfMonthPays.map(amt => amt > 0 ? formatIDR(amt) : ''),
        { content: formatIDR(totalJumlah), styles: { fontStyle: 'bold' as const } }
      ]
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [225, 225, 225],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 7,
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
    columnStyles
  });

  // Signatures block removed

  // Add Page Numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(String(i), pageWidth - 10, pageHeight - 10, { align: 'right' });
  }

  if (saveToFile) {
    const filename = `Laporan_Vakasi_Lain_Lain_${data.department.replace(/\s+/g, '_')}_${data.period.replace(/\s+/g, '_')}.pdf`;
    doc.save(filename);
  }

  return doc;
}
