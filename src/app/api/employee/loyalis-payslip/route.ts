import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  buildInitialDeductions,
  buildInitialEarnings,
} from '@/lib/payroll/slipBuilders';
import {
  calculateGapok,
  matchFunctionalAllowance,
  toSlipEmployeeView,
} from '@/lib/payroll/salaryMatrix';
import {
  loyalisPresenceAmounts,
  type LoyalisPresenceDocument,
} from '@/lib/payroll/uraianPropagation';
import { isPayableVakasiTambahan } from '@/lib/payroll/vakasiTambahan';
import {
  errorResponse,
  HttpError,
  requireAuthenticatedProfile,
} from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const PERIOD_RE = /^(\d{4})-(\d{2})$/;

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function loadActiveRows(collectionName: string) {
  const configSnapshot = await adminDb.collection(collectionName).doc('_config').get();
  const activeVersion = configSnapshot.data()?.activeVersion || '2026_v1';
  return adminDb.collection(collectionName).doc(activeVersion).collection('rows').get();
}

/**
 * Return the same read-only Loyalis draft that the Finance dashboard shows
 * when PayrollSlipStates has not been materialized yet.  This endpoint is
 * deliberately scoped to one employee: a real Loyalis can request only its
 * own data, while UI Preview may request the selected employee as Super Admin.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuthenticatedProfile(request);
    const requestedEmployeeId = request.nextUrl.searchParams.get('employeeId')?.trim() || '';

    let employeeId: string;
    if (actor.role === 'loyalis') {
      if (!actor.linkedEmployeeId) {
        throw new HttpError(409, 'Akun Loyalis belum terhubung ke data pegawai.');
      }
      employeeId = actor.linkedEmployeeId;
    } else if (actor.role === 'super_admin') {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestedEmployeeId)) {
        throw new HttpError(400, 'employeeId preview wajib diisi dengan format yang valid.');
      }
      employeeId = requestedEmployeeId;
    } else {
      throw new HttpError(403, 'Anda tidak memiliki akses ke data slip Loyalis.');
    }

    const period = request.nextUrl.searchParams.get('period') || '';
    const periodMatch = PERIOD_RE.exec(period);
    if (!periodMatch || Number(periodMatch[2]) < 1 || Number(periodMatch[2]) > 12) {
      throw new HttpError(400, 'Periode wajib menggunakan format YYYY-MM.');
    }

    const [year, month] = periodMatch.slice(1).map(Number);
    const targetDate = new Date(year, month - 1, 1);
    const periodKey = `${year}_${String(month).padStart(2, '0')}`;

    const employeeSnapshot = await adminDb
      .collection('Employees_Loyalis')
      .doc(employeeId)
      .get();
    if (!employeeSnapshot.exists) {
      throw new HttpError(404, 'Data karyawan Loyalis tidak ditemukan.');
    }

    const employee = { id: employeeSnapshot.id, ...employeeSnapshot.data() } as any;

    const [
      matrixRows,
      functionalRows,
      kepangkatanRows,
      canonicalPresenceSnapshot,
      legacyPresenceSnapshot,
      vakasiSnapshot,
    ] = await Promise.all([
      loadActiveRows('SalaryMatrix_WhiteCollar'),
      loadActiveRows('SalaryMatrix_Functional'),
      loadActiveRows('SalaryMatrix_Kepangkatan'),
      adminDb.collection('LoyalisPresence').doc(period).get(),
      adminDb.collection('LoyalisPresence').doc(periodKey).get(),
      adminDb.collection('VakasiTambahan').get(),
    ]);

    const salaryMatrix: Record<string, Record<number, number>> = {};
    matrixRows.docs.forEach((row) => {
      const data = row.data();
      const yearValue = asNumber(data.tahun);
      if (!yearValue) return;
      Object.entries(data.salaries || {}).forEach(([grade, amount]) => {
        if (!salaryMatrix[grade]) salaryMatrix[grade] = {};
        salaryMatrix[grade][yearValue] = asNumber(amount);
      });
    });

    const functionalMatrix: Record<
      string,
      { base_value: number; functional_tiers: Record<string, number> }
    > = {};
    functionalRows.docs.forEach((row) => {
      const data = row.data();
      functionalMatrix[row.id] = {
        base_value: asNumber(data.base_value),
        functional_tiers: Object.fromEntries(
          Object.entries(data.functional_tiers || {}).map(([tier, amount]) => [
            tier,
            asNumber(amount),
          ]),
        ),
      };
    });

    const kepangkatanMatrix: Record<number, number> = {};
    kepangkatanRows.docs.forEach((row) => {
      const data = row.data();
      kepangkatanMatrix[asNumber(data.credit_score)] = asNumber(data.allowance);
    });

    const presenceSnapshot = canonicalPresenceSnapshot.exists
      ? canonicalPresenceSnapshot
      : legacyPresenceSnapshot;
    const presence = presenceSnapshot.exists
      ? (presenceSnapshot.data() as LoyalisPresenceDocument)
      : null;
    const presenceAmounts = loyalisPresenceAmounts(presence, employeeId);

    const vakasiTambahanList: { eventName: string; payGiven: number }[] = [];
    let vakasiTambahanSum = 0;
    vakasiSnapshot.docs.forEach((eventSnapshot) => {
      const data = eventSnapshot.data();
      if (data.period !== period || !isPayableVakasiTambahan(data)) return;
      const worker = data.eventWorkers?.[employeeId];
      const payGiven = asNumber(worker?.payGiven);
      if (!payGiven) return;
      vakasiTambahanSum += payGiven;
      vakasiTambahanList.push({
        eventName: String(data.eventName || ''),
        payGiven,
      });
    });

    const gapok = calculateGapok(
      toSlipEmployeeView(employee, 'loyalis'),
      salaryMatrix,
      targetDate,
    );
    const functionalAllowance = matchFunctionalAllowance(
      employee.academic_and_tier?.education_level,
      employee.academic_and_tier?.functional_tier,
      functionalMatrix,
    );
    const kepangkatanAllowance =
      kepangkatanMatrix[asNumber(employee.kepangkatan?.cummulativeCredit)] || 0;

    const earnings = buildInitialEarnings(
      employee,
      gapok,
      'loyalis',
      undefined,
      vakasiTambahanSum,
      vakasiTambahanList,
      functionalAllowance,
      kepangkatanAllowance,
      [],
      presenceAmounts.presenceBonus,
      presenceAmounts.presensiEarning,
    );
    const deductions = buildInitialDeductions(
      employee,
      'loyalis',
      0,
      presenceAmounts.presenceDeduction,
      presenceAmounts.presensiDeduction,
      0,
    );
    const presenceInfo = {
      workingDays: asNumber(presence?.workingDays) || 25,
      expectedHours: asNumber(presence?.expectedHours) || 6.5,
      absenceMinutes: asNumber(
        presence?.entries?.[employeeId]?.absenceMinutes,
      ),
      bonusDeduction: presenceAmounts.presenceDeduction,
    };

    return Response.json(
      {
        employeeId,
        period,
        earnings,
        deductions,
        presence: presenceAmounts,
        presenceInfo,
        vakasiEvents: vakasiTambahanList,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
