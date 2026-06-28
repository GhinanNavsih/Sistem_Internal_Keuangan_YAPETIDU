import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PaySlipField } from './generatePaySlipPdf';

export interface LegalitasEmployeeData {
  employeeNo: number;
  nik: string;
  name: string;
  gapok: number;
  earnings: PaySlipField[];
  totalEarnings: number;
  deductions: PaySlipField[];
  totalDeductions: number;
  netSalary: number;
}

export interface LegalitasPimpinanData {
  jobCategory: string;
  period: string;
  employees: LegalitasEmployeeData[];
}

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

export async function generateLegalitasPimpinanPdf(data: LegalitasPimpinanData): Promise<void> {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [216, 330], // Folio paper dimensions (216x330mm)
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  const formatIDR = (amount: number): string => {
    if (amount === 0) return '-';
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Load logos
  let logoYapetidu: string | null = null;
  let logoUnipdu: string | null = null;
  try {
    [logoYapetidu, logoUnipdu] = await Promise.all([
      loadImageAsDataUrl('/Logo YAPETIDU (Transparent bg).png'),
      loadImageAsDataUrl('/Logo UNIPDU.png'),
    ]);
  } catch {
    // Continue without logos
  }

  const hasLogos = !!(logoYapetidu && logoUnipdu);
  const marginLeft = hasLogos ? 48 : 5;
  let y = hasLogos ? 13 : 15;

  if (logoYapetidu) {
    doc.addImage(logoYapetidu, 'PNG', 5, 8, 18, 18);
  }
  if (logoUnipdu) {
    doc.addImage(logoUnipdu, 'PNG', 25, 8, 18, 18);
  }

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('UNIVERSITAS PESANTREN TINGGI DARUL ULUM', marginLeft, y);
  y += 5;
  doc.text(`VAKASI ${data.jobCategory.toUpperCase()}`, marginLeft, y);
  y += 8;
  doc.text(`BULAN ${data.period.toUpperCase()}`, marginLeft, y);
  y += 10;

  // Find all unique earnings and deductions labels across all employees
  const earningLabelsSet = new Set<string>();
  const deductionLabelsSet = new Set<string>();

  data.employees.forEach(emp => {
    emp.earnings.forEach(e => {
      if (e.label !== 'Gapok' && e.label !== 'Gaji Pokok') {
        earningLabelsSet.add(e.label);
      }
    });
    emp.deductions.forEach(d => deductionLabelsSet.add(d.label));
  });

  const earningLabels = Array.from(earningLabelsSet);
  const deductionLabels = Array.from(deductionLabelsSet);

  // Body data
  const body = data.employees.map(emp => {
    const row: any[] = [];
    row.push(emp.employeeNo.toString());
    row.push(emp.name);
    row.push(formatIDR(emp.gapok));

    // Earnings
    earningLabels.forEach(label => {
      const field = emp.earnings.find(e => e.label === label);
      row.push(field ? formatIDR(field.amount) : '-');
    });

    row.push(formatIDR(emp.totalEarnings));

    // Deductions
    deductionLabels.forEach(label => {
      const field = emp.deductions.find(d => d.label === label);
      row.push(field ? formatIDR(field.amount) : '-');
    });

    row.push(formatIDR(emp.totalDeductions));
    row.push(formatIDR(emp.netSalary));

    return row;
  });

  // Calculate totals for specific columns
  const totalJumlah = data.employees.reduce((sum, emp) => sum + emp.totalEarnings, 0);
  const totalPotongan = data.employees.reduce((sum, emp) => sum + emp.totalDeductions, 0);
  const totalGajiBersih = data.employees.reduce((sum, emp) => sum + emp.netSalary, 0);

  // Push total row
  const totalRow: any[] = [];
  totalRow.push(''); // NO
  totalRow.push('TOTAL'); // NAMA
  totalRow.push(''); // GAPOK

  earningLabels.forEach(() => {
    totalRow.push('');
  });
  totalRow.push(formatIDR(totalJumlah));

  deductionLabels.forEach(() => {
    totalRow.push('');
  });
  totalRow.push(formatIDR(totalPotongan));
  totalRow.push(formatIDR(totalGajiBersih));

  body.push(totalRow);

  const head = [
    [
      { content: 'NO', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'NAMA', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'GAPOK', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'VAKASI', colSpan: earningLabels.length, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'JUMLAH', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'POTONGAN', colSpan: deductionLabels.length, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'JUMLAH POTONGAN', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } },
      { content: 'GAJI BERSIH', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const } }
    ],
    [
      ...earningLabels.map(l => ({ content: l.toUpperCase(), styles: { halign: 'center' as const, valign: 'middle' as const } })),
      ...deductionLabels.map(l => ({ content: l.toUpperCase(), styles: { halign: 'center' as const, valign: 'middle' as const } }))
    ]
  ];

  autoTable(doc, {
    startY: y,
    margin: { left: 5, right: 5 },
    head: head as any,
    body: body as any,
    theme: 'grid',
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 7,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
    },
    styles: {
      fontSize: 7,
      cellPadding: 1.2,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
    },
    columnStyles: {
      0: { halign: 'center' }, // NO
      1: { halign: 'left' },   // NAMA
      2: { halign: 'center' }, // GAPOK
    },
    didParseCell: (data) => {
      // Body columns alignment
      if (data.section === 'body' && data.column.index > 1) {
        data.cell.styles.halign = 'center';
      }
      // Bold styling
      if (data.section === 'body') {
        const isLastRow = data.row.index === body.length - 1;
        if (isLastRow) {
          data.cell.styles.fontStyle = 'bold';
        } else {
          const isJumlah = data.column.index === 3 + earningLabels.length;
          const isJumlahPotongan = data.column.index === 3 + earningLabels.length + 1 + deductionLabels.length;
          const isGajiBersih = data.column.index === 3 + earningLabels.length + 1 + deductionLabels.length + 1;
          if (isJumlah || isJumlahPotongan || isGajiBersih) {
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    }
  });

  const filename = `Legalitas_Pimpinan_${data.jobCategory}_${data.period.replace(/\s+/g, '_')}.pdf`;

  // ─── Signatures ──────────────────────────────────────────────
  const finalY = (doc as any).lastAutoTable.finalY + 15;
  const signatureY = finalY + 30;
  const colWidth = pageWidth / 3;

  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const month = monthNames[today.getMonth()];
  const year = today.getFullYear();
  const dateStr = `Jombang, ${day} ${month} ${year}`;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  // Left: Rektor
  doc.text('Rektor', 8, finalY);
  doc.setFont('helvetica', 'bold');
  doc.text("Dr. dr. H.M. Zulfikar As'ad, MMR.", 8, signatureY);

  // Center: Wakil Rektor
  doc.setFont('helvetica', 'normal');
  doc.text('Wakil Rektor Bidang SDM, Keuangan dan Umum', pageWidth / 2, finalY, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text('Dr. Hj. Uswatun Qoyyimah, SS., M. Ed., Ph.D', pageWidth / 2, signatureY, { align: 'center' });

  // Right: Majlis Kamtib or Ketua Biro Administrasi Umum
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, pageWidth - 8, finalY - 5, { align: 'right' });

  const isSatpam = data.jobCategory.toUpperCase() === 'SATPAM';
  const rightTitle = isSatpam ? 'Majlis Kamtib' : 'Ketua Biro Administrasi Umum';
  const rightName = isSatpam ? 'H. Rohmatul Akbar, ST' : 'Ahmad Arif S. AB.';

  doc.text(rightTitle, pageWidth - 8, finalY, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.text(rightName, pageWidth - 8, signatureY, { align: 'right' });

  doc.save(filename);
}
