'use client';

import React from 'react';
import type { PhotoAuditMetadata } from '@/lib/payroll/domain';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Calendar,
  MapPin,
  Smartphone,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Info,
  FileImage,
  XCircle
} from 'lucide-react';

interface ImageExifViewerProps {
  imageUrl: string;
  title?: string;
  activityDate?: string;
  isOpen: boolean;
  onClose: () => void;
  showMetadata?: boolean;
  auditMetadata?: PhotoAuditMetadata | null;
}

function formatCapturedAt(value: string | null | undefined): string {
  if (!value) return 'Tidak Tercatat';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return value;
  const [, year, month, day, hours, minutes, seconds = '00'] = match;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${Number(day)} ${monthNames[Number(month) - 1] || month} ${year}, ${hours}:${minutes}:${seconds}`;
}

export function ImageExifViewer({
  imageUrl,
  title = 'Bukti Transaksi',
  activityDate,
  isOpen,
  onClose,
  showMetadata = true,
  auditMetadata,
}: ImageExifViewerProps) {
  if (!isOpen) return null;

  const isPdf = /\.pdf(?:[?#]|$)/i.test(imageUrl);

  // Check date matching
  let dateMatchStatus: 'match' | 'mismatch' | 'unknown' = 'unknown';
  if (auditMetadata?.capturedAt && activityDate) {
    const photoYMD = auditMetadata.capturedAt.split('T')[0];
    dateMatchStatus = photoYMD === activityDate ? 'match' : 'mismatch';
  }
  const hasCoordinates = auditMetadata?.latitude !== null && auditMetadata?.latitude !== undefined &&
    auditMetadata?.longitude !== null && auditMetadata?.longitude !== undefined;
  const mapsUrl = hasCoordinates
    ? `https://www.google.com/maps?q=${auditMetadata.latitude!.toFixed(6)},${auditMetadata.longitude!.toFixed(6)}`
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`${showMetadata ? 'w-[94vw] max-w-5xl sm:max-w-5xl md:max-w-5xl' : 'w-[90vw] max-w-xl sm:max-w-xl'} bg-white rounded-3xl shadow-2xl border-none p-0 overflow-hidden max-h-[90vh] flex flex-col`}>
        <DialogHeader className="p-4 sm:p-5 border-b border-slate-100 flex flex-row items-center justify-between space-y-0 shrink-0">
          <div>
            <DialogTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <FileImage className="w-5 h-5 text-blue-600" />
              <span>{showMetadata ? `Audit Metadata & Gambar (${title})` : `Pratinjau Foto (${title})`}</span>
            </DialogTitle>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              {showMetadata
                ? 'Metadata direkam saat foto asli diunggah'
                : 'Pratinjau berkas bukti transaksi yang diunggah'}
            </p>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {showMetadata ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Left Column: Image / Document Preview */}
              <div className="space-y-3">
                <h4 className="text-xs font-black text-slate-900 tracking-wide uppercase flex items-center gap-1.5">
                  <FileImage className="w-4 h-4 text-blue-600" />
                  <span>Berkas Bukti Transaksi</span>
                </h4>
                <div className="bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center min-h-[320px] max-h-[480px] relative shadow-inner border border-slate-800 p-2">
                  {isPdf ? (
                    <iframe src={imageUrl} className="w-full h-[420px] border-none" title="Dokumen PDF" />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={imageUrl}
                      alt={title}
                      className="max-h-[450px] w-auto max-w-full object-contain mx-auto rounded-lg shadow-md"
                    />
                  )}
                </div>
              </div>

              {/* Right Column: EXIF Metadata Audit Insights */}
              <div className="space-y-4">
                <h4 className="text-xs font-black text-slate-900 tracking-wide uppercase flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Auditing Insight Metadata Foto</span>
                </h4>

                {auditMetadata ? (
                  <div className="space-y-3.5">
                    {/* Date Verification Alert Badge */}
                    {dateMatchStatus === 'match' && (
                      <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2.5 text-xs font-bold text-emerald-800 shadow-xs">
                        <ShieldCheck className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                        <span>✓ Foto diambil pada tanggal yang sesuai dengan SPJ ({activityDate})</span>
                      </div>
                    )}
                    {dateMatchStatus === 'mismatch' && (
                      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-xs font-bold text-amber-900 shadow-xs">
                        <AlertTriangle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-extrabold">⚠️ Perhatian: Tanggal Foto Berbeda dari Tanggal SPJ</p>
                          <p className="text-[11px] font-medium text-amber-800 mt-0.5">
                            Foto diambil pada <strong>{formatCapturedAt(auditMetadata.capturedAt)}</strong>, sedangkan SPJ tercatat tanggal <strong>{activityDate}</strong>.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Metadata Details Cards Stack */}
                    <div className="space-y-3 text-xs">
                      {/* Timestamp */}
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-slate-500 text-[11px]">
                          <Calendar className="w-4 h-4 text-blue-600" />
                          <span>Waktu Pengambilan Foto</span>
                        </div>
                        <p className="font-extrabold text-slate-900 text-sm">
                          {formatCapturedAt(auditMetadata.capturedAt)}
                        </p>
                      </div>

                      {/* Device Info */}
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-slate-500 text-[11px]">
                          <Smartphone className="w-4 h-4 text-purple-600" />
                          <span>Perangkat Kamera</span>
                        </div>
                        <p className="font-extrabold text-slate-900 text-sm">
                          {auditMetadata.deviceName || 'Perangkat Tidak Dikenal'}
                        </p>
                      </div>

                      {/* GPS Coordinates */}
                      {hasCoordinates ? (
                        <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-2xl space-y-1 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-1.5 font-bold text-blue-700 text-[11px]">
                              <MapPin className="w-4 h-4 text-blue-600" />
                              <span>Lokasi Koordinat GPS Foto</span>
                            </div>
                            {auditMetadata.locationName && (
                              <p className="font-extrabold text-blue-950 text-sm mt-0.5">{auditMetadata.locationName}</p>
                            )}
                            {auditMetadata.locationAddress && (
                              <p className="text-[11px] font-semibold text-blue-700 mt-0.5">{auditMetadata.locationAddress}</p>
                            )}
                            <p className="font-extrabold text-blue-950 text-sm mt-0.5">
                              {auditMetadata.latitude!.toFixed(6)}, {auditMetadata.longitude!.toFixed(6)}
                            </p>
                          </div>
                          {mapsUrl && (
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors shrink-0 ml-3"
                            >
                              <span>Buka Map</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                          <div className="flex items-center gap-1.5 font-bold text-slate-500 text-[11px]">
                            <MapPin className="w-4 h-4 text-slate-400" />
                            <span>Lokasi GPS Foto</span>
                          </div>
                          <p className="text-[11px] font-semibold text-slate-500">
                          Tidak tersimpan pada metadata foto saat diunggah. Aktifkan &quot;Tag Lokasi / Save Location Info&quot; pada aplikasi Kamera HP agar lokasi GPS tersimpan otomatis saat foto diambil.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-start gap-2.5 text-xs text-slate-600 font-medium">
                    <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-extrabold text-slate-800">Metadata belum direkam untuk foto lama ini</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Metadata hanya disimpan untuk unggahan baru. Aplikasi tidak lagi membaca EXIF dari berkas lama saat audit dibuka.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center min-h-[250px] max-h-[480px] relative shadow-inner">
              {isPdf ? (
                <iframe src={imageUrl} className="w-full h-[450px] border-none" title="Dokumen PDF" />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={imageUrl}
                  alt={title}
                  className="max-h-[460px] w-auto max-w-full object-contain mx-auto"
                />
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <a
            href={imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
          >
            <span>Buka Gambar Asli Ukuran Penuh</span>
            <ExternalLink className="w-3 h-3" />
          </a>

          <Button
            type="button"
            onClick={onClose}
            variant="outline"
            className="rounded-xl font-bold text-xs h-9 px-4 border-slate-200"
          >
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
