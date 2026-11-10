import { adminDb } from '../src/lib/firebase-admin';
import { importUnitBook } from '../src/lib/server/satkerBookImport';
import type { AuthenticatedProfile } from '../src/lib/server/auth';

const actor: AuthenticatedProfile = {
  uid: 'eNsLl7Q3FqdmhHpovl5QWxcu5u23',
  displayName: 'Badan Administrasi Keuangan (BAK)',
  email: 'bak@unipdu.ac.id',
  role: 'super_admin',
  permittedCategories: [],
};

const academicYear = '2026-2027';

const mkkData = {
  unitId: 'loyalis-7bpkaoi9tsc7ix6sb0p4wel5gp53',
  name: 'Mata Kuliah Keahlian Khusus',
  raw: {
    accounts: [
      { code: '10000', name: 'KAS', type: 'AKTIVA', contra: false },
      { code: '11001', name: 'BANK UNIPDU 1003253879', type: 'AKTIVA', contra: false },
      { code: '11002', name: 'REK SATKER', type: 'AKTIVA', contra: false },
      { code: '20001', name: '- Hutang Dana Reward', type: 'HUTANG', contra: false },
      { code: '20002', name: '- Hutang Dana Mahasiswa-Pribadi', type: 'HUTANG', contra: false },
      { code: '20003', name: '- Hutang Bank', type: 'HUTANG', contra: false },
      { code: '30000', name: 'MODAL', type: 'MODAL', contra: false },
      { code: '41100', name: 'Droping BAK', type: 'TERIMA', contra: false },
      { code: '51000', name: 'FAI', type: 'KELUAR', contra: false },
      { code: '51001', name: 'FBBP', type: 'KELUAR', contra: false },
      { code: '51002', name: 'Saintek', type: 'KELUAR', contra: false },
      { code: '51003', name: 'FIK', type: 'KELUAR', contra: false },
      { code: '51005', name: 'konsumsi praktisi luar', type: 'KELUAR', contra: false },
      { code: '56001', name: 'konsumsi pemateri & dosen pendamping', type: 'KELUAR', contra: false },
      { code: '57000', name: 'vakasi praktisi luar', type: 'KELUAR', contra: false },
      { code: '57001', name: 'vakasi pemateri dosen dalam', type: 'KELUAR', contra: false },
      { code: '52000', name: 'ATK', type: 'KELUAR', contra: false },
      { code: '53000', name: 'RAPAT', type: 'KELUAR', contra: false },
      { code: '53001', name: 'RAPAT KOORDINASI AWAL', type: 'KELUAR', contra: false },
      { code: '53002', name: 'RAPAT KOORDINASI PERTENGAHAN', type: 'KELUAR', contra: false },
      { code: '53003', name: 'RAPAT KOORDINASI AKHIR', type: 'KELUAR', contra: false },
      { code: '54000', name: 'Pembuatan dan Pengelolaan Medsos', type: 'KELUAR', contra: false },
      { code: '55000', name: 'pembuatan laporan akhir', type: 'KELUAR', contra: false },
      { code: '56000', name: 'pengembalian dana operasional ke BAK', type: 'KELUAR', contra: false },
      { code: '53004', name: 'rapat koordinasi sharing mahasiswa mka', type: 'KELUAR', contra: false },
    ],
    opening: {},
    vouchers: [
      {
        id: 'imp-mkk-r7',
        date: '2026-10-07',
        description: 'terima dari BAK',
        lines: [
          { code: '10000', debit: 5000000, credit: 0, description: 'terima dari BAK' },
          { code: '41100', debit: 0, credit: 5000000, description: 'terima dari BAK' },
        ],
      },
      {
        id: 'imp-mkk-r9',
        date: '2026-10-08',
        description: 'konsumsi 5 dosen pendamping& 2 dosen pemateri',
        lines: [
          { code: '56001', debit: 112000, credit: 0, description: 'konsumsi 5 dosen pendamping& 2 dosen pemateri' },
          { code: '10000', debit: 0, credit: 112000, description: 'konsumsi 5 dosen pendamping dan 2 dosen pemateri' },
        ],
      },
      {
        id: 'imp-mkk-r11',
        date: '2026-10-15',
        description: 'konsumsi 4 dosen pendamping dan 2 dosen pemateri',
        lines: [
          { code: '56001', debit: 96000, credit: 0, description: 'konsumsi 4 dosen pendamping dan 2 dosen pemateri' },
          { code: '10000', debit: 0, credit: 96000, description: 'konsumsi 4 dosen pendamping dan 2 dosen pemateri' },
        ],
      },
      {
        id: 'imp-mkk-r13',
        date: '2026-10-22',
        description: 'konsumsi 6 dosen pendamping dan 2 dosen pemateri',
        lines: [
          { code: '56001', debit: 128000, credit: 0, description: 'konsumsi 6 dosen pendamping dan 2 dosen pemateri' },
          { code: '10000', debit: 0, credit: 128000, description: 'konsumsi 6 dosen pendamping dan 2 dosen pemateri' },
        ],
      },
      {
        id: 'imp-mkk-r15',
        date: '2026-10-28',
        description: 'konsumsi pemateri luar',
        lines: [
          { code: '51005', debit: 43000, credit: 0, description: 'konsumsi nasi kotak, snack dan air mineral botol' },
          { code: '10000', debit: 0, credit: 43000, description: 'konsumsi pemateri luar' },
        ],
      },
      {
        id: 'imp-mkk-r17',
        date: '2026-10-29',
        description: 'konsumsi pemateri luar',
        lines: [
          { code: '51005', debit: 57000, credit: 0, description: 'konsumsi nastak, snack dan air mineral botol' },
          { code: '10000', debit: 0, credit: 57000, description: 'konsumsi pemateri luar' },
        ],
      },
      {
        id: 'imp-mkk-r19',
        date: '2026-10-29',
        description: 'konsumsi 6 dosen pendamping',
        lines: [
          { code: '56001', debit: 96000, credit: 0, description: 'konsumsi 6 dosen pendamping ' },
          { code: '10000', debit: 0, credit: 96000, description: 'konsumsi 6 dosen pendamping' },
        ],
      },
      {
        id: 'imp-mkk-r21',
        date: '2026-10-29',
        description: 'vakasi praktisi luar',
        lines: [
          { code: '57000', debit: 1400000, credit: 0, description: 'vakasi praktisi luar' },
          { code: '10000', debit: 0, credit: 1400000, description: 'pemberian vakasi' },
        ],
      },
    ],
  },
};

const plpData = {
  unitId: 'loyalis-grjyoruljaey99f3lulihumtzum2',
  name: 'Pelaksanaan Lapangan Persekolahan',
  raw: {
    accounts: [
      { code: '10000', name: 'KAS', type: 'AKTIVA', contra: false },
      { code: '11001', name: 'BANK UNIPDU 1003253879', type: 'AKTIVA', contra: false },
      { code: '11002', name: 'REK SATKER 7258680547', type: 'AKTIVA', contra: false },
      { code: '20001', name: '- Hutang Dana Reward', type: 'HUTANG', contra: false },
      { code: '20002', name: '- Hutang Dana Mahasiswa-Pribadi', type: 'HUTANG', contra: false },
      { code: '20003', name: '- Hutang Bank', type: 'HUTANG', contra: false },
      { code: '30000', name: 'MODAL', type: 'MODAL', contra: false },
      { code: '41100', name: 'Droping BAK', type: 'TERIMA', contra: false },
      { code: '51000', name: 'Pra PPL', type: 'KELUAR', contra: false },
      { code: '51001', name: 'Sosialisasi Pelaksanaan PLP', type: 'KELUAR', contra: false },
      { code: '51002', name: 'Pembekalan & Pelepasan', type: 'KELUAR', contra: false },
      { code: '51003', name: 'MOU/MOA', type: 'KELUAR', contra: false },
      { code: '51004', name: 'Pelaksanaan PPL', type: 'KELUAR', contra: false },
      { code: '51005', name: 'Mahasiswa', type: 'KELUAR', contra: false },
      { code: '51006.1', name: 'Vakasi Guru Pamong', type: 'KELUAR', contra: false },
      { code: '51006.2', name: 'Vakasi Pimpinan Madrasah', type: 'KELUAR', contra: false },
      { code: '51007', name: 'Supervisi', type: 'KELUAR', contra: false },
      { code: '51008', name: 'Monitoring', type: 'KELUAR', contra: false },
      { code: '51009', name: 'Sidang Hasil PPL', type: 'KELUAR', contra: false },
      { code: '51010', name: 'Pelaporan', type: 'KELUAR', contra: false },
      { code: '51011', name: 'Administrasi Tabungan', type: 'KELUAR', contra: false },
      { code: '51012', name: 'Rapat Evaluasi Pelaksanaan PPL 2', type: 'KELUAR', contra: false },
      { code: '51013', name: 'Atribut Mahasiswa PPL', type: 'KELUAR', contra: false },
      { code: '51014', name: 'DPL', type: 'KELUAR', contra: false },
      { code: '51015', name: 'Stimulan Mahasiswa', type: 'KELUAR', contra: false },
      { code: '51016', name: 'Post Assessment', type: 'KELUAR', contra: false },
    ],
    opening: {},
    vouchers: [
      {
        id: 'imp-plp-r1',
        date: '2026-10-25',
        description: 'Droping ke UPT PPL',
        lines: [
          { code: '11002', debit: 500000, credit: 0, description: 'Droping ke UPT PPL' },
          { code: '41100', debit: 0, credit: 500000, description: 'Droping ke UPT PPL' },
        ],
      },
      {
        id: 'imp-plp-r2',
        date: '2026-10-25',
        description: 'Tarik Tunai Dari Rek PPL',
        lines: [
          { code: '10000', debit: 300000, credit: 0, description: 'Tarik Tunai Dari Rek PPL' },
          { code: '11002', debit: 0, credit: 300000, description: 'Tarik Tunai Dari Rek PPL' },
        ],
      },
      {
        id: 'imp-plp-r3',
        date: '2026-10-28',
        description: 'Total Pengeluaran tgl 25 & 28 Oktober 2026',
        lines: [
          { code: '51000', debit: 112000, credit: 0, description: 'FC & Jilid Spiral proposal (7 eksemplar)' },
          { code: '51001', debit: 80000, credit: 0, description: 'Air mineral Cleo botol kecil (4 krat)' },
          { code: '51000', debit: 148000, credit: 0, description: 'Maksi agenda Pengajuan Proposal penempatan PLP ke 7 sekolah' },
          { code: '10000', debit: 0, credit: 340000, description: 'Total Pengeluaran tgl 25 & 28 Oktober 2026' },
        ],
      },
    ],
  },
};

async function run() {
  const units = [mkkData, plpData];

  for (const u of units) {
    console.log(`\n========================================`);
    console.log(`Processing ${u.name} (${u.unitId})...`);

    const yearDoc = await adminDb.collection('SatkerFinancialYears').doc(`${u.unitId}_${academicYear}`).get();
    if (yearDoc.exists && Number(yearDoc.data()?.entryCount || 0) > 0) {
      console.log(`Skipping ${u.name}: already has ${yearDoc.data()?.entryCount} entries.`);
      continue;
    }

    const res = await importUnitBook({
      actor,
      unitId: u.unitId,
      academicYear,
      raw: u.raw,
    });

    console.log(`SUCCESS importing ${u.name}:`, res);
  }

  console.log('\nAll units processed successfully!');
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
