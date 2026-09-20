"use client";

import { useState } from 'react';
import {
  Camera,
  Loader2,
  Send,
  Trash2,
} from 'lucide-react';
import { useAuth, type UserProfile } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { MAX_FACILITY_PHOTO_BYTES, MAX_FACILITY_PHOTOS } from '@/lib/facilityReports';
import { authenticatedJson } from '@/lib/payroll/client';
import { prepareProofImageWithLimit, type PhotoEvidence } from '@/lib/photoEvidence';
import { uploadProofFile } from '@/lib/uploads';

interface FacilityReportRepairFormProps {
  report: {
    id: string;
    place: string;
    status?: string;
    resolutionPhotos?: PhotoEvidence[];
  };
  profile: UserProfile | null;
  onCancel: () => void;
  onMessage: (message: { type: 'success' | 'error'; text: string }) => void;
  onCompleted: () => void | Promise<void>;
}

export default function FacilityReportRepairForm({
  report,
  profile,
  onCancel,
  onMessage,
  onCompleted,
}: FacilityReportRepairFormProps) {
  const { profile: rawProfile, activeProfile } = useAuth();
  const currentProfile = profile || activeProfile || rawProfile;
  const [photos, setPhotos] = useState<PhotoEvidence[]>(
    Array.isArray(report.resolutionPhotos) ? report.resolutionPhotos : [],
  );
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handlePhotos = async (files: File[]) => {
    const uploaderId = currentProfile?.linkedEmployeeId || currentProfile?.uid;
    if (!uploaderId) {
      onMessage({ type: 'error', text: 'Sesi akun Anda tidak valid.' });
      return;
    }

    const remainingSlots = MAX_FACILITY_PHOTOS - photos.length;
    if (remainingSlots <= 0) {
      onMessage({ type: 'error', text: `Maksimal ${MAX_FACILITY_PHOTOS} foto per bukti perbaikan.` });
      return;
    }

    const toUpload = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      onMessage({
        type: 'error',
        text: `Hanya ${remainingSlots} foto lagi yang dapat ditambahkan (maks ${MAX_FACILITY_PHOTOS}).`,
      });
    }

    setUploadingPhoto(true);
    const uploaded: PhotoEvidence[] = [];
    try {
      for (const file of toUpload) {
        const prepared = await prepareProofImageWithLimit(file, MAX_FACILITY_PHOTO_BYTES);
        const url = await uploadProofFile('/api/uploads/facility-report-proofs', prepared.file, {
          employeeId: uploaderId,
        });
        uploaded.push({ url, auditMetadata: prepared.auditMetadata });
      }
      setPhotos((previous) => [...previous, ...uploaded]);
      onMessage({
        type: 'success',
        text: uploaded.length > 1
          ? `${uploaded.length} foto bukti perbaikan berhasil diunggah.`
          : 'Foto bukti perbaikan berhasil diunggah.',
      });
    } catch (error) {
      if (uploaded.length > 0) setPhotos((previous) => [...previous, ...uploaded]);
      console.error('Error uploading facility repair proof:', error);
      onMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal mengunggah foto bukti perbaikan.',
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleComplete = async () => {
    if (submitting || uploadingPhoto) return;
    setSubmitting(true);
    try {
      await authenticatedJson('/api/facility-reports', {
        method: 'POST',
        body: JSON.stringify({
          action: 'repair',
          reportId: report.id,
          resolutionPhotos: photos,
        }),
      });
      onMessage({
        type: 'success',
        text: report.status === 'resolved'
          ? `Bukti perbaikan di ${report.place} berhasil diperbarui.`
          : `Laporan di ${report.place} berhasil ditandai selesai.`,
      });
      await onCompleted();
    } catch (error) {
      console.error('Error completing facility repair:', error);
      onMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal menyimpan hasil perbaikan.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm">
          <Camera className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-emerald-900">Bukti Perbaikan</p>
          <p className="mt-0.5 text-xs leading-relaxed text-emerald-800/80">
            Ambil foto kondisi fasilitas setelah diperbaiki agar hasil pekerjaan tercatat pada laporan ini.
          </p>
        </div>
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
                alt={`Foto bukti perbaikan ${index + 1}`}
                loading="eager"
                decoding="async"
                fetchPriority={index === 0 ? 'high' : 'auto'}
                className="h-full w-full object-cover"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setPhotos((previous) => previous.filter((item) => item.url !== photo.url))}
                className="absolute right-1.5 top-1.5 rounded-lg bg-white/95 p-1 text-rose-600 shadow-sm hover:bg-white"
                title="Hapus foto"
                aria-label={`Hapus foto bukti perbaikan ${index + 1}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {photos.length < MAX_FACILITY_PHOTOS && (
        <div className="relative flex min-h-28 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 px-4 py-6 text-center text-slate-500 transition-colors hover:border-emerald-300 hover:bg-emerald-50/60">
          {/* The full card is tappable so Android can offer camera and gallery sources. */}
          <input
            type="file"
            accept=".jpeg,.jpg,.png,.pdf,image/jpeg,image/png,application/pdf"
            capture="environment"
            aria-label="Ambil foto bukti perbaikan"
            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            disabled={uploadingPhoto}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (!file.type.startsWith('image/')) {
                onMessage({ type: 'error', text: 'Berkas bukti perbaikan harus berupa foto.' });
                return;
              }
              void handlePhotos([file]);
            }}
          />
          {uploadingPhoto ? (
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
          ) : (
            <Camera className="h-6 w-6 text-emerald-600" />
          )}
          <span className="text-xs font-bold text-slate-600">
            {uploadingPhoto
              ? 'Mengunggah foto…'
              : photos.length === 0
                ? 'Ketuk untuk mengambil atau memilih foto'
                : 'Tambah foto bukti lainnya'}
          </span>
          <span className="text-[10px] font-semibold text-slate-400">
            {photos.length}/{MAX_FACILITY_PHOTOS} foto · opsional
          </span>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting || uploadingPhoto}
          className="min-h-11 w-full rounded-xl border-slate-200 font-semibold sm:w-auto"
        >
          Batal
        </Button>
        <Button
          type="button"
          onClick={() => void handleComplete()}
          disabled={submitting || uploadingPhoto}
          className="min-h-11 w-full rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-700 sm:w-auto"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting
            ? 'Menyimpan…'
            : report.status === 'resolved'
              ? 'Simpan Bukti Foto'
              : photos.length > 0
                ? 'Simpan Bukti & Tandai Selesai'
                : 'Tandai Selesai'}
        </Button>
      </div>
    </div>
  );
}
