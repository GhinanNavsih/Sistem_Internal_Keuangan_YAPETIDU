/**
 * Generator for DJP Coretax (CTAS) Bukti Pemotongan Bulanan Pegawai Tetap (BPMP)
 * PPh Pasal 21 (PP No. 58/2023 & PMK No. 168/2023).
 *
 * Produces:
 * 1. Standard Coretax XML format (.xml) for direct import into Coretax e-Bupot 21/26.
 * 2. Coretax-compliant Excel spreadsheet (.xlsx) for reconciliation and the DJP Excel-to-XML converter.
 */

import * as XLSX from 'xlsx';

export interface CoretaxBpmpRow {
  no: number;
  id: string;
  name: string;
  nik: string;
  npwp: string;
  nitku?: string;
  ptkp: string;
  terCategory: 'A' | 'B' | 'C';
  kodeObjekPajak?: string; // Default: '21-100-01' (Pegawai Tetap)
  penghasilanBruto: number;
  tarifPersen: number; // e.g. 1.5 for 1.5%
  pphDipotong: number;
  gender?: 'male' | 'female' | null;
}

export interface CoretaxExportParams {
  periodKey: string;      // e.g. "2026_11" or "2026-11"
  periodLabel: string;    // e.g. "November 2026"
  year: number;           // e.g. 2026
  month: number;          // 1 - 12
  withholderNpwp?: string;
  withholderNitku?: string;
  withholderName?: string;
  rows: CoretaxBpmpRow[];
}

export const DEFAULT_KODE_OBJEK_PAJAK_PEGAWAI_TETAP = '21-100-01';
export const DEFAULT_NPWP_PEMOTONG = '020075644602000';
export const DEFAULT_NAMA_PEMOTONG = 'PESANTREN TINGGI DARUL ULUM';
export const DEFAULT_NITKU_PEMOTONG = '0020075644602000000000';
export const DEFAULT_NITKU_DEFAULT = '0000000000000000';

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanDigits(value: string | undefined | null): string {
  if (!value) return '';
  return value.replace(/[^0-9]/g, '');
}

/**
 * Builds standard XML string compliant with the Coretax BPMP schema.
 */
export function generateCoretaxBpmpXml(params: CoretaxExportParams): string {
  const year = params.year;
  const month = String(params.month).padStart(2, '0');
  const npwpPemotong = cleanDigits(params.withholderNpwp) || DEFAULT_NPWP_PEMOTONG;
  const nitkuPemotong = cleanDigits(params.withholderNitku) || DEFAULT_NITKU_PEMOTONG;
  const namaPemotong = escapeXml(params.withholderName || DEFAULT_NAMA_PEMOTONG);

  const totalBruto = params.rows.reduce((sum, r) => sum + r.penghasilanBruto, 0);
  const totalPph = params.rows.reduce((sum, r) => sum + r.pphDipotong, 0);

  const detailXmlItems = params.rows.map((row) => {
    const rawNik = cleanDigits(row.nik);
    const rawNpwp = cleanDigits(row.npwp);
    const primaryId = rawNpwp.length === 16 ? rawNpwp : (rawNik.length === 16 ? rawNik : (rawNpwp || rawNik || '0000000000000000'));
    const jenisId = rawNpwp.length >= 15 ? 'NPWP' : 'NIK';
    const nitku = cleanDigits(row.nitku) || DEFAULT_NITKU_DEFAULT;
    const kodeObjek = row.kodeObjekPajak || DEFAULT_KODE_OBJEK_PAJAK_PEGAWAI_TETAP;

    return `    <DetailBPMP>
      <NomorUrut>${row.no}</NomorUrut>
      <IdentitasPenerima>
        <JenisID>${jenisId}</JenisID>
        <NomorID>${primaryId}</NomorID>
        <NIK>${rawNik}</NIK>
        <NPWP>${rawNpwp || primaryId}</NPWP>
        <NITKU>${nitku}</NITKU>
        <NamaPenerima>${escapeXml(row.name)}</NamaPenerima>
        <StatusPTKP>${row.ptkp}</StatusPTKP>
        <KategoriTER>${row.terCategory}</KategoriTER>
      </IdentitasPenerima>
      <RincianPenghasilan>
        <KodeObjekPajak>${kodeObjek}</KodeObjekPajak>
        <JumlahPenghasilanBruto>${Math.round(row.penghasilanBruto)}</JumlahPenghasilanBruto>
        <TarifPersen>${row.tarifPersen.toFixed(2)}</TarifPersen>
        <PPhDipotong>${Math.round(row.pphDipotong)}</PPhDipotong>
      </RincianPenghasilan>
    </DetailBPMP>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<CoretaxDocument xmlns="http://coretax.pajak.go.id/schema/bupot" version="1.0">
  <Header>
    <Dokumen>BPMP</Dokumen>
    <TahunPajak>${year}</TahunPajak>
    <MasaPajak>${month}</MasaPajak>
    <NPWPPemotong>${npwpPemotong}</NPWPPemotong>
    <NITKUPemotong>${nitkuPemotong}</NITKUPemotong>
    <NamaPemotong>${namaPemotong}</NamaPemotong>
    <JumlahData>${params.rows.length}</JumlahData>
    <TotalPenghasilanBruto>${Math.round(totalBruto)}</TotalPenghasilanBruto>
    <TotalPPhDipotong>${Math.round(totalPph)}</TotalPPhDipotong>
  </Header>
  <DetailBPMPList>
${detailXmlItems.join('\n')}
  </DetailBPMPList>
</CoretaxDocument>
`;
}

/**
 * Builds an Excel Workbook (.xlsx) structured according to Coretax import specifications.
 */
export function generateCoretaxBpmpExcel(params: CoretaxExportParams): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // 1. DATA SHEET
  const headers = [
    'No',
    'NIK',
    'NPWP',
    'NITKU',
    'Nama Pegawai',
    'Jenis Kelamin',
    'Status PTKP',
    'Kategori TER',
    'Kode Objek Pajak',
    'Penghasilan Bruto (Rp)',
    'Tarif TER (%)',
    'PPh Pasal 21 Terutang (Rp)',
    'Status Pemotongan',
  ];

  const dataRows = params.rows.map((row) => [
    row.no,
    row.nik ? `'${cleanDigits(row.nik)}` : '',
    row.npwp ? `'${cleanDigits(row.npwp)}` : '',
    cleanDigits(row.nitku) || DEFAULT_NITKU_DEFAULT,
    row.name,
    row.gender === 'female' ? 'Perempuan' : (row.gender === 'male' ? 'Laki-laki' : '-'),
    row.ptkp,
    row.terCategory,
    row.kodeObjekPajak || DEFAULT_KODE_OBJEK_PAJAK_PEGAWAI_TETAP,
    Math.round(row.penghasilanBruto),
    row.tarifPersen,
    Math.round(row.pphDipotong),
    row.pphDipotong > 0 ? 'Dipotong Pajak' : 'Tarif 0% (Nihil)',
  ]);

  const totalBruto = params.rows.reduce((sum, r) => sum + r.penghasilanBruto, 0);
  const totalPph = params.rows.reduce((sum, r) => sum + r.pphDipotong, 0);

  const totalRow = [
    'TOTAL',
    '',
    '',
    '',
    `${params.rows.length} Pegawai`,
    '',
    '',
    '',
    '',
    Math.round(totalBruto),
    '',
    Math.round(totalPph),
    '',
  ];

  const sheetData = [
    ['REKAP IMPOR BUKTI PEMOTONGAN BULANAN (BPMP) PPh PASAL 21 - CORETAX DJP'],
    [`PEMBERI KERJA: ${params.withholderName || DEFAULT_NAMA_PEMOTONG}`],
    [`MASA PAJAK: ${String(params.month).padStart(2, '0')} / ${params.year} (${params.periodLabel})`],
    [],
    headers,
    ...dataRows,
    [],
    totalRow,
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Column width auto-sizing
  const colWidths = headers.map((header, colIndex) => {
    let maxLen = header.length;
    sheetData.forEach((row) => {
      if (row[colIndex] !== undefined && row[colIndex] !== null) {
        const valStr = String(row[colIndex]);
        if (valStr.length > maxLen) {
          maxLen = valStr.length;
        }
      }
    });
    return { wch: Math.min(maxLen + 3, 35) };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'DATA');

  // 2. REKAPITULASI SHEET
  const catACount = params.rows.filter((r) => r.terCategory === 'A').length;
  const catBCount = params.rows.filter((r) => r.terCategory === 'B').length;
  const catCCount = params.rows.filter((r) => r.terCategory === 'C').length;
  const taxableCount = params.rows.filter((r) => r.pphDipotong > 0).length;
  const zeroTaxCount = params.rows.filter((r) => r.pphDipotong === 0).length;

  const rekapData = [
    ['RINGKASAN PELAPORAN CORETAX PPh 21 (TER BULANAN)'],
    [`Periode: ${params.periodLabel}`],
    [],
    ['Metrik', 'Jumlah Pegawai', 'Keterangan'],
    ['Kategori TER A (TK/0, TK/1, K/0)', catACount, 'PTKP 54 jt - 58.5 jt'],
    ['Kategori TER B (TK/2, TK/3, K/1, K/2)', catBCount, 'PTKP 63 jt - 67.5 jt'],
    ['Kategori TER C (K/3)', catCCount, 'PTKP 72 jt'],
    [],
    ['Pegawai Terkena Pajak (Tax > 0)', taxableCount, 'PPh 21 dipotong otomatis'],
    ['Pegawai Tarif 0% (Nihil)', zeroTaxCount, 'Bruto di bawah batas kena pajak'],
    ['Total Pegawai', params.rows.length, ''],
    [],
    ['Total Penghasilan Bruto', `Rp ${totalBruto.toLocaleString('id-ID')}`, 'Dasar Pengenaan Pajak'],
    ['Total PPh 21 Terutang', `Rp ${totalPph.toLocaleString('id-ID')}`, 'Pajak Disetor / Dilaporkan'],
  ];

  const wsRekap = XLSX.utils.aoa_to_sheet(rekapData);
  wsRekap['!cols'] = [{ wch: 38 }, { wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsRekap, 'REKAP_TER');

  return wb;
}
