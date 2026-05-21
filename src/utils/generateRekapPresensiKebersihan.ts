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
}

export interface RekapPresensiKebersihanyData {
  /** e.g. "Mei 2026" */
  period: string;
  /** Active category — drives which columns to render */
  category: string;
  employees: KebersihanyEmployee[];
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
  const activeCols: RekapColumn[] =
    REKAP_COLUMNS[data.category] ?? REKAP_COLUMNS['KEBERSIHAN'];

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
  doc.text(
    'REKAPITULASI  PRESENSI  BAGIAN  KEBERSIHAN',
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
  const head: any[][] = [
    [
      {
        content: 'No',
        rowSpan: 2,
        styles: { halign: 'center' as const, valign: 'middle' as const },
      },
      {
        content: 'Nama',
        rowSpan: 2,
        styles: { halign: 'center' as const, valign: 'middle' as const },
      },
      ...activeCols.map((col) => ({
        content: col.label,
        rowSpan: 2,
        styles: { halign: 'center' as const, valign: 'middle' as const },
      })),
      {
        content: 'Jumlah',
        rowSpan: 2,
        styles: { halign: 'center' as const, valign: 'middle' as const },
      },
    ],
  ];

  // ── Build table body ────────────────────────────────────────────────────────
  const totals: Record<string, number> = {};
  activeCols.forEach((col) => (totals[col.key] = 0));
  let totGrand = 0;

  const bodyRows: any[][] = data.employees.map((emp) => {
    // Compute Rp total for this row (sum of all configured columns)
    let rowTotal = 0;
    const cells: any[] = [
      { content: String(emp.no), styles: { halign: 'center' as const } },
      {
        content: emp.name,
        styles: { halign: 'left' as const, fontStyle: 'bold' as const },
      },
    ];

    activeCols.forEach((col) => {
      const raw = emp.values[col.key] ?? 0;
      totals[col.key] += raw;

      if (col.type === 'count') {
        // raw may be stored as count or as monetary (count × rate)
        const rate = col.multiplier ?? 1;
        const count = raw > 31 ? Math.round(raw / rate) : raw;
        const monetary = raw > 31 ? raw : raw * rate;
        rowTotal += monetary;
        cells.push({
          content: fmtCount(count),
          styles: { halign: 'center' as const },
        });
      } else {
        rowTotal += raw;
        cells.push({
          content: fmtRp(raw),
          styles: { halign: 'right' as const },
        });
      }
    });

    totGrand += rowTotal;
    cells.push({
      content: fmtRp(rowTotal),
      styles: { halign: 'right' as const, fontStyle: 'bold' as const },
    });

    return cells;
  });

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

  // ── Column widths ──────────────────────────────────────────────────────────
  // Fixed: No (8), Nama (40), dynamic cols, Total (32)
  const usableWidth = pageW - marginL - marginR;
  const fixedWidth = 8 + 40 + 32;
  const dynColWidth = Math.floor((usableWidth - fixedWidth) / activeCols.length);

  const columnStyles: Record<number, any> = {
    0: { cellWidth: 8, halign: 'center' },
    1: { cellWidth: 40 },
  };
  activeCols.forEach((col, i) => {
    columnStyles[i + 2] = {
      cellWidth: dynColWidth,
      halign: col.type === 'count' ? 'center' : 'right',
    };
  });
  columnStyles[activeCols.length + 2] = { cellWidth: 32, halign: 'right' };

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
  });

  // ── Signature block ────────────────────────────────────────────────────────
  const tableEnd = (doc as any).lastAutoTable.finalY + 8;
  const monthsId = MONTHS_ID;
  const now = new Date();
  const dateStr = `Jombang, ${now.getDate()} ${monthsId[now.getMonth()]} ${now.getFullYear()}`;

  const sigX = pageW - marginR - 55;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(dateStr, sigX, tableEnd, { align: 'center' });
  doc.text('Mengetahui,', sigX, tableEnd + 5, { align: 'center' });

  // signature space
  const sigLineY = tableEnd + 30;
  doc.setLineWidth(0.4);
  doc.line(sigX - 28, sigLineY, sigX + 28, sigLineY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Harun Arrosyid, S. Pd. I', sigX, sigLineY + 5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('KA. Biro Administrasi Umum', sigX, sigLineY + 10, { align: 'center' });

  // ── Save ───────────────────────────────────────────────────────────────────
  const safePeriod = data.period.replace(/\s+/g, '_');
  doc.save(`Rekap_Presensi_Kebersihan_${safePeriod}.pdf`);
}
