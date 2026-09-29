"use client";

import { useId, useRef, useState } from 'react';
import { CircleAlert, Check, Info, Loader2, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { authenticatedJson } from '@/lib/payroll/client';
import { cn } from '@/lib/utils';
import {
  DAMAGE_CHOICES,
  formatInspectionDate,
  inspectionLocationLabel,
  MAX_INSPECTION_NOTES_LENGTH,
  type CheckInSubmission,
  type DamageLevel,
  type ReturnInspectionView,
  type RoomCondition,
} from '@/lib/venueInspection';

/**
 * "Pemeriksaan pengembalian": the return check of one booking. The layout,
 * sizes and weights are SIMPEL's modal (its maintenance page): flat, compact,
 * small radii, sentence-case labels, and its green/red states. Only the accent
 * is SAKU's (indigo for SIMPEL's navy) and its dropdown replaces SIMPEL's.
 * Every built-in fixture is tapped Baik or Rusak and every borrowed item is
 * marked Lengkap or Ada selisih before the check can be finished. The server
 * re-checks all of it.
 */

interface PermanentState {
  status: 'baik' | 'rusak' | null;
  qtyRusak: number;
  condition: DamageLevel;
  damageTypes: string[];
}

interface MobileState {
  status: 'lengkap' | 'selisih' | null;
  returnedQtyBaik: number;
  condition: DamageLevel;
  damageTypes: string[];
}

export interface ReturnCheckResult {
  bookingId: string;
  damageSummaries: string[];
}

const FIELD_LABEL = 'block text-[13px] font-medium text-slate-700';
const CONTROL_FOCUS = 'focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-100';
const INPUT_CLASS = cn('h-8 rounded-md border-slate-300 bg-white px-2.5 text-sm tabular-nums text-slate-900', CONTROL_FOCUS);
// SAKU's globals.css forces 16px on every button, input and select at 768px and
// below (an iOS zoom guard for fields). Fields keep that; the `!` on the button
// sizes lets buttons and chips stay at SIMPEL's 13px / 14px / 12px on phones too.
const BUTTON_SM = 'h-8 rounded-md px-3 text-[13px]! font-medium';
const BUTTON_MD = 'h-9 rounded-md px-3.5 text-sm! font-medium';
const PRIMARY = 'bg-indigo-600 text-white hover:bg-indigo-700';
const SECONDARY = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900';

const FIXTURE_DAMAGE_LEVELS = [
  { value: 'Rusak Ringan', label: 'Rusak ringan (diservis)' },
  { value: 'Rusak Berat', label: 'Rusak berat / tidak berfungsi' },
] as const;
const BORROWED_DAMAGE_LEVELS = [
  { value: 'Rusak Ringan', label: 'Rusak ringan (diservis)' },
  { value: 'Rusak Berat', label: 'Rusak berat / hilang' },
] as const;
const ROOM_CONDITION_OPTIONS = [
  { value: 'Bersih', label: 'Bersih dan layak pakai' },
  { value: 'Maintenance', label: 'Butuh pembersihan / perawatan' },
] as const;

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** SAKU's dropdown in place of SIMPEL's custom one: same popup-with-check behaviour. */
function ChoiceSelect<T extends string>({
  id,
  value,
  options,
  onChange,
  tall = false,
}: {
  id?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** 36px instead of 32px, for a field that stands on its own. */
  tall?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next as T)}>
      <SelectTrigger
        id={id}
        className={cn(
          'w-full rounded-md border-slate-300 bg-white px-2.5 text-sm text-slate-900',
          CONTROL_FOCUS,
          tall ? 'data-[size=default]:h-9' : 'data-[size=default]:h-8',
        )}
      >
        <SelectValue>{options.find((option) => option.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent className="rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="rounded-md py-1.5 pl-2.5 text-sm data-[selected]:bg-indigo-50! data-[selected]:font-medium data-[selected]:text-indigo-700! data-[selected]:**:text-indigo-700!"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DamageChips({
  choices,
  selected,
  onToggle,
}: {
  choices: readonly string[];
  selected: string[];
  onToggle: (choice: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {choices.map((choice) => {
        const active = selected.includes(choice);
        return (
          <button
            key={choice}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(choice)}
            className={cn(
              'cursor-pointer rounded-md border px-2 py-0.5 text-xs! transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
              active
                ? 'border-red-300 bg-red-50 text-red-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50',
            )}
          >
            {choice}
          </button>
        );
      })}
    </div>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

function MarkAllButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      className={cn(BUTTON_SM, 'shrink-0 text-slate-600 hover:bg-slate-100 hover:text-slate-900')}
    >
      {children}
    </Button>
  );
}

function InspectionForm({
  inspection,
  onCancel,
  onDone,
}: {
  inspection: ReturnInspectionView;
  onCancel: () => void;
  onDone: (result: ReturnCheckResult) => void;
}) {
  const formId = useId();
  const { permanent: fixtures, mobile: borrowed } = inspection.checklist;
  const [permanent, setPermanent] = useState<PermanentState[]>(() =>
    fixtures.map(() => ({ status: null, qtyRusak: 1, condition: 'Rusak Ringan', damageTypes: [] })),
  );
  const [mobile, setMobile] = useState<MobileState[]>(() =>
    borrowed.map((item) => ({ status: null, returnedQtyBaik: item.borrowedQty, condition: 'Rusak Ringan', damageTypes: [] })),
  );
  const [roomCondition, setRoomCondition] = useState<RoomCondition>('Bersih');
  const [roomDamageTypes, setRoomDamageTypes] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updatePermanent = (index: number, change: (current: PermanentState) => PermanentState) =>
    setPermanent((previous) => previous.map((entry, position) => (position === index ? change(entry) : entry)));
  const updateMobile = (index: number, change: (current: MobileState) => MobileState) =>
    setMobile((previous) => previous.map((entry, position) => (position === index ? change(entry) : entry)));

  // Tapping cycles: not checked → baik → rusak → baik.
  const cyclePermanent = (index: number) =>
    updatePermanent(index, (current) =>
      current.status === 'baik'
        ? { ...current, status: 'rusak', qtyRusak: 1 }
        : { ...current, status: 'baik', qtyRusak: 1, damageTypes: current.status === 'rusak' ? [] : current.damageTypes },
    );
  const markAllPermanentGood = () =>
    setPermanent((previous) => previous.map((entry) => ({ ...entry, status: 'baik', qtyRusak: 1, damageTypes: [] })));

  const setMobileStatus = (index: number, status: 'lengkap' | 'selisih') =>
    updateMobile(index, (current) => {
      const borrowedQty = borrowed[index].borrowedQty;
      if (status === 'lengkap') return { ...current, status, returnedQtyBaik: borrowedQty, damageTypes: [] };
      const rusak = Math.min(borrowedQty, Math.max(1, borrowedQty - current.returnedQtyBaik));
      return { ...current, status, returnedQtyBaik: borrowedQty - rusak };
    });
  const markAllMobileComplete = () =>
    setMobile((previous) =>
      previous.map((entry, index) => ({
        ...entry,
        status: 'lengkap',
        returnedQtyBaik: borrowed[index].borrowedQty,
        damageTypes: [],
      })),
    );

  const uncheckedPermanent = permanent.filter((entry) => entry.status === null).length;
  const uncheckedMobile = mobile.filter((entry) => entry.status === null).length;
  const canFinish = uncheckedPermanent === 0 && uncheckedMobile === 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canFinish || submitting) return;
    const submission: CheckInSubmission = {
      bookingId: inspection.id,
      permanent: fixtures.map((item, index) => ({
        key: item.key,
        status: permanent[index].status,
        qtyRusak: permanent[index].qtyRusak,
        condition: permanent[index].condition,
        damageTypes: permanent[index].damageTypes,
      })),
      mobile: borrowed.map((item, index) => ({
        key: item.key,
        status: mobile[index].status,
        returnedQtyBaik: mobile[index].returnedQtyBaik,
        condition: mobile[index].condition,
        damageTypes: mobile[index].damageTypes,
      })),
      roomCondition,
      roomDamageTypes: roomCondition === 'Maintenance' ? roomDamageTypes : [],
      notes: notes.trim(),
    };
    setSubmitting(true);
    setError(null);
    try {
      const result = await authenticatedJson<ReturnCheckResult>('/api/venue-inspections', {
        method: 'POST',
        body: JSON.stringify({ action: 'check-in', ...submission }),
      });
      onDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pemeriksaan.');
      setSubmitting(false);
    }
  };

  const groupTotal = inspection.groupTotal ?? 0;
  const groupIndex = inspection.groupIndex ?? 0;

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5">
        <p className="text-[13px] text-slate-500">
          {inspectionLocationLabel(inspection)}
          {inspection.ownerName && ` · PIC ${inspection.ownerName}`}
        </p>

        {groupTotal > 1 ? (
          <div className="flex gap-2.5 rounded-md bg-indigo-50 px-3 py-2.5 text-[13px] text-indigo-900">
            <Info size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
            {groupIndex > 0 && groupIndex < groupTotal ? (
              <div className="min-w-0">
                <p className="font-medium">
                  Hari {groupIndex} dari {groupTotal}
                </p>
                <p className="mt-0.5 opacity-90">
                  Kegiatan berlanjut{' '}
                  {inspection.nextGroupDate ? `pada ${formatInspectionDate(inspection.nextGroupDate)}` : 'besok'}. Periksa
                  sebagian saja jika fasilitas tetap di ruangan.
                </p>
              </div>
            ) : (
              <div className="min-w-0">
                <p className="font-medium">Hari terakhir dari {groupTotal}</p>
                <p className="mt-0.5 opacity-90">Periksa semua inventaris dan kunci ruangan.</p>
              </div>
            )}
          </div>
        ) : null}

        {/* 1. Fixtures built into the room */}
        <section className="space-y-3">
          <SectionHeader
            title="Fasilitas bawaan ruangan (Permanen)"
            description=""
            action={fixtures.length > 0 ? <MarkAllButton onClick={markAllPermanentGood}>Semua baik</MarkAllButton> : null}
          />

          {fixtures.length === 0 ? (
            <p className="text-[13px] text-slate-500">Tidak ada fasilitas bawaan tercatat untuk ruangan ini.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {fixtures.map((item, index) => {
                const state = permanent[index];
                const isGood = state.status === 'baik';
                const isDamaged = state.status === 'rusak';
                const isUnchecked = state.status === null;
                const qtyId = `${formId}-${item.key}-qty`;
                const levelId = `${formId}-${item.key}-level`;
                return (
                  <div
                    key={item.key}
                    className={cn(
                      'overflow-hidden rounded-lg border transition-all',
                      isUnchecked && 'border-slate-200 bg-white hover:border-slate-300',
                      isGood && 'border-green-300 bg-green-50/60',
                      isDamaged && 'border-red-300 bg-white sm:col-span-2',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => cyclePermanent(index)}
                      aria-label={`${item.name}: ${isUnchecked ? 'belum diperiksa' : isGood ? 'baik' : 'rusak'}. Ketuk untuk mengubah.`}
                      className={cn(
                        'flex w-full cursor-pointer items-center justify-between gap-3 p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400',
                        isUnchecked && 'hover:bg-slate-50/80',
                        isGood && 'hover:bg-green-100/50',
                        isDamaged && 'bg-red-50/80 hover:bg-red-100/60',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-slate-900">{item.name}</p>
                          {item.totalQty > 1 && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
                              {item.totalQty} unit
                            </span>
                          )}
                        </div>
                        <p
                          className={cn(
                            'mt-0.5 text-xs',
                            isUnchecked && 'text-slate-400',
                            isGood && 'font-medium text-green-700',
                            isDamaged && 'font-medium text-red-700',
                          )}
                        >
                          {isUnchecked && 'Belum diperiksa (ketuk)'}
                          {isGood && (item.totalQty > 1 ? `✓ Semua baik (${item.totalQty} unit)` : '✓ Kondisi baik')}
                          {isDamaged &&
                            (item.totalQty > 1
                              ? `✕ Ada kerusakan (${state.qtyRusak} dari ${item.totalQty} unit)`
                              : '✕ Rusak / Butuh perbaikan')}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {isUnchecked && (
                          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-slate-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                          </span>
                        )}
                        {isGood && (
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white">
                            <Check className="h-3.5 w-3.5 stroke-[3]" />
                          </span>
                        )}
                        {isDamaged && (
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white">
                            <X className="h-3.5 w-3.5 stroke-[3]" />
                          </span>
                        )}
                      </div>
                    </button>

                    {isDamaged && (
                      <div className="space-y-3 border-t border-red-200 bg-red-50/40 p-3.5">
                        <div className={cn('grid grid-cols-1 gap-3', item.totalQty > 1 && 'sm:grid-cols-2')}>
                          {item.totalQty > 1 && (
                            <Field
                              label="Jumlah unit bermasalah"
                              htmlFor={qtyId}
                              hint={`Maksimal ${item.totalQty} unit (${item.totalQty - state.qtyRusak} unit masih baik)`}
                            >
                              <Input
                                id={qtyId}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={item.totalQty}
                                value={state.qtyRusak}
                                onChange={(event) => {
                                  const value = parseInt(event.target.value, 10);
                                  updatePermanent(index, (current) => ({
                                    ...current,
                                    qtyRusak: Math.max(1, Math.min(item.totalQty, Number.isNaN(value) ? 1 : value)),
                                  }));
                                }}
                                className={INPUT_CLASS}
                              />
                            </Field>
                          )}
                          <Field label="Tingkat kerusakan" htmlFor={levelId}>
                            <ChoiceSelect
                              id={levelId}
                              value={state.condition}
                              options={FIXTURE_DAMAGE_LEVELS}
                              onChange={(condition) => updatePermanent(index, (current) => ({ ...current, condition }))}
                            />
                          </Field>
                        </div>
                        <div className="space-y-1.5">
                          <p className="text-xs text-slate-600">Pilih detail kerusakan:</p>
                          <DamageChips
                            choices={DAMAGE_CHOICES[item.category]}
                            selected={state.damageTypes}
                            onToggle={(choice) =>
                              updatePermanent(index, (current) => ({
                                ...current,
                                damageTypes: toggle(current.damageTypes, choice),
                              }))
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 2. Equipment borrowed for the event */}
        <section className="space-y-3 border-t border-slate-100 pt-4">
          <SectionHeader
            title="Barang pinjaman tambahan (Bergerak)"
            description=""
            action={borrowed.length > 0 ? <MarkAllButton onClick={markAllMobileComplete}>Semua lengkap</MarkAllButton> : null}
          />

          {borrowed.length === 0 ? (
            <p className="text-[13px] text-slate-500">
              Hanya peminjaman ruangan — tidak ada barang bergerak yang dipinjam.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {borrowed.map((item, index) => {
                const state = mobile[index];
                const isComplete = state.status === 'lengkap';
                const hasIssue = state.status === 'selisih';
                const isUnchecked = state.status === null;
                const returnedQtyRusak = item.borrowedQty - state.returnedQtyBaik;
                const goodId = `${formId}-${item.key}-good`;
                const levelId = `${formId}-${item.key}-level`;
                return (
                  <li key={item.key} className="space-y-3 p-3.5">
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">
                          {item.category} ·{' '}
                          <span className="font-semibold tabular-nums text-slate-700">{item.borrowedQty} unit</span> dipinjam
                          {isUnchecked && <span className="ml-2 font-medium text-amber-600">· Belum diperiksa</span>}
                          {isComplete && <span className="ml-2 font-medium text-green-700">· Lengkap &amp; baik</span>}
                          {hasIssue && <span className="ml-2 font-medium text-red-700">· Ada selisih / rusak</span>}
                        </p>
                      </div>
                      <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                        <Button
                          type="button"
                          variant="outline"
                          aria-pressed={isComplete}
                          onClick={() => setMobileStatus(index, 'lengkap')}
                          className={cn(BUTTON_SM, isComplete ? cn(PRIMARY, 'border-indigo-600 hover:text-white') : SECONDARY)}
                        >
                          <Check />
                          Lengkap ({item.borrowedQty})
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          aria-pressed={hasIssue}
                          onClick={() => setMobileStatus(index, 'selisih')}
                          className={cn(
                            BUTTON_SM,
                            hasIssue ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-700' : SECONDARY,
                          )}
                        >
                          <TriangleAlert />
                          Ada selisih / rusak
                        </Button>
                      </div>
                    </div>

                    {hasIssue && (
                      <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/50 p-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <Field label="Kembali baik" htmlFor={goodId}>
                            <Input
                              id={goodId}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={item.borrowedQty}
                              value={state.returnedQtyBaik}
                              onChange={(event) => {
                                const value = parseInt(event.target.value, 10) || 0;
                                updateMobile(index, (current) => ({
                                  ...current,
                                  returnedQtyBaik: Math.max(0, Math.min(item.borrowedQty, value)),
                                }));
                              }}
                              className={INPUT_CLASS}
                            />
                          </Field>
                          <Field label="Rusak / hilang">
                            <div className="flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold tabular-nums text-red-600">
                              {returnedQtyRusak} unit
                            </div>
                          </Field>
                          <Field label="Tingkat kerusakan" htmlFor={levelId}>
                            <ChoiceSelect
                              id={levelId}
                              value={state.condition}
                              options={BORROWED_DAMAGE_LEVELS}
                              onChange={(condition) => updateMobile(index, (current) => ({ ...current, condition }))}
                            />
                          </Field>
                        </div>
                        {returnedQtyRusak > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs text-slate-600">Pilih detail kerusakan:</p>
                            <DamageChips
                              choices={DAMAGE_CHOICES[item.category]}
                              selected={state.damageTypes}
                              onToggle={(choice) =>
                                updateMobile(index, (current) => ({
                                  ...current,
                                  damageTypes: toggle(current.damageTypes, choice),
                                }))
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 3. The room's cleanliness */}
        <section className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Field label="Kebersihan & kesiapan ruangan" htmlFor={`${formId}-room`}>
              <ChoiceSelect
                tall
                id={`${formId}-room`}
                value={roomCondition}
                options={ROOM_CONDITION_OPTIONS}
                onChange={setRoomCondition}
              />
            </Field>
            {roomCondition === 'Maintenance' && (
              <DamageChips
                choices={DAMAGE_CHOICES.Gedung}
                selected={roomDamageTypes}
                onToggle={(choice) => setRoomDamageTypes((previous) => toggle(previous, choice))}
              />
            )}
          </div>
          <Field label="Catatan pemeriksaan (opsional)" htmlFor={`${formId}-notes`}>
            <textarea
              id={`${formId}-notes`}
              rows={3}
              value={notes}
              maxLength={MAX_INSPECTION_NOTES_LENGTH}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Catatan kebersihan atau kondisi barang..."
              className={cn(
                'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400',
                CONTROL_FOCUS,
              )}
            />
          </Field>
        </section>

        {error && (
          <div role="alert" className="flex gap-2.5 rounded-md bg-red-50 px-3 py-2.5 text-[13px] text-red-800">
            <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className={cn(BUTTON_MD, SECONDARY)}>
          Batal
        </Button>
        <Button type="submit" disabled={!canFinish || submitting} className={cn(BUTTON_MD, PRIMARY)}>
          {submitting && <Loader2 className="animate-spin" />}
          {uncheckedPermanent > 0
            ? `Periksa ${uncheckedPermanent} fasilitas bawaan`
            : uncheckedMobile > 0
              ? `Periksa ${uncheckedMobile} barang pinjaman`
              : 'Selesaikan pemeriksaan'}
        </Button>
      </div>
    </form>
  );
}

export default function ReturnInspectionDialog({
  inspection,
  onClose,
  onDone,
}: {
  inspection: ReturnInspectionView | null;
  onClose: () => void;
  onDone: (result: ReturnCheckResult) => void;
}) {
  // Focus the header, not "Semua baik", so opening the check highlights nothing.
  const headerRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={!!inspection} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        initialFocus={headerRef}
        className="flex max-h-[92vh] w-[95vw] flex-col gap-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-0 shadow-lg ring-0 sm:max-w-2xl"
      >
        {inspection && (
          <>
            <DialogHeader ref={headerRef} tabIndex={-1} className="shrink-0 gap-0 px-5 pb-4 pr-12 pt-5 outline-none">
              <DialogTitle className="text-base font-semibold text-slate-900">Pemeriksaan pengembalian</DialogTitle>
              <DialogDescription className="mt-1 text-[13px] text-slate-500">
                {inspection.kegiatan} · {inspection.pemohon}
              </DialogDescription>
            </DialogHeader>
            <InspectionForm key={inspection.id} inspection={inspection} onCancel={onClose} onDone={onDone} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
