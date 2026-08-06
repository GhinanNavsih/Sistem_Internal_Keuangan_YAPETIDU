import { jsPDF } from 'jspdf';
import autoTable, { RowInput, Styles } from 'jspdf-autotable';
import { LOGO_UNIPDU_BASE64 } from './logoConstants';
import {
  ExpenseReport,
  getExpenseReportDefinition,
  getExpenseReportTotal,
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

function pushRoleRows(
  tableRows: RowInput[],
  rows: { employeeName: string; role: string; studentCount: number; rate: number }[],
) {
  const roles = Array.from(new Set(rows.map((row) => row.role.trim() || 'Tanpa Peran')));
  roles.forEach((role) => {
    tableRows.push([
      { content: role, colSpan: 5, styles: { fontStyle: 'bold' as const, fillColor: [245, 247, 250] as [number, number, number] } },
    ]);
    let roleNo = 0;
    const roleRows = rows.filter((row) => (row.role.trim() || 'Tanpa Peran') === role);
    roleRows.forEach((row) => {
      roleNo += 1;
      tableRows.push([
        roleNo.toString(),
        row.employeeName || '-',
        String(row.studentCount || 0),
        { content: formatIDR(row.rate), styles: { halign: 'right' as const } },
        { content: formatIDR(row.studentCount * row.rate), styles: { halign: 'right' as const } },
      ]);
    });
    tableRows.push([
      { content: '', styles: { fillColor: [250, 250, 250] as [number, number, number] } },
      { content: `Jumlah ${role}`, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [250, 250, 250] as [number, number, number] } },
      { content: String(roleRows.reduce((sum, row) => sum + row.studentCount, 0)), styles: { fontStyle: 'bold' as const, halign: 'center' as const, fillColor: [250, 250, 250] as [number, number, number] } },
      { content: '', styles: { fillColor: [250, 250, 250] as [number, number, number] } },
      { content: formatIDR(roleRows.reduce((sum, row) => sum + row.studentCount * row.rate, 0)), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [250, 250, 250] as [number, number, number] } },
    ]);
  });
}

function renderSignatures(doc: jsPDF, signatures: ProposalExpenseReportSignature[]) {
  if (!signatures.length) return;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const y = (getLastTableY(doc, 45) || 45) + 16;
  const sigY = y + 12 > pageHeight - 50 ? 52 : y;
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

function getLastTableY(doc: jsPDF, fallback: number): number {
  return (doc as AutoTableDocument).lastAutoTable?.finalY || fallback;
}

export function generateProposalExpenseReportPdf(
  data: ProposalExpenseReportPdfData,
  saveToFile = true,
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [210, 330] });
  const definition = getExpenseReportDefinition(data.report.reportType);
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const tableRows: RowInput[] = [];

  renderLetterhead(doc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const title = `${data.report.title || definition.defaultTitle}\n${data.reportName || 'KEGIATAN'}${data.departmentUnit ? ` - ${data.departmentUnit}` : ''}\n${data.period}`.toUpperCase();
  doc.text(title, pageWidth / 2, 45, { align: 'center' });

  if (data.report.reportType === 'proposal_examiner' || data.report.reportType === 'munaqosyah_examiner') {
    pushRoleRows(tableRows, data.report.examinerRows);
  } else if (data.report.reportType === 'pembimbing') {
    pushRoleRows(tableRows, data.report.pembimbingRows);
  } else if (data.report.reportType === 'pedoman_kti') {
    data.report.pedomanRows.forEach((row, index) => {
      tableRows.push([index + 1, row.employeeName || '-', row.task || '-', { content: formatIDR(row.amount), styles: { halign: 'right' as const } }]);
    });
  } else if (data.report.reportType === 'committee') {
    data.report.committeeRows.forEach((row, index) => {
      tableRows.push([index + 1, row.employeeName || '-', { content: formatIDR(row.amount), styles: { halign: 'right' as const } }]);
    });
  } else {
    data.report.receiptRows.forEach((row, index) => {
      tableRows.push([index + 1, row.itemName || '-', row.qty || 0, { content: formatIDR(row.unitPrice), styles: { halign: 'right' as const } }, { content: formatIDR(row.qty * row.unitPrice), styles: { halign: 'right' as const } }, row.note || '']);
    });
  }

  let head: string[];
  let columnStyles: Record<number, Partial<Styles>>;
  if (data.report.reportType === 'proposal_examiner' || data.report.reportType === 'munaqosyah_examiner' || data.report.reportType === 'pembimbing') {
    head = ['NO', 'NAMA', 'MHS', 'VAKASI', 'JUMLAH MHS x VAKASI'];
    columnStyles = { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 68 }, 2: { cellWidth: 18, halign: 'center' }, 3: { cellWidth: 34, halign: 'right' }, 4: { cellWidth: 48, halign: 'right' } };
  } else if (data.report.reportType === 'pedoman_kti') {
    head = ['NO', 'NAMA', 'TUGAS', 'JUMLAH'];
    columnStyles = { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 65 }, 2: { cellWidth: 60 }, 3: { cellWidth: 43, halign: 'right' } };
  } else if (data.report.reportType === 'committee') {
    head = ['NO', 'NAMA', 'JUMLAH'];
    columnStyles = { 0: { cellWidth: 15, halign: 'center' }, 1: { cellWidth: 115 }, 2: { cellWidth: 50, halign: 'right' } };
  } else {
    head = ['NO', 'ITEM / BUKTI', 'QTY', 'HARGA SATUAN', 'JUMLAH', 'KETERANGAN'];
    columnStyles = { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 58 }, 2: { cellWidth: 18, halign: 'center' }, 3: { cellWidth: 35, halign: 'right' }, 4: { cellWidth: 35, halign: 'right' }, 5: { cellWidth: 24 } };
  }

  autoTable(doc, {
    startY: 65,
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

  const total = getExpenseReportTotal(data.report);
  const finalY = getLastTableY(doc, 65);
  autoTable(doc, {
    startY: finalY + 3,
    margin: { left: margin, right: margin },
    tableWidth: pageWidth - margin * 2,
    body: [[{ content: 'TOTAL LAPORAN', styles: { fontStyle: 'bold' as const, halign: 'right' as const } }, { content: formatIDR(total), styles: { fontStyle: 'bold' as const, halign: 'right' as const } }]],
    theme: 'grid',
    bodyStyles: { fontSize: 8.5, fillColor: [240, 244, 255], lineColor: [0, 0, 0], lineWidth: 0.15 },
    columnStyles: { 0: { cellWidth: 140 }, 1: { cellWidth: 40 } },
  });

  if (data.report.notes.trim()) {
    const notesY = getLastTableY(doc, finalY) + 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(doc.splitTextToSize(`Catatan: ${data.report.notes}`, pageWidth - margin * 2), margin, notesY);
  }

  renderSignatures(doc, data.signatures || []);

  if (saveToFile) {
    const safeName = `${definition.shortLabel}_${data.reportName || 'Kegiatan'}`.replace(/[^a-zA-Z0-9]+/g, '_');
    doc.save(`Laporan_${safeName}.pdf`);
  }
  return doc;
}
