import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';
import {
  formatHours,
  formatKm,
  formatPlanSpan,
  formatRupiah,
  SIMULATION_START_LABEL,
  tollLineLabel,
  upahBersihLines,
  type SimulationView,
} from '@/lib/driverJourneySimulation';

const MARGIN = 15;

/** jsPDF's built-in fonts cover Latin-1 only; swap the few characters outside it. */
function pdfText(value: string): string {
  return value.replace(/→/g, '>').replace(/[–—]/g, '-');
}

function formatCalculatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

/**
 * The printout of a Simulasi Biaya Perjalanan for an event's budget: every
 * Perjalanan with its route, times, Biaya BBM, toll, parking and the Upah
 * Bersih broken into its parts, then the grand total, so whoever reviews the
 * budget can check every number.
 */
export function generateSimulasiBiayaPerjalananPdf(simulation: SimulationView, saveToFile = true): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const tableWidth = pageWidth - 2 * MARGIN;

  doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', MARGIN, 10, 22, 22);
  doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 40, 10, 22, 22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG', 67, 14);
  doc.setFontSize(11);
  doc.text('SIMULASI BIAYA PERJALANAN', 67, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const eventLines = doc.splitTextToSize(pdfText(`Kegiatan: ${simulation.eventName}`), pageWidth - 67 - MARGIN);
  doc.text(eventLines, 67, 26);
  let y = 26 + eventLines.length * 4.5;
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  doc.text(`Dihitung pada ${formatCalculatedAt(simulation.calculatedAt)} WIB`, 67, y);
  doc.setTextColor(0, 0, 0);
  y = Math.max(y + 6, 38);

  if (simulation.note) {
    const noteLines = doc.splitTextToSize(pdfText(`Catatan: ${simulation.note}`), tableWidth);
    doc.setFontSize(9);
    doc.text(noteLines, MARGIN, y);
    y += noteLines.length * 4.2 + 2;
  }

  const tableStyles = {
    theme: 'grid' as const,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth,
    styles: { fontSize: 8.5, cellPadding: 2, lineColor: [0, 0, 0] as [number, number, number], lineWidth: 0.15, textColor: [0, 0, 0] as [number, number, number] },
    columnStyles: {
      0: { cellWidth: tableWidth - 40 },
      1: { cellWidth: 40, halign: 'right' as const },
    },
  };

  simulation.journeys.forEach((journey, index) => {
    const route = [SIMULATION_START_LABEL.split(',')[0], ...journey.stops, SIMULATION_START_LABEL.split(',')[0]].join(' → ');
    const subtotal = (label: string, amount: number) => [
      { content: label, styles: { fontStyle: 'bold' as const, fillColor: [238, 242, 255] as [number, number, number] } },
      { content: formatRupiah(amount), styles: { fontStyle: 'bold' as const, fillColor: [238, 242, 255] as [number, number, number] } },
    ];
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [[
        { content: `Perjalanan ${index + 1} · ${journey.vehicleName}`, colSpan: 2, styles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold' } },
      ]],
      body: [
        [{ content: pdfText(`Rute: ${route}`), colSpan: 2 }],
        [{ content: pdfText(`Waktu: ${formatPlanSpan(journey)}`), colSpan: 2 }],
        [{
          content: `Jarak ${formatKm(journey.route.distanceKm)} · Durasi tempuh ${formatHours(journey.route.durationHours)} · Durasi perjalanan ${formatHours(journey.pay.journeyDurationHours)}`,
          colSpan: 2,
        }],
        [`Biaya BBM (${formatKm(journey.route.distanceKm)} × ${formatRupiah(journey.vehicleRate)}/km)`, formatRupiah(journey.fuelCost)],
        [tollLineLabel(journey), formatRupiah(journey.tollFee)],
        ['Parkir', formatRupiah(journey.parkingFee)],
        ...upahBersihLines(journey).map((line) => [`   ${line.label}`, formatRupiah(line.amount)]),
        subtotal('Upah Bersih sopir', journey.pay.upahBersih),
        subtotal(`Total Perjalanan ${index + 1}`, journey.total),
      ],
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  });

  autoTable(doc, {
    ...tableStyles,
    startY: y,
    body: [[
      { content: 'TOTAL BIAYA TRANSPORTASI', styles: { fontStyle: 'bold', fillColor: [224, 231, 255] } },
      { content: formatRupiah(simulation.grandTotal), styles: { fontStyle: 'bold', fillColor: [224, 231, 255] } },
    ]],
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  const footnote = doc.splitTextToSize(
    'Upah Bersih dihitung dengan aturan yang sama dengan laporan perjalanan sopir. Angka berlaku selama perjalanan berjalan sesuai rencana (rute, jam berangkat dan jam kembali).',
    tableWidth,
  );
  if (y + footnote.length * 3.5 > pageHeight - 15) {
    doc.addPage();
    y = 20;
  }
  doc.text(footnote, MARGIN, y);
  doc.setTextColor(0, 0, 0);

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(String(page), pageWidth - MARGIN, pageHeight - 10, { align: 'right' });
  }

  if (saveToFile) {
    const name = simulation.eventName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'Kegiatan';
    doc.save(`Simulasi_Biaya_Perjalanan_${name}.pdf`);
  }
  return doc;
}
