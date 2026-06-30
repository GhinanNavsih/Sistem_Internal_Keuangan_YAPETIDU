import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface LoyalisEmployee {
  id: string;
  name: string;
  role: string;
  department: string;
}

export interface GenerateKegiatanLoyalisRecapPdfParams {
  period: string;
  existingEvents: any[];
  loyalisEmployees: LoyalisEmployee[];
}

export function generateKegiatanLoyalisRecapPdf({
  period,
  existingEvents,
  loyalisEmployees,
}: GenerateKegiatanLoyalisRecapPdfParams, saveToFile = true): jsPDF {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 297
  const pageHeight = doc.internal.pageSize.getHeight(); // 210

  const formatIDR = (amount: number): string => {
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Add logos at top left
  doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 15, 10, 22, 22);
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 40, 10, 22, 22);

  // Header text (shifted right)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 67, 14);
  doc.setFontSize(12);
  doc.text('REKAPITULASI LAPORAN RINCIAN KEGIATAN PEGAWAI LOYALIS', 67, 20);
  doc.setFontSize(11);
  doc.text(`PERIODE: ${period.toUpperCase()}`, 67, 26);

  // Helper to map DB department to target department column index
  const getDeptIndex = (dbDept: string): number => {
    if (!dbDept) return -1;
    const clean = dbDept.trim().toUpperCase();
    if (clean === 'REKTORAT') return 0;
    if (clean === 'PASCASARJANA') return 1;
    if (clean === 'FAK. AGAMA ISLAM') return 2;
    if (clean === 'FAK. BISNIS, BAHASA DAN PENDIDIKAN') return 3;
    if (clean === 'FAK. SAINS DAN TEKNOLOGI') return 4;
    if (clean === 'FAK. ILMU KESEHATAN' || clean === 'FAK. ILMU KESH') return 5;
    if (clean === 'UPT & LEMBAGA' || clean === 'UPT DAN LEMBAGA') return 6;
    return -1;
  };

  // Compile rows
  const tableRows: any[] = [];
  const columnTotals = new Array(7).fill(0);
  let grandTotal = 0;

  existingEvents.forEach(evt => {
    const workersMap = evt.eventWorkers || {};
    const rowValues = new Array(7).fill(0);
    let hasPayout = false;

    Object.entries(workersMap).forEach(([empId, w]: [string, any]) => {
      const payout = Number(w.payGiven) || 0;
      if (payout <= 0) return;

      // Robust matching: ID-based (case-insensitive) OR Name-based (case-insensitive, trimmed) as fallback
      const emp = loyalisEmployees.find(e => e.id.toLowerCase() === empId.toLowerCase()) ||
                  loyalisEmployees.find(e => e.name.trim().toLowerCase() === (w.employeeName || '').trim().toLowerCase());

      const dbDept = emp ? emp.department : (w.department || '');
      const idx = getDeptIndex(dbDept);

      if (idx !== -1) {
        rowValues[idx] += payout;
        hasPayout = true;
      }
    });

    if (hasPayout) {
      const rowSum = rowValues.reduce((sum, v) => sum + v, 0);
      const rowData = [
        evt.eventName || 'Kegiatan Tanpa Nama',
        ...rowValues.map(v => formatIDR(v)),
        formatIDR(rowSum),
      ];
      tableRows.push(rowData);

      // Accumulate totals
      rowValues.forEach((v, idx) => {
        columnTotals[idx] += v;
      });
      grandTotal += rowSum;
    }
  });

  // Add the Grand Total row
  tableRows.push([
    {
      content: 'JUMLAH',
      styles: { fontStyle: 'bold' as const, halign: 'center' as const, fillColor: [224, 231, 255] },
    },
    ...columnTotals.map(v => ({
      content: formatIDR(v),
      styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [224, 231, 255] },
    })),
    {
      content: formatIDR(grandTotal),
      styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [224, 231, 255] },
    },
  ]);

  const marginSide = 15;
  const totalTableWidth = pageWidth - 2 * marginSide; // 297 - 30 = 267mm

  autoTable(doc, {
    startY: 35,
    margin: { left: marginSide, right: marginSide },
    head: [
      [
        { content: 'URAIAN', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'SATKER', colSpan: 7, styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'JUMLAH', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      ],
      [
        { content: 'REKTORAT', styles: { halign: 'center' as const } },
        { content: 'PASCASARJANA', styles: { halign: 'center' as const } },
        { content: 'FAK. AGAMA ISLAM', styles: { halign: 'center' as const } },
        { content: 'FAK. BISNIS, BAHASA\nDAN PENDIDIKAN', styles: { halign: 'center' as const } },
        { content: 'FAK. SAINS DAN\nTEKNOLOGI', styles: { halign: 'center' as const } },
        { content: 'FAK. ILMU\nKESH', styles: { halign: 'center' as const } },
        { content: 'UPT &\nLEMBAGA', styles: { halign: 'center' as const } },
      ],
    ],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [219, 234, 254], // Light Blue (matching screenshot style but looking premium)
      textColor: [30, 41, 59], // Slate 800
      lineWidth: 0.15,
      lineColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.15,
      lineColor: [0, 0, 0],
      fontSize: 8,
    },
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
    },
    tableWidth: totalTableWidth,
    columnStyles: {
      0: { cellWidth: 105, halign: 'left' as const },
      1: { cellWidth: 20, halign: 'right' as const },
      2: { cellWidth: 20, halign: 'right' as const },
      3: { cellWidth: 20, halign: 'right' as const },
      4: { cellWidth: 20, halign: 'right' as const },
      5: { cellWidth: 20, halign: 'right' as const },
      6: { cellWidth: 20, halign: 'right' as const },
      7: { cellWidth: 20, halign: 'right' as const },
      8: { cellWidth: 22, halign: 'right' as const },
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

  if (grandTotal === 0 && typeof window !== 'undefined') {
    const sampleEvt = existingEvents.find(e => e.eventWorkers && Object.keys(e.eventWorkers).length > 0);
    const sampleKeys = sampleEvt ? Object.keys(sampleEvt.eventWorkers).slice(0, 5).join(', ') : 'None';
    alert(`Debug Info:\n- Total Events: ${existingEvents.length}\n- Total Employees: ${loyalisEmployees.length}\n- Sample Event Workers Keys: ${sampleKeys}\n- Sample Employee ID: ${loyalisEmployees.length > 0 ? loyalisEmployees[0].id : 'None'}`);
  }

  if (saveToFile) {
    const filename = `Rekapitulasi_Kegiatan_Loyalis_${period.replace(/\s+/g, '_')}.pdf`;
    doc.save(filename);
  }

  return doc;
}
