import type { jsPDF } from 'jspdf';
import autoTable, { type RowInput, type Styles } from 'jspdf-autotable';
import type { PrintableLedger } from '@/lib/satker-finance/ledger';
import { addReportHeader } from './satkerReportLayout';

export type LedgerReportInput = {
  unitName: string;
  /** "November 2026", or "Tahun Akademik 2026/2027" for the whole year. */
  period: string;
  ledgers: PrintableLedger[];
};

const MARGIN = 14;
const BAR: Partial<Styles> = { fillColor: [139, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold' };
const COLUMN_HEAD: Partial<Styles> = { fillColor: [238, 238, 238], textColor: [40, 40, 40], fontStyle: 'bold' };
const SUBTOTAL: Partial<Styles> = { fontStyle: 'bold', fillColor: [246, 246, 246] };

const number = (value: number) => new Intl.NumberFormat('id-ID').format(value);
/** A debit or credit cell: blank money reads "-" so the column is easy to scan. */
const movement = (value: number) => (value ? number(value) : '-');
const dayMonthYear = (value: string) => value.split('-').reverse().join('/');

function ledgerTable(pdf: jsPDF, ledger: PrintableLedger, startY: number) {
  const side = ledger.normalBalance === 'CREDIT' ? 'K' : 'D';
  const body: RowInput[] = [
    [{ content: '', styles: SUBTOTAL }, { content: 'Saldo awal', styles: SUBTOTAL }, { content: '', styles: SUBTOTAL }, { content: '', styles: SUBTOTAL }, { content: number(ledger.beginning), styles: SUBTOTAL }],
    ...ledger.rows.map((row) => [dayMonthYear(row.date), row.description, movement(row.debit), movement(row.credit), number(row.balance)]),
    [{ content: '', styles: SUBTOTAL }, { content: 'Jumlah mutasi', styles: SUBTOTAL }, { content: movement(ledger.totalDebit), styles: SUBTOTAL }, { content: movement(ledger.totalCredit), styles: SUBTOTAL }, { content: '', styles: SUBTOTAL }],
    [{ content: '', styles: BAR }, { content: 'Saldo akhir', styles: BAR }, { content: '', styles: BAR }, { content: '', styles: BAR }, { content: number(ledger.ending), styles: BAR }],
  ];
  autoTable(pdf, {
    startY,
    theme: 'grid',
    margin: { left: MARGIN, right: MARGIN, top: 18, bottom: 16 },
    rowPageBreak: 'avoid',
    styles: { fontSize: 8.5, textColor: [40, 40, 40], lineColor: [190, 190, 190], lineWidth: 0.1, cellPadding: 1.8 },
    head: [
      [{ content: `${ledger.code} · ${ledger.name}`, colSpan: 3, styles: { ...BAR, halign: 'left' } }, { content: `Saldo normal: ${ledger.normalBalance === 'CREDIT' ? 'Kredit' : 'Debet'}`, colSpan: 2, styles: { ...BAR, halign: 'right' } }],
      [{ content: 'Tanggal', styles: COLUMN_HEAD }, { content: 'Uraian', styles: COLUMN_HEAD }, { content: 'Debet', styles: { ...COLUMN_HEAD, halign: 'right' } }, { content: 'Kredit', styles: { ...COLUMN_HEAD, halign: 'right' } }, { content: `Saldo (${side})`, styles: { ...COLUMN_HEAD, halign: 'right' } }],
    ],
    body,
    columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 30, halign: 'right' }, 4: { cellWidth: 32, halign: 'right' } },
    // A balance on the opposite side of the account's normal one is printed in red, like the amber minus on screen.
    didParseCell: (hook) => {
      if (hook.section === 'body' && hook.column.index === 4 && typeof hook.cell.raw === 'string' && hook.cell.raw.startsWith('-')) hook.cell.styles.textColor = [170, 0, 0];
    },
  });
  return (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/**
 * The printable Buku Besar: the SatKer letterhead, then each account's ledger (opening balance, every line with its
 * running balance, the period's totals and the closing balance). The Buku Besar carries no signatures.
 * Accounts follow one another down the page; one never starts in the last few lines of a page.
 */
export async function generateLedgerReportPdf(input: LedgerReportInput) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ruleY = addReportHeader(pdf, { title: `Buku Besar ${input.unitName}`, subtitle: `Periode ${input.period}` });
  pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8); pdf.setTextColor(100);
  pdf.text('Saldo ditampilkan menurut sisi normal akun (D = Debet, K = Kredit). Tanda minus berarti saldo berada di sisi sebaliknya.', MARGIN, ruleY + 5);
  pdf.setTextColor(0);

  let y = ruleY + 9;
  let tableEnd = y;
  if (!input.ledgers.length) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    pdf.text('Tidak ada saldo atau transaksi pada periode ini.', MARGIN, y + 6);
  }
  input.ledgers.forEach((ledger, index) => {
    if (index > 0) {
      y = tableEnd + 8;
      // Keep the account's heading with at least its first rows.
      if (y > pageHeight - 55) { pdf.addPage(); y = 18; }
    }
    tableEnd = ledgerTable(pdf, ledger, y);
  });

  const pages = pdf.getNumberOfPages();
  const pageWidth = pdf.internal.pageSize.getWidth();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(110);
    pdf.text(`Buku Besar ${input.unitName} · ${input.period}`, MARGIN, pageHeight - 8);
    pdf.text(`Halaman ${page} dari ${pages}`, pageWidth - MARGIN, pageHeight - 8, { align: 'right' });
  }
  pdf.setTextColor(0);
  return pdf;
}
