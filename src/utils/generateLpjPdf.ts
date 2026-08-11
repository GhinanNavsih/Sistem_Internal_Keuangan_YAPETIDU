import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { ExpenseReport, ProposalExpenseRow } from '@/lib/payroll/proposalExpenseReports';
import {
  ExpenseReportReceiptEntry,
  formatIDR,
  getLastTableY,
  ProposalExpenseReportSignature,
  renderExpenseReportSection,
  renderLetterhead,
  renderReceiptPage,
  renderSignaturesAt,
} from './generateLpjExpenseReportPdf';

export type LpjPdfSignature = ProposalExpenseReportSignature;

export interface LpjPemasukanRow {
  uraian: string;
  rincianQty: string;
  rincianRate: number;
  realisasi: number;
}

export interface LpjPdfData {
  reportName: string;
  period: string;
  departmentUnit: string;
  signatures: LpjPdfSignature[];
  // Part 1: Realisasi Summary
  realisasiEnabled: boolean;
  realisasiTitle: string;
  pemasukanRows: LpjPemasukanRow[];
  pengeluaranRows: ProposalExpenseRow[];
  yayasanPercentage: number;
  unipduPercentage: number;
  kepanitiaaanPercentage: number;
  // Parts 2 & 3: every report linked to a Pengeluaran group header, and any
  // receipts attached to their (expense-mode) header items.
  expenseReports: ExpenseReport[];
}

const parseQty = (q: string): number => {
  if (!q) return 0;
  const trimmed = q.trim();
  const parts = trimmed.split(/[xX*]/);
  if (parts.length > 1) {
    let product = 1;
    for (const part of parts) {
      const cleanPart = part.trim();
      const match = cleanPart.match(/[\d.]+/);
      if (!match) continue;
      let val = parseFloat(match[0]);
      if (cleanPart.includes('%')) val /= 100;
      product *= val;
    }
    return product;
  }
  if (trimmed.endsWith('%')) {
    const match = trimmed.match(/[\d.]+/);
    return match ? parseFloat(match[0]) / 100 : 0;
  }
  const match = trimmed.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
};

const headStyles = {
  fillColor: [67, 56, 202] as [number, number, number],
  textColor: [255, 255, 255] as [number, number, number],
  lineWidth: 0.15,
  lineColor: [0, 0, 0] as [number, number, number],
  fontStyle: 'bold' as const,
  fontSize: 8.5,
};

const bodyStyles = {
  fillColor: [255, 255, 255] as [number, number, number],
  textColor: [0, 0, 0] as [number, number, number],
  lineWidth: 0.15,
  lineColor: [0, 0, 0] as [number, number, number],
  fontSize: 8,
};

function renderTitle(doc: jsPDF, title: string, startY: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const splitTitle = doc.splitTextToSize(title.toUpperCase(), pageWidth - 40);
  doc.text(splitTitle, pageWidth / 2, startY, { align: 'center' });
  return startY + splitTitle.length * 5 + 4;
}

export async function generateLpjPdf(data: LpjPdfData, saveToFile = true): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [210, 330] });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginSide = 15;
  const tableWidth = pageWidth - 2 * marginSide;

  let isFirstPage = true;

  // ═══════════════════════════════════════════════════════════════════════
  // PART 1: REALISASI SUMMARY
  // ═══════════════════════════════════════════════════════════════════════
  if (data.realisasiEnabled && (data.pemasukanRows.length > 0 || data.pengeluaranRows.length > 0)) {
    if (!isFirstPage) doc.addPage();
    isFirstPage = false;

    renderLetterhead(doc);
    const tableStartY = renderTitle(doc, data.realisasiTitle || 'REALISASI', 45);

    const tableRows: RowInput[] = [];

    tableRows.push([
      { content: '', styles: { fontStyle: 'bold' as const } },
      { content: 'PEMASUKAN', colSpan: 4, styles: { fontStyle: 'bold' as const } },
    ]);
    data.pemasukanRows.forEach((row, idx) => {
      const anggaran = parseQty(row.rincianQty) * row.rincianRate;
      const rincianStr = row.rincianQty && row.rincianRate > 0 ? `${row.rincianQty}  x  ${formatIDR(row.rincianRate)}` : '';
      tableRows.push([
        (idx + 1).toString(),
        row.uraian,
        rincianStr,
        { content: formatIDR(anggaran), styles: { halign: 'right' as const } },
        { content: formatIDR(row.realisasi), styles: { halign: 'right' as const } },
      ]);
    });

    const totalPemasukanAnggaran = data.pemasukanRows.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
    const totalPemasukanRealisasi = data.pemasukanRows.reduce((sum, r) => sum + r.realisasi, 0);

    tableRows.push([
      { content: '', styles: { fontStyle: 'bold' as const } },
      { content: 'Dana Pengembangan', colSpan: 4, styles: { fontStyle: 'bold' as const } },
    ]);
    const yayasanPct = data.yayasanPercentage ?? 20;
    const unipduPct = data.unipduPercentage ?? 20;
    const yayasanAnggaran = totalPemasukanAnggaran * (yayasanPct / 100);
    const yayasanRealisasi = totalPemasukanRealisasi * (yayasanPct / 100);
    const unipduAnggaran = totalPemasukanAnggaran * (unipduPct / 100);
    const unipduRealisasi = totalPemasukanRealisasi * (unipduPct / 100);

    tableRows.push([
      '',
      'Yayasan',
      `${yayasanPct}%  x  ${formatIDR(totalPemasukanAnggaran)}`,
      { content: formatIDR(yayasanAnggaran), styles: { halign: 'right' as const } },
      { content: formatIDR(yayasanRealisasi), styles: { halign: 'right' as const } },
    ]);
    tableRows.push([
      '',
      'UNIPDU',
      `${unipduPct}%  x  ${formatIDR(totalPemasukanAnggaran)}`,
      { content: formatIDR(unipduAnggaran), styles: { halign: 'right' as const } },
      { content: formatIDR(unipduRealisasi), styles: { halign: 'right' as const } },
    ]);

    const totalPengembanganAnggaran = yayasanAnggaran + unipduAnggaran;
    const totalPengembanganRealisasi = yayasanRealisasi + unipduRealisasi;
    const danaOperasionalAnggaran = totalPemasukanAnggaran - totalPengembanganAnggaran;
    const danaOperasionalRealisasi = totalPemasukanRealisasi - totalPengembanganRealisasi;

    tableRows.push([
      { content: '', styles: { fontStyle: 'bold' as const } },
      { content: 'Dana Operasional', styles: { fontStyle: 'bold' as const } },
      '',
      { content: formatIDR(danaOperasionalAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
      { content: formatIDR(danaOperasionalRealisasi), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
    ]);

    tableRows.push([
      { content: '', styles: { minCellHeight: 5 } },
      { content: '', colSpan: 4, styles: { minCellHeight: 5 } },
    ]);

    tableRows.push([
      { content: '', styles: { fontStyle: 'bold' as const } },
      { content: 'PENGELUARAN', colSpan: 4, styles: { fontStyle: 'bold' as const } },
    ]);
    let oIdx = 0;
    data.pengeluaranRows.forEach((row) => {
      if (row.type === 'group_header') {
        oIdx = 0;
        tableRows.push([
          { content: '', styles: { fontStyle: 'bold' as const } },
          { content: row.uraian, colSpan: 4, styles: { fontStyle: 'bold' as const } },
        ]);
      } else {
        oIdx += 1;
        const anggaran = parseQty(row.rincianQty) * row.rincianRate;
        const rincianStr = row.rincianQty && row.rincianRate > 0 ? `${row.rincianQty}  x  ${formatIDR(row.rincianRate)}` : '';
        tableRows.push([
          oIdx.toString(),
          row.uraian,
          rincianStr,
          { content: formatIDR(anggaran), styles: { halign: 'right' as const } },
          { content: formatIDR(row.realisasi ?? 0), styles: { halign: 'right' as const } },
        ]);
      }
    });

    const expItems = data.pengeluaranRows.filter((r) => r.type === 'item');
    const jumlahAnggaran = expItems.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
    const jumlahRealisasi = expItems.reduce((sum, r) => sum + (r.realisasi ?? 0), 0);
    const kepPerc = data.kepanitiaaanPercentage / 100;
    const kepAnggaran = jumlahAnggaran * kepPerc;
    const kepRealisasi = jumlahAnggaran * kepPerc;
    const totalAnggaran = jumlahAnggaran + kepAnggaran;
    const totalRealisasi = jumlahRealisasi + kepRealisasi;

    const summaryFill = [240, 244, 255] as [number, number, number];
    tableRows.push(
      [{ content: '', styles: { fillColor: summaryFill } }, { content: 'Jumlah Pengeluaran', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(jumlahAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(jumlahRealisasi), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }],
      [{ content: '', styles: { fillColor: summaryFill } }, { content: `Kepanitiaan ${data.kepanitiaaanPercentage}% Pengeluaran`, colSpan: 2, styles: { halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(kepAnggaran), styles: { halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(kepRealisasi), styles: { halign: 'right' as const, fillColor: summaryFill } }],
      [{ content: '', styles: { fillColor: summaryFill } }, { content: 'TOTAL PENGELUARAN', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(totalAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(totalRealisasi), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }],
    );

    autoTable(doc, {
      startY: tableStartY,
      margin: { left: marginSide, right: marginSide },
      head: [['NO', 'URAIAN', 'RINCIAN', 'ANGGARAN', 'REALISASI']],
      body: tableRows,
      theme: 'grid',
      headStyles: { ...headStyles, halign: 'center' as const },
      bodyStyles,
      styles: { fontSize: 8, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0.05 },
      tableWidth,
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' as const },
        1: { cellWidth: 50, halign: 'left' as const },
        2: { cellWidth: 60, halign: 'right' as const },
        3: { cellWidth: 30, halign: 'right' as const },
        4: { cellWidth: 30, halign: 'right' as const },
      },
    });

    const finalY = getLastTableY(doc, tableStartY + 20);
    renderSignaturesAt(doc, data.signatures, finalY);
  }

  // Print reports in the order their group headers appear in the Pengeluaran
  // table, not in whatever order they happen to sit in `expenseReports`.
  const orderedReports = data.pengeluaranRows
    .filter((row) => row.type === 'group_header' && row.reportId)
    .map((row) => data.expenseReports.find((report) => report.id === row.reportId))
    .filter((report): report is ExpenseReport => Boolean(report));

  // ═══════════════════════════════════════════════════════════════════════
  // PART 2: LPJ EXPENSE REPORTS, EACH FOLLOWED BY ITS OWN RECEIPTS
  // ═══════════════════════════════════════════════════════════════════════
  for (const report of orderedReports) {
    if (!isFirstPage) doc.addPage();
    isFirstPage = false;

    renderLetterhead(doc);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const contextLines = [
      `${data.reportName || 'KEGIATAN'}${data.departmentUnit ? ` - ${data.departmentUnit}` : ''}`.toUpperCase(),
      data.period.toUpperCase(),
    ];
    doc.text(contextLines, pageWidth / 2, 42, { align: 'center' });

    const finalY = renderExpenseReportSection(doc, report, data.pengeluaranRows, 54);
    if (report.mode === 'employee') {
      renderSignaturesAt(doc, data.signatures, finalY);
    }

    const reportReceipts: ExpenseReportReceiptEntry[] = Object.values(report.receipts || {});
    for (const entry of reportReceipts) {
      doc.addPage();
      await renderReceiptPage(doc, entry);
    }
  }

  // ── Page Numbers ──────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Halaman ${i} dari ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
  }

  if (saveToFile) {
    const sanitizedName = (data.reportName || 'Laporan').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const filename = `LPJ_${data.departmentUnit || 'Kegiatan'}_${sanitizedName}.pdf`;
    doc.save(filename);
  }

  return doc;
}
