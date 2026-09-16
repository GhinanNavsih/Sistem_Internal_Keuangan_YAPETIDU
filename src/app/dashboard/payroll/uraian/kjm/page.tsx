'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { auth } from '@/lib/firebase';
import { authenticatedJson } from '@/lib/payroll/client';
import { emptyKjmEdits, filterKjmCourses, groupKjmCourses, reviewKjm, type KjmCourse, type KjmEdits, type KjmEmployee, type KjmRate, type KjmReview } from '@/lib/payroll/kjm';
import { Button } from '@/components/ui/button';
import { ChevronDown, FileSpreadsheet, Upload, X } from 'lucide-react';

interface ImportSummary { id: string; fileName: string; semester: string; status: string; total: number; revision: number }
interface Draft extends ImportSummary { period: string; revision: number; courses: KjmCourse[]; edits: KjmEdits; review: KjmReview; reviewHash: string; rateVersion: string }
interface Master { employees: KjmEmployee[]; rates: KjmRate[]; version: string }
type DraftResponse = Master & { draft: Draft };
type AutosaveState = 'idle' | 'scheduled' | 'saving' | 'saved' | 'error';
type KjmSection = 'classification' | 'lecturers' | 'calculation';
const KJM_SECTION_OPTIONS: Array<{ key: KjmSection; label: string }> = [
  { key: 'classification', label: '1. Bedakan Mata Kuliah' },
  { key: 'lecturers', label: '2. Periksa dosen & rincian' },
  { key: 'calculation', label: '3. Periksa perhitungan & setujui' },
];
const rupiah = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const inputClass = 'border border-slate-200 rounded-lg px-3 py-2 bg-white text-sm disabled:bg-slate-100 w-full';

function EmployeeSearchSelect({ employees, value, onChange, disabled, ariaLabel }: {
  employees: KjmEmployee[]; value: string; onChange: (id: string) => void; disabled?: boolean; ariaLabel: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const active = useMemo(() => employees.filter(e => e.active).sort((a, b) => a.name.localeCompare(b.name)), [employees]);
  const selected = active.find(e => e.id === value);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active.slice(0, 20);
    return active.filter(e => e.name.toLowerCase().includes(q) || e.nipy.includes(q)).slice(0, 20);
  }, [active, query]);
  if (selected && !open) return <div className="flex items-center gap-2">
    <span className={`${inputClass} flex-1 truncate`}>{selected.nipy} — {selected.name}</span>
    {!disabled && <button type="button" className="shrink-0 text-xs font-semibold text-indigo-600" onClick={() => { setQuery(''); setOpen(true); }}>Ganti</button>}
  </div>;
  return <div className="relative">
    <input aria-label={ariaLabel} role="combobox" aria-expanded={open} autoComplete="off" placeholder="Cari nama / NIPY…"
      className={inputClass} disabled={disabled} value={query}
      onChange={e => { setQuery(e.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      onKeyDown={e => {
        if (e.key === 'Escape') setOpen(false);
        if (e.key === 'Enter' && matches.length) { e.preventDefault(); onChange(matches[0].id); setQuery(''); setOpen(false); }
      }} />
    {open && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-white text-sm shadow-lg">
      {!matches.length && <li className="p-2 text-slate-400">Tidak ditemukan.</li>}
      {matches.map(e => <li key={e.id}>
        <button type="button" className="w-full px-3 py-2 text-left hover:bg-indigo-50" onClick={() => { onChange(e.id); setQuery(''); setOpen(false); }}>{e.nipy} — {e.name}</button>
      </li>)}
    </ul>}
  </div>;
}

function SemesterSearchSelect({ value, onChange, disabled, period }: {
  value: string; onChange: (val: string) => void; disabled?: boolean; period?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const baseYear = useMemo(() => {
    const fromPeriod = period ? parseInt(period.split('-')[0], 10) : NaN;
    return Number.isFinite(fromPeriod) ? fromPeriod : new Date().getFullYear();
  }, [period]);

  const allOptions = useMemo(() => {
    const list: Array<{ value: string; term: string }> = [];
    for (let y = baseYear + 2; y >= baseYear - 3; y--) {
      list.push({ value: `${y}/2`, term: 'Genap' });
      list.push({ value: `${y}/1`, term: 'Ganjil' });
    }
    return list;
  }, [baseYear]);

  // Handle clicking outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === value.toLowerCase()) return allOptions;

    let normalized = q;
    if (/^20\d{2}[12]$/.test(q)) {
      normalized = `${q.slice(0, 4)}/${q.slice(4)}`;
    }

    const filtered = allOptions.filter(o =>
      o.value.toLowerCase().includes(normalized) ||
      o.term.toLowerCase().includes(normalized) ||
      (normalized === 'ganjil' && o.value.endsWith('/1')) ||
      (normalized === 'genap' && o.value.endsWith('/2'))
    );

    if (/^20\d{2}\/[12]$/.test(normalized) && !filtered.some(f => f.value === normalized)) {
      const isGanjil = normalized.endsWith('/1');
      return [{
        value: normalized,
        term: isGanjil ? 'Ganjil' : 'Genap',
      }, ...filtered];
    }

    return filtered;
  }, [allOptions, query, value]);

  const handleSelect = (val: string) => {
    onChange(val);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          aria-label="Semester sumber"
          role="combobox"
          aria-expanded={open}
          autoComplete="off"
          placeholder="Pilih semester (contoh 2025/1)…"
          className={`${inputClass} h-10 pr-9 cursor-pointer`}
          disabled={disabled}
          value={open ? query : value}
          onChange={e => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (!disabled) {
              setOpen(true);
              setQuery(value);
              requestAnimationFrame(() => inputRef.current?.select());
            }
          }}
          onClick={() => {
            if (!disabled && !open) {
              setOpen(true);
              setQuery(value);
              requestAnimationFrame(() => inputRef.current?.select());
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (matches.length > 0) {
                handleSelect(matches[0].value);
              }
            } else if (e.key === 'ArrowDown') {
              if (!open) {
                e.preventDefault();
                setOpen(true);
                setQuery(value);
                requestAnimationFrame(() => inputRef.current?.select());
              }
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              if (open) {
                setOpen(false);
                setQuery('');
              } else {
                setOpen(true);
                setQuery(value);
                inputRef.current?.focus();
                requestAnimationFrame(() => inputRef.current?.select());
              }
            }
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 disabled:opacity-50 p-0.5"
        >
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {!matches.length && (
            <li className="px-3 py-2 text-slate-400 text-xs">Semester tidak ditemukan.</li>
          )}
          {matches.map(opt => (
            <li key={opt.value} role="option" aria-selected={value === opt.value}>
              <button
                type="button"
                className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-indigo-50 transition-colors ${
                  value === opt.value ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700'
                }`}
                onMouseDown={e => {
                  e.preventDefault();
                  handleSelect(opt.value);
                }}
              >
                <span className="font-medium">{opt.value}</span>
                <span className={`text-xs px-2 py-0.5 rounded font-normal ${
                  value === opt.value ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {opt.term}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KjmFileInput({ file, onChange, disabled }: {
  file: File | null; onChange: (file: File | null) => void; disabled?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="relative w-full">
      <input
        ref={fileInputRef}
        aria-label="Berkas KJM"
        type="file"
        accept=".xlsx"
        className="hidden"
        disabled={disabled}
        onChange={e => {
          onChange(e.target.files?.[0] || null);
          e.target.value = '';
        }}
      />
      {file ? (
        <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50/70 px-3 py-1.5 transition-colors">
          <div
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
            onClick={() => !disabled && fileInputRef.current?.click()}
            title={`${file.name} (${formatSize(file.size)}) — Klik untuk ganti berkas`}
          >
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1 truncate">
              <span className="block truncate text-xs font-semibold text-slate-800">{file.name}</span>
              <span className="block text-[10px] text-slate-500 font-normal leading-none">{formatSize(file.size)} · Klik untuk ganti</span>
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              className="shrink-0 rounded p-1 text-slate-400 hover:bg-emerald-100 hover:text-red-600 transition-colors"
              onClick={() => onChange(null)}
              title="Hapus berkas"
              aria-label="Hapus berkas"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 text-sm text-slate-600 hover:border-indigo-400 hover:bg-indigo-50/30 hover:text-indigo-600 transition-all disabled:pointer-events-none disabled:opacity-50"
        >
          <Upload className="h-4 w-4 text-slate-400" />
          <span className="truncate text-xs font-medium">Pilih berkas Excel (.xlsx)</span>
        </button>
      )}
    </div>
  );
}

function KjmMetricGroup({ title, items }: {
  title: string;
  items: Array<{ label: string; value: string | number; emphasize?: boolean }>;
}) {
  return <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3>
    <dl className="mt-2 space-y-1.5">
      {items.map(item => <div key={item.label} className="flex min-w-0 items-baseline justify-between gap-2">
        <dt className="min-w-0 text-xs text-slate-500">{item.label}</dt>
        <dd className={`min-w-0 break-words text-right text-sm ${item.emphasize ? 'font-bold text-indigo-700' : 'font-semibold text-slate-800'}`}>{item.value}</dd>
      </div>)}
    </dl>
  </div>;
}

function KjmContent() {
  const { profile } = useAuth();
  const params = useSearchParams();
  const now = new Date();
  const period = `${params.get('year') || now.getFullYear()}-${String(params.get('month') || now.getMonth() + 1).padStart(2, '0')}`;
  const [master, setMaster] = useState<Master>({ employees: [], rates: [], version: '' });
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edits, setEdits] = useState<KjmEdits>(emptyKjmEdits);
  const [semester, setSemester] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [closed, setClosed] = useState(false);
  const [confirm, setConfirm] = useState<'approve' | 'revoke' | null>(null);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [activeKjmSection, setActiveKjmSection] = useState<KjmSection>('classification');
  const activePeriod = useRef(period);
  const draftRef = useRef<Draft | null>(null);
  const editsRef = useRef<KjmEdits>(edits);
  const busyRef = useRef(busy);
  const hydratingRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef(false);
  const autosaveQueuedRef = useRef(false);
  const saveDraftAutomaticallyRef = useRef<() => Promise<void>>(async () => {});
  const failedAutosaveEditsRef = useRef('');
  useEffect(() => { activePeriod.current = period; }, [period]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { editsRef.current = edits; }, [edits]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  const refresh = useCallback(async () => {
    const data = await authenticatedJson<Master & { imports: ImportSummary[]; closed: boolean }>(`/api/payroll/kjm?period=${period}`);
    if (activePeriod.current !== period) return;
    setMaster(data); setImports(data.imports); setClosed(data.closed);
  }, [period]);
  useEffect(() => {
    if (profile?.role !== 'super_admin') return;
    let cancelled = false;
    const load = async () => {
      setBusy('Memuat data KJM…'); setDraft(null); setConfirm(null); setError(''); setMessage('');
      draftRef.current = null; editsRef.current = emptyKjmEdits(); setEdits(emptyKjmEdits()); setAutosaveState('idle');
      try { await refresh(); } catch (e) { if (!cancelled) setError((e as Error).message); }
      finally { if (!cancelled) setBusy(''); }
    };
    void load();
    return () => { cancelled = true; };
  }, [profile?.role, refresh]);
  const fetchDraft = useCallback(async (id: string): Promise<DraftResponse | null> => {
    const data = await authenticatedJson<DraftResponse>(`/api/payroll/kjm?period=${period}&id=${id}`);
    return activePeriod.current === period ? data : null;
  }, [period]);
  const applyDraft = useCallback((data: DraftResponse, includeEdits: boolean) => {
    hydratingRef.current = includeEdits;
    draftRef.current = data.draft;
    if (includeEdits) editsRef.current = data.draft.edits;
    failedAutosaveEditsRef.current = '';
    setMaster(data); setDraft(data.draft);
    if (includeEdits) setEdits(data.draft.edits);
  }, []);
  const openDraft = useCallback(async (id: string) => {
    const data = await fetchDraft(id);
    if (!data) return;
    const switchingDraft = draftRef.current?.id !== data.draft.id;
    applyDraft(data, true);
    if (switchingDraft) setActiveKjmSection(data.draft.status === 'approved' ? 'calculation' : 'classification');
    setSearch('');
    setAutosaveState('idle');
  }, [applyDraft, fetchDraft]);
  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);
  const scheduleAutosave = useCallback(() => {
    clearAutosaveTimer();
    setAutosaveState('scheduled');
    setError('');
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void saveDraftAutomaticallyRef.current();
    }, 500);
  }, [clearAutosaveTimer]);
  const saveDraftAutomatically = useCallback(async () => {
    const target = draftRef.current;
    const editsToSave = editsRef.current;
    if (!target || target.status !== 'draft' || target.period !== period) return;
    if (busyRef.current || autosaveInFlightRef.current) {
      autosaveQueuedRef.current = true;
      return;
    }
    const serializedEdits = JSON.stringify(editsToSave);
    if (serializedEdits === JSON.stringify(target.edits) || serializedEdits === failedAutosaveEditsRef.current) return;
    autosaveInFlightRef.current = true;
    setAutosaveState('saving');
    setError('');
    try {
      const result = await authenticatedJson<{ warning?: string; revision?: number }>('/api/payroll/kjm', { method: 'POST', body: JSON.stringify({
        action: 'save', id: target.id, revision: target.revision, edits: editsToSave,
      }) });
      if (typeof result.revision === 'number' && Number.isSafeInteger(result.revision)) {
        draftRef.current = { ...target, revision: result.revision, edits: editsToSave };
      }
      const data = await fetchDraft(target.id);
      if (!data) return;
      const localEditsUnchanged = JSON.stringify(editsRef.current) === serializedEdits;
      applyDraft(data, localEditsUnchanged);
      void refresh().catch(() => undefined);
      failedAutosaveEditsRef.current = '';
      if (localEditsUnchanged) setAutosaveState('saved');
    } catch (e) {
      failedAutosaveEditsRef.current = JSON.stringify(editsRef.current);
      setAutosaveState('error');
      setError((e as Error).message);
    } finally {
      autosaveInFlightRef.current = false;
      const currentDraft = draftRef.current;
      const currentEdits = JSON.stringify(editsRef.current);
      const hasPendingEdits = !!currentDraft && currentDraft.status === 'draft' && currentEdits !== JSON.stringify(currentDraft.edits);
      if (hasPendingEdits && currentEdits !== failedAutosaveEditsRef.current) {
        if (busyRef.current) autosaveQueuedRef.current = true;
        else scheduleAutosave();
      } else {
        autosaveQueuedRef.current = false;
      }
      if (autosaveQueuedRef.current && !busyRef.current) {
        autosaveQueuedRef.current = false;
        scheduleAutosave();
      }
    }
  }, [applyDraft, fetchDraft, period, refresh, scheduleAutosave]);
  useEffect(() => { saveDraftAutomaticallyRef.current = saveDraftAutomatically; }, [saveDraftAutomatically]);
  useEffect(() => {
    if (autosaveState !== 'saved') return;
    const timer = setTimeout(() => setAutosaveState('idle'), 3500);
    return () => clearTimeout(timer);
  }, [autosaveState]);
  useEffect(() => {
    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }
    if (!draft || draft.status !== 'draft') return;
    if (busy || autosaveInFlightRef.current) {
      if (autosaveInFlightRef.current) autosaveQueuedRef.current = true;
      return;
    }
    const serializedEdits = JSON.stringify(edits);
    if (serializedEdits === JSON.stringify(draft.edits) || serializedEdits === failedAutosaveEditsRef.current) return;
    scheduleAutosave();
  }, [busy, draft, edits, scheduleAutosave]);
  useEffect(() => {
    if (!busy && autosaveQueuedRef.current && !autosaveInFlightRef.current) {
      autosaveQueuedRef.current = false;
      scheduleAutosave();
    }
  }, [busy, scheduleAutosave]);
  useEffect(() => clearAutosaveTimer, [clearAutosaveTimer]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy || autosaveInFlightRef.current) return;
    clearAutosaveTimer();
    setBusy(label); setError(''); setMessage('');
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  };
  const visibleCourses = useMemo(() => filterKjmCourses(draft?.courses || []), [draft]);
  const excludedCourseCount = (draft?.courses.length || 0) - visibleCourses.length;
  const review = useMemo(() => {
    if (!draft) return null;
    if (draft.status === 'approved') return draft.review;
    return reviewKjm(visibleCourses, edits, master.employees, master.rates, draft.period);
  }, [draft, edits, master, visibleCourses]);
  const dirty = !!draft && (JSON.stringify(edits) !== JSON.stringify(draft.edits) || JSON.stringify(review) !== JSON.stringify(draft.review) || master.version !== draft.rateVersion);
  const editable = !!draft && draft.status === 'draft' && !busy && !closed && draft.period === period;
  const courseGroups = useMemo(() => groupKjmCourses(visibleCourses), [visibleCourses]);
  const lecturers = useMemo(() => [...new Set(visibleCourses.map(c => c.lecturer))], [visibleCourses]);
  const unmatchedLecturers = useMemo(() => {
    if (!review) return [];
    return lecturers.filter(l => !review.ignored.some(s => s.startsWith(`${l}:`)) && !review.assignments[l]);
  }, [lecturers, review]);
  const setAssignment = (lecturer: string, patch: Partial<KjmEdits['lecturers'][string]>) => setEdits(e => ({ ...e, lecturers: { ...e.lecturers, [lecturer]: { ...e.lecturers[lecturer], ...patch } } }));
  const setCourse = (id: string, patch: Partial<KjmEdits['courses'][string]>) => setEdits(e => ({ ...e, courses: { ...e.courses, [id]: { ...e.courses[id], ...patch } } }));
  const courseClassification = (id: string): boolean | undefined => {
    const edit = edits.courses[id];
    return edit && Object.prototype.hasOwnProperty.call(edit, 'consortium') ? edit.consortium : undefined;
  };
  const groupIsConsortium = (group: ReturnType<typeof groupKjmCourses>[number]): boolean => {
    return group.courseIds.length > 0 && group.courseIds.every(id => courseClassification(id) === true);
  };
  const setGroupClassification = (group: ReturnType<typeof groupKjmCourses>[number], consortium: boolean) => {
    setEdits(current => {
      const courses = { ...current.courses };
      group.courseIds.forEach(id => { courses[id] = { ...courses[id], consortium }; });
      return { ...current, courses };
    });
  };
  const courseExcluded = (id: string): boolean => !!edits.courses[id]?.exclude;
  const groupIsExcluded = (group: ReturnType<typeof groupKjmCourses>[number]): boolean => {
    return group.courseIds.length > 0 && group.courseIds.every(id => courseExcluded(id));
  };
  const setGroupExclusion = (group: ReturnType<typeof groupKjmCourses>[number], exclude: boolean) => {
    setEdits(current => {
      const courses = { ...current.courses };
      group.courseIds.forEach(id => { courses[id] = { ...courses[id], exclude }; });
      return { ...current, courses };
    });
  };
  const upload = async () => {
    if (!file) throw new Error('Pilih berkas XLSX.');
    const token = await auth.currentUser?.getIdToken();
    const form = new FormData(); form.set('file', file); form.set('period', period); form.set('semester', semester);
    const response = await fetch('/api/payroll/kjm', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unggah gagal.');
    await refresh(); await openDraft(result.id);
    setMessage('Draft berhasil dibuat. Belum ada penghasilan yang ditambahkan ke payroll.');
  };
  const command = async (action: 'save' | 'approve' | 'revoke') => {
    if (!draft) return;
    clearAutosaveTimer();
    const result = await authenticatedJson<{ warning?: string }>('/api/payroll/kjm', { method: 'POST', body: JSON.stringify({
      action, id: draft.id, revision: draft.revision, ...(action === 'save' ? { edits } : { reviewHash: draft.reviewHash, confirmed: true }),
    }) });
    setConfirm(null); await refresh(); await openDraft(draft.id);
    setMessage(result.warning || (action === 'approve' ? `KJM disetujui dan ditambahkan ke payroll ${draft.period}.` : action === 'revoke' ? 'Persetujuan dibatalkan. KJM ini tidak lagi menjadi penghasilan payroll.' : 'Draft dan perhitungan tersimpan. Periksa hasil sebelum menyetujui.'));
  };
  const flashElement = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const prevBg = el.style.backgroundColor;
    const prevTransition = el.style.transition;
    el.style.transition = 'background-color 0.3s';
    el.style.backgroundColor = '#fde68a';
    window.setTimeout(() => { el.style.backgroundColor = prevBg; el.style.transition = prevTransition; }, 1800);
  };
  const jumpToIssue = (issue: string) => {
    if (!review) return;
    const idx = issue.indexOf(': ');
    const prefix = idx === -1 ? '' : issue.slice(0, idx);
    const course = visibleCourses.find(c => `${c.sheet}:${c.row}` === prefix);
    let targetLecturer = course?.lecturer || (lecturers.includes(prefix) ? prefix : '');
    if (!targetLecturer) {
      const employee = master.employees.find(e => e.name === prefix);
      const entry = employee && Object.entries(review.assignments).find(([, id]) => id === employee.id);
      if (entry) targetLecturer = entry[0];
    }
    if (!targetLecturer) {
      if (issue.startsWith('Konfirmasi pemeriksaan')) {
        setActiveKjmSection('classification');
        requestAnimationFrame(() => {
          document.getElementById('consortium-reviewed-checkbox')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          flashElement('consortium-reviewed-checkbox');
        });
      }
      return;
    }
    setActiveKjmSection('lecturers');
    setSearch('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const detailsId = `lecturer-${encodeURIComponent(targetLecturer)}`;
      const details = document.getElementById(detailsId);
      if (!(details instanceof HTMLDetailsElement)) return;
      details.open = true;
      const rowId = course ? `course-${course.id}` : '';
      const scrollTarget = (rowId && document.getElementById(rowId)) || details;
      scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashElement(rowId || detailsId);
    }));
  };
  const deleteImport = async (item: ImportSummary) => {
    const selected = draft?.id === item.id;
    if (!window.confirm(`Hapus impor "${item.fileName}"? Data mentah hasil ekstraksi, koreksi, dan perhitungan draft akan dihapus. Tindakan ini tidak dapat dibatalkan.`)) return;
    clearAutosaveTimer();
    await run('Menghapus data impor KJM…', async () => {
      await authenticatedJson('/api/payroll/kjm', { method: 'POST', body: JSON.stringify({ action: 'delete', id: item.id, revision: selected && draft ? draft.revision : item.revision }) });
      if (selected) { draftRef.current = null; editsRef.current = emptyKjmEdits(); setDraft(null); setEdits(emptyKjmEdits()); setAutosaveState('idle'); }
      await refresh();
      setMessage('Data impor KJM berhasil dihapus. Riwayat audit tetap disimpan.');
    });
  };
  if (!profile) return <p className="p-6">Memuat sesi…</p>;
  if (profile.role !== 'super_admin') return <p className="p-6">Halaman KJM hanya tersedia untuk admin.</p>;
  return <div className="space-y-6 p-4 md:p-6">
    <section className="rounded-2xl border bg-white p-5 space-y-4">
      <h2 className="font-bold text-lg">Upload data mentah KJM</h2>
      <p className="text-sm text-slate-600">Periode pembayaran: <strong>{period}</strong>. Hanya sheet Kontrak Asli dan Tetap Asli yang dibaca. Data tersimpan sebagai draft, bukan penghasilan.</p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full sm:w-60 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Semester sumber</label>
          <SemesterSearchSelect
            value={semester}
            onChange={setSemester}
            period={period}
            disabled={!!busy || closed || autosaveState === 'saving'}
          />
        </div>
        <div className="w-full sm:w-80 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Berkas XLSX (maks. 5 MB)</label>
          <KjmFileInput
            file={file}
            onChange={setFile}
            disabled={!!busy || closed || autosaveState === 'saving'}
          />
        </div>
        <Button
          className="h-10 px-5 font-semibold"
          disabled={!!busy || closed || autosaveState === 'saving' || !file || !/^(20\d{2}\/[12]|20\d{2}[12])$/.test(semester)}
          onClick={() => void run('Mengunggah dan menghitung draft…', upload)}
        >
          Upload & buat draft
        </Button>
      </div>
      {closed && <p className="text-amber-700">Periode sudah ditutup. Data hanya dapat dilihat.</p>}
      <p className="text-xs text-slate-500">Masa kerja Admin dinilai pada akhir bulan payroll. Non-Aktif diabaikan. Satu pegawai hanya boleh memperoleh KJM sekali untuk semester sumber yang sama.</p>
    </section>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{message}</p>}
    <section className="rounded-2xl border bg-white p-5 space-y-3">
      <h2 className="font-bold">Impor pada payroll {period}</h2>
      {!imports.length && <p className="text-sm text-slate-500">Belum ada impor.</p>}
      {imports.map(item => <div key={item.id} className={`w-full flex flex-wrap items-center gap-3 border rounded-xl p-3 ${draft?.id === item.id ? 'border-indigo-400 bg-indigo-50' : ''}`}>
        <button type="button" disabled={!!busy || autosaveState === 'saving'} onClick={() => {
          if (dirty && !window.confirm('Ada koreksi yang belum disimpan. Buka impor lain dan abaikan koreksi?')) return;
          void run('Memuat impor…', () => openDraft(item.id));
        }} className="flex min-w-0 flex-1 flex-wrap justify-between gap-2 text-left">
          <span className="truncate">{item.fileName} · Semester {item.semester}</span><span className="whitespace-nowrap">{item.status === 'approved' ? 'Disetujui' : 'Draft belum dibayar'} · {rupiah(item.total)}</span>
        </button>
        {item.status === 'draft' ? <button type="button" aria-label={`Hapus impor ${item.fileName}`} disabled={!!busy || closed || autosaveState === 'saving'} onClick={() => void deleteImport(item)} className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">Hapus</button> : <span className="shrink-0 text-xs text-slate-500">Batalkan persetujuan dulu</span>}
      </div>)}
    </section>
    {draft && review && <>
      <div className="rounded-2xl border border-indigo-100 bg-white p-2 shadow-sm" role="tablist" aria-label="Tahapan KJM">
        <div className="flex flex-wrap gap-2">
          {KJM_SECTION_OPTIONS.map(section => <button key={section.key} id={`kjm-tab-${section.key}`} type="button" role="tab" aria-selected={activeKjmSection === section.key} aria-controls={`kjm-panel-${section.key}`} onClick={() => setActiveKjmSection(section.key)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${activeKjmSection === section.key ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${activeKjmSection === section.key ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{section.label.slice(0, 1)}</span>
            {section.label}
            {section.key === 'lecturers' && review.issues.length > 0 && <span className={`rounded-full px-1.5 py-0.5 text-xs ${activeKjmSection === section.key ? 'bg-white/20' : 'bg-amber-100 text-amber-700'}`}>{review.issues.length}</span>}
          </button>)}
        </div>
      </div>
      {activeKjmSection === 'classification' && <section id="kjm-panel-classification" role="tabpanel" aria-labelledby="kjm-tab-classification" className="rounded-2xl border bg-white p-5 space-y-4">
        <h2 className="font-bold text-lg">1. Bedakan Mata Kuliah</h2>
        <p className="text-sm text-slate-600">Semua Mata Kuliah yang masuk rekap otomatis dianggap Reguler. Centang hanya Mata Kuliah Konsorsium; pilihan akan diterapkan ke seluruh kelas dan baris sumber dengan Kode MK yang sama dalam program studi tersebut.</p>
        <div className="max-h-[85vh] overflow-auto"><table className="w-full text-sm text-left"><thead className="sticky top-0 z-10 bg-indigo-50"><tr>{['Program studi', 'Kode MK', 'Nama Mata Kuliah', 'Kelas', 'SKS', 'Baris sumber', 'Konsorsium?', 'Kecualikan?'].map(h => <th key={h} className="p-3 whitespace-nowrap">{h}</th>)}</tr></thead><tbody>
          {courseGroups.map(group => <tr key={group.key} className="border-t align-top"><td className="p-3">{group.program || '—'}</td><td className="p-3 whitespace-nowrap">{group.code}</td><td className="p-3 min-w-64">{group.name}<br /><span className="text-xs text-slate-500">{group.courseIds.length > 1 ? 'Beberapa kelas/baris sumber' : 'Satu baris sumber'}</span></td><td className="p-3 whitespace-nowrap">{group.classes.join(', ') || '—'}</td><td className="p-3 whitespace-nowrap">{group.sks.join(', ')}</td><td className="p-3 text-center">{group.courseIds.length}</td><td className="p-3 text-center"><input aria-label={`Konsorsium ${group.code}`} type="checkbox" checked={groupIsConsortium(group)} disabled={!editable} onChange={e => setGroupClassification(group, e.target.checked)} /></td><td className="p-3 text-center"><input aria-label={`Kecualikan ${group.code}`} type="checkbox" checked={groupIsExcluded(group)} disabled={!editable} onChange={e => setGroupExclusion(group, e.target.checked)} /></td></tr>)}
        </tbody></table></div>
        <label className="flex gap-2 text-sm"><input id="consortium-reviewed-checkbox" type="checkbox" checked={edits.consortiumReviewed} disabled={!editable} onChange={e => setEdits(old => ({ ...old, consortiumReviewed: e.target.checked }))} /> Saya telah memeriksa semua Mata Kuliah dan pembedaan Reguler/Konsorsium.</label>
      </section>}
      {activeKjmSection === 'lecturers' && <section id="kjm-panel-lecturers" role="tabpanel" aria-labelledby="kjm-tab-lecturers" className="rounded-2xl border bg-white p-5 space-y-4">
        <h2 className="font-bold text-lg">2. Periksa dosen dan rincian mata kuliah</h2>
        <p className="text-sm text-slate-600">{visibleCourses.length} baris · {lecturers.length} identitas sumber{excludedCourseCount > 0 ? ` · ${excludedCourseCount} baris dikecualikan otomatis dari Tetap Asli` : ''}. Jenis Mata Kuliah mengikuti pembedaan di bagian 1. Hadir dikoreksi otomatis diisi maksimal 14, lalu dikalikan SKS untuk memperoleh Hadir diakui.</p>
        {review.issues.length > 0 && <details open className="bg-amber-50 p-4 rounded-xl text-amber-900 text-sm"><summary>{review.issues.length} masalah harus diselesaikan</summary><ul className="list-disc pl-5 mt-2 space-y-1">{review.issues.map((s,i) => <li key={i}><button type="button" className="text-left underline decoration-dotted underline-offset-2 hover:text-amber-950" onClick={() => jumpToIssue(s)}>{s}</button></li>)}</ul></details>}
        {unmatchedLecturers.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-4">
          <p className="font-semibold text-amber-900">{unmatchedLecturers.length} nama dari berkas belum cocok otomatis dengan pegawai (NIPY tidak ditemukan atau tidak unik). Hubungkan ke pegawai aktif atau kecualikan di bawah ini.</p>
          {unmatchedLecturers.map(lecturer => {
            const assignment = edits.lecturers[lecturer] || {};
            const rowCount = visibleCourses.filter(c => c.lecturer === lecturer).length;
            return <div key={lecturer} className="grid md:grid-cols-2 gap-3 items-end border-t border-amber-200 pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm md:col-span-2">{lecturer} <span className="text-xs text-slate-500">· {rowCount} baris</span></p>
              <label className="text-xs">Pegawai aktif<EmployeeSearchSelect ariaLabel={`Hubungkan pegawai ${lecturer}`} employees={master.employees} value={assignment.employeeId || ''} disabled={!editable} onChange={id => setAssignment(lecturer, { employeeId: id })} /></label>
              <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={!!assignment.exclude} disabled={!editable} onChange={e => setAssignment(lecturer, { exclude: e.target.checked })} /> Kecualikan identitas ini</label>
            </div>;
          })}
        </div>}
        <input aria-label="Cari dosen" placeholder="Cari dosen / NIPY…" className={inputClass} value={search} onChange={e => setSearch(e.target.value)} />
        <div className="space-y-2">
          {lecturers.filter(l => l.toLowerCase().includes(search.toLowerCase())).map(lecturer => {
            const assignment = edits.lecturers[lecturer] || {};
            const rows = visibleCourses.filter(c => c.lecturer === lecturer);
            const ignored = review.ignored.find(s => s.startsWith(`${lecturer}:`));
            const employeeId = review.assignments[lecturer] || '';
            const employee = master.employees.find(e => e.id === employeeId);
            const inactive = ignored?.endsWith(': Non-Aktif');
            return <details key={lecturer} id={`lecturer-${encodeURIComponent(lecturer)}`} className="rounded-xl border p-3">
              <summary className="cursor-pointer font-medium text-sm">{lecturer} <span className="font-normal text-slate-500">· {rows.length} MK · {ignored ? `Diabaikan: ${ignored.split(': ').slice(1).join(': ')}` : employee?.name || 'Perlu pemetaan'}</span></summary>
              <div className="grid md:grid-cols-3 gap-3 py-4">
                <label className="text-xs">Pegawai aktif (pencocokan NIPY; nama tidak otomatis)<select aria-label={`Pegawai ${lecturer}`} className={inputClass} value={assignment.employeeId || employeeId} disabled={!editable || !!inactive} onChange={e => setAssignment(lecturer, { employeeId: e.target.value })}>
                  <option value="">Pilih pegawai…</option>{master.employees.filter(e => e.active).sort((a,b) => a.name.localeCompare(b.name)).map(e => <option key={e.id} value={e.id}>{e.nipy} — {e.name}</option>)}
                </select></label>
                <label className="text-xs">Rate reguler — otomatis dari pendidikan<select aria-label={`Rate ${lecturer}`} className={inputClass} value={assignment.rateKey || ''} disabled={!editable || !!inactive} onChange={e => setAssignment(lecturer, { rateKey: e.target.value })}>
                  <option value="">Otomatis: {employee?.education || 'belum dipetakan'}</option>{master.rates.map(r => <option key={`${r.degree}-${r.group}`} value={`${r.degree}-${r.group}`}>{r.degree}-{r.group} · {rupiah(r.amount)}</option>)}
                </select></label>
                <label className="text-xs">Alasan pemetaan/rate/pengecualian<input aria-label={`Alasan ${lecturer}`} className={inputClass} maxLength={500} value={assignment.reason || ''} disabled={!editable || !!inactive} onChange={e => setAssignment(lecturer, { reason: e.target.value })} /></label>
                <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={!!assignment.exclude} disabled={!editable || !!inactive} onChange={e => setAssignment(lecturer, { exclude: e.target.checked })} /> Kecualikan identitas sumber ini</label>
                <p className="text-xs text-slate-500 md:col-span-2">{employee && `${employee.type} · isDosen: ${String(employee.isDosen)} · ${employee.education} · Jabatan: ${employee.role || 'kosong'} · Diakui: ${employee.recognizedDate || 'kosong'}`}</p>
              </div>
              <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead className="bg-slate-50"><tr>{['Sumber / Prodi', 'Mata kuliah / Kelas', 'SKS', 'Hadir asli', 'Hadir dikoreksi', 'SKS × diakui', 'Jenis', 'Kecualikan'].map(h => <th key={h} className="p-2 whitespace-nowrap">{h}</th>)}</tr></thead><tbody>
                {rows.map(c => { const edit = edits.courses[c.id] || {}; const correctedAttendance = edit.attendance ?? Math.min(c.attendance, 14); return <tr key={c.id} id={`course-${c.id}`} className="border-t">
                  <td className="p-2 whitespace-nowrap">{c.sheet}:{c.row}<br />{c.program}</td><td className="p-2 min-w-48">{c.name}<br /><span className="text-slate-500">{c.code} · {c.kelas}</span></td>
                  <td className="p-2">{c.sks}</td><td className="p-2">{c.attendance}</td>
                  <td className="p-2"><input aria-label={`Hadir dikoreksi ${c.id}`} type="number" min={0} max={100} step={1} className={`${inputClass} min-w-20`} value={correctedAttendance} disabled={!editable || !!inactive || !!assignment.exclude} onChange={e => {
                    if (e.target.value === '') setEdits(old => { const next = { ...old.courses[c.id] }; delete next.attendance; return { ...old, courses: { ...old.courses, [c.id]: next } }; });
                    else setCourse(c.id, { attendance: Number(e.target.value) });
                  }} /></td>
                  <td className="p-2">{edit.exclude || assignment.exclude || inactive ? 0 : c.sks * Math.min(correctedAttendance, 14)}</td>
                  <td className="p-2 whitespace-nowrap">{courseClassification(c.id) === true ? 'Konsorsium' : 'Reguler'}</td>
                  <td className="p-2"><input aria-label={`Kecualikan ${c.id}`} type="checkbox" checked={!!edit.exclude} disabled={!editable || !!inactive || !!assignment.exclude} onChange={e => setCourse(c.id, { exclude: e.target.checked })} /></td>
                </tr>; })}
              </tbody></table></div>
            </details>;
          })}
        </div>
      </section>}
      {activeKjmSection === 'calculation' && <section id="kjm-panel-calculation" role="tabpanel" aria-labelledby="kjm-tab-calculation" className="rounded-2xl border bg-white p-5 space-y-4">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div><h2 className="font-bold text-lg">3. Periksa perhitungan dan setujui</h2><p className="text-xs text-slate-500">{review.results.length} pegawai dalam hasil perhitungan</p></div>
          <div className="rounded-xl bg-indigo-50 px-3 py-2 text-right"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Total KJM</p><p className="text-lg font-bold text-indigo-700">{rupiah(review.total)}</p></div>
        </div>
        <p className="text-sm text-slate-600">Tanggal penilaian masa kerja: {review.assessmentDate} · Matrix {draft.status === 'approved' ? draft.rateVersion : master.version}. Angka jam adalah unit SKS × hadir diakui. Konsorsium diprioritaskan dalam batas kelebihan.</p>
        {review.ignored.length > 0 && <details className="text-sm text-slate-500"><summary>{review.ignored.length} identitas diabaikan</summary><ul className="list-disc pl-5">{review.ignored.map(s => <li key={s}>{s}</li>)}</ul></details>}
        <div className="grid gap-3 lg:grid-cols-2">
          {review.results.map(r => {
            const totalTeaching = r.regular + r.consortium;
            return <article key={r.employee.id} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <header className="flex min-w-0 items-start justify-between gap-3 p-4">
                <div className="min-w-0"><h3 className="break-words font-semibold text-slate-900">{r.employee.name}</h3><p className="mt-1 break-words text-xs text-slate-500">{r.employee.nipy} · {r.employee.education}</p></div>
                <div className="shrink-0 rounded-xl bg-indigo-50 px-3 py-2 text-right"><p className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">Total KJM</p><p className="font-bold text-indigo-700">{rupiah(r.total)}</p><p className="text-xs text-slate-500">{r.employee.type}</p></div>
              </header>
              <div className="grid gap-2 border-t border-slate-100 bg-slate-50/40 p-3 sm:grid-cols-2">
                <KjmMetricGroup title="Jam mengajar diakui" items={[{ label: 'Reguler', value: r.regular }, { label: 'Konsorsium', value: r.consortium }, { label: 'Total dihitung', value: totalTeaching, emphasize: true }]} />
                <KjmMetricGroup title="Kewajiban" items={[{ label: 'Wajib dasar', value: r.base }, { label: 'Pengurangan', value: r.reduction }, { label: 'Wajib efektif', value: r.obligation, emphasize: true }, { label: 'Batas', value: r.cap }]} />
                <KjmMetricGroup title="Kelebihan" items={[{ label: 'Total', value: r.excess, emphasize: true }, { label: 'Lebih reguler', value: r.regularExcess }, { label: 'Lebih konsorsium', value: r.consortiumExcess }]} />
                <KjmMetricGroup title="Pembayaran" items={[{ label: 'Rate reguler', value: `${rupiah(r.rate)} · ${r.rateKey}` }, { label: 'Rp reguler', value: rupiah(r.regularPay) }, { label: 'Rp konsorsium', value: rupiah(r.consortiumPay) }, { label: 'Total KJM', value: rupiah(r.total), emphasize: true }]} />
              </div>
            </article>;
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4"><p className="font-bold text-lg">Total {rupiah(review.total)} <span className="text-sm font-normal">· {review.results.length} pegawai {review.issues.length ? '(belum lengkap)' : ''}</span></p>
          <div className="flex flex-wrap gap-3">{draft.status === 'draft' ? <>
            <Button variant="outline" disabled={!editable || autosaveState === 'saving'} onClick={() => void run('Menyimpan koreksi dan menghitung ulang…', () => command('save'))}>Simpan draft & hitung ulang</Button>
            <Button disabled={!editable || dirty || review.issues.length > 0} onClick={() => setConfirm('approve')}>Setujui ke payroll {draft.period}</Button>
          </> : <Button variant="outline" disabled={!!busy || closed} onClick={() => setConfirm('revoke')}>Batalkan persetujuan</Button>}</div>
        </div>
        {dirty && draft.status === 'draft' && <p className="text-sm text-amber-700">Koreksi/master berubah. Perubahan draft akan disimpan otomatis sebelum dapat disetujui.</p>}
      </section>}
    </>}
    {confirm && draft && review && <div role="dialog" aria-modal="true" aria-label="Konfirmasi KJM" className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-5"><div className="bg-white rounded-2xl p-6 max-w-lg space-y-4">
      <h3 className="font-bold text-lg">{confirm === 'approve' ? 'Setujui KJM ke payroll?' : 'Batalkan persetujuan KJM?'}</h3>
      <p>{confirm === 'approve' ? `Saya telah memeriksa perhitungan ${review.results.length} pegawai, total ${rupiah(review.total)}, untuk payroll ${draft.period} dan semester ${draft.semester}.` : 'Penghasilan dari impor ini akan dikeluarkan dari payroll. Slip yang dikunci/dibayar tidak dapat diubah.'}</p>
      <div className="flex justify-end gap-3"><Button variant="outline" disabled={!!busy || autosaveState === 'saving'} onClick={() => setConfirm(null)}>Kembali</Button><Button disabled={!!busy || autosaveState === 'saving'} onClick={() => void run('Memproses persetujuan dan sinkronisasi payroll…', () => command(confirm))}>Konfirmasi</Button></div>
    </div></div>}
    {autosaveState !== 'idle' && <div role="status" aria-live="polite" className={`pointer-events-none fixed right-4 top-4 z-[70] max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg ${autosaveState === 'error' ? 'border-red-200 bg-red-50 text-red-800' : autosaveState === 'saved' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-indigo-200 bg-indigo-50 text-indigo-800'}`}>
      {autosaveState === 'scheduled' ? 'Perubahan dijadwalkan untuk disimpan…' : autosaveState === 'saving' ? 'Menyimpan draft di latar belakang…' : autosaveState === 'saved' ? 'Draft berhasil disimpan.' : 'Draft belum tersimpan. Ubah data untuk mencoba lagi.'}
    </div>}
    {busy && <div role="status" aria-live="polite" className="fixed inset-0 z-[60] bg-white/75 backdrop-blur-sm flex items-center justify-center"><p className="rounded-xl border bg-white p-6 shadow-lg">{busy}</p></div>}
  </div>;
}
export default function KjmPage() { return <Suspense fallback={<p className="p-6">Memuat KJM…</p>}><KjmContent /></Suspense>; }
