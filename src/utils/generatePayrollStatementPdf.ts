import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PayrollStatementEmployee {
  no: number;
  name: string;
  satker: string;
  accountNumber: string;
  netSalary: number;
}

export interface PayrollStatementData {
  period: string;
  employees: PayrollStatementEmployee[];
  totalNetSalary: number;
  title?: string;
}

export function generatePayrollStatementPdf(data: PayrollStatementData): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  const formatIDR = (amount: number): string => {
    if (amount === 0) return '0';
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 14, y);
  y += 5;
  doc.text(data.title || 'PAYROLL PEKARYA', 14, y);
  y += 10;

  const head = [
    [
      { content: 'NO.\nURUT', styles: { halign: 'center', valign: 'middle', fillColor: [220, 220, 220] } },
      { content: 'NAMA', styles: { halign: 'center', valign: 'middle', fillColor: [220, 220, 220] } },
      { content: 'SATKER', styles: { halign: 'center', valign: 'middle', fillColor: [220, 220, 220] } },
      { content: 'NO. REK', styles: { halign: 'center', valign: 'middle', fillColor: [220, 220, 220] } },
      { content: 'JUMLAH GAJI\nBERSIH', styles: { halign: 'center', valign: 'middle', fillColor: [220, 220, 220] } },
    ],
    [
      { content: '1', styles: { halign: 'center', valign: 'middle', fillColor: [0, 0, 0], textColor: [255, 255, 255] } },
      { content: '2', styles: { halign: 'center', valign: 'middle', fillColor: [0, 0, 0], textColor: [255, 255, 255] } },
      { content: '3', styles: { halign: 'center', valign: 'middle', fillColor: [0, 0, 0], textColor: [255, 255, 255] } },
      { content: '', styles: { halign: 'center', valign: 'middle', fillColor: [0, 0, 0], textColor: [255, 255, 255] } },
      { content: '4', styles: { halign: 'center', valign: 'middle', fillColor: [0, 0, 0], textColor: [255, 255, 255] } },
    ]
  ];

  const body = [];

  // Data Rows
  data.employees.forEach((emp) => {
    body.push([
      { content: emp.no.toString(), styles: { halign: 'center' } },
      { content: emp.name },
      { content: emp.satker },
      { content: emp.accountNumber || '-', styles: { halign: 'center' } },
      { content: formatIDR(emp.netSalary), styles: { halign: 'right', fontStyle: 'bold' } },
    ]);
  });

  // Grand Total Row (Moved to bottom)
  body.push([
    { 
      content: 'JUMLAH', 
      colSpan: 4, 
      styles: { halign: 'center', fillColor: [226, 239, 218], fontStyle: 'bold' } 
    },
    { 
      content: formatIDR(data.totalNetSalary), 
      styles: { halign: 'right', fillColor: [226, 239, 218], fontStyle: 'bold' } 
    },
  ]);

  autoTable(doc, {
    startY: y,
    head: head as any,
    body: body as any,
    theme: 'grid',
    headStyles: {
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 8,
    },
    styles: {
      fontSize: 8,
      cellPadding: 1.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: 15 },
      1: { cellWidth: 50 },
      2: { cellWidth: 40 },
      3: { cellWidth: 40 },
      4: { cellWidth: 35 },
    },
  });

  // ─── Signatures (just date at the bottom) ──────────────────
  const finalY = (doc as any).lastAutoTable.finalY + 5;
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const month = monthNames[today.getMonth()];
  const year = today.getFullYear();
  const dateStr = `Jombang, ${day} ${month} ${year}`;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, pageWidth / 2, finalY, { align: 'center' });

  const filename = `Payroll_Statement_${data.period.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}
