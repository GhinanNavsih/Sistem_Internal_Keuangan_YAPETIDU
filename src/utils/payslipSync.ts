import { doc, getDoc, getDocs, collection, query, where, runTransaction } from 'firebase/firestore';
import {
  dedupeSatpamActivityReports,
  SATPAM_RATES,
  summarizeApprovedSatpamReports,
  SatpamActivityLike,
} from '@/lib/payroll/domain';
import {
  activityBelongsToPayrollPeriod,
  allowsManualSpjEntry,
  approvedActivitySpjAmount,
  sumApprovedEventSpj,
} from '@/lib/payroll/pekaryaSpj';

export interface PaySlipField {
  label: string;
  amount: number;
}

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
    let harianCount = 0;
    let jumatCount = 0;
    let lemburSendiriCount = 0;
    let lemburCoverCount = 0;
    let activityTotal = 0;
    let totalSpj = 0;

    if (jobCategory === 'SATPAM') {
      const contribution = summarizeApprovedSatpamReports(reports);
      activityTotal = contribution.personalSpj;
      harianCount = contribution.harianCount;
      jumatCount = contribution.jumatLiburCount;
      lemburSendiriCount = contribution.lemburSendiriCount;
      lemburCoverCount = contribution.lemburCoverCount;
    } else {
      // Only reviewed employee earnings enter SPJ. For SOPIR, operational
      // reimbursements are excluded and upahBersih is counted exactly once.
      activityTotal = reports.reduce((sum, report) => {
        return sum + approvedActivitySpjAmount(report);
      }, 0);
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
      const uraianSnap = await transaction.get(uraianRef);
      if (!uraianSnap.exists()) return;
      const uraianData = uraianSnap.data();
      const entries = { ...(uraianData.entries || {}) };
      const currentEntry = entries[employeeId] || { employeeId, name: employeeName };
      const manualSatpamBonusOverride =
        jobCategory === 'SATPAM' &&
        period === '2026-07' &&
        uraianData.satpamMonthlyBonusManualOverride === true;

      let updatedValues = { ...(currentEntry.values || {}) };
      let updatedCounts = { ...(currentEntry.counts || {}) };

      if (jobCategory === 'SATPAM') {
        const satpamDutySource =
          currentEntry.satpamDutySource &&
          typeof currentEntry.satpamDutySource === 'object'
            ? currentEntry.satpamDutySource
            : {};
        const approvedAbsenceCount = Math.max(
          0,
          Number(satpamDutySource.approvedAbsenceCount || 0),
        );
        const canonicalBonusCount =
          satpamDutySource.eligibleForBonus === true ? 1 : 0;
        const totalHarianCount = harianCount + approvedAbsenceCount;
        updatedValues = {
          ...updatedValues,
          harian: totalHarianCount * SATPAM_RATES.Harian,
          jumatLibur: jumatCount * SATPAM_RATES['Jumat & Libur'],
          lemburSendiri: lemburSendiriCount * SATPAM_RATES['Lembur Sendiri'],
          lemburCover: lemburCoverCount * SATPAM_RATES['Lembur Cover'],
          ...(currentEntry.satpamDutySource && !manualSatpamBonusOverride
            ? {
                bonusPresensiBulanan:
                  canonicalBonusCount * 100_000,
              }
            : {}),
          ...(spjIsManual ? {} : { spj: totalSpj }),
        };
        updatedCounts = {
          ...updatedCounts,
          harian: totalHarianCount,
          jumatLibur: jumatCount,
          lemburSendiri: lemburSendiriCount,
          lemburCover: lemburCoverCount,
          ...(currentEntry.satpamDutySource && !manualSatpamBonusOverride
            ? { bonusPresensiBulanan: canonicalBonusCount }
            : {}),
          ...(spjIsManual ? {} : { spj: 0 }),
        };
      } else if (!spjIsManual) {
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
