import { jsPDF } from 'jspdf';

export interface PaySlipField {
  label: string;
  amount: number;
}

export interface PaySlipData {
  employeeName: string;
  employeeNo: number;
  period: string;
  jobCategory: string;
  earnings: PaySlipField[];
  deductions: PaySlipField[];
}

export function generatePaySlipPdf(data: PaySlipData): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginLeft = 35;
  const marginRight = 35;
  const contentWidth = pageWidth - marginLeft - marginRight;
  let y = 15;

  const formatIDR = (amount: number): string => {
    if (amount === 0) return '-';
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // ─── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('SLIP GAJI', pageWidth / 2, y, { align: 'center' });
  y += 5;

  // Grey Pill for Job Category
  const pillHeight = 8;
  const pillWidth = contentWidth * 0.8;
  doc.setFillColor(235, 235, 235); // Light grey
  doc.roundedRect((pageWidth - pillWidth) / 2, y, pillWidth, pillHeight, 2, 2, 'F');
  doc.setFontSize(14);
  doc.text(data.jobCategory.toUpperCase(), pageWidth / 2, y + 6, { align: 'center' });
  y += pillHeight + 5;

  doc.setFontSize(12);
  doc.text(`BULAN ${data.period.toUpperCase()}`, pageWidth / 2, y, { align: 'center' });
  y += 12;

  // ─── Employee Info ───────────────────────────────────────────
  doc.setFontSize(14);
  doc.text('NO', marginLeft, y);
  doc.text(data.employeeNo.toString(), marginLeft + 40, y);
  y += 8;
  doc.text('NAMA', marginLeft, y);
  doc.text(data.employeeName.toUpperCase(), marginLeft + 40, y);
  y += 10;

  // ─── Table Setup ─────────────────────────────────────────────
  const colWidths = {
    no: 10,
    uraian: 70,
    jumlah: 30,
    total: 30
  };

  const startX = marginLeft;
  const tableWidth = colWidths.no + colWidths.uraian + colWidths.jumlah + colWidths.total;

  const drawRow = (rowY: number, rowHeight: number, isHeader: boolean = false, isGrey: boolean = false) => {
    if (isGrey) {
      doc.setFillColor(235, 235, 235);
      doc.rect(startX, rowY, tableWidth, rowHeight, 'F');
    }
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.rect(startX, rowY, tableWidth, rowHeight); // Outer border
  };

  // Table Headers
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  const headerHeight = 7;
  drawRow(y, headerHeight);
  doc.text('NO', startX + colWidths.no / 2, y + 5, { align: 'center' });
  doc.text('URAIAN', startX + colWidths.no + 5, y + 5);
  doc.text('JUMLAH', startX + colWidths.no + colWidths.uraian + colWidths.jumlah / 2, y + 5, { align: 'center' });
  doc.text('TOTAL', startX + colWidths.no + colWidths.uraian + colWidths.jumlah + colWidths.total / 2, y + 5, { align: 'center' });
  y += headerHeight;

  // ─── Earnings ────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const rowH = 6;
  let totalEarnings = 0;

  data.earnings.forEach((item, index) => {
    drawRow(y, rowH);
    doc.text((index + 1).toString(), startX + colWidths.no / 2, y + 4.5, { align: 'center' });
    doc.text(item.label.toUpperCase(), startX + colWidths.no + 2, y + 4.5);
    doc.text(formatIDR(item.amount), startX + colWidths.no + colWidths.uraian + colWidths.jumlah - 2, y + 4.5, { align: 'right' });
    totalEarnings += item.amount;
    y += rowH;
  });

  // Empty row for spacing (like row 10 in image)
  drawRow(y, rowH);
  y += rowH;

  // Earnings Total row
  doc.setFont('helvetica', 'bold');
  drawRow(y, rowH, false, true);
  doc.text('JUMLAH', startX + (colWidths.no + colWidths.uraian + colWidths.jumlah) / 2, y + 4.5, { align: 'center' });
  doc.text(formatIDR(totalEarnings), startX + tableWidth - 2, y + 4.5, { align: 'right' });
  y += rowH;

  // ─── Deductions ──────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  let totalDeductions = 0;

  data.deductions.forEach((item, index) => {
    drawRow(y, rowH);
    doc.text((index + 1).toString(), startX + colWidths.no / 2, y + 4.5, { align: 'center' });
    doc.text(item.label.toUpperCase(), startX + colWidths.no + 2, y + 4.5);
    doc.text(formatIDR(item.amount), startX + colWidths.no + colWidths.uraian + colWidths.jumlah - 2, y + 4.5, { align: 'right' });
    totalDeductions += item.amount;
    y += rowH;
  });

  // Empty row for spacing
  drawRow(y, rowH);
  y += rowH;

  // Deductions Total row
  drawRow(y, rowH);
  doc.setFont('helvetica', 'bold');
  doc.text('JUMLAH POTONGAN', startX + 5, y + 4.5);
  doc.text(formatIDR(totalDeductions), startX + tableWidth - 2, y + 4.5, { align: 'right' });
  y += rowH;

  // ─── Net Salary ──────────────────────────────────────────────
  const netSalary = totalEarnings - totalDeductions;
  drawRow(y, rowH + 1, false, true);
  doc.setFontSize(11);
  doc.text('GAJI BERSIH', startX + 5, y + 5);
  doc.text(formatIDR(netSalary), startX + tableWidth - 2, y + 5, { align: 'right' });
  y += rowH + 5;

  // ─── Save ────────────────────────────────────────────────────
  const filename = `Slip_Gaji_${data.employeeName.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}

