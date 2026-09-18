"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Image as ImageIcon,
  Loader2,
  LogOut,
  MapPin,
  ThumbsDown,
  Wrench,
} from 'lucide-react';
import GlobalHeader from '@/components/GlobalHeader';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import FacilityReportRepairForm from '@/components/FacilityReportRepairForm';
import { FacilityReportRowsSkeleton } from '@/components/FacilityReportsSkeleton';
import SatkerPekaryaNavBar from '@/components/SatkerPekaryaNavBar';
import UraianNavToggles from '@/components/UraianNavToggles';
import { ImageExifViewer } from '@/components/ImageExifViewer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/AuthContext';
import { getEmployeeActivitiesPath } from '@/lib/employeeActivities';
import {
  FACILITY_REPORT_STATUS_LABELS,
  FACILITY_REPORT_STATUSES,
  facilityReportStatusTone,
  isBlueCollarFacilityDashboardUser,
  isFacilityReportStatus,
  MAX_FACILITY_REVIEW_NOTE_LENGTH,
  MIN_FACILITY_DECLINE_REASON_LENGTH,
  type FacilityReportStatus,
} from '@/lib/facilityReports';
import { authenticatedJson } from '@/lib/payroll/client';
import type { PhotoEvidence } from '@/lib/photoEvidence';

interface FacilityReportRow {
  id: string;
  employeeId: string;
  employeeName: string;
  place: string;
  description: string;
  photos?: PhotoEvidence[];
  resolutionPhotos?: PhotoEvidence[];
  status: FacilityReportStatus;
  reportedDate: string;
  reportedAtMillis?: number | null;
  reviewNote?: string | null;
  reviewedByName?: string | null;
  resolvedByName?: string | null;
  resolvedAtMillis?: number | null;
}

type StatusFilter = 'all' | FacilityReportStatus;

function formatReportDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '—';
  const [year, month, day] = value.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${Number(day)} ${months[Number(month) - 1] || month} ${year}`;
}

function FacilityReportPhotoGrid({
  report,
  photos,
  label,
  emptyLabel,
  onZoom,
}: {
  report: FacilityReportRow;
  photos?: PhotoEvidence[];
  label: string;
  emptyLabel: string;
  onZoom: (report: FacilityReportRow, photo: PhotoEvidence) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
        {label} {photos && photos.length > 0 ? `(${photos.length})` : ''}
      </p>
      {photos && photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {photos.map((photo, index) => (
            <button
              key={photo.url}
              type="button"
              onClick={() => onZoom(report, photo)}
              className="block aspect-square cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-white text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              aria-label={`Buka ${label.toLowerCase()} di ${report.place}, foto ${index + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={`${label} di ${report.place} — foto ${index + 1}`}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.02]"
              />
            </button>
          ))}
        </div>
      ) : (
        <div className="flex aspect-[4/3] max-h-72 w-full flex-col items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-center text-[11px] font-bold text-amber-800">
          <ImageIcon className="h-5 w-5 text-amber-600" />
          <span>{emptyLabel}</span>
        </div>
      )}
    </div>
  );
}

function FacilityReportDetailsContent({
  report,
  onZoom,
}: {
  report: FacilityReportRow;
  onZoom: (report: FacilityReportRow, photo: PhotoEvidence) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
            Lokasi Fasilitas
          </p>
          <p className="mt-0.5 break-words text-sm font-bold text-slate-800">{report.place}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
            Deskripsi Masalah atau Kondisi
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
            {report.description}
          </p>
        </div>
        {report.reviewNote && (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Catatan Tinjauan
              {report.reviewedByName ? ` · ${report.reviewedByName}` : ''}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs font-semibold text-slate-700">
              {report.reviewNote}
            </p>
          </div>
        )}
        {report.resolvedByName && report.status === 'resolved' && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
              Diselesaikan Oleh
            </p>
            <p className="mt-0.5 text-xs font-bold text-emerald-900">{report.resolvedByName}</p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <FacilityReportPhotoGrid
          report={report}
          photos={report.photos}
          label="Bukti Foto Laporan"
          emptyLabel="Tanpa Bukti Foto Laporan"
          onZoom={onZoom}
        />
        {report.status === 'resolved' && (
          <FacilityReportPhotoGrid
            report={report}
            photos={report.resolutionPhotos}
            label="Bukti Foto Perbaikan"
            emptyLabel="Tidak ada foto bukti perbaikan"
            onZoom={onZoom}
          />
        )}
      </div>
    </div>
  );
}

function FacilityReportEmptyState() {
  return (
    <div className="py-12 text-center sm:py-14">
      <Wrench className="mx-auto mb-2 h-8 w-8 text-slate-300" />
      <p className="text-sm font-bold text-slate-500">Tidak ada laporan</p>
      <p className="mt-0.5 px-4 text-xs text-slate-400">
        Belum ada laporan kondisi fasilitas pada filter ini.
      </p>
    </div>
  );
}

interface FacilityReportMobileCardProps {
  report: FacilityReportRow;
  isExpanded: boolean;
  isReviewer: boolean;
  isRepairer: boolean;
  actionLoading: boolean;
  onToggle: (reportId: string) => void;
  onReview: (report: FacilityReportRow, status: FacilityReportStatus) => void;
  onRepair: (report: FacilityReportRow) => void;
  onZoom: (report: FacilityReportRow, photo: PhotoEvidence) => void;
}

function FacilityReportMobileCard({
  report,
  isExpanded,
  isReviewer,
  isRepairer,
  actionLoading,
  onToggle,
  onReview,
  onRepair,
  onZoom,
}: FacilityReportMobileCardProps) {
  const photoCount = report.photos?.length || 0;
  const resolutionPhotoCount = report.resolutionPhotos?.length || 0;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => onToggle(report.id)}
        aria-expanded={isExpanded}
        className="w-full p-4 text-left touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
            <MapPin className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 break-words text-sm font-bold leading-snug text-slate-800">
                {report.place || '—'}
              </h3>
              <Badge className={`shrink-0 border-none text-[10px] font-bold ${facilityReportStatusTone(report.status)}`}>
                {FACILITY_REPORT_STATUS_LABELS[report.status]}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
              {report.description || '—'}
            </p>
            <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-slate-400">
              <span className="min-w-0 truncate">{report.employeeName || '—'}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{formatReportDate(report.reportedDate)}</span>
            </div>
          </div>
          <ChevronDown
            className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180 text-indigo-600' : ''}`}
            aria-hidden="true"
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 pl-12 text-[11px] font-bold text-slate-400">
          <div className="flex min-w-0 items-center gap-2">
            {photoCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">
                <ImageIcon className="h-3 w-3" />
                {photoCount} foto
              </span>
            )}
            {resolutionPhotoCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                {resolutionPhotoCount} bukti
              </span>
            )}
          </div>
          <span className="shrink-0 text-indigo-600">{isExpanded ? 'Tutup detail' : 'Lihat detail'}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 p-4">
          <FacilityReportDetailsContent report={report} onZoom={onZoom} />

          {isReviewer && report.status === 'pending' && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                type="button"
                disabled={actionLoading}
                onClick={() => onReview(report, 'resolved')}
                className="min-h-11 rounded-xl border border-emerald-200 bg-emerald-50 px-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Selesai
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={actionLoading}
                onClick={() => onReview(report, 'declined')}
                className="min-h-11 rounded-xl px-2 text-xs font-bold text-rose-500 hover:bg-rose-50"
              >
                <ThumbsDown className="h-3.5 w-3.5" />
                Tolak
              </Button>
            </div>
          )}

          {isRepairer && report.status === 'pending' && (
            <Button
              type="button"
              onClick={() => onRepair(report)}
              className="mt-4 min-h-11 w-full rounded-xl bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700"
            >
              <Camera className="h-4 w-4" />
              Tambahkan Bukti &amp; Tandai Selesai
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function FacilityReportReviewContent() {
  const { profile: rawProfile, activeProfile, logout } = useAuth();
  const profile = activeProfile || rawProfile;

  const [reports, setReports] = useState<FacilityReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
  const [zoomPhoto, setZoomPhoto] = useState<{ report: FacilityReportRow; photo: PhotoEvidence } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [reviewTarget, setReviewTarget] = useState<
    { report: FacilityReportRow; nextStatus: FacilityReportStatus } | null
  >(null);
  const [repairTarget, setRepairTarget] = useState<FacilityReportRow | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const isRepairer = isBlueCollarFacilityDashboardUser(profile);
  const isReviewer = profile?.role === 'super_admin' || profile?.role === 'satker_head';
  const effectiveStatusFilter = statusFilter ?? 'pending';
  const employeeHomeHref = getEmployeeActivitiesPath(profile || {});

  const loadReports = useCallback(async () => {
    try {
      const result = await authenticatedJson<{ reports: FacilityReportRow[] }>(
        '/api/facility-reports',
      );
      const nextReports = (result.reports || [])
        .map((report) => ({
          ...report,
          status: isFacilityReportStatus(report.status) ? report.status : 'pending',
        }))
        .sort((a, b) => {
          const timestampA = Number(a.reportedAtMillis || 0);
          const timestampB = Number(b.reportedAtMillis || 0);
          if (timestampA !== timestampB) return timestampB - timestampA;
          return String(b.reportedDate || '').localeCompare(String(a.reportedDate || ''));
        });
      setReports(nextReports);
    } catch (error) {
      console.error('Error loading facility reports:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal memuat laporan fasilitas.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReports(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReports]);

  const toggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      if (effectiveStatusFilter !== 'all' && report.status !== effectiveStatusFilter) return false;
      return true;
    });
  }, [effectiveStatusFilter, reports]);

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: reports.length };
    FACILITY_REPORT_STATUSES.forEach((status) => {
      base[status] = reports.filter((report) => report.status === status).length;
    });
    return base;
  }, [reports]);

  const openReviewDialog = (report: FacilityReportRow, nextStatus: FacilityReportStatus) => {
    setReviewTarget({ report, nextStatus });
    setReviewNote('');
  };

  const submitReview = async () => {
    if (!reviewTarget || actionLoading) return;
    const note = reviewNote.trim();
    if (
      reviewTarget.nextStatus === 'declined' &&
      note.length < MIN_FACILITY_DECLINE_REASON_LENGTH
    ) {
      setMessage({
        type: 'error',
        text: `Alasan penolakan minimal ${MIN_FACILITY_DECLINE_REASON_LENGTH} karakter.`,
      });
      return;
    }

    setActionLoading(true);
    try {
      await authenticatedJson('/api/facility-reports', {
        method: 'POST',
        body: JSON.stringify({
          action: 'review',
          reportId: reviewTarget.report.id,
          status: reviewTarget.nextStatus,
          ...(note ? { reviewNote: note } : {}),
        }),
      });
      setMessage({
        type: 'success',
        text: `Laporan "${reviewTarget.report.place}" ditandai ${FACILITY_REPORT_STATUS_LABELS[reviewTarget.nextStatus]}.`,
      });
      setReviewTarget(null);
      setReviewNote('');
      await loadReports();
    } catch (error) {
      console.error('Error reviewing facility report:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal memperbarui laporan.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const openRepairDialog = (report: FacilityReportRow) => {
    setRepairTarget(report);
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans text-slate-800">
      <div className="pointer-events-none absolute right-0 top-0 hidden h-[600px] w-[600px] rounded-full bg-indigo-100/40 blur-[120px] sm:block" />

      {profile?.role === 'super_admin' ? (
        <GlobalHeader />
      ) : profile?.role === 'satker_head' ? (
        <Suspense fallback={null}>
          <SatkerPekaryaNavBar />
        </Suspense>
      ) : null}

      <div className="relative z-10 mx-auto w-full max-w-[1600px] space-y-5 px-3 py-4 sm:space-y-6 sm:p-6 lg:p-8">
        {isRepairer && (
          <header className="sticky top-0 z-30 -mx-3 -mt-4 border-b border-slate-100 bg-white/90 shadow-sm backdrop-blur-xl sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8">
            <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-3 py-3.5 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-2">
                <Link href={employeeHomeHref}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                    title="Kembali ke Laporan Kegiatan"
                    aria-label="Kembali ke Laporan Kegiatan"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                </Link>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-200/50">
                  <Wrench className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-sm font-bold leading-tight text-slate-900">
                    Perbaikan Fasilitas
                  </h1>
                  <p className="truncate text-[11px] font-medium text-slate-400">
                    {profile?.displayName || profile?.email || 'Karyawan'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <EmployeeNavigationMenu />
                <Button
                  type="button"
                  onClick={() => void logout()}
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl border border-slate-150/40 bg-white text-slate-400 shadow-sm hover:text-rose-500"
                  title="Keluar"
                  aria-label="Keluar"
                >
                  <LogOut className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>
          </header>
        )}

        {isRepairer ? (
          <p className="max-w-3xl text-xs leading-relaxed text-slate-500 sm:text-sm">
            Perbaiki laporan fasilitas yang rusak, kotor, atau tidak terawat. Setelah selesai, simpan foto sebagai bukti perbaikan.
          </p>
        ) : (
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 shadow-inner sm:h-11 sm:w-11 sm:rounded-2xl">
              <Wrench className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl lg:text-3xl">
                Review Kondisi Fasilitas
              </h1>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500 sm:text-sm">
                Tinjau laporan fasilitas yang rusak, kotor, tidak terawat, atau membutuhkan perbaikan dari pegawai.
              </p>
            </div>
          </div>
        )}

        {isReviewer && (
          <div className="hidden lg:block">
            <UraianNavToggles />
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">
            {isRepairer ? 'Laporan yang Perlu Diperbaiki' : 'Ringkasan Laporan'}
          </h2>
          <span className="text-[11px] font-semibold text-slate-400">
            {filteredReports.length} ditampilkan
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <button
            type="button"
            onClick={() => setStatusFilter(effectiveStatusFilter === 'pending' ? 'all' : 'pending')}
            className={`min-h-20 rounded-2xl p-3 text-center shadow-sm transition-all sm:p-4 ${
              effectiveStatusFilter === 'pending'
                ? 'bg-amber-50 ring-2 ring-amber-400 shadow-amber-100'
                : 'bg-white hover:bg-amber-50/40 hover:ring-1 hover:ring-amber-200'
            }`}
          >
            <div className="text-xl font-extrabold text-amber-500 sm:text-2xl">{counts.pending ?? 0}</div>
            <div className={`mt-0.5 text-[11px] font-semibold ${effectiveStatusFilter === 'pending' ? 'text-amber-600' : 'text-slate-400'}`}>
              {FACILITY_REPORT_STATUS_LABELS.pending}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(effectiveStatusFilter === 'resolved' ? 'all' : 'resolved')}
            className={`min-h-20 rounded-2xl p-3 text-center shadow-sm transition-all sm:p-4 ${
              effectiveStatusFilter === 'resolved'
                ? 'bg-emerald-50 ring-2 ring-emerald-400 shadow-emerald-100'
                : 'bg-white hover:bg-emerald-50/40 hover:ring-1 hover:ring-emerald-200'
            }`}
          >
            <div className="text-xl font-extrabold text-emerald-500 sm:text-2xl">{counts.resolved ?? 0}</div>
            <div className={`mt-0.5 text-[11px] font-semibold ${effectiveStatusFilter === 'resolved' ? 'text-emerald-600' : 'text-slate-400'}`}>
              {FACILITY_REPORT_STATUS_LABELS.resolved}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(effectiveStatusFilter === 'declined' ? 'all' : 'declined')}
            className={`min-h-20 rounded-2xl p-3 text-center shadow-sm transition-all sm:p-4 ${
              effectiveStatusFilter === 'declined'
                ? 'bg-rose-50 ring-2 ring-rose-400 shadow-rose-100'
                : 'bg-white hover:bg-rose-50/40 hover:ring-1 hover:ring-rose-200'
            }`}
          >
            <div className="text-xl font-extrabold text-rose-500 sm:text-2xl">{counts.declined ?? 0}</div>
            <div className={`mt-0.5 text-[11px] font-semibold ${effectiveStatusFilter === 'declined' ? 'text-rose-600' : 'text-slate-400'}`}>
              {FACILITY_REPORT_STATUS_LABELS.declined}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`min-h-20 rounded-2xl p-3 text-center shadow-sm transition-all sm:p-4 ${
              effectiveStatusFilter === 'all'
                ? 'bg-slate-100 ring-2 ring-slate-400'
                : 'bg-white hover:bg-slate-50 hover:ring-1 hover:ring-slate-200'
            }`}
          >
            <div className="text-xl font-extrabold text-slate-700 sm:text-2xl">{counts.all ?? 0}</div>
            <div className={`mt-0.5 text-[11px] font-semibold ${effectiveStatusFilter === 'all' ? 'text-slate-600' : 'text-slate-400'}`}>
              Total Laporan
            </div>
          </button>
        </div>

        <Card className="overflow-hidden rounded-2xl border-slate-200/80 bg-white p-0 shadow-sm">
          {loading ? (
            <div className="p-3 sm:p-4">
              <FacilityReportRowsSkeleton count={3} />
            </div>
          ) : filteredReports.length === 0 ? (
            <FacilityReportEmptyState />
          ) : (
            <>
              <div className="space-y-3 p-3 md:hidden">
                {filteredReports.map((report) => (
                  <FacilityReportMobileCard
                    key={report.id}
                    report={report}
                    isExpanded={expandedId === report.id}
                    isReviewer={isReviewer}
                    isRepairer={isRepairer}
                    actionLoading={actionLoading}
                    onToggle={toggleExpanded}
                    onReview={openReviewDialog}
                    onRepair={openRepairDialog}
                    onZoom={(nextReport, photo) => setZoomPhoto({ report: nextReport, photo })}
                  />
                ))}
              </div>

              <div className="hidden md:block">
                <Table className="min-w-[780px]">
                  <TableHeader>
                    <TableRow className="border-slate-100 bg-slate-50/60 hover:bg-slate-50/60">
                      <TableHead className="w-10" />
                      <TableHead className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                        Pelapor
                      </TableHead>
                      <TableHead className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                        Lokasi &amp; Kondisi
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11px] font-black uppercase tracking-wider text-slate-400">
                        Tanggal
                      </TableHead>
                      <TableHead className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                        Status
                      </TableHead>
                      <TableHead className="text-right text-[11px] font-black uppercase tracking-wider text-slate-400">
                        Tindakan
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReports.map((report) => {
                      const isExpanded = expandedId === report.id;
                      const hasActions =
                        (isReviewer && report.status === 'pending') ||
                        (isRepairer && report.status === 'pending');
                      return (
                        <React.Fragment key={report.id}>
                          <TableRow
                            className="cursor-pointer border-slate-100 hover:bg-slate-50/70"
                            onClick={() => toggleExpanded(report.id)}
                          >
                            <TableCell className="pl-4">
                              <ChevronRight
                                className={`h-4 w-4 transition-transform ${
                                  isExpanded ? 'rotate-90 text-indigo-600' : 'text-slate-400'
                                }`}
                              />
                            </TableCell>
                            <TableCell className="py-4">
                              <span className="block text-sm font-bold text-slate-800">
                                {report.employeeName || '—'}
                              </span>
                              <span className="text-[11px] font-semibold text-slate-400">
                                {report.employeeId}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-md py-4">
                              <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                                <span className="truncate">{report.place}</span>
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-slate-500">
                                {report.description}
                              </span>
                              {report.photos && report.photos.length > 0 && (
                                <Badge
                                  variant="outline"
                                  className="mt-1.5 inline-flex h-5 items-center gap-1 border-slate-200 bg-white px-2 py-0 text-[10px] font-bold text-slate-600"
                                >
                                  <ImageIcon className="h-3 w-3" />
                                  {report.photos.length > 1 ? `${report.photos.length} foto` : 'Ada foto'}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-4 text-sm font-semibold text-slate-600">
                              {formatReportDate(report.reportedDate)}
                            </TableCell>
                            <TableCell className="py-4">
                              <Badge className={`border-none text-[10px] font-bold ${facilityReportStatusTone(report.status)}`}>
                                {FACILITY_REPORT_STATUS_LABELS[report.status]}
                              </Badge>
                            </TableCell>
                            <TableCell
                              className="py-4 pr-4 text-right"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="flex justify-end gap-1.5">
                                {isReviewer && report.status === 'pending' && (
                                  <>
                                    <Button
                                      type="button"
                                      size="sm"
                                      disabled={actionLoading}
                                      onClick={() => openReviewDialog(report, 'resolved')}
                                      className="h-8 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                                    >
                                      <CheckCircle2 className="h-3 w-3" />
                                      Selesai
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      disabled={actionLoading}
                                      onClick={() => openReviewDialog(report, 'declined')}
                                      className="h-8 rounded-lg px-2.5 text-[11px] font-bold text-rose-500 hover:bg-rose-50"
                                    >
                                      <ThumbsDown className="h-3 w-3" />
                                      Tolak
                                    </Button>
                                  </>
                                )}
                                {isRepairer && report.status === 'pending' && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => openRepairDialog(report)}
                                    className="h-8 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                                  >
                                    <Camera className="h-3 w-3" />
                                    Bukti &amp; Selesai
                                  </Button>
                                )}
                                {!hasActions && (
                                  <span className="px-2 text-[11px] font-semibold text-slate-400">
                                    Buka detail
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>

                          {isExpanded && (
                            <TableRow className="border-slate-100 hover:bg-transparent">
                              <TableCell colSpan={6} className="bg-slate-50/70 p-4 sm:p-5">
                                <FacilityReportDetailsContent
                                  report={report}
                                  onZoom={(nextReport, photo) => setZoomPhoto({ report: nextReport, photo })}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </Card>
      </div>

      <Dialog open={Boolean(reviewTarget)} onOpenChange={(open) => !open && setReviewTarget(null)}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-none overflow-y-auto rounded-3xl border-none bg-white p-5 shadow-2xl sm:max-w-md sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <ClipboardCheck className="h-5 w-5 shrink-0 text-indigo-600" />
              {reviewTarget
                ? `Tandai ${FACILITY_REPORT_STATUS_LABELS[reviewTarget.nextStatus]}`
                : 'Tinjau Laporan'}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-slate-500">
              Laporan <strong>“{reviewTarget?.report.place}”</strong> oleh{' '}
              <strong>{reviewTarget?.report.employeeName}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase text-slate-500">
                {reviewTarget?.nextStatus === 'declined'
                  ? 'Alasan Penolakan (Wajib)'
                  : 'Catatan (Opsional)'}
              </Label>
              <textarea
                value={reviewNote}
                onChange={(e) =>
                  setReviewNote(e.target.value.slice(0, MAX_FACILITY_REVIEW_NOTE_LENGTH))
                }
                rows={3}
                placeholder={
                  reviewTarget?.nextStatus === 'declined'
                    ? 'Contoh: Fasilitas ini sudah dilaporkan sebelumnya.'
                    : 'Contoh: Perbaikan selesai pada Senin, 17 Agustus.'
                }
                className="min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20"
              />
              <p className="text-[10px] font-semibold text-slate-400">
                {reviewNote.length}/{MAX_FACILITY_REVIEW_NOTE_LENGTH} karakter
                {reviewTarget?.nextStatus === 'declined'
                  ? ` · minimal ${MIN_FACILITY_DECLINE_REASON_LENGTH}`
                  : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReviewTarget(null)}
              disabled={actionLoading}
              className="min-h-11 w-full rounded-xl border-slate-200 font-semibold sm:w-auto"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={submitReview}
              disabled={actionLoading}
              className="min-h-11 w-full rounded-xl bg-indigo-600 font-bold text-white hover:bg-indigo-700 sm:w-auto"
            >
              {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(repairTarget)} onOpenChange={(open) => !open && setRepairTarget(null)}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-none overflow-y-auto rounded-3xl border-none bg-white p-5 shadow-2xl sm:max-w-lg sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Camera className="h-5 w-5 shrink-0 text-emerald-600" />
              Selesaikan Laporan
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-slate-500">
              Laporan <strong>“{repairTarget?.place}”</strong>. Ambil foto setelah perbaikan selesai
              untuk menyimpan bukti pekerjaan.
            </DialogDescription>
          </DialogHeader>
          {repairTarget && (
            <FacilityReportRepairForm
              report={repairTarget}
              profile={profile}
              onCancel={() => setRepairTarget(null)}
              onMessage={setMessage}
              onCompleted={async () => {
                setRepairTarget(null);
                await loadReports();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ImageExifViewer
        imageUrl={zoomPhoto?.photo.url || ''}
        title={zoomPhoto ? `${zoomPhoto.report.place} — ${zoomPhoto.report.employeeName}` : undefined}
        showMetadata={false}
        isOpen={Boolean(zoomPhoto?.photo.url)}
        onClose={() => setZoomPhoto(null)}
      />

      <FloatingSnackbar message={message} onDismiss={() => setMessage(null)} />
    </div>
  );
}

export default function FacilityReportReviewPage() {
  return (
    <Suspense fallback={null}>
      <FacilityReportReviewContent />
    </Suspense>
  );
}
