import type { LoyalisPaidLeaveDailyLog } from './loyalisPaidLeave';
import {
  autoFillLoyalisScan,
  calculateLoyalisDailyDuration,
} from './loyalisPresenceWindow';

/**
 * Shared by the import/edit page and correction approvals. Only an explicit
 * TIDAK HADIR excludes a working day's scans: scanner exports can leave
 * Jam kerja blank or use labels such as Staff. Off-days contribute to neither
 * worked minutes nor absence counts, while their original scans stay visible.
 * The caller supplies the current payroll calendar rather than trusting saved
 * isOffDay flags, which may belong to an older calendar revision.
 */
export function recalculateLoyalisSummary<T extends LoyalisPaidLeaveDailyLog>(
  dailyLogs: readonly T[],
  expectedHours: number,
  isOffDay: (tanggal: string) => boolean,
) {
  let totalWorkedMinutes = 0;
  let activeDaysCount = 0;
  let incompleteDaysCount = 0;
  let absentDaysCount = 0;
  let offDayScannedCount = 0;
  let offDayExcludedMinutes = 0;

  const updatedLogs = dailyLogs.map((dayRow) => {
    const status = String(dayRow['Jam kerja'] || '').trim().toUpperCase();
    let inStr = String(dayRow['Scan masuk'] || '').trim();
    let outStr = String(dayRow['Scan pulang'] || '').trim();
    let scanMasukAuto = Boolean(dayRow.scanMasukAuto);
    let scanPulangAuto = Boolean(dayRow.scanPulangAuto);
    let dailyDuration = 0;

    if (isOffDay(dayRow.Tanggal)) {
      if (status !== 'TIDAK HADIR' && inStr && outStr) {
        offDayScannedCount += 1;
        offDayExcludedMinutes += calculateLoyalisDailyDuration(inStr, outStr, expectedHours) || 0;
      }
      return {
        ...dayRow,
        'Scan masuk': inStr,
        'Scan pulang': outStr,
        scanMasukAuto,
        scanPulangAuto,
        duration: 0,
        isOffDay: true,
      };
    }

    if (status === 'TIDAK HADIR') {
      absentDaysCount += 1;
    } else {
      if (inStr && !outStr && dayRow.scanPulangAuto !== false) {
        const autoFilledOut = autoFillLoyalisScan(inStr, 'out');
        if (autoFilledOut) {
          outStr = autoFilledOut;
          scanPulangAuto = true;
        }
      } else if (!inStr && outStr && dayRow.scanMasukAuto !== false) {
        const autoFilledIn = autoFillLoyalisScan(outStr, 'in');
        if (autoFilledIn) {
          inStr = autoFilledIn;
          scanMasukAuto = true;
        }
      }

      const duration = inStr && outStr
        ? calculateLoyalisDailyDuration(inStr, outStr, expectedHours)
        : null;
      if (duration !== null) {
        dailyDuration = duration;
        totalWorkedMinutes += dailyDuration;
        activeDaysCount += 1;
      } else {
        incompleteDaysCount += 1;
      }
    }

    return {
      ...dayRow,
      'Scan masuk': inStr,
      'Scan pulang': outStr,
      scanMasukAuto,
      scanPulangAuto,
      duration: dailyDuration,
      isOffDay: false,
    };
  });

  return {
    minutes: totalWorkedMinutes,
    activeDaysCount,
    incompleteDaysCount,
    absentDaysCount,
    offDayScannedCount,
    offDayExcludedMinutes,
    dailyLogs: updatedLogs,
  };
}
