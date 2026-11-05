"use client";

import { useId, useState } from 'react';
import { rankSearchOptions } from '@/lib/searchMatch';
import { CASH_FLOW_SIGNER_SLOTS, type CashFlowSignature, type CashFlowSignatures, type SignatureEmployee } from '@/lib/satker-finance/signatures';
import { button, field } from './ui';

type Props = {
  signatures: CashFlowSignatures;
  employees: SignatureEmployee[];
  disabled: boolean;
  canEdit: boolean;
  onChange: (value: CashFlowSignatures) => void;
  onSave: () => void;
};

export default function CashFlowSignatureSettings({ signatures, employees, disabled, canEdit, onChange, onSave }: Props) {
  const id = useId();
  const [activeSlot, setActiveSlot] = useState<keyof CashFlowSignatures | null>(null);
  const [query, setQuery] = useState('');
  const [activeOption, setActiveOption] = useState(0);
  const options = rankSearchOptions(employees.map((employee) => ({ ...employee, label: employee.name })), query);
  const update = (key: keyof CashFlowSignatures, patch: Partial<CashFlowSignature>) => onChange({ ...signatures, [key]: { ...signatures[key], ...patch } });
  return <div className="min-w-0 space-y-4">
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Tanda tangan PDF</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">Pilih Loyalis atau sesuaikan nama dan jabatan untuk cetakan ini. Simpan konfigurasi agar digunakan kembali pada laporan SatKer ini.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      {CASH_FLOW_SIGNER_SLOTS.map(({ key, label, title }) => {
        const slot = signatures[key];
        const expanded = activeSlot === key && !disabled && canEdit;
        const listId = `${id}-${key}-options`;
        const selectEmployee = (employee: SignatureEmployee) => {
          update(key, { employeeId: employee.id, name: employee.name, title: employee.role || title });
          setActiveSlot(null);
        };
        return <div key={key} className="min-w-0 space-y-3 rounded-md border border-slate-200 bg-slate-50/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-accent-700">{label}</h4>
            {canEdit && <button type="button" className="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50" disabled={disabled} aria-label={`Kosongkan ${label}`} onClick={() => { onChange({ ...signatures, [key]: { name: '', title } }); setActiveSlot(null); }}>Kosongkan</button>}
          </div>
          <div className="relative">
            <label htmlFor={`${id}-${key}-search`} className="mb-1 block text-xs font-medium text-slate-500">Cari Loyalis</label>
            <input id={`${id}-${key}-search`} role="combobox" aria-label={`Cari Loyalis ${label}`} aria-autocomplete="list" aria-expanded={expanded}
              aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded && options[activeOption] ? `${listId}-${activeOption}` : undefined}
              className={field} placeholder="Cari nama Loyalis…" autoComplete="off" value={expanded ? query : slot.name} disabled={disabled || !canEdit}
              onFocus={() => { setActiveSlot(key); setQuery(slot.name); setActiveOption(0); }}
              onBlur={() => setActiveSlot(null)}
              onChange={(event) => { setQuery(event.target.value); setActiveSlot(key); setActiveOption(0); }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && expanded) { event.preventDefault(); setActiveSlot(null); }
                else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  if (!expanded) { setActiveSlot(key); setQuery(''); setActiveOption(0); }
                  else setActiveOption((current) => Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))));
                } else if (event.key === 'Enter' && expanded && options[activeOption]) {
                  event.preventDefault(); selectEmployee(options[activeOption]);
                }
              }} />
            {expanded && <div id={listId} role="listbox" aria-label={`Loyalis ${label}`} className="absolute left-0 right-0 z-20 mt-1 max-h-52 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg">
              {!options.length && <p className="px-3 py-2 text-xs text-slate-500">Tidak ditemukan Loyalis dengan nama tersebut.</p>}
              {options.map((employee, index) => <button key={employee.id} id={`${listId}-${index}`} type="button" role="option" aria-selected={index === activeOption}
                className={`block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50 ${index === activeOption ? 'bg-accent-50' : ''}`}
                onMouseDown={(event) => event.preventDefault()} onClick={() => selectEmployee(employee)}>
                <span className="block text-slate-800">{employee.name}</span><span className="mt-0.5 block text-xs text-slate-500">{employee.role || 'Loyalis'}</span>
              </button>)}
            </div>}
          </div>
          <label className="block text-xs font-medium text-slate-500">Nama penandatangan<input aria-label={`Nama penandatangan ${label}`} className={`${field} mt-1`} maxLength={180} disabled={disabled || !canEdit} value={slot.name} onChange={(event) => update(key, { name: event.target.value, employeeId: undefined })} placeholder="Nama lengkap beserta gelar" /></label>
          <label className="block text-xs font-medium text-slate-500">Jabatan penandatangan<input aria-label={`Jabatan penandatangan ${label}`} className={`${field} mt-1`} maxLength={180} disabled={disabled || !canEdit} value={slot.title} onChange={(event) => update(key, { title: event.target.value })} /></label>
        </div>;
      })}
    </div>
    {canEdit && <div className="flex justify-end"><button type="button" className={button} disabled={disabled || CASH_FLOW_SIGNER_SLOTS.some(({ key }) => !signatures[key].title.trim())} onClick={onSave}>Simpan konfigurasi tanda tangan</button></div>}
  </div>;
}
