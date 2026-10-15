"use client";

import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Loader2, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';
import {
  formatHours,
  formatKm,
  formatRupiah,
  MAX_SIMULATION_STOPS,
  SIMULATION_START_LABEL,
  SIMULATION_VEHICLES,
  tollLineLabel,
  upahBersihLines,
} from '@/lib/driverJourneySimulation';
import {
  DRIVER_VEHICLE_RATES,
  type DriverJourneyLocation,
  type DriverVehicleName,
} from '@/lib/payroll/driverJourney';
import type { RouteLeg } from '@/lib/driverJourneySimulation';
import { LocationPickerDialog } from './LocationPickerDialog';
import { hasFreshQuote, type JourneyForm, type JourneyPreview } from './simulationForm';

const START_LABEL = SIMULATION_START_LABEL.split(',')[0];

/** The leg that arrives at a stop, as the sopir report shows it under each stop. */
function LegLine({ leg }: { leg: RouteLeg | undefined }) {
  if (!leg) return null;
  return (
    <div className="text-[13px] tabular-nums text-slate-500">
      {formatKm(leg.distanceKm)} · {formatHours(leg.durationHours)}
    </div>
  );
}

const VEHICLE_OPTIONS = SIMULATION_VEHICLES.map((name) => ({
  value: name,
  label: `${name} · ${formatRupiah(DRIVER_VEHICLE_RATES[name])}/km`,
}));

/** A rupiah amount typed as digits; empty stays empty, so "not filled in" differs from Rp0. */
function RupiahTextInput({
  id,
  value,
  onDigits,
  invalid,
}: {
  id: string;
  value: string;
  onDigits: (digits: string) => void;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">Rp</span>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="0"
        aria-invalid={invalid || undefined}
        value={value === '' ? '' : Number(value).toLocaleString('id-ID')}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 9);
          onDigits(next);
        }}
        className="h-9 rounded-sm pl-10 tabular-nums"
      />
    </div>
  );
}

function tollHint(journey: JourneyForm): string | null {
  const toll = journey.quote?.toll;
  if (!toll) return null;
  if (journey.tollSource === 'manual') {
    if (toll.status === 'priced') return `Diubah manual. Tarif Google ${formatRupiah(toll.amount ?? 0)}.`;
    if (toll.status === 'none') return 'Diubah manual. Google tidak menemukan tol di rute ini.';
    if (toll.status === 'unknown_price') return 'Rute melewati tol yang tarifnya tidak diketahui Google.';
    return 'Tarif tol dari Google tidak tersedia saat ini.';
  }
  if (toll.status === 'priced') return 'Tarif Google untuk kartu e-toll.';
  if (toll.status === 'none') return 'Google tidak menemukan tol di rute ini.';
  return null;
}

interface JourneySectionProps {
  eventNameField?: ReactNode;
  journey: JourneyForm;
  index: number;
  canRemove: boolean;
  preview: JourneyPreview;
  quoting: boolean;
  quoteError: string;
  onChange: (update: (journey: JourneyForm) => JourneyForm) => void;
  /** A new stop list; the page measures the route again. */
  onStopsChange: (stops: string[], stopLocations: Array<DriverJourneyLocation | null>) => void;
  onRetryQuote: () => void;
  onRemove: () => void;
}

export function JourneySection({
  eventNameField,
  journey,
  index,
  canRemove,
  preview,
  quoting,
  quoteError,
  onChange,
  onStopsChange,
  onRetryQuote,
  onRemove,
}: JourneySectionProps) {
  // The stop the map picker is open for: an index, or 'new' for "Tambah lokasi".
  const [picker, setPicker] = useState<number | 'new' | null>(null);
  const fresh = hasFreshQuote(journey);
  const idPrefix = `journey-${journey.key}`;
  const toll = journey.quote?.toll;
  const tollMissing = fresh && journey.tollSource === 'manual' && journey.tollInput === '';
  const legs = fresh ? journey.quote?.measurement.legs ?? [] : [];
  const atStopLimit = journey.stops.length >= MAX_SIMULATION_STOPS;

  const confirmPicked = (address: string, location: DriverJourneyLocation) => {
    if (picker === 'new') {
      onStopsChange([...journey.stops, address], [...journey.stopLocations, location]);
    } else if (picker !== null) {
      onStopsChange(
        journey.stops.map((stop, index) => (index === picker ? address : stop)),
        journey.stops.map((_, index) => (index === picker ? location : journey.stopLocations[index] ?? null)),
      );
    }
    setPicker(null);
  };

  // Reordering is how the route follows the order the stops are driven.
  const moveStop = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= journey.stops.length) return;
    const stops = [...journey.stops];
    const locations = journey.stops.map((_, position) => journey.stopLocations[position] ?? null);
    [stops[index], stops[target]] = [stops[target], stops[index]];
    [locations[index], locations[target]] = [locations[target], locations[index]];
    onStopsChange(stops, locations);
  };

  const removeStop = (index: number) => {
    onStopsChange(
      journey.stops.filter((_, position) => position !== index),
      journey.stops
        .map((_, position) => journey.stopLocations[position] ?? null)
        .filter((_, position) => position !== index),
    );
  };

  return (
    <section
      aria-labelledby={`${idPrefix}-title`}
      className={`grid items-start gap-6 lg:grid-cols-2 lg:gap-8 ${index > 0 ? 'border-t border-slate-200 pt-6' : ''}`}
    >
      <div className="min-w-0 space-y-6">
        {eventNameField}
        <div className={eventNameField ? 'space-y-4 border-t border-slate-200 pt-5' : 'space-y-4'}>
          <div className="flex items-center justify-between gap-3">
            <h2 id={`${idPrefix}-title`} className="text-sm font-semibold text-slate-900">
              Perjalanan {index + 1}
            </h2>
            {canRemove && (
              <Button type="button" variant="danger-ghost" size="sm" onClick={onRemove}>
                <Trash2 />
                Hapus perjalanan
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-900">
                Rute
                <span aria-hidden className="text-red-600">*</span>
              </h3>
              {/* With no stop yet, the same button sits in the route itself. */}
              {journey.stops.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={atStopLimit}
                  title={atStopLimit ? `Maksimal ${MAX_SIMULATION_STOPS} titik tujuan` : undefined}
                  onClick={() => setPicker('new')}
                >
                  <Plus />
                  Tambah lokasi
                </Button>
              )}
            </div>

            <ol className="relative ml-1.5 space-y-5 border-l border-dashed border-slate-300 pl-5">
              <li className="relative">
                <span aria-hidden className="absolute -left-[26px] top-1.5 size-2.5 rounded-full bg-blue-600" />
                <div className="text-xs text-slate-500">Berangkat</div>
                <div className="truncate text-sm font-medium text-slate-900" title={SIMULATION_START_LABEL}>
                  {START_LABEL}
                </div>
              </li>

              {journey.stops.length === 0 ? (
                <li className="relative">
                  <span aria-hidden className="absolute -left-[26px] top-1.5 size-2.5 rounded-full border-2 border-slate-300 bg-white" />
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={() => setPicker('new')}
                    className="h-10 w-full border-dashed text-blue-600"
                  >
                    <Plus />
                    Tambah lokasi
                  </Button>
                </li>
              ) : (
                journey.stops.map((stop, index) => (
                  <li key={`${index}-${stop}`} className="relative flex items-start justify-between gap-2">
                    <span aria-hidden className="absolute -left-[26px] top-1.5 size-2.5 rounded-full bg-blue-600" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-slate-500">Tujuan {index + 1}</div>
                      <div className="truncate text-sm font-medium text-slate-900" title={stop}>
                        {stop.split(',')[0]}
                      </div>
                      <LegLine leg={legs[index]} />
                    </div>
                    <div className="flex shrink-0 items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={index === 0 || quoting}
                        onClick={() => moveStop(index, -1)}
                        aria-label={`Naikkan tujuan ${index + 1}`}
                        title="Naikkan urutan"
                        className="text-slate-500"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={index === journey.stops.length - 1 || quoting}
                        onClick={() => moveStop(index, 1)}
                        aria-label={`Turunkan tujuan ${index + 1}`}
                        title="Turunkan urutan"
                        className="text-slate-500"
                      >
                        <ArrowDown />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Aksi lain untuk tujuan ${index + 1}`}
                              title="Aksi lain"
                              className="text-slate-500"
                            />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem className="text-sm font-medium" onClick={() => setPicker(index)}>
                            Ubah lokasi
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-sm font-medium text-red-600 data-highlighted:bg-red-50"
                            onClick={() => removeStop(index)}
                          >
                            Hapus tujuan
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                ))
              )}

              <li className="relative">
                <span aria-hidden className="absolute -left-[26px] top-1.5 size-2.5 rounded-full bg-blue-600" />
                <div className="text-xs text-slate-500">Pulang</div>
                <div className="truncate text-sm font-medium text-slate-900" title={SIMULATION_START_LABEL}>
                  {START_LABEL}
                </div>
                {journey.stops.length > 0 ? (
                  <LegLine leg={legs[journey.stops.length]} />
                ) : (
                  <div className="text-[13px] text-slate-500">Kembali ke titik awal; dihitung setelah tujuan ditentukan.</div>
                )}
              </li>
            </ol>

            {quoting ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" /> Mengukur rute…
              </p>
            ) : quoteError ? (
              <Callout
                tone="error"
                action={(
                  <Button type="button" variant="outline" size="sm" onClick={onRetryQuote}>
                    Coba lagi
                  </Button>
                )}
              >
                {quoteError}
              </Callout>
            ) : fresh && journey.quote ? (
              <p className="text-sm text-slate-600">
                <span className="tabular-nums">{formatKm(journey.quote.measurement.distanceKm)}</span>
                {' · '}durasi tempuh <span className="tabular-nums">{formatHours(journey.quote.measurement.durationHours)}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="@container min-w-0 space-y-4">
        <div className="grid gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">
          <Field label="Kendaraan" htmlFor={`${idPrefix}-vehicle`} required className="min-w-0 @lg:col-span-2 @3xl:col-span-1">
            <OptionSelect
              id={`${idPrefix}-vehicle`}
              value={journey.vehicleName}
              placeholder="Pilih kendaraan"
              options={VEHICLE_OPTIONS}
              onValueChange={(value) => onChange((current) => ({ ...current, vehicleName: value as DriverVehicleName }))}
            />
          </Field>
          <Field label="Berangkat" htmlFor={`${idPrefix}-departure-date`} required>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                id={`${idPrefix}-departure-date`}
                type="date"
                value={journey.departureDate}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange((current) => ({
                    ...current,
                    departureDate: value,
                    // Keep a same-day journey same-day when its date moves.
                    returnDate: current.returnDate === current.departureDate || current.returnDate < value
                      ? value
                      : current.returnDate,
                  }));
                }}
                className="h-9 rounded-sm"
              />
              <Input
                aria-label="Jam berangkat"
                type="time"
                value={journey.departureTime}
                onChange={(event) => onChange((current) => ({ ...current, departureTime: event.target.value }))}
                className="h-9 w-28 rounded-sm"
              />
            </div>
          </Field>
          <Field label="Kembali" htmlFor={`${idPrefix}-return-date`} required>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                id={`${idPrefix}-return-date`}
                type="date"
                min={journey.departureDate || undefined}
                value={journey.returnDate}
                onChange={(event) => onChange((current) => ({ ...current, returnDate: event.target.value }))}
                className="h-9 rounded-sm"
              />
              <Input
                aria-label="Jam kembali"
                type="time"
                value={journey.returnTime}
                onChange={(event) => onChange((current) => ({ ...current, returnTime: event.target.value }))}
                className="h-9 w-28 rounded-sm"
              />
            </div>
          </Field>
        </div>

        {fresh && journey.quote && (
          <div className="space-y-4">
            <div className="grid gap-4 @sm:grid-cols-2">
              <Field
                label="Tol"
                htmlFor={`${idPrefix}-toll`}
                required={journey.tollSource === 'manual'}
                hint={tollHint(journey)}
                error={tollMissing ? (toll?.status === 'unknown_price'
                  ? 'Rute melewati tol yang tarifnya tidak diketahui Google. Isi biaya tol.'
                  : toll?.status === 'unavailable'
                    ? 'Tarif tol dari Google tidak tersedia. Isi biaya tol (Rp0 bila tanpa tol).'
                    : 'Isi biaya tol.') : undefined}
                action={journey.tollSource === 'manual' && (toll?.status === 'priced' || toll?.status === 'none') ? (
                  <button
                    type="button"
                    className="cursor-pointer text-xs text-blue-700 hover:underline"
                    onClick={() => onChange((current) => ({
                      ...current,
                      tollSource: 'google',
                      tollInput: String(current.quote?.toll.amount ?? 0),
                    }))}
                  >
                    Pakai tarif Google
                  </button>
                ) : undefined}
              >
                <RupiahTextInput
                  id={`${idPrefix}-toll`}
                  value={journey.tollInput}
                  invalid={tollMissing}
                  onDigits={(value) => onChange((current) => ({ ...current, tollSource: 'manual', tollInput: value }))}
                />
              </Field>
              <Field label="Parkir" htmlFor={`${idPrefix}-parking`}>
                <RupiahTextInput
                  id={`${idPrefix}-parking`}
                  value={journey.parkingInput}
                  onDigits={(value) => onChange((current) => ({ ...current, parkingInput: value }))}
                />
              </Field>
            </div>

            {preview.state === 'ready' ? (
              <DetailList className="border-y border-slate-200">
                <DetailRow label={`Biaya BBM (${formatKm(preview.result.route.distanceKm)} × ${formatRupiah(preview.result.vehicleRate)}/km)`}>
                  {formatRupiah(preview.result.fuelCost)}
                </DetailRow>
                <DetailRow label={tollLineLabel(preview.result)}>{formatRupiah(preview.result.tollFee)}</DetailRow>
                <DetailRow label="Parkir">{formatRupiah(preview.result.parkingFee)}</DetailRow>
                <DetailRow label="Upah Bersih sopir">{formatRupiah(preview.result.pay.upahBersih)}</DetailRow>
                {upahBersihLines(preview.result).map((line) => (
                  <DetailRow key={line.label} label={<span className="pl-4 text-xs">{line.label}</span>} className="py-1.5 text-xs text-slate-500">
                    <span className="text-xs text-slate-500">{formatRupiah(line.amount)}</span>
                  </DetailRow>
                ))}
                <DetailRow label={`Total perjalanan ${index + 1}`} emphasis>
                  {formatRupiah(preview.result.total)}
                </DetailRow>
              </DetailList>
            ) : (
              !tollMissing && <Callout tone="warning">{preview.reason}</Callout>
            )}
          </div>
        )}
      </div>

      {picker !== null && (
        <LocationPickerDialog
          initialAddress={picker === 'new' ? '' : journey.stops[picker]}
          initialLocation={picker === 'new' ? null : journey.stopLocations[picker] ?? null}
          onConfirm={confirmPicked}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}
