"use client";

import { useEffect, useState } from 'react';
import { Car, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { authenticatedJson } from '@/lib/payroll/client';
import {
  DEFAULT_DRIVER_VEHICLE_NAME,
  DEFAULT_FUEL_PROCUREMENT_MODE,
  DRIVER_VEHICLE_NAMES,
  DRIVER_VEHICLE_RATES,
  fuelProcurementModeLabel,
  isDriverVehicleName,
  isFuelProcurementMode,
  type DriverVehicleName,
  type FuelProcurementMode,
} from '@/lib/payroll/driverJourney';
import type { DriverVehicleChange } from '@/lib/payroll/driverPiket';
import type { VehicleFuelBalanceItem } from './activityModel';
import { fmtRp } from './activityShared';

export interface ChangeJourneyVehicleResult {
  vehicleName: DriverVehicleName;
  vehicleRate: number;
  fuelProcurementMode: FuelProcurementMode;
  driverVehicleChanges: DriverVehicleChange[];
  fuelBalance: VehicleFuelBalanceItem | null;
  changed: boolean;
}

interface ChangeJourneyVehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journeyId: string;
  currentVehicle: DriverVehicleName;
  currentFuelMode: FuelProcurementMode;
  fuelModeSelectionRequired: boolean;
  onChanged: (result: ChangeJourneyVehicleResult) => void;
}

function vehicleOptionLabel(vehicleName: DriverVehicleName): string {
  return vehicleName === DEFAULT_DRIVER_VEHICLE_NAME
    ? 'Ndalem — tanpa BBM'
    : `${vehicleName} — Rp${DRIVER_VEHICLE_RATES[vehicleName].toLocaleString('id-ID')}/km`;
}

/**
 * Lets a sopir correct the vehicle on their own self-authorized journey before
 * reporting it. Mirrors the vehicle/fuel-mode fields of the authorization
 * dialog; the server (`change_vehicle`) decides whether the switch is allowed.
 */
export function ChangeJourneyVehicleDialog({
  open,
  onOpenChange,
  journeyId,
  currentVehicle,
  currentFuelMode,
  fuelModeSelectionRequired,
  onChanged,
}: ChangeJourneyVehicleDialogProps) {
  const [vehicle, setVehicle] = useState<DriverVehicleName>(currentVehicle);
  const [fuelMode, setFuelMode] = useState<FuelProcurementMode>(currentFuelMode);
  const [balances, setBalances] = useState<VehicleFuelBalanceItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // The parent mounts this dialog only while it is open, so the form state
  // above starts fresh from the journey each time.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    authenticatedJson<{ balances?: VehicleFuelBalanceItem[] }>('/api/driver-journeys/vehicle-fuel-balances')
      .then((result) => {
        if (!cancelled && result?.balances) setBalances(result.balances);
      })
      .catch((err) => console.error('Error loading vehicle fuel balances:', err));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toNdalem = vehicle === DEFAULT_DRIVER_VEHICLE_NAME;
  // The mode is chosen once, like at authorization: from Ndalem (which had no
  // mode to keep) or while it is still unchosen. Car to car keeps it.
  const modeChoosable =
    !toNdalem &&
    (currentVehicle === DEFAULT_DRIVER_VEHICLE_NAME || fuelModeSelectionRequired);
  const effectiveMode: FuelProcurementMode = toNdalem
    ? DEFAULT_FUEL_PROCUREMENT_MODE
    : modeChoosable
      ? fuelMode
      : currentFuelMode;
  const balance = toNdalem ? null : balances.find((item) => item.vehicleName === vehicle) || null;
  const unchanged = vehicle === currentVehicle;

  const handleVehicleChange = (value: string | null) => {
    if (!isDriverVehicleName(value)) return;
    setVehicle(value);
    setError('');
    if (
      value !== DEFAULT_DRIVER_VEHICLE_NAME &&
      currentVehicle === DEFAULT_DRIVER_VEHICLE_NAME &&
      fuelMode === DEFAULT_FUEL_PROCUREMENT_MODE
    ) {
      setFuelMode('hold_accumulate');
    }
  };

  const handleSave = async () => {
    if (unchanged || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await authenticatedJson<ChangeJourneyVehicleResult>('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({
          action: 'change_vehicle',
          journeyId,
          vehicleName: vehicle,
          fuelProcurementMode: modeChoosable || toNdalem ? effectiveMode : undefined,
        }),
      });
      onChanged(result);
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Kendaraan gagal diganti.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-w-md rounded-3xl p-6 bg-white border border-slate-100 shadow-2xl">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
              <Car className="w-4 h-4 text-blue-600" />
            </div>
            <span>Ganti Kendaraan</span>
          </DialogTitle>
          <DialogDescription className="text-xs font-semibold text-slate-600 leading-relaxed">
            Pilih kendaraan yang benar-benar Anda pakai. Penggantian dicatat dan terlihat oleh Kepala SatKer saat audit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="changeJourneyVehicle" className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Jenis Kendaraan
            </Label>
            <Select value={vehicle} onValueChange={handleVehicleChange}>
              <SelectTrigger id="changeJourneyVehicle" className="w-full text-xs font-extrabold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                <SelectValue>{vehicleOptionLabel(vehicle)}</SelectValue>
              </SelectTrigger>
              <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white text-xs">
                {DRIVER_VEHICLE_NAMES.map((vehicleName) => (
                  <SelectItem key={vehicleName} value={vehicleName}>
                    {vehicleOptionLabel(vehicleName)}
                    {vehicleName === currentVehicle ? ' (saat ini)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {toNdalem ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] font-semibold leading-relaxed text-slate-600">
              Ndalem tidak memakai saldo BBM kendaraan, sehingga mode BBM menjadi Standard langsung.
            </p>
          ) : (
            <div className="rounded-xl border border-blue-200/80 bg-blue-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="changeJourneyFuelMode" className="text-xs font-bold text-blue-900 uppercase tracking-wider">
                  Mode Pengadaan BBM
                </Label>
                {balance && (
                  <span className="text-right text-[10px] font-bold text-slate-600">
                    Tersedia <strong className="text-emerald-700">{fmtRp(Number(balance.availableBalance || 0))}</strong>
                    {' · '}Akumulasi <strong className="text-blue-700">{fmtRp(Number(balance.accumulatedHoldAmount || 0))}</strong>
                  </span>
                )}
              </div>
              {modeChoosable ? (
                <Select
                  value={fuelMode}
                  onValueChange={(value) => {
                    if (isFuelProcurementMode(value)) setFuelMode(value);
                  }}
                >
                  <SelectTrigger id="changeJourneyFuelMode" className="w-full text-xs font-bold text-slate-700 bg-white rounded-xl border border-blue-200 h-10 px-3">
                    <SelectValue>{fuelProcurementModeLabel(fuelMode)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white text-xs">
                    <SelectItem value="hold_accumulate">Tahan & akumulasi</SelectItem>
                    <SelectItem value="procure_release">Cairkan saldo</SelectItem>
                    <SelectItem value="standard_direct">Standard langsung</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs font-extrabold text-slate-800">
                  {fuelProcurementModeLabel(effectiveMode)}{' '}
                  <span className="font-semibold text-slate-500">(tetap, sudah dipilih saat otorisasi)</span>
                </p>
              )}
              <p className="text-[10px] leading-relaxed text-blue-800 font-semibold">
                Jatah BBM dihitung saat laporan dikirim, dari jarak rute × tarif {vehicle}.{' '}
                {effectiveMode === 'hold_accumulate'
                  ? 'Jatah itu mengurangi Tersedia, lalu menjadi Akumulasi setelah audit disetujui. Kuitansi BBM tidak diperlukan.'
                  : effectiveMode === 'procure_release'
                    ? `Akumulasi ${fmtRp(Number(balance?.accumulatedHoldAmount || 0))} digabung dengan jatah perjalanan. Nominal pembelian aktual dan kuitansi wajib.`
                    : 'Settlement BBM mengikuti alur standard (unggah struk BBM).'}
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] font-bold text-rose-800">{error}</p>
          )}
        </div>

        <DialogFooter className="pt-3 border-t border-slate-100 gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="rounded-xl font-bold text-slate-500 text-xs px-4 cursor-pointer hover:bg-slate-100"
          >
            Batal
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={unchanged || saving}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-6 h-10 gap-2 cursor-pointer disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Simpan Kendaraan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
