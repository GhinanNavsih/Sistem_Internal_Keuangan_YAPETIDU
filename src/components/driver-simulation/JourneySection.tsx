"use client";

import { useState } from 'react';
import { ChevronDown, Loader2, Plus, Route, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OptionSelect } from '@/components/ui/option-select';
import {
  formatHours,
  formatKm,
  formatRupiah,
  MAX_SIMULATION_STOPS,
  MAX_SIMULATION_STOP_LENGTH,
  SIMULATION_VEHICLES,
  tollLineLabel,
  upahBersihLines,
} from '@/lib/driverJourneySimulation';
import { DRIVER_VEHICLE_RATES, type DriverVehicleName } from '@/lib/payroll/driverJourney';
import { cn } from '@/lib/utils';
import { hasFreshQuote, type JourneyForm, type JourneyPreview } from './simulationForm';

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
  journey: JourneyForm;
  index: number;
  canRemove: boolean;
  preview: JourneyPreview;
  quoting: boolean;
  quoteError: string;
  onChange: (update: (journey: JourneyForm) => JourneyForm) => void;
  onRemove: () => void;
  onQuote: () => void;
}

export function JourneySection({
  journey,
  index,
  canRemove,
  preview,
  quoting,
  quoteError,
  onChange,
  onRemove,
  onQuote,
}: JourneySectionProps) {
  const [showLegs, setShowLegs] = useState(false);
  const fresh = hasFreshQuote(journey);
  const idPrefix = `journey-${journey.key}`;
  const filledStops = journey.stops.filter((stop) => stop.trim()).length;
  const toll = journey.quote?.toll;
  const tollMissing = fresh && journey.tollSource === 'manual' && journey.tollInput === '';

  const setStop = (stopIndex: number, value: string) =>
    onChange((current) => ({
      ...current,
      stops: current.stops.map((stop, position) => (position === stopIndex ? value : stop)),
    }));

  return (
    <section aria-labelledby={`${idPrefix}-title`} className="space-y-4 border-t border-slate-200 pt-5">
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

      <Field label="Tujuan" required hint="Berangkat dari dan kembali ke UNIPDU Jombang. Urutkan sesuai rute.">
        <ol className="space-y-2">
          {journey.stops.map((stop, stopIndex) => (
            <li key={stopIndex} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">{stopIndex + 1}</span>
              <Input
                aria-label={`Tujuan ${stopIndex + 1}`}
                value={stop}
                maxLength={MAX_SIMULATION_STOP_LENGTH}
                placeholder={stopIndex === 0 ? 'Contoh: Universitas Airlangga Kampus C, Surabaya' : 'Tujuan berikutnya'}
                onChange={(event) => setStop(stopIndex, event.target.value)}
                className="h-9 rounded-sm"
              />
              {journey.stops.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Hapus tujuan ${stopIndex + 1}`}
                  title="Hapus tujuan"
                  onClick={() => onChange((current) => ({
                    ...current,
                    stops: current.stops.filter((_, position) => position !== stopIndex),
                  }))}
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ol>
        {journey.stops.length < MAX_SIMULATION_STOPS && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 text-blue-700"
            onClick={() => onChange((current) => ({ ...current, stops: [...current.stops, ''] }))}
          >
            <Plus />
            Tambah tujuan
          </Button>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Kendaraan" htmlFor={`${idPrefix}-vehicle`} required>
          <OptionSelect
            id={`${idPrefix}-vehicle`}
            value={journey.vehicleName}
            placeholder="Pilih kendaraan"
            options={VEHICLE_OPTIONS}
            onValueChange={(value) => onChange((current) => ({ ...current, vehicleName: value as DriverVehicleName }))}
          />
        </Field>
        <Field label="Berangkat" htmlFor={`${idPrefix}-departure-date`} required>
          <div className="grid grid-cols-[1fr_auto] gap-2">
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
          <div className="grid grid-cols-[1fr_auto] gap-2">
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

      {!fresh && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onQuote}
            disabled={quoting || filledStops === 0}
          >
            {quoting ? <Loader2 className="animate-spin" /> : <Route />}
            {journey.quote ? 'Hitung ulang rute' : 'Hitung rute'}
          </Button>
          {journey.quote && (
            <span className="text-xs text-amber-700">Tujuan berubah sejak rute dihitung.</span>
          )}
        </div>
      )}
      {quoteError && <Callout tone="error">{quoteError}</Callout>}

      {fresh && journey.quote && (
        <div className="space-y-4">
          <div className="text-sm text-slate-600">
            <span className="tabular-nums">{formatKm(journey.quote.measurement.distanceKm)}</span>
            {' · '}durasi tempuh <span className="tabular-nums">{formatHours(journey.quote.measurement.durationHours)}</span>
            {journey.quote.measurement.legs.length > 0 && (
              <button
                type="button"
                className="ml-2 inline-flex cursor-pointer items-center gap-0.5 text-blue-700 hover:underline"
                aria-expanded={showLegs}
                onClick={() => setShowLegs((value) => !value)}
              >
                Lihat rute
                <ChevronDown className={cn('size-3.5 transition-transform', showLegs && 'rotate-180')} />
              </button>
            )}
          </div>
          {showLegs && (
            <ol className="space-y-1 border-l border-slate-200 pl-3 text-xs text-slate-600">
              {journey.quote.measurement.legs.map((leg, legIndex) => (
                <li key={legIndex} className="flex justify-between gap-3">
                  <span className="min-w-0">{leg.start} → {leg.end}</span>
                  <span className="shrink-0 tabular-nums">{formatKm(leg.distanceKm)}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
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
    </section>
  );
}
