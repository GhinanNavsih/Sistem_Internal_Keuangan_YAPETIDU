import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { REKAP_COLUMNS, MONTHS_ID } from '@/utils/rekapConfig';
import type { RekapColumn } from '@/types';

// ─── Public employee interface ────────────────────────────────────────────────
export interface KebersihanyEmployee {
  no: number;
  name: string;
  /** Raw monetary / count values keyed by RekapColumn.key */
  values: Record<string, number>;
  counts?: Record<string, number>;
}

export interface RekapPresensiKebersihanySignature {
  name: string;
  title: string;
}

export interface RekapPresensiKebersihanyData {
  /** e.g. "Mei 2026" */
  period: string;
  /** Active category — drives which columns to render */
  category: string;
  employees: KebersihanyEmployee[];
  isEmptyTemplate?: boolean;
  customColumns?: RekapColumn[];
  /** Up to 3 signature spots. Falls back to a per-category default when omitted/empty. */
  signatures?: RekapPresensiKebersihanySignature[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtRp = (n: number): string => {
  if (n === 0) return 'Rp          -';
  return 'Rp  ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
};

const fmtCount = (n: number): string => (n === 0 ? '-' : String(n));

/** Fetch a public-folder image and return a base64 data-URL. */
async function loadImageAsDataUrl(publicPath: string): Promise<string> {
  const res = await fetch(publicPath);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Main export function (async because of logo loading) ────────────────────

export async function generateRekapPresensiKebersihanyPdf(
  data: RekapPresensiKebersihanyData
): Promise<void> {
  // ── Resolve columns from config — only what's in the preview table ──────────
  const baseCols = REKAP_COLUMNS[data.category] ?? REKAP_COLUMNS['KEBERSIHAN'];
  const activeCols: RekapColumn[] = [...baseCols, ...(data.customColumns || [])];

  // ── Load logos ──────────────────────────────────────────────────────────────
  let logoYapetidu: string | null = null;
  let logoUnipdu: string | null = null;
  try {
    [logoYapetidu, logoUnipdu] = await Promise.all([
      loadImageAsDataUrl('/Logo YAPETIDU (Transparent bg).png'),
      loadImageAsDataUrl('/Logo UNIPDU.png'),
    ]);
  } catch {
    // If logos fail to load, continue without them
  }

  // ── Create document ─────────────────────────────────────────────────────────
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = doc.internal.pageSize.getWidth();
  const marginL = 10;
  const marginR = 10;

  // ── Header logos (side by side, left of the title block) ───────────────────
  const logoSize = 18; // mm × mm (square bounding box)
  const logoY = 8;

  if (logoYapetidu) {
    doc.addImage(logoYapetidu, 'PNG', marginL, logoY, logoSize, logoSize);
  }
  if (logoUnipdu) {
    doc.addImage(logoUnipdu, 'PNG', marginL + logoSize + 2, logoY, logoSize, logoSize);
  }

  // ── Title block (centred) ───────────────────────────────────────────────────
  let y = logoY + 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  const catLabel = data.category.replace('_', ' ').toUpperCase();
  doc.text(
    `REKAPITULASI  PRESENSI  BAGIAN  ${catLabel}`,
    pageW / 2,
    y,
    { align: 'center' }
  );
  y += 6;
  doc.setFontSize(9.5);
  doc.text(
    "UNIVERSITAS  PESANTREN  TINGGI  DARUL  'ULUM",
    pageW / 2,
    y,
    { align: 'center' }
  );
  y += 6;
  doc.setFontSize(9);
  doc.text(`BULAN  ${data.period.toUpperCase()}`, pageW / 2, y, {
    align: 'center',
  });
  y += 8; // gap before table (no divider line)

  // ── Build table head ────────────────────────────────────────────────────────
  const headCells = [
    {
      content: 'No',
      styles: { halign: 'center' as const, valign: 'middle' as const },
    },
    {
      content: 'Nama',
      styles: { halign: 'center' as const, valign: 'middle' as const },
    },
    ...activeCols.map((col) => {
      const title = col.type === 'count' && col.multiplier
        ? `${col.label}\n(xRp${col.multiplier.toLocaleString('id-ID')})`
        : col.label;
      return {
        content: title,
        styles: { halign: 'center' as const, valign: 'middle' as const },
      };
    }),
  ];

  if (!data.isEmptyTemplate) {
    headCells.push({
      content: 'Jumlah',
      styles: { halign: 'center' as const, valign: 'middle' as const },
    });
  }

  const head: any[][] = [headCells];

  // ── Build table body ────────────────────────────────────────────────────────
  const totals: Record<string, number> = {};
  activeCols.forEach((col) => (totals[col.key] = 0));
  let totGrand = 0;

  const bodyRows: any[][] = data.employees.map((emp) => {
    let rowTotal = 0;
    const cells: any[] = [
      { content: String(emp.no), styles: { halign: 'center' as const } },
      {
        content: emp.name,
        styles: { halign: 'left' as const, fontStyle: 'bold' as const },
      },
    ];

    activeCols.forEach((col) => {
      if (data.isEmptyTemplate) {
        cells.push({
          content: '',
          styles: { halign: col.type === 'count' ? ('center' as const) : ('right' as const) },
        });
      } else {
        const raw = emp.values[col.key] ?? 0;
        const countVal = emp.counts?.[col.key] ?? 0;

        if (col.type === 'count') {
          const rate = col.multiplier ?? 1;
          const count = emp.counts ? countVal : (raw > 31 ? Math.round(raw / rate) : raw);
          const monetary = emp.counts ? raw : (raw > 31 ? raw : raw * rate);
          totals[col.key] += monetary;
          rowTotal += monetary;
          cells.push({
            content: fmtCount(count),
            styles: { halign: 'center' as const },
          });
        } else {
          totals[col.key] += raw;
          rowTotal += raw;
          cells.push({
            content: fmtRp(raw),
            styles: { halign: 'right' as const },
          });
        }
      }
    });

    if (!data.isEmptyTemplate) {
      totGrand += rowTotal;
      cells.push({
        content: fmtRp(rowTotal),
        styles: { halign: 'right' as const, fontStyle: 'bold' as const },
      });
    }

    return cells;
  });

  if (!data.isEmptyTemplate) {
    // ── Grand total footer row ─────────────────────────────────────────────────
    const totalRowCells: any[] = [
      { content: '', styles: { halign: 'center' as const } },
      {
        content: 'JUMLAH',
        styles: { halign: 'left' as const, fontStyle: 'bold' as const },
      },
    ];

    activeCols.forEach((col) => {
      const tot = totals[col.key] ?? 0;
      if (col.type === 'count') {
        const rate = col.multiplier ?? 1;
        const totCount = tot > 31 ? Math.round(tot / rate) : tot;
        const totMonetary = tot > 31 ? tot : tot * rate;
        // Show monetary sum (Rp) in the total row for count columns
        totalRowCells.push({
          content: fmtRp(totMonetary),
          styles: { halign: 'right' as const, fontStyle: 'bold' as const },
        });
      } else {
        totalRowCells.push({
          content: fmtRp(tot),
          styles: { halign: 'right' as const, fontStyle: 'bold' as const },
        });
      }
    });

    totalRowCells.push({
      content: fmtRp(totGrand),
      styles: { halign: 'right' as const, fontStyle: 'bold' as const },
    });

    bodyRows.push(totalRowCells);
  }

  // ── Column widths ──────────────────────────────────────────────────────────
  const usableWidth = pageW - marginL - marginR - 2.5; // subtract 2.5mm safety margin to prevent jspdf-autotable overflow warnings
  const fixedWidth = data.isEmptyTemplate ? (8 + 40) : (8 + 40 + 32);
  const dynColWidth = Math.floor(((usableWidth - fixedWidth) / activeCols.length) * 100) / 100; // floor to 2 decimal places

  const columnStyles: Record<number, any> = {
    0: { cellWidth: 8, halign: 'center' as const },
    1: { cellWidth: 40 },
  };
  activeCols.forEach((col, i) => {
    columnStyles[i + 2] = {
      cellWidth: dynColWidth,
      halign: col.type === 'count' ? ('center' as const) : ('right' as const),
    };
  });
  if (!data.isEmptyTemplate) {
    columnStyles[activeCols.length + 2] = { cellWidth: 32, halign: 'right' as const };
  }

  // ── Render table ───────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: head as any,
    body: bodyRows as any,
    theme: 'grid',
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.3,
      lineColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center',
      valign: 'middle',
      minCellHeight: 10,
    },
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 2, right: 2.5, bottom: 2, left: 2.5 },
      lineColor: [0, 0, 0],
      lineWidth: 0.3,
      textColor: [0, 0, 0],
      overflow: 'linebreak',
    },
    columnStyles,
    margin: { left: marginL, right: marginR },
    willDrawCell: (data) => {
      if (data.row.section === 'head' && data.column.index >= 2) {
        const col = activeCols[data.column.index - 2];
        if (col && col.type === 'count' && col.multiplier) {
          data.cell.text = []; // Clear standard text drawing
        }
      }
    },
    didDrawCell: (data) => {
      if (data.row.section === 'head' && data.column.index >= 2) {
        const col = activeCols[data.column.index - 2];
        if (col && col.type === 'count' && col.multiplier) {
          const cell = data.cell;
          const doc = data.doc;
          
          const padding = cell.styles.cellPadding as any;
          const leftPadding = typeof padding === 'object' ? padding.left ?? 0 : (typeof padding === 'number' ? padding : 0);
          const rightPadding = typeof padding === 'object' ? padding.right ?? 0 : (typeof padding === 'number' ? padding : 0);
          const maxTextWidth = cell.width - (leftPadding + rightPadding);
          const titleLines = doc.splitTextToSize(col.label, maxTextWidth);
          const multText = `(xRp${col.multiplier.toLocaleString('id-ID')})`;
          
          const titleLineHeight = 3.2;
          const multLineHeight = 3.0;
          const totalTextHeight = (titleLines.length * titleLineHeight) + multLineHeight;
          
          let currentY = cell.y + (cell.height - totalTextHeight) / 2 + 2.5;
          const textX = cell.x + cell.width / 2;
          
          // Draw label in black and bold
          doc.setTextColor(0, 0, 0);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          titleLines.forEach((line: string) => {
            doc.text(line, textX, currentY, { align: 'center' });
            currentY += titleLineHeight;
          });
          
          // Draw multiplier in blue and italic
          doc.setTextColor(29, 78, 216); // text-blue-700 equivalent: RGB [29, 78, 216]
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(7);
          doc.text(multText, textX, currentY, { align: 'center' });
        }
      }
    },
  });

  // ── Signature block ────────────────────────────────────────────────────────
  const tableEnd = (doc as any).lastAutoTable.finalY + 8;
  const monthsId = MONTHS_ID;
  const now = new Date();
  const dateStr = `Jombang, ${now.getDate()} ${monthsId[now.getMonth()]} ${now.getFullYear()}`;

  const isSatpam = data.category === 'SATPAM';
  const defaultSignatures: RekapPresensiKebersihanySignature[] = [
    {
      name: isSatpam ? 'H. Rohmatul Akbar, ST' : 'Harun Arrosyid, S. Pd. I',
      title: isSatpam ? 'Majlis Kamtib' : 'KA. Biro Administrasi Umum',
    },
  ];
  const signatures = data.signatures && data.signatures.length > 0 ? data.signatures : defaultSignatures;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(dateStr, pageW - marginR, tableEnd, { align: 'right' });

  const jabatanY = tableEnd + 6;
  const sigLineY = jabatanY + 24;
  doc.setLineWidth(0.4);

  const drawSig = (sig: RekapPresensiKebersihanySignature, x: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(sig.title, x, jabatanY, { align: 'center' });
    doc.line(x - 28, sigLineY, x + 28, sigLineY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(sig.name, x, sigLineY + 5, { align: 'center' });
  };

  if (signatures.length <= 1) {
    const sigX = pageW - marginR - 55;
    drawSig(signatures[0], sigX);
  } else {
    const blockL = marginL + 25;
    const blockR = pageW - marginR - 25;
    const step = (blockR - blockL) / (signatures.length - 1);
    signatures.forEach((sig, i) => drawSig(sig, blockL + step * i));
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const safePeriod = data.period.replace(/\s+/g, '_');
  const filename = data.isEmptyTemplate 
    ? `Template_Kosong_${data.category}_${safePeriod}.pdf`
    : `Rekap_Presensi_${data.category}_${safePeriod}.pdf`;
  doc.save(filename);
}
