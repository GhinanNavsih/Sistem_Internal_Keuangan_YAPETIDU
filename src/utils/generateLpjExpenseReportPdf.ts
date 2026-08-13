import { jsPDF } from 'jspdf';
import autoTable, { RowInput, Styles } from 'jspdf-autotable';
import { LOGO_UNIPDU_BASE64 } from './logoConstants';
import { renderFileToCanvas } from './ocrParser';
import {
  ExpenseReport,
  getExpenseGroupRows,
  getExpenseReportActualTotal,
  getExpenseReportBudgetTotal,
  getExpenseReportRowsForItem,
  parseProposalQty,
  ProposalExpenseRow,
} from '@/lib/payroll/proposalExpenseReports';

export interface ProposalExpenseReportSignature {
  label: string;
  name: string;
  title: string;
}

export interface ProposalExpenseReportPdfData {
  report: ExpenseReport;
  reportName: string;
  period: string;
  departmentUnit?: string;
  signatures?: ProposalExpenseReportSignature[];
  /** The LPJ Pengeluaran rows, so header items and their locked QTY/RATE/REALISASI can be resolved. */
  expenseRows?: ProposalExpenseRow[];
}

type AutoTableDocument = jsPDF & {
  lastAutoTable?: {
    finalY?: number;
  };
};

export const formatIDR = (amount: number): string => {
  return 'Rp' + new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount || 0));
};

export function renderLetterhead(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 15, 10, 22, 22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text("UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM", 42, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Pusat Pengisian Gaji & Administrasi Keuangan Kepegawaian', 42, 23);
  doc.setFontSize(9);
  doc.text("Jl. Unipdu, Kompleks Pondok Pesantren Darul 'Ulum, Peterongan, Jombang", 42, 28);
  doc.setLineWidth(0.6);
  doc.setDrawColor(0, 0, 0);
  doc.line(15, 35, pageWidth - 15, 35);
  doc.setLineWidth(0.2);
  doc.line(15, 36, pageWidth - 15, 36);
}

export function getLastTableY(doc: jsPDF, fallback: number): number {
  return (doc as AutoTableDocument).lastAutoTable?.finalY || fallback;
}

/** Draws a signature block at an explicit Y, paging first if it wouldn't fit. */
export function renderSignaturesAt(doc: jsPDF, signatures: ProposalExpenseReportSignature[], startY: number): void {
  if (!signatures.length) return;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const y = startY + 16;
  const sigY = y + 36 > pageHeight - 20 ? 52 : y;
  if (sigY !== y) {
    doc.addPage();
    renderLetterhead(doc);
  }

  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  const columns = signatures.length;
  signatures.forEach((signature, index) => {
    const x = margin + (index + 0.5) * (contentWidth / columns);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(signature.title || signature.label || 'Mengetahui,', x, sigY, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.text(signature.name || '____________________', x, sigY + 26, { align: 'center' });
    if (signature.name) {
      const width = doc.getTextWidth(signature.name);
      doc.setLineWidth(0.25);
      doc.line(x - width / 2, sigY + 27, x + width / 2, sigY + 27);
    }
  });
}

/**
 * Renders one expense report's title, item table, and totals starting at `startY`.
 * Shared by the standalone per-report PDF and the combined LPJ document. Returns
 * the Y position after the last thing drawn (table, totals, or notes).
 *
 * Mirrors the "Rincian Item & Nominal Laporan" dialog table exactly: when the
 * report is linked to locked Pengeluaran header items, rows are grouped under
 * a bold header row (its own QTY/RATE/REALISASI) with only the matching child
 * rows beneath it — the same `parentRowId`/`parentUraian`/`uraian` fallback
 * chain the dialog uses, so stray rows that don't belong to any current header
 * item are silently dropped instead of leaking into the printout.
 */
export function renderExpenseReportSection(
  doc: jsPDF,
  report: ExpenseReport,
  expenseRows: ProposalExpenseRow[],
  startY: number,
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const isEmployeeReport = report.mode === 'employee';

  const groupHeaderIndex = expenseRows.findIndex(
    (r) => r.type === 'group_header' && r.rowId === report.expenseRowId,
  );
  const headerItems = groupHeaderIndex !== -1 ? getExpenseGroupRows(expenseRows, groupHeaderIndex) : [];

  const tableRows: RowInput[] = [];
  const nameColumn = (row: ExpenseReport['rows'][number]) => (isEmployeeReport ? row.employeeName : row.uraian) || '-';

  if (headerItems.length === 0) {
    report.rows.forEach((row, index) => {
      tableRows.push([
        index + 1,
        nameColumn(row),
        row.rincianQty || '-',
        { content: formatIDR(row.rincianRate), styles: { halign: 'right' as const } },
        { content: formatIDR(row.realisasi), styles: { halign: 'right' as const } },
      ]);
    });
  } else {
    headerItems.forEach((headerItem, hIdx) => {
      const headerAnggaran = parseProposalQty(headerItem.rincianQty) * headerItem.rincianRate;
      const headerRealisasi = headerItem.realisasi ?? headerAnggaran;

      tableRows.push([
        { content: (hIdx + 1).toString(), styles: { fontStyle: 'bold' as const, fillColor: [237, 233, 254] } },
        { content: headerItem.uraian, styles: { fontStyle: 'bold' as const, fillColor: [237, 233, 254] } },
        { content: headerItem.rincianQty || '-', styles: { fontStyle: 'bold' as const, fillColor: [237, 233, 254], halign: 'center' as const } },
        { content: formatIDR(headerItem.rincianRate), styles: { fontStyle: 'bold' as const, fillColor: [237, 233, 254], halign: 'right' as const } },
        { content: formatIDR(headerRealisasi), styles: { fontStyle: 'bold' as const, fillColor: [237, 233, 254], halign: 'right' as const } },
      ]);

      const childRows = getExpenseReportRowsForItem(report, headerItem);

      childRows.forEach((row, cIdx) => {
        tableRows.push([
          `${hIdx + 1}.${cIdx + 1}`,
          nameColumn(row),
          row.rincianQty || '-',
          { content: formatIDR(row.rincianRate), styles: { halign: 'right' as const } },
          { content: formatIDR(row.realisasi), styles: { halign: 'right' as const } },
        ]);
      });
    });
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text((report.title || 'LAPORAN PENGELUARAN').toUpperCase(), pageWidth / 2, startY, { align: 'center' });
  const tableStartY = startY + 6;

  const head = ['NO', 'URAIAN / PEGAWAI', 'QTY', 'RATE', 'REALISASI'];
  const columnStyles: Record<number, Partial<Styles>> = {
    0: { cellWidth: 12, halign: 'center' },
    1: { cellWidth: 70 },
    2: { cellWidth: 30, halign: 'center' },
    3: { cellWidth: 34, halign: 'right' },
    4: { cellWidth: 34, halign: 'right' },
  };

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin },
    tableWidth: pageWidth - margin * 2,
    head: [head],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: [67, 56, 202], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, halign: 'center' },
    bodyStyles: { fontSize: 8, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.15 },
    styles: { cellPadding: 1.6, lineColor: [0, 0, 0], lineWidth: 0.05 },
    columnStyles,
  });

  const budgetTotal = getExpenseReportBudgetTotal(report, parseProposalQty);
  const actualTotal = getExpenseReportActualTotal(report);
  autoTable(doc, {
    startY: getLastTableY(doc, tableStartY) + 3,
    margin: { left: margin, right: margin },
    tableWidth: pageWidth - margin * 2,
    body: [[
      { content: 'TOTAL ANGGARAN', styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
      { content: formatIDR(budgetTotal), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
      { content: 'TOTAL REALISASI', styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
      { content: formatIDR(actualTotal), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
    ]],
    theme: 'grid',
    bodyStyles: { fontSize: 8.5, fillColor: [240, 244, 255], lineColor: [0, 0, 0], lineWidth: 0.15 },
    columnStyles: { 0: { cellWidth: 45 }, 1: { cellWidth: 35 }, 2: { cellWidth: 50 }, 3: { cellWidth: 50 } },
  });

  let finalY = getLastTableY(doc, tableStartY);
  if (report.notes.trim()) {
    const notesY = finalY + 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const lines = doc.splitTextToSize(`Catatan: ${report.notes}`, pageWidth - margin * 2);
    doc.text(lines, margin, notesY);
    finalY = notesY + lines.length * 4;
  }
  return finalY;
}

export interface ExpenseReportReceiptEntry {
  label: string;
  url: string;
  fileName: string;
}

/** Fetches an uploaded receipt (image or PDF) and rasterizes it to a JPEG data URL for embedding. */
export async function fetchReceiptAsImageDataUrl(url: string, fileName: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gagal mengambil bukti (${response.status})`);
  const blob = await response.blob();
  const type = blob.type || (fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
  const file = new File([blob], fileName, { type });
  const canvas = await renderFileToCanvas(file);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Draws one receipt (letterhead + label + embedded image) on the current page. Caller handles pagination. */
export async function renderReceiptPage(doc: jsPDF, entry: ExpenseReportReceiptEntry): Promise<void> {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;

  renderLetterhead(doc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`BUKTI: ${entry.label.toUpperCase()}`, pageWidth / 2, 42, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(entry.fileName, pageWidth / 2, 47, { align: 'center' });

  try {
    const dataUrl = await fetchReceiptAsImageDataUrl(entry.url, entry.fileName);
    const imgProps = doc.getImageProperties(dataUrl);
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - 60;
    const scale = Math.min(maxW / imgProps.width, maxH / imgProps.height, 1);
    const w = imgProps.width * scale;
    const h = imgProps.height * scale;
    const x = (pageWidth - w) / 2;
    doc.addImage(dataUrl, 'JPEG', x, 52, w, h);
  } catch (error) {
    console.error('Gagal memuat bukti untuk PDF:', error);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text('Gagal memuat gambar bukti. Lihat berkas asli di sistem.', pageWidth / 2, 60, { align: 'center' });
  }
}

export async function generateLpjExpenseReportPdf(
  data: ProposalExpenseReportPdfData,
  saveToFile = true,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [210, 330] });
  const pageWidth = doc.internal.pageSize.getWidth();

  renderLetterhead(doc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const contextLines = [
    `${data.reportName || 'KEGIATAN'}${data.departmentUnit ? ` - ${data.departmentUnit}` : ''}`.toUpperCase(),
    data.period.toUpperCase(),
  ];
  doc.text(contextLines, pageWidth / 2, 42, { align: 'center' });

  const finalY = renderExpenseReportSection(doc, data.report, data.expenseRows || [], 54);
  renderSignaturesAt(doc, data.signatures || [], finalY);

  const receiptEntries: ExpenseReportReceiptEntry[] = Object.values(data.report.receipts || {});
  for (const entry of receiptEntries) {
    doc.addPage();
    await renderReceiptPage(doc, entry);
  }

  if (saveToFile) {
    const safeName = `${data.report.title || 'Laporan_Pengeluaran'}_${data.reportName || 'Kegiatan'}`.replace(/[^a-zA-Z0-9]+/g, '_');
    doc.save(`Laporan_${safeName}.pdf`);
  }
  return doc;
}
