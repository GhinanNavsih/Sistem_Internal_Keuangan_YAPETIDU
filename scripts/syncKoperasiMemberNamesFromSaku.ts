import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

type LinkedEmployee = {
  id: string;
  collection: 'Employees_Loyalis' | 'Employees_BlueCollar';
  ref: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
  koperasiUserId: string;
  koperasiAuthUid: string;
  koperasiMemberId: string;
  name: string;
};

type NameChange = {
  memberId: string;
  memberRef: FirebaseFirestore.DocumentReference;
  memberUpdateTime: FirebaseFirestore.Timestamp;
  memberNameBefore: string;
  employee: LinkedEmployee;
};

type LoanNameChange = {
  loanId: string;
  loanRef: FirebaseFirestore.DocumentReference;
  loanUpdateTime: FirebaseFirestore.Timestamp;
  memberId: string;
  borrowerNameBefore: string;
  targetName: string;
  employee: LinkedEmployee;
};

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sakuName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '';
}

function sourceEmployeeName(employee: LinkedEmployee): string { return employee.name; }

function display(value: string): string {
  return value ? JSON.stringify(value) : '(kosong)';
}

async function main() {
  const commit = process.argv.includes('--commit');
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Script ini ditujukan untuk data live dan menolak FIRESTORE_EMULATOR_HOST.');
  }

  // Import after dotenv so the app credentials and project IDs come from .env.local.
  const [{ adminDb }, { isKoperasiAdminConfigured, koperasiAdminDb }, { isConvertedAway }, { newFinancialAuditRef }] = await Promise.all([
    import('../src/lib/firebase-admin'),
    import('../src/lib/koperasi-admin'),
    import('../src/lib/employeeConversion'),
    import('../src/lib/server/audit'),
  ]);

  if (!isKoperasiAdminConfigured()) throw new Error('Kredensial Admin Koperasi tidak tersedia.');
  const primaryProjectId = admin.app().options.projectId;
  const koperasiProjectId = admin.app('koperasi').options.projectId;
  if (primaryProjectId !== 'internal-bak' || koperasiProjectId !== 'koperasi-unipdu') {
    throw new Error(`Project Firebase tidak sesuai. SAKU=${primaryProjectId || 'unknown'}, Koperasi=${koperasiProjectId || 'unknown'}.`);
  }

  const koperasiDb = koperasiAdminDb();
  const [users, loyalis, pekarya, loans] = await Promise.all([
    koperasiDb.collection('users').get(),
    adminDb.collection('Employees_Loyalis').get(),
    adminDb.collection('Employees_BlueCollar').get(),
    koperasiDb.collection('simpanPinjam').get(),
  ]);

  const memberIdentity = new Map<string, Set<string>>();
  const memberData = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const user of users.docs) {
    memberData.set(user.id, user);
    for (const identity of [user.id, nonEmptyString(user.data().uid)]) {
      if (!identity) continue;
      const ids = memberIdentity.get(identity) || new Set<string>();
      ids.add(user.id);
      memberIdentity.set(identity, ids);
    }
  }

  const candidates: LinkedEmployee[] = [
    ...loyalis.docs.map(doc => ({
      id: doc.id, collection: 'Employees_Loyalis' as const, ref: doc.ref, data: doc.data(),
      koperasiUserId: nonEmptyString(doc.data().koperasiUserId),
      koperasiAuthUid: nonEmptyString(doc.data().koperasiAuthUid),
      koperasiMemberId: '', name: sakuName(doc.data().personal_info?.name),
    })),
    ...pekarya.docs.map(doc => ({
      id: doc.id, collection: 'Employees_BlueCollar' as const, ref: doc.ref, data: doc.data(),
      koperasiUserId: nonEmptyString(doc.data().koperasiUserId),
      koperasiAuthUid: nonEmptyString(doc.data().koperasiAuthUid),
      koperasiMemberId: '', name: sakuName(doc.data().name),
    })),
  ];

  const linkedEmployees: LinkedEmployee[] = [];
  const issues: string[] = [];
  let convertedAway = 0;
  for (const employee of candidates) {
    if (isConvertedAway(employee.data)) {
      convertedAway += 1;
      continue;
    }
    if (!employee.koperasiUserId && !employee.koperasiAuthUid) continue;

    const userIdMatches = employee.koperasiUserId ? memberIdentity.get(employee.koperasiUserId) : undefined;
    const authUidMatches = employee.koperasiAuthUid ? memberIdentity.get(employee.koperasiAuthUid) : undefined;
    const allMatches = new Set([...(userIdMatches || []), ...(authUidMatches || [])]);
    const hasDanglingReference = Boolean(
      (employee.koperasiUserId && !userIdMatches?.size) ||
      (employee.koperasiAuthUid && !authUidMatches?.size),
    );
    if (hasDanglingReference || allMatches.size !== 1) {
      issues.push(`${employee.collection}/${employee.id}: ${hasDanglingReference ? 'tautan tidak menemukan satu akun Koperasi' : 'koperasiUserId dan koperasiAuthUid ambigu'}`);
      continue;
    }
    employee.koperasiMemberId = [...allMatches][0];
    linkedEmployees.push(employee);
  }

  const holdersByMember = new Map<string, LinkedEmployee[]>();
  for (const employee of linkedEmployees) {
    const holders = holdersByMember.get(employee.koperasiMemberId) || [];
    holders.push(employee);
    holdersByMember.set(employee.koperasiMemberId, holders);
  }

  const changes: NameChange[] = [];
  const linkedNameByMember = new Map<string, { employee: LinkedEmployee; targetName: string }>();
  let alreadyMatched = 0;
  for (const [memberId, holders] of holdersByMember) {
    if (holders.length !== 1) {
      issues.push(`users/${memberId}: tertaut ke ${holders.length} pegawai SAKU aktif/non-konversi`);
      continue;
    }
    const employee = holders[0];
    const user = memberData.get(memberId)!;
    const targetName = sourceEmployeeName(employee);
    linkedNameByMember.set(memberId, { employee, targetName });
    const currentName = typeof user.data().nama === 'string' ? user.data().nama : '';
    if (!targetName) {
      issues.push(`${employee.collection}/${employee.id}: nama SAKU kosong`);
      continue;
    }
    if (currentName === targetName) {
      alreadyMatched += 1;
      continue;
    }
    changes.push({
      memberId, memberRef: user.ref, memberUpdateTime: user.updateTime!,
      memberNameBefore: typeof user.data().nama === 'string' ? user.data().nama : '',
      employee,
    });
  }

  const loanChanges: LoanNameChange[] = [];
  let linkedLoansAlreadyMatched = 0;
  for (const loan of loans.docs) {
    const loanUserId = nonEmptyString(loan.data().userId);
    if (!loanUserId) continue;
    const userIds = memberIdentity.get(loanUserId);
    const linkedIds = [...(userIds || [])].filter(memberId => linkedNameByMember.has(memberId));
    if (!linkedIds.length) continue;
    if (userIds?.size !== 1 || linkedIds.length !== 1) {
      issues.push(`simpanPinjam/${loan.id}: userId cocok ke lebih dari satu anggota tertaut`);
      continue;
    }
    const memberId = linkedIds[0];
    const linked = linkedNameByMember.get(memberId)!;
    const currentBorrowerName = loan.data().userData?.namaLengkap;
    // Preserve empty snapshots; the page already falls back to the linked member profile.
    if (typeof currentBorrowerName !== 'string' || !currentBorrowerName) continue;
    if (currentBorrowerName === linked.targetName) {
      linkedLoansAlreadyMatched += 1;
      continue;
    }
    loanChanges.push({
      loanId: loan.id, loanRef: loan.ref, loanUpdateTime: loan.updateTime!, memberId,
      borrowerNameBefore: currentBorrowerName, targetName: linked.targetName, employee: linked.employee,
    });
  }

  const mode = commit ? 'COMMIT' : 'DRY-RUN';
  console.log(`Mode: ${mode}`);
  console.log(`Firebase projects: SAKU=${primaryProjectId}, Koperasi=${koperasiProjectId}`);
  console.log(`Koperasi users: ${users.size}; loans: ${loans.size}; current linked employees: ${linkedEmployees.length}; converted-away Pekarya skipped: ${convertedAway}`);
  console.log(`Member profiles: already matched ${alreadyMatched}, to update ${changes.length}; loan borrower names: already matched ${linkedLoansAlreadyMatched}, to update ${loanChanges.length}; issues: ${issues.length}`);
  for (const change of changes) {
    console.log(`[${commit ? 'UPDATE' : 'DRY-RUN'}] users/${change.memberId} ← ${change.employee.collection}/${change.employee.id}: ${display(change.memberNameBefore)} → ${display(change.employee.name)}`);
  }
  for (const change of loanChanges) {
    console.log(`[${commit ? 'UPDATE' : 'DRY-RUN'}] simpanPinjam/${change.loanId} (users/${change.memberId}, ${change.employee.collection}/${change.employee.id}): ${display(change.borrowerNameBefore)} → ${display(change.targetName)}`);
  }
  for (const issue of issues) console.warn(`[SKIP] ${issue}`);

  if (issues.length) {
    throw new Error('Tidak ada perubahan yang diterapkan karena ada tautan atau nama yang perlu ditinjau.');
  }
  if (!commit || (changes.length === 0 && loanChanges.length === 0)) {
    console.log(changes.length === 0 && loanChanges.length === 0 ? 'Tidak ada nama yang perlu diperbarui.' : 'Preview selesai. Jalankan dengan --commit untuk menerapkan perubahan.');
    return;
  }
  const totalChanges = changes.length + loanChanges.length;
  if (totalChanges > 450) throw new Error(`Menolak ${totalChanges} perubahan dalam satu batch; batas keamanan script adalah 450.`);

  // Re-read both projects before writing. This prevents applying a stale preview
  // if a member, employee name, or link changed while the script was running.
  const memberIdsToCheck = new Set([...changes.map(change => change.memberId), ...loanChanges.map(change => change.memberId)]);
  const memberRefs = [...memberIdsToCheck].map(memberId => memberData.get(memberId)!.ref);
  const [currentMembers, currentLoans] = await Promise.all([
    memberRefs.length ? koperasiDb.getAll(...memberRefs) : Promise.resolve([]),
    loanChanges.length ? koperasiDb.getAll(...loanChanges.map(change => change.loanRef)) : Promise.resolve([]),
  ]);
  const currentMemberById = new Map(currentMembers.map(snapshot => [snapshot.id, snapshot]));
  const memberChangeById = new Map(changes.map(change => [change.memberId, change]));
  for (const memberId of memberIdsToCheck) {
    const initialMember = memberData.get(memberId)!;
    const currentMember = currentMemberById.get(memberId);
    const profileChange = memberChangeById.get(memberId);
    const linked = linkedNameByMember.get(memberId)!;
    const expectedCurrentName = profileChange ? profileChange.memberNameBefore : linked.targetName;
    if (!currentMember?.exists || currentMember.updateTime?.toMillis() !== initialMember.updateTime?.toMillis() ||
      (typeof currentMember.data()?.nama === 'string' ? currentMember.data()!.nama : '') !== expectedCurrentName) {
      throw new Error(`Data users/${memberId} berubah sejak preview; tidak ada perubahan diterapkan.`);
    }
  }
  const allEmployeeRefs = new Map([...changes.map(change => change.employee), ...loanChanges.map(change => change.employee)]
    .map(employee => [employee.ref.path, employee.ref]));
  const employeeSnapshots = allEmployeeRefs.size ? await adminDb.getAll(...allEmployeeRefs.values()) : [];
  const employeeByPath = new Map(employeeSnapshots.map(snapshot => [snapshot.ref.path, snapshot]));
  for (const change of changes) {
    const currentEmployee = employeeByPath.get(change.employee.ref.path);
    if (!currentEmployee?.exists) throw new Error('Data berubah saat preview; jalankan ulang dry-run.');
    const currentEmployeeData = currentEmployee.data()!;
    const currentSourceRaw = change.employee.collection === 'Employees_Loyalis'
      ? currentEmployeeData.personal_info?.name
      : currentEmployeeData.name;
    const currentSourceName = sakuName(currentSourceRaw);
    if (isConvertedAway(currentEmployeeData) || currentSourceName !== change.employee.name ||
      nonEmptyString(currentEmployeeData.koperasiUserId) !== change.employee.koperasiUserId ||
      nonEmptyString(currentEmployeeData.koperasiAuthUid) !== change.employee.koperasiAuthUid) {
      throw new Error(`Nama atau tautan ${change.employee.collection}/${change.employee.id} berubah sejak preview; tidak ada perubahan diterapkan.`);
    }
  }
  for (const [index, change] of loanChanges.entries()) {
    const currentLoan = currentLoans[index];
    if (!currentLoan.exists || currentLoan.updateTime?.toMillis() !== change.loanUpdateTime.toMillis() ||
      currentLoan.data()?.userData?.namaLengkap !== change.borrowerNameBefore) {
      throw new Error(`Data simpanPinjam/${change.loanId} berubah sejak preview; tidak ada perubahan diterapkan.`);
    }
    const currentEmployee = employeeByPath.get(change.employee.ref.path);
    if (!currentEmployee?.exists) throw new Error(`Pegawai ${change.employee.collection}/${change.employee.id} tidak ditemukan saat validasi ulang.`);
    const currentEmployeeData = currentEmployee.data()!;
    const currentSourceRaw = change.employee.collection === 'Employees_Loyalis'
      ? currentEmployeeData.personal_info?.name
      : currentEmployeeData.name;
    if (isConvertedAway(currentEmployeeData) || sakuName(currentSourceRaw) !== change.targetName ||
      nonEmptyString(currentEmployeeData.koperasiUserId) !== change.employee.koperasiUserId ||
      nonEmptyString(currentEmployeeData.koperasiAuthUid) !== change.employee.koperasiAuthUid) {
      throw new Error(`Nama atau tautan ${change.employee.collection}/${change.employee.id} berubah sejak preview; tidak ada perubahan diterapkan.`);
    }
  }

  const auditRef = newFinancialAuditRef();
  await auditRef.create({
    action: 'KOPERASI_MEMBER_NAMES_SYNCED', entityType: 'KoperasiMember', entityId: 'bulk-name-sync',
    requestId: auditRef.id, reason: 'Nama anggota Koperasi mengikuti nama pegawai SAKU yang tertaut.',
    actorUid: 'script:sync-koperasi-member-names-from-saku', actorRole: 'system', actorEmail: null,
    before: {
      members: changes.map(change => ({ memberId: change.memberId, nama: change.memberNameBefore })),
      loans: loanChanges.map(change => ({ loanId: change.loanId, memberId: change.memberId, namaLengkap: change.borrowerNameBefore })),
    },
    after: {
      members: changes.map(change => ({ memberId: change.memberId, nama: change.employee.name,
        employeeId: change.employee.id, employeeCollection: change.employee.collection })),
      loans: loanChanges.map(change => ({ loanId: change.loanId, memberId: change.memberId,
        namaLengkap: change.targetName, employeeId: change.employee.id, employeeCollection: change.employee.collection })),
    },
    metadata: { outcome: 'pending', script: 'scripts/syncKoperasiMemberNamesFromSaku.ts', memberCount: changes.length, loanCount: loanChanges.length },
    occurredAt: admin.firestore.FieldValue.serverTimestamp(), schemaVersion: 1,
  });

  const batch = koperasiDb.batch();
  for (const change of changes) {
    batch.update(change.memberRef, { nama: change.employee.name }, { lastUpdateTime: change.memberUpdateTime });
  }
  for (const change of loanChanges) {
    batch.update(change.loanRef, { 'userData.namaLengkap': change.targetName }, { lastUpdateTime: change.loanUpdateTime });
  }
  try {
    await batch.commit();
  } catch (error) {
    await auditRef.update({
      'metadata.outcome': 'failed',
      'metadata.error': error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(() => undefined);
    throw error;
  }
  try {
    await auditRef.update({ 'metadata.outcome': 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (error) {
    throw new Error(`Names were updated, but the audit status could not be finalized (audit ${auditRef.id}): ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  console.log(`Updated ${changes.length} Koperasi member names and ${loanChanges.length} loan borrower names from SAKU. Audit: ${auditRef.id}`);
}

main().catch(error => {
  console.error('Koperasi member name sync failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
