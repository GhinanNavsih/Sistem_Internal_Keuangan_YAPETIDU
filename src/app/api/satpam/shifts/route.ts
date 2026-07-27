import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  activityReportId,
  assertDateOnly,
  assertRequestId,
  assertSatpamPhotoUrl,
  getRegularSatpamPayType,
  getShiftIsoBounds,
  guardDutyIndexId,
  payrollPeriodForDutyDate,
  SATPAM_HOLIDAY_CALENDAR_VERSION,
  SATPAM_POSTS,
  SATPAM_RATES,
  SATPAM_RATE_VERSION,
  SHIFT_TIMES,
  shiftOccurrenceId,
  SubmitSatpamShiftInput,
} from '@/lib/payroll/domain';
import { getSatpamShiftForTeam } from '@/utils/satpamRotation';
import { buildFinancialAuditRecord, newFinancialAuditRef } from '@/lib/server/audit';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseInput(raw: unknown, ketuaShiftId: string): SubmitSatpamShiftInput {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(400, 'Payload shift tidak valid.');
  }
  const input = raw as Partial<SubmitSatpamShiftInput>;
  if (typeof input.requestId !== 'string' || typeof input.dutyDate !== 'string') {
    throw new HttpError(400, 'requestId dan dutyDate wajib diisi.');
  }
  assertRequestId(input.requestId);
  assertDateOnly(input.dutyDate);
  if (!Array.isArray(input.assignments)) {
    throw new HttpError(400, 'Daftar penugasan tidak valid.');
  }
  const assignments = input.assignments.map((assignment: unknown) => {
    if (!assignment || typeof assignment !== 'object') {
      throw new HttpError(400, 'Baris penugasan tidak valid.');
    }
    const value = assignment as Record<string, unknown>;
    if (
      typeof value.postId !== 'string' ||
      typeof value.employeeId !== 'string' ||
      !value.employeeId ||
      (value.coveredEmployeeId !== undefined &&
        typeof value.coveredEmployeeId !== 'string') ||
      (value.overtimeReason !== undefined &&
        (typeof value.overtimeReason !== 'string' ||
          value.overtimeReason.length > 500))
    ) {
      throw new HttpError(400, 'Data pos, petugas, atau alasan lembur tidak valid.');
    }
    if (value.photoUrl !== undefined && value.photoUrl !== '') {
      if (typeof value.photoUrl !== 'string') {
        throw new HttpError(400, 'URL foto bukti tidak valid.');
      }
      try {
        assertSatpamPhotoUrl(value.photoUrl, ketuaShiftId);
      } catch (error) {
        throw new HttpError(
          400,
          error instanceof Error ? error.message : 'URL foto bukti tidak valid.',
        );
      }
    }
    return {
      postId: value.postId,
      employeeId: value.employeeId,
      ...(typeof value.shiftType === 'string' && value.shiftType in SATPAM_RATES
        ? { shiftType: value.shiftType as any }
        : {}),
      ...(typeof value.coveredEmployeeId === 'string'
        ? { coveredEmployeeId: value.coveredEmployeeId }
        : {}),
      ...(typeof value.overtimeReason === 'string'
        ? { overtimeReason: value.overtimeReason }
        : {}),
      ...(typeof value.photoUrl === 'string' && value.photoUrl
        ? { photoUrl: value.photoUrl }
        : {}),
    } as SubmitSatpamShiftInput['assignments'][number];
  });
  let extraAssignment: SubmitSatpamShiftInput['extraAssignment'];
  if (input.extraAssignment !== undefined) {
    if (!input.extraAssignment || typeof input.extraAssignment !== 'object') {
      throw new HttpError(400, 'Penugasan tambahan tidak valid.');
    }
    const extra = input.extraAssignment as unknown as Record<string, unknown>;
    if (
      typeof extra.postId !== 'string' ||
      typeof extra.employeeId !== 'string' ||
      !extra.employeeId ||
      typeof extra.overtimeReason !== 'string' ||
      extra.overtimeReason.length > 500
    ) {
      throw new HttpError(400, 'Data Lembur Sendiri tidak valid.');
    }
    if (extra.photoUrl !== undefined && extra.photoUrl !== '') {
      if (typeof extra.photoUrl !== 'string') {
        throw new HttpError(400, 'URL foto bukti tidak valid.');
      }
      try {
        assertSatpamPhotoUrl(extra.photoUrl, ketuaShiftId);
      } catch (error) {
        throw new HttpError(
          400,
          error instanceof Error ? error.message : 'URL foto bukti tidak valid.',
        );
      }
    }
    extraAssignment = {
      postId: extra.postId,
      employeeId: extra.employeeId,
      overtimeReason: extra.overtimeReason,
      ...(typeof extra.photoUrl === 'string' && extra.photoUrl
        ? { photoUrl: extra.photoUrl }
        : {}),
    } as SubmitSatpamShiftInput['extraAssignment'];
  }
  return {
    requestId: input.requestId,
    dutyDate: input.dutyDate,
    assignments,
    ...(extraAssignment ? { extraAssignment } : {}),
  };
}

function isActiveSatpam(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return Boolean(
    data &&
      data.employment?.jobCategory === 'SATPAM' &&
      (data.employment?.status === 'active' || data.flags?.isActive === true),
  );
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['ketua_shift_satpam']);
    if (!actor.linkedEmployeeId) {
      throw new HttpError(409, 'Akun Ketua Shift belum terhubung ke data Satpam.');
    }

    const input = parseInput(await request.json(), actor.linkedEmployeeId);
    const teamQuery = await adminDb
      .collection('SatpamShiftTeams')
      .where('ketuaShiftId', '==', actor.linkedEmployeeId)
      .limit(2)
      .get();
    if (teamQuery.size !== 1) {
      throw new HttpError(409, 'Konfigurasi regu Ketua Shift harus tepat satu.');
    }

    const teamRef = teamQuery.docs[0].ref;
    const teamId = teamRef.id;
    const teamNumber = Number(teamId.split('_')[1]);
    if (![1, 2, 3].includes(teamNumber)) {
      throw new HttpError(409, 'Nomor regu Satpam tidak valid.');
    }

    const shiftName = getSatpamShiftForTeam(teamNumber, input.dutyDate);
    const occurrenceId = shiftOccurrenceId(teamId, input.dutyDate, shiftName);
    const period = payrollPeriodForDutyDate(input.dutyDate);
    const requestHash = stableHash({
      dutyDate: input.dutyDate,
      assignments: [...input.assignments].sort((a, b) => a.postId.localeCompare(b.postId)),
      extraAssignment: input.extraAssignment || null,
    });

    const transactionResult = await adminDb.runTransaction(async (transaction) => {
      const occurrenceRef = adminDb.collection('ShiftOccurrences').doc(occurrenceId);
      const idempotencyRef = adminDb
        .collection('FinancialIdempotencyKeys')
        .doc(`${actor.uid}__${input.requestId}`);
      const periodRef = adminDb.collection('PayrollPeriods').doc(period);
      const holidayRef = adminDb
        .collection('PayrollHolidayCalendars')
        .doc(input.dutyDate.slice(0, 4));

      const [teamSnapshot, occurrenceSnapshot, idempotencySnapshot, periodSnapshot, holidaySnapshot] =
        await Promise.all([
          transaction.get(teamRef),
          transaction.get(occurrenceRef),
          transaction.get(idempotencyRef),
          transaction.get(periodRef),
          transaction.get(holidayRef),
        ]);

      if (idempotencySnapshot.exists) {
        const stored = idempotencySnapshot.data()!;
        if (stored.requestHash !== requestHash || stored.entityId !== occurrenceId) {
          throw new HttpError(409, 'requestId sudah digunakan untuk permintaan berbeda.');
        }
        return { occurrenceId, idempotent: true };
      }
      if (occurrenceSnapshot.exists) {
        const stored = occurrenceSnapshot.data()!;
        if (stored.requestHash !== requestHash) {
          throw new HttpError(409, 'Shift ini sudah disimpan dengan penugasan berbeda.');
        }
        return { occurrenceId, idempotent: true };
      }
      if (!teamSnapshot.exists) {
        throw new HttpError(409, 'Regu Satpam tidak ditemukan.');
      }
      if (!periodSnapshot.exists || periodSnapshot.data()?.attendanceStatus !== 'open') {
        throw new HttpError(423, 'Periode payroll belum dibuka atau sudah ditutup untuk presensi.');
      }
      if (!holidaySnapshot.exists) {
        throw new HttpError(
          409,
          `Kalender hari libur ${input.dutyDate.slice(0, 4)} belum dikonfigurasi.`,
        );
      }

      const team = teamSnapshot.data()!;
      if (team.ketuaShiftId !== actor.linkedEmployeeId) {
        throw new HttpError(403, 'Anda bukan Ketua Shift untuk regu ini.');
      }
      const members = Array.isArray(team.memberEmployeeIds)
        ? team.memberEmployeeIds.filter((id): id is string => typeof id === 'string')
        : [];
      const roster = Array.from(new Set([actor.linkedEmployeeId!, ...members]));
      if (members.length !== 9 || roster.length !== 10) {
        throw new HttpError(409, 'Regu Satpam wajib berisi satu Ketua dan sembilan anggota unik.');
      }

      const expectedPostIds = new Set(SATPAM_POSTS.map((post) => post.id));
      const suppliedPostIds = new Set(input.assignments.map((assignment) => assignment.postId));
      const assignedEmployeeIds = input.assignments.map((assignment) => assignment.employeeId);
      if (
        input.assignments.length !== SATPAM_POSTS.length ||
        suppliedPostIds.size !== SATPAM_POSTS.length ||
        [...expectedPostIds].some((postId) => !suppliedPostIds.has(postId))
      ) {
        throw new HttpError(400, 'Kesembilan pos wajib diisi tepat satu kali.');
      }
      if (
        assignedEmployeeIds.some((id) => typeof id !== 'string' || !id) ||
        new Set(assignedEmployeeIds).size !== assignedEmployeeIds.length
      ) {
        throw new HttpError(400, 'Satu Satpam tidak boleh mengisi dua pos utama.');
      }
      if (!assignedEmployeeIds.includes(actor.linkedEmployeeId!)) {
        throw new HttpError(400, 'Ketua Shift wajib menjaga salah satu dari sembilan pos.');
      }

      const externalAssignments = input.assignments.filter(
        (assignment) => assignment.shiftType === 'Lembur Cover' || !roster.includes(assignment.employeeId),
      );
      const coveredIds = externalAssignments.map((assignment) => assignment.coveredEmployeeId || '');
      if (
        externalAssignments.some(
          (assignment) =>
            !assignment.coveredEmployeeId ||
            !roster.includes(assignment.coveredEmployeeId) ||
            assignedEmployeeIds.includes(assignment.coveredEmployeeId) ||
            !assignment.overtimeReason ||
            assignment.overtimeReason.trim().length < 8,
        ) ||
        new Set(coveredIds).size !== coveredIds.length
      ) {
        throw new HttpError(
          400,
          'Lembur Cover wajib menyebut Satpam regu yang absen dan alasan minimal 8 karakter.',
        );
      }

      const extra = input.extraAssignment;
      if (extra) {
        if (
          !expectedPostIds.has(extra.postId) ||
          !roster.includes(extra.employeeId) ||
          assignedEmployeeIds.includes(extra.employeeId) ||
          coveredIds.includes(extra.employeeId) ||
          !extra.overtimeReason ||
          extra.overtimeReason.trim().length < 8
        ) {
          throw new HttpError(
            400,
            'Lembur Sendiri hanya untuk anggota regu yang sedang libur dengan alasan minimal 8 karakter.',
          );
        }
      }

      const guardIds = Array.from(
        new Set([...assignedEmployeeIds, ...(extra ? [extra.employeeId] : [])]),
      );
      // Firestore requires every transaction read to happen before its first write.
      // Load the complete roster as well as any external cover guards up front so
      // off-duty records never introduce a read-after-write transaction failure.
      const employeeIdsToLoad = Array.from(new Set([...roster, ...guardIds]));
      const employeeRefs = employeeIdsToLoad.map((employeeId) =>
        adminDb.collection('Employees_BlueCollar').doc(employeeId),
      );
      const employeeSnapshots = await Promise.all(
        employeeRefs.map((reference) => transaction.get(reference)),
      );
      const employeeById = new Map(
        employeeSnapshots.map((snapshot) => [snapshot.id, snapshot]),
      );
      for (const employeeId of employeeIdsToLoad) {
        const employee = employeeById.get(employeeId);
        if (!employee?.exists || !isActiveSatpam(employee.data())) {
          throw new HttpError(409, `Satpam ${employeeId} tidak aktif atau tidak valid.`);
        }
      }

      const holidayData = holidaySnapshot.data()!;
      if (
        typeof periodSnapshot.data()?.holidayCalendarVersion !== 'string' ||
        periodSnapshot.data()?.holidayCalendarVersion !== holidayData.version
      ) {
        throw new HttpError(
          409,
          'Versi kalender libur periode tidak cocok. Hubungi Finance sebelum mengirim shift.',
        );
      }
      const holidayDates = new Set<string>(
        Array.isArray(holidayData.dates)
          ? holidayData.dates.filter((date: unknown): date is string => typeof date === 'string')
          : [],
      );
      const regularPayType = getRegularSatpamPayType(input.dutyDate, holidayDates);
      const { startsAtIso, endsAtIso } = getShiftIsoBounds(input.dutyDate, shiftName);
      const startsAt = admin.firestore.Timestamp.fromDate(new Date(startsAtIso));
      const endsAt = admin.firestore.Timestamp.fromDate(new Date(endsAtIso));
      const shiftTimes = SHIFT_TIMES[shiftName];

      const guardIndexRefs = guardIds.map((employeeId) =>
        adminDb
          .collection('GuardDutyIndexes')
          .doc(guardDutyIndexId(input.dutyDate, shiftName, employeeId)),
      );
      const guardIndexSnapshots = await Promise.all(
        guardIndexRefs.map((reference) => transaction.get(reference)),
      );
      const conflictingIndex = guardIndexSnapshots.find((snapshot) => snapshot.exists);
      if (conflictingIndex) {
        throw new HttpError(
          409,
          `Satpam pada indeks ${conflictingIndex.id} sudah tercatat di shift yang sama.`,
        );
      }

      const createdAt = admin.firestore.FieldValue.serverTimestamp();
      transaction.create(occurrenceRef, {
        teamId,
        dutyDate: input.dutyDate,
        payrollPeriod: period,
        shiftName,
        startsAt,
        endsAt,
        timeZone: 'Asia/Jakarta',
        // Shifts wait for a Kepala SatKer audit of the guard-post photos before
        // any fee becomes payable. Historical occurrences kept 'submitted'.
        status: 'pending_review',
        reviewStatus: 'pending',
        pendingAssignmentCount: input.assignments.length + (extra ? 1 : 0),
        approvedAssignmentCount: 0,
        declinedAssignmentCount: 0,
        requestId: input.requestId,
        requestHash,
        submittedByUid: actor.uid,
        ketuaShiftId: actor.linkedEmployeeId,
        ketuaShiftName: String(team.ketuaShiftName || actor.displayName),
        rateVersion: SATPAM_RATE_VERSION,
        holidayCalendarVersion:
          String(holidayData.version || SATPAM_HOLIDAY_CALENDAR_VERSION),
        regularPayType,
        assignmentCount: input.assignments.length + (extra ? 1 : 0),
        createdAt,
        schemaVersion: 1,
      });

      const assignmentRecords: Array<{
        assignmentKey: string;
        postId: string;
        employeeId: string;
        payType: keyof typeof SATPAM_RATES;
        coveredEmployeeId: string | null;
        overtimeReason: string | null;
        photoUrl: string | null;
      }> = input.assignments.map((assignment) => {
        const isCover = !roster.includes(assignment.employeeId);
        const chosenType = assignment.shiftType && assignment.shiftType in SATPAM_RATES
          ? assignment.shiftType
          : (isCover ? ('Lembur Cover' as const) : regularPayType);

        const isCoverType = isCover || chosenType === 'Lembur Cover';
        return {
          assignmentKey: assignment.postId,
          postId: assignment.postId,
          employeeId: assignment.employeeId,
          payType: chosenType,
          coveredEmployeeId: isCoverType ? (assignment.coveredEmployeeId || null) : null,
          overtimeReason: isCoverType ? (assignment.overtimeReason?.trim() || null) : null,
          photoUrl: assignment.photoUrl || null,
        };
      });
      if (extra) {
        assignmentRecords.push({
          assignmentKey: `extra_${extra.postId}`,
          postId: extra.postId,
          employeeId: extra.employeeId,
          payType: 'Lembur Sendiri',
          coveredEmployeeId: null,
          overtimeReason: extra.overtimeReason.trim(),
          photoUrl: extra.photoUrl || null,
        });
      }

      for (const assignment of assignmentRecords) {
        const employee = employeeById.get(assignment.employeeId)!;
        const employeeName = String(employee.data()?.name || assignment.employeeId);
        const post = SATPAM_POSTS.find((item) => item.id === assignment.postId)!;
        const reportId = activityReportId(
          occurrenceId,
          assignment.employeeId,
          assignment.assignmentKey,
        );
        const reportRef = adminDb.collection('ActivityReports').doc(reportId);
        const fee = SATPAM_RATES[assignment.payType];

        transaction.create(reportRef, {
          employeeId: assignment.employeeId,
          employeeName,
          jobCategory: 'SATPAM',
          period,
          payrollPeriod: period,
          activityName: `Pengamanan di ${post.id}: ${post.name}`,
          activityType: 'Lainnya',
          activityDate: input.dutyDate,
          dutyDate: input.dutyDate,
          timeStart: shiftTimes.start,
          timeEnd: shiftTimes.end,
          startsAt,
          endsAt,
          // Awaits Kepala SatKer verification of the guard-post photo. Only an
          // approved report is picked up by payslipSync, so nothing is payable
          // until the audit passes.
          status: 'pending',
          fee,
          shiftType: assignment.payType,
          assignmentKind: assignment.assignmentKey.startsWith('extra_') ? 'extra' : 'primary',
          postId: post.id,
          postName: `${post.id}: ${post.name}`,
          photoUrl: assignment.photoUrl,
          shiftName,
          coveredEmployeeId: assignment.coveredEmployeeId,
          overtimeReason: assignment.overtimeReason,
          ketuaShiftId: actor.linkedEmployeeId,
          ketuaShiftName: String(team.ketuaShiftName || actor.displayName),
          sourceOccurrenceId: occurrenceId,
          sourceLedgerEntryId: reportId,
          rateVersion: SATPAM_RATE_VERSION,
          holidayCalendarVersion:
            String(holidayData.version || SATPAM_HOLIDAY_CALENDAR_VERSION),
          submittedAt: createdAt,
          schemaVersion: 2,
        });
        const dutyIndexRef = adminDb
          .collection('GuardDutyIndexes')
          .doc(guardDutyIndexId(input.dutyDate, shiftName, assignment.employeeId));
        transaction.create(dutyIndexRef, {
          employeeId: assignment.employeeId,
          occurrenceId,
          reportId,
          dutyDate: input.dutyDate,
          shiftName,
          startsAt,
          endsAt,
          createdAt,
        });
      }

      const assignedOrOvertimeIds = new Set(guardIds);
      for (const rosterEmployeeId of roster) {
        if (assignedOrOvertimeIds.has(rosterEmployeeId)) continue;
        const isCoveredAbsence = coveredIds.includes(rosterEmployeeId);
        const rosterEmployeeSnapshot = employeeById.get(rosterEmployeeId)!;
        const offDutyReportId = activityReportId(
          occurrenceId,
          rosterEmployeeId,
          isCoveredAbsence ? 'covered_absence' : 'rest',
        );
        transaction.create(adminDb.collection('ActivityReports').doc(offDutyReportId), {
          employeeId: rosterEmployeeId,
          employeeName: String(rosterEmployeeSnapshot.data()?.name || rosterEmployeeId),
          jobCategory: 'SATPAM',
          period,
          payrollPeriod: period,
          activityName: isCoveredAbsence ? 'Tidak hadir (digantikan)' : 'Off-Duty (Rest Day)',
          activityType: 'Lainnya',
          activityDate: input.dutyDate,
          dutyDate: input.dutyDate,
          timeStart: '',
          timeEnd: '',
          status: 'approved',
          fee: 0,
          shiftType: 'Off-Duty',
          postName: isCoveredAbsence ? 'Covered Absence' : 'Off-Duty',
          absenceKind: isCoveredAbsence ? 'covered_absence' : 'scheduled_rest',
          shiftName,
          ketuaShiftId: actor.linkedEmployeeId,
          ketuaShiftName: String(team.ketuaShiftName || actor.displayName),
          sourceOccurrenceId: occurrenceId,
          submittedAt: createdAt,
          schemaVersion: 2,
        });
      }

      transaction.create(idempotencyRef, {
        actorUid: actor.uid,
        requestId: input.requestId,
        requestHash,
        entityType: 'ShiftOccurrence',
        entityId: occurrenceId,
        createdAt,
      });
      transaction.create(
        newFinancialAuditRef(),
        buildFinancialAuditRecord(actor, {
          action: 'SATPAM_SHIFT_SUBMITTED',
          entityType: 'ShiftOccurrence',
          entityId: occurrenceId,
          reason: 'Verifikasi kehadiran harian oleh Ketua Shift',
          requestId: input.requestId,
          after: {
            dutyDate: input.dutyDate,
            shiftName,
            assignmentCount: assignmentRecords.length,
            photoCount: assignmentRecords.filter((item) => item.photoUrl).length,
            status: 'pending_review',
            rateVersion: SATPAM_RATE_VERSION,
          },
        }),
      );

      return { occurrenceId, idempotent: false };
    });

    return Response.json(transactionResult, {
      status: transactionResult.idempotent ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
