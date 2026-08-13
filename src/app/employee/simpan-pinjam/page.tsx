"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Banknote,
  Check,
  ChevronLeft,
  Clock,
  History,
  Info,
  Loader2,
  Plus,
  ReceiptText,
  Scale,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import { useAuth } from '@/lib/AuthContext';
import { authenticatedJson } from '@/lib/payroll/client';
import {
  composeKoperasiLoanHistoryTrail,
  koperasiMonthlyInstallment,
  resolveKoperasiLoanStatus,
  type KoperasiLoanLike,
} from '@/lib/payroll/koperasiLoan';
import {
  canCancelKoperasiLoan,
  canRespondToKoperasiRevision,
  canRestructureKoperasiLoan,
  isKoperasiActiveStatus,
  koperasiAdminFee,
  koperasiApprovalStepIndex,
  koperasiLoanStatusTone,
  koperasiOutstandingBalance,
  koperasiRemainingTenor,
  quoteKoperasiRestructuring,
  KOPERASI_ADMIN_FEE_TIERS,
  KOPERASI_APPROVAL_STEPS,
  KOPERASI_BANKS,
  KOPERASI_MAX_LOAN,
  KOPERASI_MAX_NOTE_LENGTH,
  KOPERASI_MAX_PURPOSE_LENGTH,
  KOPERASI_MAX_TENOR,
  KOPERASI_MIN_LOAN,
  KOPERASI_MIN_TENOR,
  type KoperasiStatusTone,
} from '@/lib/payroll/koperasiLoanApplication';

interface LoanRow extends KoperasiLoanLike {
  id: string;
  tujuanPinjaman?: string;
  catatanTambahan?: string[];
  alasanPenolakan?: string;
  revisiJumlah?: number;
  biayaAdmin?: number;
  sisaPinjamanSebelumnya?: number;
  pinjamanBaru?: number;
  additionalTenor?: number;
  bankDetails?: { bank?: string; nomorRekening?: string };
}

interface Membership {
  approved: boolean;
  nama: string;
  nomorAnggota: string;
  satuanKerja: string;
  paymentStatus: string;
  bank: string;
  nomorRekening: string;
}

interface LoansResponse {
  loans: LoanRow[];
  membership: Membership;
  canApply: boolean;
}

const TENOR_OPTIONS = Array.from(
  { length: KOPERASI_MAX_TENOR - KOPERASI_MIN_TENOR + 1 },
  (_, index) => KOPERASI_MIN_TENOR + index,
);

const rupiah = (value: unknown) => `Rp ${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;

/** Digits only, grouped with the Indonesian thousands separator. */
const formatAmountInput = (raw: string) =>
  raw.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const parseAmountInput = (raw: string) => Number(raw.replace(/\D/g, '')) || 0;

function formatDate(value: unknown): string {
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis <= 0) return '—';
  return new Date(millis).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const TONE_CLASSES: Record<KoperasiStatusTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
  restructure: 'bg-purple-50 text-purple-700 border-purple-200',
  pending: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={`border text-[10px] font-bold rounded-lg px-2 py-0.5 ${TONE_CLASSES[koperasiLoanStatusTone(status)]}`}
    >
      {status}
    </Badge>
  );
}

/** Where an application sits on the BAK → Warek 2 → transfer → active chain. */
function ApprovalTracker({ status }: { status: string }) {
  const currentIndex = koperasiApprovalStepIndex(status);
  if (currentIndex < 0) return null;

  const labels = ['Diajukan ke BAK', 'Persetujuan Warek 2', 'Menunggu Transfer', 'Aktif'];

  return (
    <div className="flex items-center gap-1.5">
      {KOPERASI_APPROVAL_STEPS.map((step, index) => {
        const reached = index <= currentIndex;
        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                  reached ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-400'
                }`}
              >
                {index < currentIndex ? (
                  <Check className="w-3 h-3" />
                ) : index === currentIndex ? (
                  <Clock className="w-3 h-3" />
                ) : (
                  <span className="text-[9px] font-bold">{index + 1}</span>
                )}
              </div>
              <span
                className={`text-[9px] font-semibold text-center leading-tight ${
                  reached ? 'text-indigo-700' : 'text-slate-400'
                }`}
              >
                {labels[index]}
              </span>
            </div>
            {index < KOPERASI_APPROVAL_STEPS.length - 1 && (
              <div
                className={`h-0.5 flex-1 rounded-full -mt-4 ${
                  index < currentIndex ? 'bg-indigo-600' : 'bg-slate-200'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function DetailRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: 'indigo' | 'amber' | 'default';
}) {
  const valueClass =
    emphasis === 'indigo'
      ? 'text-indigo-600 font-bold'
      : emphasis === 'amber'
        ? 'text-amber-700 font-bold'
        : 'text-slate-800 font-semibold';
  return (
    <div className="flex justify-between items-center gap-3 text-xs">
      <span className="text-slate-400 font-medium shrink-0">{label}</span>
      <span className={`text-right ${valueClass}`}>{value}</span>
    </div>
  );
}

function LoanTerms() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5 text-indigo-500" /> Ketentuan Pinjaman
        </h3>
        <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 leading-relaxed">
          <li>Lama cicilan maksimum {KOPERASI_MAX_TENOR} bulan.</li>
          <li>
            Setiap anggota maksimal boleh meminjam sebesar cicilan per bulannya 40% dari take home
            pay / pendapatan rata-rata dalam 1 tahun.
          </li>
          <li>Waktu pencairan pinjaman tiap hari Selasa (kecuali hari libur).</li>
          <li>
            Nominal pinjaman antara {rupiah(KOPERASI_MIN_LOAN)} sampai {rupiah(KOPERASI_MAX_LOAN)}.
          </li>
        </ul>
      </div>

      <div>
        <h3 className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
          <ReceiptText className="w-3.5 h-3.5 text-indigo-500" /> Biaya Administrasi
        </h3>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <th className="text-left font-semibold px-3 py-2">Besaran Pinjaman</th>
                <th className="text-right font-semibold px-3 py-2">Biaya Adm*</th>
              </tr>
            </thead>
            <tbody>
              {KOPERASI_ADMIN_FEE_TIERS.map((tier) => (
                <tr key={tier.label} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-600 font-medium">{tier.label}</td>
                  <td className="px-3 py-2 text-right text-slate-800 font-semibold">
                    {rupiah(tier.fee)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5 font-medium">
          *sudah termasuk biaya transfer &amp; dipotong pada penerimaan pinjaman.
        </p>
      </div>
    </div>
  );
}

export default function EmployeeSimpanPinjamPage() {
  const { profile: rawProfile, activeProfile } = useAuth();
  const profile = activeProfile || rawProfile;

  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [canApply, setCanApply] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<SnackbarMessage | null>(null);
  const [tab, setTab] = useState<'berjalan' | 'riwayat' | 'ketentuan'>('berjalan');
  const [busyLoanId, setBusyLoanId] = useState<string | null>(null);

  const [showApply, setShowApply] = useState(false);
  const [applyAmount, setApplyAmount] = useState('');
  const [applyTenor, setApplyTenor] = useState(String(KOPERASI_MIN_TENOR));
  const [applyPurpose, setApplyPurpose] = useState('');
  const [applyNote, setApplyNote] = useState('');
  const [applyBank, setApplyBank] = useState('');
  const [applyAccount, setApplyAccount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [restructureLoan, setRestructureLoan] = useState<LoanRow | null>(null);
  const [restructureAmount, setRestructureAmount] = useState('');
  const [restructureTenor, setRestructureTenor] = useState<number | null>(null);
  const [restructureBank, setRestructureBank] = useState('');
  const [restructureAccount, setRestructureAccount] = useState('');

  const [detailLoan, setDetailLoan] = useState<LoanRow | null>(null);

  const loadLoans = useCallback(async () => {
    try {
      const data = await authenticatedJson<LoansResponse>('/api/koperasi/loans');
      setLoans(data.loans || []);
      setMembership(data.membership);
      setCanApply(Boolean(data.canApply));
      setLoadError(null);
    } catch (error) {
      console.error('Error loading cooperative loans:', error);
      setLoadError(
        error instanceof Error ? error.message : 'Gagal memuat data simpan pinjam.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Non-Loyalis roles never fetch; the render guard below short-circuits
    // before `loading` is ever consulted for them.
    if (profile?.role !== 'loyalis') return;
    void loadLoans();
  }, [profile?.role, loadLoans]);

  const { activeLoans, pastLoans, totals } = useMemo(() => {
    const withStatus = loans.map((loan) => ({
      loan,
      status: resolveKoperasiLoanStatus(loan),
    }));
    const active = withStatus.filter((entry) => isKoperasiActiveStatus(entry.status));
    const past = withStatus.filter((entry) => !isKoperasiActiveStatus(entry.status));

    const running = active.filter((entry) => entry.status === 'Disetujui dan Aktif');
    return {
      activeLoans: active,
      pastLoans: past,
      totals: {
        outstanding: running.reduce(
          (sum, entry) => sum + koperasiOutstandingBalance(entry.loan),
          0,
        ),
        monthly: running.reduce(
          (sum, entry) => sum + koperasiMonthlyInstallment(entry.loan),
          0,
        ),
        runningCount: running.length,
      },
    };
  }, [loans]);

  const restructureQuote = useMemo(
    () =>
      restructureLoan
        ? quoteKoperasiRestructuring(
            restructureLoan,
            parseAmountInput(restructureAmount),
            restructureTenor || 0,
          )
        : null,
    [restructureLoan, restructureAmount, restructureTenor],
  );

  const applyAmountValue = parseAmountInput(applyAmount);
  const applyTenorValue = Number(applyTenor);
  const applyInstallment =
    applyTenorValue > 0 ? Math.round(applyAmountValue / applyTenorValue) : 0;

  const openApplyDialog = () => {
    setApplyAmount('');
    setApplyTenor(String(KOPERASI_MIN_TENOR));
    setApplyPurpose('');
    setApplyNote('');
    setApplyBank(membership?.bank || '');
    setApplyAccount(membership?.nomorRekening || '');
    setShowApply(true);
  };

  const openRestructureDialog = (loan: LoanRow) => {
    setRestructureLoan(loan);
    setRestructureAmount('');
    setRestructureTenor(null);
    setRestructureBank(loan.bankDetails?.bank || membership?.bank || '');
    setRestructureAccount(loan.bankDetails?.nomorRekening || membership?.nomorRekening || '');
  };

  const handleApply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await authenticatedJson('/api/koperasi/loans', {
        method: 'POST',
        body: JSON.stringify({
          action: 'apply',
          amount: applyAmountValue,
          tenor: applyTenorValue,
          purpose: applyPurpose,
          note: applyNote,
          bank: applyBank,
          accountNumber: applyAccount,
        }),
      });
      setShowApply(false);
      setMessage({
        type: 'success',
        text: 'Pengajuan pinjaman terkirim. Tim BAK akan meninjau pengajuan Anda.',
      });
      setTab('berjalan');
      await loadLoans();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal mengajukan pinjaman.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestructure = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || !restructureLoan || !restructureQuote || restructureQuote.error) return;
    setSubmitting(true);
    try {
      await authenticatedJson('/api/koperasi/loans', {
        method: 'POST',
        body: JSON.stringify({
          action: 'restructure',
          loanId: restructureLoan.id,
          additionalAmount: restructureQuote.additionalAmount,
          additionalTenor: restructureQuote.additionalTenor,
          bank: restructureBank,
          accountNumber: restructureAccount,
        }),
      });
      setRestructureLoan(null);
      setMessage({
        type: 'success',
        text: 'Pengajuan restrukturisasi terkirim. Pinjaman lama menunggu persetujuan BAK.',
      });
      await loadLoans();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal mengajukan restrukturisasi.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const runLoanAction = async (
    loan: LoanRow,
    action: 'cancel' | 'accept-revision' | 'reject-revision',
    successText: string,
    confirmText?: string,
  ) => {
    if (busyLoanId) return;
    if (confirmText && !confirm(confirmText)) return;
    setBusyLoanId(loan.id);
    try {
      await authenticatedJson('/api/koperasi/loans', {
        method: 'POST',
        body: JSON.stringify({ action, loanId: loan.id }),
      });
      setMessage({ type: 'success', text: successText });
      await loadLoans();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Tindakan gagal diproses.',
      });
    } finally {
      setBusyLoanId(null);
    }
  };

  const findLoan = (loanId?: string) => loans.find((loan) => loan.id === loanId);

  // ─── Guard states ───────────────────────────────────────────────────────

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/70 to-slate-100 font-sans text-slate-800">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">{children}</div>
      <FloatingSnackbar message={message} onDismiss={() => setMessage(null)} />
    </div>
  );

  const header = (
    <>
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
        {canApply && (
          <Button
            onClick={openApplyDialog}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-3.5 shadow-sm cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Ajukan Pinjaman
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-inner shrink-0">
          <Banknote className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Simpan Pinjam
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm">
            Ajukan, restrukturisasi, dan pantau cicilan pinjaman Koperasi UNIPDU Anda.
          </p>
        </div>
      </div>
    </>
  );

  const spinner = shell(
    <div className="py-24 flex flex-col items-center gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      <p className="text-slate-500 font-medium text-sm">Memuat data simpan pinjam...</p>
    </div>,
  );

  // While the session is still resolving, an unknown role must not be mistaken
  // for a forbidden one.
  if (!profile) return spinner;

  if (profile.role !== 'loyalis') {
    return shell(
      <>
        {header}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-6 text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-800">Akses Ditolak</h2>
          <p className="text-sm text-slate-500">
            Halaman Simpan Pinjam hanya tersedia untuk pegawai Loyalis.
          </p>
        </Card>
      </>,
    );
  }

  if (loading) return spinner;

  if (loadError) {
    return shell(
      <>
        {header}
        <Card className="rounded-2xl border-amber-200 shadow-sm bg-amber-50/60 p-6 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-amber-900">Data belum dapat ditampilkan</h2>
              <p className="text-xs text-amber-800 leading-relaxed">{loadError}</p>
            </div>
          </div>
          <Button
            onClick={() => {
              setLoading(true);
              loadLoans();
            }}
            className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-9 px-4 cursor-pointer"
          >
            Coba Lagi
          </Button>
        </Card>
      </>,
    );
  }

  if (membership && !membership.approved) {
    return shell(
      <>
        {header}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-6 space-y-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
            <Info className="w-5 h-5" />
          </div>
          <h2 className="text-base font-bold text-slate-800">Keanggotaan Belum Aktif</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            Akun Anda sudah tertaut ke Koperasi UNIPDU, tetapi status keanggotaannya belum
            disetujui. Hubungi pengurus koperasi untuk mengaktifkan keanggotaan sebelum mengajukan
            pinjaman.
          </p>
          <div className="pt-2">
            <LoanTerms />
          </div>
        </Card>
      </>,
    );
  }

  // ─── Main view ──────────────────────────────────────────────────────────

  return shell(
    <>
      {header}

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Sisa Hutang
          </p>
          <p className="text-sm sm:text-base font-bold text-amber-700 mt-1 break-words">
            {rupiah(totals.outstanding)}
          </p>
        </Card>
        <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Cicilan / Bulan
          </p>
          <p className="text-sm sm:text-base font-bold text-indigo-600 mt-1 break-words">
            {rupiah(totals.monthly)}
          </p>
        </Card>
        <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Pinjaman Aktif
          </p>
          <p className="text-sm sm:text-base font-bold text-slate-900 mt-1">
            {totals.runningCount}
          </p>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100/70 p-1 rounded-xl">
        {([
          ['berjalan', `Berjalan (${activeLoans.length})`],
          ['riwayat', `Riwayat (${pastLoans.length})`],
          ['ketentuan', 'Ketentuan'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 px-3 py-2 text-[11px] sm:text-xs font-bold rounded-lg transition-all cursor-pointer ${
              tab === key ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'ketentuan' && (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-5">
          <LoanTerms />
        </Card>
      )}

      {tab === 'berjalan' && activeLoans.length === 0 && (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-8 text-center space-y-3">
          <Wallet className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-sm font-semibold text-slate-600">
            Tidak ada pinjaman yang sedang berjalan
          </p>
          <p className="text-xs text-slate-400">
            Anda dapat mengajukan pinjaman baru kapan saja selama tidak ada pengajuan berjalan.
          </p>
          <Button
            onClick={openApplyDialog}
            disabled={!canApply}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-4 cursor-pointer"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Ajukan Pinjaman Baru
          </Button>
        </Card>
      )}

      {tab === 'riwayat' && pastLoans.length === 0 && (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-8 text-center">
          <History className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">Belum ada riwayat pinjaman</p>
        </Card>
      )}

      {(tab === 'berjalan' ? activeLoans : tab === 'riwayat' ? pastLoans : []).map(
        ({ loan, status }) => {
          const installment = koperasiMonthlyInstallment(loan);
          const outstanding = koperasiOutstandingBalance(loan);
          const paid = Math.max(0, Math.floor(Number(loan.jumlahMenyicil) || 0));
          const tenor = Math.max(0, Math.floor(Number(loan.tenor) || 0));
          const progress = tenor > 0 ? Math.min(100, (paid / tenor) * 100) : 0;
          const isRunning = status === 'Disetujui dan Aktif';
          const pendingRestructure = status === 'Menunggu Persetujuan Restrukturisasi';
          const busy = busyLoanId === loan.id;

          return (
            <Card
              key={loan.id}
              className="rounded-2xl border-slate-200/80 shadow-sm bg-white p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-900">
                      Pinjaman #{loan.id.substring(0, 8)}
                    </h3>
                    {loan.restructuredFromLoanId && (
                      <Badge className="bg-purple-50 text-purple-700 border border-purple-200 text-[9px] font-bold rounded px-1.5 py-0">
                        Hasil Restrukturisasi
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                    {loan.tujuanPinjaman || 'Tanpa keterangan tujuan'} ·{' '}
                    {formatDate(loan.tanggalPengajuan)}
                  </p>
                </div>
                <StatusBadge status={status} />
              </div>

              {/* Approval progress for applications still in the pipeline */}
              {!isRunning && koperasiApprovalStepIndex(status) >= 0 && (
                <div className="bg-slate-50/70 rounded-xl p-3.5 border border-slate-100">
                  <ApprovalTracker status={status} />
                </div>
              )}

              {pendingRestructure && (
                <div className="rounded-xl bg-purple-50 border border-purple-200 px-3.5 py-2.5 text-[11px] font-semibold text-purple-800 flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Restrukturisasi sedang diproses
                  </span>
                  {findLoan(loan.restructuredToLoanId) && (
                    <button
                      type="button"
                      onClick={() => setDetailLoan(findLoan(loan.restructuredToLoanId)!)}
                      className="underline cursor-pointer hover:text-purple-950"
                    >
                      Lihat pengajuan #{loan.restructuredToLoanId!.substring(0, 8)} →
                    </button>
                  )}
                </div>
              )}

              {status === 'Direvisi BAK' && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3 space-y-1.5">
                  <p className="text-[11px] font-bold text-amber-900">
                    BAK mengajukan revisi atas pengajuan Anda
                  </p>
                  {Number(loan.revisiJumlah) > 0 && (
                    <p className="text-xs text-amber-800 font-semibold">
                      Jumlah direvisi menjadi {rupiah(loan.revisiJumlah)} (semula{' '}
                      {rupiah(loan.jumlahPinjaman)}).
                    </p>
                  )}
                  <p className="text-[11px] text-amber-700">
                    Terima revisi untuk melanjutkan ke persetujuan Wakil Rektor 2, atau tolak untuk
                    menghentikan pengajuan.
                  </p>
                </div>
              )}

              {loan.alasanPenolakan && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5">
                  <p className="text-[10px] font-bold text-rose-900 uppercase tracking-wider mb-0.5">
                    Alasan Penolakan
                  </p>
                  <p className="text-xs text-rose-800 font-medium">{loan.alasanPenolakan}</p>
                </div>
              )}

              {/* Installment progress for a live loan */}
              {isRunning && tenor > 0 && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] font-semibold">
                    <span className="text-slate-500">Progres Pembayaran</span>
                    <span className="text-slate-700">
                      {paid}/{tenor} cicilan
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium">
                    Sisa {koperasiRemainingTenor(loan)} cicilan lagi
                  </p>
                </div>
              )}

              <div className="bg-slate-50/70 rounded-xl p-3.5 border border-slate-100 space-y-2">
                {loan.restructuredFromLoanId ? (
                  <>
                    <DetailRow
                      label="Sisa hutang lama (dialihkan)"
                      value={rupiah(loan.sisaPinjamanSebelumnya)}
                    />
                    <DetailRow
                      label="Pinjaman tambahan"
                      value={`+ ${rupiah(loan.pinjamanBaru)}`}
                    />
                    <div className="border-t border-slate-200/70 my-1" />
                  </>
                ) : null}
                <DetailRow label="Total pinjaman" value={rupiah(loan.jumlahPinjaman)} />
                <DetailRow label="Tenor" value={`${tenor} bulan`} />
                <DetailRow label="Cicilan / bulan" value={rupiah(installment)} emphasis="indigo" />
                {(isRunning || pendingRestructure) && (
                  <DetailRow label="Sisa hutang" value={rupiah(outstanding)} emphasis="amber" />
                )}
                <DetailRow label="Biaya administrasi" value={rupiah(loan.biayaAdmin)} />
                {loan.bankDetails?.bank && (
                  <DetailRow
                    label="Rekening transfer"
                    value={`${loan.bankDetails.bank} · ${loan.bankDetails.nomorRekening || '—'}`}
                  />
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {canRespondToKoperasiRevision(loan) && (
                  <>
                    <Button
                      onClick={() =>
                        runLoanAction(
                          loan,
                          'accept-revision',
                          'Revisi diterima. Pengajuan diteruskan ke Wakil Rektor 2.',
                        )
                      }
                      disabled={busy}
                      className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-8 px-3.5 cursor-pointer"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Terima Revisi'}
                    </Button>
                    <Button
                      onClick={() =>
                        runLoanAction(
                          loan,
                          'reject-revision',
                          'Revisi ditolak. Pengajuan pinjaman dihentikan.',
                          'Tolak revisi dari BAK? Pengajuan pinjaman ini akan dihentikan.',
                        )
                      }
                      disabled={busy}
                      variant="outline"
                      className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs h-8 px-3.5 cursor-pointer"
                    >
                      Tolak Revisi
                    </Button>
                  </>
                )}

                {canCancelKoperasiLoan(loan) && (
                  <Button
                    onClick={() =>
                      runLoanAction(
                        loan,
                        'cancel',
                        'Pengajuan pinjaman dibatalkan.',
                        'Batalkan pengajuan pinjaman ini?',
                      )
                    }
                    disabled={busy}
                    variant="outline"
                    className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs h-8 px-3.5 cursor-pointer"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Batalkan'}
                  </Button>
                )}

                {canRestructureKoperasiLoan(loan) && (
                  <Button
                    onClick={() => openRestructureDialog(loan)}
                    className="rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs h-8 px-3.5 cursor-pointer flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Restrukturisasi
                  </Button>
                )}

                <Button
                  onClick={() => setDetailLoan(loan)}
                  variant="outline"
                  className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs h-8 px-3.5 cursor-pointer"
                >
                  Lihat Detail
                </Button>
              </div>
            </Card>
          );
        },
      )}

      {tab === 'berjalan' && activeLoans.length > 0 && !canApply && (
        <p className="text-[11px] text-slate-400 font-medium text-center px-4">
          Anda masih memiliki pengajuan atau pinjaman berjalan, sehingga pengajuan baru belum dapat
          dibuat. Gunakan Restrukturisasi bila membutuhkan dana tambahan.
        </p>
      )}

      {/* ─── Apply dialog ─────────────────────────────────────────────── */}
      <Dialog open={showApply} onOpenChange={(open) => !open && setShowApply(false)}>
        <DialogContent className="sm:max-w-lg w-[95vw] p-6 rounded-2xl border-none shadow-2xl bg-white max-h-[90vh] overflow-y-auto">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Banknote className="w-4.5 h-4.5 text-indigo-600" />
              Ajukan Pinjaman
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Pengajuan akan diteruskan ke BAK untuk ditinjau.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleApply} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-slate-500 uppercase">
                Jumlah Pinjaman
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  Rp
                </span>
                <Input
                  value={applyAmount}
                  onChange={(e) => setApplyAmount(formatAmountInput(e.target.value))}
                  inputMode="numeric"
                  placeholder="1.000.000 - 10.000.000"
                  className="pl-9 rounded-xl border-slate-200 text-sm font-semibold"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-slate-500 uppercase">Tenor</Label>
              <Select
                value={applyTenor}
                onValueChange={(value) => setApplyTenor(value ?? String(KOPERASI_MIN_TENOR))}
              >
                <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white text-sm font-semibold">
                  <SelectValue>{applyTenor} bulan</SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-white rounded-xl border border-slate-100 shadow-xl">
                  {TENOR_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option} bulan
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {applyAmountValue > 0 && (
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3.5 space-y-2">
                <DetailRow
                  label="Cicilan per bulan"
                  value={rupiah(applyInstallment)}
                  emphasis="indigo"
                />
                <DetailRow
                  label="Biaya administrasi"
                  value={rupiah(koperasiAdminFee(applyAmountValue))}
                />
                <DetailRow
                  label="Estimasi dana diterima"
                  value={rupiah(applyAmountValue - koperasiAdminFee(applyAmountValue))}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-slate-500 uppercase">
                Tujuan Pinjaman
              </Label>
              <Input
                value={applyPurpose}
                onChange={(e) => setApplyPurpose(e.target.value.slice(0, KOPERASI_MAX_PURPOSE_LENGTH))}
                placeholder="Contoh: Biaya pendidikan anak"
                className="rounded-xl border-slate-200 text-sm"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-slate-500 uppercase">
                Catatan Tambahan (opsional)
              </Label>
              <textarea
                value={applyNote}
                onChange={(e) => setApplyNote(e.target.value.slice(0, KOPERASI_MAX_NOTE_LENGTH))}
                rows={3}
                placeholder="Tambahkan keterangan bila diperlukan"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 resize-none"
              />
              <p className="text-[10px] font-semibold text-slate-400">
                {applyNote.length}/{KOPERASI_MAX_NOTE_LENGTH} karakter
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-slate-500 uppercase">Bank</Label>
                <Select value={applyBank} onValueChange={(value) => setApplyBank(value ?? '')}>
                  <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white text-sm font-semibold">
                    <SelectValue placeholder="Pilih bank">{applyBank || 'Pilih bank'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-white rounded-xl border border-slate-100 shadow-xl">
                    {KOPERASI_BANKS.map((bank) => (
                      <SelectItem key={bank} value={bank}>
                        {bank}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-slate-500 uppercase">
                  Nomor Rekening
                </Label>
                <Input
                  value={applyAccount}
                  onChange={(e) => setApplyAccount(e.target.value.replace(/\D/g, '').slice(0, 25))}
                  inputMode="numeric"
                  placeholder="Angka saja"
                  className="rounded-xl border-slate-200 text-sm font-semibold"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowApply(false)}
                disabled={submitting}
                className="rounded-xl border-slate-200 text-slate-600 font-bold text-xs h-9 px-4 cursor-pointer"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 px-4 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Mengirim...
                  </>
                ) : (
                  'Ajukan Pinjaman'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Restructure dialog ───────────────────────────────────────── */}
      <Dialog
        open={restructureLoan !== null}
        onOpenChange={(open) => !open && setRestructureLoan(null)}
      >
        <DialogContent className="sm:max-w-lg w-[95vw] p-6 rounded-2xl border-none shadow-2xl bg-white max-h-[90vh] overflow-y-auto">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4.5 h-4.5 text-purple-600" />
              Restrukturisasi Pinjaman
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Tambah dana tanpa harus melunasi pinjaman berjalan. Sisa hutang lama digabung ke
              pinjaman baru.
            </DialogDescription>
          </DialogHeader>

          {restructureLoan && restructureQuote && (
            <form onSubmit={handleRestructure} className="space-y-4">
              <div className="bg-slate-50/70 rounded-xl p-3.5 border border-slate-100 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Pinjaman Saat Ini
                </p>
                <DetailRow
                  label="Sisa hutang"
                  value={rupiah(restructureQuote.carriedBalance)}
                  emphasis="amber"
                />
                <DetailRow
                  label="Sisa tenor"
                  value={`${restructureQuote.carriedTenor} bulan`}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-slate-500 uppercase">
                  Pinjaman Tambahan
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    Rp
                  </span>
                  <Input
                    value={restructureAmount}
                    onChange={(e) => setRestructureAmount(formatAmountInput(e.target.value))}
                    inputMode="numeric"
                    placeholder={`Maks ${rupiah(restructureQuote.maxAdditionalAmount)}`}
                    className="pl-9 rounded-xl border-slate-200 text-sm font-semibold"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-slate-500 uppercase">
                  Tenor Tambahan
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {TENOR_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setRestructureTenor(option)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                        restructureTenor === option
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-purple-300'
                      }`}
                    >
                      {option} bln
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold text-slate-500 uppercase">Bank</Label>
                  <Select
                    value={restructureBank}
                    onValueChange={(value) => setRestructureBank(value ?? '')}
                  >
                    <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white text-sm font-semibold">
                      <SelectValue placeholder="Pilih bank">
                        {restructureBank || 'Pilih bank'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="bg-white rounded-xl border border-slate-100 shadow-xl">
                      {KOPERASI_BANKS.map((bank) => (
                        <SelectItem key={bank} value={bank}>
                          {bank}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold text-slate-500 uppercase">
                    Nomor Rekening
                  </Label>
                  <Input
                    value={restructureAccount}
                    onChange={(e) =>
                      setRestructureAccount(e.target.value.replace(/\D/g, '').slice(0, 25))
                    }
                    inputMode="numeric"
                    placeholder="Angka saja"
                    className="rounded-xl border-slate-200 text-sm font-semibold"
                    required
                  />
                </div>
              </div>

              {restructureQuote.additionalAmount > 0 && restructureQuote.additionalTenor > 0 && (
                <div
                  className={`rounded-xl p-3.5 border space-y-2 ${
                    restructureQuote.error
                      ? 'bg-rose-50/60 border-rose-200'
                      : 'bg-purple-50/60 border-purple-200'
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Pinjaman Baru (Hasil Restrukturisasi)
                  </p>
                  <DetailRow
                    label="Sisa hutang lama"
                    value={rupiah(restructureQuote.carriedBalance)}
                  />
                  <DetailRow
                    label="Pinjaman tambahan"
                    value={`+ ${rupiah(restructureQuote.additionalAmount)}`}
                  />
                  <div className="border-t border-slate-200/70 my-1" />
                  <DetailRow label="Total pinjaman baru" value={rupiah(restructureQuote.newTotal)} />
                  <DetailRow
                    label="Tenor baru"
                    value={`${restructureQuote.carriedTenor} + ${restructureQuote.additionalTenor} = ${restructureQuote.newTenor} bulan`}
                  />
                  <DetailRow
                    label="Cicilan per bulan"
                    value={rupiah(restructureQuote.monthlyInstallment)}
                    emphasis="indigo"
                  />
                  <DetailRow label="Biaya administrasi" value={rupiah(restructureQuote.adminFee)} />
                  {restructureQuote.error && (
                    <p className="text-[11px] font-bold text-rose-700 pt-1">
                      {restructureQuote.error}
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRestructureLoan(null)}
                  disabled={submitting}
                  className="rounded-xl border-slate-200 text-slate-600 font-bold text-xs h-9 px-4 cursor-pointer"
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  disabled={
                    submitting ||
                    Boolean(restructureQuote.error) ||
                    !restructureBank ||
                    !restructureAccount
                  }
                  className="rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs h-9 px-4 cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Mengirim...
                    </>
                  ) : (
                    'Ajukan Restrukturisasi'
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Detail / history dialog ──────────────────────────────────── */}
      <Dialog open={detailLoan !== null} onOpenChange={(open) => !open && setDetailLoan(null)}>
        <DialogContent className="sm:max-w-lg w-[95vw] p-6 rounded-2xl border-none shadow-2xl bg-white max-h-[90vh] overflow-y-auto">
          {detailLoan && (
            <>
              <DialogHeader className="mb-4">
                <div className="flex items-center justify-between gap-3 pr-6">
                  <DialogTitle className="text-base font-bold text-slate-900">
                    Pinjaman #{detailLoan.id.substring(0, 8)}
                  </DialogTitle>
                  <StatusBadge status={resolveKoperasiLoanStatus(detailLoan)} />
                </div>
                <DialogDescription className="text-xs text-slate-400">
                  Rincian dan riwayat perjalanan pengajuan Anda.
                </DialogDescription>
              </DialogHeader>

              {(detailLoan.restructuredFromLoanId || detailLoan.restructuredToLoanId) && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {findLoan(detailLoan.restructuredFromLoanId) && (
                    <button
                      type="button"
                      onClick={() => setDetailLoan(findLoan(detailLoan.restructuredFromLoanId)!)}
                      className="text-[11px] font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-2.5 py-1 cursor-pointer hover:bg-purple-100"
                    >
                      ← Pinjaman sebelumnya #{detailLoan.restructuredFromLoanId!.substring(0, 8)}
                    </button>
                  )}
                  {findLoan(detailLoan.restructuredToLoanId) && (
                    <button
                      type="button"
                      onClick={() => setDetailLoan(findLoan(detailLoan.restructuredToLoanId)!)}
                      className="text-[11px] font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-2.5 py-1 cursor-pointer hover:bg-purple-100"
                    >
                      Pinjaman baru #{detailLoan.restructuredToLoanId!.substring(0, 8)} →
                    </button>
                  )}
                </div>
              )}

              <div className="bg-slate-50/70 rounded-xl p-3.5 border border-slate-100 space-y-2 mb-4">
                <DetailRow label="Tujuan" value={detailLoan.tujuanPinjaman || '—'} />
                <DetailRow label="Total pinjaman" value={rupiah(detailLoan.jumlahPinjaman)} />
                <DetailRow label="Tenor" value={`${detailLoan.tenor || 0} bulan`} />
                <DetailRow
                  label="Cicilan / bulan"
                  value={rupiah(koperasiMonthlyInstallment(detailLoan))}
                  emphasis="indigo"
                />
                <DetailRow
                  label="Sisa hutang"
                  value={rupiah(koperasiOutstandingBalance(detailLoan))}
                  emphasis="amber"
                />
                <DetailRow label="Biaya administrasi" value={rupiah(detailLoan.biayaAdmin)} />
                <DetailRow
                  label="Tanggal pengajuan"
                  value={formatDate(detailLoan.tanggalPengajuan)}
                />
                {detailLoan.bankDetails?.bank && (
                  <DetailRow
                    label="Rekening transfer"
                    value={`${detailLoan.bankDetails.bank} · ${detailLoan.bankDetails.nomorRekening || '—'}`}
                  />
                )}
              </div>

              {Array.isArray(detailLoan.catatanTambahan) && detailLoan.catatanTambahan.length > 0 && (
                <div className="mb-4 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Catatan
                  </p>
                  {detailLoan.catatanTambahan.map((note, index) => (
                    <p key={index} className="text-[11px] text-slate-600 leading-relaxed">
                      {note}
                    </p>
                  ))}
                </div>
              )}

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" /> Riwayat Perjalanan
                </p>
                {(() => {
                  const segments = composeKoperasiLoanHistoryTrail(detailLoan, loans);
                  const hasAncestors = segments.length > 1;
                  const total = segments.reduce((sum, seg) => sum + seg.entries.length, 0);

                  if (total === 0) {
                    return (
                      <p className="text-xs text-slate-400 text-center py-4">
                        Belum ada riwayat tercatat.
                      </p>
                    );
                  }

                  return (
                    <div className="bg-slate-50/70 rounded-xl p-3.5 border border-slate-100 max-h-[280px] overflow-y-auto space-y-1.5">
                      {segments.map((segment, segIndex) => (
                        <div key={segment.loanId}>
                          {hasAncestors && (
                            <div
                              className={`flex items-center gap-2 ${
                                segIndex > 0 ? 'mt-3 pt-3 border-t border-dashed border-slate-200' : ''
                              }`}
                            >
                              <span
                                className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                  segIndex === segments.length - 1
                                    ? 'bg-indigo-100 text-indigo-700'
                                    : 'bg-slate-200/70 text-slate-500'
                                }`}
                              >
                                {segment.loanLabel}
                              </span>
                              {segIndex < segments.length - 1 && (
                                <span className="text-[9px] text-slate-400 italic">
                                  Direstrukturisasi →
                                </span>
                              )}
                            </div>
                          )}
                          <div className={`space-y-2.5 ${hasAncestors ? 'ml-1 mt-2' : ''}`}>
                            {segment.entries.map((entry, index) => (
                              <div
                                key={`${segment.loanId}-${index}`}
                                className="flex gap-2.5 items-start"
                              >
                                <div
                                  className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
                                    segIndex === segments.length - 1
                                      ? 'bg-indigo-500'
                                      : 'bg-slate-300'
                                  }`}
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[11px] font-bold text-slate-700">
                                      {entry.status}
                                    </span>
                                    <span className="text-[9px] text-slate-400 font-medium">
                                      {formatDate(entry.timestamp)}
                                    </span>
                                  </div>
                                  {entry.notes && (
                                    <p className="text-[11px] text-slate-500 leading-relaxed">
                                      {entry.notes}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="flex justify-end pt-4">
                <Button
                  variant="outline"
                  onClick={() => setDetailLoan(null)}
                  className="rounded-xl border-slate-200 text-slate-600 font-bold text-xs h-9 px-4 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5 mr-1.5" /> Tutup
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>,
  );
}
