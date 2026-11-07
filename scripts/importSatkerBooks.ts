import * as XLSX from 'xlsx';
import { adminDb } from '../src/lib/firebase-admin';
import { readBookWorkbook } from '../src/lib/satker-finance/workbookBook';
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

const units = [
  {
    name: 'Badan Pelayanan Kemahasiswaan',
    unitId: 'loyalis-qkieuuajftmkrkzpcpc1icqoaib3',
    akun: 'Akun Biro Pelayanan Kemahasiswa',
    jurnal: 'Jurnal Biro Pelayanan Kemahasis',
  },
  {
    name: 'Perpustakaan',
    unitId: 'loyalis-dsuonz6sjhfnq2bwjh6jljvjfj22',
    akun: 'Akun Perpustakaan',
    jurnal: 'Jurnal Perpustakaan',
  },
  {
    name: 'Fakultas Sains & Teknologi',
    unitId: 'loyalis-wggnhvsnmwc99ppgi3h89ty6rae2',
    akun: 'Akun Fakultas Sains & Teknologi',
    jurnal: 'Jurnal Fakultas Sains & Teknolo',
  },
  {
    name: 'Hubungan Masyarakat',
    unitId: 'loyalis-vqcfkcply8uhz8mkjya9yqolkui1',
    akun: 'Akun Hubungan Masyarakat',
    jurnal: 'Jurnal Hunbungan Masyarakat',
  },
  {
    name: 'Pusat Penjaminan Mutu',
    unitId: 'loyalis-virna7vu9hsfn5iigr8lme15bws1',
    akun: 'Akun Penjaminan Mutu',
    jurnal: 'Jurnal Penjaminan Mutu',
    needsClearOrphanAccounts: true,
  },
  {
    name: 'Pascasarjana',
    unitId: 'loyalis-osvyzxrgodptcxjjdde53ndfqd33',
    akun: 'Akun Pascasarjana',
    jurnal: 'Jurnal Pascasarjana',
    needsClearOrphanAccounts: true,
  },
  {
    name: 'Penerimaan Mahasiswa Baru',
    unitId: 'loyalis-66skmezoflcecatg1lqsc0fghax2',
    akun: 'Akun Penerimaan Mahasiswa Baru',
    jurnal: 'Jurnal Penerimaan Mahasiswa Bar',
    needsClearOrphanAccounts: true,
  },
];

async function run() {
  const wb = XLSX.readFile('Akun & Jurnal SatKer.xlsx', { cellFormula: true });

  for (const u of units) {
    console.log(`\n========================================`);
    console.log(`Processing ${u.name} (${u.unitId})...`);

    const result = readBookWorkbook({
      akun: wb.Sheets[u.akun],
      akunLabel: u.akun,
      jurnal: wb.Sheets[u.jurnal],
      jurnalLabel: u.jurnal,
      academicYear,
    });

    if (result.problems.length > 0 || !result.book) {
      console.error(`ERROR: ${u.name} has ${result.problems.length} problems:`, result.problems);
      continue;
    }

    const yearDoc = await adminDb.collection('SatkerFinancialYears').doc(`${u.unitId}_${academicYear}`).get();
    if (yearDoc.exists && Number(yearDoc.data()?.entryCount || 0) > 0) {
      console.log(`Skipping ${u.name}: already has ${yearDoc.data()?.entryCount} entries.`);
      continue;
    }

    console.log(`Validated: ${result.summary.accounts} accounts, ${result.summary.openingAccounts} opening, ${result.summary.vouchers} vouchers (${result.summary.lines} lines, total debit ${result.summary.debit})`);

    if (u.needsClearOrphanAccounts) {
      const snap = await adminDb.collection('SatkerFinancialUnits').doc(u.unitId).collection('accountCatalog').get();
      if (!snap.empty) {
        console.log(`Clearing ${snap.docs.length} incomplete orphan accountCatalog docs for ${u.name}...`);
        const batch = adminDb.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    }

    const res = await importUnitBook({
      actor,
      unitId: u.unitId,
      academicYear,
      raw: {
        accounts: result.book.accounts,
        opening: result.book.opening,
        vouchers: result.book.vouchers,
      },
    });

    console.log(`SUCCESS importing ${u.name}:`, res);
  }

  console.log('\nAll units processed successfully!');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
