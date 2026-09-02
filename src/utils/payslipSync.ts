import { doc, getDoc, getDocs, collection, query, where, runTransaction } from 'firebase/firestore';
import {
  dedupeSatpamActivityReports,
  summarizeApprovedSatpamReports,
  SatpamActivityLike,
  type MoneyField,
} from '@/lib/payroll/domain';
import {
  activityBelongsToPayrollPeriod,
  allowsManualSpjEntry,
  sumApprovedActivitySpj,
  sumApprovedEventSpj,
} from '@/lib/payroll/pekaryaSpj';
import {
  normalizeSatpamUraianEntry,
} from '@/lib/payroll/satpamCompensation';
import type { UraianEntry } from '@/types';

/** Alias of the canonical MoneyField; see slipBuilders.SlipField. */
export type PaySlipField = MoneyField;

export async function syncActivityToPayslip(db: any, employeeId: string, period: string) {
  try {
    // 1. Fetch employee details to find jobCategory and name
    let jobCategory = '';
    let employeeName = 'Karyawan';
    
    const bcRef = doc(db, 'Employees_BlueCollar', employeeId);
    const bcSnap = await getDoc(bcRef);
    if (bcSnap.exists()) {
      const data = bcSnap.data();
      jobCategory = data.employment?.jobCategory || '';
      employeeName = data.name || 'Karyawan';
    } else {
      const empRef = doc(db, 'Employees', employeeId);
      const empSnap = await getDoc(empRef);
      if (empSnap.exists()) {
        const data = empSnap.data();
        jobCategory = data.employment_profile?.jobCategory || data.role || '';
        employeeName = data.personal_info?.name || data.displayName || 'Karyawan';
      }
    }

    if (!jobCategory) {
      console.warn(`[payslipSync] Job category not found for employee: ${employeeId}`);
      return;
    }

    let isSatpamKetua = false;
    if (jobCategory === 'SATPAM') {
      try {
        const teamSnapshot = await getDocs(
          query(
            collection(db, 'SatpamShiftTeams'),
            where('ketuaShiftId', '==', employeeId),
          ),
        );
        isSatpamKetua = !teamSnapshot.empty;
      } catch (error) {
        console.warn('[payslipSync] Unable to resolve Satpam team leader:', error);
      }
    }

    // 2. Query all approved activity reports for this employee and period
    const q = query(
      collection(db, 'ActivityReports'),
      where('employeeId', '==', employeeId),
      where('jobCategory', '==', jobCategory),
      where('status', '==', 'approved')
    );
    const reportsSnap = await getDocs(q);
    const rawReports: Array<SatpamActivityLike & Record<string, any>> =
      reportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const periodReports = rawReports.filter((report) =>
      activityBelongsToPayrollPeriod(report, period),
    );
    const reports = jobCategory === 'SATPAM'
      ? dedupeSatpamActivityReports(periodReports)
      : periodReports;

    // 3. Convert period format (e.g. "2026-07" -> "2026_07")
    const periodKey = period.replace('-', '_');

    // 4. Update UraianGaji document (if it exists)
    const uraianDocId = `${periodKey}_${jobCategory}`;
    const uraianRef = doc(db, 'UraianGaji', uraianDocId);
    const periodRef = doc(db, 'PayrollPeriods', period);
    let activityTotal = 0;
    let totalSpj = 0;

    if (jobCategory === 'SATPAM') {
      // Only the personal SPJ half is taken here. The shift columns
      // (harian/jumatLibur/lemburSendiri/lemburCover/bonusPresensiBulanan) are
      // owned end to end by syncSatpamDutyReconciliation, which is plan-aware,
      // counts paid absences, and runs server-side on every shift-affecting
      // action. This function used to recount them from a different query with
      // different dedup rules and overwrite that result.
      activityTotal = summarizeApprovedSatpamReports(reports).personalSpj;
    } else {
      // Only reviewed employee earnings enter SPJ. For SOPIR, operational
      // reimbursements are excluded and upahBersih is counted exactly once.
      // Shared with the rekap/spj screens and the slip preview so every
      // surface totals SPJ identically, including its duplicate-report dedup.
      activityTotal = sumApprovedActivitySpj(
        reports,
        employeeId,
        jobCategory,
        period,
      );
    }

    // Kegiatan SPJ is additional to personal activity SPJ for every Pekarya
    // category, including Satpam. Shift allowances remain separate columns.
    let spjEventsTotal = 0;
    try {
      const spjQ = query(
        collection(db, 'KegiatanSpj'),
        where('period', '==', period),
        where('jobCategory', '==', jobCategory),
      );
      const spjSnap = await getDocs(spjQ);
      spjEventsTotal = sumApprovedEventSpj(
        spjSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        employeeId,
        jobCategory,
        period,
      );
    } catch (err) {
      console.error('[payslipSync] Error fetching KegiatanSpj:', err);
    }
    totalSpj = spjEventsTotal + activityTotal;

    // Manual-category SPJ for the July 2026 transition is entered by hand from
    // paper records, so activity syncing must never overwrite that column.
    const spjIsManual = allowsManualSpjEntry(jobCategory, period);

    await runTransaction(db, async transaction => {
      const [periodSnap, uraianSnap] = await Promise.all([
        transaction.get(periodRef),
        transaction.get(uraianRef),
      ]);
      if (periodSnap.data()?.attendanceStatus === 'closed') return;
      if (!uraianSnap.exists()) return;
      const uraianData = uraianSnap.data();
      const entries = { ...(uraianData.entries || {}) };
      const currentEntry = entries[employeeId] || { employeeId, name: employeeName };

      let updatedValues = { ...(currentEntry.values || {}) };
      let updatedCounts = { ...(currentEntry.counts || {}) };

      if (jobCategory === 'SATPAM') {
        const normalizedEntry = normalizeSatpamUraianEntry(
          {
            ...currentEntry,
            employeeId,
            name: currentEntry.name || employeeName,
            values: updatedValues,
            counts: updatedCounts,
          } as UraianEntry,
          isSatpamKetua,
        );
        updatedValues = normalizedEntry.values;
        updatedCounts = normalizedEntry.counts || {};
      }

      // SPJ is the only column this function owns, for every job category.
      // Everything else in an entry belongs to whoever computed it: the Satpam
      // shift columns to syncSatpamDutyReconciliation, the attendance columns
      // to publishPekaryaAttendance, the rest to the Uraian rekap screen.
      if (!spjIsManual) {
        updatedValues = {
          ...updatedValues,
          spj: totalSpj,
        };
        updatedCounts = {
          ...updatedCounts,
          spj: 0,
        };
      }

      entries[employeeId] = {
        ...currentEntry,
        values: updatedValues,
        counts: updatedCounts,
      };

      transaction.update(uraianRef, { entries });
    });
    console.log(`[payslipSync] Successfully synced activities to UraianGaji for ${employeeId} (${period})`);
  } catch (err) {
    console.warn(`[payslipSync] Non-fatal warning syncing activities for employeeId ${employeeId}:`, err);
  }
}
