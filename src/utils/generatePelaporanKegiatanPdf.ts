import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface PelaporanKegiatanRow {
  employeeId: string;
  employeeName: string;
  role: string;
  activityDone: string;
  payGiven: number;
}

export interface PelaporanKegiatanSignature {
  label: string;
  name: string;
  title: string;
}

export interface PelaporanKegiatanPdfData {
  title: string;
  period: string; // e.g., "Juni 2026"
  departmentUnit: string;
  rows: PelaporanKegiatanRow[];
  signatures: PelaporanKegiatanSignature[];
}

export function generatePelaporanKegiatanPdf(data: PelaporanKegiatanPdfData, saveToFile = true): jsPDF {
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

  // ── 1. Letterhead ────────────────────────────────────────────────────────
  // UNIPDU Logo on the left
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 15, 10, 22, 22);

  // Text: UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text("UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM", 42, 18);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text("Pusat Pengisian Gaji & Administrasi Keuangan Kepegawaian", 42, 23);
  doc.setFontSize(9);
  doc.text("Jl. Unipdu, Kompleks Pondok Pesantren Darul 'Ulum, Peterongan, Jombang", 42, 28);

  // Thick horizontal line below letterhead
  doc.setLineWidth(0.6);
  doc.setDrawColor(0, 0, 0);
  doc.line(15, 35, pageWidth - 15, 35);
  doc.setLineWidth(0.2);
  doc.line(15, 36, pageWidth - 15, 36);

  // ── 2. Report Title & Meta ───────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  const titleText = data.title || 'LAPORAN KEGIATAN';
  // Center-align the title
  const splitTitle = doc.splitTextToSize(titleText.toUpperCase(), pageWidth - 40);
  doc.text(splitTitle, pageWidth / 2, 45, { align: 'center' });

  // Calculate Y offset after title
  const titleHeight = splitTitle.length * 5;
  const metaY = 45 + titleHeight;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Unit Kerja: ${data.departmentUnit.toUpperCase()}`, 15, metaY);
  doc.text(`Periode: ${data.period.toUpperCase()}`, pageWidth - 15, metaY, { align: 'right' });

  // ── 3. Table of Activities & Payments ───────────────────────────────────
  const tableRows: any[] = [];
  let totalPay = 0;

  data.rows.forEach((row, idx) => {
    tableRows.push([
      (idx + 1).toString(),
      row.employeeName,
      row.role,
      row.activityDone || '-',
      formatIDR(row.payGiven),
    ]);
    totalPay += row.payGiven;
  });

  // Add Grand Total Row
  tableRows.push([
    {
      content: 'TOTAL VAKASI',
      colSpan: 4,
      styles: { fontStyle: 'bold' as const, halign: 'center' as const, fillColor: [240, 244, 255] },
    },
    {
      content: formatIDR(totalPay),
      styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [240, 244, 255] },
    },
  ]);

  const marginSide = 15;
  const totalTableWidth = pageWidth - 2 * marginSide;

  autoTable(doc, {
    startY: metaY + 6,
    margin: { left: marginSide, right: marginSide },
    head: [
      [
        { content: 'NO.', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'NAMA PEGAWAI', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'JABATAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'URAIAN KEGIATAN', styles: { halign: 'center' as const, valign: 'middle' as const } },
        { content: 'NOMINAL VAKASI', styles: { halign: 'center' as const, valign: 'middle' as const } },
      ],
    ],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [67, 56, 202], // Indigo-700
      textColor: [255, 255, 255],
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
      cellPadding: 3,
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
    },
    tableWidth: totalTableWidth,
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' as const },
      1: { cellWidth: 45, halign: 'left' as const },
      2: { cellWidth: 40, halign: 'left' as const },
      3: { cellWidth: 55, halign: 'left' as const },
      4: { cellWidth: 30, halign: 'right' as const },
    },
  });

  // ── 4. Signatures ────────────────────────────────────────────────────────
  const finalY = (doc as any).lastAutoTable.finalY || (metaY + 20);
  
  // Check if signatures fit on the page, else add new page
  let sigY = finalY + 15;
  if (sigY + 35 > pageHeight) {
    doc.addPage();
    sigY = 25; // Reset Y on new page
  }

  const sigCount = data.signatures.length;
  if (sigCount > 0) {
    // Distribute signatures side-by-side
    // Margins are 15mm on each side, printable width is 180mm.
    const colWidth = 180 / sigCount;

    data.signatures.forEach((sig, idx) => {
      const colX = 15 + idx * colWidth + colWidth / 2;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(sig.label || 'Mengetahui,', colX, sigY, { align: 'center' });

      // Space for physical signature (approx 22mm)
      const nameY = sigY + 24;
      doc.setFont('helvetica', 'bold');
      doc.text(sig.name || '____________________', colX, nameY, { align: 'center' });
      
      // Underline name
      if (sig.name) {
        const textWidth = doc.getTextWidth(sig.name);
        doc.setLineWidth(0.25);
        doc.line(colX - textWidth / 2, nameY + 0.8, colX + textWidth / 2, nameY + 0.8);
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(sig.title || '', colX, nameY + 5, { align: 'center' });
    });
  }

  // ── 5. Page Numbers ──────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Halaman ${i} dari ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
  }

  if (saveToFile) {
    const sanitizedTitle = titleText.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const filename = `Pelaporan_Kegiatan_${data.departmentUnit}_${sanitizedTitle}.pdf`;
    doc.save(filename);
  }

  return doc;
}
