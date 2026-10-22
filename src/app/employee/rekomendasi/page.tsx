'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GraduationCap, Loader2, LogOut } from 'lucide-react';
import EmployeeNavigationMenu from '@/components/EmployeeNavigationMenu';
import { useAuth } from '@/lib/AuthContext';
import { useConfirmLogout } from '@/components/LogoutConfirmProvider';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import { auth } from '@/lib/firebase';
import { OptionSelect } from '@/components/ui/option-select';
import type { ReferralLetter } from '@/lib/loyalis-referral-contract';

type Data = { preview?: boolean; cycles: { id: string; label: string; open: boolean }[]; canIssue: boolean; limit: number; letters: ReferralLetter[]; bonuses: { claimId: string; status: string; postedPeriod: string | null }[] };
const bonusLabels: Record<string, string> = { posted: 'Masuk payroll', finance_review: 'Menunggu penyelesaian Finance', recovery_required: 'Pengembalian ditangani Finance', recovery_applied: 'Potongan pengembalian diterapkan', recovered: 'Pengembalian diselesaikan', cancelled: 'Dibatalkan', test_skipped: 'Data uji', manual_settled: 'Diselesaikan Finance' };
export default function RecommendationsPage() {
  const { profile: raw, activeProfile, loading } = useAuth(); const profile = activeProfile || raw;
  const logout = useConfirmLogout();
  const [data, setData] = useState<Data | null>(null), [cycle, setCycle] = useState(''), [name, setName] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [revoking, setRevoking] = useState<ReferralLetter | null>(null);
  const guard = useRef(false), requestId = useRef<string | null>(null);
  const load = useCallback(async () => { try { const result = await authenticatedJson<Data>('/api/employee/recommendations'); setData(result); setCycle(current => current || (result.cycles.filter(c => c.open).length === 1 ? result.cycles.find(c => c.open)!.id : '')); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Data gagal dimuat.'); } }, []);
  useEffect(() => { if (profile?.role !== 'loyalis') return; const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [profile?.role, load]);
  async function mutate(action: 'issue' | 'revoke', letter?: ReferralLetter) {
    if (guard.current) return; guard.current = true; setBusy(action); setError(''); setNotice('');
    requestId.current ||= createFinancialRequestId('rekomendasi');
    try { await authenticatedJson('/api/employee/recommendations', { method: 'POST', body: JSON.stringify({ action, cycleId: cycle, prospectName: name, letterId: letter?.id, requestId: requestId.current }) }); requestId.current = null; setName(''); setRevoking(null); setNotice(action === 'issue' ? 'Surat rekomendasi berhasil diterbitkan. Unduh dan kirimkan kepada calon mahasiswa.' : 'Surat dicabut. Kuota tersedia untuk surat pengganti.'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Perubahan gagal disimpan.'); }
    finally { guard.current = false; setBusy(''); }
  }
  async function download(letter: ReferralLetter) {
    if (guard.current) return; guard.current = true; setBusy(letter.id); setError('');
    try { const token = await auth.currentUser?.getIdToken(); const response = await fetch(`/api/employee/recommendations/${letter.id}`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error((await response.json()).error); const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = `${letter.id}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unduhan gagal.'); } finally { guard.current = false; setBusy(''); }
  }
  if (loading) return <main className="p-10"><Loader2 className="animate-spin" aria-label="Memuat" /></main>;
  if (profile?.role !== 'loyalis') return <main className="p-10">Halaman ini khusus akun Loyalis.</main>;
  const letters = data?.letters.filter(l => l.cycleId === cycle) || [];
  const cycleOpen = data?.cycles.find(c => c.id === cycle)?.open === true;
  const remaining = (data?.limit || 5) - letters.filter(l => l.status !== 'revoked').length;
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-20 border-b bg-white"><div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4"><GraduationCap className="text-emerald-600" /><h1 className="flex-1 text-lg font-bold">Rekomendasi Mahasiswa</h1><EmployeeNavigationMenu /><button type="button" onClick={() => logout()} aria-label="Keluar" className="rounded-md border p-2"><LogOut size={18} /></button></div></header>
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-7">
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}<button type="button" disabled={!!busy} onClick={() => void load()} className="ml-3 underline">Muat ulang</button></p>}
      {data?.preview && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Mode uji lokal. Surat uji tidak berlaku untuk pengajuan resmi dan tidak menghasilkan pembayaran bonus.</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
      {!data && !error && <p role="status">Memuat rekomendasi…</p>}
      {data && <><section className="rounded-2xl border bg-white p-5 sm:p-7"><h2 className="text-lg font-semibold">Terbitkan surat rekomendasi</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">Anda memiliki lima rekomendasi per tahun akademik. Surat yang belum disetujui PMB dapat dicabut dan diganti. Bonus Rp12.345 bruto diperoleh setelah beasiswa disetujui dan calon mahasiswa mendapatkan NIM.</p>
        {!data.canIssue && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Penerbitan surat hanya tersedia untuk Loyalis aktif. Surat dan hak bonus sebelumnya tetap dapat dilihat.</p>}
        {cycle && !cycleOpen && <p className="mt-4 text-sm text-slate-500">Siklus ini telah ditutup. Riwayat dan PDF tetap tersedia.</p>}
        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void mutate('issue'); }}>
          <div><label htmlFor="referral-cycle" className="mb-2 block text-sm font-medium">Tahun akademik</label><OptionSelect id="referral-cycle" value={cycle} disabled={!!busy} options={data.cycles.map(c => ({ value: c.id, label: c.label + (c.open ? '' : ' (ditutup)') }))} onValueChange={value => { setCycle(value); requestId.current = null; }} placeholder="Pilih tahun akademik" /></div>
          <label className="text-sm font-medium">Nama lengkap calon mahasiswa<input required minLength={2} maxLength={160} value={name} disabled={!!busy} onChange={e => { setName(e.target.value); requestId.current = null; }} className="mt-2 w-full rounded-lg border border-slate-200 p-3" placeholder="Sesuai nama pada pendaftaran PMB" /></label>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2"><p className="text-sm font-semibold text-emerald-800">{cycle ? `${remaining} dari ${data.limit} rekomendasi tersedia` : 'Pilih tahun akademik untuk melihat kuota'}</p><button type="submit" disabled={!!busy || !data.canIssue || !cycleOpen || !cycle || remaining <= 0 || name.trim().length < 2} className="rounded-lg bg-emerald-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy === 'issue' ? 'Menerbitkan…' : 'Terbitkan surat'}</button></div>
        </form></section>
        <section className="space-y-3"><h2 className="text-lg font-semibold">Surat rekomendasi Anda</h2>{!letters.length && <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">Belum ada surat untuk tahun akademik yang dipilih.</p>}
          {letters.map(letter => { const bonus = data.bonuses.find(b => b.claimId === letter.claimId); return <article key={letter.id} className="rounded-xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{letter.prospectName}</h3><p className="mt-1 break-all font-mono text-xs text-slate-500">{letter.id}</p></div><span className={`h-fit rounded-full px-3 py-1 text-xs ${letter.status === 'revoked' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{letter.status === 'issued' ? 'Belum digunakan' : letter.status === 'claimed' ? 'Beasiswa disetujui' : 'Dicabut'}</span></div><p className="mt-3 text-sm text-slate-600">{bonus ? `${bonusLabels[bonus.status] || bonus.status}${bonus.postedPeriod ? ` · ${bonus.postedPeriod}` : ''}` : letter.qualifiedAt ? 'Memproses bonus' : letter.status === 'claimed' ? 'Menunggu penerbitan NIM' : 'Bonus belum diperoleh'}</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={!!busy} onClick={() => void download(letter)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{busy === letter.id ? 'Menyiapkan…' : 'Unduh PDF'}</button>{letter.status === 'issued' && <button type="button" disabled={!!busy} onClick={() => setRevoking(letter)} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-800">Cabut surat</button>}</div></article>; })}
        </section></>}
      {revoking && <section role="alertdialog" aria-label="Konfirmasi pencabutan surat" className="rounded-xl border border-red-200 bg-white p-5"><p className="text-sm">Cabut surat untuk <strong>{revoking.prospectName}</strong>? PDF lama tidak berlaku lagi dan kuota dikembalikan.</p><div className="mt-4 flex gap-3"><button type="button" disabled={!!busy} onClick={() => setRevoking(null)} className="rounded-lg border px-3 py-2">Batal</button><button type="button" disabled={!!busy} onClick={() => void mutate('revoke', revoking)} className="rounded-lg bg-red-800 px-3 py-2 text-white">{busy ? 'Menyimpan…' : 'Konfirmasi pencabutan'}</button></div></section>}
    </main></div>;
}
