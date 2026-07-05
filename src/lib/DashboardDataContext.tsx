"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { db, secondaryDb } from '@/lib/firebase';
import { useAuth } from '@/lib/AuthContext';
import { SalaryMatrix } from '@/types';
import { matchFunctionalAllowance, normalizeName, MANUAL_OVERRIDES } from '@/utils/payrollLogic';

interface DashboardDataContextType {
  employeesLoyalis: any[];
  employeesBlueCollar: any[];
  salaryMatrixBlue: SalaryMatrix;
  salaryMatrixWhite: SalaryMatrix;
  gradeCodesBlue: string[];
  gradeCodesWhite: string[];
  functionalAllowanceMap: Record<string, number>;
  kepangkatanAllowanceMap: Record<string, number>;
  koperasiDeductions: Record<string, number>;
  koperasiSavings: Record<string, number>;
  loading: boolean;
  refreshData: () => Promise<void>;
}

const DashboardDataContext = createContext<DashboardDataContextType | null>(null);

export function DashboardDataProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const [employeesLoyalis, setEmployeesLoyalis] = useState<any[]>([]);
  const [employeesBlueCollar, setEmployeesBlueCollar] = useState<any[]>([]);
  const [salaryMatrixBlue, setSalaryMatrixBlue] = useState<SalaryMatrix>({});
  const [salaryMatrixWhite, setSalaryMatrixWhite] = useState<SalaryMatrix>({});
  const [gradeCodesBlue, setGradeCodesBlue] = useState<string[]>([]);
  const [gradeCodesWhite, setGradeCodesWhite] = useState<string[]>([]);
  const [functionalAllowanceMap, setFunctionalAllowanceMap] = useState<Record<string, number>>({});
  const [kepangkatanAllowanceMap, setKepangkatanAllowanceMap] = useState<Record<string, number>>({});
  const [koperasiDeductions, setKoperasiDeductions] = useState<Record<string, number>>({});
  const [koperasiSavings, setKoperasiSavings] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!profile || (profile.role !== 'super_admin' && profile.role !== 'employee_admin')) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch root configs and cooperative collections in parallel
      const [
        loySnap,
        bcSnap,
        matrixBlueConfigSnap,
        matrixWhiteConfigSnap,
        fConfigSnap,
        kepConfigSnap,
        loanSnapshot,
        userSnapshot
      ] = await Promise.all([
        getDocs(collection(db, 'Employees_Loyalis')),
        getDocs(collection(db, 'Employees_BlueCollar')),
        getDoc(doc(db, 'SalaryMatrix', '_config')),
        getDoc(doc(db, 'SalaryMatrix_WhiteCollar', '_config')),
        getDoc(doc(db, 'SalaryMatrix_Functional', '_config')),
        getDoc(doc(db, 'SalaryMatrix_Kepangkatan', '_config')),
        getDocs(collection(secondaryDb, 'simpanPinjam')),
        getDocs(collection(secondaryDb, 'users'))
      ]);

      const loyList = loySnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const bcList = bcSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      setEmployeesLoyalis(loyList);
      setEmployeesBlueCollar(bcList);

      // Active versions
      let activeBlueVersion = '2026_v1';
      if (matrixBlueConfigSnap.exists() && matrixBlueConfigSnap.data().activeVersion) {
        activeBlueVersion = matrixBlueConfigSnap.data().activeVersion;
      }

      let activeWhiteVersion = '2026_v1';
      if (matrixWhiteConfigSnap.exists() && matrixWhiteConfigSnap.data().activeVersion) {
        activeWhiteVersion = matrixWhiteConfigSnap.data().activeVersion;
      }

      let activeFunctionalVersion = '2026_v1';
      if (fConfigSnap.exists() && fConfigSnap.data().activeVersion) {
        activeFunctionalVersion = fConfigSnap.data().activeVersion;
      }

      let activeKepangkatanVersion = '2026_v1';
      if (kepConfigSnap.exists() && kepConfigSnap.data().activeVersion) {
        activeKepangkatanVersion = kepConfigSnap.data().activeVersion;
      }

      // Fetch versions data rows in parallel
      const [
        matrixBlueSnap,
        matrixWhiteSnap,
        fSnap,
        kepSnap,
        blueVersionSnap,
        whiteVersionSnap
      ] = await Promise.all([
        getDocs(collection(db, 'SalaryMatrix', activeBlueVersion, 'rows')),
        getDocs(collection(db, 'SalaryMatrix_WhiteCollar', activeWhiteVersion, 'rows')),
        getDocs(collection(db, 'SalaryMatrix_Functional', activeFunctionalVersion, 'rows')),
        getDocs(collection(db, 'SalaryMatrix_Kepangkatan', activeKepangkatanVersion, 'rows')),
        getDoc(doc(db, 'SalaryMatrix', activeBlueVersion)),
        getDoc(doc(db, 'SalaryMatrix_WhiteCollar', activeWhiteVersion))
      ]);

      const gCodesBlue = blueVersionSnap.exists() ? (blueVersionSnap.data()?.metadata?.gradeCodes || []) : [];
      const gCodesWhite = whiteVersionSnap.exists() ? (whiteVersionSnap.data()?.metadata?.gradeCodes || []) : [];
      setGradeCodesBlue(gCodesBlue);
      setGradeCodesWhite(gCodesWhite);

      // Process blue matrix
      const matrixBlue: SalaryMatrix = {};
      matrixBlueSnap.docs.forEach(d => {
        const data = d.data();
        const tahun = data.tahun;
        const grades = data.salaries || {};
        Object.entries(grades).forEach(([grade, amount]) => {
          if (!matrixBlue[grade]) matrixBlue[grade] = {};
          matrixBlue[grade][tahun] = amount as number;
        });
      });
      setSalaryMatrixBlue(matrixBlue);

      // Process white matrix
      const matrixWhite: SalaryMatrix = {};
      matrixWhiteSnap.docs.forEach(d => {
        const data = d.data();
        const tahun = data.tahun;
        const grades = data.salaries || {};
        Object.entries(grades).forEach(([grade, amount]) => {
          if (!matrixWhite[grade]) matrixWhite[grade] = {};
          matrixWhite[grade][tahun] = amount as number;
        });
      });
      setSalaryMatrixWhite(matrixWhite);

      // Process functional allowance
      const fMatrix: Record<string, { base_value: number; functional_tiers: Record<string, number> }> = {};
      fSnap.docs.forEach(fDoc => {
        const data = fDoc.data();
        fMatrix[fDoc.id] = {
          base_value: data.base_value || 0,
          functional_tiers: data.functional_tiers || {},
        };
      });

      const fAllowanceMap: Record<string, number> = {};
      loyList.forEach((empData: any) => {
        const edLevel = empData.academic_and_tier?.education_level;
        const fTier = empData.academic_and_tier?.functional_tier;
        fAllowanceMap[empData.id] = matchFunctionalAllowance(edLevel, fTier, fMatrix);
      });
      setFunctionalAllowanceMap(fAllowanceMap);

      // Process Kepangkatan matrix
      const kepMatrix: Record<number, number> = {};
      kepSnap.docs.forEach(d => {
        const data = d.data();
        const credit = Number(data.credit_score) || 0;
        const allowance = Number(data.allowance) || 0;
        kepMatrix[credit] = allowance;
      });

      const kepAllowanceMap: Record<string, number> = {};
      loyList.forEach((empData: any) => {
        const credit = Number(empData.kepangkatan?.cummulativeCredit) || 0;
        kepAllowanceMap[empData.id] = kepMatrix[credit] || 0;
      });
      setKepangkatanAllowanceMap(kepAllowanceMap);

      // Process cooperative loan deductions & cooperative savings
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      const activeLoans = loanSnapshot.docs
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() as any }))
        .filter(loan => {
          if ((loan.sisaHutang || 0) <= 0) return false;

          // 1. Verify that the latest history entry status is 'Disetujui dan Aktif'
          if (!loan.history || !Array.isArray(loan.history) || loan.history.length === 0) {
            return false;
          }
          const sortedHistory = [...loan.history].sort((a, b) => {
            const tA = (a.timestamp as any)?.toMillis ? (a.timestamp as any).toMillis() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
            const tB = (b.timestamp as any)?.toMillis ? (b.timestamp as any).toMillis() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
            return tB - tA; // Latest first
          });
          const latestEntry = sortedHistory[0];
          if (!latestEntry || latestEntry.status !== 'Disetujui dan Aktif') {
            return false;
          }

          // 2. Determine activation date from tanggalDisetujui, falling back to history entry timestamp
          let activationDate: Date | null = null;
          if (loan.tanggalDisetujui) {
            activationDate = (loan.tanggalDisetujui as any).toDate ? (loan.tanggalDisetujui as any).toDate() : (loan.tanggalDisetujui.seconds ? new Date(loan.tanggalDisetujui.seconds * 1000) : null);
          }
          if (!activationDate && latestEntry.timestamp) {
            activationDate = (latestEntry.timestamp as any).toDate ? (latestEntry.timestamp as any).toDate() : (latestEntry.timestamp.seconds ? new Date(latestEntry.timestamp.seconds * 1000) : null);
          }

          if (!activationDate) return false;

          const activationYear = activationDate.getFullYear();
          const activationMonth = activationDate.getMonth() + 1;

          // Deduction starts on or after the activation month and year
          if (currentYear < activationYear) return false;
          if (currentYear === activationYear && currentMonth < activationMonth) return false;

          return true;
        });

      const allEmployees: {
        id: string;
        originalName: string;
        normalizedName: string;
        koperasiAuthUid?: string | null;
        koperasiUserId?: string | null;
      }[] = [];

      loyList.forEach(data => {
        const name = data.personal_info?.name || '';
        if (name) {
          allEmployees.push({
            id: data.id,
            originalName: name,
            normalizedName: normalizeName(name),
            koperasiAuthUid: data.koperasiAuthUid || null,
            koperasiUserId: data.koperasiUserId || null,
          });
        }
      });

      bcList.forEach(data => {
        const name = data.name || '';
        if (name) {
          allEmployees.push({
            id: data.id,
            originalName: name,
            normalizedName: normalizeName(name),
            koperasiAuthUid: data.koperasiAuthUid || null,
            koperasiUserId: data.koperasiUserId || null,
          });
        }
      });

      const deductionMap: Record<string, number> = {};
      activeLoans.forEach(loan => {
        const spName = loan.userData?.namaLengkap || '';
        const normalizedSP = normalizeName(spName);
        const cicilan = Math.round(loan.jumlahPinjaman / loan.tenor);

        let match = allEmployees.find(
          emp => emp.koperasiAuthUid && emp.koperasiAuthUid === loan.userId
        );

        if (!match) {
          match = allEmployees.find(emp => emp.normalizedName === normalizedSP);
        }

        if (!match) {
          const overrideName = MANUAL_OVERRIDES[spName.trim()];
          if (overrideName) {
            match = allEmployees.find(emp => emp.originalName === overrideName);
          }
        }

        if (match) {
          deductionMap[match.id] = (deductionMap[match.id] || 0) + cicilan;
        }
      });
      setKoperasiDeductions(deductionMap);

      const savingMap: Record<string, number> = {};
      userSnapshot.docs.forEach(userDoc => {
        const uData = userDoc.data();
        const uName = uData.nama || '';
        if (!uName) return;

        // Skip non-approved membership records
        const isApproved = uData.status === 'approved' || uData.membershipStatus === 'approved';
        if (!isApproved) return;

        const normalizedU = normalizeName(uName);
        const uUid = uData.uid || userDoc.id;

        let match = allEmployees.find(
          emp =>
            (emp.koperasiUserId && emp.koperasiUserId === userDoc.id) ||
            (emp.koperasiAuthUid && emp.koperasiAuthUid === uUid)
        );

        if (!match) {
          match = allEmployees.find(emp => emp.normalizedName === normalizedU);
        }

        if (!match) {
          const overrideName = MANUAL_OVERRIDES[uName.trim()];
          if (overrideName) {
            match = allEmployees.find(emp => emp.originalName === overrideName);
          }
        }

        if (match) {
          const isYayasanSubsidy = uData.paymentStatus === 'Yayasan Subsidy';
          savingMap[match.id] = isYayasanSubsidy ? 0 : 25000;
        }
      });
      setKoperasiSavings(savingMap);

    } catch (err) {
      console.error('Error fetching global dashboard data context:', err);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <DashboardDataContext.Provider
      value={{
        employeesLoyalis,
        employeesBlueCollar,
        salaryMatrixBlue,
        salaryMatrixWhite,
        gradeCodesBlue,
        gradeCodesWhite,
        functionalAllowanceMap,
        kepangkatanAllowanceMap,
        koperasiDeductions,
        koperasiSavings,
        loading,
        refreshData: fetchData
      }}
    >
      {children}
    </DashboardDataContext.Provider>
  );
}

export function useDashboardData() {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) {
    throw new Error('useDashboardData must be used within a DashboardDataProvider');
  }
  return ctx;
}
