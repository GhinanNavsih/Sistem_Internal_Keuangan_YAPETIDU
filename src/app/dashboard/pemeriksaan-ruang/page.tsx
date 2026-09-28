"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ClipboardCheck, Loader2, LogOut, RefreshCw } from 'lucide-react';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import { InspectionRowsSkeleton, RepairsTable, ReturnsTable } from '@/components/venue/InspectionTables';
import ReturnInspectionDialog, { type ReturnCheckResult } from '@/components/venue/ReturnInspectionDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import { useAuth } from '@/lib/AuthContext';
import { getEmployeeActivitiesPath } from '@/lib/employeeActivities';
import { isBlueCollarFacilityDashboardUser } from '@/lib/facilityReports';
import { authenticatedJson } from '@/lib/payroll/client';
import { cn } from '@/lib/utils';
import type { RepairLogView, ReturnInspectionView } from '@/lib/venueInspection';

/**
 * Pemeriksaan Ruang. The layout and flow are SIMPEL's maintenance page (a
 * toolbar with Pengembalian / Perbaikan tabs over a table, "Periksa" opening
 * the return check); only the colours and font are SAKU's.
 */

interface ListResponse {
  returns: ReturnInspectionView[];
  repairs: RepairLogView[];
}

interface RepairResponse {
  logId: string;
  namaBarang: string;
  restored: string[];
}

type Tab = 'pengembalian' | 'perbaikan';

function repairConfirmation(log: RepairLogView): string {
  if (log.namaBarang.startsWith('Ruangan:')) {
    return 'Ruangan dibuka kembali untuk peminjaman bila tidak ada catatan lain yang masih terbuka.';
  }
  return log.kondisi === 'Rusak Berat'
    ? `${log.jumlah} unit ${log.namaBarang} kembali ke stok.`
    : `${log.jumlah} unit ${log.namaBarang} ditandai selesai diservis.`;
}

export default function VenueInspectionPage() {
  const { profile: realProfile, activeProfile, logout } = useAuth();
  const profile = activeProfile || realProfile;
  const isFieldStaff = isBlueCollarFacilityDashboardUser(profile);

  const [tab, setTab] = useState<Tab>('pengembalian');
  const [returns, setReturns] = useState<ReturnInspectionView[]>([]);
  const [repairs, setRepairs] = useState<RepairLogView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<SnackbarMessage | null>(null);
  const [inspecting, setInspecting] = useState<ReturnInspectionView | null>(null);
  const [repairTarget, setRepairTarget] = useState<RepairLogView | null>(null);
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await authenticatedJson<ListResponse>('/api/venue-inspections');
      setReturns(data.returns);
      setRepairs(data.repairs);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Gagal memuat data dari SIMPEL.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  const handleChecked = (result: ReturnCheckResult) => {
    setInspecting(null);
    setMessage(
      result.damageSummaries.length > 0
        ? { type: 'warning', text: `Pemeriksaan selesai dengan catatan: ${result.damageSummaries.join('; ')}.` }
        : { type: 'success', text: 'Pemeriksaan selesai. Semua fasilitas dikembalikan lengkap dan dalam kondisi baik.' },
    );
    void load();
  };

  const resolveRepair = async () => {
    if (!repairTarget || resolving) return;
    setResolving(true);
    try {
      const result = await authenticatedJson<RepairResponse>('/api/venue-inspections', {
        method: 'POST',
        body: JSON.stringify({ action: 'resolve-repair', logId: repairTarget.id }),
      });
      setMessage({
        type: 'success',
        text:
          result.restored.length > 0
            ? `Perbaikan selesai. ${result.restored.join('; ')}.`
            : `Perbaikan ${result.namaBarang} ditandai selesai.`,
      });
      setRepairTarget(null);
      void load();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Gagal menandai perbaikan selesai.' });
    } finally {
      setResolving(false);
    }
  };

  const openRepairs = repairs.filter((log) => log.status === 'Dalam Perbaikan').length;
  const tabs = [
    { id: 'pengembalian', label: 'Pengembalian', count: returns.length },
    { id: 'perbaikan', label: 'Perbaikan', count: openRepairs },
  ] as const;

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800">
      {isFieldStaff && (
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-3 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Link href={getEmployeeActivitiesPath(profile || {})}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  title="Kembali ke Laporan Kegiatan"
                  aria-label="Kembali ke Laporan Kegiatan"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                <ClipboardCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold leading-tight text-slate-900">Pemeriksaan Ruang</h1>
                <p className="truncate text-xs text-slate-500">{profile?.displayName || profile?.email || 'Karyawan'}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <EmployeeNavigationMenu />
              <Button
                type="button"
                onClick={() => void logout()}
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md text-slate-500 hover:bg-slate-100 hover:text-red-600"
                title="Keluar"
                aria-label="Keluar"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>
      )}

      <div className="mx-auto w-full max-w-5xl px-3 py-5 sm:px-6 sm:py-6">
        {!isFieldStaff && (
          <div className="mb-5">
            <h1 className="text-lg font-semibold text-slate-900">Pemeriksaan Ruang</h1>
            <p className="mt-1 text-[13px] text-slate-500">
              Kebersihan dan Teknisi memeriksa ruangan dan peralatan setelah dipakai. Data tersimpan di SIMPEL UNIPDU.
            </p>
          </div>
        )}

        {/* Toolbar: underline tabs on the left, the page's action on the right. */}
        <div className="mb-6 flex items-end justify-between gap-3 border-b border-slate-200">
          <div role="tablist" className="-mb-px flex gap-5 overflow-x-auto">
            {tabs.map((entry) => {
              const active = tab === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(entry.id)}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 pb-2.5 text-sm! transition-colors',
                    active
                      ? 'border-indigo-600 font-medium text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-800',
                  )}
                >
                  {entry.label}
                  <span className={cn('text-xs tabular-nums', active ? 'text-slate-500' : 'text-slate-400')}>
                    {entry.count}
                  </span>
                </button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={loading || refreshing}
            className="mb-1 h-8 w-8 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            title="Muat ulang dari SIMPEL"
            aria-label="Muat ulang dari SIMPEL"
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </Button>
        </div>

        {loading ? (
          <InspectionRowsSkeleton />
        ) : loadError ? (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2.5 text-[13px] text-red-800">
            {loadError}
          </div>
        ) : tab === 'pengembalian' ? (
          <ReturnsTable items={returns} onInspect={setInspecting} />
        ) : (
          <RepairsTable items={repairs} onResolve={setRepairTarget} />
        )}
      </div>

      <ReturnInspectionDialog inspection={inspecting} onClose={() => setInspecting(null)} onDone={handleChecked} />

      <Dialog open={!!repairTarget} onOpenChange={(open) => !open && !resolving && setRepairTarget(null)}>
        <DialogContent className="w-[95vw] gap-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-0 shadow-lg ring-0 sm:max-w-md">
          <DialogHeader className="gap-1 px-5 pb-4 pr-12 pt-5">
            <DialogTitle className="text-base font-semibold text-slate-900">Tandai selesai diservis?</DialogTitle>
            <DialogDescription className="text-sm text-slate-600">
              {repairTarget ? repairConfirmation(repairTarget) : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRepairTarget(null)}
              disabled={resolving}
              className="h-9 rounded-md border-slate-200 bg-white px-3.5 text-sm! font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => void resolveRepair()}
              disabled={resolving}
              className="h-9 rounded-md bg-indigo-600 px-3.5 text-sm! font-medium text-white hover:bg-indigo-700"
            >
              {resolving && <Loader2 className="animate-spin" />}
              Selesai servis
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <FloatingSnackbar message={message} onDismiss={() => setMessage(null)} duration={8000} />
    </div>
  );
}
