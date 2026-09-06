import Image from 'next/image';
import { FileText, TrendingUp, TrendingDown, Landmark } from 'lucide-react';

export function PayslipHeaderShell({ displayName }: { displayName?: string | null }) {
  return (
    <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm relative z-20">
      <div className="max-w-5xl mx-auto px-3.5 sm:px-8 md:px-12 py-3 sm:py-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center shadow-lg shadow-indigo-200 shrink-0">
            <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="min-w-0 shrink">
            <h1 className="text-xs sm:text-base font-bold text-black leading-tight truncate">Slip Gaji</h1>
            {displayName ? (
              <p className="text-[10px] sm:text-xs text-black font-semibold truncate">{displayName}</p>
            ) : (
              <div className="h-2.5 w-20 mt-1 rounded-full bg-slate-200 animate-pulse" />
            )}
          </div>
        </div>
        <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-slate-100 animate-pulse shrink-0" />
      </div>
    </div>
  );
}

/**
 * Only the letterhead, section captions and field labels here are truly
 * fixed (independent of the employee/period being fetched), so they render
 * as real text/images. Everything else — name, period, badge, and every
 * earning/deduction row — depends on data whose exact shape (which rows
 * even appear) isn't known until the fetch resolves, so those stay as
 * pulsing placeholders rather than guessed text.
 */
export function PayslipBodySkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        {/* Kop Surat Header — logos and letterhead text are always the same */}
        <div className="py-6 border-b border-slate-200 flex flex-col items-center text-center relative">
          <div className="flex gap-4 items-center justify-center filter drop-shadow-sm mb-4 mt-2">
            <Image
              src="/Logo YAPETIDU (Transparent bg).png"
              alt="Logo YAPETIDU"
              width={512}
              height={474}
              priority
              className="h-14 w-auto object-contain shrink-0"
            />
            <div className="w-px h-8 bg-slate-200" />
            <Image
              src="/Logo UNIPDU.png"
              alt="Logo UNIPDU"
              width={300}
              height={304}
              priority
              className="h-14 w-auto object-contain shrink-0"
            />
          </div>
          <h3 className="text-xs font-bold text-black tracking-wider uppercase">YAYASAN PESANTREN TINGGI DARUL 'ULUM</h3>
          <h2 className="text-sm font-extrabold text-black tracking-wide mt-1 uppercase">UNIVERSITAS PESANTREN TINGGI DARUL 'ULUM</h2>
          <p className="text-[10px] text-black font-medium mt-1">Pondok Pesantren Darul 'Ulum Peterongan Jombang 61481 Telp. (0321) 873655</p>
        </div>

        {/* Payslip Details — captions are fixed, the values below them aren't */}
        <div className="py-6 border-b border-slate-200">
          <div className="flex flex-col md:flex-row justify-between gap-4">
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-black uppercase tracking-widest block">NAMA PEGAWAI</span>
              <div className="h-4 w-40 rounded-full bg-slate-200 animate-pulse" />
              <div className="h-2.5 w-36 rounded-full bg-slate-100 animate-pulse" />
            </div>
            <div className="space-y-1.5 md:text-right md:flex md:flex-col md:items-end">
              <span className="text-[10px] font-bold text-black uppercase tracking-widest block">PERIODE SLIP</span>
              <div className="h-3.5 w-28 rounded-full bg-slate-200 animate-pulse" />
              <div className="h-4 w-32 rounded-full bg-slate-100 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Earnings & Deductions — section captions are fixed, the rows aren't */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 border-b border-slate-200">
          <div className="py-6 md:pr-8 space-y-4">
            <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-widest flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              I. PENERIMAAN
            </h4>
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex justify-between items-center pt-2">
                  <div className="h-2.5 w-24 rounded-full bg-slate-100 animate-pulse" />
                  <div className="h-2.5 w-16 rounded-full bg-slate-200 animate-pulse" />
                </div>
              ))}
            </div>
          </div>
          <div className="py-6 md:pl-8 space-y-4">
            <h4 className="text-xs font-bold text-rose-700 uppercase tracking-widest flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-rose-500" />
              II. POTONGAN
            </h4>
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex justify-between items-center pt-2">
                  <div className="h-2.5 w-24 rounded-full bg-slate-100 animate-pulse" />
                  <div className="h-2.5 w-16 rounded-full bg-slate-200 animate-pulse" />
                </div>
              ))}
            </div>

            <div className="pt-5 mt-5 border-t border-slate-200 space-y-4">
              <h4 className="text-xs font-bold text-amber-700 uppercase tracking-widest flex items-center gap-1.5">
                <Landmark className="w-4 h-4 text-amber-500" />
                III. PAJAK
              </h4>
              <div className="flex justify-between items-center pt-2">
                <div className="h-2.5 w-20 rounded-full bg-slate-100 animate-pulse" />
                <div className="h-2.5 w-10 rounded-full bg-slate-100 animate-pulse" />
              </div>
            </div>
          </div>
        </div>

        {/* Totals Footer */}
        <div className="grid grid-cols-1 md:grid-cols-2 bg-slate-50/50 border-b border-slate-200 rounded-xl my-4">
          <div className="px-6 py-4 flex justify-between items-center border-b md:border-b-0 border-slate-200">
            <span className="text-xs font-bold text-emerald-700/70 uppercase">JUMLAH PENERIMAAN</span>
            <div className="h-2.5 w-20 rounded-full bg-slate-200 animate-pulse" />
          </div>
          <div className="px-6 py-4 flex justify-between items-center">
            <span className="text-xs font-bold text-rose-700/70 uppercase">JUMLAH POTONGAN</span>
            <div className="h-2.5 w-20 rounded-full bg-slate-200 animate-pulse" />
          </div>
        </div>

        {/* Net Salary Card */}
        <div className="py-6 px-4 sm:px-6 bg-gradient-to-r from-indigo-50/40 via-indigo-50/70 to-purple-50/40 border border-indigo-100/80 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4 my-6">
          <div>
            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest block">PENERIMAAN BERSIH</span>
            <div className="h-7 w-44 rounded-full bg-slate-200 animate-pulse mt-1" />
          </div>
          <div className="h-16 w-full md:w-64 rounded-2xl bg-white/60 border border-indigo-100/50 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export function PayslipPageSkeleton() {
  return (
    <div className="min-h-screen bg-white font-sans selection:bg-indigo-100 relative text-black pb-16">
      <PayslipHeaderShell />
      <div className="max-w-4xl mx-auto px-6 sm:px-8 md:px-12 mt-8 space-y-6 relative z-10">
        <div className="py-3.5 px-5 h-[60px] bg-slate-50/80 rounded-2xl border border-slate-100 animate-pulse" />
        <PayslipBodySkeleton />
      </div>
    </div>
  );
}
