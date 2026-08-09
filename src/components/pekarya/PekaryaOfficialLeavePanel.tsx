"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  Eye,
  FileClock,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import {
  prepareProofImage,
  type PhotoAuditMetadata,
  type PhotoEvidence,
} from '@/lib/photoEvidence';
import { ATTENDANCE_PAYROLL_START_PERIOD } from '@/lib/payroll/attendance';
import {
  PEKARYA_OFFICIAL_LEAVE_SCAN_IN,
  PEKARYA_OFFICIAL_LEAVE_SCAN_OUT,
  pekaryaAttendanceReportType,
  type PekaryaAttendanceReportType,
  type PekaryaOfficialLeaveRequest,
} from '@/lib/payroll/pekaryaOfficialLeave';
import { pekaryaPayrollPeriodForDate } from '@/lib/payroll/pekaryaSpj';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import { ImageExifViewer } from '@/components/ImageExifViewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type OpenPeriod = {
  period: string;
  startDate: string;
  endDate: string;
};

const DEFAULT_SCAN_IN = '08:00';
const DEFAULT_SCAN_OUT = '14:00';
const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function statusLabel(status: PekaryaOfficialLeaveRequest['status']): string {
  return {
    pending: 'Menunggu keputusan',
    approved: 'Disetujui',
    declined: 'Ditolak',
    withdrawn: 'Ditarik',
  }[status];
}

function reportTypeLabel(request: PekaryaOfficialLeaveRequest): string {
  return pekaryaAttendanceReportType(request) === 'scan'
    ? 'Scan Masuk & Scan Keluar'
    : 'Izin Resmi';
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function PekaryaOfficialLeavePanel(props: {
  employeeId: string;
  openPeriods: OpenPeriod[];
  embedded?: boolean;
}) {
  const { employeeId, openPeriods, embedded } = props;
  const availablePeriods = useMemo(
    () =>
      openPeriods.filter(
        (item) => item.period >= ATTENDANCE_PAYROLL_START_PERIOD,
      ).sort((left, right) => left.period.localeCompare(right.period)),
    [openPeriods],
  );
  const [date, setDate] = useState('');
  const [reportType, setReportType] = useState<PekaryaAttendanceReportType>('scan');
  const [scanIn, setScanIn] = useState(DEFAULT_SCAN_IN);
  const [scanOut, setScanOut] = useState(DEFAULT_SCAN_OUT);
  const [requests, setRequests] = useState<PekaryaOfficialLeaveRequest[]>([]);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState<PhotoEvidence | null>(null);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [selectedExifImage, setSelectedExifImage] = useState<{
    url: string;
    title: string;
    auditMetadata?: PhotoAuditMetadata | null;
  } | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const defaultDate = availablePeriods[availablePeriods.length - 1]?.startDate || '';
  const effectiveDate = date || defaultDate;
  const period = effectiveDate ? pekaryaPayrollPeriodForDate(effectiveDate) : '';
  const selectedPeriodData = useMemo(
    () => availablePeriods.find((item) => item.period === period) || null,
    [availablePeriods, period],
  );
  const dateIsOpen = Boolean(
    selectedPeriodData &&
      effectiveDate >= selectedPeriodData.startDate &&
      effectiveDate <= selectedPeriodData.endDate,
  );
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const scanRangeInvalid =
    reportType === 'scan' &&
    CLOCK_TIME_PATTERN.test(scanIn) &&
    CLOCK_TIME_PATTERN.test(scanOut) &&
    timeToMinutes(scanOut) <= timeToMinutes(scanIn);

  const load = useCallback(async () => {
    if (!period || !dateIsOpen) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedJson<{
        requests: PekaryaOfficialLeaveRequest[];
      }>(`/api/attendance/pekarya/official-leave?period=${encodeURIComponent(period)}`);
      setRequests(response.requests || []);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Riwayat pengajuan presensi gagal dimuat.',
      );
    } finally {
      setLoading(false);
    }
  }, [dateIsOpen, period]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleEvidenceFile = async (file: File) => {
    if (!effectiveDate || !dateIsOpen) {
      setError('Pilih tanggal dalam periode payroll terbuka terlebih dahulu.');
      return;
    }
    setEvidenceUploading(true);
    setError('');
    setMessage('');
    try {
      const prepared = await prepareProofImage(file);
      const fileRef = ref(
        storage,
        `activity_proofs/${employeeId}/presensi_${effectiveDate}_${Date.now()}.jpg`,
      );
      await uploadBytes(fileRef, prepared.file);
      const downloadUrl = await getDownloadURL(fileRef);
      setEvidence({ url: downloadUrl, auditMetadata: prepared.auditMetadata });
      setMessage('Foto bukti berhasil diunggah.');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Gagal mengunggah foto bukti.',
      );
    } finally {
      setEvidenceUploading(false);
    }
  };

  const submit = async () => {
    if (!period || !effectiveDate || !dateIsOpen || reason.trim().length < 8) {
      if (!dateIsOpen) {
        setError('Tanggal presensi harus berada dalam periode payroll terbuka.');
      }
      return;
    }
    if (
      reportType === 'scan' &&
      (!CLOCK_TIME_PATTERN.test(scanIn) ||
        !CLOCK_TIME_PATTERN.test(scanOut) ||
        scanRangeInvalid)
    ) {
      setError(
        scanRangeInvalid
          ? 'Scan keluar harus lebih lambat dari scan masuk.'
          : 'Isi scan masuk dan scan keluar dengan jam yang valid.',
      );
      return;
    }

    setWorking(true);
    setError('');
    setMessage('');
    try {
      const previous = requests.find((request) => request.date === effectiveDate);
      await authenticatedJson('/api/attendance/pekarya/official-leave', {
        method: 'POST',
        body: JSON.stringify({
          action: 'submit',
          requestId: createFinancialRequestId('pekarya-attendance'),
          period,
          date: effectiveDate,
          reportType,
          scanIn: reportType === 'scan' ? scanIn : null,
          scanOut: reportType === 'scan' ? scanOut : null,
          reason: reason.trim(),
          evidenceUrl: evidence?.url || null,
          evidenceAuditMetadata: evidence?.auditMetadata || null,
          expectedRevision: previous?.revision || 0,
        }),
      });
      setReason('');
      setEvidence(null);
      setSelectedExifImage(null);
      setMessage(
        reportType === 'scan'
          ? 'Laporan scan dikirim kepada Kepala SatKer.'
          : 'Pengajuan izin resmi dikirim kepada Kepala SatKer.',
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Pengajuan presensi gagal dikirim.',
      );
    } finally {
      setWorking(false);
    }
  };

  const withdraw = async (request: PekaryaOfficialLeaveRequest) => {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      await authenticatedJson('/api/attendance/pekarya/official-leave', {
        method: 'POST',
        body: JSON.stringify({
          action: 'withdraw',
          requestId: createFinancialRequestId('pekarya-attendance-withdraw'),
          period: request.period,
          date: request.date,
          reportType: pekaryaAttendanceReportType(request),
          expectedRevision: request.revision,
        }),
      });
      setMessage('Pengajuan presensi berhasil ditarik.');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Pengajuan tidak dapat ditarik.',
      );
    } finally {
      setWorking(false);
    }
  };

  const body = (
    <CardContent className="space-y-5 p-4 sm:p-5">
      {(message || error) && (
        <div
          role="status"
          className={`rounded-xl border p-4 ${
            error
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {error || message}
        </div>
      )}
      {availablePeriods.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-700">
          Belum ada periode payroll terbuka untuk pengajuan presensi.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="official-leave-date">Tanggal presensi</Label>
            <Input
              id="official-leave-date"
              type="date"
              min={availablePeriods[0]?.startDate}
              max={availablePeriods[availablePeriods.length - 1]?.endDate}
              value={effectiveDate}
              onChange={(event) => {
                setDate(event.target.value);
                setEvidence(null);
                setSelectedExifImage(null);
                setError('');
              }}
              className="min-h-14 rounded-xl text-base"
            />
            {!dateIsOpen && effectiveDate && (
              <p className="text-sm font-semibold text-rose-700">
                Tanggal ini tidak termasuk periode payroll terbuka.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="official-leave-report-type">Jenis pengajuan</Label>
            <Select
              value={reportType}
              onValueChange={(value) => {
                if (!value) return;
                setReportType(value as PekaryaAttendanceReportType);
                setError('');
              }}
            >
              <SelectTrigger
                id="official-leave-report-type"
                className="min-h-14 w-full rounded-xl border-slate-300 bg-white px-4 text-base font-bold text-slate-800 shadow-none hover:bg-slate-50"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                side="top"
                align="start"
                alignItemWithTrigger={false}
                className="max-h-60 rounded-xl border-slate-200 bg-white p-1 shadow-xl"
              >
                <SelectItem
                  value="scan"
                  className="min-h-12 rounded-lg px-3 py-3 text-base font-semibold"
                >
                  Scan Masuk &amp; Scan Keluar
                </SelectItem>
                <SelectItem
                  value="izin_resmi"
                  className="min-h-12 rounded-lg px-3 py-3 text-base font-semibold"
                >
                  Izin Resmi (Hari Penuh)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {reportType === 'scan' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="official-leave-scan-in">Scan masuk</Label>
                  <Input
                    id="official-leave-scan-in"
                    type="time"
                    value={scanIn}
                    onChange={(event) => setScanIn(event.target.value)}
                    className="min-h-14 rounded-xl text-base font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="official-leave-scan-out">Scan keluar</Label>
                  <Input
                    id="official-leave-scan-out"
                    type="time"
                    value={scanOut}
                    onChange={(event) => setScanOut(event.target.value)}
                    className="min-h-14 rounded-xl text-base font-mono"
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
              <p className="flex items-center gap-2 font-bold">
                <CalendarDays className="h-4 w-4" />
                Izin resmi dihitung sebagai hari penuh
              </p>
              <p className="mt-1">
                Jika disetujui, presensi akan dicatat otomatis pukul{' '}
                <strong>{PEKARYA_OFFICIAL_LEAVE_SCAN_IN.slice(0, 5)}</strong>–
                <strong>{PEKARYA_OFFICIAL_LEAVE_SCAN_OUT.slice(0, 5)}</strong>{' '}
                dan masuk perhitungan upah sesuai kalender payroll.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="official-leave-reason">Alasan lengkap</Label>
            <textarea
              id="official-leave-reason"
              className="min-h-28 w-full rounded-xl border border-slate-300 p-3 text-base"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                reportType === 'scan'
                  ? 'Contoh: Scan masuk dan scan keluar tidak terbaca pada rekap presensi.'
                  : 'Contoh: Mendapat tugas resmi dari unit kerja dan telah melapor kepada atasan.'
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="official-leave-evidence">Foto bukti (opsional)</Label>
            <input
              ref={evidenceInputRef}
              id="official-leave-evidence"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void handleEvidenceFile(file);
              }}
            />
            {evidence ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/80 p-2 text-sm">
                <div className="flex min-w-0 items-center gap-1.5 font-bold text-blue-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600" />
                  <span className="truncate">Foto bukti terunggah</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedExifImage({
                        url: evidence.url,
                        title: 'Foto Bukti Presensi',
                        auditMetadata: evidence.auditMetadata,
                      })
                    }
                    className="flex min-h-12 items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
                  >
                    <Eye className="h-4 w-4" />
                    Lihat Foto
                  </button>
                  <button
                    type="button"
                    onClick={() => setEvidence(null)}
                    className="flex h-12 w-12 items-center justify-center rounded-lg text-rose-600 transition-colors hover:bg-rose-100"
                    title="Hapus Foto Ini"
                    aria-label="Hapus foto bukti"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={evidenceUploading || !dateIsOpen}
                onClick={() => evidenceInputRef.current?.click()}
                className="min-h-12 w-full gap-2 rounded-xl border-dashed border-slate-300 bg-slate-50/60 text-base font-bold text-slate-700 hover:bg-slate-100"
              >
                {evidenceUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="h-5 w-5 text-slate-500" />
                )}
                {evidenceUploading ? 'Mengunggah…' : 'Upload Foto'}
              </Button>
            )}
          </div>
          <Button
            type="button"
            className="min-h-12 w-full gap-2 bg-indigo-600 hover:bg-indigo-700"
            disabled={
              working ||
              evidenceUploading ||
              !effectiveDate ||
              !dateIsOpen ||
              reason.trim().length < 8 ||
              (reportType === 'scan' &&
                (!CLOCK_TIME_PATTERN.test(scanIn) ||
                  !CLOCK_TIME_PATTERN.test(scanOut) ||
                  scanRangeInvalid))
            }
            onClick={() => void submit()}
          >
            {working ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            Kirim Pengajuan ke Kepala SatKer
          </Button>
        </>
      )}

      {loading ? (
        <div className="flex min-h-20 items-center justify-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Memuat riwayat pengajuan…
        </div>
      ) : requests.length > 0 ? (
        <section className="space-y-3 border-t border-slate-200 pt-5">
          <h3 className="font-bold">Riwayat Pengajuan</h3>
          {requests.map((request) => {
            const requestType = pekaryaAttendanceReportType(request);
            const requestScanIn = request.scanIn?.slice(0, 5);
            const requestScanOut = request.scanOut?.slice(0, 5);
            return (
              <article key={request.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">
                      {request.date} · {statusLabel(request.status)}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-indigo-700">
                      {requestType === 'scan' ? (
                        <Clock3 className="h-4 w-4" />
                      ) : (
                        <FileClock className="h-4 w-4" />
                      )}
                      {reportTypeLabel(request)}
                      {requestType === 'scan'
                        ? ` · ${requestScanIn || '--:--'}–${requestScanOut || '--:--'}`
                        : ' · 07:30–14:00'}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">{request.reason}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Revisi {request.revision}
                      {request.status === 'approved'
                        ? ` · Dibayar ${new Intl.NumberFormat('id-ID', {
                            style: 'currency',
                            currency: 'IDR',
                            maximumFractionDigits: 0,
                          }).format(request.approvedAmount || 0)}`
                        : ''}
                    </p>
                    {request.decisionReason && (
                      <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-600">
                        Keputusan: {request.decisionReason}
                      </p>
                    )}
                    {request.evidenceUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedExifImage({
                            url: request.evidenceUrl!,
                            title: `Foto Bukti Presensi ${request.date}`,
                            auditMetadata: request.evidenceAuditMetadata,
                          })
                        }
                        className="mt-2 flex min-h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
                      >
                        <Eye className="h-4 w-4" />
                        Lihat Foto Bukti
                      </button>
                    )}
                  </div>
                  {request.status === 'pending' && (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-12"
                      disabled={working}
                      onClick={() => void withdraw(request)}
                    >
                      Tarik
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}
    </CardContent>
  );

  const evidenceViewer = selectedExifImage ? (
    <ImageExifViewer
      imageUrl={selectedExifImage.url}
      title={selectedExifImage.title}
      auditMetadata={selectedExifImage.auditMetadata}
      activityDate={effectiveDate}
      isOpen={Boolean(selectedExifImage)}
      onClose={() => setSelectedExifImage(null)}
      showMetadata={false}
    />
  ) : null;

  if (embedded) {
    return (
      <>
        {body}
        {evidenceViewer}
      </>
    );
  }

  return (
    <>
      <Card className="overflow-hidden rounded-2xl border-indigo-200 bg-white shadow-sm">
        <CardHeader className="border-b border-indigo-100 bg-indigo-50/70 p-5">
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="h-6 w-6 text-indigo-700" />
            Ajukan Izin Resmi
          </CardTitle>
          <p className="text-base text-slate-600">
            Kirim laporan scan masuk &amp; scan keluar atau izin resmi kepada Kepala SatKer.
          </p>
        </CardHeader>
        {body}
      </Card>
      {evidenceViewer}
    </>
  );
}
