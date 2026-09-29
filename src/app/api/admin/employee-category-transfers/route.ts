import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import { appendJobCategoryChange } from '@/lib/payroll/blueCollarCategory';
import { isPekaryaJobCategory } from '@/lib/payroll/pekaryaSpj';
import { assertRequestId } from '@/lib/payroll/domain';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import { errorResponse, HttpError, requireAuthenticatedProfile, requireRole } from '@/lib/server/auth';
import { jakartaToday } from '@/lib/server/payrollPeriod';

export const dynamic = 'force-dynamic';

interface Command {
  employeeId: string;
  fromCategory: string;
  toCategory: string;
  effectiveFrom: string;
  replacementEmployeeId?: string;
  requestId: string;
}

function parseCommand(raw: unknown): Command {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Perpindahan kategori tidak valid.');
  const value = raw as Partial<Command>;
  const employeeId = String(value.employeeId || '');
  const replacementEmployeeId = String(value.replacementEmployeeId || '').trim();
  const requestId = String(value.requestId || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(employeeId) ||
      (replacementEmployeeId && !/^[A-Za-z0-9_-]{1,128}$/.test(replacementEmployeeId))) {
    throw new HttpError(400, 'ID pegawai atau pengganti tidak valid.');
  }
  try { assertRequestId(requestId); } catch { throw new HttpError(400, 'requestId tidak valid.'); }
  if (!isPekaryaJobCategory(value.fromCategory) || !isPekaryaJobCategory(value.toCategory) ||
      value.fromCategory === value.toCategory) {
    throw new HttpError(400, 'Kategori lama dan baru wajib berbeda.');
  }
  const effectiveFrom = String(value.effectiveFrom || '');
  if (effectiveFrom !== jakartaToday() || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(effectiveFrom)) {
    throw new HttpError(409, 'Ubah kategori pada tanggal 1 periode payroll yang baru. Tanggal efektif harus hari ini di Jakarta.');
  }
  return {
    employeeId,
    fromCategory: value.fromCategory,
    toCategory: value.toCategory,
    effectiveFrom,
    ...(replacementEmployeeId ? { replacementEmployeeId } : {}),
    requestId,
  };
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'loyalis_admin']);
    const command = parseCommand(await request.json());
    const effectivePeriod = command.effectiveFrom.slice(0, 7);
    const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const employeeRef = adminDb.collection('Employees_BlueCollar').doc(command.employeeId);
    const idempotencyRef = adminDb.collection('FinancialIdempotencyKeys').doc(`${actor.uid}__${command.requestId}`);
    const replacementRef = command.replacementEmployeeId
      ? adminDb.collection('Employees_BlueCollar').doc(command.replacementEmployeeId)
      : null;

    const result = await adminDb.runTransaction(async (transaction) => {
      const [employeeSnapshot, idemSnapshot, teamsSnapshot, usersSnapshot, periodSnapshot,
        slipSnapshot, reportsSnapshot, eventsSnapshot, satpamUraianSnapshot, plansSnapshot,
        replacementSnapshot] = await Promise.all([
        transaction.get(employeeRef),
        transaction.get(idempotencyRef),
        transaction.get(adminDb.collection('SatpamShiftTeams')),
        transaction.get(adminDb.collection('users').where('linkedEmployeeId', '==', command.employeeId)),
        transaction.get(adminDb.collection('PayrollPeriods').doc(effectivePeriod)),
        transaction.get(adminDb.collection('PayrollSlipStates').doc(`${effectivePeriod.replace('-', '_')}_${command.employeeId}`)),
        transaction.get(adminDb.collection('ActivityReports').where('employeeId', '==', command.employeeId).where('period', '==', effectivePeriod)),
        transaction.get(adminDb.collection('KegiatanSpj').where('period', '==', effectivePeriod)),
        transaction.get(adminDb.collection('UraianGaji').doc(`${effectivePeriod.replace('-', '_')}_SATPAM`)),
        transaction.get(adminDb.collection('SatpamDutyPlans')),
        replacementRef ? transaction.get(replacementRef) : Promise.resolve(null),
      ]);

      if (idemSnapshot.exists) {
        if (idemSnapshot.data()?.requestHash !== requestHash ||
            idemSnapshot.data()?.entityId !== command.employeeId) {
          throw new HttpError(409, 'requestId sudah dipakai untuk perpindahan lain.');
        }
        return { employeeId: command.employeeId, idempotent: true };
      }
      if (!employeeSnapshot.exists) throw new HttpError(404, 'Data Pekarya tidak ditemukan.');
      const employee = employeeSnapshot.data()!;
      if (employee.employment?.jobCategory !== command.fromCategory ||
          employee.employment?.status !== 'active' ||
          employee.flags?.isActive === false || employee.flags?.isPayrollEligible === false) {
        throw new HttpError(409, 'Profil atau kategori pegawai berubah. Muat ulang sebelum menyimpan.');
      }
      if (periodSnapshot.data()?.attendanceStatus === 'closed') {
        throw new HttpError(409, 'Periode tujuan sudah ditutup.');
      }
      if (slipSnapshot.exists ||
          reportsSnapshot.docs.some((doc) => doc.data().jobCategory === command.fromCategory) ||
          eventsSnapshot.docs.some((doc) => doc.data().jobCategory === command.fromCategory &&
            doc.data().eventWorkers?.[command.employeeId]) ||
          satpamUraianSnapshot.data()?.entries?.[command.employeeId]) {
        throw new HttpError(409, 'Sudah ada slip, laporan, atau SPJ kategori lama pada periode tujuan. Tinjau dan koreksi sumbernya dahulu.');
      }

      let history;
      try {
        history = appendJobCategoryChange(employee, command.toCategory, command.effectiveFrom);
      } catch (error) {
        throw new HttpError(409, error instanceof Error ? error.message : 'Riwayat kategori tidak valid.');
      }

      const containingTeams = teamsSnapshot.docs.filter((snapshot) => {
        const team = snapshot.data();
        return team.ketuaShiftId === command.employeeId ||
          (Array.isArray(team.memberEmployeeIds) && team.memberEmployeeIds.includes(command.employeeId));
      });
      if (containingTeams.some((snapshot) => snapshot.data().ketuaShiftId === command.employeeId)) {
        throw new HttpError(409, 'Ketua Shift harus diganti melalui konfigurasi regu sebelum kategori diubah.');
      }
      if (containingTeams.length > 1) {
        throw new HttpError(409, 'Pegawai terdaftar pada lebih dari satu regu Satpam. Perbaiki regu dahulu.');
      }
      const teamSnapshot = containingTeams[0];
      if (teamSnapshot && command.toCategory !== 'SATPAM') {
        if (actor.role !== 'super_admin') {
          throw new HttpError(403, 'Perpindahan anggota regu Satpam memerlukan Super Admin.');
        }
        if (!replacementSnapshot?.exists || !command.replacementEmployeeId ||
            command.replacementEmployeeId === command.employeeId) {
          throw new HttpError(409, `Pilih pengganti Satpam aktif untuk ${teamSnapshot.id} sebelum memindahkan pegawai.`);
        }
        const replacement = replacementSnapshot.data()!;
        if (replacement.employment?.jobCategory !== 'SATPAM' ||
            replacement.employment?.status !== 'active' ||
            replacement.flags?.isActive === false) {
          throw new HttpError(409, 'Pengganti bukan Satpam aktif.');
        }
        if (teamsSnapshot.docs.some((snapshot) => {
          const team = snapshot.data();
          return team.ketuaShiftId === command.replacementEmployeeId ||
            (Array.isArray(team.memberEmployeeIds) && team.memberEmployeeIds.includes(command.replacementEmployeeId));
        })) {
          throw new HttpError(409, 'Pengganti sudah terdaftar pada regu Satpam.');
        }
        // A published plan still containing the old member must be revised
        // through the existing duty-plan workflow before this transaction.
        if (plansSnapshot.docs.some((snapshot) => {
          const plan = snapshot.data();
          return plan.teamId === teamSnapshot.id &&
            String(plan.period || '') >= effectivePeriod &&
            plan.status !== 'stale';
        })) {
          throw new HttpError(409, 'Rencana dinas regu pada periode tujuan sudah ada. Revisi rencana dan regu terlebih dahulu.');
        }
      } else if (command.replacementEmployeeId) {
        throw new HttpError(409, 'Pengganti hanya diperlukan bila pegawai masih anggota regu Satpam.');
      }

      for (const linkedUser of usersSnapshot.docs) {
        if (linkedUser.data().role === 'ketua_shift_satpam') {
          throw new HttpError(409, 'Akun Ketua Shift harus diubah perannya sebelum kategori pegawai diubah.');
        }
      }

      transaction.update(employeeRef, {
        employment: {
          ...employee.employment,
          jobCategory: command.toCategory,
          jobCategoryHistory: history,
        },
        'audit.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
      });
      usersSnapshot.docs.forEach((linkedUser) => {
        if (linkedUser.data().role === 'honorer') {
          transaction.update(linkedUser.ref, { permittedCategories: [command.toCategory] });
        }
      });
      if (teamSnapshot && command.toCategory !== 'SATPAM') {
        const team = teamSnapshot.data();
        transaction.update(teamSnapshot.ref, {
          memberEmployeeIds: team.memberEmployeeIds.map((id: string) =>
            id === command.employeeId ? command.replacementEmployeeId : id),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedByUid: actor.uid,
        });
      }
      transaction.create(idempotencyRef, {
        requestHash,
        entityId: command.employeeId,
        action: 'employee_category_transfer',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      transaction.create(newFinancialAuditRef(), buildFinancialAuditRecord(actor, {
        action: 'employee_category_transfer',
        entityType: 'Employees_BlueCollar',
        entityId: command.employeeId,
        requestId: command.requestId,
        reason: `Perpindahan kategori Pekarya mulai ${command.effectiveFrom}`,
        before: { category: command.fromCategory, teamId: teamSnapshot?.id || null },
        after: { category: command.toCategory, effectiveFrom: command.effectiveFrom,
          replacementEmployeeId: command.replacementEmployeeId || null },
      }));
      return { employeeId: command.employeeId, idempotent: false };
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
