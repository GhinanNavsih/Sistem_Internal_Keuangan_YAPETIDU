import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface KegiatanLoyalisWorker {
  name: string;
  payout: number;
}

export interface KegiatanLoyalisGroup {
  eventName: string;
  workers: KegiatanLoyalisWorker[];
  subtotal: number;
}

export interface KegiatanLoyalisData {
  department: string;
  period: string; // e.g. "MEI 2026"
  groups: KegiatanLoyalisGroup[];
  grandTotal: number;
}

export function generateKegiatanLoyalisPdf(data: KegiatanLoyalisData, saveToFile = true): jsPDF {
  // A4 paper dimensions (210x297mm) portrait
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const formatIDR = (amount: number): string => {
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Add logos at top left
  doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 15, 10, 22, 22);
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 40, 10, 22, 22);

  // Header text (shifted right to accommodate logos)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 67, 14);
  doc.setFontSize(11);
  doc.text('LAPORAN RINCIAN KEGIATAN PEGAWAI', 67, 20);
  doc.setFontSize(10);
  doc.text(`UNIT KERJA: ${data.department.toUpperCase()}`, 67, 26);
  doc.text(`PERIODE: ${data.period.toUpperCase()}`, 67, 32);

  // Compile table rows
  const tableRows: any[] = [];
  let runningNo = 1;

  data.groups.forEach(group => {
    group.workers.forEach((worker, idx) => {
      tableRows.push([
        runningNo.toString(),
        idx === 0 ? group.eventName : '',
        worker.name,
        formatIDR(worker.payout),
        '',
      ]);
      runningNo++;
    });

    // Subtotal row for this activity group
    tableRows.push([
      {
        content: `SUBTOTAL: ${group.eventName}`,
        colSpan: 4,
        styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [238, 242, 255] },
      },
      {
        content: formatIDR(group.subtotal),
        styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [238, 242, 255] },
      },
    ]);
  });

  // Grand Total row at the very bottom
  tableRows.push([
    {
      content: 'TOTAL SELURUHNYA',
      colSpan: 4,
      styles: { fontStyle: 'bold' as const, halign: 'center' as const, fillColor: [224, 231, 255] },
    },
    {
      content: formatIDR(data.grandTotal),
      styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [224, 231, 255] },
    },
  ]);

  const marginSide = 15;
  const totalTableWidth = pageWidth - 2 * marginSide; // 180mm

  autoTable(doc, {
    startY: 38,
    margin: { left: marginSide, right: marginSide },
    head: [
      [
        { content: 'NO.', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'NAMA KEGIATAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'NAMA PEGAWAI', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'PENDAPATAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'SUBTOTAL', styles: { halign: 'center' as const, valign: 'middle' as const } },
      ],
    ],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [79, 70, 229], // Premium Indigo
      textColor: [255, 255, 255], // White text
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
      cellPadding: 2.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
    },
    tableWidth: totalTableWidth,
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' as const, fontSize: 9 },
      1: { cellWidth: 55, halign: 'left' as const },
      2: { cellWidth: 55, halign: 'left' as const },
      3: { cellWidth: 30, halign: 'right' as const },
      4: { cellWidth: 30, halign: 'right' as const },
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
    const filename = `Laporan_Rincian_Kegiatan_${data.department.replace(/\s+/g, '_')}_${data.period.replace(/\s+/g, '_')}.pdf`;
    doc.save(filename);
  }

  return doc;
}
