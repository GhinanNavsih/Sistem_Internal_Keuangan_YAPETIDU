import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface VakasiLainLainRow {
  noUrut: number;
  name: string;
  position: string;
  tStruktural: number;
  vakasiTambahan: number;
  jumlah: number;
}

export interface VakasiLainLainData {
  department: string;
  period: string; // e.g. "MEI 2026"
  rows: VakasiLainLainRow[];
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
  let totalVakasiTambahan = 0;
  let totalJumlah = 0;

  data.rows.forEach(row => {
    totalTStruktural += row.tStruktural;
    totalVakasiTambahan += row.vakasiTambahan;
    totalJumlah += row.jumlah;
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

  // Table setup
  autoTable(doc, {
    startY: 37,
    margin: { left: 10, right: 10 },
    head: [
      [
        { content: 'NO.\nURUT', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'NAMA', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'JABATAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'TUNJANGAN\nSTRUKTURAL', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'VAKASI\nTAMBAHAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'JUMLAH', styles: { halign: 'center' as const, valign: 'middle' as const } }
      ]
    ],
    body: [
      ...data.rows.map(row => [
        row.noUrut.toString(),
        row.name,
        row.position,
        formatValue(row.tStruktural),
        formatValue(row.vakasiTambahan),
        formatIDR(row.jumlah)
      ]),
      [
        { content: 'JUMLAH', colSpan: 3, styles: { halign: 'center' as const, fontStyle: 'bold' as const } },
        { content: totalTStruktural > 0 ? formatIDR(totalTStruktural) : '', styles: { fontStyle: 'bold' as const } },
        { content: totalVakasiTambahan > 0 ? formatIDR(totalVakasiTambahan) : '', styles: { fontStyle: 'bold' as const } },
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
    columnStyles: {
      0: { cellWidth: 15, halign: 'center' as const, fontSize: 8 },  // NO. URUT
      1: { cellWidth: 80, halign: 'left' as const },                 // NAMA
      2: { cellWidth: 80, halign: 'left' as const },                 // JABATAN
      3: { cellWidth: 45, halign: 'right' as const, fontSize: 8 },   // T. STRUKTURAL
      4: { cellWidth: 45, halign: 'right' as const, fontSize: 8 },   // VAKASI TAMBAHAN
      5: { cellWidth: 45, halign: 'right' as const, fontStyle: 'bold', fontSize: 8 }, // JUMLAH
    }
  });

  // Signatures block
  const finalY = (doc as any).lastAutoTable.finalY;
  const signatureSpaceNeeded = 45;
  let signatureY = finalY + 15;

  if (signatureY + signatureSpaceNeeded > pageHeight - 15) {
    doc.addPage();
    signatureY = 25;
  }

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');

  // Left signature: Rektor
  doc.text('Rektor', 10, signatureY);
  doc.setFont('helvetica', 'bold');
  doc.text("Dr. dr. H. M. ZULFIKAR AS'AD, MMR", 10, signatureY + 30);

  // Right signature: Wakil Rektor with Date
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const month = monthNames[today.getMonth()];
  const year = today.getFullYear();
  const dateStr = `Jombang, ${day} ${month} ${year}`;

  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, pageWidth - 10, signatureY - 5, { align: 'right' });
  doc.text('Wakil Rektor Bidang SDM, Keuangan dan Umum', pageWidth - 10, signatureY, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.text('Dr. Hj. Uswatun Qoyyimah, SS., M. Ed., Ph.D', pageWidth - 10, signatureY + 30, { align: 'right' });

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
