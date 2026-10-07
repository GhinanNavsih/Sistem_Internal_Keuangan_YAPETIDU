"use client";

import { useState } from 'react';
import { Check, Loader2, Undo2, X } from 'lucide-react';
import {
  BansosProofButton,
  BansosRejectDialog,
  BansosStatusBadge,
  DuplicateHint,
  EmployeeClassBadge,
  SideDecision,
  bansosSubjectText,
  formatBansosDate,
  formatBansosPeriod,
  formatRupiah,
} from '@/components/bansos/BansosParts';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  BANSOS_KIND_LABELS,
  BANSOS_SIDE_LABELS,
  type BansosAction,
  type BansosRequest,
  type BansosSide,
} from '@/lib/payroll/bansos';

export interface BansosDecisionInput {
  action: BansosAction;
  reason?: string;
  amount?: number;
}

interface Props {
  requests: BansosRequest[];
  /** Whose decision this table records: Admin Karyawan ("admin") or Super Admin ("finance"). */
  side: BansosSide;
  /** False shows the same table read-only. */
  canDecide: boolean;
  /** The Vakasi panel's month, to say when an ajuan came from or is paid in another one. */
  period?: string;
  /** Hide the "Jenis" line when every row has the same kind. */
  showKind?: boolean;
  onDecide: (request: BansosRequest, input: BansosDecisionInput) => Promise<void>;
}

/**
 * One table for both reviewers. Each side sees both decisions, but its action
 * buttons only change its own; Super Admin also sets the amount before
 * accepting.
 */
export default function BansosReviewTable({ requests, side, canDecide, period, showKind = true, onDecide }: Props) {
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState('');
  const [rejectTarget, setRejectTarget] = useState<BansosRequest | null>(null);
  const [resetTarget, setResetTarget] = useState<BansosRequest | null>(null);

  const run = async (request: BansosRequest, input: BansosDecisionInput) => {
    if (busyId) return;
    setBusyId(request.id);
    try {
      await onDecide(request, input);
    } finally {
      setBusyId('');
    }
  };

  const ownDecision = (request: BansosRequest) =>
    side === 'admin' ? request.adminDecision : request.financeDecision;

  return (
    <>
      <div className="border border-slate-100 rounded-md shadow-sm bg-white overflow-x-auto">
        <table className="w-full min-w-[880px] text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pegawai</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Ajuan</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pemeriksaan</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-[180px]">Santunan</th>
              {canDecide && (
                <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-[200px]">
                  Keputusan {BANSOS_SIDE_LABELS[side]}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((request) => {
              const own = ownDecision(request);
              const open = request.status !== 'withdrawn' && request.status !== 'rejected';
              const canAct = canDecide && request.status !== 'withdrawn';
              const editAmount = canAct && side === 'finance' && own === 'pending' && open;
              const amount = amounts[request.id] ?? request.amount;
              const busy = busyId === request.id;
              return (
                <tr key={request.id} className="hover:bg-slate-50/50 transition-colors align-top">
                  <td className="px-4 py-3.5">
                    <p className="text-xs font-bold text-slate-800">{request.employeeName}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <EmployeeClassBadge request={request} />
                      {request.possibleDuplicate && <DuplicateHint />}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">
                      Diajukan {request.submittedAt ? new Date(request.submittedAt).toLocaleDateString('id-ID') : '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-slate-600">
                    {showKind && <p className="font-bold text-slate-800">{BANSOS_KIND_LABELS[request.kind]}</p>}
                    <p>{request.kind === 'duka' ? 'Meninggal' : 'Lahir'} {formatBansosDate(request.eventDate)}</p>
                    <p className="text-slate-500">{bansosSubjectText(request)}</p>
                    {request.note && <p className="mt-1 text-slate-500 italic">“{request.note}”</p>}
                    <BansosProofButton request={request} className="mt-2 h-7 text-xs" />
                  </td>
                  <td className="px-4 py-3.5 space-y-1.5">
                    <BansosStatusBadge status={request.status} />
                    {request.status !== 'withdrawn' && (
                      <div className="space-y-1 pt-1">
                        <SideDecision request={request} side="admin" />
                        <SideDecision request={request} side="finance" />
                      </div>
                    )}
                    {period && request.period !== period && (
                      <p className="text-[10px] text-slate-500">Diajukan pada periode {formatBansosPeriod(request.period)}</p>
                    )}
                    {!period && request.paidPeriod && (
                      <p className="text-[10px] text-slate-500">Dibayar di periode {formatBansosPeriod(request.paidPeriod)}</p>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-xs">
                    {editAmount ? (
                      <CurrencyInput
                        value={amount}
                        onValue={(value) => setAmounts((current) => ({ ...current, [request.id]: value }))}
                        aria-label={`Santunan ${request.employeeName}`}
                        className="h-9 rounded-sm border-slate-200 font-bold text-slate-700 text-xs text-right hover:border-indigo-300 focus:border-indigo-500"
                      />
                    ) : (
                      <span className={`font-bold ${request.status === 'paid' ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {formatRupiah(request.amount)}
                      </span>
                    )}
                  </td>
                  {canDecide && (
                    <td className="px-4 py-3.5">
                      {!canAct ? null : own === 'pending' ? (
                        open ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy || (side === 'finance' && amount < 1)}
                              onClick={() => void run(request, side === 'finance' ? { action: 'accept', amount } : { action: 'accept' })}
                              className="rounded-sm border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 transition-all font-semibold flex items-center gap-1.5 shadow-sm px-3 h-8 text-xs disabled:opacity-50 cursor-pointer"
                            >
                              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Terima
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setRejectTarget(request)}
                              className="rounded-sm text-rose-600 border border-rose-200 bg-rose-50 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 transition-all flex items-center gap-1.5 shadow-sm px-3 h-8 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                            >
                              <X className="size-3.5" /> Tolak
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setResetTarget(request)}
                          className="rounded-sm border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 bg-white font-semibold transition-all shadow-sm flex items-center gap-1.5 px-3 h-8 text-xs disabled:opacity-50 cursor-pointer"
                        >
                          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />} Batalkan keputusan
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BansosRejectDialog
        request={rejectTarget}
        loading={Boolean(rejectTarget && busyId === rejectTarget.id)}
        onOpenChange={(open) => { if (!open) setRejectTarget(null); }}
        onConfirm={async (reason) => {
          if (!rejectTarget) return;
          await run(rejectTarget, { action: 'reject', reason });
          setRejectTarget(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => { if (!open) setResetTarget(null); }}
        title="Batalkan keputusan?"
        description={
          resetTarget?.status === 'paid'
            ? <>Santunan {resetTarget.employeeName} ditarik dari slip yang belum dikunci, dan ajuan kembali menunggu keputusan Anda.</>
            : <>Ajuan {resetTarget?.employeeName} kembali menunggu keputusan Anda.</>
        }
        confirmLabel="Batalkan keputusan"
        loading={Boolean(resetTarget && busyId === resetTarget.id)}
        onConfirm={async () => {
          if (!resetTarget) return;
          await run(resetTarget, { action: 'reset' });
          setResetTarget(null);
        }}
      />
    </>
  );
}
