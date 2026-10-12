// Shared look of the SatKer finance book. Styling follows SIMPEL_UI_THEME.md: navy accent, slate neutrals, no shadows, no bold/uppercase.
export const field = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100';
export const button = 'inline-flex items-center justify-center gap-2 rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50';
export const lightButton = 'inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
export const dangerGhostButton = 'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50';
export const selectTrigger = 'mt-1 h-9.5 w-full rounded-md border-slate-300 bg-white px-3 text-sm font-normal text-slate-700 shadow-none focus-visible:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-100';
export const selectContent = 'max-h-72 rounded-lg border border-slate-200 bg-white p-1 text-slate-700 shadow-lg';
export const selectItem = 'min-h-9 rounded-md px-3 py-1.5 text-sm text-slate-700 focus:bg-slate-50 focus:text-slate-900 data-highlighted:bg-slate-50 data-highlighted:text-slate-900';
export const cell = 'border-b border-slate-100 px-3 py-2 text-right tabular-nums';
export const leftCell = 'border-b border-slate-100 px-3 py-2 text-left';
export const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
// Base UI's SelectValue shows the raw value once the list closes unless the Select is given `items` to look the label up in.
export const cashFlowItems = { OPERATING: 'Operasional', INVESTING: 'Investasi', FINANCING: 'Pendanaan' };
export const fmt = (value: number | undefined | null) => new Intl.NumberFormat('id-ID').format(value || 0);
export const money = (value: number | undefined | null) => `Rp ${fmt(value)}`;

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>{children}</section>;
}

/** A pass/fail line, shown as a dot plus text (never a filled pill). */
export function CheckLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return <div className="flex items-start gap-2 py-1.5 text-sm">
    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-green-500' : 'bg-amber-500'}`} />
    <div><span className="text-slate-900">{label}</span><span className="text-slate-500"> · {detail}</span></div>
  </div>;
}
