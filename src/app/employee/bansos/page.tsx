"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Baby,
  Check,
  ChevronLeft,
  ChevronsUpDown,
  Flower2,
  HandHeart,
  Loader2,
  LogOut,
  Paperclip,
  Send,
  X,
} from 'lucide-react';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import { useConfirmLogout } from '@/components/LogoutConfirmProvider';
import {
  BansosProofButton,
  BansosStatusBadge,
  SideDecision,
  bansosSubjectText,
  formatBansosDate,
  formatRupiah,
} from '@/components/bansos/BansosParts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { OptionSelect } from '@/components/ui/option-select';
import { useAuth } from '@/lib/AuthContext';
import {
  BANSOS_KIND_LABELS,
  BANSOS_RELATIONSHIPS,
  isBansosAwaiting,
  type BansosKind,
  type BansosRequest,
} from '@/lib/payroll/bansos';
import { authenticatedFormData, authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import { UPLOAD_ACCEPT, UPLOAD_TYPES_TEXT, uploadFileProblem } from '@/lib/uploadFileTypes';

interface BansosData {
  employeeName: string;
  employeeClass: 'loyalis' | 'pekarya';
  defaultAmounts: Record<BansosKind, number>;
  requests: BansosRequest[];
}

const SUBMITTER_ROLES = ['loyalis', 'honorer', 'ketua_shift_satpam'];

function todayInJakarta(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

const KIND_OPTIONS = ['duka', 'melahirkan'] as const;

const KIND_DETAILS: Record<BansosKind, { icon: typeof Flower2; hint: string }> = {
  duka: { icon: Flower2, hint: 'Keluarga meninggal dunia' },
  melahirkan: { icon: Baby, hint: 'Kelahiran anak' },
};

/** The icon tile and the two lines of a kind; `kind` null is the "nothing chosen yet" card. */
function KindCard({ kind, amount, active }: { kind: BansosKind | null; amount?: number; active: boolean }) {
  const Icon = kind ? KIND_DETAILS[kind].icon : HandHeart;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-sm ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-800">{kind ? BANSOS_KIND_LABELS[kind] : 'Pilih jenis ajuan'}</span>
        <span className="block text-xs text-slate-500">
          {kind ? `${KIND_DETAILS[kind].hint}${amount ? ` · ${formatRupiah(amount)}` : ''}` : 'Duka atau Melahirkan'}
        </span>
      </span>
    </span>
  );
}

const inputClass =
  'h-11 rounded-sm border-slate-200 font-semibold text-slate-700 text-sm hover:border-indigo-300 focus:border-indigo-500 transition-all placeholder:text-slate-400';
const labelClass = 'block text-xs font-bold text-slate-500 uppercase tracking-wider';

export default function BansosRequestPage() {
  const { profile: rawProfile, activeProfile, loading: authLoading } = useAuth();
  const requestLogout = useConfirmLogout();
  const profile = activeProfile || rawProfile;
  const role = profile?.role;
  const linkedEmployeeId = profile?.linkedEmployeeId;
  const canSubmit = Boolean(role && SUBMITTER_ROLES.includes(role) && linkedEmployeeId);
  const today = todayInJakarta();

  const [data, setData] = useState<BansosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<SnackbarMessage | null>(null);

  const [kind, setKind] = useState<BansosKind | null>(null);
  const [eventDate, setEventDate] = useState('');
  const [relationship, setRelationship] = useState('');
  const [relationshipOther, setRelationshipOther] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [proofProblem, setProofProblem] = useState('');
  const [formError, setFormError] = useState('');
  const [sending, setSending] = useState(false);
  const submissionIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [withdrawTarget, setWithdrawTarget] = useState<BansosRequest | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const load = useCallback(async () => {
    if (!canSubmit) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setData(await authenticatedJson<BansosData>('/api/employee/bansos'));
      setLoadError('');
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Data ajuan gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, [canSubmit]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Any change to the form makes it a new ajuan, so a retry of the old one
  // can never be mistaken for it.
  const edited = () => {
    submissionIdRef.current = null;
    setFormError('');
  };

  const resetForm = () => {
    setKind(null);
    setEventDate('');
    setRelationship('');
    setRelationshipOther('');
    setSubjectName('');
    setNote('');
    setProof(null);
    setProofProblem('');
    submissionIdRef.current = null;
  };

  const chooseKind = (next: BansosKind) => {
    setKind(next);
    setEventDate('');
    setRelationship('');
    setRelationshipOther('');
    setSubjectName('');
    edited();
  };

  const missing = (): string => {
    if (!kind) return 'Pilih jenis ajuan terlebih dahulu.';
    if (!eventDate) return kind === 'duka' ? 'Isi tanggal meninggal.' : 'Isi tanggal lahir.';
    if (eventDate > today) return 'Tanggal tidak boleh setelah hari ini.';
    if (kind === 'duka') {
      if (!relationship) return 'Pilih hubungan keluarga.';
      if (relationship === 'lainnya' && relationshipOther.trim().length < 2) return 'Tuliskan hubungan keluarga.';
      if (subjectName.trim().length < 2) return 'Isi nama almarhum/almarhumah.';
    }
    if (!proof) return 'Lampirkan bukti terlebih dahulu.';
    if (proofProblem) return proofProblem;
    return '';
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;
    const problem = missing();
    if (problem) {
      setFormError(problem);
      return;
    }
    const form = new FormData();
    submissionIdRef.current ||= createFinancialRequestId('bansos');
    form.set('requestId', submissionIdRef.current);
    form.set('kind', kind!);
    form.set('eventDate', eventDate);
    form.set('subjectName', subjectName);
    if (kind === 'duka') {
      form.set('relationship', relationship);
      if (relationship === 'lainnya') form.set('relationshipOther', relationshipOther);
    }
    if (note.trim()) form.set('note', note);
    form.set('file', proof!);
    setSending(true);
    try {
      await authenticatedFormData('/api/employee/bansos', form);
      resetForm();
      setNotice({ type: 'success', text: 'Ajuan terkirim. Admin Karyawan dan Super Admin akan memeriksanya.' });
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Ajuan gagal dikirim.');
    } finally {
      setSending(false);
    }
  };

  const withdraw = async () => {
    if (!withdrawTarget || withdrawing) return;
    setWithdrawing(true);
    try {
      await authenticatedJson(`/api/employee/bansos?requestId=${encodeURIComponent(withdrawTarget.id)}`, { method: 'DELETE' });
      setNotice({ type: 'success', text: 'Ajuan ditarik.' });
      setWithdrawTarget(null);
      await load();
    } catch (cause) {
      setNotice({ type: 'error', text: cause instanceof Error ? cause.message : 'Ajuan gagal ditarik.' });
    } finally {
      setWithdrawing(false);
    }
  };

  if (authLoading) return <div className="min-h-screen bg-slate-50" />;
  if (!canSubmit) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-6">
        <div className="w-full max-w-md bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 text-center space-y-4">
          <h1 className="text-lg font-bold text-slate-800">Ajuan BanSos Tidak Tersedia</h1>
          <p className="text-sm text-slate-500">Halaman ini untuk akun Loyalis atau Pekarya yang terhubung ke data pegawai.</p>
          <Button className="rounded-sm" variant="outline" render={<Link href="/employee/payslip" />}>Kembali ke Slip Gaji</Button>
        </div>
      </div>
    );
  }

  const amountFor = (value: BansosKind) => data?.defaultAmounts[value];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
      <FloatingSnackbar message={notice} onDismiss={() => setNotice(null)} />

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/employee/payslip" aria-label="Kembali ke Slip Gaji" className="rounded-sm p-2 text-slate-500 hover:bg-slate-100"><ChevronLeft className="size-5" /></Link>
          <div className="flex size-9 items-center justify-center rounded-sm bg-indigo-600 text-white"><HandHeart className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-800">Ajuan BanSos</p>
            <p className="truncate text-xs text-slate-500">{profile?.displayName || profile?.email}</p>
          </div>
          <EmployeeNavigationMenu />
          <Button className="rounded-sm" type="button" variant="ghost" size="icon" onClick={requestLogout} aria-label="Keluar"><LogOut className="size-4" /></Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl space-y-8 px-4 py-6 pb-24 sm:px-6 sm:py-8">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold text-slate-800">Bantuan Sosial</h1>
          <p className="text-slate-500 text-sm">Ajukan santunan duka atau melahirkan. Admin Karyawan dan Super Admin memeriksa ajuan, lalu santunan dibayarkan bersama gaji.</p>
        </div>

        {loadError && (
          <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-md text-sm font-medium bg-red-50 text-red-700 border border-red-200">
            <AlertCircle className="size-4 shrink-0" /> {loadError}
          </div>
        )}

        <section className="bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5 sm:p-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Memuat data...</div>
          ) : (
            <form onSubmit={submit} className="space-y-6" noValidate>
              <div className="space-y-2">
                <span id="bansos-kind-label" className={labelClass}>Jenis ajuan</span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-labelledby="bansos-kind-label"
                    className="flex w-full items-center gap-3 rounded-md border border-slate-200 bg-white p-4 text-left transition-all hover:border-indigo-300 hover:bg-slate-50 focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-indigo-500/25 data-[popup-open]:border-indigo-500 cursor-pointer"
                  >
                    <KindCard kind={kind} amount={kind ? amountFor(kind) : undefined} active={Boolean(kind)} />
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-indigo-600">
                      Ganti <ChevronsUpDown className="size-4" />
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-(--anchor-width) rounded-md p-1.5">
                    {KIND_OPTIONS.map((value) => (
                      <DropdownMenuItem
                        key={value}
                        onClick={() => chooseKind(value)}
                        className="rounded-sm p-2.5 text-sm data-highlighted:bg-indigo-50"
                      >
                        <KindCard kind={value} amount={amountFor(value)} active={kind === value} />
                        {kind === value && <Check className="size-4 shrink-0 text-indigo-600" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {kind === 'duka' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="bansos-relationship" className={labelClass}>Hubungan keluarga</label>
                    <OptionSelect
                      id="bansos-relationship"
                      value={relationship}
                      placeholder="Pilih hubungan"
                      onValueChange={(value) => { setRelationship(value); edited(); }}
                      options={BANSOS_RELATIONSHIPS}
                    />
                  </div>
                  {relationship === 'lainnya' && (
                    <div className="space-y-2">
                      <label htmlFor="bansos-relationship-other" className={labelClass}>Hubungan lainnya</label>
                      <Input id="bansos-relationship-other" value={relationshipOther} maxLength={80} placeholder="Contoh: Paman"
                        onChange={(event) => { setRelationshipOther(event.target.value); edited(); }} className={inputClass} />
                    </div>
                  )}
                  <div className="space-y-2">
                    <label htmlFor="bansos-subject" className={labelClass}>Nama almarhum/almarhumah</label>
                    <Input id="bansos-subject" value={subjectName} maxLength={120}
                      onChange={(event) => { setSubjectName(event.target.value); edited(); }} className={inputClass} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="bansos-date" className={labelClass}>Tanggal meninggal</label>
                    <Input id="bansos-date" type="date" max={today} value={eventDate}
                      onChange={(event) => { setEventDate(event.target.value); edited(); }} className={inputClass} />
                  </div>
                </div>
              )}

              {kind === 'melahirkan' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="bansos-date" className={labelClass}>Tanggal lahir</label>
                    <Input id="bansos-date" type="date" max={today} value={eventDate}
                      onChange={(event) => { setEventDate(event.target.value); edited(); }} className={inputClass} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="bansos-subject" className={labelClass}>Nama bayi <span className="normal-case font-medium text-slate-400">(boleh dikosongkan)</span></label>
                    <Input id="bansos-subject" value={subjectName} maxLength={120}
                      onChange={(event) => { setSubjectName(event.target.value); edited(); }} className={inputClass} />
                  </div>
                </div>
              )}

              {kind && (
                <>
                  <div className="space-y-2">
                    <label htmlFor="bansos-note" className={labelClass}>Keterangan <span className="normal-case font-medium text-slate-400">(boleh dikosongkan)</span></label>
                    <textarea id="bansos-note" value={note} maxLength={500} rows={3}
                      onChange={(event) => { setNote(event.target.value); edited(); }}
                      className="w-full rounded-sm border border-slate-200 p-3 text-sm font-semibold text-slate-700 hover:border-indigo-300 focus:border-indigo-500 focus:outline-none transition-all" />
                  </div>

                  <div className="space-y-2">
                    <span className={labelClass}>Bukti</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept={UPLOAD_ACCEPT}
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        event.target.value = '';
                        if (!file) return;
                        setProof(file);
                        setProofProblem(uploadFileProblem(file) || '');
                        edited();
                      }}
                    />
                    {proof ? (
                      <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${proofProblem ? 'border-red-200' : 'border-slate-200'}`}>
                        <Paperclip className="size-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1 truncate text-slate-700">{proof.name}</span>
                        <button type="button" aria-label="Hapus bukti" title="Hapus bukti"
                          onClick={() => { setProof(null); setProofProblem(''); edited(); }}
                          className="rounded-sm p-1 text-rose-600 hover:bg-rose-50 cursor-pointer">
                          <X className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}
                        className="rounded-sm border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 bg-white font-semibold shadow-sm h-10">
                        <Paperclip className="size-4" /> Lampirkan bukti
                      </Button>
                    )}
                    {proofProblem ? (
                      <p role="alert" className="text-xs text-red-700">{proofProblem}</p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Wajib: {kind === 'duka' ? 'surat kematian atau keterangan dari desa/kelurahan' : 'surat keterangan lahir atau akta kelahiran'}. {UPLOAD_TYPES_TEXT}, maks 5 MB.
                      </p>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-600">
                    Santunan: <span className="font-bold text-slate-800">{amountFor(kind) ? formatRupiah(amountFor(kind)!) : '—'}</span>
                    <span className="text-slate-500"> · dapat disesuaikan Super Admin</span>
                  </div>
                </>
              )}

              {formError && (
                <div role="alert" className="flex items-center gap-2 px-4 py-3 rounded-md text-sm font-medium bg-red-50 text-red-700 border border-red-200">
                  <AlertCircle className="size-4 shrink-0" /> {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={sending || !data}
                className="w-full justify-center rounded-sm px-6 py-3 bg-indigo-600 shadow-lg shadow-indigo-200 text-white font-bold transition-all hover:bg-indigo-700 hover:shadow-indigo-300 flex items-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                {sending ? <><Loader2 className="size-4 animate-spin" /> Mengirim...</> : <><Send className="size-4" /> Kirim Ajuan</>}
              </button>
            </form>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-800">Riwayat Ajuan</h2>
          {!loading && (data?.requests.length || 0) === 0 && (
            <p className="rounded-md bg-white p-5 text-sm text-slate-500 shadow-sm">Belum ada ajuan.</p>
          )}
          {data?.requests.map((item) => (
            <article key={item.id} className="bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-800">{BANSOS_KIND_LABELS[item.kind]}</p>
                  <p className="text-xs text-slate-500">
                    {formatBansosDate(item.eventDate)}{bansosSubjectText(item) !== '—' ? ` · ${bansosSubjectText(item)}` : ''}
                  </p>
                </div>
                <BansosStatusBadge status={item.status} />
              </div>
              {item.status !== 'withdrawn' && (
                <div className="space-y-1">
                  <SideDecision request={item} side="admin" />
                  <SideDecision request={item} side="finance" />
                </div>
              )}
              <p className="text-sm text-slate-600">
                Santunan <span className="font-bold text-slate-800">{formatRupiah(item.amount)}</span>
                {item.status === 'paid' ? ' · dibayarkan bersama gaji' : ''}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <BansosProofButton request={item} />
                {isBansosAwaiting(item.status) && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setWithdrawTarget(item)}
                    className="rounded-sm text-rose-600 border border-rose-200 bg-rose-50 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 shadow-sm">
                    Tarik ajuan
                  </Button>
                )}
              </div>
            </article>
          ))}
        </section>
      </main>

      <ConfirmDialog
        open={Boolean(withdrawTarget)}
        onOpenChange={(open) => { if (!open && !withdrawing) setWithdrawTarget(null); }}
        title="Tarik ajuan?"
        description={<>{withdrawTarget ? BANSOS_KIND_LABELS[withdrawTarget.kind] : ''} ini dibatalkan dan tidak akan diperiksa. Anda dapat mengajukan lagi kapan saja.</>}
        confirmLabel="Tarik ajuan"
        destructive
        loading={withdrawing}
        onConfirm={() => void withdraw()}
      />
    </div>
  );
}
