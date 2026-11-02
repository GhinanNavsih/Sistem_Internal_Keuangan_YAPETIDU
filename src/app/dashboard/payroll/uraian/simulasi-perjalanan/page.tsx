"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, FileDown, Loader2, Plus, RefreshCw, Route } from 'lucide-react';
import { JourneySection } from '@/components/driver-simulation/JourneySection';
import {
  applyQuote,
  emptyForm,
  emptyJourney,
  formFromView,
  previewJourney,
  ROUTE_NOT_MEASURED,
  sameSimulationInput,
  toSimulationInput,
  type JourneyForm,
  type SimulationDraft,
  type SimulationForm,
} from '@/components/driver-simulation/simulationForm';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { FloatingSnackbar, type SnackbarMessage } from '@/components/ui/floating-snackbar';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/AuthContext';
import {
  formatRupiah,
  MAX_SIMULATION_EVENT_NAME_LENGTH,
  MAX_SIMULATION_JOURNEYS,
  type RouteQuote,
  type SimulationView,
} from '@/lib/driverJourneySimulation';
import type { DriverJourneyLocation } from '@/lib/payroll/driverJourney';
import { authenticatedJson } from '@/lib/payroll/client';
import { canSimulateDriverJourneys } from '@/lib/payroll/roles';

function formatCalculatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

function hasDraftContent(form: SimulationForm): boolean {
  if (form.eventName.trim() !== '') return true;
  return form.journeys.some(
    (j) => j.stops.length > 0 || j.vehicleName !== '' || j.tollInput !== '' || j.parkingInput !== '' || j.withoutDriver,
  );
}

type Editor = {
  /** The saved Simulasi being edited; null for a new one. */
  saved: SimulationView | null;
  form: SimulationForm;
};

export default function SimulasiPerjalananPage() {
  const { profile: realProfile, activeProfile } = useAuth();
  const profile = activeProfile || realProfile;
  const allowed = canSimulateDriverJourneys(profile?.role);

  const [simulations, setSimulations] = useState<SimulationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [quoting, setQuoting] = useState<Record<string, boolean>>({});
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<SnackbarMessage | null>(null);
  // Latest route request per Perjalanan, so a slower earlier answer never
  // overwrites the route that is on screen now.
  const quoteRequests = useRef<Record<string, number>>({});
  const draftCheckedRef = useRef(false);
  const saveDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraftHashRef = useRef<string>('');

  const loadSimulations = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [simResult, draftResult] = await Promise.all([
        authenticatedJson<{ simulations: SimulationView[] }>('/api/driver-journey-simulations'),
        !draftCheckedRef.current
          ? authenticatedJson<{ draft: SimulationDraft | null }>('/api/driver-journey-simulations/draft').catch(() => ({ draft: null }))
          : Promise.resolve({ draft: null }),
      ]);
      setSimulations(simResult.simulations);

      if (!draftCheckedRef.current) {
        draftCheckedRef.current = true;
        const localKey = profile?.uid ? `simulasi_perjalanan_draft_${profile.uid}` : null;
        let localDraft: SimulationDraft | null = null;
        if (localKey && typeof window !== 'undefined') {
          try {
            const raw = window.localStorage.getItem(localKey);
            if (raw) localDraft = JSON.parse(raw);
          } catch {}
        }

        const candidate = (localDraft && (!draftResult.draft || (localDraft.updatedAt && localDraft.updatedAt > (draftResult.draft.updatedAt || ''))))
          ? localDraft
          : draftResult.draft;

        if (candidate && candidate.form && Array.isArray(candidate.form.journeys) && candidate.form.journeys.length > 0) {
          if (hasDraftContent(candidate.form)) {
            const matchingSaved = candidate.savedId
              ? simResult.simulations.find((s) => s.id === candidate.savedId) ?? null
              : null;
            setEditor({ saved: matchingSaved, form: candidate.form });
            setDraftStatus('saved');
            lastSavedDraftHashRef.current = JSON.stringify(candidate.form) + String(candidate.savedId);
            setMessage({ type: 'success', text: 'Draf simulasi otomatis dipulihkan.' });
          }
        }
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Simulasi gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, [profile?.uid]);

  useEffect(() => {
    if (allowed) void loadSimulations();
  }, [allowed, loadSimulations]);

  const previews = useMemo(
    () => editor?.form.journeys.map((journey) => previewJourney(journey)) ?? [],
    [editor],
  );
  const dirty = useMemo(() => {
    if (!editor) return false;
    return editor.saved ? !sameSimulationInput(editor.form, formFromView(editor.saved)) : true;
  }, [editor]);
  const grandTotal = previews.every((preview) => preview.state === 'ready')
    ? previews.reduce((sum, preview) => sum + (preview.state === 'ready' ? preview.result.total : 0), 0)
    : null;
  const saveBlocker = !editor
    ? null
    : !editor.form.eventName.trim()
      ? 'Isi nama kegiatan'
      : previews.some((preview) => preview.state === 'blocked' && preview.reason === ROUTE_NOT_MEASURED)
        ? 'Rute belum diukur'
        : previews.some((preview) => preview.state === 'blocked')
          ? 'Lengkapi setiap perjalanan'
          : null;

  const clearDraft = useCallback(async () => {
    if (profile?.uid && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(`simulasi_perjalanan_draft_${profile.uid}`);
      } catch {}
    }
    lastSavedDraftHashRef.current = '';
    setDraftStatus('idle');
    try {
      await authenticatedJson('/api/driver-journey-simulations/draft', { method: 'DELETE' });
    } catch {}
  }, [profile?.uid]);

  // Auto-save draft to server and localStorage on edit
  useEffect(() => {
    if (!editor) {
      setDraftStatus('idle');
      return;
    }

    const shouldDraft = editor.saved ? dirty : hasDraftContent(editor.form);
    if (!shouldDraft) {
      setDraftStatus('idle');
      return;
    }

    const draftData = {
      savedId: editor.saved ? editor.saved.id : null,
      form: editor.form,
      updatedAt: new Date().toISOString(),
    };

    // Instant local backup
    if (profile?.uid && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(`simulasi_perjalanan_draft_${profile.uid}`, JSON.stringify(draftData));
      } catch {}
    }

    const currentHash = JSON.stringify(editor.form) + String(draftData.savedId);
    if (currentHash === lastSavedDraftHashRef.current) return;

    setDraftStatus('saving');
    if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
    saveDraftTimerRef.current = setTimeout(async () => {
      try {
        await authenticatedJson('/api/driver-journey-simulations/draft', {
          method: 'PUT',
          body: JSON.stringify(draftData),
        });
        lastSavedDraftHashRef.current = currentHash;
        setDraftStatus('saved');
      } catch (err) {
        console.warn('Gagal menyimpan draf ke server:', err);
        setDraftStatus('idle');
      }
    }, 1000);

    return () => {
      if (saveDraftTimerRef.current) clearTimeout(saveDraftTimerRef.current);
    };
  }, [editor, dirty, profile?.uid]);

  const updateForm = (update: (form: SimulationForm) => SimulationForm) =>
    setEditor((current) => (current ? { ...current, form: update(current.form) } : current));

  const updateJourney = (key: string, update: (journey: JourneyForm) => JourneyForm) =>
    updateForm((form) => ({
      ...form,
      journeys: form.journeys.map((journey) => (journey.key === key ? update(journey) : journey)),
    }));

  const openNew = () => {
    setEditor({ saved: null, form: emptyForm() });
    setQuoteErrors({});
    lastSavedDraftHashRef.current = '';
    setDraftStatus('idle');
  };

  const openSaved = (simulation: SimulationView) => {
    setEditor({ saved: simulation, form: formFromView(simulation) });
    setQuoteErrors({});
    lastSavedDraftHashRef.current = '';
    setDraftStatus('idle');
  };

  const closeEditor = (force = false) => {
    if (!force && dirty && editor && (editor.saved || hasDraftContent(editor.form))) {
      setConfirm('discard');
      return;
    }
    if (force) {
      void clearDraft();
    }
    setConfirm(null);
    setEditor(null);
  };

  /** Measures a Perjalanan's loop from UNIPDU through its stops and back. */
  const measureRoute = async (
    key: string,
    stops: string[],
    stopLocations: Array<DriverJourneyLocation | null>,
  ) => {
    const requestId = (quoteRequests.current[key] ?? 0) + 1;
    quoteRequests.current[key] = requestId;
    setQuoteErrors((current) => ({ ...current, [key]: '' }));
    if (stops.length === 0) {
      setQuoting((current) => ({ ...current, [key]: false }));
      return;
    }
    setQuoting((current) => ({ ...current, [key]: true }));
    try {
      const { quote } = await authenticatedJson<{ quote: RouteQuote }>('/api/driver-journey-simulations/quote', {
        method: 'POST',
        body: JSON.stringify({ stops, stopLocations }),
      });
      if (quoteRequests.current[key] !== requestId) return;
      updateJourney(key, (current) => applyQuote(current, quote));
    } catch (error) {
      if (quoteRequests.current[key] !== requestId) return;
      setQuoteErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : 'Rute gagal diukur.',
      }));
    } finally {
      if (quoteRequests.current[key] === requestId) {
        setQuoting((current) => ({ ...current, [key]: false }));
      }
    }
  };

  // Every change to the stops measures the route again, as the sopir report does.
  const changeStops = (
    key: string,
    stops: string[],
    stopLocations: Array<DriverJourneyLocation | null>,
  ) => {
    updateJourney(key, (current) => ({ ...current, stops, stopLocations }));
    void measureRoute(key, stops, stopLocations);
  };

  const persist = async (mode: 'save' | 'recalculate') => {
    if (!editor) return;
    const setBusy = mode === 'save' ? setSaving : setRecalculating;
    setBusy(true);
    try {
      const input = toSimulationInput(editor.form);
      const { simulation } = editor.saved
        ? await authenticatedJson<{ simulation: SimulationView }>(
            `/api/driver-journey-simulations/${editor.saved.id}`,
            { method: 'PUT', body: JSON.stringify(input) },
          )
        : await authenticatedJson<{ simulation: SimulationView }>('/api/driver-journey-simulations', {
            method: 'POST',
            body: JSON.stringify(input),
          });
      setEditor({ saved: simulation, form: formFromView(simulation) });
      setSimulations((current) => [simulation, ...current.filter((item) => item.id !== simulation.id)]);
      if (mode === 'save') {
        void clearDraft();
      }
      setMessage({
        type: 'success',
        text: mode === 'save' ? 'Simulasi disimpan.' : 'Simulasi dihitung ulang dengan tarif hari ini.',
      });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Simulasi gagal disimpan.' });
    } finally {
      setBusy(false);
    }
  };

  const deleteSaved = async () => {
    if (!editor?.saved) return;
    setDeleting(true);
    try {
      await authenticatedJson(`/api/driver-journey-simulations/${editor.saved.id}`, { method: 'DELETE' });
      const id = editor.saved.id;
      setSimulations((current) => current.filter((item) => item.id !== id));
      void clearDraft();
      setConfirm(null);
      setEditor(null);
      setMessage({ type: 'success', text: 'Simulasi dihapus.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Simulasi gagal dihapus.' });
    } finally {
      setDeleting(false);
    }
  };

  const printPdf = async () => {
    if (!editor?.saved) return;
    const { generateSimulasiBiayaPerjalananPdf } = await import('@/utils/generateSimulasiBiayaPerjalananPdf');
    generateSimulasiBiayaPerjalananPdf(editor.saved);
  };

  if (!allowed) {
    return (
      <div className="mx-auto mt-16 max-w-md px-4 text-center text-sm text-slate-500">
        Simulasi Biaya Perjalanan hanya tersedia untuk Kepala SatKer Loyalis dan Super Admin.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800">
      <div className="w-full px-4 py-5 sm:px-6 sm:py-6">
        {!editor ? (
          <>
            <div className="mb-5 flex items-center justify-between gap-3">
              <h1 className="text-lg font-semibold text-slate-900">Simulasi Biaya Perjalanan</h1>
              <Button type="button" variant="accent" onClick={openNew}>
                <Plus />
                Simulasi baru
              </Button>
            </div>

            {loadError ? (
              <Callout tone="error" action={(
                <Button type="button" variant="outline" size="sm" onClick={() => void loadSimulations()}>
                  Coba lagi
                </Button>
              )}>
                {loadError}
              </Callout>
            ) : loading ? (
              <p className="flex items-center gap-2 py-10 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" /> Memuat simulasi…
              </p>
            ) : simulations.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-slate-500">
                <Route className="size-6 text-slate-300" />
                Belum ada simulasi.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 border-y border-slate-200">
                {simulations.map((simulation) => (
                  <li key={simulation.id}>
                    <button
                      type="button"
                      onClick={() => openSaved(simulation)}
                      className="flex w-full cursor-pointer items-center justify-between gap-4 px-1 py-3 text-left hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">{simulation.eventName}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {simulation.journeys.length} perjalanan · dihitung {formatCalculatedAt(simulation.calculatedAt)}
                          {!simulation.isOwner && simulation.ownerName ? ` · ${simulation.ownerName}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-slate-900">
                        {formatRupiah(simulation.grandTotal)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="mb-5 flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Kembali ke daftar simulasi"
                title="Kembali"
                onClick={() => closeEditor()}
              >
                <ChevronLeft />
              </Button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-lg font-semibold text-slate-900">
                    {editor.saved ? editor.saved.eventName : (editor.form.eventName || 'Simulasi baru')}
                  </h1>
                  {(dirty || !editor.saved) && hasDraftContent(editor.form) && (
                    <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {draftStatus === 'saving' ? 'Menyimpan draf…' : 'Draf tersimpan di server'}
                    </span>
                  )}
                </div>
                {editor.saved && (
                  <p className="text-xs text-slate-500">
                    Dihitung pada {formatCalculatedAt(editor.saved.calculatedAt)} WIB
                    {!editor.saved.isOwner && editor.saved.ownerName ? ` · dibuat oleh ${editor.saved.ownerName}` : ''}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-6">
              {editor.form.journeys.map((journey, index) => (
                <JourneySection
                  key={journey.key}
                  eventNameField={index === 0 ? (
                    <Field label="Nama Kegiatan" htmlFor="simulation-event" required>
                      <Input
                        id="simulation-event"
                        value={editor.form.eventName}
                        maxLength={MAX_SIMULATION_EVENT_NAME_LENGTH}
                        placeholder="Contoh: Seminar Nasional Kewirausahaan"
                        onChange={(event) => {
                          const value = event.target.value;
                          updateForm((form) => ({ ...form, eventName: value }));
                        }}
                        className="h-9 rounded-sm"
                      />
                    </Field>
                  ) : undefined}
                  journey={journey}
                  index={index}
                  canRemove={editor.form.journeys.length > 1}
                  preview={previews[index]}
                  quoting={Boolean(quoting[journey.key])}
                  quoteError={quoteErrors[journey.key] || ''}
                  onChange={(update) => updateJourney(journey.key, update)}
                  onStopsChange={(stops, stopLocations) => changeStops(journey.key, stops, stopLocations)}
                  onRetryQuote={() => void measureRoute(journey.key, journey.stops, journey.stopLocations)}
                  onRemove={() => updateForm((form) => ({
                    ...form,
                    journeys: form.journeys.filter((item) => item.key !== journey.key),
                  }))}
                />
              ))}
            </div>

            <div className="mt-6 grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
              <div>
                {editor.form.journeys.length < MAX_SIMULATION_JOURNEYS && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-blue-700"
                    onClick={() => updateForm((form) => ({
                      ...form,
                      journeys: [...form.journeys, emptyJourney(form.journeys[form.journeys.length - 1])],
                    }))}
                  >
                    <Plus />
                    Tambah perjalanan
                  </Button>
                )}
              </div>

              <div className="border-t border-slate-200 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">Total biaya transportasi</p>
                    <p className="text-base font-semibold tabular-nums text-slate-900">
                      {grandTotal === null ? 'Belum lengkap' : formatRupiah(grandTotal)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {editor.saved && (
                      <Button type="button" variant="danger-ghost" onClick={() => setConfirm('delete')}>
                        Hapus
                      </Button>
                    )}
                    {editor.saved && !dirty && (
                      <>
                        <Button type="button" variant="outline" onClick={() => void persist('recalculate')} disabled={recalculating}>
                          {recalculating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                          Hitung ulang
                        </Button>
                        <Button type="button" variant="outline" onClick={() => void printPdf()}>
                          <FileDown />
                          Cetak PDF
                        </Button>
                      </>
                    )}
                    {(dirty || !editor.saved) && (
                      <Button
                        type="button"
                        variant="accent"
                        onClick={() => void persist('save')}
                        disabled={saving || Boolean(saveBlocker)}
                      >
                        {saving ? <Loader2 className="animate-spin" /> : null}
                        {saveBlocker || 'Simpan'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => setConfirm(open ? 'delete' : null)}
        title="Hapus simulasi?"
        description="Simulasi ini dan seluruh perjalanannya dihapus dari daftar. Tidak ada perjalanan sungguhan yang terpengaruh."
        confirmLabel="Hapus simulasi"
        destructive
        loading={deleting}
        onConfirm={() => void deleteSaved()}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        onOpenChange={(open) => setConfirm(open ? 'discard' : null)}
        title="Tinggalkan tanpa menyimpan?"
        description="Perubahan yang belum disimpan akan hilang."
        confirmLabel="Tinggalkan"
        cancelLabel="Lanjut mengisi"
        onConfirm={() => closeEditor(true)}
      />
      <FloatingSnackbar message={message} onDismiss={() => setMessage(null)} />
    </div>
  );
}
