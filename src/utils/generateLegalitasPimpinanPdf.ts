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

export function generateLegalitasPimpinanPdf(data: LegalitasPimpinanData): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  const formatIDR = (amount: number): string => {
    if (amount === 0) return '-';
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const marginLeft = 14;
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
      if (e.label !== 'Gapok') {
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
    head: head as any,
    body: body as any,
    theme: 'grid',
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 6,
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
    },
    styles: {
      fontSize: 6,
      cellPadding: 1.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
    },
    columnStyles: {
      0: { halign: 'center' }, // NO
      1: { halign: 'left' },   // NAMA
      2: { halign: 'right' },  // GAPOK
    },
    didParseCell: (data) => {
      // Body columns alignment
      if (data.section === 'body' && data.column.index > 1) {
        data.cell.styles.halign = 'right';
      }
      // Bold totals
      if (data.section === 'body') {
        const isJumlah = data.column.index === 3 + earningLabels.length;
        const isJumlahPotongan = data.column.index === 3 + earningLabels.length + 1 + deductionLabels.length;
        const isGajiBersih = data.column.index === 3 + earningLabels.length + 1 + deductionLabels.length + 1;
        if (isJumlah || isJumlahPotongan || isGajiBersih) {
          data.cell.styles.fontStyle = 'bold';
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
  doc.text('Rektor', 20, finalY);
  doc.setFont('helvetica', 'bold');
  doc.text("Dr. dr. H.M. ZULFIKAR AS'AD, MMR.", 20, signatureY);

  // Center: Wakil Rektor
  doc.setFont('helvetica', 'normal');
  doc.text('Wakil Rektor Bidang SDM, Keuangan dan Umum', pageWidth / 2, finalY, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text('Dr. Hj. Uswatun Qoyyimah, SS., M. Ed., Ph.D', pageWidth / 2, signatureY, { align: 'center' });

  // Right: Majlis Kamtib or Ketua Biro Administrasi Umum
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, pageWidth - 20, finalY - 5, { align: 'right' });
  
  const isSatpam = data.jobCategory.toUpperCase() === 'SATPAM';
  const rightTitle = isSatpam ? 'Majlis Kamtib' : 'Ketua Biro Administrasi Umum';
  const rightName = isSatpam ? 'H. Rohmatul Akbar, ST' : 'H. Harun Ar Rasyid, S.Pd.I.';

  doc.text(rightTitle, pageWidth - 20, finalY, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.text(rightName, pageWidth - 20, signatureY, { align: 'right' });

  doc.save(filename);
}
