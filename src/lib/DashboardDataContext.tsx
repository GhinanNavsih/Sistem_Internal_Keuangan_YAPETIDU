"use client";

import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { SalaryMatrix } from '@/types';
import { matchFunctionalAllowance } from '@/utils/payrollLogic';
import { buildKoperasiPayrollAmountMaps } from '@/lib/payroll/koperasiAmounts';
import {
  useEmployeesBlueCollar,
  useEmployeesLoyalis,
  useKoperasiLoans,
  useKoperasiUsers,
  useMatrixActiveVersion,
  useMatrixGradeCodes,
  useMatrixRows,
  usePayrollCacheInvalidation,
} from '@/lib/queries/hooks';
import { isQuerySettled, isVersionedGroupSettled } from '@/lib/queries/status';

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

/** Roles allowed to read the payroll-wide dataset this context exposes. */
const DASHBOARD_DATA_ROLES = ['super_admin', 'finance_verifier'];

/** Stable empty values so consumers never see `undefined` before data lands. */
const EMPTY_LIST: any[] = [];
const EMPTY_MAP: Record<string, number> = {};

/**
 * Builds a `{ grade: { tahun: amount } }` matrix from raw version rows.
 */
function buildSalaryMatrix(rows: any[] | undefined): SalaryMatrix {
  const matrix: SalaryMatrix = {};
  (rows || []).forEach(row => {
    const tahun = row.tahun;
    const grades = row.salaries || {};
    Object.entries(grades).forEach(([grade, amount]) => {
      if (!matrix[grade]) matrix[grade] = {};
      matrix[grade][tahun] = amount as number;
    });
  });
  return matrix;
}

/**
 * Provides the payroll-wide reference dataset (employees, salary matrices,
 * koperasi amounts) to the whole dashboard tree.
 *
 * Reads go through the shared query cache, so a full page reload reuses data
 * already fetched in this session instead of re-pulling every collection. Call
 * `refreshData()` after a write to drop the cached copies and refetch.
 */
export function DashboardDataProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const enabled = Boolean(profile && DASHBOARD_DATA_ROLES.includes(profile.role));

  const { invalidateEmployees, invalidateSalaryMatrix, invalidateKoperasi } =
    usePayrollCacheInvalidation();

  const loyalisQuery = useEmployeesLoyalis(enabled);
  const blueCollarQuery = useEmployeesBlueCollar(enabled);

  // Each matrix resolves its active version first, then that version's rows.
  const blueVersion = useMatrixActiveVersion('SalaryMatrix', enabled);
  const whiteVersion = useMatrixActiveVersion('SalaryMatrix_WhiteCollar', enabled);
  const functionalVersion = useMatrixActiveVersion('SalaryMatrix_Functional', enabled);
  const kepangkatanVersion = useMatrixActiveVersion('SalaryMatrix_Kepangkatan', enabled);

  const blueRows = useMatrixRows('SalaryMatrix', blueVersion.data, enabled);
  const whiteRows = useMatrixRows('SalaryMatrix_WhiteCollar', whiteVersion.data, enabled);
  const functionalRows = useMatrixRows('SalaryMatrix_Functional', functionalVersion.data, enabled);
  const kepangkatanRows = useMatrixRows('SalaryMatrix_Kepangkatan', kepangkatanVersion.data, enabled);

  const blueGrades = useMatrixGradeCodes('SalaryMatrix', blueVersion.data, enabled);
  const whiteGrades = useMatrixGradeCodes('SalaryMatrix_WhiteCollar', whiteVersion.data, enabled);

  const koperasiLoansQuery = useKoperasiLoans(enabled);
  const koperasiUsersQuery = useKoperasiUsers(enabled);

  const employeesLoyalis = loyalisQuery.data ?? EMPTY_LIST;
  const employeesBlueCollar = blueCollarQuery.data ?? EMPTY_LIST;
  const koperasiLoans = koperasiLoansQuery.data ?? EMPTY_LIST;
  const koperasiUsers = koperasiUsersQuery.data ?? EMPTY_LIST;

  const salaryMatrixBlue = useMemo(() => buildSalaryMatrix(blueRows.data), [blueRows.data]);
  const salaryMatrixWhite = useMemo(() => buildSalaryMatrix(whiteRows.data), [whiteRows.data]);

  const functionalAllowanceMap = useMemo(() => {
    if (!functionalRows.data || employeesLoyalis.length === 0) return EMPTY_MAP;

    const fMatrix: Record<string, { base_value: number; functional_tiers: Record<string, number> }> = {};
    functionalRows.data.forEach((row: any) => {
      fMatrix[row.id] = {
        base_value: row.base_value || 0,
        functional_tiers: row.functional_tiers || {},
      };
    });

    const map: Record<string, number> = {};
    employeesLoyalis.forEach((empData: any) => {
      const edLevel = empData.academic_and_tier?.education_level;
      const fTier = empData.academic_and_tier?.functional_tier;
      map[empData.id] = matchFunctionalAllowance(edLevel, fTier, fMatrix);
    });
    return map;
  }, [functionalRows.data, employeesLoyalis]);

  const kepangkatanAllowanceMap = useMemo(() => {
    if (!kepangkatanRows.data || employeesLoyalis.length === 0) return EMPTY_MAP;

    const kepMatrix: Record<number, number> = {};
    kepangkatanRows.data.forEach((row: any) => {
      const credit = Number(row.credit_score) || 0;
      kepMatrix[credit] = Number(row.allowance) || 0;
    });

    const map: Record<string, number> = {};
    employeesLoyalis.forEach((empData: any) => {
      const credit = Number(empData.kepangkatan?.cummulativeCredit) || 0;
      map[empData.id] = kepMatrix[credit] || 0;
    });
    return map;
  }, [kepangkatanRows.data, employeesLoyalis]);

  const koperasiAmounts = useMemo(() => {
    if (koperasiLoans.length === 0 && koperasiUsers.length === 0) {
      return { deductions: EMPTY_MAP, savings: EMPTY_MAP };
    }
    const now = new Date();
    const currentPayrollPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return buildKoperasiPayrollAmountMaps(
      currentPayrollPeriod,
      [...employeesLoyalis, ...employeesBlueCollar],
      koperasiLoans,
      koperasiUsers,
    );
  }, [employeesLoyalis, employeesBlueCollar, koperasiLoans, koperasiUsers]);

  // Mirrors the previous behaviour: unauthorized roles are never "loading", and
  // a failed read ends the loading state rather than hanging the UI.
  const loading =
    enabled &&
    !(
      [loyalisQuery, blueCollarQuery, koperasiLoansQuery, koperasiUsersQuery].every(isQuerySettled) &&
      isVersionedGroupSettled(blueVersion, blueRows, blueGrades) &&
      isVersionedGroupSettled(whiteVersion, whiteRows, whiteGrades) &&
      isVersionedGroupSettled(functionalVersion, functionalRows) &&
      isVersionedGroupSettled(kepangkatanVersion, kepangkatanRows)
    );

  const refreshData = useCallback(async () => {
    await Promise.all([
      invalidateEmployees(),
      invalidateSalaryMatrix(),
      invalidateKoperasi(),
    ]);
  }, [invalidateEmployees, invalidateSalaryMatrix, invalidateKoperasi]);

  const value = useMemo<DashboardDataContextType>(
    () => ({
      employeesLoyalis,
      employeesBlueCollar,
      salaryMatrixBlue,
      salaryMatrixWhite,
      gradeCodesBlue: blueGrades.data ?? EMPTY_LIST,
      gradeCodesWhite: whiteGrades.data ?? EMPTY_LIST,
      functionalAllowanceMap,
      kepangkatanAllowanceMap,
      koperasiDeductions: koperasiAmounts.deductions,
      koperasiSavings: koperasiAmounts.savings,
      koperasiLoans,
      koperasiUsers,
      loading,
      refreshData,
    }),
    [
      employeesLoyalis,
      employeesBlueCollar,
      salaryMatrixBlue,
      salaryMatrixWhite,
      blueGrades.data,
      whiteGrades.data,
      functionalAllowanceMap,
      kepangkatanAllowanceMap,
      koperasiAmounts,
      koperasiLoans,
      koperasiUsers,
      loading,
      refreshData,
    ],
  );

  return (
    <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>
  );
}

export function useDashboardData() {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) {
    throw new Error('useDashboardData must be used within a DashboardDataProvider');
  }
  return ctx;
}
