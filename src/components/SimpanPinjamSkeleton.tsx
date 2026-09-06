import { Banknote, ChevronLeft } from 'lucide-react';

/**
 * The shell, header icon/title/description, summary-card captions, and tab
 * labels are the same for every Loyalis employee regardless of loan data —
 * they render as real text immediately. The "Ajukan Pinjaman" button is
 * omitted rather than guessed, since whether it can show at all depends on
 * `canApply` (an existing-loan check that hasn't resolved yet). Summary
 * values, tab counts, and the loan list itself are all placeholders, since
 * both their content and their count depend on the fetch.
 */
export function SimpanPinjamPageSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/70 to-slate-100 font-sans text-slate-800">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div className="flex items-center gap-1.5 text-slate-600 font-bold text-xs">
          <ChevronLeft className="w-4 h-4" />
          Kembali
        </div>

        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-inner shrink-0">
            <Banknote className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Simpan Pinjam
            </h1>
            <p className="text-slate-500 text-xs sm:text-sm">
              Ajukan, restrukturisasi, dan pantau cicilan pinjaman Koperasi UNIPDU Anda.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {['Sisa Hutang', 'Cicilan / Bulan', 'Pinjaman Aktif'].map((label) => (
            <div key={label} className="rounded-2xl border border-slate-200/80 shadow-sm bg-white p-3.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
              <div className="h-4 w-16 rounded-full bg-slate-200 animate-pulse mt-2" />
            </div>
          ))}
        </div>

        <div className="flex gap-1 bg-slate-100/70 p-1 rounded-xl">
          {['Berjalan', 'Riwayat', 'Ketentuan'].map((label) => (
            <div
              key={label}
              className="flex-1 px-3 py-2 text-[11px] sm:text-xs font-bold rounded-lg text-slate-400 text-center"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-40 w-full rounded-2xl border border-slate-200/80 bg-white shadow-sm animate-pulse"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
