import { jsPDF } from 'jspdf';
import autoTable, { RowInput, Styles } from 'jspdf-autotable';
import { LOGO_UNIPDU_BASE64 } from './logoConstants';
import {
  ExpenseReport,
  getExpenseReportActualTotal,
  getExpenseReportBudgetTotal,
  parseProposalQty,
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
}

type AutoTableDocument = jsPDF & {
  lastAutoTable?: {
    finalY?: number;
  };
};

const formatIDR = (amount: number): string => {
  return 'Rp' + new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount || 0));
};

function renderLetterhead(doc: jsPDF) {
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

function getLastTableY(doc: jsPDF, fallback: number): number {
  return (doc as AutoTableDocument).lastAutoTable?.finalY || fallback;
}

function renderSignatures(doc: jsPDF, signatures: ProposalExpenseReportSignature[]) {
  if (!signatures.length) return;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const y = getLastTableY(doc, 45) + 16;
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

export function generateProposalExpenseReportPdf(
  data: ProposalExpenseReportPdfData,
  saveToFile = true,
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [210, 330] });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const isEmployeeReport = data.report.mode === 'employee';
  const tableRows: RowInput[] = data.report.rows.map((row, index) => {
    const budget = parseProposalQty(row.rincianQty) * row.rincianRate;
    if (isEmployeeReport) {
      return [
        index + 1,
        row.uraian || '-',
        row.employeeName || '-',
        row.rincianQty || '-',
        { content: formatIDR(row.rincianRate), styles: { halign: 'right' as const } },
        { content: formatIDR(budget), styles: { halign: 'right' as const } },
        { content: formatIDR(row.realisasi), styles: { halign: 'right' as const } },
      ];
    }
    return [
      index + 1,
      row.uraian || '-',
      row.rincianQty || '-',
      { content: formatIDR(row.rincianRate), styles: { halign: 'right' as const } },
      { content: formatIDR(budget), styles: { halign: 'right' as const } },
      { content: formatIDR(row.realisasi), styles: { halign: 'right' as const } },
      row.note || '-',
    ];
  });

  renderLetterhead(doc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const titleLines = [
    (data.report.title || 'LAPORAN PENGELUARAN').toUpperCase(),
    `${data.reportName || 'KEGIATAN'}${data.departmentUnit ? ` - ${data.departmentUnit}` : ''}`.toUpperCase(),
    data.period.toUpperCase(),
  ];
  doc.text(titleLines, pageWidth / 2, 45, { align: 'center' });

  const head = isEmployeeReport
    ? ['NO', 'URAIAN', 'PEGAWAI', 'QTY', 'RATE', 'ANGGARAN', 'REALISASI']
    : ['NO', 'URAIAN', 'QTY', 'RATE', 'ANGGARAN', 'REALISASI', 'CATATAN'];
  const columnStyles: Record<number, Partial<Styles>> = isEmployeeReport
    ? {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 34 },
      2: { cellWidth: 38 },
      3: { cellWidth: 15, halign: 'center' },
      4: { cellWidth: 26, halign: 'right' },
      5: { cellWidth: 29, halign: 'right' },
      6: { cellWidth: 30, halign: 'right' },
    }
    : {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 39 },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 25, halign: 'right' },
      4: { cellWidth: 29, halign: 'right' },
      5: { cellWidth: 29, halign: 'right' },
      6: { cellWidth: 35 },
    };

  autoTable(doc, {
    startY: 64,
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

  const budgetTotal = getExpenseReportBudgetTotal(data.report, parseProposalQty);
  const actualTotal = getExpenseReportActualTotal(data.report);
  autoTable(doc, {
    startY: getLastTableY(doc, 64) + 3,
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

  if (data.report.notes.trim()) {
    const notesY = getLastTableY(doc, 64) + 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(doc.splitTextToSize(`Catatan: ${data.report.notes}`, pageWidth - margin * 2), margin, notesY);
  }

  renderSignatures(doc, data.signatures || []);

  if (saveToFile) {
    const safeName = `${data.report.title || 'Laporan_Pengeluaran'}_${data.reportName || 'Kegiatan'}`.replace(/[^a-zA-Z0-9]+/g, '_');
    doc.save(`Laporan_${safeName}.pdf`);
  }
  return doc;
}
