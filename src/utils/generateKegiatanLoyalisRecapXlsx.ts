import * as XLSX from 'xlsx';

export interface LoyalisEmployee {
  id: string;
  name: string;
  role: string;
  department: string;
}

export interface GenerateKegiatanLoyalisRecapXlsxParams {
  period: string;
  existingEvents: any[];
  loyalisEmployees: LoyalisEmployee[];
}

export function generateKegiatanLoyalisRecapXlsx({
  period,
  existingEvents,
  loyalisEmployees,
}: GenerateKegiatanLoyalisRecapXlsxParams): void {
  const getDeptIndex = (dbDept: string): number => {
    if (!dbDept) return -1;
    const clean = dbDept.trim().toUpperCase();
    if (clean === 'REKTORAT') return 0;
    if (clean === 'PASCASARJANA') return 1;
    if (clean === 'FAK. AGAMA ISLAM') return 2;
    if (clean === 'FAK. BISNIS, BAHASA DAN PENDIDIKAN') return 3;
    if (clean === 'FAK. SAINS DAN TEKNOLOGI') return 4;
    if (clean === 'FAK. ILMU KESEHATAN' || clean === 'FAK. ILMU KESH') return 5;
    if (clean === 'UPT & LEMBAGA' || clean === 'UPT DAN LEMBAGA') return 6;
    return -1;
  };

  const worksheetData: any[][] = [];

  // Title rows
  worksheetData.push(['UNIVERSITAS PESANTREN TINGGI DARUL ULUM JOMBANG']);
  worksheetData.push(['REKAPITULASI LAPORAN RINCIAN KEGIATAN PEGAWAI LOYALIS']);
  worksheetData.push([`PERIODE: ${period.toUpperCase()}`]);
  worksheetData.push([]); // Empty spacer row

  // Header Row 1 (index 4)
  worksheetData.push([
    'URAIAN',
    'SATKER', '', '', '', '', '', '', // Merged across 7 columns
    'JUMLAH'
  ]);

  // Header Row 2 (index 5)
  worksheetData.push([
    '', // Merged from top
    'REKTORAT',
    'PASCASARJANA',
    'FAK. AGAMA ISLAM',
    'FAK. BISNIS, BAHASA DAN PENDIDIKAN',
    'FAK. SAINS DAN TEKNOLOGI',
    'FAK. ILMU KESH',
    'UPT & LEMBAGA',
    '' // Merged from top
  ]);

  const columnTotals = new Array(7).fill(0);
  let grandTotal = 0;

  existingEvents.forEach(evt => {
    const workersMap = evt.eventWorkers || {};
    const rowValues = new Array(7).fill(0);
    let hasPayout = false;

    Object.entries(workersMap).forEach(([empId, w]: [string, any]) => {
      const payout = Number(w.payGiven) || 0;
      if (payout <= 0) return;

      // Robust matching: ID-based (case-insensitive) OR Name-based (case-insensitive, trimmed) as fallback
      const emp = loyalisEmployees.find(e => e.id.toLowerCase() === empId.toLowerCase()) ||
                  loyalisEmployees.find(e => e.name.trim().toLowerCase() === (w.employeeName || '').trim().toLowerCase());

      const dbDept = emp ? emp.department : (w.department || '');
      const idx = getDeptIndex(dbDept);

      if (idx !== -1) {
        rowValues[idx] += payout;
        hasPayout = true;
      }
    });

    if (hasPayout) {
      const rowSum = rowValues.reduce((sum, v) => sum + v, 0);
      const rowData = [
        evt.eventName || 'Kegiatan Tanpa Nama',
        ...rowValues,
        rowSum,
      ];
      worksheetData.push(rowData);

      // Accumulate totals
      rowValues.forEach((v, idx) => {
        columnTotals[idx] += v;
      });
      grandTotal += rowSum;
    }
  });

  // Add the Grand Total row
  worksheetData.push([
    'JUMLAH',
    ...columnTotals,
    grandTotal
  ]);

  // Create worksheet
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Set column widths
  const wscols = [
    { wch: 45 }, // URAIAN
    { wch: 15 }, // REKTORAT
    { wch: 15 }, // PASCASARJANA
    { wch: 20 }, // FAK. AGAMA ISLAM
    { wch: 30 }, // FAK. BISNIS, BAHASA DAN PENDIDIKAN
    { wch: 25 }, // FAK. SAINS DAN TEKNOLOGI
    { wch: 18 }, // FAK. ILMU KESH
    { wch: 18 }, // UPT & LEMBAGA
    { wch: 15 }  // JUMLAH
  ];
  worksheet['!cols'] = wscols;

  // Set cell merges
  worksheet['!merges'] = [
    // Merge "URAIAN" vertically: from row 4, col 0 to row 5, col 0
    { s: { r: 4, c: 0 }, e: { r: 5, c: 0 } },
    // Merge "SATKER" horizontally: from row 4, col 1 to row 4, col 7
    { s: { r: 4, c: 1 }, e: { r: 4, c: 7 } },
    // Merge "JUMLAH" vertically: from row 4, col 8 to row 5, col 8
    { s: { r: 4, c: 8 }, e: { r: 5, c: 8 } }
  ];

  // Create workbook and append sheet
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Rekap Kegiatan');

  // Save to file
  const filename = `Rekapitulasi_Kegiatan_Loyalis_${period.replace(/\s+/g, '_')}.xlsx`;
  XLSX.writeFile(workbook, filename);
}
