"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { db, secondaryDb } from '@/lib/firebase';
import { useAuth } from '@/lib/AuthContext';
import { SalaryMatrix } from '@/types';
import { matchFunctionalAllowance } from '@/utils/payrollLogic';
import { buildKoperasiPayrollAmountMaps } from '@/lib/payroll/koperasiAmounts';

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
  koperasiLoans: any[];
  koperasiUsers: any[];
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
  const [koperasiLoans, setKoperasiLoans] = useState<any[]>([]);
  const [koperasiUsers, setKoperasiUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!profile || !['super_admin', 'finance_verifier'].includes(profile.role)) {
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
      const currentPayrollPeriod = `${now.getFullYear()}-${String(
        now.getMonth() + 1,
      ).padStart(2, '0')}`;

      const koperasiLoanRecords = loanSnapshot.docs
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() as any }));
      const koperasiUserRecords = userSnapshot.docs
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() as any }));
      setKoperasiLoans(koperasiLoanRecords);
      setKoperasiUsers(koperasiUserRecords);

      const koperasiAmounts = buildKoperasiPayrollAmountMaps(
        currentPayrollPeriod,
        [...loyList, ...bcList],
        koperasiLoanRecords,
        koperasiUserRecords,
      );
      setKoperasiDeductions(koperasiAmounts.deductions);
      setKoperasiSavings(koperasiAmounts.savings);

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
        koperasiLoans,
        koperasiUsers,
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
