"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Search,
  ThumbsDown,
  Wrench,
} from 'lucide-react';
import GlobalHeader from '@/components/GlobalHeader';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/AuthContext';
import {
  FACILITY_REPORT_STATUS_LABELS,
  FACILITY_REPORT_STATUSES,
  facilityReportStatusTone,
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
  status: FacilityReportStatus;
  reportedDate: string;
  reviewNote?: string | null;
  reviewedByName?: string | null;
}

type StatusFilter = 'all' | FacilityReportStatus;

function formatReportDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '—';
  const [year, month, day] = value.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${Number(day)} ${months[Number(month) - 1] || month} ${year}`;
}

function FacilityReportReviewContent() {
  const { profile: rawProfile, activeProfile } = useAuth();
  const profile = activeProfile || rawProfile;

  const [reports, setReports] = useState<FacilityReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [search, setSearch] = useState('');
  const [zoomPhoto, setZoomPhoto] = useState<{ report: FacilityReportRow; photo: PhotoEvidence } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [reviewTarget, setReviewTarget] = useState<
    { report: FacilityReportRow; nextStatus: FacilityReportStatus } | null
  >(null);
  const [reviewNote, setReviewNote] = useState('');

  const loadReports = useCallback(async () => {
    try {
      const result = await authenticatedJson<{ reports: FacilityReportRow[] }>(
        '/api/facility-reports',
      );
      setReports(
        (result.reports || []).map((report) => ({
          ...report,
          status: isFacilityReportStatus(report.status) ? report.status : 'pending',
        })),
      );
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
    void loadReports();
  }, [loadReports]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredReports = useMemo(() => {
    const term = search.trim().toLowerCase();
    return reports.filter((report) => {
      if (statusFilter !== 'all' && report.status !== statusFilter) return false;
      if (!term) return true;
      return (
        report.place.toLowerCase().includes(term) ||
        report.description.toLowerCase().includes(term) ||
        report.employeeName.toLowerCase().includes(term)
      );
    });
  }, [reports, statusFilter, search]);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans text-slate-800 relative">
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />

      {profile?.role === 'super_admin' ? (
        <GlobalHeader />
      ) : profile?.role === 'satker_head' ? (
        <Suspense fallback={null}>
          <SatkerPekaryaNavBar />
        </Suspense>
      ) : null}

      <div className="max-w-[1600px] mx-auto p-6 lg:p-8 space-y-6 relative z-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 shadow-inner">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
                Review Kondisi Fasilitas
              </h1>
              <p className="text-slate-500 text-sm">
                Tinjau laporan fasilitas yang rusak, kotor, tidak terawat, atau membutuhkan perbaikan dari pegawai Loyalis.
              </p>
            </div>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari lokasi, deskripsi, pelapor…"
              className="pl-9 rounded-xl bg-white border-slate-200 shadow-sm text-sm"
            />
          </div>
        </div>

        <UraianNavToggles />

        {/* ── Stats Cards (clickable filters) ──────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${
              statusFilter === 'pending'
                ? 'bg-amber-50 ring-2 ring-amber-400 shadow-amber-100'
                : 'bg-white hover:bg-amber-50/40 hover:ring-1 hover:ring-amber-200'
            }`}
          >
            <div className="text-2xl font-extrabold text-amber-500">{counts.pending ?? 0}</div>
            <div className={`text-[11px] font-semibold mt-0.5 ${statusFilter === 'pending' ? 'text-amber-600' : 'text-slate-400'}`}>
              {FACILITY_REPORT_STATUS_LABELS.pending}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'resolved' ? 'all' : 'resolved')}
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${
              statusFilter === 'resolved'
                ? 'bg-emerald-50 ring-2 ring-emerald-400 shadow-emerald-100'
                : 'bg-white hover:bg-emerald-50/40 hover:ring-1 hover:ring-emerald-200'
            }`}
          >
            <div className="text-2xl font-extrabold text-emerald-500">{counts.resolved ?? 0}</div>
            <div className={`text-[11px] font-semibold mt-0.5 ${statusFilter === 'resolved' ? 'text-emerald-600' : 'text-slate-400'}`}>
              {FACILITY_REPORT_STATUS_LABELS.resolved}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'declined' ? 'all' : 'declined')}
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${
              statusFilter === 'declined'
                ? 'bg-rose-50 ring-2 ring-rose-400 shadow-rose-100'
                : 'bg-white hover:bg-rose-50/40 hover:ring-1 hover:ring-rose-200'
            }`}
          >
            <div className="text-2xl font-extrabold text-rose-500">{counts.declined ?? 0}</div>
            <div className={`text-[11px] font-semibold mt-0.5 ${statusFilter === 'declined' ? 'text-rose-600' : 'text-slate-400'}`}>
              {FACILITY_REPORT_STATUS_LABELS.declined}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`rounded-2xl shadow-sm text-center p-4 transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-slate-100 ring-2 ring-slate-400'
                : 'bg-white hover:bg-slate-50 hover:ring-1 hover:ring-slate-200'
            }`}
          >
            <div className="text-2xl font-extrabold text-slate-700">{counts.all ?? 0}</div>
            <div className={`text-[11px] font-semibold mt-0.5 ${statusFilter === 'all' ? 'text-slate-600' : 'text-slate-400'}`}>
              Total Laporan
            </div>
          </button>
        </div>

        <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-100 hover:bg-transparent">
                  <TableHead className="w-10" />
                  <TableHead className="text-[11px] font-black uppercase text-slate-400 tracking-wider">
                    Pelapor
                  </TableHead>
                  <TableHead className="text-[11px] font-black uppercase text-slate-400 tracking-wider">
                    Lokasi &amp; Kondisi
                  </TableHead>
                  <TableHead className="text-[11px] font-black uppercase text-slate-400 tracking-wider whitespace-nowrap">
                    Tanggal
                  </TableHead>
                  <TableHead className="text-[11px] font-black uppercase text-slate-400 tracking-wider">
                    Status
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-black uppercase text-slate-400 tracking-wider">
                    Tindakan
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-14 text-center">
                      <Loader2 className="w-6 h-6 text-indigo-500 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : filteredReports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-14 text-center">
                      <Wrench className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-bold text-slate-500">Tidak ada laporan</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Belum ada laporan kondisi fasilitas pada filter ini.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredReports.map((report) => {
                    const isExpanded = expandedIds.has(report.id);
                    return (
                      <React.Fragment key={report.id}>
                        <TableRow
                          className="border-slate-100 cursor-pointer hover:bg-slate-50/70"
                          onClick={() => toggleExpanded(report.id)}
                        >
                          <TableCell className="pl-4">
                            <ChevronRight
                              className={`w-4 h-4 transition-transform ${
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
                          <TableCell className="py-4 max-w-md">
                            <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                              <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <span className="truncate">{report.place}</span>
                            </span>
                            <span className="block text-xs text-slate-500 truncate mt-0.5">
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
                          <TableCell className="py-4 text-sm font-semibold text-slate-600 whitespace-nowrap">
                            {formatReportDate(report.reportedDate)}
                          </TableCell>
                          <TableCell className="py-4">
                            <Badge
                              className={`border-none font-bold text-[10px] ${facilityReportStatusTone(report.status)}`}
                            >
                              {FACILITY_REPORT_STATUS_LABELS[report.status]}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className="py-4 text-right pr-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex justify-end gap-1.5">
                              {report.status === 'pending' && (
                                <Button
                                  size="sm"
                                  disabled={actionLoading}
                                  onClick={() => openReviewDialog(report, 'resolved')}
                                  className="h-7 px-2.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-[11px] border border-emerald-200 cursor-pointer"
                                >
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Selesai
                                </Button>
                              )}
                              {report.status === 'pending' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={actionLoading}
                                  onClick={() => openReviewDialog(report, 'declined')}
                                  className="h-7 px-2.5 rounded-lg text-rose-500 hover:bg-rose-50 font-bold text-[11px] cursor-pointer"
                                >
                                  <ThumbsDown className="w-3 h-3 mr-1" />
                                  Tolak
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow className="border-slate-100 hover:bg-transparent">
                            <TableCell colSpan={6} className="bg-slate-50/70 p-4 sm:p-5">
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-3">
                                  <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                      Lokasi Fasilitas
                                    </p>
                                    <p className="text-sm font-bold text-slate-800 mt-0.5">
                                      {report.place}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                      Deskripsi Masalah atau Kondisi
                                    </p>
                                    <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap leading-relaxed">
                                      {report.description}
                                    </p>
                                  </div>
                                  {report.reviewNote && (
                                    <div className="rounded-xl bg-white border border-slate-200 p-3">
                                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                        Catatan Tinjauan
                                        {report.reviewedByName ? ` · ${report.reviewedByName}` : ''}
                                      </p>
                                      <p className="text-xs font-semibold text-slate-700 mt-0.5 whitespace-pre-wrap">
                                        {report.reviewNote}
                                      </p>
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                                    Bukti Foto {report.photos && report.photos.length > 0 ? `(${report.photos.length})` : ''}
                                  </p>
                                  {report.photos && report.photos.length > 0 ? (
                                    <div className="grid grid-cols-2 gap-2">
                                      {report.photos.map((photo, index) => (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          key={photo.url}
                                          src={photo.url}
                                          alt={`Kondisi fasilitas di ${report.place} — foto ${index + 1}`}
                                          onClick={() => setZoomPhoto({ report, photo })}
                                          className="aspect-square w-full object-cover rounded-xl border border-slate-200 cursor-zoom-in bg-white"
                                        />
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="w-full aspect-[4/3] max-h-72 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl font-bold text-[11px] flex flex-col items-center justify-center gap-1 p-3 text-center">
                                      <ImageIcon className="w-5 h-5 text-amber-600" />
                                      <span>Tanpa Bukti Foto</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      <Dialog open={Boolean(reviewTarget)} onOpenChange={(open) => !open && setReviewTarget(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl border-none shadow-2xl bg-white p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-900">
              <ClipboardCheck className="w-5 h-5 text-indigo-600" />
              {reviewTarget
                ? `Tandai ${FACILITY_REPORT_STATUS_LABELS[reviewTarget.nextStatus]}`
                : 'Tinjau Laporan'}
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Laporan <strong>“{reviewTarget?.report.place}”</strong> oleh{' '}
              <strong>{reviewTarget?.report.employeeName}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-500 uppercase">
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
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 resize-y"
              />
              <p className="text-[10px] font-semibold text-slate-400">
                {reviewNote.length}/{MAX_FACILITY_REVIEW_NOTE_LENGTH} karakter
                {reviewTarget?.nextStatus === 'declined'
                  ? ` · minimal ${MIN_FACILITY_DECLINE_REASON_LENGTH}`
                  : ''}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setReviewTarget(null)}
              disabled={actionLoading}
              className="rounded-xl border-slate-200 font-semibold cursor-pointer"
            >
              Batal
            </Button>
            <Button
              onClick={submitReview}
              disabled={actionLoading}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer flex items-center gap-1.5"
            >
              {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              Simpan
            </Button>
          </div>
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
