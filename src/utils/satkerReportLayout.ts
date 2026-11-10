import type { jsPDF } from 'jspdf';
import type { CashFlowSignatures } from '@/lib/satker-finance/signatures';
import { LOGO_UNIPDU_BASE64, LOGO_YAPETIDU_BASE64 } from './logoConstants';

/**
 * The letterhead of a SatKer report: the YAPETIDU and UNIPDU logos on the left, the title and a second line
 * centred in the space beside them, and a burgundy rule underneath. Returns where the content may start.
 * It draws on the current page, so call it right after `addPage()` (or on the first page).
 */
export function addReportHeader(pdf: jsPDF, input: { title: string; subtitle: string }): number {
  const pageWidth = pdf.internal.pageSize.getWidth();
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
  const titleLines: string[] = pdf.splitTextToSize(input.title, titleWidth);
  let titleY = logoTop + (logoHeight - (titleLines.length * 6 + 6)) / 2 + 4.5;
  for (const line of titleLines) { pdf.text(line, titleCenter, titleY, { align: 'center' }); titleY += 6; }
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11);
  pdf.text(input.subtitle, titleCenter, titleY, { align: 'center' });
  const ruleY = Math.max(logoTop + logoHeight + 4, titleY + 4);
  pdf.setDrawColor(139, 0, 0); pdf.setLineWidth(0.6); pdf.line(14, ruleY, pageWidth - 14, ruleY);
  return ruleY;
}

/**
 * The two signature places under a report: WarKu ("Mengetahui") on the left and the Ketua SatKer, with the place
 * and date line, on the right. It starts a new page when the block would not fit under `tableEnd`.
 */
export function addSignatureBlock(pdf: jsPDF, input: { signatures: CashFlowSignatures; dateLine: string; tableEnd: number }) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const columnWidth = (pageWidth - 38) / 2;
  const signers = [input.signatures.warku, input.signatures.ketuaSatker].map((signer, index) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    const titles: string[] = pdf.splitTextToSize(signer.title, columnWidth);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5);
    const names: string[] = pdf.splitTextToSize(signer.name || '________________________', columnWidth);
    return { center: 14 + columnWidth / 2 + index * (columnWidth + 10), titles, names };
  });
  const titleHeight = Math.max(...signers.map((signer) => signer.titles.length)) * 4.5;
  const signatureHeight = 6 + titleHeight + 24 + Math.max(...signers.map((signer) => signer.names.length)) * 4.5;
  let y = input.tableEnd + 14;
  if (y + signatureHeight > pageHeight - 15) { pdf.addPage(); y = 20; }
  signers.forEach((signer, index) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    pdf.text(index === 0 ? 'Mengetahui,' : input.dateLine, signer.center, y, { align: 'center' });
    pdf.text(signer.titles, signer.center, y + 6, { align: 'center', lineHeightFactor: 1.25 });
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5);
    pdf.text(signer.names, signer.center, y + 6 + titleHeight + 24, { align: 'center', lineHeightFactor: 1.25 });
  });
}
