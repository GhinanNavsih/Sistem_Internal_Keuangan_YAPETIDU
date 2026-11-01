import type { jsPDF } from 'jspdf';
import autoTable, { type RowInput, type Styles } from 'jspdf-autotable';
import type { CashFlowSection } from '@/lib/satker-finance/core';
import type { CashFlowSectionLines } from '@/lib/satker-finance/cashFlowStatement';

export type CashFlowPageInput = {
  unitName: string;
  monthIndex: number;
  year: number;
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
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12); pdf.text(input.unitName.toUpperCase(), pageWidth / 2, 18, { align: 'center' });
  pdf.setFontSize(14); pdf.text('LAPORAN ARUS KAS', pageWidth / 2, 27, { align: 'center' });
  pdf.setFillColor(221, 224, 228); pdf.rect(14, 32, pageWidth - 28, 8, 'F');
  pdf.setFontSize(10); pdf.text(`01/${String(input.monthIndex).padStart(2, '0')}/${input.year}`, pageWidth / 2, 37.5, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  autoTable(pdf, { startY: 44, body: rows, theme: 'grid', margin: { left: 14, right: 14 }, styles: { fontSize: 9, textColor: [40, 40, 40], lineColor: [190, 190, 190], lineWidth: 0.1 },
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
