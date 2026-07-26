import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface ProposalKegiatanSignature {
  label: string;
  name: string;
  title: string;
}

export interface RealisasiRow {
  type: 'item' | 'group_header';
  uraian: string;
  rincianQty: string;
  rincianRate: number;
  realisasi: number;
}

export interface VakasiRole {
  name: string;
  rate: number;
}

export interface VakasiPengujiRow {
  employeeId: string;
  employeeName: string;
  roleQtys: Record<string, number>;
}

export interface KepanitiaaanPhase {
  name: string;
}

export interface KepanitiaaanRow {
  name: string;
  employeeId?: string;
  phaseAmounts: Record<string, number>;
}

export interface ReceiptRow {
  itemName: string;
  qty: number;
  unitPrice: number;
}

export interface ProposalKegiatanPdfData {
  reportName: string;
  period: string;
  departmentUnit?: string;
  queueNumber?: number;
  signatures: ProposalKegiatanSignature[];
  realisasiEnabled?: boolean;
  realisasiTitle?: string;
  pemasukanRows?: Omit<RealisasiRow, 'type'>[];
  yayasanPercentage?: number;
  unipduPercentage?: number;
  pengeluaranRows?: RealisasiRow[];
  kepanitiaaanPercentage?: number;
  vakasiPengujiEnabled?: boolean;
  vakasiPengujiTitle?: string;
  vakasiRoles?: VakasiRole[];
  vakasiPengujiRows?: VakasiPengujiRow[];
  kepanitiaaanEnabled?: boolean;
  kepanitiaaanTitle?: string;
  kepanitiaaanPhases?: KepanitiaaanPhase[];
  kepanitiaaanRows?: KepanitiaaanRow[];
  receiptEnabled?: boolean;
  receiptTitle?: string;
  receiptRows?: ReceiptRow[];
}

const fmtRp = (n: number) => {
  if (!n || isNaN(n)) return 'Rp 0';
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
};

export function generateProposalKegiatanPdf(data: ProposalKegiatanPdfData) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginLeft = 15;
  const marginRight = 15;
  const contentWidth = pageWidth - marginLeft - marginRight;
  let currentY = 12;

  // Header Logo & Institution Name
  if (LOGO_UNIPDU_BASE64) {
    try {
      doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', marginLeft, currentY, 18, 18);
    } catch (e) {
      console.warn('Logo Base64 failed', e);
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text('YAYASAN KEPENGASUHAN DARUL ' + 'ULUM UNIPDU JOMBANG', marginLeft + 22, currentY + 6);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(79, 70, 229);
  doc.text('PROPOSAL ANGGARAN EVENT & KEGIATAN', marginLeft + 22, currentY + 12);

  if (data.queueNumber) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text(`FIFO Queue #${data.queueNumber}`, pageWidth - marginRight - 30, currentY + 6);
  }

  currentY += 20;
  doc.setLineWidth(0.5);
  doc.setDrawColor(226, 232, 240);
  doc.line(marginLeft, currentY, pageWidth - marginRight, currentY);
  currentY += 6;

  // Subtitle Event Name & Unit
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text((data.reportName || 'PROPOSAL EVENT').toUpperCase(), marginLeft, currentY);
  currentY += 5;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Unit Kerja: ${data.departmentUnit || 'UMUM'} | Periode: ${data.period}`, marginLeft, currentY);
  currentY += 8;

  // Rencana Anggaran Pemasukan & Pengeluaran
  if (data.realisasiEnabled !== false && data.pengeluaranRows && data.pengeluaranRows.length > 0) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(data.realisasiTitle || 'RENCANA ANGGARAN & ESTIMASI BIAYA', marginLeft, currentY);
    currentY += 4;

    const tableBody: any[] = [];
    data.pengeluaranRows.forEach((row, idx) => {
      tableBody.push([
        idx + 1,
        row.uraian,
        row.rincianQty || '-',
        row.rincianRate ? fmtRp(row.rincianRate) : '-',
        fmtRp(row.realisasi || 0),
      ]);
    });

    const totalEst = data.pengeluaranRows.reduce((sum, r) => sum + (r.realisasi || 0), 0);

    autoTable(doc, {
      startY: currentY,
      head: [['No', 'Uraian Pengeluaran', 'Rincian Vol', 'Tarif', 'Estimasi Biaya']],
      body: tableBody,
      foot: [['', 'TOTAL ESTIMASI ANGGARAN', '', '', fmtRp(totalEst)]],
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: [243, 244, 246], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [51, 65, 85] },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 30, halign: 'center' },
        3: { cellWidth: 35, halign: 'right' },
        4: { cellWidth: 40, halign: 'right' },
      },
      margin: { left: marginLeft, right: marginRight },
    });

    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  // Signatures
  if (data.signatures && data.signatures.length > 0) {
    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);

    const sigCount = data.signatures.length;
    const colWidth = contentWidth / sigCount;

    data.signatures.forEach((sig, idx) => {
      const sigX = marginLeft + idx * colWidth + colWidth / 2;
      doc.text(sig.title || 'Mengetahui,', sigX, currentY, { align: 'center' });
      doc.text('Pimpinan / Pejabat Berwenang', sigX, currentY + 4, { align: 'center' });
      doc.text('(____________________)', sigX, currentY + 24, { align: 'center' });
      doc.text(sig.name || sig.label || '-', sigX, currentY + 28, { align: 'center' });
    });
  }

  doc.save(`Proposal_Anggaran_${(data.reportName || 'Event').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}
