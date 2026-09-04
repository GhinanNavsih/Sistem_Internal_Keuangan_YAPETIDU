"use client";

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  employeeKeys,
  koperasiKeys,
  referenceKeys,
  salaryMatrixKeys,
  STALE_TIME,
  type SalaryMatrixCollection,
} from './keys';
import {
  fetchDepartments,
  fetchEmployeesBlueCollar,
  fetchEmployeesLoyalis,
  fetchJabatanStruktural,
  fetchKoperasiLoans,
  fetchKoperasiUsers,
  fetchMatrixActiveVersion,
  fetchMatrixGradeCodes,
  fetchMatrixRows,
} from './firestore';

/**
 * Cached read hooks for the Firestore data shared across dashboard pages.
 *
 * `enabled` is threaded through so callers can gate a read on authorization
 * (the dashboard context only reads for finance roles) without the query
 * firing and failing on Firestore rules first.
 */

export function useEmployeesLoyalis(enabled = true) {
  return useQuery({
    queryKey: employeeKeys.loyalis(),
    queryFn: fetchEmployeesLoyalis,
    staleTime: STALE_TIME.employees,
    enabled,
  });
}

export function useEmployeesBlueCollar(enabled = true) {
  return useQuery({
    queryKey: employeeKeys.blueCollar(),
    queryFn: fetchEmployeesBlueCollar,
    staleTime: STALE_TIME.employees,
    enabled,
  });
}

export function useMatrixActiveVersion(
  collectionName: SalaryMatrixCollection,
  enabled = true,
) {
  return useQuery({
    queryKey: salaryMatrixKeys.config(collectionName),
    queryFn: () => fetchMatrixActiveVersion(collectionName),
    staleTime: STALE_TIME.reference,
    enabled,
  });
}

/** Depends on a resolved version; stays idle until one is available. */
export function useMatrixRows<T = any>(
  collectionName: SalaryMatrixCollection,
  version: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: salaryMatrixKeys.rows(collectionName, version ?? ''),
    queryFn: () => fetchMatrixRows<T>(collectionName, version as string),
    staleTime: STALE_TIME.reference,
    enabled: enabled && Boolean(version),
  });
}

export function useMatrixGradeCodes(
  collectionName: SalaryMatrixCollection,
  version: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: salaryMatrixKeys.version(collectionName, version ?? ''),
    queryFn: () => fetchMatrixGradeCodes(collectionName, version as string),
    staleTime: STALE_TIME.reference,
    enabled: enabled && Boolean(version),
  });
}

export function useKoperasiLoans(enabled = true) {
  return useQuery({
    queryKey: koperasiKeys.loans(),
    queryFn: fetchKoperasiLoans,
    staleTime: STALE_TIME.koperasi,
    enabled,
  });
}

export function useKoperasiUsers(enabled = true) {
  return useQuery({
    queryKey: koperasiKeys.users(),
    queryFn: fetchKoperasiUsers,
    staleTime: STALE_TIME.koperasi,
    enabled,
  });
}

export function useJabatanStruktural(enabled = true) {
  return useQuery({
    queryKey: referenceKeys.jabatanStruktural(),
    queryFn: fetchJabatanStruktural,
    staleTime: STALE_TIME.reference,
    enabled,
  });
}

export function useDepartments(enabled = true) {
  return useQuery({
    queryKey: referenceKeys.departments(),
    queryFn: fetchDepartments,
    staleTime: STALE_TIME.reference,
    enabled,
  });
}

/**
 * Invalidation helpers for write paths.
 *
 * Cached data here backs payroll figures, so any mutation must explicitly drop
 * what it touched rather than waiting for `staleTime` to lapse. Each helper
 * returns the promise so a save handler can `await` a refetch before reporting
 * success.
 */
export function usePayrollCacheInvalidation() {
  const queryClient = useQueryClient();

  const invalidateEmployees = useCallback(
    () => queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
    [queryClient],
  );

  const invalidateSalaryMatrix = useCallback(
    (collectionName?: SalaryMatrixCollection) =>
      queryClient.invalidateQueries({
        queryKey: collectionName
          ? salaryMatrixKeys.collection(collectionName)
          : salaryMatrixKeys.all,
      }),
    [queryClient],
  );

  const invalidateKoperasi = useCallback(
    () => queryClient.invalidateQueries({ queryKey: koperasiKeys.all }),
    [queryClient],
  );

  const invalidateReference = useCallback(
    () => queryClient.invalidateQueries({ queryKey: referenceKeys.all }),
    [queryClient],
  );

  return {
    invalidateEmployees,
    invalidateSalaryMatrix,
    invalidateKoperasi,
    invalidateReference,
  };
}
