import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface GabunganRow {
  noUrut: number;
  name: string;
  tunjanganJabatan: number;
  vakasiPimpinanStaf: number;
  vakasiLainLain: number;
  potonganGaji: number;
  gajiBersih: number;
}

export interface GabunganData {
  department: string;
  period: string; // e.g. "MEI 2026"
  rows: GabunganRow[];
}

export function generateGabunganPdf(data: GabunganData, saveToFile = true): jsPDF {
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
  let totalTunjanganJabatan = 0;
  let totalVakasiPimpinanStaf = 0;
  let totalVakasiLainLain = 0;
  let totalPotonganGaji = 0;
  let totalGajiBersih = 0;

  data.rows.forEach(row => {
    totalTunjanganJabatan += row.tunjanganJabatan;
    totalVakasiPimpinanStaf += row.vakasiPimpinanStaf;
    totalVakasiLainLain += row.vakasiLainLain;
    totalPotonganGaji += row.potonganGaji;
    totalGajiBersih += row.gajiBersih;
  });

  // Measure text width of the longest name in data.rows to size NAMA column dynamically
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5); // body text font size
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
  const marginSide = Math.max(15, (pageWidth - totalTableWidth) / 2);

  // Remaining space divided equally among the 5 summary columns
  const equalColWidth = (totalTableWidth - 10 - nameWidth) / 5;

  // Add logos at top left
  doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 15, 8, 18, 18);
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 35, 8, 18, 18);

  // Header text (shifted right to accommodate logos)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 58, 13);
  doc.text('LAPORAN GABUNGAN REKAPITULASI PAYROLL', 58, 19);
  doc.text(data.department.toUpperCase(), 58, 25);
  doc.text(`BULAN  ${data.period.toUpperCase()}`, 58, 31);

  // Table setup
  autoTable(doc, {
    startY: 39,
    margin: { left: marginSide, right: marginSide },
    head: [
      [
        { content: 'NO.', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'NAMA KARYAWAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'TUNJANGAN JABATAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'VAKASI PIMPINAN & STAF', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'VAKASI LAIN-LAIN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'POTONGAN GAJI', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'GAJI BERSIH', styles: { halign: 'center' as const, valign: 'middle' as const } },
      ],
    ],
    body: [
      ...data.rows.map(row => [
        row.noUrut.toString(),
        row.name,
        formatValue(row.tunjanganJabatan),
        formatValue(row.vakasiPimpinanStaf),
        formatValue(row.vakasiLainLain),
        formatValue(row.potonganGaji),
        formatIDR(row.gajiBersih),
      ]),
      [
        { content: 'JUMLAH', colSpan: 2, styles: { halign: 'center' as const, fontStyle: 'bold' as const } },
        { content: totalTunjanganJabatan > 0 ? formatIDR(totalTunjanganJabatan) : '', styles: { fontStyle: 'bold' as const } },
        { content: totalVakasiPimpinanStaf > 0 ? formatIDR(totalVakasiPimpinanStaf) : '', styles: { fontStyle: 'bold' as const } },
        { content: totalVakasiLainLain > 0 ? formatIDR(totalVakasiLainLain) : '', styles: { fontStyle: 'bold' as const } },
        { content: totalPotonganGaji > 0 ? formatIDR(totalPotonganGaji) : '', styles: { fontStyle: 'bold' as const } },
        { content: formatIDR(totalGajiBersih), styles: { fontStyle: 'bold' as const } },
      ],
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [225, 225, 225],
      textColor: [0, 0, 0],
      lineWidth: 0.15,
      lineColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.15,
      lineColor: [0, 0, 0],
      fontSize: 8.5,
    },
    styles: {
      fontSize: 8.5,
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
    },
    tableWidth: totalTableWidth,
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' as const, fontSize: 9 },
      1: { cellWidth: nameWidth, halign: 'left' as const },
      2: { cellWidth: equalColWidth, halign: 'right' as const },
      3: { cellWidth: equalColWidth, halign: 'right' as const },
      4: { cellWidth: equalColWidth, halign: 'right' as const },
      5: { cellWidth: equalColWidth, halign: 'right' as const },
      6: { cellWidth: equalColWidth, halign: 'right' as const, fontStyle: 'bold', fontSize: 9 },
    },
  });

  // Add Page Numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(String(i), pageWidth - 15, pageHeight - 10, { align: 'right' });
  }

  if (saveToFile) {
    const filename = `Laporan_Gabungan_Rekap_${data.department.replace(/\s+/g, '_')}_${data.period.replace(/\s+/g, '_')}.pdf`;
    doc.save(filename);
  }

  return doc;
}
