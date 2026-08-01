import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';
import { SATPAM_POSTS } from '@/lib/payroll/domain';

export type SatpamPdfEmployeeOption = {
  id: string;
  name: string;
};

export type SatpamPdfPlanDay = {
  dutyDate: string;
  shiftName: string;
  assignments: Array<{
    postId: string;
    employeeId: string;
  }>;
  offDutyEmployeeId: string;
};

export type GenerateSatpamDutyPlanPdfParams = {
  period: string; // e.g. "2026-08"
  ketuaShiftName: string;
  status: string; // e.g. "published"
  revision: number;
  employees: SatpamPdfEmployeeOption[];
  days: SatpamPdfPlanDay[];
};

function formatPeriodLabel(periodStr: string): string {
  const [year, month] = periodStr.split('-').map(Number);
  if (!year || !month) return periodStr;
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(Date.UTC(year, month - 1, 1))).toUpperCase();
}

function getIndonesianDayName(dateStr: string): string {
  try {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      timeZone: 'Asia/Jakarta',
    }).format(d);
  } catch {
    return '';
  }
}

function getEmployeeName(
  employees: readonly SatpamPdfEmployeeOption[],
  employeeId: string,
): string {
  if (!employeeId) return '-';
  const found = employees.find((emp) => emp.id === employeeId);
  return found?.name || employeeId;
}

export function generateSatpamDutyPlanPdf(
  params: GenerateSatpamDutyPlanPdfParams,
  saveToFile = true,
): jsPDF {
  const { period, ketuaShiftName, status, revision, employees, days } = params;

  // Initialize Landscape A4 (297mm x 210mm)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 297mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 210mm

  // ── 1. Letterhead Logos ──────────────────────────────────────────────────
  try {
    doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 12, 8, 20, 20);
    doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 35, 8, 20, 20);
  } catch {
    // Continue without logos if base64 render fails
  }

  // Header Title & Subtitle
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59); // Slate-800
  doc.text("YAYASAN PETINGGI ISLAM DARUL 'ULUM (YAPETIDU)", 60, 12);
  doc.setFontSize(11);
  doc.text('SATUAN PENGAMANAN (SATPAM) — UNIPDU JOMBANG', 60, 17);
  doc.setFontSize(12);
  doc.setTextColor(79, 70, 229); // Indigo-600
  doc.text(`JADWAL TUGAS REGU SATPAM & ROTASI SHIFT`, 60, 23);

  // Metadata Bar Below Header
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105); // Slate-600
  const statusFormatted =
    status === 'published' ? 'Dipublikasikan' : status.toUpperCase();
  const printTimestamp = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date());

  doc.text(
    `PERIODE: ${formatPeriodLabel(period)}   |   KETUA SHIFT: ${ketuaShiftName || '-'}   |   STATUS: ${statusFormatted} (Versi ${revision})`,
    12,
    32,
  );
  doc.setFontSize(8);
  doc.text(`Dicetak: ${printTimestamp} WIB`, pageWidth - 12, 32, {
    align: 'right',
  });

  // Top Horizontal Divider Line
  doc.setDrawColor(226, 232, 240); // Slate-200
  doc.setLineWidth(0.5);
  doc.line(12, 34, pageWidth - 12, 34);

  // ── 2. Schedule Table Generation (Post x Date Matrix) ────────────────────
  const dateHeaders = days.map(
    (d) => `${d.dutyDate.slice(8, 10)}/${d.dutyDate.slice(5, 7)}`,
  );
  const tableHeaders = ['No. Pos', ...dateHeaders];

  const postDefinitions = [
    { id: 'Pos 1', label: 'Pos 1 IC' },
    { id: 'Pos 8', label: 'Pos 8 Parkiran FIK' },
    { id: 'Pos 6', label: 'Pos 6 Gor' },
    { id: 'Pos 5', label: 'Pos 5 Masjid Induk' },
    { id: 'Pos 7', label: 'Pos 7 Saintek' },
    { id: 'Pos 4', label: 'Pos 4 Plaza' },
    { id: 'Pos 3', label: 'Pos 3 ATM Graha' },
    { id: 'Pos 9', label: 'Pos 9 Hurun-inn' },
    { id: 'Pos 2', label: 'Pos 2 Stasiun' },
    { id: 'Off-Duty', label: 'Libur' },
  ];

  const tableRows = postDefinitions.map((postDef) => {
    const rowValues = days.map((day) => {
      if (postDef.id === 'Off-Duty') {
        const name = getEmployeeName(employees, day.offDutyEmployeeId || '');
        return name.toUpperCase();
      }
      const assignment = day.assignments.find(
        (a) =>
          a.postId === postDef.id ||
          a.postId === postDef.label ||
          (postDef.id === 'Pos 1' && a.postId === 'Pos 1 IC') ||
          (postDef.id === 'Pos 9' && a.postId === 'Pos 9 IC'),
      );
      const name = getEmployeeName(employees, assignment?.employeeId || '');
      return name.toUpperCase();
    });

    return [postDef.label, ...rowValues];
  });

  autoTable(doc, {
    startY: 37,
    head: [tableHeaders],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [77, 208, 225], // Cyan / Light Teal header matching screenshot
      textColor: [0, 0, 0],
      fontSize: 6.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
    },
    bodyStyles: {
      fontSize: 5.5,
      textColor: [0, 0, 0],
      valign: 'middle',
      halign: 'center',
      cellPadding: 0.8,
    },
    columnStyles: {
      0: { fontStyle: 'bold', halign: 'left', cellWidth: 32 }, // No. Pos column
    },
    alternateRowStyles: {
      fillColor: [240, 253, 250], // Soft cyan tint
    },
    margin: { left: 10, right: 10, top: 37, bottom: 15 },
    didDrawPage: (data) => {
      // Footer page numbering
      const totalPages = (doc as any).internal.getNumberOfPages();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // Slate-400
      doc.text(
        `Halaman ${data.pageNumber} dari ${totalPages}`,
        pageWidth - 10,
        pageHeight - 6,
        { align: 'right' },
      );
      doc.text(
        'Sistem Keuangan & Operasional Satpam — YAPETIDU',
        10,
        pageHeight - 6,
      );
    },
  });

  if (saveToFile) {
    const filename = `Jadwal_Regu_Satpam_${period.replace('-', '_')}.pdf`;
    doc.save(filename);
  }

  return doc;
}
