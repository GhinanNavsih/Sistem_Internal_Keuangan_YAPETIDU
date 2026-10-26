'use client';

import { useId, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { normalizeProposalSignatures, ProposalSignature } from '@/lib/payroll/proposalSignatures';

interface SignatureEmployee {
  id: string;
  name: string;
  role: string;
}

interface Props {
  stage: 'Proposal' | 'LPJ';
  signatures: ProposalSignature[];
  proposalSignatures?: ProposalSignature[];
  employees: SignatureEmployee[];
  loading: boolean;
  loadError: boolean;
  readOnly: boolean;
  followsProposal?: boolean;
  onSave: (signatures: ProposalSignature[], followsProposal: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function SignatureSettings({
  stage, signatures, proposalSignatures, employees, loading, loadError, readOnly, followsProposal = false, onSave, onDirtyChange,
}: Props) {
  const id = useId();
  const [slots, setSlots] = useState(() => normalizeProposalSignatures(signatures));
  const [searches, setSearches] = useState(() => normalizeProposalSignatures(signatures).map((slot) => slot.name));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [activeOption, setActiveOption] = useState(0);
  const [follow, setFollow] = useState(followsProposal);
  const isLpj = stage === 'LPJ';
  const disabled = readOnly || (isLpj && follow);
  const displayedSlots = isLpj && follow ? proposalSignatures || signatures : slots;

  const updateSlot = (index: number, patch: Partial<ProposalSignature>) => {
    onDirtyChange?.(true);
    setSlots((prev) => prev.map((slot, i) => i === index ? { ...slot, ...patch } : slot));
  };

  const selectEmployee = (index: number, employee: SignatureEmployee) => {
    updateSlot(index, { name: employee.name, title: employee.role, employeeId: employee.id });
    setSearches((prev) => prev.map((text, i) => i === index ? employee.name : text));
    setActiveSlot(null);
  };

  const resetChanges = () => {
    onDirtyChange?.(false);
    const normalized = normalizeProposalSignatures(signatures);
    setSlots(normalized);
    setSearches(normalized.map((slot) => slot.name));
    setFollow(followsProposal);
    setActiveSlot(null);
  };

  return (
    <section className="space-y-4 border-t border-slate-100 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <FileText className="h-4 w-4 text-indigo-500" /> Tanda Tangan PDF {stage}
          </h3>
          <p className="mt-1 text-xs text-slate-500">Pilih Loyalis dan jabatan untuk setiap posisi tanda tangan. Posisi tanpa nama tidak dicetak.</p>
        </div>
        {isLpj && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={follow}
              disabled={readOnly}
              onChange={(event) => {
                onDirtyChange?.(true);
                setFollow(event.target.checked);
                setActiveSlot(null);
              }}
              className="h-4 w-4 accent-indigo-600"
            />
            Ikuti tanda tangan proposal
          </label>
        )}
      </div>

      {isLpj && (
        <p className="text-xs text-slate-500">
          {follow ? 'LPJ mengikuti tanda tangan proposal. Matikan pilihan di atas untuk mengatur tanda tangan LPJ tersendiri.' : 'LPJ menggunakan tanda tangan khusus.'}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {displayedSlots.map((slot, index) => {
          const query = (searches[index] || '').trim().toLocaleLowerCase('id');
          const filtered = employees.filter((employee) => employee.name.toLocaleLowerCase('id').includes(query));
          const expanded = activeSlot === index && !disabled;
          const searchId = `${id}-search-${index}`;
          const listId = `${id}-options-${index}`;

          return (
            <div key={index} className="space-y-3 rounded-md border border-slate-200 bg-slate-50/30 p-4">
              <div className="flex items-center justify-between gap-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Penandatangan {index + 1}</p>
                <button data-proposal-mutation
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    updateSlot(index, { name: '', title: '', label: '', employeeId: undefined });
                    setSearches((prev) => prev.map((text, i) => i === index ? '' : text));
                    setActiveSlot(null);
                  }}
                  className="text-[10px] text-slate-500 hover:text-slate-800 disabled:opacity-50"
                >
                  Kosongkan
                </button>
              </div>

              <div className="relative space-y-1.5">
                <label htmlFor={searchId} className="block text-xs font-bold uppercase tracking-wider text-slate-500">Cari Pegawai</label>
                <Input
                  id={searchId}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={expanded}
                  aria-controls={expanded ? listId : undefined}
                  aria-activedescendant={expanded && !loading && !loadError && filtered[activeOption] ? `${listId}-${activeOption}` : undefined}
                  autoComplete="off"
                  placeholder="Cari nama Loyalis..."
                  value={isLpj && follow ? slot.name : searches[index] || ''}
                  disabled={disabled}
                  onChange={(event) => {
                    onDirtyChange?.(true);
                    const value = event.target.value;
                    setSearches((prev) => prev.map((text, i) => i === index ? value : text));
                    setActiveSlot(index);
                    setActiveOption(0);
                  }}
                  onFocus={() => { setActiveSlot(index); setActiveOption(0); }}
                  onBlur={() => setActiveSlot(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && expanded) {
                      event.preventDefault();
                      event.stopPropagation();
                      setActiveSlot(null);
                    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      setActiveSlot(index);
                      setActiveOption((prev) => Math.max(0, Math.min(filtered.length - 1, prev + (event.key === 'ArrowDown' ? 1 : -1))));
                    } else if (event.key === 'Enter' && expanded && !loading && !loadError && filtered[activeOption]) {
                      event.preventDefault();
                      selectEmployee(index, filtered[activeOption]);
                    }
                  }}
                  className="rounded-sm border-slate-200 text-sm font-semibold"
                />
                {expanded && (
                  <div id={listId} role="listbox" aria-label={`Loyalis penandatangan ${index + 1}`} className="absolute left-0 right-0 z-20 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-xl">
                    {loading ? (
                      <p className="flex items-center gap-2 p-3 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat data...</p>
                    ) : loadError ? (
                      <p className="p-3 text-xs text-rose-600">Gagal memuat Loyalis. Muat ulang halaman.</p>
                    ) : filtered.length === 0 ? (
                      <p className="p-3 text-xs text-slate-500">Tidak ditemukan pegawai dengan nama tersebut.</p>
                    ) : filtered.map((employee, optionIndex) => (
                      <button data-proposal-mutation
                        id={`${listId}-${optionIndex}`}
                        key={employee.id}
                        type="button"
                        role="option"
                        aria-selected={optionIndex === activeOption}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectEmployee(index, employee)}
                        className={`block w-full p-3 text-left text-xs hover:bg-indigo-50 ${optionIndex === activeOption ? 'bg-indigo-50' : ''}`}
                      >
                        <span className="block font-semibold text-slate-700">{employee.name}</span>
                        <span className="mt-1 block text-[10px] text-slate-500">{employee.role} · Loyalis</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor={`${id}-name-${index}`} className="block text-xs font-bold uppercase tracking-wider text-slate-500">Nama Penandatangan</label>
                <Input id={`${id}-name-${index}`} value={slot.name} disabled={disabled} placeholder="Nama lengkap beserta gelar..." onChange={(event) => updateSlot(index, { name: event.target.value, employeeId: undefined })} className="rounded-sm border-slate-200 text-sm font-semibold" />
              </div>

              <div className="space-y-1.5">
                <label htmlFor={`${id}-title-${index}`} className="block text-xs font-bold uppercase tracking-wider text-slate-500">Jabatan Penandatangan</label>
                <Input id={`${id}-title-${index}`} value={slot.title} disabled={disabled} placeholder="Jabatan..." onChange={(event) => updateSlot(index, { title: event.target.value })} className="rounded-sm border-slate-200 text-sm font-semibold" />
              </div>
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button data-proposal-mutation type="button" variant="ghost" data-proposal-view onClick={resetChanges}>Batal</Button>
          <Button data-proposal-mutation type="button" onClick={() => { onSave(normalizeProposalSignatures(slots), follow); onDirtyChange?.(false); }}>Simpan</Button>
        </div>
      )}
    </section>
  );
}
