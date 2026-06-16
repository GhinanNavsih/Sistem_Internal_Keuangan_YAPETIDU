import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface TunjanganJabatanRow {
  noUrut: number;
  name: string;
  positionName: string;
  amount: number;
}

export interface TunjanganJabatanData {
  department: string;
  period: string; // e.g. "MEI 2026"
  rows: TunjanganJabatanRow[];
}

export function generateTunjanganJabatanPdf(data: TunjanganJabatanData, saveToFile = true): jsPDF {
  // Folio paper dimensions (216x330mm)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [216, 330],
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const formatIDR = (amount: number): string => {
    if (amount === 0) return '0';
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Add logos at top left
  doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 15, 8, 18, 18);
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 35, 8, 18, 18);

  // Header text (shifted right to accommodate logos)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 58, 13);
  doc.text('TUNJANGAN JABATAN', 58, 19);
  doc.text(`BULAN  ${data.period.toUpperCase()}`, 58, 25);

  // Table setup
  autoTable(doc, {
    startY: 35,
    margin: { left: 15, right: 15 },
    head: [
      [
        { content: 'NO.\nURUT', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'NAMA', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'JABATAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'JUMLAH', styles: { halign: 'center' as const, valign: 'middle' as const } }
      ]
    ],
    body: data.rows.map(row => [
      row.noUrut.toString(),
      row.name,
      row.positionName,
      formatIDR(row.amount)
    ]),
    theme: 'grid',
    headStyles: {
      fillColor: [225, 225, 225], // Light grey background
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
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' as const, fontSize: 11 }, // NO. URUT
      1: { cellWidth: 100, halign: 'left' as const, fontSize: 11 },   // NAMA
      2: { cellWidth: 120, halign: 'left' as const, fontSize: 11 },   // JABATAN
      3: { cellWidth: 60, halign: 'right' as const, fontSize: 11 },   // JUMLAH
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
  doc.text('Rektor', 15, signatureY);
  doc.setFont('helvetica', 'bold');
  doc.text("Dr. dr. H. M. ZULFIKAR AS'AD, MMR", 15, signatureY + 30);

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
  doc.text(dateStr, pageWidth - 15, signatureY - 5, { align: 'right' });
  doc.text('Wakil Rektor Bidang SDM, Keuangan dan Umum', pageWidth - 15, signatureY, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.text('Dr. Hj. Uswatun Qoyyimah, SS., M. Ed., Ph.D', pageWidth - 15, signatureY + 30, { align: 'right' });

  // Add Page Numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(String(i), pageWidth - 15, pageHeight - 10, { align: 'right' });
  }

  if (saveToFile) {
    const filename = `Laporan_Tunjangan_Jabatan_${data.department.replace(/\s+/g, '_')}_${data.period.replace(/\s+/g, '_')}.pdf`;
    doc.save(filename);
  }

  return doc;
}
