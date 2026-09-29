import { NextRequest, NextResponse } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  isPresenceCorrectionType,
  parseDateKey,
  parseDateToDDMMYYYY,
  type PresenceCorrectionType,
  type PresenceCorrectionRequest,
} from '@/lib/payroll/presenceCorrections';
import { calculateLoyalisDailyDuration } from '@/lib/payroll/loyalisPresenceWindow';
import {
  applyApprovedPaidLeaveToLoyalisEntry,
  type LoyalisPaidLeaveEntry,
  type LoyalisPaidLeaveDailyLog,
} from '@/lib/payroll/loyalisPaidLeave';
import {
  annualPaidLeaveQualifyingDate,
} from '@/lib/payroll/annualPaidLeave';
import {
  ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION,
  ANNUAL_PAID_LEAVE_BALANCES_COLLECTION,
  annualPaidLeaveDocumentId,
  annualPaidLeaveBalanceDocumentId,
} from '@/lib/server/annualPaidLeave';
import {
  GANTI_LIBUR_REQUESTS_COLLECTION,
  gantiLiburDocumentId,
} from '@/lib/server/gantiLibur';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
  requireRole,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseClockTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CLOCK_TIME_PATTERN.test(value)) {
    throw new HttpError(400, `${label} tidak valid.`);
  }
  return value;
}

function recalculateLoyalisSummary(
  dailyLogs: LoyalisPaidLeaveDailyLog[],
  expectedHours: number,
) {
  let totalWorkedMinutes = 0;
  let activeDaysCount = 0;
  let incompleteDaysCount = 0;
  let absentDaysCount = 0;

  const updatedLogs: LoyalisPaidLeaveDailyLog[] = dailyLogs.map((dayRow) => {
    const status = String(dayRow['Jam kerja'] || '').trim().toUpperCase();
    const inStr = dayRow['Scan masuk'] ? String(dayRow['Scan masuk']).trim() : '';
    const outStr = dayRow['Scan pulang'] ? String(dayRow['Scan pulang']).trim() : '';

    let dailyDuration = 0;
    if (status === 'MASUK' || status === 'CUTI' || status === 'GANTI LIBUR') {
      if (inStr && outStr) {
        const duration = calculateLoyalisDailyDuration(inStr, outStr, expectedHours);
        if (duration !== null && duration > 0) {
          dailyDuration = duration;
          totalWorkedMinutes += dailyDuration;
          activeDaysCount += 1;
        } else if (status === 'MASUK') {
          incompleteDaysCount += 1;
        }
      } else if (status === 'MASUK') {
        incompleteDaysCount += 1;
      }
    } else if (status === 'TIDAK HADIR') {
      absentDaysCount += 1;
    }

    return {
      ...dayRow,
      duration: dailyDuration,
    };
  });

  return {
    minutes: totalWorkedMinutes,
    activeDaysCount,
    incompleteDaysCount,
    absentDaysCount,
    dailyLogs: updatedLogs,
  };
}

function calculateStratum(
  minutes: number,
  mode: 'worked' | 'absent',
  days: number,
  hours: number,
) {
  const expectedTotal = days * hours * 60;
  let x = 0;
  if (mode === 'worked') {
    x = expectedTotal - minutes;
    if (x < 0) x = 0;
  } else {
    x = minutes;
  }

  let stratum = 1;
  let deduction = 0;
  let netBonus = 250_000;

  if (x === 0) {
    stratum = 1;
    deduction = 0;
    netBonus = 250_000;
  } else if (x <= days * 30) {
    stratum = 2;
    deduction = 100_000;
    netBonus = 150_000;
  } else if (x <= days * 35) {
    stratum = 3;
    deduction = 150_000;
    netBonus = 100_000;
  } else if (x <= days * 40) {
    stratum = 4;
    deduction = 200_000;
    netBonus = 50_000;
  } else {
    stratum = 5;
    deduction = 250_000;
    netBonus = 0;
  }

  return {
    absenceMinutes: x,
    stratum,
    deduction,
    netBonus,
  };
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    requireRole(actor, ['super_admin', 'loyalis_admin']);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new HttpError(400, 'Payload tidak valid.');
    }

    const requestId = String(body.requestId || '').trim();
    if (!requestId) throw new HttpError(400, 'ID pengajuan koreksi presensi wajib diisi.');

    const action = String(body.action || '').trim();
    if (!['change_type', 'approve', 'decline'].includes(action)) {
      throw new HttpError(400, 'Aksi tidak valid (pilih: change_type, approve, decline).');
    }

    const requestRef = adminDb.collection('LoyalisPresenceCorrections').doc(requestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
      throw new HttpError(404, 'Pengajuan koreksi presensi tidak ditemukan.');
    }

    const currentReq = { id: requestSnap.id, ...requestSnap.data() } as PresenceCorrectionRequest;
    if (currentReq.status !== 'pending') {
      throw new HttpError(409, 'Pengajuan ini sudah tidak berstatus menunggu (pending).');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const actorName = actor.displayName || actor.email || 'Admin';

    // 1. CHANGE TYPE
    if (action === 'change_type') {
      if (!isPresenceCorrectionType(body.type)) {
        throw new HttpError(400, 'Tipe pengajuan baru tidak valid.');
      }
      const nextType: PresenceCorrectionType = body.type;

      let nextCheckIn: string | null = null;
      let nextCheckOut: string | null = null;

      if (nextType === 'izin_resmi' || nextType === 'cuti_tahunan' || nextType === 'ganti_libur') {
        nextCheckIn = '07:30';
        nextCheckOut = '14:00';
      } else if (nextType === 'tap_in') {
        nextCheckIn = parseClockTime(body.checkInTime, 'Jam masuk');
        nextCheckOut = null;
      } else if (nextType === 'tap_out') {
        nextCheckIn = null;
        nextCheckOut = parseClockTime(body.checkOutTime, 'Jam pulang');
      } else if (nextType === 'both') {
        nextCheckIn = parseClockTime(body.checkInTime, 'Jam masuk');
        nextCheckOut = parseClockTime(body.checkOutTime, 'Jam pulang');
        const [inH, inM] = nextCheckIn.split(':').map(Number);
        const [outH, outM] = nextCheckOut.split(':').map(Number);
        if (outH * 60 + outM <= inH * 60 + inM) {
          throw new HttpError(400, 'Jam pulang harus lebih lambat dari jam masuk.');
        }
      }

      await requestRef.update({
        type: nextType,
        checkInTime: nextCheckIn,
        checkOutTime: nextCheckOut,
        updatedAt: now,
        modifiedBy: actor.uid,
        modifiedByEmail: actor.email || 'Admin',
      });

      return NextResponse.json({
        success: true,
        message: 'Jenis pengajuan berhasil diubah.',
        request: {
          id: requestId,
          type: nextType,
          checkInTime: nextCheckIn,
          checkOutTime: nextCheckOut,
        },
      });
    }

    // 2. DECLINE
    if (action === 'decline') {
      const rejectionReason = String(body.rejectionReason || '').trim() || 'Ditolak oleh admin.';
      await requestRef.update({
        status: 'rejected',
        rejectionReason,
        resolvedBy: actorName,
        updatedAt: now,
      });

      return NextResponse.json({
        success: true,
        message: `Pengajuan koreksi presensi ${currentReq.employeeName || currentReq.employeeId} ditolak.`,
      });
    }

    // 3. APPROVE
    const date = currentReq.date;
    const dateKey = parseDateToDDMMYYYY(date);
    if (!date || !dateKey) {
      throw new HttpError(400, 'Tanggal pengajuan tidak valid.');
    }

    const employeeId = currentReq.employeeId;
    const employeeName = currentReq.employeeName || employeeId;
    const periodToken = date.slice(0, 7).replace('-', '_');
    const year = Number(date.slice(0, 4));

    // Load employee data from Employees_Loyalis
    const employeeRef = adminDb.collection('Employees_Loyalis').doc(employeeId);
    const employeeSnap = await employeeRef.get();
    const empData = employeeSnap.data() || {};
    const serviceDate = String(
      empData.employment_profile?.date_of_hire ||
        empData.employment_profile?.date_recognized ||
        '',
    );
    const qualifyingDate = serviceDate ? annualPaidLeaveQualifyingDate(serviceDate) : '';

    // Load LoyalisPresence document
    const presenceRef = adminDb.collection('LoyalisPresence').doc(periodToken);
    const presenceSnap = await presenceRef.get();
    if (!presenceSnap.exists) {
      throw new HttpError(
        409,
        `Data presensi untuk periode ${periodToken} belum diunggah di sistem.`,
      );
    }

    const presenceData = presenceSnap.data() || {};
    const workingDays =
      typeof presenceData.workingDays === 'number' && presenceData.workingDays > 0
        ? presenceData.workingDays
        : 25;
    const expectedHours =
      typeof presenceData.expectedHours === 'number' && presenceData.expectedHours > 0
        ? presenceData.expectedHours
        : 6.5;
    const calcMode = presenceData.mode === 'absent' ? 'absent' : 'worked';
    const entries = (presenceData.entries || {}) as Record<string, LoyalisPaidLeaveEntry>;

    let employeeEntry: LoyalisPaidLeaveEntry = entries[employeeId] || {
      employeeId,
      employeeName,
      excelName: employeeName,
      minutes: 0,
      absenceMinutes: workingDays * expectedHours * 60,
      stratum: 5,
      deduction: 250_000,
      netBonus: 0,
      activeDaysCount: 0,
      incompleteDaysCount: 0,
      absentDaysCount: 0,
      dailyLogs: [],
    };

    const type = currentReq.type;

    if (type === 'cuti_tahunan') {
      // 3A. Approve as Cuti Tahunan
      const annualLeaveDocId = annualPaidLeaveDocumentId(employeeId, date);
      const leaveDocRef = adminDb
        .collection(ANNUAL_PAID_LEAVE_REQUESTS_COLLECTION)
        .doc(annualLeaveDocId);
      const leaveDocSnap = await leaveDocRef.get();

      if (leaveDocSnap.exists && leaveDocSnap.data()?.status === 'approved') {
        throw new HttpError(409, 'Cuti tahunan berbayar sudah disetujui pada tanggal ini.');
      }

      // Check balance
      const balanceDocId = annualPaidLeaveBalanceDocumentId(employeeId, year);
      const balanceRef = adminDb
        .collection(ANNUAL_PAID_LEAVE_BALANCES_COLLECTION)
        .doc(balanceDocId);
      const balanceSnap = await balanceRef.get();
      const balanceData = balanceSnap.data() || {};
      const usedDays = Number(balanceData.usedDays || 0);

      // Apply to presence entry
      employeeEntry = applyApprovedPaidLeaveToLoyalisEntry({
        entry: employeeEntry,
        leaveDate: date,
        expectedHours,
        workingDays,
        isOffDay: false,
        kind: 'annual_leave',
      });

      const batch = adminDb.batch();

      // Write AnnualPaidLeaveRequests doc
      batch.set(
        leaveDocRef,
        {
          id: annualLeaveDocId,
          employeeId,
          employeeName,
          leaveDate: date,
          year,
          status: 'approved',
          category: 'LOYALIS',
          employeeKind: 'loyalis',
          reason: currentReq.reason || 'Koreksi Presensi (Ambil Cuti Tahunan)',
          approvedPayType: null,
          approvedAmount: 0,
          qualifyingDate,
          serviceDate,
          decidedAt: now,
          decidedBy: actor.uid,
          decidedByName: actorName,
          sourceCorrectionRequestId: requestId,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );

      // Deduct balance
      batch.set(
        balanceRef,
        {
          employeeId,
          employeeKind: 'loyalis',
          employeeCollection: 'Employees_Loyalis',
          year,
          entitlementDays: Number(balanceData.entitlementDays || 12),
          usedDays: usedDays + 1,
          reservedDays: Math.max(0, Number(balanceData.reservedDays || 0)),
          serviceDate,
          qualifyingDate,
          updatedAt: now,
        },
        { merge: true },
      );

      // Update LoyalisPresence
      batch.update(presenceRef, {
        [`entries.${employeeId}`]: employeeEntry,
        updatedAt: now,
      });

      // Update correction status
      batch.update(requestRef, {
        status: 'approved',
        resolvedBy: actorName,
        updatedAt: now,
      });

      await batch.commit();

      return NextResponse.json({
        success: true,
        message: `Koreksi presensi ${employeeName} disetujui sebagai Cuti Tahunan (kuota berkurang 1 hari).`,
      });
    }

    if (type === 'ganti_libur') {
      // 3B. Approve as Ganti Libur
      const glDocId = gantiLiburDocumentId(employeeId, date);
      const glRef = adminDb.collection(GANTI_LIBUR_REQUESTS_COLLECTION).doc(glDocId);

      employeeEntry = applyApprovedPaidLeaveToLoyalisEntry({
        entry: employeeEntry,
        leaveDate: date,
        expectedHours,
        workingDays,
        isOffDay: false,
        kind: 'ganti_libur',
      });

      const batch = adminDb.batch();

      batch.set(
        glRef,
        {
          id: glDocId,
          employeeId,
          employeeName,
          category: 'LOYALIS',
          dayOffDate: date,
          dayOffPeriod: date.slice(0, 7),
          workedDate: date,
          status: 'approved',
          reason: currentReq.reason || 'Koreksi Presensi (Ganti Libur)',
          decidedAt: now,
          decidedBy: actor.uid,
          decidedByName: actorName,
          sourceCorrectionRequestId: requestId,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );

      batch.update(presenceRef, {
        [`entries.${employeeId}`]: employeeEntry,
        updatedAt: now,
      });

      batch.update(requestRef, {
        status: 'approved',
        resolvedBy: actorName,
        updatedAt: now,
      });

      await batch.commit();

      return NextResponse.json({
        success: true,
        message: `Koreksi presensi ${employeeName} disetujui sebagai Ganti Libur.`,
      });
    }

    // 3C. Approve as Izin Resmi or Scan Correction
    const dailyLogs: LoyalisPaidLeaveDailyLog[] = [...(employeeEntry.dailyLogs || [])];
    const dayLogIdx = dailyLogs.findIndex((log) => log.Tanggal === dateKey);

    const checkIn =
      type === 'izin_resmi'
        ? '07:30'
        : type !== 'tap_out'
          ? currentReq.checkInTime || '07:30'
          : (dailyLogs[dayLogIdx]?.['Scan masuk'] as string) || '';
    const checkOut =
      type === 'izin_resmi'
        ? '14:00'
        : type !== 'tap_in'
          ? currentReq.checkOutTime || '14:00'
          : (dailyLogs[dayLogIdx]?.['Scan pulang'] as string) || '';

    if (dayLogIdx > -1) {
      dailyLogs[dayLogIdx] = {
        ...dailyLogs[dayLogIdx],
        'Jam kerja': 'MASUK',
        'Scan masuk': checkIn,
        'Scan pulang': checkOut,
      };
    } else {
      dailyLogs.push({
        Tanggal: dateKey,
        'Jam kerja': 'MASUK',
        'Scan masuk': checkIn,
        'Scan pulang': checkOut,
      });
    }

    dailyLogs.sort((a, b) => parseDateKey(a.Tanggal) - parseDateKey(b.Tanggal));

    const summary = recalculateLoyalisSummary(dailyLogs, expectedHours);
    const stratum = calculateStratum(summary.minutes, calcMode, workingDays, expectedHours);

    const updatedEmployeeEntry: LoyalisPaidLeaveEntry = {
      ...employeeEntry,
      ...summary,
      ...stratum,
      isNotFoundInExcel: false,
    };

    const batch = adminDb.batch();
    batch.update(presenceRef, {
      [`entries.${employeeId}`]: updatedEmployeeEntry,
      updatedAt: now,
    });
    batch.update(requestRef, {
      status: 'approved',
      resolvedBy: actorName,
      updatedAt: now,
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      message: `Koreksi presensi ${employeeName} untuk tanggal ${dateKey} berhasil disetujui dan diterapkan.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
