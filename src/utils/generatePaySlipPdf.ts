import { jsPDF } from 'jspdf';
import { LOGO_YAPETIDU_BASE64, LOGO_UNIPDU_BASE64 } from './logoConstants';

export interface PaySlipField {
  label: string;
  amount: number;
}

export interface PaySlipData {
  employeeName: string;
  employeeNo: number;
  period: string;
  jobCategory: string;
  earnings: PaySlipField[];
  deductions: PaySlipField[];
  isLoyalis?: boolean;
  niy?: string;
  npwp?: string;
  familyMetrics?: {
    spouse_count: number;
    children_sd: number;
    children_sltp: number;
    children_slta: number;
    children_pt: number;
  };
}

function spell(n: number): string {
  const angka = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  let hasil = "";

  if (n < 12) {
    hasil = angka[n];
  } else if (n < 20) {
    hasil = spell(n - 10) + " belas";
  } else if (n < 100) {
    hasil = spell(Math.floor(n / 10)) + " puluh " + spell(n % 10);
  } else if (n < 200) {
    hasil = "seratus " + spell(n - 100);
  } else if (n < 1000) {
    hasil = spell(Math.floor(n / 100)) + " ratus " + spell(n % 100);
  } else if (n < 2000) {
    hasil = "seribu " + spell(n - 1000);
  } else if (n < 1000000) {
    hasil = spell(Math.floor(n / 1000)) + " ribu " + spell(n % 1000);
  } else if (n < 1000000000) {
    hasil = spell(Math.floor(n / 1000000)) + " juta " + spell(n % 1000000);
  } else if (n < 1000000000000) {
    hasil = spell(Math.floor(n / 1000000000)) + " milyar " + spell(n % 1000000000);
  }

  return hasil.replace(/\s+/g, " ").trim();
}

function terbilang(n: number): string {
  const cleaned = spell(n);
  if (!cleaned) return "Nol";
  return cleaned.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function drawPaySlip(doc: jsPDF, data: PaySlipData): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const formatIDR = (amount: number): string => {
    if (amount === 0) return '-';
    return new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  if (data.isLoyalis) {
    // ─── LOYALIS (WHITE COLLAR) DOUBLE-COLUMN LAYOUT ─────────────────
    const marginLeft = 15;
    const marginRight = 15;
    // Header (Kop Surat)
    doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 15, 10, 14, 14);
    doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 181, 10, 14, 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text("YAYASAN PESANTREN TINGGI DARUL 'ULUM", pageWidth / 2, 13, { align: 'center' });
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text("UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM", pageWidth / 2, 17.5, { align: 'center' });
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text("Pondok Pesantren Darul 'Ulum Peterongan Jombang 61481 Telp. (0321) 873655", pageWidth / 2, 21.5, { align: 'center' });

    // Double line divider
    doc.setDrawColor(0);
    doc.setLineWidth(0.6);
    doc.line(15, 26, 195, 26);
    doc.setLineWidth(0.2);
    doc.line(15, 27, 195, 27);

    let y = 31;

    // Box top-right "NO URUT"
    const boxX = 155;
    const boxY = y;
    const boxW = 40;
    const boxH = 10;
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(boxX, boxY, boxW, boxH);
    doc.line(boxX + 22, boxY, boxX + 22, boxY + boxH);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('NO URUT  :', boxX + 2, boxY + 6.5);
    doc.setFontSize(13);
    doc.text(data.employeeNo.toString(), boxX + 31, boxY + 7, { align: 'center' });

    doc.setFont('helvetica', 'bolditalic');
    doc.setFontSize(11);
    doc.text(`SLIP GAJI BULAN ${data.period.toUpperCase()}`, marginLeft, y + 6.5);

    y += 13;

    // Horizontal Divider
    doc.setLineWidth(0.4);
    doc.line(marginLeft, y, 195, y);
    y += 6;

    // Employee Details
    doc.setFont('helvetica', 'bolditalic');
    doc.setFontSize(9.5);
    doc.text('NAMA', marginLeft, y);
    doc.text(':', marginLeft + 22, y);
    doc.text(data.employeeName.toUpperCase(), marginLeft + 25, y);

    y += 4.5;
    doc.setFont('helvetica', 'bold');
    doc.text('NIY', marginLeft, y);
    doc.text(':', marginLeft + 22, y);
    doc.text(data.niy || '-', marginLeft + 25, y);

    y += 4.5;
    doc.text('NPWP', marginLeft, y);
    doc.text(':', marginLeft + 22, y);
    doc.text(data.npwp || '-', marginLeft + 25, y);

    y += 7;

    // Table Headers
    const tableStartY = y;
    doc.setFillColor(235, 235, 235);
    doc.rect(15, y, 90, 6, 'F');
    doc.rect(105, y, 90, 6, 'F');
    
    doc.rect(15, y, 90, 6);
    doc.rect(105, y, 90, 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('PENERIMAAN', 60, y + 4.2, { align: 'center' });
    doc.text('POTONGAN', 150, y + 4.2, { align: 'center' });

    y += 6;

    // Parse items to classify them into standard slots
    interface CustomSlipRow {
      type: 'heading' | 'item' | 'family-sub' | 'hari-tua' | 'presensi';
      label: string;
      amount?: number;
      countText?: string;
      pctText?: string;
      baseText?: string;
      presensiCount?: string;
      presensiUnit?: string;
      presensiTimes?: string;
      presensiRate?: string;
    }

    const leftRows: CustomSlipRow[] = [];

    // A. GAJI UTAMA
    leftRows.push({ type: 'heading', label: 'A. GAJI UTAMA' });

    // Gaji Pokok
    const gapokItem = data.earnings.find(e => e.label.toUpperCase() === 'GAJI POKOK');
    const gapokVal = gapokItem ? gapokItem.amount : 0;
    leftRows.push({ type: 'item', label: 'GAJI POKOK', amount: gapokVal });

    // T. Keluarga
    leftRows.push({ type: 'heading', label: 'T. KELUARGA' });

    if (data.familyMetrics) {
      const m = data.familyMetrics;
      const gapokStr = formatIDR(gapokVal);

      // Spouse
      const spouseCount = m.spouse_count || 0;
      const spouseAmt = spouseCount > 0 ? Math.round(gapokVal * 0.05 * spouseCount) : 0;
      leftRows.push({
        type: 'family-sub',
        label: 'ISTRI/SUAMI',
        countText: spouseCount > 0 ? `${spouseCount}  x` : '-',
        pctText: spouseCount > 0 ? '5%  x' : '-',
        baseText: spouseCount > 0 ? gapokStr : '-',
        amount: spouseAmt
      });

      // Children SD
      const sdCount = m.children_sd || 0;
      const sdAmt = sdCount > 0 ? Math.round(gapokVal * 0.05 * sdCount) : 0;
      leftRows.push({
        type: 'family-sub',
        label: 'ANAK S/D SD',
        countText: sdCount > 0 ? `${sdCount}  x` : '-',
        pctText: sdCount > 0 ? '5%  x' : '-',
        baseText: sdCount > 0 ? gapokStr : '-',
        amount: sdAmt
      });

      // Children SLTP
      const sltpCount = m.children_sltp || 0;
      const sltpAmt = sltpCount > 0 ? Math.round(gapokVal * 0.075 * sltpCount) : 0;
      leftRows.push({
        type: 'family-sub',
        label: 'ANAK : SLTP',
        countText: sltpCount > 0 ? `${sltpCount}  x` : '-',
        pctText: sltpCount > 0 ? '7.5%  x' : '-',
        baseText: sltpCount > 0 ? gapokStr : '-',
        amount: sltpAmt
      });

      // Children SLTA
      const sltaCount = m.children_slta || 0;
      const sltaAmt = sltaCount > 0 ? Math.round(gapokVal * 0.1 * sltaCount) : 0;
      leftRows.push({
        type: 'family-sub',
        label: 'ANAK : SLTA',
        countText: sltaCount > 0 ? `${sltaCount}  x` : '-',
        pctText: sltaCount > 0 ? '10%  x' : '-',
        baseText: sltaCount > 0 ? gapokStr : '-',
        amount: sltaAmt
      });

      // Children PT
      const ptCount = m.children_pt || 0;
      const ptAmt = ptCount > 0 ? Math.round(gapokVal * 0.125 * ptCount) : 0;
      leftRows.push({
        type: 'family-sub',
        label: 'ANAK : PT',
        countText: ptCount > 0 ? `${ptCount}  x` : '-',
        pctText: ptCount > 0 ? '12.5%  x' : '-',
        baseText: ptCount > 0 ? gapokStr : '-',
        amount: ptAmt
      });
    } else {
      leftRows.push({ type: 'family-sub', label: 'ISTRI/SUAMI', countText: '-', pctText: '-', baseText: '-', amount: 0 });
      leftRows.push({ type: 'family-sub', label: 'ANAK S/D SD', countText: '-', pctText: '-', baseText: '-', amount: 0 });
      leftRows.push({ type: 'family-sub', label: 'ANAK : SLTP', countText: '-', pctText: '-', baseText: '-', amount: 0 });
      leftRows.push({ type: 'family-sub', label: 'ANAK : SLTA', countText: '-', pctText: '-', baseText: '-', amount: 0 });
      leftRows.push({ type: 'family-sub', label: 'ANAK : PT', countText: '-', pctText: '-', baseText: '-', amount: 0 });
    }

    // T. Fungsional
    const fungItem = data.earnings.find(e => e.label.toUpperCase() === 'T. FUNGSIONAL' || e.label.toUpperCase() === 'TUNJANGAN JABATAN');
    leftRows.push({ type: 'item', label: 'T. FUNGSIONAL', amount: fungItem ? fungItem.amount : 0 });

    // Kepangkatan
    const rankItem = data.earnings.find(e => e.label.toUpperCase() === 'KEPANGKATAN');
    leftRows.push({ type: 'item', label: 'KEPANGKATAN', amount: rankItem ? rankItem.amount : 0 });

    // T. Hari Tua (10% of gapok)
    const htItem = data.earnings.find(e => e.label.toUpperCase() === 'T. HARI TUA');
    const htAmt = htItem ? htItem.amount : Math.round(gapokVal * 0.1);
    leftRows.push({
      type: 'hari-tua',
      label: 'T. HARI TUA',
      pctText: '10%  x',
      baseText: formatIDR(gapokVal),
      amount: htAmt
    });

    // T. BPJS TK
    const bpjsTkItem = data.earnings.find(e => e.label.toUpperCase() === 'T. BPJS TK');
    leftRows.push({ type: 'item', label: 'T. BPJS TK', amount: bpjsTkItem ? bpjsTkItem.amount : 0 });

    // T. BPJS KES
    const bpjsKesItem = data.earnings.find(e => e.label.toUpperCase() === 'T. BPJS KES');
    leftRows.push({ type: 'item', label: 'T. BPJS KES', amount: bpjsKesItem ? bpjsKesItem.amount : 0 });

    // Beras
    const berasItem = data.earnings.find(e => e.label.toUpperCase() === 'BERAS' || e.label.toUpperCase() === 'TUNJANGAN BERAS');
    leftRows.push({ type: 'item', label: 'BERAS', amount: berasItem ? berasItem.amount : 0 });

    // Presensi
    const presItem = data.earnings.find(e => e.label.toUpperCase() === 'PRESENSI');
    const presAmt = presItem ? presItem.amount : 0;
    if (presAmt > 0) {
      if (presAmt === 278850) {
        leftRows.push({
          type: 'presensi',
          label: 'PRESENSI',
          presensiCount: '169',
          presensiUnit: 'Jam',
          presensiTimes: 'x',
          presensiRate: '1.650',
          amount: presAmt
        });
      } else {
        const hours = Math.round(presAmt / 1650);
        if (hours * 1650 === presAmt) {
          leftRows.push({
            type: 'presensi',
            label: 'PRESENSI',
            presensiCount: hours.toString(),
            presensiUnit: 'Jam',
            presensiTimes: 'x',
            presensiRate: '1.650',
            amount: presAmt
          });
        } else {
          leftRows.push({
            type: 'presensi',
            label: 'PRESENSI',
            presensiCount: '-',
            presensiUnit: 'Jam',
            presensiTimes: 'x',
            presensiRate: '-',
            amount: presAmt
          });
        }
      }
    } else {
      leftRows.push({ type: 'presensi', label: 'PRESENSI', presensiCount: '-', presensiUnit: 'Jam', presensiTimes: 'x', presensiRate: '-', amount: 0 });
    }

    // Bonus Presensi
    const bonusPresItem = data.earnings.find(e => e.label.toUpperCase() === 'BONUS PRESENSI');
    leftRows.push({ type: 'item', label: 'BONUS PRESENSI', amount: bonusPresItem ? bonusPresItem.amount : 0 });

    // Piket
    const piketItem = data.earnings.find(e => e.label.toUpperCase() === 'PIKET');
    leftRows.push({
      type: 'presensi',
      label: 'PIKET',
      presensiCount: '-',
      presensiUnit: '',
      presensiTimes: 'x',
      presensiRate: '-',
      amount: piketItem ? piketItem.amount : 0
    });

    // Lembur
    const lemburItem = data.earnings.find(e => e.label.toUpperCase() === 'LEMBUR');
    leftRows.push({
      type: 'presensi',
      label: 'LEMBUR',
      presensiCount: '-',
      presensiUnit: '',
      presensiTimes: 'x',
      presensiRate: '-',
      amount: lemburItem ? lemburItem.amount : 0
    });

    // B. STRUKTURAL
    leftRows.push({ type: 'heading', label: 'B. STRUKTURAL' });
    const structItems = data.earnings.filter(e => e.label.toUpperCase().startsWith('STRUKTURAL:'));
    if (structItems.length > 0) {
      structItems.forEach(item => {
        const cleanLabel = item.label.substring(11).trim();
        leftRows.push({ type: 'item', label: cleanLabel, amount: item.amount });
      });
    } else {
      leftRows.push({ type: 'item', label: '-', amount: 0 });
    }

    // C. VAKASI TAMBAHAN
    leftRows.push({ type: 'heading', label: 'C. VAKASI TAMBAHAN' });

    const specialLabels = [
      'GAJI POKOK', 'T. KELUARGA', 'TUNJANGAN KELUARGA', 'T. FUNGSIONAL', 'TUNJANGAN JABATAN',
      'KEPANGKATAN', 'T. HARI TUA', 'T. BPJS TK', 'T. BPJS KES', 'BERAS', 'TUNJANGAN BERAS',
      'PRESENSI', 'BONUS PRESENSI', 'PIKET', 'LEMBUR'
    ];
    const eventItems = data.earnings.filter(e => {
      const labelUpper = e.label.toUpperCase();
      return !specialLabels.includes(labelUpper) && !labelUpper.startsWith('STRUKTURAL:');
    });

    if (eventItems.length > 0) {
      eventItems.forEach((item, idx) => {
        leftRows.push({ type: 'item', label: `${idx + 1}   ${item.label}`, amount: item.amount });
      });
    } else {
      leftRows.push({ type: 'item', label: '-', amount: 0 });
    }

    // ─── POTONGAN SIDE ROWS ──────────────────────────────────────────
    const rightRows: CustomSlipRow[] = [];

    // Rochmad
    rightRows.push({ type: 'heading', label: '1   KOPERASI ROCHMAD' });

    // BPJS
    const bpjsDeduction = data.deductions.find(d => d.label.toUpperCase() === 'BPJS');
    rightRows.push({ type: 'item', label: '1   BPJS', amount: bpjsDeduction ? bpjsDeduction.amount : 0 });

    // THT
    const thtDeduction = data.deductions.find(d => d.label.toUpperCase() === 'THT');
    rightRows.push({ type: 'item', label: '2   THT', amount: thtDeduction ? thtDeduction.amount : 0 });

    // Tabungan
    const tabDeduction = data.deductions.find(d => d.label.toUpperCase() === 'TABUNGAN');
    rightRows.push({ type: 'item', label: '3   TABUNGAN', amount: tabDeduction ? tabDeduction.amount : 0 });

    // ZIZ
    const zizDeduction = data.deductions.find(d => d.label.toUpperCase() === 'ZIZ');
    rightRows.push({ type: 'item', label: '4   ZIZ', amount: zizDeduction ? zizDeduction.amount : 0 });

    // Revisi Gaji
    const revDeduction = data.deductions.find(d => d.label.toUpperCase() === 'REVISI GAJI');
    rightRows.push({ type: 'item', label: '5   REVISI GAJI', amount: revDeduction ? revDeduction.amount : 0 });

    // Pinlu/Tagihan
    const pinluDeduction = data.deductions.find(d => d.label.toUpperCase() === 'PINLU/TAGIHAN');
    rightRows.push({ type: 'item', label: '6   PINLU/TAGIHAN', amount: pinluDeduction ? pinluDeduction.amount : 0 });

    // Kop Unipdu
    const unipduDeduction = data.deductions.find(d => d.label.toUpperCase() === 'KOP. UNIPDU REJOSO GEMILANG' || d.label.toUpperCase() === 'KOPERASI UNIPDU REJOSO GEMILANG');
    rightRows.push({ type: 'item', label: '7   KOPERASI UNIPDU REJOSO GEMILANG', amount: unipduDeduction ? unipduDeduction.amount : 0 });

    // Potongan Presensi
    const presPot = data.deductions.find(d => d.label.toUpperCase() === 'POTONGAN PRESENSI');
    rightRows.push({ type: 'item', label: '8   POTONGAN PRESENSI', amount: presPot ? presPot.amount : 0 });

    // Potongan Bonus Presensi
    const bonusPresPot = data.deductions.find(d => d.label.toUpperCase() === 'POTONGAN BONUS PRESENSI');
    rightRows.push({ type: 'item', label: '9   POTONGAN BONUS PRESENSI', amount: bonusPresPot ? bonusPresPot.amount : 0 });

    // Koperasi Rochmad (if actual Rochmad amount is set)
    const rochmadDeduction = data.deductions.find(d => d.label.toUpperCase() === 'KOP. ROCHMAD' || d.label.toUpperCase() === 'KOPERASI ROCHMAD');
    if (rochmadDeduction && rochmadDeduction.amount > 0) {
      rightRows.push({ type: 'item', label: '10  KOPERASI ROCHMAD', amount: rochmadDeduction.amount });
    }

    // ─── Drawing Rows ──────────────────────────────────────────────
    const numRows = Math.max(leftRows.length, rightRows.length);
    const dividerX = 105;

    for (let i = 0; i < numRows; i++) {
      const rowY = y;

      // 1. Calculate split lines & determine dynamic row height for this step
      let leftLines: string[] = [];
      let leftStartX = 17;
      if (i < leftRows.length) {
        const row = leftRows[i];
        if (row.type === 'heading') {
          leftLines = doc.splitTextToSize(row.label, 85);
        } else if (row.type === 'item') {
          const isIndented = row.label.startsWith('      ') || row.label.startsWith('    ');
          leftStartX = isIndented ? 21 : 17;
          leftLines = doc.splitTextToSize(row.label.trim(), 76 - leftStartX);
        } else {
          leftLines = [row.label];
        }
      }

      let rightLines: string[] = [];
      if (i < rightRows.length) {
        const row = rightRows[i];
        if (row.type === 'heading') {
          rightLines = doc.splitTextToSize(row.label, 85);
        } else {
          rightLines = doc.splitTextToSize(row.label, 60);
        }
      }

      const leftCount = leftLines.length;
      const rightCount = rightLines.length;
      const maxLines = Math.max(leftCount, rightCount, 1);
      const currentRowHeight = maxLines > 1 ? (maxLines * 3.4) + 1.2 : 4.2;

      // Draw light horizontal divider at the bottom of the row
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.15);
      doc.line(15, rowY + currentRowHeight, 195, rowY + currentRowHeight);

      // Left Column
      if (i < leftRows.length) {
        const row = leftRows[i];
        doc.setFontSize(7.5);

        if (row.type === 'heading') {
          doc.setFont('helvetica', 'bold');
          doc.text(leftLines, 17, rowY + 3.1);
        } else if (row.type === 'family-sub') {
          doc.setFont('helvetica', 'normal');
          doc.text(row.label, 21, rowY + 3.1);
          
          doc.text(row.countText || '-', 43, rowY + 3.1);
          doc.text(row.pctText || '-', 50, rowY + 3.1);
          doc.text(row.baseText || '-', 60, rowY + 3.1);
          
          doc.text('=', 78, rowY + 3.1);
          const amtText = row.amount && row.amount > 0 ? formatIDR(row.amount) : '-';
          doc.text(amtText, 102, rowY + 3.1, { align: 'right' });
        } else if (row.type === 'hari-tua') {
          doc.setFont('helvetica', 'normal');
          doc.text(row.label, 17, rowY + 3.1);
          
          doc.text(row.pctText || '-', 50, rowY + 3.1);
          doc.text(row.baseText || '-', 60, rowY + 3.1);
          
          doc.text('=', 78, rowY + 3.1);
          const amtText = row.amount && row.amount > 0 ? formatIDR(row.amount) : '-';
          doc.text(amtText, 102, rowY + 3.1, { align: 'right' });
        } else if (row.type === 'presensi') {
          doc.setFont('helvetica', 'normal');
          doc.text(row.label, 17, rowY + 3.1);
          
          doc.text(row.presensiCount || '-', 43, rowY + 3.1);
          if (row.presensiUnit) {
            doc.text(row.presensiUnit, 50, rowY + 3.1);
          }
          doc.text(row.presensiTimes || 'x', 58, rowY + 3.1);
          doc.text(row.presensiRate || '-', 64, rowY + 3.1);
          
          doc.text('=', 78, rowY + 3.1);
          const amtText = row.amount && row.amount > 0 ? formatIDR(row.amount) : '-';
          doc.text(amtText, 102, rowY + 3.1, { align: 'right' });
        } else {
          doc.setFont('helvetica', 'normal');
          doc.text(leftLines, leftStartX, rowY + 3.1);
          
          doc.text('=', 78, rowY + 3.1);
          const amtText = row.amount && row.amount > 0 ? formatIDR(row.amount) : '-';
          doc.text(amtText, 102, rowY + 3.1, { align: 'right' });
        }
      }

      // Right Column
      if (i < rightRows.length) {
        const row = rightRows[i];
        doc.setFontSize(7.5);

        if (row.type === 'heading') {
          doc.setFont('helvetica', 'bold');
          doc.text(rightLines, 107, rowY + 3.1);
        } else {
          doc.setFont('helvetica', 'normal');
          doc.text(rightLines, 107, rowY + 3.1);
          
          doc.text('=', 168, rowY + 3.1);
          const amtText = row.amount && row.amount > 0 ? formatIDR(row.amount) : '-';
          doc.text(amtText, 192, rowY + 3.1, { align: 'right' });
        }
      }

      y += currentRowHeight;
    }

    // Outer borders and solid middle divider
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(15, tableStartY, 180, y - tableStartY);
    doc.line(dividerX, tableStartY, dividerX, y);

    // ─── Table Footer ───
    const totalEarnings = data.earnings.reduce((sum, e) => sum + e.amount, 0);
    const totalDeductions = data.deductions.reduce((sum, d) => sum + d.amount, 0);
    
    doc.setFillColor(235, 235, 235);
    doc.rect(15, y, 90, 6, 'F');
    doc.rect(105, y, 90, 6, 'F');

    doc.rect(15, y, 90, 6);
    doc.rect(105, y, 90, 6);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('JUMLAH PENERIMAAN', 17, y + 4.2);
    doc.text(':', 78, y + 4.2);
    doc.text(formatIDR(totalEarnings), 102, y + 4.2, { align: 'right' });

    doc.text('JUMLAH POTONGAN', 107, y + 4.2);
    doc.text(':', 168, y + 4.2);
    doc.text(formatIDR(totalDeductions), 192, y + 4.2, { align: 'right' });

    y += 6;

    // ─── Net Salary Box ───
    const netSalary = totalEarnings - totalDeductions;
    doc.setFillColor(245, 245, 245);
    doc.rect(15, y, 180, 10, 'F');
    doc.rect(15, y, 180, 10);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('PENERIMAAN BERSIH', 20, y + 6.5);
    doc.text(formatIDR(netSalary), 192, y + 6.5, { align: 'right' });

    y += 10;

    // ─── Quote Block ───
    y += 4;
    doc.setFillColor(255, 253, 248);
    doc.setLineWidth(0.2);
    doc.rect(15, y, 180, 15, 'FD');

    const quote = '"Berimanlah kamu kepada Allah dan RasulNya dan nafkahkanlah sebagian dari hartamu yang Allah telah menjadikan kamu menguasainya. Maka orang-orang yang beriman diantara kamu dan yang menafkahkankan sebagian dari hartanya memperoleh pahala yang besar." (QS.57.7)';
    doc.setFont('times', 'italic');
    doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(quote, 172);
    doc.text(lines, 105, y + 5.5, { align: 'center', maxWidth: 172 });

  } else {
    // ─── BLUE COLLAR STANDARD LAYOUT ──────────────────────────────────
    const marginLeft = 35;
    const marginRight = 35;
    const contentWidth = pageWidth - marginLeft - marginRight;
    // Header (Kop Surat)
    doc.addImage(LOGO_YAPETIDU_BASE64, 'PNG', 15, 10, 14, 14);
    doc.addImage(LOGO_UNIPDU_BASE64, 'PNG', 181, 10, 14, 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text("YAYASAN PESANTREN TINGGI DARUL 'ULUM", pageWidth / 2, 13, { align: 'center' });
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text("UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM", pageWidth / 2, 17.5, { align: 'center' });
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text("Pondok Pesantren Darul 'Ulum Peterongan Jombang 61481 Telp. (0321) 873655", pageWidth / 2, 21.5, { align: 'center' });

    // Double line divider
    doc.setDrawColor(0);
    doc.setLineWidth(0.6);
    doc.line(15, 26, 195, 26);
    doc.setLineWidth(0.2);
    doc.line(15, 27, 195, 27);

    let y = 33;

    // Title: SLIP GAJI
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.text('SLIP GAJI', pageWidth / 2, y, { align: 'center' });
    y += 5.5;

    // Sleek Pill for Job Category
    const pillHeight = 6.5;
    const pillWidth = 70; // Elegant centered width
    doc.setFillColor(242, 242, 242);
    doc.roundedRect((pageWidth - pillWidth) / 2, y, pillWidth, pillHeight, 1.5, 1.5, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(data.jobCategory.toUpperCase(), pageWidth / 2, y + 4.5, { align: 'center' });
    y += pillHeight + 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(`BULAN: ${data.period.toUpperCase()}`, pageWidth / 2, y, { align: 'center' });
    y += 9;

    // Employee Info
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('NAMA', marginLeft, y);
    doc.setFont('helvetica', 'normal');
    doc.text(':', marginLeft + 20, y);
    doc.text(data.employeeName.toUpperCase(), marginLeft + 23, y);
    y += 8;

    // Table Setup
    const colWidths = {
      no: 10,
      uraian: 70,
      jumlah: 30,
      total: 30
    };

    const startX = marginLeft;
    const tableWidth = colWidths.no + colWidths.uraian + colWidths.jumlah + colWidths.total;

    const drawRow = (rowY: number, rowHeight: number, isHeader: boolean = false, isGrey: boolean = false) => {
      if (isGrey) {
        doc.setFillColor(235, 235, 235);
        doc.rect(startX, rowY, tableWidth, rowHeight, 'F');
      }
      doc.setDrawColor(0);
      doc.setLineWidth(0.2);
      doc.rect(startX, rowY, tableWidth, rowHeight);
    };

    // Table Headers
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    const headerHeight = 7;
    drawRow(y, headerHeight);
    doc.text('NO', startX + colWidths.no / 2, y + 5, { align: 'center' });
    doc.text('URAIAN', startX + colWidths.no + 5, y + 5);
    doc.text('JUMLAH', startX + colWidths.no + colWidths.uraian + colWidths.jumlah / 2, y + 5, { align: 'center' });
    doc.text('TOTAL', startX + colWidths.no + colWidths.uraian + colWidths.jumlah + colWidths.total / 2, y + 5, { align: 'center' });
    y += headerHeight;

    // Section Title: Penerimaan
    const rowH = 6;
    drawRow(y, rowH, false, true);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('I. PENERIMAAN', startX + 5, y + 4.5);
    y += rowH;

    // Earnings
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    let totalEarnings = 0;

    data.earnings.forEach((item, index) => {
      drawRow(y, rowH);
      doc.text((index + 1).toString(), startX + colWidths.no / 2, y + 4.5, { align: 'center' as const });
      doc.text(item.label.toUpperCase(), startX + colWidths.no + 2, y + 4.5);
      doc.text(formatIDR(item.amount), startX + colWidths.no + colWidths.uraian + colWidths.jumlah - 2, y + 4.5, { align: 'right' as const });
      totalEarnings += item.amount;
      y += rowH;
    });

    // Earnings Total row
    doc.setFont('helvetica', 'bold');
    drawRow(y, rowH, false, true);
    doc.text('JUMLAH PENERIMAAN', startX + 5, y + 4.5);
    doc.text(formatIDR(totalEarnings), startX + tableWidth - 2, y + 4.5, { align: 'right' as const });
    y += rowH;

    // Empty row for spacing between sections
    drawRow(y, rowH);
    y += rowH;

    // Section Title: Potongan
    drawRow(y, rowH, false, true);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('II. POTONGAN', startX + 5, y + 4.5);
    y += rowH;

    // Deductions
    doc.setFont('helvetica', 'normal');
    let totalDeductions = 0;

    data.deductions.forEach((item, index) => {
      drawRow(y, rowH);
      doc.text((index + 1).toString(), startX + colWidths.no / 2, y + 4.5, { align: 'center' as const });
      doc.text(item.label.toUpperCase(), startX + colWidths.no + 2, y + 4.5);
      doc.text(formatIDR(item.amount), startX + colWidths.no + colWidths.uraian + colWidths.jumlah - 2, y + 4.5, { align: 'right' as const });
      totalDeductions += item.amount;
      y += rowH;
    });

    // Deductions Total row
    doc.setFont('helvetica', 'bold');
    drawRow(y, rowH, false, true);
    doc.text('JUMLAH POTONGAN', startX + 5, y + 4.5);
    doc.text(formatIDR(totalDeductions), startX + tableWidth - 2, y + 4.5, { align: 'right' as const });
    y += rowH;

    // Net Salary
    const netSalary = totalEarnings - totalDeductions;
    drawRow(y, rowH + 1, false, true);
    doc.setFontSize(11);
    doc.text('GAJI BERSIH', startX + 5, y + 5);
    doc.text(formatIDR(netSalary), startX + tableWidth - 2, y + 5, { align: 'right' as const });
    y += rowH + 1;

    // Terbilang Row (Spelled out numbers in Indonesian)
    const words = `${terbilang(netSalary)} Rupiah`;
    drawRow(y, rowH, false, false);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.text(`Terbilang: "${words}"`, startX + 5, y + 4.5);
    y += rowH;

    // Quote Row in Cream Color
    const quoteText = '"Berimanlah kamu kepada Allah dan Rosulnya dan nafkahkanlah sebagian dari hartamu yang Allah telah menjadikan kamu menguasainya. Maka orang-orang yang beriman diantara kamu dan yang menafkahkankan sebagian dari hartanya memperoleh pahala yang besar."(QS.57.7)';
    doc.setFont('times', 'italic');
    doc.setFontSize(8.5);
    const quoteLines = doc.splitTextToSize(quoteText, tableWidth - 10);
    const quoteRowH = (quoteLines.length * 4.2) + 4;

    doc.setFillColor(253, 238, 221); // Beautiful cream background
    doc.rect(startX, y, tableWidth, quoteRowH, 'F');
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.rect(startX, y, tableWidth, quoteRowH);

    doc.setTextColor(0);
    let quoteY = y + 4.5;
    quoteLines.forEach((line: string) => {
      doc.text(line, startX + tableWidth / 2, quoteY, { align: 'center' });
      quoteY += 4.2;
    });
    y += quoteRowH + 5;
  }
}

export function generatePaySlipPdf(data: PaySlipData, saveToFile = true): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  drawPaySlip(doc, data);

  if (saveToFile) {
    const filename = `Slip_Gaji_${data.employeeName.replace(/\s+/g, '_')}.pdf`;
    doc.save(filename);
  }
  return doc;
}

export function generateMultiPaySlipPdf(slips: PaySlipData[], filename = 'Multi_Slip_Gaji.pdf', saveToFile = true): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  slips.forEach((data, index) => {
    if (index > 0) {
      doc.addPage();
    }
    drawPaySlip(doc, data);
  });

  if (saveToFile) {
    doc.save(filename);
  }
  return doc;
}
