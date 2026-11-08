/** Read-only unless --apply and an explicit --ids=member-1,member-2 allowlist. */
import { createHash } from 'node:crypto';
import admin, { adminDb } from '../src/lib/firebase-admin';
import { koperasiAdminDb } from '../src/lib/koperasi-admin';
import { isConvertedAway } from '../src/lib/employeeConversion';
import { employeeLinkedToMember, koperasiMemberApproved, type KoperasiMember } from '../src/lib/koperasiMembers';

async function main() {
  const apply = process.argv.includes('--apply');
  const period = process.argv.find(value => value.startsWith('--period='))?.slice(9) || '2026-11';
  const ids = new Set((process.argv.find(value => value.startsWith('--ids='))?.slice(6) || '').split(',').filter(Boolean));
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Use --period=YYYY-MM.');
  if (apply && !ids.size) throw new Error('--apply requires an explicit --ids allowlist from the dry run.');
  const koperasi = koperasiAdminDb();
  const [members, blue, loyalis, slips, periodDoc, existingAudits] = await Promise.all([
    koperasi.collection('users').get(), adminDb.collection('Employees_BlueCollar').get(),
    adminDb.collection('Employees_Loyalis').get(), adminDb.collection('PayrollSlipStates').where('period', '==', period.replace('-', '_')).get(),
    adminDb.doc(`PayrollPeriods/${period}`).get(), adminDb.collection('FinancialAuditLogs').where('action', '==', 'KOPERASI_SAVINGS_MIGRATED').get(),
  ]);
  const employees = [...blue.docs, ...loyalis.docs].filter(doc => !isConvertedAway(doc.data()));
  const changes: Array<{ member: FirebaseFirestore.QueryDocumentSnapshot; employee: FirebaseFirestore.QueryDocumentSnapshot }> = [];
  const auditRepairs: typeof changes = [];
  const auditIds = new Set(existingAudits.docs.map(doc => doc.id));
  const auditIdFor = (memberId: string) => `koperasi_savings_${createHash('sha256').update(`${period}:${memberId}`).digest('hex')}`;
  const conflicts: Array<{ memberId: string; reason: string }> = [];
  let alreadyManaged = 0, payrollMonthlyTotal = 0, subsidyCount = 0;
  for (const member of members.docs) {
    const data = { ...member.data(), id: member.id } as KoperasiMember;
    if (!koperasiMemberApproved(data) || !['Payroll Deduction', 'Yayasan Subsidy'].includes(data.paymentStatus || '') || ids.size && !ids.has(member.id)) continue;
    const holders = employees.filter(employee => employeeLinkedToMember(data, employee.data()));
    if (!holders.length) continue;
    if (holders.length !== 1) { conflicts.push({ memberId: member.id, reason: 'Multiple employee links' }); continue; }
    const employee = holders[0];
    if (employee.data().koperasiUserId !== member.id || employee.data().koperasiAuthUid !== (data.uid || member.id)) {
      conflicts.push({ memberId: member.id, reason: 'Incomplete or contradictory explicit links' }); continue;
    }
    if (data.payrollSavings) {
      alreadyManaged++;
      if (member.data().payrollSavings.migrationId === `legacy_${period}` && !auditIds.has(auditIdFor(member.id))) auditRepairs.push({ member, employee });
      continue;
    }
    if (data.paymentStatus === 'Payroll Deduction') payrollMonthlyTotal += Number(data.iuranWajib) || 25000;
    else subsidyCount++;
    changes.push({ member, employee });
  }
  if (ids.size) for (const id of ids) if (!members.docs.some(member => member.id === id)) conflicts.push({ memberId: id, reason: 'Member not found' });
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY RUN', period, candidates: changes.length, auditRepairs: auditRepairs.length, alreadyManaged, subsidyCount,
    payrollMonthlyTotal, balancesChanged: false, initialContributionsRecharged: false,
    memberIds: changes.map(change => change.member.id), conflicts }, null, 2));
  if (conflicts.length) throw new Error('Resolve link conflicts before applying the migration.');
  if (!apply) return;
  if (changes.length && (periodDoc.data()?.attendanceStatus === 'closed' || slips.size)) throw new Error('Migrate before preparing or closing this payroll month.');
  const migrationRef = adminDb.doc(`KoperasiEnrollments/migration__${period}`);
  const selectedIds = [...ids].sort();
  const migrationStarted = await adminDb.runTransaction(async transaction => {
    const [migration, currentPeriod, currentSlips] = await Promise.all([
      transaction.get(migrationRef), transaction.get(adminDb.doc(`PayrollPeriods/${period}`)),
      transaction.get(adminDb.collection('PayrollSlipStates').where('period', '==', period.replace('-', '_'))),
    ]);
    if (migration.data()?.state === 'pending' && JSON.stringify(migration.data()!.memberIds) !== JSON.stringify(selectedIds)) throw new Error('Resume the pending migration with its original --ids allowlist.');
    if (!changes.length && migration.data()?.state !== 'pending') return false;
    if (currentPeriod.data()?.attendanceStatus === 'closed' || currentPeriod.data()?.payrollRosterSeal || currentSlips.size) throw new Error('Payroll changed; migration cannot start or resume.');
    transaction.set(migrationRef, { state: 'pending', firstPayrollPeriod: period, memberIds: selectedIds, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
  for (const { member, employee } of [...changes, ...auditRepairs]) {
    const currentEmployee = await employee.ref.get();
    if (!employeeLinkedToMember({ ...member.data(), id: member.id }, currentEmployee.data() || {}) ||
        currentEmployee.data()?.koperasiUserId !== member.id || currentEmployee.data()?.koperasiAuthUid !== (member.data().uid || member.id)) throw new Error(`Link changed for ${member.id}; rerun dry run.`);
    const preservedBalance = await koperasi.runTransaction(async transaction => {
      const current = await transaction.get(member.ref);
      if (current.data()?.payrollSavings) {
        if (current.data()!.payrollSavings.migrationId !== `legacy_${period}`) throw new Error(`Member policy changed: ${member.id}`);
        return current.data()!.nominalTabungan ?? null;
      }
      if (!current.exists || current.data()!.uid !== member.data().uid || !koperasiMemberApproved(current.data()!) ||
          current.data()!.paymentStatus !== member.data().paymentStatus || current.data()!.iuranPokok !== member.data().iuranPokok || current.data()!.iuranWajib !== member.data().iuranWajib) throw new Error(`Member changed: ${member.id}`);
      transaction.update(member.ref, { payrollSavings: { startPeriod: period, initialPeriod: period, initialPaid: true,
        migrationId: `legacy_${period}`, legacyCreditedThroughPeriod: '2026-10' }, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return current.data()!.nominalTabungan ?? null;
    });
    const auditId = auditIdFor(member.id);
    const audit = adminDb.collection('FinancialAuditLogs').doc(auditId);
    await adminDb.runTransaction(async transaction => {
      if ((await transaction.get(audit)).exists) return;
      transaction.create(audit, { action: 'KOPERASI_SAVINGS_MIGRATED', entityType: 'KoperasiMember', entityId: member.id,
        reason: 'Move payroll savings from scheduled credits to Verifikasi & Kunci; 4 November credit belongs to October.',
        actorUid: 'migration', actorRole: 'super_admin', actorEmail: null, schemaVersion: 1,
        before: { payrollSavings: null }, after: { startPeriod: period, initialPaid: true },
        metadata: { employeePath: employee.ref.path, preservedBalance },
        occurredAt: admin.firestore.FieldValue.serverTimestamp() });
    });
  }
  if (migrationStarted) await migrationRef.update({ state: 'completed', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log(`Migrated ${changes.length} members without changing balances.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
