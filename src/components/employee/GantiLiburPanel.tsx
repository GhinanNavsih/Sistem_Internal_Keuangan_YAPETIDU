"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Send,
  Undo2,
  X,
} from 'lucide-react';
import { GantiLiburAttachmentLinks } from '@/components/GantiLiburAttachmentLinks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  authenticatedFormData,
  authenticatedJson,
  createFinancialRequestId,
} from '@/lib/payroll/client';
import { compressProofImageToLimit } from '@/lib/photoEvidence';
import {
  displayDateToIso,
  isCompleteDateText,
  isoToDisplayDate,
  maskDateInput,
} from '@/lib/dateTextInput';
import { isDateOnly } from '@/lib/payroll/annualPaidLeave';
import { isFridayDate } from '@/lib/payroll/attendance';
import {
  GANTI_LIBUR_MAX_DAYS_PER_WEEK,
  closestGantiLiburOffDay,
  gantiLiburSubmitIssue,
  gantiLiburSubmitIssueMessage,
  gantiLiburWeekEnd,
  gantiLiburWeekStart,
  gantiLiburWeekUsage,
  isActiveGantiLiburStatus,
  type GantiLiburRequest,
  type GantiLiburStatus,
} from '@/lib/payroll/gantiLibur';
import {
  GANTI_LIBUR_ATTACHMENT_ACCEPT,
  GANTI_LIBUR_MAX_ATTACHMENTS,
  GANTI_LIBUR_MAX_ATTACHMENT_BYTES,
  formatAttachmentSize,
  gantiLiburAttachmentContentType,
  gantiLiburAttachmentTypeIssue,
  isPdfAttachment,
  type GantiLiburAttachment,
} from '@/lib/payroll/gantiLiburAttachments';

interface GantiLiburResponse {
  employee: { id: string; name: string };
  /** Today in Jakarta, by the server's clock. */
  today: string;
  offDayMonths: string[];
  offDayDates: string[];
  requests: GantiLiburRequest[];
}

function statusLabel(status: GantiLiburStatus): string {
  return {
    pending: 'Menunggu verifikasi presensi',
    approved: 'Disetujui',
    declined: 'Ditolak',
    withdrawn: 'Ditarik',
  }[status];
}

function statusClass(status: GantiLiburStatus): string {
  if (status === 'approved') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'declined') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (status === 'withdrawn') return 'border-slate-200 bg-slate-50 text-slate-600';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function formatDate(date: string, withWeekday = true): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat('id-ID', {
    ...(withWeekday ? { weekday: 'long' as const } : {}),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

interface AttachmentItem {
  key: number;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  attachment?: GantiLiburAttachment;
  error?: string;
}

const MAX_ATTACHMENT_MB = GANTI_LIBUR_MAX_ATTACHMENT_BYTES / (1024 * 1024);

/**
 * A file within the size limit is sent as it is. A larger photo is scaled
 * down to fit; anything else that is too big is refused.
 */
async function fitAttachmentToLimit(file: File): Promise<File> {
  if (file.size <= GANTI_LIBUR_MAX_ATTACHMENT_BYTES) return file;
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
    try {
      return await compressProofImageToLimit(file, GANTI_LIBUR_MAX_ATTACHMENT_BYTES);
    } catch {
      // Fall through to the size message below.
    }
  }
  throw new Error(`Ukuran berkas melebihi ${MAX_ATTACHMENT_MB} MB.`);
}

async function uploadAttachment(file: File): Promise<GantiLiburAttachment> {
  const typeIssue = gantiLiburAttachmentTypeIssue(file.name, file.type);
  if (typeIssue) throw new Error(typeIssue);
  const form = new FormData();
  form.append('file', await fitAttachmentToLimit(file));
  const { attachment } = await authenticatedFormData<{ attachment: GantiLiburAttachment }>(
    '/api/uploads/ganti-libur',
    form,
  );
  return attachment;
}

/** A date typed on the number keypad as dd/mm/yyyy, not picked from a calendar. */
function DateTextInput({
  id,
  value,
  invalid,
  onValueChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  onValueChange: (text: string) => void;
}) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/yyyy"
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(event) => onValueChange(maskDateInput(event.target.value))}
      className="min-h-14 rounded-xl text-base font-mono"
    />
  );
}

export function GantiLiburPanel() {
  // The dates are kept as the dd/mm/yyyy text on screen and only read as dates
  // once complete. The worked-holiday text is null until the employee touches
  // the field, so its default (see defaultWorkedDate) shows; '' means they
  // cleared it on purpose.
  const [workedDateText, setWorkedDateText] = useState<string | null>(null);
  const [dayOffText, setDayOffText] = useState('');
  const [reason, setReason] = useState('');
  // Keterangan stays folded away until the employee asks for it.
  const [showReason, setShowReason] = useState(false);
  const [files, setFiles] = useState<AttachmentItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextFileKey = useRef(0);
  const [data, setData] = useState<GantiLiburResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [workingLabel, setWorkingLabel] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(
        await authenticatedJson<GantiLiburResponse>('/api/employee/ganti-libur', {
          method: 'GET',
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Data ganti libur gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const offDaySet = useMemo(() => new Set(data?.offDayDates || []), [data]);
  // Outside the months the server sent, only Jumat is known here; the server
  // still checks Tanggal Merah when the request is sent.
  const isOffDay = useCallback(
    (date: string) => isFridayDate(date) || offDaySet.has(date),
    [offDaySet],
  );

  const requests = data?.requests || [];
  // The non-working day nearest today, leaving out holidays a pending or
  // approved request already uses.
  const defaultWorkedDate = useMemo(() => {
    if (!data) return '';
    const held = new Set(
      data.requests
        .filter((item) => isActiveGantiLiburStatus(item.status))
        .map((item) => item.workedDate),
    );
    return closestGantiLiburOffDay({
      today: data.today,
      isOffDay,
      isTaken: (date) => held.has(date),
    });
  }, [data, isOffDay]);
  const workedDateShown = workedDateText ?? isoToDisplayDate(defaultWorkedDate);
  const workedDate = displayDateToIso(workedDateShown);
  const dayOffDate = displayDateToIso(dayOffText);
  // Ten characters typed that still are not a real date, e.g. 31/02/2026.
  const workedDateInvalid = isCompleteDateText(workedDateShown) && !workedDate;
  const dayOffInvalid = isCompleteDateText(dayOffText) && !dayOffDate;
  const existingForWorkedDate = requests.find((item) => item.workedDate === workedDate);
  const bothDatesValid = isDateOnly(workedDate) && isDateOnly(dayOffDate);
  const issue = data && bothDatesValid
    ? gantiLiburSubmitIssue({
        requestId: existingForWorkedDate?.id || '',
        workedDate,
        dayOffDate,
        isOffDay,
        currentStatus: existingForWorkedDate?.status,
        requests,
      })
    : null;
  const workedDateHint = isDateOnly(workedDate)
    ? !isOffDay(workedDate)
      ? 'Tanggal ini hari kerja biasa. Pilih hari Jumat atau Tanggal Merah saat Anda tetap masuk.'
      : existingForWorkedDate && isActiveGantiLiburStatus(existingForWorkedDate.status)
        ? gantiLiburSubmitIssueMessage('worked_date_used')
        : ''
    : '';
  const dayOffHint = isDateOnly(dayOffDate) && isOffDay(dayOffDate)
    ? gantiLiburSubmitIssueMessage('day_off_not_working_day')
    : '';
  const weekUsage = isDateOnly(dayOffDate)
    ? gantiLiburWeekUsage(requests, dayOffDate, existingForWorkedDate?.id)
    : null;
  const uploadingFiles = files.some((item) => item.status === 'uploading');
  const failedFiles = files.some((item) => item.status === 'error');
  const canSubmit = Boolean(
    data &&
      bothDatesValid &&
      !issue &&
      reason.trim().length <= 500 &&
      !uploadingFiles &&
      !failedFiles,
  );

  const addFiles = async (picked: File[]) => {
    if (picked.length === 0) return;
    setError('');
    const room = Math.max(0, GANTI_LIBUR_MAX_ATTACHMENTS - files.length);
    const accepted = picked.slice(0, room);
    if (accepted.length < picked.length) {
      setError(
        `Surat resmi maksimal ${GANTI_LIBUR_MAX_ATTACHMENTS} berkas; ${picked.length - accepted.length} berkas tidak ditambahkan.`,
      );
    }
    const queued = accepted.map((file) => ({
      file,
      key: nextFileKey.current++,
    }));
    setFiles((current) => [
      ...current,
      ...queued.map(({ file, key }) => ({
        key,
        name: file.name,
        size: file.size,
        status: 'uploading' as const,
      })),
    ]);
    await Promise.all(
      queued.map(async ({ file, key }) => {
        try {
          const attachment = await uploadAttachment(file);
          setFiles((current) =>
            current.map((item) =>
              item.key === key ? { ...item, status: 'done', attachment } : item,
            ),
          );
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Berkas gagal diunggah.';
          setFiles((current) =>
            current.map((item) =>
              item.key === key ? { ...item, status: 'error', error: message } : item,
            ),
          );
        }
      }),
    );
  };

  const removeFile = (key: number) => {
    setFiles((current) => current.filter((item) => item.key !== key));
    setError('');
  };

  const submit = async () => {
    if (!canSubmit) return;
    setWorking(true);
    setWorkingLabel('Mengirim pengajuan ganti libur…');
    setError('');
    setMessage('');
    try {
      await authenticatedJson('/api/employee/ganti-libur', {
        method: 'POST',
        body: JSON.stringify({
          action: 'submit',
          requestId: createFinancialRequestId('ganti-libur'),
          workedDate,
          dayOffDate,
          reason,
          attachmentPaths: files.flatMap((item) =>
            item.attachment ? [item.attachment.path] : [],
          ),
          expectedRevision: existingForWorkedDate?.revision || 0,
        }),
      });
      setWorkedDateText(null);
      setDayOffText('');
      setReason('');
      setShowReason(false);
      setFiles([]);
      setMessage(
        'Pengajuan ganti libur dikirim. Pengajuan diverifikasi setelah data presensi hari libur tersebut diunggah.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengajuan ganti libur gagal dikirim.');
    } finally {
      setWorking(false);
      setWorkingLabel('');
    }
  };

  const withdraw = async (request: GantiLiburRequest) => {
    setWorking(true);
    setWorkingLabel('Menarik pengajuan ganti libur…');
    setError('');
    setMessage('');
    try {
      await authenticatedJson('/api/employee/ganti-libur', {
        method: 'POST',
        body: JSON.stringify({
          action: 'withdraw',
          requestId: createFinancialRequestId('ganti-libur-withdraw'),
          workedDate: request.workedDate,
          expectedRevision: request.revision,
        }),
      });
      setMessage('Pengajuan ganti libur ditarik.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pengajuan tidak dapat ditarik.');
    } finally {
      setWorking(false);
      setWorkingLabel('');
    }
  };

  return (
    <>
      <Card className="overflow-hidden rounded-2xl border-sky-200 bg-white shadow-sm">
        <CardHeader className="border-b border-sky-100 bg-sky-50/70 p-5">
          <CardTitle className="flex items-center gap-2 text-xl">
            <CalendarClock className="h-6 w-6 text-sky-700" />
            Ganti Libur
          </CardTitle>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-base text-slate-600">
            <li>
              Masuk di hari libur pukul 07.30–14.00 dapat diganti
              satu hari libur di hari kerja. Jika kurang dari jam tersebut, dihitung lembur.
            </li>
            <li>
              Ganti libur maksimal {GANTI_LIBUR_MAX_DAYS_PER_WEEK} hari per minggu (Sabtu–Jumat).
            </li>
          </ul>
        </CardHeader>
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

          {loading || !data ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Memuat ganti libur…
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="ganti-libur-worked-date">Tanggal masuk di hari libur</Label>
                <DateTextInput
                  id="ganti-libur-worked-date"
                  value={workedDateShown}
                  invalid={workedDateInvalid}
                  onValueChange={(text) => {
                    setWorkedDateText(text);
                    setError('');
                  }}
                />
                {workedDateInvalid && (
                  <p className="text-sm font-semibold text-amber-700">Tanggal tidak valid.</p>
                )}
                {isDateOnly(workedDate) && !workedDateHint && (
                  <p className="text-sm font-semibold text-slate-600">{formatDate(workedDate)}</p>
                )}
                {workedDateHint && (
                  <p className="text-sm font-semibold text-amber-700">{workedDateHint}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="ganti-libur-day-off-date">Tanggal ganti libur (hari kerja)</Label>
                <DateTextInput
                  id="ganti-libur-day-off-date"
                  value={dayOffText}
                  invalid={dayOffInvalid}
                  onValueChange={(text) => {
                    setDayOffText(text);
                    setError('');
                  }}
                />
                {dayOffInvalid && (
                  <p className="text-sm font-semibold text-amber-700">Tanggal tidak valid.</p>
                )}
                {isDateOnly(dayOffDate) && !dayOffHint && (
                  <p className="text-sm font-semibold text-slate-600">{formatDate(dayOffDate)}</p>
                )}
                {dayOffHint && (
                  <p className="text-sm font-semibold text-amber-700">{dayOffHint}</p>
                )}
                {weekUsage !== null && !dayOffHint && (
                  <p
                    className={`text-sm ${
                      weekUsage >= GANTI_LIBUR_MAX_DAYS_PER_WEEK
                        ? 'font-semibold text-amber-700'
                        : 'text-slate-500'
                    }`}
                  >
                    Minggu {formatDate(gantiLiburWeekStart(dayOffDate), false)} –{' '}
                    {formatDate(gantiLiburWeekEnd(dayOffDate), false)}: {weekUsage} dari{' '}
                    {GANTI_LIBUR_MAX_DAYS_PER_WEEK} hari ganti libur sudah diajukan.
                  </p>
                )}
              </div>

              {issue && !workedDateHint && !dayOffHint && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                  {gantiLiburSubmitIssueMessage(issue)}
                </p>
              )}

              <div className="space-y-2">
                <Label>Surat resmi (opsional)</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={GANTI_LIBUR_ATTACHMENT_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    const picked = Array.from(event.target.files || []);
                    // Clear the input so picking the same file again still fires.
                    event.target.value = '';
                    void addFiles(picked);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-14 w-full gap-2 rounded-xl border-dashed border-slate-300 text-base font-bold text-slate-700"
                  disabled={working || files.length >= GANTI_LIBUR_MAX_ATTACHMENTS}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="h-5 w-5" />
                  {files.length === 0 ? 'Unggah Surat Resmi' : 'Tambah Berkas Lagi'}
                </Button>
                {files.length > 0 && (
                  <ul className="space-y-2">
                    {files.map((item) => {
                      const isPdf = item.attachment
                        ? isPdfAttachment(item.attachment)
                        : gantiLiburAttachmentContentType(item.name, '') === 'application/pdf';
                      const Icon = isPdf ? FileText : ImageIcon;
                      return (
                        <li
                          key={item.key}
                          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                            <Icon className="h-5 w-5 text-sky-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-800">{item.name}</p>
                            <p
                              className={`text-xs ${
                                item.status === 'error'
                                  ? 'font-semibold text-rose-600'
                                  : 'text-slate-500'
                              }`}
                            >
                              {item.status === 'uploading'
                                ? 'Mengunggah…'
                                : item.status === 'error'
                                  ? item.error
                                  : formatAttachmentSize(item.size)}
                            </p>
                          </div>
                          {item.status === 'uploading' ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-600" />
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0 rounded-full text-slate-500"
                              aria-label={`Hapus ${item.name}`}
                              disabled={working}
                              onClick={() => removeFile(item.key)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {uploadingFiles && (
                  <p className="text-sm font-semibold text-slate-600">
                    Tunggu unggahan berkas selesai sebelum mengirim.
                  </p>
                )}
                {failedFiles && (
                  <p className="text-sm font-semibold text-amber-700">
                    Hapus berkas yang gagal diunggah, lalu unggah ulang jika perlu.
                  </p>
                )}
              </div>

              {showReason ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="ganti-libur-reason">Keterangan</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 text-slate-500"
                      onClick={() => {
                        setReason('');
                        setShowReason(false);
                      }}
                    >
                      <X className="h-4 w-4" />
                      Hapus keterangan
                    </Button>
                  </div>
                  <textarea
                    id="ganti-libur-reason"
                    autoFocus
                    value={reason}
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    className="min-h-24 w-full rounded-xl border border-slate-300 p-3 text-base"
                    placeholder="Contoh: Masuk untuk persiapan wisuda"
                  />
                  <p className="text-right text-xs text-slate-400">{reason.length}/500</p>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-12 w-full justify-start gap-2 rounded-xl text-base font-semibold text-slate-600"
                  onClick={() => setShowReason(true)}
                >
                  <MessageSquarePlus className="h-5 w-5" />
                  Tambah keterangan
                </Button>
              )}

              <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
                <p className="flex items-center gap-2 font-bold">
                  <CalendarDays className="h-4 w-4" />
                  Diverifikasi setelah data presensi diunggah
                </p>
              </div>

              <Button
                type="button"
                className="min-h-12 w-full gap-2 bg-sky-600 hover:bg-sky-700"
                disabled={working || !canSubmit}
                onClick={() => void submit()}
              >
                {working ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                Kirim Pengajuan Ganti Libur
              </Button>

              {requests.length > 0 && (
                <section className="space-y-3 border-t border-slate-200 pt-5">
                  <h3 className="font-bold text-slate-900">Riwayat Ganti Libur</h3>
                  {requests.map((request) => (
                    <article key={request.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900">
                            Libur: {formatDate(request.dayOffDate)}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            Pengganti masuk hari libur {formatDate(request.workedDate)}
                          </p>
                          {request.reason && (
                            <p className="mt-1 text-sm text-slate-500">{request.reason}</p>
                          )}
                          <GantiLiburAttachmentLinks
                            attachments={request.attachments}
                            className="mt-2"
                          />
                          <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(request.status)}`}>
                            {request.status === 'approved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                            {statusLabel(request.status)}
                          </span>
                          {request.decisionReason && (
                            <p className="mt-2 text-xs text-slate-500">Keputusan: {request.decisionReason}</p>
                          )}
                        </div>
                        {request.status === 'pending' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="min-h-11 shrink-0 gap-2"
                            disabled={working}
                            onClick={() => void withdraw(request)}
                          >
                            <Undo2 className="h-4 w-4" />
                            Tarik
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </section>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {working && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div role="status" aria-live="assertive" className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-sky-600" />
            <p className="mt-4 font-bold text-slate-900">{workingLabel}</p>
            <p className="mt-1 text-sm text-slate-500">Mohon jangan tutup halaman ini.</p>
          </div>
        </div>
      )}
    </>
  );
}
