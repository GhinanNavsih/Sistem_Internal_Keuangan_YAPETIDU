'use client';
import { useEffect, useRef, useState } from 'react';
import { authenticatedJson } from '@/lib/payroll/client';
type Item = { id: string; employeeName: string; prospectName: string; amount: number; status: string; targetPeriod?: string; reason?: string };
export default function ReferralFinancePanel({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<{ recoveries: Item[]; unpaid: Item[] } | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(''), [manual, setManual] = useState<Item | null>(null), [reference, setReference] = useState('');
  const guard = useRef(false);
  const load = () => authenticatedJson<{ recoveries: Item[]; unpaid: Item[] }>('/api/payroll/referral-recoveries').then(setData).catch(e => setError(e.message));
  useEffect(() => { if (canManage) void load(); }, [canManage]);
  async function act(item: Item, action: string) {
    if (guard.current) return; guard.current = true; setBusy(item.id); setError('');
    try { await authenticatedJson('/api/payroll/referral-recoveries', { method: 'POST', body: JSON.stringify({ claimId: item.id, action, reference }) }); setManual(null); setReference(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Perubahan gagal.'); } finally { guard.current = false; setBusy(''); }
  }
  if (!canManage || (!data?.recoveries.length && !data?.unpaid.length && !error)) return null;
  const labels: Record<string, string> = { pending: 'Menunggu Finance', applied: 'Potongan diterapkan', settled: 'Potongan difinalisasi', manual_settled: 'Diselesaikan manual' };
  return <section className="mb-6 space-y-4 rounded-xl border border-amber-200 bg-white p-5"><h2 className="font-bold text-slate-800">Tindak lanjut bonus rekomendasi</h2>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {data?.recoveries.map(item => <div key={item.id} className="rounded-lg border p-4 text-sm"><p className="font-semibold">{item.employeeName} · Rp{item.amount.toLocaleString('id-ID')}</p><p className="mt-1">Pengembalian: {item.prospectName}</p><p className="mt-1 text-xs text-slate-500">{labels[item.status] || item.status}{item.targetPeriod ? ` · ${item.targetPeriod}` : ''}</p><p className="mt-1 text-xs text-slate-500">{item.reason}</p>{item.status === 'pending' && <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!!busy} onClick={() => void act(item, 'apply')} className="rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">{busy === item.id ? 'Menerapkan…' : 'Terapkan Potongan'}</button><button type="button" disabled={!!busy} onClick={() => { setManual(item); setReference(''); }} className="rounded-lg border px-3 py-2">Catat penyelesaian manual</button></div>}</div>)}
    {data?.unpaid.map(item => <div key={item.id} className="rounded-lg border p-4 text-sm"><p className="font-semibold">{item.employeeName} · Rp{item.amount.toLocaleString('id-ID')}</p><p>Bonus {item.prospectName} menunggu pembayaran di luar payroll.</p><button type="button" disabled={!!busy} onClick={() => { setManual(item); setReference(''); }} className="mt-3 rounded-lg border px-3 py-2">Catat pembayaran manual</button></div>)}
    {manual && <form className="space-y-3 rounded-lg bg-amber-50 p-4" onSubmit={e => { e.preventDefault(); void act(manual, data?.unpaid.some(i => i.id === manual.id) ? 'settle_bonus' : 'manual'); }}><p className="text-sm">Konfirmasi penyelesaian penuh Rp{manual.amount.toLocaleString('id-ID')} untuk {manual.employeeName}.</p><label className="block text-sm">Referensi pembayaran / bukti penyelesaian<input required minLength={3} maxLength={500} disabled={!!busy} value={reference} onChange={e => setReference(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2" /></label><div className="flex gap-2"><button type="button" disabled={!!busy} onClick={() => setManual(null)} className="rounded-lg border px-3 py-2 text-sm">Batal</button><button type="submit" disabled={!!busy || reference.trim().length < 3} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">Konfirmasi penyelesaian</button></div></form>}
  </section>;
}
