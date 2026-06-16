import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface VakasiPimpinanStafRow {
  noUrut: number;
  name: string;
  position: string;
  gapok?: number;
  tunjKeluarga: number;
  tunjFungsional: number;
  kepangkatan?: number;
  tHariTua?: number;
  tBpjsTk?: number;
  tBpjsKes?: number;
  beras: number;
  presensiHours: number;
  presensiAmount: number;
  presenceBonus?: number;
  jumlah: number;
}

export interface VakasiPimpinanStafData {
  department: string;
  period: string; // e.g. "MEI 2026"
  rows: VakasiPimpinanStafRow[];
}

export function generateVakasiPimpinanStafPdf(data: VakasiPimpinanStafData, saveToFile = true): jsPDF {
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

  const formatNullableIDR = (val?: number, fallback = ''): string => {
    if (val === undefined || val === null) return fallback;
    return formatIDR(val);
  };

  const formatKepangkatan = (val?: number): string => {
    if (val === undefined || val === null) return '-';
    if (val === 0) return '';
    return formatIDR(val);
  };

  const formatHariTua = (val?: number): string => {
    if (val === undefined || val === null) return '-';
    return formatIDR(val);
  };

  const formatBpjsOrBonus = (val?: number): string => {
    if (val === undefined || val === null || val === 0) return '';
    return formatIDR(val);
  };

  // Add logos at top left
  doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 15, 8, 18, 18);
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 35, 8, 18, 18);

  // Header text (shifted right to accommodate logos)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 58, 13);
  doc.text('VAKASI PIMPINAN DAN STAF', 58, 19);
  doc.text(`BULAN  ${data.period.toUpperCase()}`, 58, 25);

  // Table setup
  autoTable(doc, {
    startY: 35,
    margin: { left: 15, right: 15 },
    head: [
      [
        { content: 'NO.\nURU\nT', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'NAMA', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'JABATAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'GAJI\nPOKOK', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'T.\nKELUARGA', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'T.\nFUNGSIONA\nL', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'KEPANGK\nATAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'T. HARI\nTUA', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'T. BPJS TK', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'T. BPJS\nKES', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'BERAS', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'PRESENSI', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'BONUS\nPRESENSI', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'JUMLAH', styles: { halign: 'center' as const, valign: 'middle' as const } }
      ]
    ],
    body: data.rows.map(row => [
      row.noUrut.toString(),
      row.name,
      row.position,
      formatNullableIDR(row.gapok),
      formatIDR(row.tunjKeluarga),
      formatIDR(row.tunjFungsional),
      formatKepangkatan(row.kepangkatan),
      formatHariTua(row.tHariTua),
      formatBpjsOrBonus(row.tBpjsTk),
      formatBpjsOrBonus(row.tBpjsKes),
      formatIDR(row.beras),
      row.presensiHours > 0 ? `${row.presensiHours} Jam X 1.650 = ${formatIDR(row.presensiAmount)}` : '0',
      formatBpjsOrBonus(row.presenceBonus),
      formatIDR(row.jumlah)
    ]),
    theme: 'grid',
    headStyles: {
      fillColor: [225, 225, 225], // Light grey background
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 6.5,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
      fontSize: 6.5,
    },
    styles: {
      fontSize: 6.5,
      cellPadding: 1,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
    },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' as const, fontSize: 8 },  // NO. URUT
      1: { cellWidth: 40, halign: 'left' as const },                 // NAMA
      2: { cellWidth: 35, halign: 'left' as const },                 // JABATAN
      3: { cellWidth: 18, halign: 'right' as const, fontSize: 7.5 },  // GAJI POKOK
      4: { cellWidth: 18, halign: 'right' as const, fontSize: 7.5 },  // T. KELUARGA
      5: { cellWidth: 20, halign: 'right' as const, fontSize: 7.5 },  // T. FUNGSIONAL
      6: { cellWidth: 18, halign: 'right' as const, fontSize: 7.5 },  // KEPANGKATAN
      7: { cellWidth: 18, halign: 'right' as const, fontSize: 7.5 },  // T. HARI TUA
      8: { cellWidth: 18, halign: 'right' as const, fontSize: 7.5 },  // T. BPJS TK
      9: { cellWidth: 18, halign: 'right' as const, fontSize: 7.5 },  // T. BPJS KES
      10: { cellWidth: 15, halign: 'right' as const, fontSize: 7.5 }, // BERAS
      11: { cellWidth: 42, halign: 'center' as const },               // PRESENSI (Contains spacing)
      12: { cellWidth: 18, halign: 'right' as const, fontSize: 7.5 }, // BONUS PRESENSI
      13: { cellWidth: 20, halign: 'right' as const, fontStyle: 'bold', fontSize: 8 }, // JUMLAH
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
    const filename = `Laporan_Vakasi_Pimpinan_Staf_${data.department.replace(/\s+/g, '_')}_${data.period.replace(/\s+/g, '_')}.pdf`;
    doc.save(filename);
  }

  return doc;
}
