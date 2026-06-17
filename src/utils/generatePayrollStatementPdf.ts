import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

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

function spell(n: number): string {
  const angka = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  let hasil = "";

  if (n < 12) {
    hasil = angka[n];
  } else if (n < 20) {
    hasil = spell(n - 10) + " belas";
  } else if (n < 100) {
    hasil = spell(Math.floor(n / 10)) + " puluh " + spell(n % 10);
  } else if (n < 200) {
    hasil = "seratus " + spell(n - 100);
  } else if (n < 1000) {
    hasil = spell(Math.floor(n / 100)) + " ratus " + spell(n % 100);
  } else if (n < 2000) {
    hasil = "seribu " + spell(n - 1000);
  } else if (n < 1000000) {
    hasil = spell(Math.floor(n / 1000)) + " ribu " + spell(n % 1000);
  } else if (n < 1000000000) {
    hasil = spell(Math.floor(n / 1000000)) + " juta " + spell(n % 1000000);
  } else if (n < 1000000000000) {
    hasil = spell(Math.floor(n / 1000000000)) + " milyar " + spell(n % 1000000000);
  }

  return hasil.replace(/\s+/g, " ").trim();
}

function terbilang(n: number): string {
  const cleaned = spell(n);
  if (!cleaned) return "Nol";
  return cleaned.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function generatePayrollStatementPdf(data: PayrollStatementData): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const month = monthNames[today.getMonth()];
  const year = today.getFullYear();
  const dateStr = `${day} ${month} ${year}`;
  const localDateStr = `Jombang, ${day} ${month} ${year}`;

  const formatIDR = (amount: number): string => {
    if (amount === 0) return '0';
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // ─── PAGE 1: SURAT PENGANTAR PAYROLL ───────────────────────────────

  // Kop Surat (Letterhead)
  doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 15, 10, 14, 14);
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 181, 10, 14, 14);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text("YAYASAN PESANTREN TINGGI DARUL 'ULUM", pageWidth / 2, 13, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text("UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM", pageWidth / 2, 17.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text("Pondok Pesantren Darul 'Ulum Peterongan Jombang 61481 Telp. (0321) 873655", pageWidth / 2, 21.5, { align: 'center' });

  // Double line divider
  doc.setDrawColor(0);
  doc.setLineWidth(0.6);
  doc.line(15, 26, 195, 26);
  doc.setLineWidth(0.2);
  doc.line(15, 27, 195, 27);

  y = 35;

  // Recipient Info
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Kepada Yth.', 20, y);
  y += 5.5;
  doc.text('Operational Staff', 20, y);
  y += 5.5;
  doc.setFont('helvetica', 'bold');
  doc.text('PT. Bank Syariah Indonesia Tbk', 20, y);
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.text('KCP Jombang Wahid Hasyim', 20, y);
  y += 5.5;
  doc.text('di Tempat', 20, y);
  y += 12;

  // Subject (Perihal)
  doc.text('Perihal', 20, y);
  doc.text(':', 40, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Permohonan Pay Roll Gaji', 43, y);
  y += 12;

  // Body: Dengan hormat,
  doc.setFont('helvetica', 'normal');
  doc.text('Dengan hormat,', 20, y);
  y += 8;

  // Body Paragraph 1 (Styled with mixed bold and normal weights to highlight account and university name)
  doc.setFont('helvetica', 'normal');
  const txt1 = 'Bersama ini kami mohon dapat di pindah bukukan dana dari rekening';
  doc.text(txt1, 20, y);
  let currentX = 20 + doc.getTextWidth(txt1) + doc.getTextWidth(' ');

  doc.setFont('helvetica', 'bold');
  const txt2 = ' No. 1003253879';
  doc.text(txt2, currentX, y);
  currentX += doc.getTextWidth(txt2) + doc.getTextWidth(' ');

  doc.setFont('helvetica', 'normal');
  doc.text('atas nama', currentX, y);

  y += 6;
  doc.setFont('helvetica', 'bold');
  const txt3 = 'UNIV PESANTREN TINGGI DARUL ULUM';
  doc.text(txt3, 20, y);
  currentX = 20 + doc.getTextWidth(txt3);

  doc.setFont('helvetica', 'normal');
  doc.text(`, pada tanggal ${dateStr} dengan jumlah dana sebesar`, currentX, y);

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text(`Rp. ${formatIDR(data.totalNetSalary)}.`, 20, y);

  y += 10;

  // Terbilang
  doc.setFont('helvetica', 'bold');
  doc.text('Terbilang :', 20, y);
  doc.setFont('helvetica', 'italic');
  const terbilangText = `"${terbilang(data.totalNetSalary)} Rupiah"`;
  const terbilangLines = doc.splitTextToSize(terbilangText, pageWidth - 65);
  doc.text(terbilangLines, 43, y);
  y += terbilangLines.length * 5.5 + 8;

  // Body Paragraph 2
  doc.setFont('helvetica', 'normal');
  const p2 = 'Adapun data-data : nama, nomor tabungan, dan jumlah dana masing-masing karyawan sebagaimana terlampir.';
  doc.text(p2, 20, y, { align: 'justify', maxWidth: pageWidth - 40 });
  const p2Lines = doc.splitTextToSize(p2, pageWidth - 40);
  y += p2Lines.length * 5.5 + 8;

  // Body Paragraph 3
  const p3 = 'Demikian hal ini kami sampaikan, atas perhatian dan kerjasamanya diucapkan terima kasih.';
  doc.text(p3, 20, y, { align: 'justify', maxWidth: pageWidth - 40 });
  const p3Lines = doc.splitTextToSize(p3, pageWidth - 40);
  y += p3Lines.length * 5.5 + 20;

  // Signature Block (without lines/stamp as requested)
  const sigX = pageWidth - 80;
  doc.text(`Jombang, ${month} ${year}`, sigX, y);
  y += 5.5;
  doc.text('Rektor', sigX, y);
  y += 28;
  doc.setFont('helvetica', 'bold');
  doc.text("Dr. dr. H.M. Zulfikar As'ad, MMR", sigX, y);

  // ─── PAGE 2: PAYROLL STATEMENT TABLE DATA ─────────────────────────
  doc.addPage();
  y = 15;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 14, y);
  y += 5;
  doc.text(data.title || 'PAYROLL PEKARYA', 14, y);
  y += 10;

  const head = [
    [
      { content: 'NO.', styles: { halign: 'center', valign: 'middle', fillColor: [220, 220, 220] } },
      { content: 'NAMA', styles: { halign: 'center', valign: 'middle', fillColor: [220, 220, 220] } },
      { content: 'NO. REK', styles: { halign: 'center', valign: 'middle', fillColor: [220, 220, 220] } },
      { content: 'JUMLAH GAJI\nBERSIH', styles: { halign: 'center', valign: 'middle', fillColor: [220, 220, 220] } },
    ]
  ];

  const body = [];

  // Data Rows
  data.employees.forEach((emp) => {
    body.push([
      { content: emp.no.toString(), styles: { halign: 'center' } },
      { content: emp.name },
      { content: emp.accountNumber || '-', styles: { halign: 'center' } },
      { content: formatIDR(emp.netSalary), styles: { halign: 'right', fontStyle: 'bold' } },
    ]);
  });

  // Grand Total Row (Moved to bottom)
  body.push([
    {
      content: 'JUMLAH',
      colSpan: 3,
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
      1: { cellWidth: 80 },
      2: { cellWidth: 45 },
      3: { cellWidth: 40 },
    },
  });

  // ─── Signatures (just date at the bottom) ──────────────────
  const finalY = (doc as any).lastAutoTable.finalY + 5;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(localDateStr, pageWidth / 2, finalY, { align: 'center' });

  const filename = `Payroll_Statement_${data.period.replace(/\s+/g, '_')}.pdf`;
  doc.save(filename);
}
