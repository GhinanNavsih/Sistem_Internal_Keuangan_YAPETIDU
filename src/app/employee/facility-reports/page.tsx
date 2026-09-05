"use client";

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Plus,
  Send,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import { ImageExifViewer } from '@/components/ImageExifViewer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import {
  DEFAULT_FACILITY_AREA,
  FACILITY_AREA_OTHER,
  FACILITY_AREAS,
  FACILITY_REPORT_STATUS_LABELS,
  facilityReportStatusTone,
  isFacilityArea,
  isFacilityReportStatus,
  MAX_FACILITY_DESCRIPTION_LENGTH,
  MAX_FACILITY_PHOTO_BYTES,
  MAX_FACILITY_PHOTOS,
  MAX_FACILITY_PLACE_LENGTH,
  MIN_FACILITY_DESCRIPTION_LENGTH,
  type FacilityArea,
  type FacilityReportStatus,
} from '@/lib/facilityReports';
import { authenticatedJson } from '@/lib/payroll/client';
import { prepareProofImageWithLimit, type PhotoEvidence } from '@/lib/photoEvidence';
import { uploadProofFile } from '@/lib/uploads';

interface FacilityReportRow {
  id: string;
  employeeId: string;
  employeeName: string;
  place: string;
  description: string;
  photos?: PhotoEvidence[];
  status: FacilityReportStatus;
  reportedDate: string;
  reportedAtMillis?: number | null;
  reviewNote?: string | null;
  reviewedByName?: string | null;
}

function formatReportDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '—';
  const [year, month, day] = value.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${Number(day)} ${months[Number(month) - 1] || month} ${year}`;
}

export default function FacilityReportsPage() {
  const { profile: rawProfile, activeProfile } = useAuth();
  const profile = activeProfile || rawProfile;

  const [reports, setReports] = useState<FacilityReportRow[]>([]);
  const [expandedReportIds, setExpandedReportIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [area, setArea] = useState<FacilityArea>(DEFAULT_FACILITY_AREA);
  const [customPlace, setCustomPlace] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<PhotoEvidence[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [zoomPhoto, setZoomPhoto] = useState<{ report: FacilityReportRow; photo: PhotoEvidence } | null>(null);

  const loadReports = useCallback(async () => {
    try {
      const result = await authenticatedJson<{ reports: FacilityReportRow[] }>(
        '/api/facility-reports',
      );
      setReports(
        (result.reports || [])
          .map((report) => ({
            ...report,
            status: isFacilityReportStatus(report.status) ? report.status : 'pending',
          }))
          .sort((a, b) => {
            const timestampA = Number(a.reportedAtMillis || 0);
            const timestampB = Number(b.reportedAtMillis || 0);
            if (timestampA !== timestampB) return timestampB - timestampA;
            return String(b.reportedDate || '').localeCompare(String(a.reportedDate || ''));
          }),
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

  const resetForm = () => {
    setArea(DEFAULT_FACILITY_AREA);
    setCustomPlace('');
    setDescription('');
    setPhotos([]);
  };

  const handlePhotos = async (files: File[]) => {
    if (!profile?.linkedEmployeeId) {
      setMessage({ type: 'error', text: 'Akun Anda belum terhubung ke data Pegawai.' });
      return;
    }
    const remainingSlots = MAX_FACILITY_PHOTOS - photos.length;
    if (remainingSlots <= 0) {
      setMessage({ type: 'error', text: `Maksimal ${MAX_FACILITY_PHOTOS} foto per laporan.` });
      return;
    }
    const toUpload = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      setMessage({
        type: 'error',
        text: `Hanya ${remainingSlots} foto lagi yang dapat ditambahkan (maks ${MAX_FACILITY_PHOTOS}).`,
      });
    }

    setUploadingPhoto(true);
    const uploaded: PhotoEvidence[] = [];
    try {
      // Uploaded one at a time rather than in parallel — each photo is already
      // compressed client-side, so this keeps the loading state meaningful and
      // avoids firing a burst of concurrent uploads on a mobile connection.
      for (const file of toUpload) {
        const prepared = await prepareProofImageWithLimit(file, MAX_FACILITY_PHOTO_BYTES);
        const url = await uploadProofFile('/api/uploads/facility-reports', prepared.file, {
          employeeId: profile.linkedEmployeeId,
        });
        uploaded.push({ url, auditMetadata: prepared.auditMetadata });
      }
      setPhotos((prev) => [...prev, ...uploaded]);
      setMessage({
        type: 'success',
        text: uploaded.length > 1 ? `${uploaded.length} foto berhasil diunggah.` : 'Foto berhasil diunggah.',
      });
    } catch (error) {
      if (uploaded.length > 0) setPhotos((prev) => [...prev, ...uploaded]);
      console.error('Error uploading facility photo:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal mengunggah foto.',
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = (url: string) => {
    setPhotos((prev) => prev.filter((photo) => photo.url !== url));
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const trimmedPlace = area === FACILITY_AREA_OTHER ? customPlace.trim() : area;
    const trimmedDescription = description.trim();
    if (!trimmedPlace) {
      setMessage({ type: 'error', text: 'Lokasi fasilitas wajib diisi.' });
      return;
    }
    if (trimmedDescription.length < MIN_FACILITY_DESCRIPTION_LENGTH) {
      setMessage({
        type: 'error',
        text: `Deskripsi masalah atau kondisi minimal ${MIN_FACILITY_DESCRIPTION_LENGTH} karakter.`,
      });
      return;
    }

    setSubmitting(true);
    try {
      await authenticatedJson('/api/facility-reports', {
        method: 'POST',
        body: JSON.stringify({
          action: 'submit',
          place: trimmedPlace,
          description: trimmedDescription,
          photos,
        }),
      });
      setMessage({ type: 'success', text: 'Laporan kondisi fasilitas berhasil dikirim ke Kepala Biro Umum.' });
      resetForm();
      setShowForm(false);
      await loadReports();
    } catch (error) {
      console.error('Error submitting facility report:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal mengirim laporan.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (report: FacilityReportRow) => {
    if (withdrawingId) return;
    if (!confirm(`Tarik kembali laporan "${report.place}"?`)) return;
    setWithdrawingId(report.id);
    try {
      await authenticatedJson('/api/facility-reports', {
        method: 'POST',
        body: JSON.stringify({ action: 'withdraw', reportId: report.id }),
      });
      setMessage({ type: 'success', text: 'Laporan berhasil ditarik kembali.' });
      await loadReports();
    } catch (error) {
      console.error('Error withdrawing facility report:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal menarik laporan.',
      });
    } finally {
      setWithdrawingId(null);
    }
  };

  const toggleReport = (reportId: string) => {
    setExpandedReportIds((current) => {
      const next = new Set(current);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/70 to-slate-100 font-sans text-slate-800">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Link href="/employee/payslip">
            <Button
              variant="outline"
              className="rounded-xl h-9 px-3 border-slate-200 bg-white shadow-sm cursor-pointer flex items-center gap-1.5 text-slate-600 font-bold text-xs"
            >
              <ChevronLeft className="w-4 h-4" />
              Kembali
            </Button>
          </Link>
          {!showForm && (
            <Button
              onClick={() => setShowForm(true)}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-3.5 shadow-sm cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Laporkan Kondisi
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shadow-inner shrink-0">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Lapor Kondisi Fasilitas
            </h1>
            <p className="text-slate-500 text-xs sm:text-sm">
              Laporkan fasilitas kampus yang rusak, kotor, tidak terawat, atau membutuhkan perbaikan agar segera ditangani Kepala Biro Umum.
            </p>
          </div>
        </div>

        {showForm && (
          <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">Laporan Baru</h2>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                title="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-slate-500 uppercase">
                Lokasi Fasilitas
              </Label>
              <Select
                value={area}
                onValueChange={(value) => {
                  if (isFacilityArea(value)) setArea(value);
                }}
              >
                <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white text-sm font-semibold">
                  <SelectValue>{area}</SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-white rounded-xl border border-slate-100 shadow-xl">
                  {FACILITY_AREAS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {area === FACILITY_AREA_OTHER && (
                <>
                  <Input
                    value={customPlace}
                    onChange={(e) => setCustomPlace(e.target.value.slice(0, MAX_FACILITY_PLACE_LENGTH))}
                    placeholder="Sebutkan lokasinya, contoh: Parkiran belakang Gedung B"
                    className="rounded-xl border-slate-200 text-sm"
                    autoFocus
                  />
                  <p className="text-[10px] font-semibold text-slate-400">
                    {customPlace.length}/{MAX_FACILITY_PLACE_LENGTH} karakter
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-slate-500 uppercase">
                Deskripsi Masalah atau Kondisi
              </Label>
              <textarea
                value={description}
                onChange={(e) =>
                  setDescription(e.target.value.slice(0, MAX_FACILITY_DESCRIPTION_LENGTH))
                }
                rows={4}
                placeholder="Jelaskan masalah atau kondisinya sedetail mungkin, misalnya: keran wastafel patah, lantai kotor, atau lampu lorong mati."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 resize-y"
              />
              <p className="text-[10px] font-semibold text-slate-400">
                Minimal {MIN_FACILITY_DESCRIPTION_LENGTH} karakter · {description.length}/
                {MAX_FACILITY_DESCRIPTION_LENGTH}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-bold text-slate-500 uppercase">
                  Foto (Opsional)
                </Label>
                <span className="text-[10px] font-bold text-slate-400">
                  {photos.length}/{MAX_FACILITY_PHOTOS} foto
                </span>
              </div>

              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo, index) => (
                    <div
                      key={photo.url}
                      className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt={`Bukti kondisi fasilitas ${index + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(photo.url)}
                        className="absolute top-1.5 right-1.5 rounded-lg bg-white/95 p-1 text-rose-600 shadow-sm hover:bg-white cursor-pointer"
                        title="Hapus foto"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {photos.length < MAX_FACILITY_PHOTOS && (
                <label className="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 py-6 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors">
                  {uploadingPhoto ? (
                    <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-slate-400" />
                  )}
                  <span className="text-[11px] font-bold text-slate-500">
                    {uploadingPhoto
                      ? 'Mengunggah…'
                      : photos.length === 0
                        ? 'Ketuk untuk menambah foto'
                        : 'Tambah foto lagi'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    disabled={uploadingPhoto}
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      e.target.value = '';
                      if (files.length > 0) void handlePhotos(files);
                    }}
                  />
                </label>
              )}
            </div>

            <Button
              onClick={handleSubmit}
              disabled={submitting || uploadingPhoto}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm h-10 shadow-sm cursor-pointer flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {submitting ? 'Mengirim…' : 'Kirim Laporan'}
            </Button>
          </Card>
        )}

        <div className="space-y-2.5">
          <h2 className="text-xs font-black text-slate-500 uppercase tracking-wider">
            Riwayat Laporan Semua Pegawai
          </h2>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <Card className="rounded-2xl border-dashed border-slate-200 bg-white/70 p-8 text-center">
              <Wrench className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-500">Belum ada laporan</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Semua laporan kondisi fasilitas yang dikirim pegawai akan tampil di sini.
              </p>
            </Card>
          ) : (
            reports.map((report) => (
              <Card
                key={report.id}
                className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-4 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggleReport(report.id)}
                    aria-expanded={expandedReportIds.has(report.id)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                        <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span className="truncate">{report.place}</span>
                      </div>
                      <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                        {formatReportDate(report.reportedDate)} · {report.employeeName || 'Pegawai'}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${facilityReportStatusTone(report.status)}`}
                    >
                      {FACILITY_REPORT_STATUS_LABELS[report.status]}
                    </span>
                    <ChevronDown
                      className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                        expandedReportIds.has(report.id) ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {report.status === 'pending' &&
                      report.employeeId === profile?.linkedEmployeeId && (
                      <button
                        type="button"
                        onClick={() => void handleWithdraw(report)}
                        disabled={withdrawingId === report.id}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50 cursor-pointer disabled:opacity-40"
                        title="Tarik kembali laporan"
                      >
                        {withdrawingId === report.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {expandedReportIds.has(report.id) && (
                  <>
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                      {report.description}
                    </p>

                    {report.photos && report.photos.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {report.photos.map((photo, index) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={photo.url}
                            src={photo.url}
                            alt={`Bukti kondisi fasilitas ${index + 1}`}
                            onClick={() => setZoomPhoto({ report, photo })}
                            className="aspect-square w-full object-cover rounded-xl border border-slate-200 cursor-zoom-in"
                          />
                        ))}
                      </div>
                    )}

                    {report.reviewNote && (
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                          Catatan Kepala Biro Umum
                          {report.reviewedByName ? ` · ${report.reviewedByName}` : ''}
                        </p>
                        <p className="text-xs font-semibold text-slate-700 mt-0.5 whitespace-pre-wrap">
                          {report.reviewNote}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </Card>
            ))
          )}
        </div>

      </div>

      <ImageExifViewer
        imageUrl={zoomPhoto?.photo.url || ''}
        title={zoomPhoto?.report.place}
        activityDate={zoomPhoto?.report.reportedDate}
        auditMetadata={zoomPhoto?.photo.auditMetadata}
        isOpen={Boolean(zoomPhoto?.photo.url)}
        onClose={() => setZoomPhoto(null)}
      />

      <FloatingSnackbar message={message} onDismiss={() => setMessage(null)} />
    </div>
  );
}
