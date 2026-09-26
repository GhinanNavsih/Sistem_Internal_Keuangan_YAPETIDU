"use client";

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import {
  conversionPeriodLabel,
  EMPLOYEE_CONVERSION_REASON_MAX_LENGTH,
  EMPLOYEE_CONVERSION_REASON_MIN_LENGTH,
  LOYALIS_TYPES,
  shiftConversionPeriod,
  type EmployeeConversionIssue,
  type LoyalisConversionInput,
  validateLoyalisConversionInput,
} from '@/lib/employeeConversion';

interface ConversionPreview {
  employee: { id: string; name: string; jobCategory: string; nipy: string };
  effectivePeriod: string;
  blockers: EmployeeConversionIssue[];
  warnings: EmployeeConversionIssue[];
  linkedAccount: { uid: string; email: string | null; displayName: string; role: string } | null;
  prefill: LoyalisConversionInput;
  canSetLevelCode: boolean;
  pekaryaBpjsAllowance: number;
}

export interface EmployeeConversionOutcome {
  loyalisEmployeeId: string;
  effectivePeriod: string;
  linkedAccountUid: string | null;
}

interface ConvertToLoyalisDialogProps {
  /** The Pekarya to convert; the dialog is open while this is set. */
  employee: { id: string; name: string } | null;
  departments: readonly string[];
  educationLevels: readonly string[];
  gradeCodes: readonly string[];
  onClose: () => void;
  /** Called as soon as the conversion is saved, so the page can reload its lists. */
  onConverted: (outcome: EmployeeConversionOutcome) => void;
  onOpenLoyalisRecord: (loyalisEmployeeId: string) => void;
}

type Step = 'check' | 'form' | 'confirm' | 'done';

const STEP_LABELS: Record<Exclude<Step, 'done'>, string> = {
  check: '1. Pemeriksaan',
  form: '2. Data Loyalis',
  confirm: '3. Konfirmasi',
};

function formatIDR(value: number): string {
  return `Rp${Math.round(value || 0).toLocaleString('id-ID')}`;
}

function formatDate(dateOnly: string): string {
  if (!dateOnly) return '-';
  const date = new Date(`${dateOnly}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? dateOnly
    : date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function IssueList({ issues, tone }: { issues: EmployeeConversionIssue[]; tone: 'block' | 'warn' }) {
  if (issues.length === 0) return null;
  const Icon = tone === 'block' ? AlertCircle : AlertTriangle;
  return (
    <ul className="space-y-2">
      {issues.map((issue) => (
        <li
          key={issue.code}
          className={`flex gap-2 rounded-xl border p-3 text-sm ${
            tone === 'block'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A number input that can be emptied while typing. It keeps its own draft text
 * and reports a number upstream (an empty draft counts as 0), so the stored
 * value never snaps back into the field and blocks deleting the last digit.
 */
function NumberField({ value, onValue }: { value: number; onValue: (value: number) => void }) {
  const [draft, setDraft] = useState(() => String(value));
  return (
    <Input
      type="number"
      min={0}
      inputMode="numeric"
      placeholder="0"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        onValue(event.target.value === '' ? 0 : Number(event.target.value));
      }}
      className="rounded-xl"
    />
  );
}


function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-[11px] font-semibold text-rose-600">{message}</p> : null;
}

/**
 * The three-step "Alihkan ke Loyalis" flow: what blocks the switch, the new
 * Loyalis data (pre-filled from the Pekarya record), and a summary with a
 * reason before anything is written. All rules live server-side; this only
 * shows them.
 */
export default function ConvertToLoyalisDialog(props: ConvertToLoyalisDialogProps) {
  // Keyed by employee so every opening starts from a clean slate and its own
  // request id.
  return props.employee ? (
    <ConversionFlow key={props.employee.id} {...props} employee={props.employee} />
  ) : null;
}

function fetchPreview(employeeId: string) {
  return authenticatedJson<ConversionPreview>(
    `/api/admin/employee-conversions?employeeId=${encodeURIComponent(employeeId)}`,
  );
}

function ConversionFlow({
  employee,
  departments,
  educationLevels,
  gradeCodes,
  onClose,
  onConverted,
  onOpenLoyalisRecord,
}: ConvertToLoyalisDialogProps & { employee: { id: string; name: string } }) {
  const [step, setStep] = useState<Step>('check');
  const [preview, setPreview] = useState<ConversionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<LoyalisConversionInput | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<EmployeeConversionOutcome | null>(null);
  // One id per opened dialog: a double click or a retry after a lost response
  // replays the same conversion instead of attempting a second one.
  const [requestId] = useState(() => createFinancialRequestId('employee-conversion'));

  const employeeId = employee.id;

  const applyPreview = (result: ConversionPreview) => {
    setPreview(result);
    setForm((current) => current || result.prefill);
  };

  useEffect(() => {
    let cancelled = false;
    fetchPreview(employeeId)
      .then((result) => {
        if (!cancelled) applyPreview(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Gagal memeriksa pegawai.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const reloadPreview = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      applyPreview(await fetchPreview(employeeId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Gagal memeriksa pegawai.');
    } finally {
      setLoading(false);
    }
  };

  const errors =
    form && preview
      ? validateLoyalisConversionInput(form, { canSetLevelCode: preview.canSetLevelCode })
      : {};
  const hasErrors = Object.keys(errors).length > 0;
  const warnings = (preview?.warnings || []).filter(
    (issue) => !(issue.code === 'LEVEL_CODE_EMPTY' && form?.levelCode),
  );
  const effectiveLabel = preview ? conversionPeriodLabel(preview.effectivePeriod) : '';
  const trimmedReason = reason.trim();
  const reasonValid =
    trimmedReason.length >= EMPLOYEE_CONVERSION_REASON_MIN_LENGTH &&
    trimmedReason.length <= EMPLOYEE_CONVERSION_REASON_MAX_LENGTH;

  const update = <K extends keyof LoyalisConversionInput>(key: K, value: LoyalisConversionInput[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (!preview || !form || hasErrors || !reasonValid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await authenticatedJson<EmployeeConversionOutcome & { idempotent: boolean }>(
        '/api/admin/employee-conversions',
        {
          method: 'POST',
          body: JSON.stringify({
            employeeId: preview.employee.id,
            input: form,
            reason: trimmedReason,
            requestId,
          }),
        },
      );
      const saved = {
        loyalisEmployeeId: result.loyalisEmployeeId,
        effectivePeriod: result.effectivePeriod,
        linkedAccountUid: result.linkedAccountUid,
      };
      setOutcome(saved);
      setStep('done');
      onConverted(saved);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Pengalihan gagal.');
    } finally {
      setSubmitting(false);
    }
  };

  const departmentOptions =
    form?.departmentUnit && !departments.includes(form.departmentUnit)
      ? [...departments, form.departmentUnit]
      : departments;

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="!max-w-3xl w-[92vw] rounded-[28px] border-none shadow-2xl p-0 overflow-hidden bg-white">
        <DialogHeader className="p-6 bg-slate-50/50 border-b border-slate-100">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-indigo-500" />
            Alihkan ke Loyalis
          </DialogTitle>
          <DialogDescription>
            {employee.name} ({employee.id})
            {preview && step !== 'done' && (
              <> · Berlaku mulai <span className="font-semibold text-slate-700">{effectiveLabel}</span></>
            )}
          </DialogDescription>
          {step !== 'done' && (
            <div className="flex gap-2 pt-2">
              {(Object.keys(STEP_LABELS) as Array<Exclude<Step, 'done'>>).map((key) => (
                <span
                  key={key}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold ${
                    key === step ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {STEP_LABELS[key]}
                </span>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4">
          {loading && !preview && (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-semibold">Memeriksa data pegawai…</span>
            </div>
          )}
          {loadError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{loadError}</div>
          )}

          {preview && form && step === 'check' && (
            <>
              <p className="text-sm text-slate-600">
                Pegawai ini akan mendapat data Loyalis baru. Data Pekarya lamanya tidak dihapus, hanya ditutup,
                sehingga slip dan laporan lamanya tetap tersimpan. Slip Pekarya terakhirnya adalah bulan{' '}
                <span className="font-semibold">
                  {conversionPeriodLabel(shiftConversionPeriod(preview.effectivePeriod, -1))}
                </span>
                ; seluruh {effectiveLabel} dibayar sebagai Loyalis.
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase text-slate-400">Kategori Pekarya</p>
                  <p className="font-semibold text-slate-800">{preview.employee.jobCategory || '-'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase text-slate-400">NIPY (ikut pindah)</p>
                  <p className="font-mono font-semibold text-slate-800">{preview.employee.nipy || '-'}</p>
                </div>
                <div className="col-span-2 rounded-xl bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase text-slate-400">Akun login</p>
                  <p className="font-semibold text-slate-800">
                    {preview.linkedAccount
                      ? `${preview.linkedAccount.email || preview.linkedAccount.displayName} — ikut dialihkan ke menu Loyalis`
                      : 'Belum ada akun login'}
                  </p>
                </div>
              </div>
              {preview.blockers.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-rose-700">Selesaikan dulu sebelum dialihkan:</p>
                  <IssueList issues={preview.blockers} tone="block" />
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" /> Tidak ada yang menghalangi pengalihan.
                </div>
              )}
              <IssueList issues={warnings} tone="warn" />
            </>
          )}

          {preview && form && step === 'form' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-2">
                <Label>Nama</Label>
                <Input value={form.name} onChange={(e) => update('name', e.target.value)} className="rounded-xl" />
                {showErrors && <FieldError message={errors.name} />}
              </div>
              <div className="space-y-2">
                <Label>Departemen / Unit (SatKer)</Label>
                <Select value={form.departmentUnit} onValueChange={(value) => update('departmentUnit', value || '')}>
                  <SelectTrigger className="rounded-xl bg-white text-xs h-10 w-full">
                    <SelectValue placeholder="Pilih unit kerja" />
                  </SelectTrigger>
                  <SelectContent className="bg-white rounded-xl shadow-xl max-h-56 overflow-y-auto z-[9999]">
                    {departmentOptions.map((dept) => (
                      <SelectItem key={dept} value={dept} className="text-xs">{dept}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showErrors && <FieldError message={errors.departmentUnit} />}
              </div>
              <div className="space-y-2">
                <Label>Tipe Loyalis</Label>
                <Select
                  value={form.loyalisType}
                  onValueChange={(value) => update('loyalisType', (value || '') as LoyalisConversionInput['loyalisType'])}
                >
                  <SelectTrigger className="rounded-xl bg-white text-xs h-10 w-full">
                    <SelectValue placeholder="Pilih tipe" />
                  </SelectTrigger>
                  <SelectContent className="bg-white rounded-xl shadow-xl z-[9999]">
                    {LOYALIS_TYPES.map((type) => (
                      <SelectItem key={type} value={type} className="text-xs">{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showErrors && <FieldError message={errors.loyalisType} />}
              </div>
              <div className="space-y-2">
                <Label>Tanggal Mulai Kerja</Label>
                <Input type="date" value={form.dateOfHire} onChange={(e) => update('dateOfHire', e.target.value)} className="rounded-xl" />
                <p className="text-[11px] text-slate-500">Dari data Pekarya · dipakai untuk jatah cuti</p>
                {showErrors && <FieldError message={errors.dateOfHire} />}
              </div>
              <div className="space-y-2">
                <Label>Tanggal Masa Kerja Diakui</Label>
                <Input type="date" value={form.dateRecognized} onChange={(e) => update('dateRecognized', e.target.value)} className="rounded-xl" />
                <p className="text-[11px] text-slate-500">Dipakai untuk Gaji Pokok</p>
                {showErrors && <FieldError message={errors.dateRecognized} />}
              </div>
              <div className="space-y-2">
                <Label>Status Dosen</Label>
                <Select
                  value={form.isDosen === null ? '__UNSET__' : String(form.isDosen)}
                  onValueChange={(value) => update('isDosen', value === '__UNSET__' ? null : value === 'true')}
                >
                  <SelectTrigger className="rounded-xl bg-white text-xs h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white rounded-xl shadow-xl z-[9999]">
                    <SelectItem value="__UNSET__" className="text-xs">Belum ditentukan</SelectItem>
                    <SelectItem value="true" className="text-xs">Ya — Dosen</SelectItem>
                    <SelectItem value="false" className="text-xs">Tidak</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Pendidikan (opsional)</Label>
                <Select
                  value={form.educationLevel || '__UNSET__'}
                  onValueChange={(value) => update('educationLevel', !value || value === '__UNSET__' ? '' : value)}
                >
                  <SelectTrigger className="rounded-xl bg-white text-xs h-10 w-full">
                    <SelectValue placeholder="Pilih pendidikan" />
                  </SelectTrigger>
                  <SelectContent className="bg-white rounded-xl shadow-xl max-h-56 overflow-y-auto z-[9999]">
                    <SelectItem value="__UNSET__" className="text-xs">Belum diisi</SelectItem>
                    {educationLevels.map((level) => (
                      <SelectItem key={level} value={level} className="text-xs">{level}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {preview.canSetLevelCode && (
                <div className="space-y-2">
                  <Label>Golongan (opsional)</Label>
                  <Select
                    value={form.levelCode || '__UNSET__'}
                    onValueChange={(value) => update('levelCode', !value || value === '__UNSET__' ? '' : value)}
                  >
                    <SelectTrigger className="rounded-xl bg-white text-xs h-10 w-full">
                      <SelectValue placeholder="Pilih golongan" />
                    </SelectTrigger>
                    <SelectContent className="bg-white rounded-xl shadow-xl max-h-56 overflow-y-auto z-[9999]">
                      <SelectItem value="__UNSET__" className="text-xs">Belum diisi</SelectItem>
                      {gradeCodes.map((code) => (
                        <SelectItem key={code} value={code} className="text-xs">{code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {showErrors && <FieldError message={errors.levelCode} />}
                </div>
              )}
              <div className="col-span-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tunjangan BPJS Loyalis</p>
                {preview.pekaryaBpjsAllowance > 0 && (
                  <p className="text-xs text-amber-800">
                    Sebagai Pekarya: BPJS (Tunjangan) {formatIDR(preview.pekaryaBpjsAllowance)} dalam satu baris.
                    Loyalis memisahkannya menjadi TK dan Kesehatan — isi pembagiannya.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>T. BPJS TK</Label>
                    <CurrencyInput value={form.bpjsTk} onValue={(value) => update('bpjsTk', value)} />
                    {showErrors && <FieldError message={errors.bpjsTk} />}
                  </div>
                  <div className="space-y-1">
                    <Label>T. BPJS Kesehatan</Label>
                    <CurrencyInput value={form.bpjsKes} onValue={(value) => update('bpjsKes', value)} />
                    {showErrors && <FieldError message={errors.bpjsKes} />}
                  </div>
                </div>
              </div>
              <div className="col-span-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tunjangan Keluarga</p>
                <div className="grid grid-cols-5 gap-2">
                  {([
                    ['spouseCount', 'Pasangan'],
                    ['childrenSd', 'Anak SD'],
                    ['childrenSltp', 'Anak SLTP'],
                    ['childrenSlta', 'Anak SLTA'],
                    ['childrenPt', 'Anak PT'],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-[11px]">{label}</Label>
                      <NumberField value={form[key]} onValue={(value) => update(key, value)} />
                      {showErrors && <FieldError message={errors[key]} />}
                    </div>
                  ))}
                </div>
              </div>
              <p className="col-span-2 text-xs text-slate-500">
                NIK, telepon, email, rekening, potongan, Tunjangan Beras dan akun Koperasi disalin dari data Pekarya.
                Jabatan struktural dan data lain dapat dilengkapi setelahnya di formulir Loyalis.
              </p>
            </div>
          )}

          {preview && form && step === 'confirm' && (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-2xl bg-slate-50 p-4 text-sm">
                <dt className="text-slate-500">Berlaku mulai</dt>
                <dd className="font-semibold text-slate-800">{effectiveLabel}</dd>
                <dt className="text-slate-500">Unit kerja</dt>
                <dd className="font-semibold text-slate-800">{form.departmentUnit}</dd>
                <dt className="text-slate-500">Tipe Loyalis</dt>
                <dd className="font-semibold text-slate-800">{form.loyalisType}</dd>
                <dt className="text-slate-500">Mulai Kerja / Diakui</dt>
                <dd className="font-semibold text-slate-800">
                  {formatDate(form.dateOfHire)} / {formatDate(form.dateRecognized)}
                </dd>
                {preview.canSetLevelCode && (
                  <>
                    <dt className="text-slate-500">Golongan</dt>
                    <dd className="font-semibold text-slate-800">{form.levelCode || 'Belum diisi'}</dd>
                  </>
                )}
                <dt className="text-slate-500">T. BPJS TK / Kesehatan</dt>
                <dd className="font-semibold text-slate-800">{formatIDR(form.bpjsTk)} / {formatIDR(form.bpjsKes)}</dd>
                <dt className="text-slate-500">NIPY</dt>
                <dd className="font-mono font-semibold text-slate-800">{preview.employee.nipy || '-'}</dd>
                <dt className="text-slate-500">Akun login</dt>
                <dd className="font-semibold text-slate-800">
                  {preview.linkedAccount ? 'Dialihkan ke peran Loyalis' : 'Tidak ada'}
                </dd>
              </dl>
              <IssueList issues={warnings} tone="warn" />
              <div className="space-y-2">
                <Label>Alasan pengalihan</Label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={EMPLOYEE_CONVERSION_REASON_MAX_LENGTH}
                  rows={3}
                  placeholder="Contoh: SK pengangkatan Loyalis No. ..."
                  className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                {reason.length > 0 && !reasonValid && (
                  <FieldError message={`Minimal ${EMPLOYEE_CONVERSION_REASON_MIN_LENGTH} karakter.`} />
                )}
              </div>
              {submitError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{submitError}</div>
              )}
            </>
          )}

          {step === 'done' && outcome && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="h-5 w-5" />
                Berhasil. {employee.name} sekarang Loyalis ({outcome.loyalisEmployeeId}) mulai{' '}
                {conversionPeriodLabel(outcome.effectivePeriod)}.
              </div>
              <div className="space-y-2">
                <p className="text-sm font-bold text-slate-800">Langkah berikutnya:</p>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
                  <li>
                    Ubah departemen pegawai ini di <span className="font-semibold">mesin absen</span> dari
                    TEKNISI/CS/SECURITY/DRIVER ke unitnya, supaya scan-nya terbaca di presensi Loyalis.
                  </li>
                  {outcome.linkedAccountUid && (
                    <li>Minta pegawai keluar lalu masuk lagi ke aplikasi agar menu Loyalis muncul.</li>
                  )}
                  {!form?.levelCode && <li>Super Admin perlu mengisi golongan di data Loyalis-nya.</li>}
                  <li>Lengkapi jabatan struktural dan data Loyalis lain bila perlu.</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 p-4">
          <div>
            {step === 'check' && (
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => void reloadPreview()}
                className="rounded-xl text-slate-600"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Periksa ulang
              </Button>
            )}
            {(step === 'form' || step === 'confirm') && (
              <Button
                type="button"
                variant="ghost"
                disabled={submitting}
                onClick={() => setStep(step === 'confirm' ? 'form' : 'check')}
                className="rounded-xl text-slate-600"
              >
                Kembali
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {step !== 'done' && (
              <Button type="button" variant="outline" disabled={submitting} onClick={handleClose} className="rounded-xl">
                Batal
              </Button>
            )}
            {step === 'check' && (
              <Button
                type="button"
                disabled={!preview || preview.blockers.length > 0 || loading}
                onClick={() => setStep('form')}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Lanjut
              </Button>
            )}
            {step === 'form' && (
              <Button
                type="button"
                onClick={() => {
                  setShowErrors(true);
                  if (!hasErrors) setStep('confirm');
                }}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Lanjut
              </Button>
            )}
            {step === 'confirm' && (
              <Button
                type="button"
                disabled={submitting || !reasonValid || hasErrors}
                onClick={() => void handleSubmit()}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Alihkan sekarang
              </Button>
            )}
            {step === 'done' && outcome && (
              <>
                <Button type="button" variant="outline" onClick={onClose} className="rounded-xl">
                  Tutup
                </Button>
                <Button
                  type="button"
                  onClick={() => onOpenLoyalisRecord(outcome.loyalisEmployeeId)}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Lihat data Loyalis
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
