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

  // ── 2. Schedule Table Generation ──────────────────────────────────────────
  const postIds = [
    'Pos 1',
    'Pos 2',
    'Pos 3',
    'Pos 4',
    'Pos 5',
    'Pos 6',
    'Pos 7',
    'Pos 8',
    'Pos 9 IC',
  ];

  const tableHeaders = [
    'No',
    'Tanggal',
    'Hari',
    'Shift',
    'Pos 1',
    'Pos 2',
    'Pos 3',
    'Pos 4',
    'Pos 5',
    'Pos 6',
    'Pos 7',
    'Pos 8',
    'Pos 9 IC',
    'Libur (Off)',
  ];

  const tableRows = days.map((day, index) => {
    const dayName = getIndonesianDayName(day.dutyDate);
    const postMap = new Map<string, string>();
    day.assignments.forEach((assignment) => {
      postMap.set(assignment.postId, assignment.employeeId);
    });

    const pos1 = getEmployeeName(employees, postMap.get('Pos 1') || '');
    const pos2 = getEmployeeName(employees, postMap.get('Pos 2') || '');
    const pos3 = getEmployeeName(employees, postMap.get('Pos 3') || '');
    const pos4 = getEmployeeName(employees, postMap.get('Pos 4') || '');
    const pos5 = getEmployeeName(employees, postMap.get('Pos 5') || '');
    const pos6 = getEmployeeName(employees, postMap.get('Pos 6') || '');
    const pos7 = getEmployeeName(employees, postMap.get('Pos 7') || '');
    const pos8 = getEmployeeName(employees, postMap.get('Pos 8') || '');
    const pos9 = getEmployeeName(employees, postMap.get('Pos 9 IC') || '');
    const offDuty = getEmployeeName(employees, day.offDutyEmployeeId || '');

    return [
      String(index + 1),
      day.dutyDate,
      dayName,
      `Shift ${day.shiftName}`,
      pos1,
      pos2,
      pos3,
      pos4,
      pos5,
      pos6,
      pos7,
      pos8,
      pos9,
      offDuty,
    ];
  });

  autoTable(doc, {
    startY: 37,
    head: [tableHeaders],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59], // Slate-800
      textColor: 255,
      fontSize: 7.5,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
    },
    bodyStyles: {
      fontSize: 7,
      textColor: [30, 41, 59],
      valign: 'middle',
      cellPadding: 1.2,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 }, // No
      1: { halign: 'center', cellWidth: 18 }, // Tanggal
      2: { halign: 'center', cellWidth: 16 }, // Hari
      3: { halign: 'center', cellWidth: 16, fontStyle: 'bold' }, // Shift
      4: { cellWidth: 20 }, // Pos 1
      5: { cellWidth: 20 }, // Pos 2
      6: { cellWidth: 20 }, // Pos 3
      7: { cellWidth: 20 }, // Pos 4
      8: { cellWidth: 20 }, // Pos 5
      9: { cellWidth: 20 }, // Pos 6
      10: { cellWidth: 20 }, // Pos 7
      11: { cellWidth: 20 }, // Pos 8
      12: { cellWidth: 24, fontStyle: 'bold' }, // Pos 9 IC
      13: {
        cellWidth: 28,
        fontStyle: 'italic',
        fillColor: [254, 243, 199], // Amber-100 highlight for Off-Duty
      },
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252], // Slate-50
    },
    margin: { left: 12, right: 12, top: 37, bottom: 25 },
    didDrawPage: (data) => {
      // Footer page numbering
      const totalPages = (doc as any).internal.getNumberOfPages();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // Slate-400
      doc.text(
        `Halaman ${data.pageNumber} dari ${totalPages}`,
        pageWidth - 12,
        pageHeight - 8,
        { align: 'right' },
      );
      doc.text(
        'Sistem Keuangan & Operasional Satpam — YAPETIDU',
        12,
        pageHeight - 8,
      );
    },
  });

  if (saveToFile) {
    const filename = `Jadwal_Regu_Satpam_${period.replace('-', '_')}.pdf`;
    doc.save(filename);
  }

  return doc;
}
