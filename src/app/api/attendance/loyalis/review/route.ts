import { NextRequest, NextResponse } from 'next/server';
import admin, { adminDb } from '@/lib/firebase-admin';
import {
  isPresenceCorrectionType,
  parseDateKey,
  parseDateToDDMMYYYY,
  type PresenceCorrectionType,
  type PresenceCorrectionRequest,
} from '@/lib/payroll/presenceCorrections';
import { recalculateLoyalisSummary } from '@/lib/payroll/loyalisPresenceSummary';
import { periodCalendarFromData } from '@/lib/payroll/calendar';
import { loyalisLogDateToIso } from '@/lib/payroll/loyalisAutoLeave';
import { isImmutablePayrollStatus } from '@/lib/payroll/domain';
import {
  annualCalendarRef,
  annualDatesFrom,
  assertPeriodAcceptsInput,
} from '@/lib/server/payrollPeriod';
import {
  type LoyalisPaidLeaveEntry,
  type LoyalisPaidLeaveDailyLog,
} from '@/lib/payroll/loyalisPaidLeave';
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
    if (currentReq.status !== 'pending' || currentReq.typeChangedTo) {
      throw new HttpError(409, 'Pengajuan ini sudah tidak berstatus menunggu (pending).');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const actorName = actor.displayName || actor.email || 'Admin';
    const updatePendingRequest = async (patch: FirebaseFirestore.DocumentData) => {
      await adminDb.runTransaction(async (transaction) => {
        const latest = await transaction.get(requestRef);
        if (latest.data()?.status !== 'pending' || latest.data()?.typeChangedTo ||
          !latest.updateTime?.isEqual(requestSnap.updateTime!)) {
          throw new HttpError(409, 'Pengajuan berubah. Muat ulang sebelum memutuskan.');
        }
        transaction.update(requestRef, patch);
      });
    };

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

      await updatePendingRequest({
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
      await updatePendingRequest({
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
    const period = date.slice(0, 7);
    const periodToken = period.replace('-', '_');

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

    const employeeEntry: LoyalisPaidLeaveEntry = entries[employeeId] || {
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

    if (type === 'cuti_tahunan' || type === 'ganti_libur') {
      throw new HttpError(409, 'Gunakan Ubah Jenis Pengajuan untuk memvalidasi saldo cuti atau Masuk Hari Libur sebelum menyetujui.');
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
        scanMasukAuto: type === 'tap_out' ? Boolean(dailyLogs[dayLogIdx].scanMasukAuto) : false,
        scanPulangAuto: type === 'tap_in' ? Boolean(dailyLogs[dayLogIdx].scanPulangAuto) : false,
      };
    } else {
      dailyLogs.push({
        Tanggal: dateKey,
        'Jam kerja': 'MASUK',
        'Scan masuk': checkIn,
        'Scan pulang': checkOut,
        scanMasukAuto: false,
        scanPulangAuto: false,
      });
    }

    dailyLogs.sort((a, b) => parseDateKey(a.Tanggal) - parseDateKey(b.Tanggal));

    await adminDb.runTransaction(async (transaction) => {
      const [latestRequest, latestPresence, periodSnapshot, slip, annualCalendar] = await transaction.getAll(
        requestRef, presenceRef, adminDb.doc(`PayrollPeriods/${period}`),
        adminDb.doc(`PayrollSlipStates/${periodToken}_${employeeId}`),
        annualCalendarRef(period),
      );
      if (latestRequest.data()?.status !== 'pending' || latestRequest.data()?.typeChangedTo ||
        !latestRequest.updateTime?.isEqual(requestSnap.updateTime!) ||
        !latestPresence.updateTime?.isEqual(presenceSnap.updateTime!)) {
        throw new HttpError(409, 'Pengajuan atau presensi berubah. Muat ulang sebelum menyetujui.');
      }
      assertPeriodAcceptsInput(periodSnapshot.data());
      if (isImmutablePayrollStatus(slip.data()?.status)) throw new HttpError(409, 'Slip sudah final; persetujuan tidak dapat diterapkan.');

      // Recalculate against the same calendar and scan rules as the import
      // page, inside the transaction so a concurrent calendar edit is retried.
      const offDays = new Set(periodCalendarFromData(
        period, periodSnapshot.data(), annualDatesFrom(annualCalendar),
      ).premiumDates);
      const summary = recalculateLoyalisSummary(
        dailyLogs, expectedHours, (tanggal) => offDays.has(loyalisLogDateToIso(tanggal)),
      );
      const updatedEmployeeEntry: LoyalisPaidLeaveEntry = {
        ...employeeEntry,
        ...summary,
        ...calculateStratum(summary.minutes, calcMode, workingDays, expectedHours),
        isNotFoundInExcel: false,
      };
      transaction.update(presenceRef, {
        [`entries.${employeeId}`]: updatedEmployeeEntry,
        updatedAt: now,
      });
      transaction.update(requestRef, { status: 'approved', resolvedBy: actorName, updatedAt: now });
    });

    return NextResponse.json({
      success: true,
      message: `Koreksi presensi ${employeeName} untuk tanggal ${dateKey} berhasil disetujui dan diterapkan.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
