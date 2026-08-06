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
  realisasi?: number;
}

export interface ProposalKegiatanPdfData {
  reportName: string;
  period: string;
  departmentUnit?: string;
  queueNumber?: number;
  signatures: ProposalKegiatanSignature[];
  pemasukanRows?: { uraian: string; rincianQty: string; rincianRate: number }[];
  yayasanPercentage?: number;
  unipduPercentage?: number;
  pengeluaranRows?: RealisasiRow[];
  kepanitiaaanPercentage?: number;
  realisasiTitle?: string;
}

const formatIDR = (amount: number): string => {
  return 'Rp' + new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const parseQty = (q: string): number => {
  if (!q) return 0;
  const trimmed = q.trim();
  const parts = trimmed.split(/[xX\*]/);
  if (parts.length > 1) {
    let product = 1;
    for (const part of parts) {
      const cleanPart = part.trim();
      const match = cleanPart.match(/[\d\.]+/);
      if (!match) continue;
      let val = parseFloat(match[0]);
      if (cleanPart.includes('%')) {
        val = val / 100;
      }
      product *= val;
    }
    return product;
  }
  if (trimmed.endsWith('%')) {
    const match = trimmed.match(/[\d\.]+/);
    return match ? parseFloat(match[0]) / 100 : 0;
  }
  const match = trimmed.match(/[\d\.]+/);
  return match ? parseFloat(match[0]) : 0;
};

function renderLetterhead(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  if (LOGO_UNIPDU_BASE64) {
    try {
      doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 15, 10, 22, 22);
    } catch (e) {
      console.warn('Logo failed:', e);
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text("UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM", 42, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text("Pusat Pengisian Gaji & Administrasi Keuangan Kepegawaian", 42, 23);
  doc.setFontSize(9);
  doc.text("Jl. Unipdu, Kompleks Pondok Pesantren Darul 'Ulum, Peterongan, Jombang", 42, 28);
  doc.setLineWidth(0.6);
  doc.setDrawColor(0, 0, 0);
  doc.line(15, 35, pageWidth - 15, 35);
  doc.setLineWidth(0.2);
  doc.line(15, 36, pageWidth - 15, 36);
}

function renderTitle(doc: jsPDF, title: string, startY: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const splitTitle = doc.splitTextToSize(title.toUpperCase(), pageWidth - 40);
  doc.text(splitTitle, pageWidth / 2, startY, { align: 'center' });
  return startY + splitTitle.length * 5 + 4;
}

export function generateProposalKegiatanPdf(data: ProposalKegiatanPdfData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [210, 330] });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginSide = 15;
  const tableWidth = pageWidth - 2 * marginSide;

  renderLetterhead(doc);

  let titleText = `PROPOSAL ANGGARAN KEGIATAN: ${(data.reportName || 'EVENT').toUpperCase()}`;
  if (data.departmentUnit) {
    titleText += `\nUNIT KERJA: ${data.departmentUnit.toUpperCase()} (${data.period})`;
  } else {
    titleText += ` (${data.period})`;
  }
  if (data.queueNumber) {
    titleText += `\n[ FIFO QUEUE #${data.queueNumber} ]`;
  }

  const tableStartY = renderTitle(doc, titleText, 43);

  const headStyles = {
    fillColor: [67, 56, 202] as [number, number, number],
    textColor: [255, 255, 255] as [number, number, number],
    lineWidth: 0.15,
    lineColor: [0, 0, 0] as [number, number, number],
    fontStyle: 'bold' as const,
    fontSize: 8.5,
  };

  const bodyStyles = {
    fillColor: [255, 255, 255] as [number, number, number],
    textColor: [0, 0, 0] as [number, number, number],
    lineWidth: 0.15,
    lineColor: [0, 0, 0] as [number, number, number],
    fontSize: 8,
  };

  const tableRows: any[] = [];

  // 1. Pemasukan
  if (data.pemasukanRows && data.pemasukanRows.length > 0) {
    tableRows.push([
      { content: '', styles: { fontStyle: 'bold' as const } },
      { content: 'PEMASUKAN (RENCANA PENDAPATAN)', colSpan: 3, styles: { fontStyle: 'bold' as const } },
    ]);

    let pIdx = 0;
    data.pemasukanRows.forEach(row => {
      pIdx++;
      const anggaran = parseQty(row.rincianQty) * (row.rincianRate || 0);
      const rincianStr = row.rincianQty && row.rincianRate > 0 ? `${row.rincianQty}  x  ${formatIDR(row.rincianRate)}` : row.rincianQty || '';
      tableRows.push([
        pIdx.toString(),
        row.uraian,
        rincianStr,
        { content: formatIDR(anggaran), styles: { halign: 'right' as const } },
      ]);
    });

    const totalPemasukanAnggaran = data.pemasukanRows.reduce((sum, r) => sum + (parseQty(r.rincianQty) * (r.rincianRate || 0)), 0);

    // 2. Dana Pengembangan Header
    tableRows.push([
      { content: '', styles: { fontStyle: 'bold' as const } },
      { content: 'Dana Pengembangan', colSpan: 3, styles: { fontStyle: 'bold' as const } },
    ]);

    const yayasanPct = data.yayasanPercentage ?? 20;
    const unipduPct = data.unipduPercentage ?? 20;
    const yayasanAnggaran = totalPemasukanAnggaran * (yayasanPct / 100);
    const unipduAnggaran = totalPemasukanAnggaran * (unipduPct / 100);

    tableRows.push([
      '',
      'Yayasan',
      `${yayasanPct}%  x  ${formatIDR(totalPemasukanAnggaran)}`,
      { content: formatIDR(yayasanAnggaran), styles: { halign: 'right' as const } },
    ]);
    tableRows.push([
      '',
      'UNIPDU',
      `${unipduPct}%  x  ${formatIDR(totalPemasukanAnggaran)}`,
      { content: formatIDR(unipduAnggaran), styles: { halign: 'right' as const } },
    ]);

    // 3. Dana Operasional
    const totalPengembanganAnggaran = yayasanAnggaran + unipduAnggaran;
    const danaOperasionalAnggaran = totalPemasukanAnggaran - totalPengembanganAnggaran;

    tableRows.push([
      { content: '', styles: { fontStyle: 'bold' as const } },
      { content: 'Dana Operasional (Batas Biaya)', styles: { fontStyle: 'bold' as const } },
      '',
      { content: formatIDR(danaOperasionalAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
    ]);

    // Blank row gap
    tableRows.push([
      { content: '', styles: { minCellHeight: 5 } },
      { content: '', colSpan: 3, styles: { minCellHeight: 5 } },
    ]);
  }

  // 4. Pengeluaran
  if (data.pengeluaranRows && data.pengeluaranRows.length > 0) {
    tableRows.push([
      { content: '', styles: { fontStyle: 'bold' as const } },
      { content: 'PENGELUARAN (RENCANA BIAYA OPERASIONAL)', colSpan: 3, styles: { fontStyle: 'bold' as const } },
    ]);

    let oIdx = 0;
    data.pengeluaranRows.forEach(row => {
      if (row.type === 'group_header') {
        oIdx = 0;
        tableRows.push([
          { content: '', styles: { fontStyle: 'bold' as const } },
          { content: row.uraian, colSpan: 3, styles: { fontStyle: 'bold' as const } },
        ]);
      } else {
        oIdx++;
        const anggaran = parseQty(row.rincianQty) * (row.rincianRate || 0);
        const rincianStr = row.rincianQty && row.rincianRate > 0 ? `${row.rincianQty}  x  ${formatIDR(row.rincianRate)}` : row.rincianQty || '';
        tableRows.push([
          oIdx.toString(),
          row.uraian,
          rincianStr,
          { content: formatIDR(anggaran), styles: { halign: 'right' as const } },
        ]);
      }
    });

    const expItems = data.pengeluaranRows.filter(r => r.type === 'item');
    const jumlahAnggaran = expItems.reduce((sum, r) => sum + (parseQty(r.rincianQty) * (r.rincianRate || 0)), 0);
    const kepPerc = (data.kepanitiaaanPercentage ?? 10) / 100;
    const kepAnggaran = jumlahAnggaran * kepPerc;
    const totalAnggaran = jumlahAnggaran + kepAnggaran;

    const totalPemasukanAnggaran = (data.pemasukanRows || []).reduce((sum, r) => sum + (parseQty(r.rincianQty) * (r.rincianRate || 0)), 0);
    const yayasanPct = data.yayasanPercentage ?? 20;
    const unipduPct = data.unipduPercentage ?? 20;
    const danaOperasionalAnggaran = totalPemasukanAnggaran - (totalPemasukanAnggaran * ((yayasanPct + unipduPct) / 100));
    const sisaDanaOperasional = danaOperasionalAnggaran - totalAnggaran;

    const summaryFill = [240, 244, 255] as [number, number, number];
    tableRows.push(
      [{ content: '', styles: { fillColor: summaryFill } }, { content: 'Jumlah Pengeluaran', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(jumlahAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }],
      [{ content: '', styles: { fillColor: summaryFill } }, { content: `Kepanitiaan ${data.kepanitiaaanPercentage ?? 10}% Pengeluaran`, colSpan: 2, styles: { halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(kepAnggaran), styles: { halign: 'right' as const, fillColor: summaryFill } }],
      [{ content: '', styles: { fillColor: summaryFill } }, { content: 'TOTAL PENGELUARAN', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(totalAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }],
    );

    if (data.pemasukanRows && data.pemasukanRows.length > 0) {
      tableRows.push([
        { content: '', styles: { fillColor: summaryFill } },
        { content: 'SISA DANA OPERASIONAL', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } },
        { content: formatIDR(sisaDanaOperasional), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }
      ]);
    }
  }

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: marginSide, right: marginSide },
    head: [['NO', 'URAIAN PENGELUARAN', 'RINCIAN', 'ESTIMASI ANGGARAN']],
    body: tableRows,
    theme: 'grid',
    headStyles: { ...headStyles, halign: 'center' as const },
    bodyStyles,
    styles: { fontSize: 8, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0.05 },
    tableWidth,
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' as const },
      1: { cellWidth: 80, halign: 'left' as const },
      2: { cellWidth: 50, halign: 'right' as const },
      3: { cellWidth: 40, halign: 'right' as const },
    },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || tableStartY + 20;

  // Signatures (keeping exact original signature layout)
  if (data.signatures && data.signatures.length > 0) {
    const pageHeight = doc.internal.pageSize.getHeight();
    let currentY = finalY + 12;

    if (currentY + 45 > pageHeight - 15) {
      doc.addPage();
      renderLetterhead(doc);
      currentY = 45;
    }

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);

    const sigCount = data.signatures.length;
    const contentWidth = pageWidth - 2 * marginSide;
    const colWidth = contentWidth / sigCount;

    data.signatures.forEach((sig, idx) => {
      const sigX = marginSide + idx * colWidth + colWidth / 2;
      doc.text(sig.title || 'Mengetahui,', sigX, currentY, { align: 'center' });
      doc.text('Pimpinan / Pejabat Berwenang', sigX, currentY + 4, { align: 'center' });
      doc.text('(____________________)', sigX, currentY + 24, { align: 'center' });
      doc.text(sig.name || sig.label || '-', sigX, currentY + 28, { align: 'center' });
    });
  }

  doc.save(`Proposal_Anggaran_${(data.reportName || 'Event').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}
