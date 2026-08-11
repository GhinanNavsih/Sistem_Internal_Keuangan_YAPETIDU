import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_UNIPDU_BASE64 } from './logoConstants';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface PelaporanKegiatanSignature {
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

export interface PelaporanKegiatanPdfData {
  reportName: string;
  period: string;
  departmentUnit: string;
  signatures: PelaporanKegiatanSignature[];
  // Section toggles
  realisasiEnabled: boolean;
  vakasiPengujiEnabled: boolean;
  kepanitiaaanEnabled: boolean;
  receiptEnabled: boolean;
  // Section 1
  realisasiTitle: string;
  realisasiRows?: RealisasiRow[];
  pemasukanRows?: any[];
  pengeluaranRows?: any[];
  yayasanPercentage?: number;
  unipduPercentage?: number;
  kepanitiaaanPercentage: number;
  // Section 2
  vakasiPengujiTitle: string;
  vakasiRoles: VakasiRole[];
  vakasiPengujiRows: VakasiPengujiRow[];
  // Section 3
  kepanitiaaanTitle: string;
  kepanitiaaanPhases: KepanitiaaanPhase[];
  kepanitiaaanRows: KepanitiaaanRow[];
  // Section 4
  receiptTitle: string;
  receiptRows: ReceiptRow[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const formatIDR = (amount: number): string => {
  return 'Rp' + new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const parseQty = (q: string): number => {
  if (!q) return 0;
  const trimmed = q.trim();

  // Split by 'x', 'X', or '*'
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

// ── Shared Rendering Functions ──────────────────────────────────────────────

function renderLetterhead(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 15, 10, 22, 22);
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

function renderSignatures(doc: jsPDF, signatures: PelaporanKegiatanSignature[], startY: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const availableWidth = pageWidth - 2 * margin;
  const leftColX = margin + 30;
  const rightColX = pageWidth - margin - 25;
  const centerColX = pageWidth / 2;

  const sigCount = signatures.length;
  if (sigCount === 0) return;

  // Determine height needed and positions
  const heightNeeded = sigCount === 3 ? 50 : 35;

  let sigY = startY + 12;
  if (sigY + heightNeeded > pageHeight - 15) { // leave 15mm margin at the bottom
    doc.addPage();
    renderLetterhead(doc);
    sigY = 45;
  }

  // Draw signature helper
  const drawSig = (sig: PelaporanKegiatanSignature, x: number, y: number) => {
    let label = sig.label;
    let title = sig.title;

    if (label === 'Menyetujui,') {
      label = '';
      if (!title) {
        title = 'Wakil Rektor Bid. Keuangan, SDM dan Umum';
      }
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    if (label) {
      doc.text(label, x, y, { align: 'center' });
    }
    if (title && !label) {
      doc.text(title, x, y, { align: 'center' });
    }

    const nameY = y + 24;
    doc.setFont('helvetica', 'bold');
    doc.text(sig.name || '____________________', x, nameY, { align: 'center' });

    if (sig.name) {
      const textWidth = doc.getTextWidth(sig.name);
      doc.setLineWidth(0.25);
      doc.line(x - textWidth / 2, nameY + 0.8, x + textWidth / 2, nameY + 0.8);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const titleBelow = label ? title : '';
    if (titleBelow) {
      doc.text(titleBelow, x, nameY + 5, { align: 'center' });
    }
  };

  if (sigCount === 1) {
    doc.text('', 0, 0); // No-op to keep structure if needed, but not required
    drawSig(signatures[0], centerColX, sigY);
  } else if (sigCount === 2) {
    drawSig(signatures[0], leftColX, sigY);
    drawSig(signatures[1], rightColX, sigY);
  } else if (sigCount === 3) {
    // Row 1: 1st person (left) and 3rd person (right)
    drawSig(signatures[0], leftColX, sigY);
    drawSig(signatures[2], rightColX, sigY);
    // Row 2: 2nd person (center) - aligned with top row names
    drawSig(signatures[1], centerColX, sigY + 24);
  }
}

// ── Main Generator ──────────────────────────────────────────────────────────

export function generatePelaporanKegiatanPdf(data: PelaporanKegiatanPdfData, saveToFile = true): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [210, 330] });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginSide = 15;
  const tableWidth = pageWidth - 2 * marginSide;

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

  let isFirstPage = true;

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE: REALISASI KEUANGAN
  // ═══════════════════════════════════════════════════════════════════════════
  if (data.realisasiEnabled && ((data.pemasukanRows && data.pemasukanRows.length > 0) || (data.realisasiRows && data.realisasiRows.length > 0))) {
    if (!isFirstPage) doc.addPage();
    isFirstPage = false;

    renderLetterhead(doc);
    const tableStartY = renderTitle(doc, data.realisasiTitle || 'REALISASI', 45);

    const tableRows: any[] = [];

    if (data.pemasukanRows && data.pengeluaranRows) {
      // 1. Pemasukan Header
      tableRows.push([
        { content: '', styles: { fontStyle: 'bold' as const } },
        { content: 'PEMASUKAN', colSpan: 4, styles: { fontStyle: 'bold' as const } },
      ]);
      let pIdx = 0;
      data.pemasukanRows.forEach(row => {
        pIdx++;
        const anggaran = parseQty(row.rincianQty) * row.rincianRate;
        const rincianStr = row.rincianQty && row.rincianRate > 0 ? `${row.rincianQty}  x  ${formatIDR(row.rincianRate)}` : '';
        tableRows.push([
          pIdx.toString(),
          row.uraian,
          rincianStr,
          { content: formatIDR(anggaran), styles: { halign: 'right' as const } },
          { content: formatIDR(row.realisasi), styles: { halign: 'right' as const } }
        ]);
      });

      // Calculate totals for Pemasukan
      const totalPemasukanAnggaran = data.pemasukanRows.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
      const totalPemasukanRealisasi = data.pemasukanRows.reduce((sum, r) => sum + r.realisasi, 0);

      // 2. Dana Pengembangan Header
      tableRows.push([
        { content: '', styles: { fontStyle: 'bold' as const } },
        { content: 'Dana Pengembangan', colSpan: 4, styles: { fontStyle: 'bold' as const } },
      ]);
      const yayasanPct = data.yayasanPercentage ?? 20;
      const unipduPct = data.unipduPercentage ?? 20;
      const yayasanAnggaran = totalPemasukanAnggaran * (yayasanPct / 100);
      const yayasanRealisasi = totalPemasukanRealisasi * (yayasanPct / 100);
      const unipduAnggaran = totalPemasukanAnggaran * (unipduPct / 100);
      const unipduRealisasi = totalPemasukanRealisasi * (unipduPct / 100);

      tableRows.push([
        '',
        'Yayasan',
        `${yayasanPct}%  x  ${formatIDR(totalPemasukanAnggaran)}`,
        { content: formatIDR(yayasanAnggaran), styles: { halign: 'right' as const } },
        { content: formatIDR(yayasanRealisasi), styles: { halign: 'right' as const } }
      ]);
      tableRows.push([
        '',
        'UNIPDU',
        `${unipduPct}%  x  ${formatIDR(totalPemasukanAnggaran)}`,
        { content: formatIDR(unipduAnggaran), styles: { halign: 'right' as const } },
        { content: formatIDR(unipduRealisasi), styles: { halign: 'right' as const } }
      ]);

      // 3. Dana Operasional Header
      const totalPengembanganAnggaran = yayasanAnggaran + unipduAnggaran;
      const totalPengembanganRealisasi = yayasanRealisasi + unipduRealisasi;
      const danaOperasionalAnggaran = totalPemasukanAnggaran - totalPengembanganAnggaran;
      const danaOperasionalRealisasi = totalPemasukanRealisasi - totalPengembanganRealisasi;

      tableRows.push([
        { content: '', styles: { fontStyle: 'bold' as const } },
        { content: 'Dana Operasional', styles: { fontStyle: 'bold' as const } },
        '',
        { content: formatIDR(danaOperasionalAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const } },
        { content: formatIDR(danaOperasionalRealisasi), styles: { fontStyle: 'bold' as const, halign: 'right' as const } }
      ]);

      // 1 row gap
      tableRows.push([
        { content: '', styles: { minCellHeight: 5 } },
        { content: '', colSpan: 4, styles: { minCellHeight: 5 } }
      ]);

      // 4. Pengeluaran Header
      tableRows.push([
        { content: '', styles: { fontStyle: 'bold' as const } },
        { content: 'PENGELUARAN', colSpan: 4, styles: { fontStyle: 'bold' as const } },
      ]);
      let oIdx = 0;
      data.pengeluaranRows.forEach(row => {
        if (row.type === 'group_header') {
          oIdx = 0;
          tableRows.push([
            { content: '', styles: { fontStyle: 'bold' as const } },
            { content: row.uraian, colSpan: 4, styles: { fontStyle: 'bold' as const } },
          ]);
        } else {
          oIdx++;
          const anggaran = parseQty(row.rincianQty) * row.rincianRate;
          const rincianStr = row.rincianQty && row.rincianRate > 0 ? `${row.rincianQty}  x  ${formatIDR(row.rincianRate)}` : '';
          tableRows.push([
            oIdx.toString(),
            row.uraian,
            rincianStr,
            { content: formatIDR(anggaran), styles: { halign: 'right' as const } },
            { content: formatIDR(row.realisasi), styles: { halign: 'right' as const } }
          ]);
        }
      });

      // Summary rows for Pengeluaran
      const expItems = data.pengeluaranRows.filter(r => r.type === 'item');
      const jumlahAnggaran = expItems.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
      const jumlahRealisasi = expItems.reduce((sum, r) => sum + r.realisasi, 0);
      const kepPerc = data.kepanitiaaanPercentage / 100;
      const kepAnggaran = jumlahAnggaran * kepPerc;
      const kepRealisasi = jumlahAnggaran * kepPerc;
      const totalAnggaran = jumlahAnggaran + kepAnggaran;
      const totalRealisasi = jumlahRealisasi + kepRealisasi;

      const summaryFill = [240, 244, 255] as [number, number, number];
      tableRows.push(
        [{ content: '', styles: { fillColor: summaryFill } }, { content: 'Jumlah Pengeluaran', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(jumlahAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(jumlahRealisasi), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }],
        [{ content: '', styles: { fillColor: summaryFill } }, { content: `Kepanitiaan ${data.kepanitiaaanPercentage}% Pengeluaran`, colSpan: 2, styles: { halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(kepAnggaran), styles: { halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(kepRealisasi), styles: { halign: 'right' as const, fillColor: summaryFill } }],
        [{ content: '', styles: { fillColor: summaryFill } }, { content: 'TOTAL PENGELUARAN', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(totalAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(totalRealisasi), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }],
      );
    } else if (data.realisasiRows) {
      // Old fallback logic
      let itemNum = 0;
      data.realisasiRows.forEach((row) => {
        if (row.type === 'group_header') {
          itemNum = 0;
          tableRows.push([
            { content: '', styles: { fontStyle: 'bold' as const } },
            { content: row.uraian, colSpan: 4, styles: { fontStyle: 'bold' as const } },
          ]);
        } else {
          itemNum++;
          const anggaran = parseQty(row.rincianQty) * row.rincianRate;
          const rincianStr = row.rincianQty && row.rincianRate > 0 ? `${row.rincianQty}  x  ${formatIDR(row.rincianRate)}` : '';
          tableRows.push([
            itemNum.toString(),
            row.uraian,
            rincianStr,
            { content: formatIDR(anggaran), styles: { halign: 'right' as const } },
            { content: formatIDR(row.realisasi), styles: { halign: 'right' as const } },
          ]);
        }
      });

      const items = data.realisasiRows.filter(r => r.type === 'item');
      const jumlahAnggaran = items.reduce((sum, r) => sum + (parseQty(r.rincianQty) * r.rincianRate), 0);
      const jumlahRealisasi = items.reduce((sum, r) => sum + r.realisasi, 0);
      const kepPerc = data.kepanitiaaanPercentage / 100;
      const kepAnggaran = jumlahAnggaran * kepPerc;
      const kepRealisasi = jumlahAnggaran * kepPerc;
      const totalAnggaran = jumlahAnggaran + kepAnggaran;
      const totalRealisasi = jumlahRealisasi + kepRealisasi;

      const summaryFill = [240, 244, 255] as [number, number, number];
      tableRows.push(
        [{ content: '', styles: { fillColor: summaryFill } }, { content: 'Jumlah Pengeluaran', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(jumlahAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(jumlahRealisasi), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }],
        [{ content: '', styles: { fillColor: summaryFill } }, { content: `Kepanitiaan ${data.kepanitiaaanPercentage}% Pengeluaran`, colSpan: 2, styles: { halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(kepAnggaran), styles: { halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(kepRealisasi), styles: { halign: 'right' as const, fillColor: summaryFill } }],
        [{ content: '', styles: { fillColor: summaryFill } }, { content: 'TOTAL PENGELUARAN', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(totalAnggaran), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }, { content: formatIDR(totalRealisasi), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: summaryFill } }],
      );
    }

    autoTable(doc, {
      startY: tableStartY,
      margin: { left: marginSide, right: marginSide },
      head: [['NO', 'URAIAN', 'RINCIAN', 'ANGGARAN', 'REALISASI']],
      body: tableRows,
      theme: 'grid',
      headStyles: { ...headStyles, halign: 'center' as const },
      bodyStyles,
      styles: { fontSize: 8, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0.05 },
      tableWidth,
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' as const },
        1: { cellWidth: 50, halign: 'left' as const },
        2: { cellWidth: 60, halign: 'right' as const },
        3: { cellWidth: 30, halign: 'right' as const },
        4: { cellWidth: 30, halign: 'right' as const },
      },
    });

    const finalY = (doc as any).lastAutoTable.finalY || tableStartY + 20;
    renderSignatures(doc, data.signatures, finalY);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE: VAKASI PENGUJI
  // ═══════════════════════════════════════════════════════════════════════════
  if (data.vakasiPengujiEnabled && data.vakasiPengujiRows.length > 0) {
    if (!isFirstPage) doc.addPage();
    isFirstPage = false;

    renderLetterhead(doc);
    const tableStartY = renderTitle(doc, data.vakasiPengujiTitle || 'VAKASI PENGUJI', 45);

    const headRow = ['No', 'Nama'];
    data.vakasiRoles.forEach(role => headRow.push(role.name));
    headRow.push('Jumlah');

    const tableRows: any[] = [];
    let grandTotal = 0;

    data.vakasiPengujiRows.forEach((row, idx) => {
      const rowData: any[] = [(idx + 1).toString(), row.employeeName];
      let rowTotal = 0;

      data.vakasiRoles.forEach(role => {
        const qty = row.roleQtys[role.name] || 0;
        const amount = qty * role.rate;
        rowTotal += amount;
        if (qty > 0) {
          rowData.push({ content: `${qty} Org x ${formatIDR(role.rate)} = ${formatIDR(amount)}`, styles: { halign: 'center' as const, fontSize: 7.5 } });
        } else {
          rowData.push('');
        }
      });

      grandTotal += rowTotal;
      rowData.push({ content: formatIDR(rowTotal), styles: { fontStyle: 'bold' as const, halign: 'right' as const } });
      tableRows.push(rowData);
    });

    const totalRow: any[] = [{ content: 'Jumlah', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'center' as const, fillColor: [240, 244, 255] } }];
    data.vakasiRoles.forEach(() => {
      totalRow.push({ content: '', styles: { fillColor: [240, 244, 255] } });
    });
    totalRow.push({ content: formatIDR(grandTotal), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [240, 244, 255] } });
    tableRows.push(totalRow);

    const nameWidth = 45;
    const noWidth = 10;
    const jumlahWidth = 30;
    const roleCount = data.vakasiRoles.length;
    const remainingWidth = tableWidth - noWidth - nameWidth - jumlahWidth;
    const roleColWidth = roleCount > 0 ? remainingWidth / roleCount : 30;

    const colStyles: any = {
      0: { cellWidth: noWidth, halign: 'center' as const },
      1: { cellWidth: nameWidth, halign: 'left' as const },
    };
    data.vakasiRoles.forEach((_, rIdx) => {
      colStyles[2 + rIdx] = { cellWidth: roleColWidth, halign: 'center' as const };
    });
    colStyles[2 + roleCount] = { cellWidth: jumlahWidth, halign: 'right' as const };

    autoTable(doc, {
      startY: tableStartY,
      margin: { left: marginSide, right: marginSide },
      head: [headRow.map(h => ({ content: h, styles: { halign: 'center' as const } }))],
      body: tableRows,
      theme: 'grid',
      headStyles: { ...headStyles, halign: 'center' as const },
      bodyStyles,
      styles: { fontSize: 7.5, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0.05 },
      tableWidth,
      columnStyles: colStyles,
    });

    const finalY = (doc as any).lastAutoTable.finalY || tableStartY + 20;
    renderSignatures(doc, data.signatures, finalY);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE: VAKASI KEPANITIAAN
  // ═══════════════════════════════════════════════════════════════════════════
  if (data.kepanitiaaanEnabled && data.kepanitiaaanRows.length > 0) {
    if (!isFirstPage) doc.addPage();
    isFirstPage = false;

    renderLetterhead(doc);
    const tableStartY = renderTitle(doc, data.kepanitiaaanTitle || 'VAKASI KEPANITIAAN', 45);

    const headRow = ['No', 'Nama'];
    data.kepanitiaaanPhases.forEach(phase => headRow.push(phase.name));
    headRow.push('Jumlah');

    const tableRows: any[] = [];
    let grandTotal = 0;

    data.kepanitiaaanRows.forEach((row, idx) => {
      const rowData: any[] = [(idx + 1).toString(), row.name];
      let rowTotal = 0;

      data.kepanitiaaanPhases.forEach(phase => {
        const amount = row.phaseAmounts[phase.name] || 0;
        rowTotal += amount;
        rowData.push({ content: amount > 0 ? formatIDR(amount) : '', styles: { halign: 'right' as const } });
      });

      grandTotal += rowTotal;
      rowData.push({ content: formatIDR(rowTotal), styles: { fontStyle: 'bold' as const, halign: 'right' as const } });
      tableRows.push(rowData);
    });

    const totalRow: any[] = [{ content: 'Total', colSpan: 2, styles: { fontStyle: 'bold' as const, halign: 'center' as const, fillColor: [240, 244, 255] } }];
    data.kepanitiaaanPhases.forEach(() => {
      totalRow.push({ content: '', styles: { fillColor: [240, 244, 255] } });
    });
    totalRow.push({ content: formatIDR(grandTotal), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [240, 244, 255] } });
    tableRows.push(totalRow);

    const phaseCount = data.kepanitiaaanPhases.length;
    const noW = 10;
    const nameW = 50;
    const jumlahW = 30;
    const remainingW = tableWidth - noW - nameW - jumlahW;
    const phaseColW = phaseCount > 0 ? remainingW / phaseCount : 30;

    const colStyles: any = {
      0: { cellWidth: noW, halign: 'center' as const },
      1: { cellWidth: nameW, halign: 'left' as const },
    };
    data.kepanitiaaanPhases.forEach((_, pIdx) => {
      colStyles[2 + pIdx] = { cellWidth: phaseColW, halign: 'right' as const };
    });
    colStyles[2 + phaseCount] = { cellWidth: jumlahW, halign: 'right' as const };

    autoTable(doc, {
      startY: tableStartY,
      margin: { left: marginSide, right: marginSide },
      head: [headRow.map(h => ({ content: h, styles: { halign: 'center' as const } }))],
      body: tableRows,
      theme: 'grid',
      headStyles: { ...headStyles, halign: 'center' as const },
      bodyStyles,
      styles: { fontSize: 8, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.05 },
      tableWidth,
      columnStyles: colStyles,
    });

    const finalY = (doc as any).lastAutoTable.finalY || tableStartY + 20;
    renderSignatures(doc, data.signatures, finalY);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE: KWITANSI / RECEIPTS
  // ═══════════════════════════════════════════════════════════════════════════
  if (data.receiptEnabled && data.receiptRows.length > 0) {
    if (!isFirstPage) doc.addPage();
    isFirstPage = false;

    renderLetterhead(doc);
    const tableStartY = renderTitle(doc, data.receiptTitle || 'KWITANSI PEMBELIAN', 45);

    const tableRows: any[] = [];
    let grandTotal = 0;

    data.receiptRows.forEach((row, idx) => {
      const total = row.qty * row.unitPrice;
      grandTotal += total;
      tableRows.push([
        (idx + 1).toString(),
        row.itemName,
        row.qty.toString(),
        { content: formatIDR(row.unitPrice), styles: { halign: 'right' as const } },
        { content: formatIDR(total), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
      ]);
    });

    tableRows.push([
      { content: 'Grand Total', colSpan: 4, styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [240, 244, 255] } },
      { content: formatIDR(grandTotal), styles: { fontStyle: 'bold' as const, halign: 'right' as const, fillColor: [240, 244, 255] } },
    ]);

    autoTable(doc, {
      startY: tableStartY,
      margin: { left: marginSide, right: marginSide },
      head: [['NO', 'NAMA ITEM', 'QTY', 'HARGA SATUAN', 'TOTAL']],
      body: tableRows,
      theme: 'grid',
      headStyles: { ...headStyles, halign: 'center' as const },
      bodyStyles,
      styles: { fontSize: 8.5, cellPadding: 1.8, lineColor: [0, 0, 0], lineWidth: 0.05 },
      tableWidth,
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' as const },
        1: { cellWidth: 70, halign: 'left' as const },
        2: { cellWidth: 20, halign: 'center' as const },
        3: { cellWidth: 40, halign: 'right' as const },
        4: { cellWidth: 40, halign: 'right' as const },
      },
    });

    const finalY = (doc as any).lastAutoTable.finalY || tableStartY + 20;
    renderSignatures(doc, data.signatures, finalY);
  }

  // ── Page Numbers ──────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Halaman ${i} dari ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
  }

  if (saveToFile) {
    const sanitizedName = (data.reportName || 'Laporan').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const filename = `Pelaporan_${data.departmentUnit}_${sanitizedName}.pdf`;
    doc.save(filename);
  }

  return doc;
}
