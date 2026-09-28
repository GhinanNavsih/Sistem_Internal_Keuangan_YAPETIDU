"use client";

import { Fragment, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { OptionSelect } from '@/components/ui/option-select';
import { TableBody, TableHead, TableHeader, TableRow, TableCell } from '@/components/ui/table';
import {
  todayInJakarta,
  dependentChildren,
  dependentHistory,
  eligibleFamilyMetrics,
  graduationDate,
  isDateOnly,
  isDependentEligible,
  nextDependentLevel,
  pendingGraduatedChildren,
  type DependentEnrollment,
  type DependentLevel,
  type FamilyAllowanceMetrics,
} from '@/lib/payroll/familyAllowance';

const LEVELS: { level: DependentLevel; label: string }[] = [
  { level: 'SD', label: 'SD' },
  { level: 'SLTP', label: 'SLTP' },
  { level: 'SLTA', label: 'SLTA' },
  { level: 'S1', label: 'Kuliah S1' },
  { level: 'S2', label: 'Kuliah S2' },
];

function formatDateForDisplay(date: string): string {
  if (!isDateOnly(date)) return date;
  const [year, month, day] = date.split('-');
  return `${day}-${month}-${year}`;
}

interface Props {
  value?: FamilyAllowanceMetrics;
  onChange: (metrics: FamilyAllowanceMetrics) => void;
  focusChildId?: string | null;
}

export default function FamilyAllowanceFields({ value, onChange, focusChildId }: Props) {
  const today = todayInJakarta();
  const currentPayrollMonth = `${today.slice(0, 7)}-01`;
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(() => new Set());
  const [correctionIds, setCorrectionIds] = useState<Set<string>>(() => new Set());
  const [nextEnrollmentDates, setNextEnrollmentDates] = useState<Record<string, string>>({});
  const metrics = value || {};
  const history = dependentHistory(metrics);
  const children = dependentChildren(metrics);
  const counts = eligibleFamilyMetrics(metrics, today);
  const spouseIsDependent = counts.spouse_count > 0;
  const legacyCollege = history.filter(item => item.level === 'PT' && isDependentEligible(item, today));
  const pendingChildIds = new Set(pendingGraduatedChildren(metrics, today).map(child => child.id));

  useEffect(() => {
    if (!focusChildId) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`family-child-${focusChildId}`)?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusChildId]);

  const saveHistory = (dependents: DependentEnrollment[]) => {
    const next = { ...metrics, dependents };
    onChange({ ...next, ...eligibleFamilyMetrics(next, today) });
  };

  const addDependent = () => {
    if (history.length >= 100) return;
    const id = crypto.randomUUID();
    setNewlyAddedIds(previous => new Set(previous).add(id));
    saveHistory([...history, { id, child_id: id, level: 'SD', enrolled_at: '' }]);
  };

  const updateDependent = (id: string, changes: Partial<DependentEnrollment>) => {
    saveHistory(history.map(item => item.id === id ? { ...item, ...changes } : item));
  };

  const removeDependent = (id: string) => {
    if (newlyAddedIds.has(id)) {
      setNewlyAddedIds(previous => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      saveHistory(history.filter(item => item.id !== id));
    } else {
      updateDependent(id, { ended_at: currentPayrollMonth });
    }
  };

  const continueSchool = (childId: string, latest: DependentEnrollment, graduatedAt: string) => {
    const level = nextDependentLevel(latest.level);
    const enrolledAt = nextEnrollmentDates[childId];
    if (!level || !isDateOnly(enrolledAt) || enrolledAt < graduatedAt || enrolledAt > today || history.length >= 100) return;
    const id = crypto.randomUUID();
    setNewlyAddedIds(previous => new Set(previous).add(id));
    saveHistory([
      ...history.map(stage => stage.id === latest.id ? { ...stage, no_further_study: false } : stage),
      { id, child_id: childId, level, enrolled_at: enrolledAt },
    ]);
    setNextEnrollmentDates(previous => {
      const next = { ...previous };
      delete next[childId];
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {legacyCollege.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {legacyCollege.length} anak kuliah dari data lama belum dibagi ke S1/S2. Pilih jenjang dan isi tanggal pertama masuk pada barisnya agar masa tunjangan dapat dihitung.
        </p>
      )}
      <div className="space-y-2">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[17%]" />
            <col className="w-[19%]" />
            <col className="w-[13%]" />
            <col className="w-[11%]" />
            <col className="w-[25%]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-normal break-words">Tanggungan</TableHead>
              <TableHead className="whitespace-normal break-words">Jenjang Sekolah</TableHead>
              <TableHead className="whitespace-normal break-words">Tanggal Pertama Masuk</TableHead>
              <TableHead className="whitespace-normal break-words">Tanggal Lulus</TableHead>
              <TableHead className="whitespace-normal break-words">Status</TableHead>
              <TableHead className="whitespace-normal break-words">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="whitespace-normal font-medium">Pasangan</TableCell>
              <TableCell className="whitespace-normal">—</TableCell>
              <TableCell className="whitespace-normal">—</TableCell>
              <TableCell className="whitespace-normal">—</TableCell>
              <TableCell className="whitespace-normal">
                <span className={`text-xs ${spouseIsDependent ? 'text-emerald-700' : 'text-slate-500'}`}>
                  {spouseIsDependent ? 'Aktif' : 'Bukan tanggungan'}
                </span>
              </TableCell>
              <TableCell className="whitespace-normal">
                <label className="inline-flex max-w-full cursor-pointer flex-wrap items-center gap-2 text-xs">
                  <input type="checkbox" checked={spouseIsDependent}
                    aria-label="Jadikan pasangan sebagai tanggungan"
                    onChange={event => onChange({ ...metrics, spouse_count: event.target.checked ? 1 : 0 })}
                    className="size-4 accent-emerald-700" />
                  <span>{spouseIsDependent ? 'Ya' : 'Jadikan tanggungan'}</span>
                </label>
              </TableCell>
            </TableRow>
            {children.map((child, index) => {
              const item = child.latest;
              const active = isDependentEligible(item, today);
              const isNew = newlyAddedIds.has(item.id);
              const needsDate = isNew && !isDateOnly(item.enrolled_at);
              const end = isDateOnly(item.enrolled_at) && item.level !== 'PT'
                ? graduationDate(item.enrolled_at, item.level) : '';
              const pending = pendingChildIds.has(child.id);
              const graduated = !!end && end <= today;
              const correcting = correctionIds.has(item.id);
              const lockGraduatedStage = graduated && !correcting;
              const nextLevel = nextDependentLevel(item.level);
              const canContinue = graduated && !item.ended_at && !!nextLevel;
              const nextDate = nextEnrollmentDates[child.id] || '';
              const nextDateValid = isDateOnly(nextDate) && nextDate >= end && nextDate <= today;
              return (
                <Fragment key={child.id}>
                <TableRow id={`family-child-${child.id}`} className={`${active || isNew ? '' : 'bg-slate-50'} ${focusChildId === child.id ? 'ring-2 ring-inset ring-amber-300' : ''}`}>
                  <TableCell className="whitespace-normal font-medium">Anak {index + 1}</TableCell>
                  <TableCell className="whitespace-normal">
                    <OptionSelect aria-label={`Jenjang sekolah Anak ${index + 1}`} size="sm" placeholder="Pilih jenjang"
                      value={item.level === 'PT' ? '' : item.level}
                      disabled={lockGraduatedStage}
                      onValueChange={value => updateDependent(item.id, { level: value as DependentLevel })}
                      options={LEVELS.map(option => ({ value: option.level, label: option.label }))} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Input id={`family-date-${item.id}`} aria-label={`Tanggal pertama masuk Anak ${index + 1}`} type="date" max={today} value={item.enrolled_at || ''}
                      disabled={lockGraduatedStage}
                      onChange={event => updateDependent(item.id, { enrolled_at: event.target.value })}
                      className="h-9 w-full min-w-0 rounded-lg border-slate-200 px-1.5 text-xs sm:px-2 sm:text-sm" />
                  </TableCell>
                  <TableCell className="whitespace-normal">{end ? formatDateForDisplay(end) : item.level === 'PT' ? 'Pilih jenjang' : '—'}</TableCell>
                  <TableCell className="whitespace-normal">
                    <span className={`text-xs ${needsDate || pending ? 'text-amber-700' : active ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {needsDate ? 'Isi tanggal masuk' : pending ? 'Lulus · perlu ditinjau' :
                        item.ended_at ? 'Dihentikan' : graduated && item.no_further_study ? 'Lulus · tidak lanjut' :
                        graduated ? 'Lulus' : active ? 'Aktif' : 'Tidak aktif'}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                  {active || isNew ? (
                    <Button type="button" variant="outline" size="sm" className="h-7 max-w-full whitespace-nowrap px-2 text-[11px] sm:text-xs"
                      onClick={() => removeDependent(item.id)}>
                      {isNew ? 'Hapus tunjangan anak ini' : 'Hentikan tunjangan anak ini'}
                    </Button>
                  ) : graduated ? (
                    <Button type="button" variant="outline" size="sm" className="h-7 max-w-full px-2 text-xs"
                      onClick={() => setCorrectionIds(previous => {
                        const next = new Set(previous);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      })}>
                      {correcting ? 'Selesai koreksi' : 'Koreksi data jenjang'}
                    </Button>
                  ) : '—'}
                  </TableCell>
                </TableRow>
                {canContinue && (
                  <TableRow className={pending ? 'bg-amber-50/70' : 'bg-slate-50'}>
                    <TableCell colSpan={6} className="whitespace-normal py-3">
                      <div className="flex flex-wrap items-end gap-2 text-xs">
                        <span className="self-center font-medium text-slate-700">{pending ? 'Anak sudah lulus. Tentukan kelanjutannya:' : 'Keputusan: tidak lanjut sekolah.'}</span>
                        <label className="flex flex-col gap-1 text-slate-600">
                          Tanggal pertama masuk {nextLevel === 'S1' || nextLevel === 'S2' ? `Kuliah ${nextLevel}` : nextLevel}
                          <Input aria-label={`Tanggal pertama masuk jenjang berikutnya Anak ${index + 1}`} type="date"
                            min={end} max={today} value={nextDate}
                            onChange={event => setNextEnrollmentDates(previous => ({ ...previous, [child.id]: event.target.value }))}
                            className="h-8 w-44 border-slate-200 bg-white text-xs" />
                        </label>
                        <Button type="button" variant="outline" size="sm" className="h-8 bg-white"
                          disabled={!nextDateValid || history.length >= 100}
                          onClick={() => continueSchool(child.id, item, end)}>
                          Lanjut ke {nextLevel === 'S1' || nextLevel === 'S2' ? `Kuliah ${nextLevel}` : nextLevel}
                        </Button>
                        {pending && (
                          <Button type="button" variant="outline" size="sm" className="h-8 bg-white"
                            onClick={() => updateDependent(item.id, { no_further_study: true })}>
                            Tidak lanjut sekolah
                          </Button>
                        )}
                        <span className="self-center text-slate-500">Perubahan berlaku setelah data karyawan disimpan.</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {child.stages.length > 1 && (
                  <TableRow className="bg-slate-50/50">
                    <TableCell colSpan={6} className="whitespace-normal py-1 text-xs text-slate-500">
                      <details>
                        <summary className="cursor-pointer">Riwayat jenjang Anak {index + 1} ({child.stages.length} jenjang)</summary>
                        <ul className="mt-2 space-y-1 pl-4">
                          {child.stages.map(stage => (
                            <li key={stage.id}>
                              {stage.level}: masuk {formatDateForDisplay(stage.enrolled_at)}
                              {stage.level !== 'PT' && isDateOnly(stage.enrolled_at)
                                ? ` · lulus ${formatDateForDisplay(graduationDate(stage.enrolled_at, stage.level))}` : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              );
            })}
            <TableRow>
              <TableCell colSpan={6} className="whitespace-normal text-center">
                <Button type="button" variant="outline" size="sm" disabled={history.length >= 100} onClick={addDependent}>
                  Tambah Anak
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </table>
      </div>
    </div>
  );
}
