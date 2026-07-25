'use client';

import React, { useState, useEffect } from 'react';
import { parseImageExif, ImageExifInsights } from '@/lib/exif';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Loader2,
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
}

export function ImageExifViewer({
  imageUrl,
  title = 'Bukti Transaksi',
  activityDate,
  isOpen,
  onClose,
  showMetadata = true,
}: ImageExifViewerProps) {
  const [loading, setLoading] = useState(true);
  const [exif, setExif] = useState<ImageExifInsights | null>(null);

  useEffect(() => {
    if (!isOpen || !imageUrl || !showMetadata) return;

    let isMounted = true;
    setLoading(true);
    setExif(null);

    parseImageExif(imageUrl)
      .then((res) => {
        if (isMounted) {
          setExif(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setExif({ hasExif: false });
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [imageUrl, isOpen, showMetadata]);

  if (!isOpen) return null;

  const isPdf = /\.pdf(?:[?#]|$)/i.test(imageUrl);

  // Check date matching
  let dateMatchStatus: 'match' | 'mismatch' | 'unknown' = 'unknown';
  if (exif?.isoDateString && activityDate) {
    const photoYMD = exif.isoDateString.split('T')[0];
    dateMatchStatus = photoYMD === activityDate ? 'match' : 'mismatch';
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl bg-white rounded-3xl shadow-2xl border-none p-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="p-4 sm:p-5 border-b border-slate-100 flex flex-row items-center justify-between space-y-0 shrink-0">
          <div>
            <DialogTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
              <FileImage className="w-5 h-5 text-blue-600" />
              <span>{showMetadata ? `Audit Metadata & Gambar (${title})` : `Pratinjau Foto (${title})`}</span>
            </DialogTitle>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              {showMetadata
                ? 'Metadata EXIF diekstrak langsung dari berkas asli'
                : 'Pratinjau berkas bukti transaksi yang diunggah'}
            </p>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* Main Image / Document Preview */}
          <div className="bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center min-h-[220px] max-h-[400px] relative shadow-inner">
            {isPdf ? (
              <iframe src={imageUrl} className="w-full h-[350px] border-none" title="Dokumen PDF" />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={imageUrl}
                alt={title}
                className="max-h-[380px] w-auto max-w-full object-contain mx-auto"
              />
            )}
          </div>

          {/* EXIF Metadata Audit Insights Box (Only for Auditors) */}
          {showMetadata && (
            <div className="space-y-3">
            <h4 className="text-xs font-black text-slate-900 tracking-wide uppercase flex items-center gap-1.5">
              <span>Auditing Insight Metadata (EXIF)</span>
            </h4>

            {loading ? (
              <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center gap-2 text-xs font-bold text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>Mengekstrak EXIF metadata dari gambar...</span>
              </div>
            ) : exif && exif.hasExif ? (
              <div className="space-y-3">
                {/* Date Verification Alert Badge */}
                {dateMatchStatus === 'match' && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2.5 text-xs font-bold text-emerald-800">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>✓ Foto diambil pada tanggal yang sesuai dengan SPJ ({activityDate})</span>
                  </div>
                )}
                {dateMatchStatus === 'mismatch' && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-xs font-bold text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-extrabold">⚠️ Perhatian: Tanggal Foto Berbeda dari Tanggal SPJ</p>
                      <p className="text-[11px] font-medium text-amber-800 mt-0.5">
                        Foto diambil pada <strong>{exif.formattedDate}</strong>, sedangkan SPJ tercatat tanggal <strong>{activityDate}</strong>.
                      </p>
                    </div>
                  </div>
                )}

                {/* Metadata Details Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Timestamp */}
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-slate-500 text-[11px]">
                      <Calendar className="w-3.5 h-3.5 text-blue-600" />
                      <span>Waktu Pengambilan Foto</span>
                    </div>
                    <p className="font-extrabold text-slate-900">
                      {exif.formattedDate || 'Tidak Tercatat'}
                    </p>
                  </div>

                  {/* Device Info */}
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-slate-500 text-[11px]">
                      <Smartphone className="w-3.5 h-3.5 text-purple-600" />
                      <span>Perangkat Kamera</span>
                    </div>
                    <p className="font-extrabold text-slate-900 truncate">
                      {exif.make || exif.model ? `${exif.make || ''} ${exif.model || ''}`.trim() : 'Perangkat Tidak Dikenal'}
                    </p>
                  </div>

                  {/* GPS Coordinates */}
                  {exif.latitude !== undefined && exif.longitude !== undefined && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl space-y-1 sm:col-span-2 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-1.5 font-bold text-blue-700 text-[11px]">
                          <MapPin className="w-3.5 h-3.5 text-blue-600" />
                          <span>Lokasi Koordinat GPS Foto</span>
                        </div>
                        <p className="font-extrabold text-blue-950 mt-0.5">
                          {exif.latitude.toFixed(6)}, {exif.longitude.toFixed(6)}
                        </p>
                      </div>
                      {exif.googleMapsUrl && (
                        <a
                          href={exif.googleMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs flex items-center gap-1 shadow-sm transition-colors"
                        >
                          <span>Buka Map</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-start gap-2.5 text-xs text-slate-600 font-medium">
                <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-extrabold text-slate-800">Tidak ada metadata EXIF dalam berkas ini</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Hal ini wajar jika gambar dikirim via WhatsApp/kompresi pesan, hasil screenshot, atau fitur privasi lokasi perangkat dinonaktifkan.
                  </p>
                </div>
              </div>
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
