import type { PhotoEvidence } from '../photoEvidence';
import type { DriverJourneyLocation } from './driverJourney';

export interface DriverJourneyReportDraftState {
  formDate: string;
  formDateEnd: string;
  formIsMultiDay: boolean;
  formTimeStart: string;
  formTimeEnd: string;
  formNightCount: number;
  formNdalemMealMoneyFee: string;
  formFuelFee: string;
  formTollParkingFee: string;
  formFuelReceiptUrls: string[];
  formTollReceiptUrls: string[];
  formFuelReceiptEvidence: PhotoEvidence[];
  formTollReceiptEvidence: PhotoEvidence[];
  startPoint: string;
  startPointLocation: DriverJourneyLocation | null;
  mainDestinations: string[];
  mainDestinationLocations: Array<DriverJourneyLocation | null>;
  extraActivities: unknown[];
  calculatedDistanceKm: number;
  calculatedDurationHours: number;
  outboundDistanceKm: number | null;
  outboundDurationHours: number | null;
  updatedAt?: number;
}

/** Drafts keep successful uploads even when the amount has not been entered yet. */
export function driverJourneyReportDraftPayload(state: DriverJourneyReportDraftState) {
  const money = (value: string) => Number(value.replace(/\D/g, '')) || 0;
  const fuelUrls = state.formFuelReceiptUrls.filter(Boolean);
  const tollUrls = state.formTollReceiptUrls.filter(Boolean);
  return {
    date: state.formDate,
    dateEnd: state.formIsMultiDay ? state.formDateEnd : state.formDate,
    isMultiDay: state.formIsMultiDay,
    timeStart: state.formTimeStart,
    timeEnd: state.formTimeEnd,
    nightCount: state.formIsMultiDay ? state.formNightCount : 0,
    ndalemMealMoneyReceived: money(state.formNdalemMealMoneyFee),
    fuelFee: money(state.formFuelFee),
    tollParkingFee: money(state.formTollParkingFee),
    fuelReceiptUrl: fuelUrls.join(','),
    tollReceiptUrl: tollUrls.join(','),
    fuelReceiptEvidence: fuelUrls.length === state.formFuelReceiptEvidence.length
      ? state.formFuelReceiptEvidence : [],
    tollReceiptEvidence: tollUrls.length === state.formTollReceiptEvidence.length
      ? state.formTollReceiptEvidence : [],
    startPoint: state.startPoint,
    startPointLocation: state.startPointLocation,
    mainDestinations: state.mainDestinations,
    mainDestinationLocations: state.mainDestinationLocations,
    endPoint: state.mainDestinations[0] || '',
    extraActivities: state.extraActivities,
    calculatedDistanceKm: state.calculatedDistanceKm,
    calculatedDurationHours: state.calculatedDurationHours,
    clientUpdatedAt: state.updatedAt,
  };
}

export function isLocalJourneyReportDraftNewer(localUpdatedAt: unknown, remoteUpdatedAt: unknown): boolean {
  return typeof localUpdatedAt !== 'number' || typeof remoteUpdatedAt !== 'number' ||
    localUpdatedAt > remoteUpdatedAt;
}

export type JourneyReportDraftSaveStatus = 'saving' | 'saved' | 'error';

/** One request at a time; newer input replaces only work that has not started. */
export class JourneyReportDraftSaveQueue {
  private pending: string | null = null;
  private running: Promise<boolean> | null = null;
  private lastQueued: string | null = null;
  private paused = false;

  constructor(
    private readonly save: (snapshot: string) => Promise<unknown>,
    private readonly onStatus: (status: JourneyReportDraftSaveStatus) => void,
  ) {}

  update(snapshot: string): void {
    if (this.paused || snapshot === this.lastQueued) return;
    this.lastQueued = snapshot;
    this.pending = snapshot;
    this.onStatus('saving');
    void this.flush();
  }

  flush(): Promise<boolean> {
    if (this.running) return this.running;
    if (this.paused) return Promise.resolve(false);
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  private async drain(): Promise<boolean> {
    while (this.pending !== null && !this.paused) {
      const snapshot = this.pending;
      this.pending = null;
      this.onStatus('saving');
      try {
        await this.save(snapshot);
      } catch {
        if (this.paused) return false;
        // A failed older snapshot must never displace newer input.
        if (this.pending !== null) continue;
        this.pending = snapshot;
        this.onStatus('error');
        return false;
      }
    }
    if (this.paused) return false;
    this.onStatus('saved');
    return true;
  }

  /** Drain the active request before submission/deletion, discarding queued drafts. */
  async pause(): Promise<void> {
    this.paused = true;
    this.pending = null;
    this.lastQueued = null;
    await this.running;
  }

  resume(): void {
    this.paused = false;
  }
}
