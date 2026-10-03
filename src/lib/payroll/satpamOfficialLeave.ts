import { getRegularSatpamPayType, satpamRatesForDutyDate } from './domain';
import { satpamAttendanceReportType } from './satpamAttendance';

/** A registered work report never cancels an approved scheduled leave. */
export function isPayableSatpamOfficialLeave(request: Record<string, unknown>, preserveRecordedPayment = false): boolean {
  return request.status === 'approved' &&
    satpamAttendanceReportType(request) === 'izin_resmi' &&
    request.scheduleRelation !== 'unassigned' && Boolean(request.teamId) &&
    request.payrollExclusionReason !== 'NO_SCHEDULED_DUTY' &&
    (!preserveRecordedPayment || Number(request.approvedAmount || 0) > 0);
}

export function satpamOfficialLeavePayment(dutyDate: string, premiumDates: ReadonlySet<string>) {
  const payType = getRegularSatpamPayType(dutyDate, new Set(premiumDates));
  return { payType, amount: satpamRatesForDutyDate(dutyDate)[payType] };
}

export function isSatpamShiftPayReport(report: Record<string, unknown>): boolean {
  return (!report.jobCategory || report.jobCategory === 'SATPAM') &&
    (report.reportKind === 'satpam_shift_assignment' || report.sourceType === 'satpam_shift' || Boolean(report.sourceOccurrenceId));
}

export type SatpamApprovedShiftCounts = {
  harian: number;
  jumatLibur: number;
  lemburSendiri: number;
  lemburCover: number;
};

export function emptySatpamShiftCounts(): SatpamApprovedShiftCounts {
  return { harian: 0, jumatLibur: 0, lemburSendiri: 0, lemburCover: 0 };
}
