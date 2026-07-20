import { doc, getDoc, getDocs, collection, query, where, updateDoc } from 'firebase/firestore';

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
      where('period', '==', period),
      where('status', '==', 'approved')
    );
    const reportsSnap = await getDocs(q);
    const reports = reportsSnap.docs.map(d => d.data());

    // 3. Convert period format (e.g. "2026-07" -> "2026_07")
    const periodKey = period.replace('-', '_');

    // 4. Update UraianGaji document (if it exists)
    const uraianDocId = `${periodKey}_${jobCategory}`;
    const uraianRef = doc(db, 'UraianGaji', uraianDocId);
    const uraianSnap = await getDoc(uraianRef);

    let harianCount = 0;
    let jumatCount = 0;
    let lemburSendiriCount = 0;
    let lemburCoverCount = 0;
    let activityTotal = 0;
    let totalSpj = 0;

    if (jobCategory === 'SATPAM') {
      reports.forEach(r => {
        const shiftType = r.shiftType || '';
        if (shiftType === 'Harian') harianCount++;
        else if (shiftType === 'Jumat & Libur') jumatCount++;
        else if (shiftType === 'Lembur Sendiri') lemburSendiriCount++;
        else if (shiftType === 'Lembur Cover') lemburCoverCount++;
      });
    } else {
      // Non-Satpam: sum of activity fees
      // For SOPIR, we must sum both operational cost (fee) and net wage (upahBersih)
      if (jobCategory === 'SOPIR') {
        activityTotal = reports.reduce((sum, r) => sum + (r.fee || 0) + (r.upahBersih || 0), 0);
      } else {
        activityTotal = reports.reduce((sum, r) => sum + (r.fee || 0), 0);
      }
      
      // Fetch SPJ Events (KegiatanSpj) to get kegiatanTotal
      let spjEventsTotal = 0;
      try {
        const spjQ = query(
          collection(db, 'KegiatanSpj'),
          where('period', '==', period)
        );
        const spjSnap = await getDocs(spjQ);
        spjSnap.docs.forEach(d => {
          const data = d.data();
          const workerInfo = data.eventWorkers?.[employeeId];
          if (workerInfo) {
            spjEventsTotal += workerInfo.payGiven || 0;
          }
        });
      } catch (err) {
        console.error('[payslipSync] Error fetching KegiatanSpj:', err);
      }
      totalSpj = spjEventsTotal + activityTotal;
    }

    if (uraianSnap.exists()) {
      const uraianData = uraianSnap.data();
      const entries = { ...(uraianData.entries || {}) };
      const currentEntry = entries[employeeId] || { employeeId, name: employeeName };

      let updatedValues = { ...(currentEntry.values || {}) };
      let updatedCounts = { ...(currentEntry.counts || {}) };

      if (jobCategory === 'SATPAM') {
        updatedValues = {
          ...updatedValues,
          harian: harianCount * 12500,
          jumatLibur: jumatCount * 25000,
          lemburSendiri: lemburSendiriCount * 30000,
          lemburCover: lemburCoverCount * 50000,
        };
        updatedCounts = {
          ...updatedCounts,
          harian: harianCount,
          jumatLibur: jumatCount,
          lemburSendiri: lemburSendiriCount,
          lemburCover: lemburCoverCount,
        };
      } else {
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

      await updateDoc(uraianRef, { entries });
      console.log(`[payslipSync] Successfully synced activities to UraianGaji for ${employeeId} (${period})`);
    }

    // 5. Update PayrollSlipStates document (if it exists)
    const slipDocId = `${periodKey}_${employeeId}`;
    const slipRef = doc(db, 'PayrollSlipStates', slipDocId);
    const slipSnap = await getDoc(slipRef);

    if (slipSnap.exists()) {
      const slipData = slipSnap.data();
      const earnings: PaySlipField[] = [...(slipData.earnings || [])];

      const updateOrAddEarning = (label: string, amount: number) => {
        const idx = earnings.findIndex(e => e.label === label);
        if (idx > -1) {
          earnings[idx] = { ...earnings[idx], amount };
        } else {
          earnings.push({ label, amount });
        }
      };

      if (jobCategory === 'SATPAM') {
        updateOrAddEarning('Vakasi Harian', harianCount * 12500);
        updateOrAddEarning('Jumat & Libur', jumatCount * 25000);
        updateOrAddEarning('Lembur Sendiri', lemburSendiriCount * 30000);
        updateOrAddEarning('Lembur Cover', lemburCoverCount * 50000);
      } else {
        updateOrAddEarning('SPJ', totalSpj);
      }

      await updateDoc(slipRef, { earnings });
      console.log(`[payslipSync] Successfully synced activities to PayrollSlipStates for ${employeeId} (${period})`);
    }
  } catch (err) {
    console.error(`[payslipSync] Error syncing activities for employeeId ${employeeId}:`, err);
  }
}
