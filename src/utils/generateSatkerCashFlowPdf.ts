import type { jsPDF } from 'jspdf';
import autoTable, { type RowInput, type Styles } from 'jspdf-autotable';
import type { CashFlowSection } from '@/lib/satker-finance/core';
import { movedCashFlowSections, type CashFlowSectionLines } from '@/lib/satker-finance/cashFlowStatement';
import type { ReceiptPageImage } from '@/utils/satkerReceiptImages';
import { LOGO_UNIPDU_BASE64, LOGO_YAPETIDU_BASE64 } from './logoConstants';

export type CashFlowPageInput = {
  unitName: string;
  /** Month and year written beside the signatures, e.g. "Oktober 2026". */
  period: string;
  sections: Record<CashFlowSection, CashFlowSectionLines>;
  openingCash: number;
  cashAccounts: { code: string; name: string; balance: number }[];
  bakHeadName: string;
  unitHeadName: string;
};

/**
 * Adds the Laporan Arus Kas page of an approved report, laid out like the SatKer's printed form:
 * the three activity sections, the cash balance and the signature block.
 */
export function addCashFlowPage(pdf: jsPDF, input: CashFlowPageInput) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const bar: Partial<Styles> = { fillColor: [139, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold' };
  const bold: Partial<Styles> = { fontStyle: 'bold' };
  const amount = (value: number) => (value ? new Intl.NumberFormat('id-ID').format(value) : '-');
  const rows: RowInput[] = [];
  for (const [numeral, key, activity] of [['I', 'OPERATING', 'OPERASIONAL'], ['II', 'INVESTING', 'INVESTASI'], ['III', 'FINANCING', 'PENDANAAN']] as const) {
    const section = input.sections[key];
    rows.push([{ content: numeral, styles: bar }, { content: `ARUS KAS DARI AKTIVITAS ${activity}`, colSpan: 3, styles: bar }]);
    rows.push(['', { content: 'PENERIMAAN', styles: bold }, '', amount(section.receiptTotal)]);
    rows.push(...section.receipts.map((row) => [row.code, row.name, amount(row.amount), '']));
    rows.push(['', { content: 'PENGELUARAN', styles: bold }, '', amount(section.paymentTotal)]);
    rows.push(...section.payments.map((row) => [row.code, row.name, amount(row.amount), '']));
    rows.push(['', { content: `${section.net < 0 ? 'DEFISIT' : 'SURPLUS'} KAS DARI AKTIVITAS ${activity}`, styles: bold }, '', amount(Math.abs(section.net))]);
  }
  const netChange = input.sections.OPERATING.net + input.sections.INVESTING.net + input.sections.FINANCING.net;
  rows.push([{ content: netChange < 0 ? 'PENGURANGAN KAS DAN SETARA KAS' : 'PENAMBAHAN KAS DAN SETARA KAS', colSpan: 3, styles: bar }, { content: amount(Math.abs(netChange)), styles: bar }]);
  rows.push([{ content: 'SALDO KAS DAN SETARA KAS AWAL PERIODE', colSpan: 3, styles: bar }, { content: amount(input.openingCash), styles: bar }]);
  rows.push([{ content: 'SALDO KAS DAN SETARA KAS AKHIR PERIODE', colSpan: 3, styles: bar }, { content: amount(input.openingCash + netChange), styles: bar }]);
  rows.push(['', { content: 'RINCIAN SALDO KAS DAN SETARA KAS AKHIR PERIODE', colSpan: 2, styles: bold }, '']);
  rows.push(...input.cashAccounts.map((row) => [row.code, row.name, amount(row.balance), '']));
  rows.push([{ content: 'JUMLAH KESELURUHAN', colSpan: 3, styles: bar }, { content: amount(input.cashAccounts.reduce((sum, row) => sum + row.balance, 0)), styles: bar }]);

  pdf.addPage();
  // The YAPETIDU and UNIPDU logos on the left; the title and the period centred in the space beside them.
  const logoTop = 10;
  const logoHeight = 18;
  let titleLeft = 14;
  for (const logo of [LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64]) {
    const size = pdf.getImageProperties(logo);
    const width = (size.width / size.height) * logoHeight;
    pdf.addImage(logo, 'PNG', titleLeft, logoTop, width, logoHeight);
    titleLeft += width + 3;
  }
  const titleWidth = pageWidth - 14 - titleLeft;
  const titleCenter = titleLeft + titleWidth / 2;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13);
  const titleLines: string[] = pdf.splitTextToSize(`Laporan Arus Kas ${input.unitName}`, titleWidth);
  let titleY = logoTop + (logoHeight - (titleLines.length * 6 + 6)) / 2 + 4.5;
  for (const line of titleLines) { pdf.text(line, titleCenter, titleY, { align: 'center' }); titleY += 6; }
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
  pdf.text(`Periode ${input.period}`, titleCenter, titleY, { align: 'center' });
  const ruleY = Math.max(logoTop + logoHeight + 4, titleY + 4);
  pdf.setDrawColor(139, 0, 0); pdf.setLineWidth(0.6); pdf.line(14, ruleY, pageWidth - 14, ruleY);
  autoTable(pdf, { startY: ruleY + 5, body: rows, theme: 'grid', margin: { left: 14, right: 14 }, styles: { fontSize: 9, textColor: [40, 40, 40], lineColor: [190, 190, 190], lineWidth: 0.1 },
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 35, halign: 'right' }, 3: { cellWidth: 35, halign: 'right' } } });

  // Ka BAK and the SatKer head sign the first row; the Rektor and the Wakil Rektor sign below, as on the printed form.
  const tableEnd = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const left = 14;
  const right = pageWidth / 2 + 10;
  let y = tableEnd + 14;
  if (y + 85 > pageHeight - 15) { pdf.addPage(); y = 20; }
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Mengetahui,', left, y);
  pdf.text(`Jombang, ${input.period}`, right, y);
  pdf.text('Ka BAK,', left, y + 6);
  pdf.text(`Ka, ${input.unitName}`, right, y + 6);
  pdf.setFont('helvetica', 'bold');
  pdf.text(input.bakHeadName, left, y + 30);
  pdf.text(input.unitHeadName, right, y + 30);
  pdf.text('REKTOR,', left, y + 48);
  pdf.text('WAKIL REKTOR BIDANG KEUANGAN, SDM DAN UMUM', right, y + 48, { maxWidth: pageWidth / 2 - 24 });
  pdf.text("Dr. dr. H. M. Zulfikar As'ad, MMR", left, y + 74);
  pdf.text('Dr. Hj. Uswatun Qoyyimah, SS., M. Ed., Ph.D', right, y + 74);
}

export type CashFlowReceiptSource = {
  date: string;
  description: string;
  /** Cash the journal moved: positive is received, negative is paid, zero when it touches no cash. */
  cashChange: number;
  totalAmount: number;
  /** Place of this receipt within its journal. */
  index: number;
  count: number;
  /** The receipt's pages; throws when the file cannot be fetched. */
  load: () => Promise<ReceiptPageImage[]>;
};

const LOAD_CONCURRENCY = 4;

/** One page per receipt page: a caption naming the journal, then the receipt scaled to fit the sheet. */
function addReceiptPages(pdf: jsPDF, input: { unitName: string; period: string; receipts: (CashFlowReceiptSource & { pages: ReceiptPageImage[] | null })[] }) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const boxTop = 46;
  const money = (value: number) => new Intl.NumberFormat('id-ID').format(Math.abs(value));
  const date = (value: string) => value.split('-').reverse().join('/');

  input.receipts.forEach((receipt, receiptIndex) => {
    const pages = receipt.pages?.length ? receipt.pages : [null];
    pages.forEach((image, pageIndex) => {
      pdf.addPage();
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(110);
      pdf.text(`Lampiran Laporan Arus Kas ${input.period} - ${input.unitName}`, margin, 14);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(0);
      const pageLabel = pages.length > 1 ? ` - halaman ${pageIndex + 1} dari ${pages.length}` : '';
      const amountLabel = receipt.cashChange ? `${receipt.cashChange < 0 ? 'Pengeluaran' : 'Penerimaan'} Rp ${money(receipt.cashChange)}` : `Jurnal tanpa kas, Rp ${money(receipt.totalAmount)}`;
      const journalLabel = receipt.count > 1 ? ` (bukti ${receipt.index + 1} dari ${receipt.count} jurnal ini)` : '';
      pdf.text(`Bukti ${receiptIndex + 1} dari ${input.receipts.length}${pageLabel}`, margin, 22);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
      pdf.text(`${date(receipt.date)} | ${amountLabel}${journalLabel}`, margin, 29);
      pdf.text(receipt.description, margin, 35, { maxWidth: pageWidth - margin * 2 });
      if (!image) {
        pdf.setFontSize(10); pdf.setTextColor(150, 0, 0);
        pdf.text('Bukti ini tidak dapat ditampilkan pada cetakan. Buka dari tab Jurnal.', margin, boxTop + 8);
        pdf.setTextColor(0);
        return;
      }
      const boxWidth = pageWidth - margin * 2;
      const boxHeight = pageHeight - boxTop - margin;
      const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
      const width = image.width * scale;
      pdf.addImage(image.dataUrl, 'JPEG', margin + (boxWidth - width) / 2, boxTop, width, image.height * scale);
    });
  });
}

/**
 * The printable monthly Laporan Arus Kas with the receipts attached to the month's journals on the pages after it.
 * `missing` counts receipts that could not be fetched or drawn; each still gets a page that says so.
 */
export async function generateCashFlowReportPdf(input: CashFlowPageInput & { receipts: CashFlowReceiptSource[]; onProgress?: (loaded: number, total: number) => void }) {
  const { jsPDF } = await import('jspdf');
  const loaded: (ReceiptPageImage[] | null)[] = new Array(input.receipts.length).fill(null);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, input.receipts.length) }, async () => {
    while (next < input.receipts.length) {
      const at = next++;
      try { loaded[at] = await input.receipts[at].load(); } catch { loaded[at] = null; }
      input.onProgress?.(++done, input.receipts.length);
    }
  }));

  const pdf = new jsPDF();
  // This printout lists only the accounts that moved that month; a cash account stays while it holds a balance, so the detail still adds up.
  addCashFlowPage(pdf, { ...input, sections: movedCashFlowSections(input.sections), cashAccounts: input.cashAccounts.filter((account) => account.balance !== 0) });
  // addCashFlowPage starts on a new page, so the document's own first page is left empty.
  pdf.deletePage(1);
  addReceiptPages(pdf, { unitName: input.unitName, period: input.period, receipts: input.receipts.map((receipt, at) => ({ ...receipt, pages: loaded[at] })) });
  return { pdf, missing: loaded.filter((pages) => !pages?.length).length };
}
