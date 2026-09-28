"use client";

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, FileText, GraduationCap, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OptionSelect } from '@/components/ui/option-select';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import { type FamilyAllowanceRequest, type FamilyRequestChildOption } from '@/lib/payroll/familyAllowanceRequests';

interface ReviewData {
  requests: FamilyAllowanceRequest[];
  childrenByEmployeeId: Record<string, FamilyRequestChildOption[]>;
}

interface Props {
  onApproved: () => Promise<void>;
}

function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split('-');
  return `${day}-${month}-${year}`;
}

function propagationNote(results: { outcome: string }[] = []): string {
  if (results.some(item => item.outcome === 'immutable' || item.outcome === 'blocked_status')) {
    return ' Slip yang sudah diverifikasi atau dikunci ditandai untuk ditinjau Badan Keuangan.';
  }
  if (results.some(item => item.outcome === 'updated')) return ' Slip draf yang terbuka ikut diperbarui.';
  return '';
}

export default function FamilyAllowanceReviewCard({ onApproved }: Props) {
  const [open, setOpen] = useState(false);
  const [processingId, setProcessingId] = useState('');
  const [targetOverrides, setTargetOverrides] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [syncFailedEmployeeId, setSyncFailedEmployeeId] = useState('');
  const decisionIds = useRef<Record<string, string>>({});
  const query = useQuery({
    queryKey: ['family-allowance-requests', 'admin-pending'],
    queryFn: () => authenticatedJson<ReviewData>('/api/payroll/family-allowance/review'),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const requests = query.data?.requests || [];

  const syncPayroll = async (employeeId: string) => {
    const response = await authenticatedJson<{ results: { outcome: string }[] }>(
      '/api/payroll/employee-profile-propagation', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          requestId: createFinancialRequestId('family-profile-sync'),
          changedFields: ['family_allowance_metrics.dependents'],
        }),
      },
    );
    setSyncFailedEmployeeId('');
    return propagationNote(response.results);
  };

  const decide = async (request: FamilyAllowanceRequest, action: 'approve' | 'reject') => {
    if (processingId) return;
    setProcessingId(request.id);
    setError('');
    setNotice('');
    const decisionId = decisionIds.current[request.id] ||= createFinancialRequestId('family-review');
    try {
      const result = await authenticatedJson<{
        employeeId: string;
        status: string;
        propagation?: { ok: boolean; results?: { outcome: string }[]; error?: string };
      }>(
        '/api/payroll/family-allowance/review', {
          method: 'POST',
          body: JSON.stringify({
            familyRequestId: request.id,
            decisionId,
            action,
            expectedRevision: request.revision,
            targetChildId: targetOverrides[request.id] || request.requestedChildId,
          }),
        },
      );
      delete decisionIds.current[request.id];
      if (result.status === 'approved') {
        if (result.propagation?.ok) {
          setSyncFailedEmployeeId('');
          setNotice(`Pengajuan diterima. Anak masuk perhitungan T. Keluarga.${propagationNote(result.propagation.results)}`);
        } else {
          setSyncFailedEmployeeId(result.employeeId);
          setNotice('Pengajuan diterima, tetapi slip draf belum berhasil disinkronkan. Coba lagi di bawah.');
        }
      } else {
        setNotice('Pengajuan ditolak. Statusnya dapat dilihat Loyalis pada riwayat pengajuan.');
      }
      const refreshes = await Promise.allSettled([
        query.refetch(),
        ...(result.status === 'approved' ? [onApproved()] : []),
      ]);
      if (refreshes.some(refresh => refresh.status === 'rejected')) {
        setError('Keputusan sudah tersimpan, tetapi daftar karyawan gagal dimuat ulang. Segarkan halaman untuk melihat data terbaru.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Keputusan gagal disimpan.');
      await query.refetch().catch(() => undefined);
    } finally {
      setProcessingId('');
    }
  };

  return <>
    {/* One half of the split stats card on the employees page: it sits beside "Anak Lulus Perlu Ditinjau", so it mirrors that half's layout. */}
    <button type="button" onClick={() => { setOpen(true); void query.refetch(); }}
      title="Periksa jenjang, tanggal pertama masuk, dan bukti sekolah sebelum menerima anak sebagai tanggungan."
      className="flex w-full cursor-pointer flex-col items-center justify-center gap-3 p-5 text-center transition-colors hover:bg-indigo-50/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500"><GraduationCap className="size-5" /></span>
      <span className="min-w-0">
        <span className="block min-h-9 text-xs font-medium uppercase leading-snug tracking-wider text-slate-500">Pengajuan T. Keluarga</span>
        <span className={`block text-2xl font-bold tabular-nums ${requests.length > 0 ? 'text-indigo-700' : 'text-slate-900'}`}>{query.isPending ? '…' : requests.length}</span>
      </span>
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] !max-w-3xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[28px] border-none bg-white p-0 shadow-2xl">
        <DialogHeader className="relative border-b border-slate-100 bg-slate-50/70 px-5 py-5 pr-14 sm:px-6 sm:py-6 sm:pr-16">
          <DialogTitle className="flex items-center gap-3 text-lg font-bold leading-snug text-slate-900 sm:text-xl">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600"><GraduationCap className="size-5" /></span>
            Pengajuan T. Keluarga Loyalis
          </DialogTitle>
          <DialogDescription className="max-w-2xl text-sm leading-relaxed text-slate-500">
            Periksa bukti dan data sekolah sebelum menambahkan anak ke T. Keluarga. Jenjang yang aktif pada akhir bulan menentukan nilainya.
          </DialogDescription>
          <DialogClose aria-label="Tutup" className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 sm:right-5 sm:top-5">
            <X className="size-4" />
          </DialogClose>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5 sm:p-6">
          {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
          {notice && <div role="status" className={`rounded-xl border p-3 text-sm ${syncFailedEmployeeId ? 'border-amber-100 bg-amber-50 text-amber-800' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}>{notice}
            {syncFailedEmployeeId && <Button type="button" variant="outline" size="sm" className="ml-2 rounded-lg bg-white" onClick={async () => {
              try { const note = await syncPayroll(syncFailedEmployeeId); setNotice(`Sinkronisasi slip selesai.${note}`); }
              catch (cause) { setError(cause instanceof Error ? cause.message : 'Sinkronisasi slip masih gagal.'); }
            }}>Coba sinkronkan slip</Button>}
          </div>}
          {query.isPending && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Memuat pengajuan...</p>}
          {query.isError && <div className="space-y-2"><p className="text-sm text-rose-700">Pengajuan gagal dimuat.</p><Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>Coba lagi</Button></div>}
          {!query.isPending && !query.isError && requests.length === 0 &&
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">Belum ada pengajuan yang menunggu pemeriksaan.</p>}
          {requests.map(item => {
            const children = query.data?.childrenByEmployeeId[item.employeeId] || [];
            const selectedTarget = targetOverrides[item.id] || item.requestedChildId;
            return <div key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{item.employeeName || item.employeeId}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{item.employeeId} · dikirim {item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('id-ID') : '—'}</p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Menunggu</span>
              </div>
              <div className="space-y-4 p-4 sm:p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Jenjang Sekolah</p>
                    <p className="mt-1 font-semibold text-slate-900">{item.level === 'S1' || item.level === 'S2' ? `Kuliah ${item.level}` : item.level}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Tanggal Pertama Masuk</p>
                    <p className="mt-1 font-semibold tabular-nums text-slate-900">{formatDate(item.enrolledAt)}</p>
                  </div>
                </div>
                <a href={item.proofUrl} target="_blank" rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-indigo-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600"><FileText className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">Lihat bukti sekolah</span><span className="block truncate text-sm" title={item.proofName || 'berkas'}>{item.proofName || 'berkas'}</span></span>
                  <ExternalLink className="size-4 shrink-0" />
                </a>
                <div className="space-y-4 border-t border-slate-100 pt-4">
                  <div className="space-y-1.5">
                    <label htmlFor={`family-target-${item.id}`} className="block text-sm font-semibold text-slate-800">Terapkan ke anak</label>
                    <OptionSelect id={`family-target-${item.id}`} value={selectedTarget} className="text-slate-900"
                      onValueChange={value => setTargetOverrides(previous => ({ ...previous, [item.id]: value }))}
                      options={[
                        { value: 'new', label: 'Anak baru (tambahkan satu tanggungan)' },
                        ...children.map(child => ({
                          value: child.id,
                          label: `Anak ${child.number} · ${child.level}${child.enrolledAt ? ` · masuk ${formatDate(child.enrolledAt)}` : ' · tanggal belum tercatat'}${!child.requestable ? ' · tidak dapat diajukan' : ''}`,
                          disabled: !child.requestable,
                        })),
                      ]} />
                    <p className="text-xs leading-relaxed text-slate-500">Pilih anak yang sudah tercatat agar tidak menambahkan tanggungan yang sama dua kali.</p>
                  </div>
                  <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" disabled={!!processingId}
                      onClick={() => void decide(item, 'reject')} className="h-10 rounded-xl border-rose-200 px-4 text-rose-700 hover:bg-rose-50 hover:text-rose-800">Tolak pengajuan</Button>
                    <Button type="button" disabled={!!processingId} onClick={() => void decide(item, 'approve')}
                      className="h-10 rounded-xl bg-indigo-600 px-4 text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700">
                      {processingId === item.id ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
                      {processingId === item.id ? 'Memproses...' : 'Terima pengajuan'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>;
          })}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
