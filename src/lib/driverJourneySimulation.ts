import {
  DEFAULT_DRIVER_JOURNEY_LOCATION,
  DEFAULT_DRIVER_JOURNEY_POINT,
  DEFAULT_DRIVER_VEHICLE_NAME,
  DRIVER_VEHICLE_NAMES,
  DRIVER_VEHICLE_RATES,
  MAX_MAIN_DESTINATIONS,
  calculateLoopFuelCost,
  calculatePlannedDriverJourney,
  driverJourneyRoutePoint,
  normalizeDriverJourneyLocations,
  type DriverJourneyLocation,
  type DriverVehicleName,
  type PlannedDriverJourneyResult,
} from './payroll/driverJourney';

/**
 * Simulasi Biaya Perjalanan: a Kepala SatKer Loyalis's cost estimate for the
 * Perjalanan an event needs (CONTEXT.md). Pure rules shared by the page and the
 * server; the pay itself comes from `calculatePlannedDriverJourney`, the same
 * calculation journey authorization uses.
 */

export const DRIVER_JOURNEY_SIMULATION_PATH = '/dashboard/simulasi-perjalanan';

export function isDriverJourneySimulationPath(pathname: string): boolean {
  return (
    pathname === DRIVER_JOURNEY_SIMULATION_PATH ||
    pathname.startsWith(`${DRIVER_JOURNEY_SIMULATION_PATH}/`)
  );
}

export const MAX_SIMULATION_JOURNEYS = 10;
export const MAX_SIMULATION_STOPS = MAX_MAIN_DESTINATIONS;
export const MAX_SIMULATION_STOP_LENGTH = 200;
export const MAX_SIMULATION_EVENT_NAME_LENGTH = 150;
export const MAX_SIMULATION_MONEY = 100_000_000;
/** A route measured within this many days is reused instead of asking Google again. */
export const ROUTE_QUOTE_REUSE_DAYS = 7;

/** Every vehicle SatKer can borrow. Ndalem is not lent for events. */
export const SIMULATION_VEHICLES: readonly DriverVehicleName[] = DRIVER_VEHICLE_NAMES.filter(
  (name) => name !== DEFAULT_DRIVER_VEHICLE_NAME,
);

export function isSimulationVehicle(value: unknown): value is DriverVehicleName {
  return typeof value === 'string' && (SIMULATION_VEHICLES as readonly string[]).includes(value);
}

/** Every Perjalanan starts and ends at UNIPDU Jombang, where the cars are kept. */
export const SIMULATION_START_LABEL = DEFAULT_DRIVER_JOURNEY_POINT;

/** UNIPDU as the route point the sopir's own report measures from. */
export function simulationStartPoint(): string {
  return driverJourneyRoutePoint(DEFAULT_DRIVER_JOURNEY_POINT, DEFAULT_DRIVER_JOURNEY_LOCATION);
}

export function normalizeSimulationStops(stops: readonly string[]): string[] {
  return stops.map((stop) => stop.trim()).filter(Boolean);
}

/**
 * The loop Google measures: UNIPDU, the stops in order, back to UNIPDU. A stop
 * picked on the map is sent as its coordinates, as in the sopir's report; an
 * older Simulasi saved before stops had coordinates falls back to the name.
 */
export function simulationRoutePoints(
  stops: readonly string[],
  stopLocations: ReadonlyArray<DriverJourneyLocation | null> = [],
): string[] {
  const start = simulationStartPoint();
  const points = stops
    .map((stop, index) => (stop.trim() ? driverJourneyRoutePoint(stop, stopLocations[index]) : ''))
    .filter(Boolean);
  return [start, ...points, start];
}

/** Identifies a route for "has it been measured yet" checks in the form. */
export function simulationRouteKey(
  stops: readonly string[],
  stopLocations: ReadonlyArray<DriverJourneyLocation | null> = [],
): string {
  return simulationRoutePoints(stops, stopLocations).join('\u0000');
}

// ── Route and toll quotes ──────────────────────────────────────────────────

export interface RouteLeg {
  start: string;
  end: string;
  distanceKm: number;
  durationHours: number;
}

export interface RouteMeasurement {
  /** The whole loop. */
  distanceKm: number;
  /** Google's driving time for the loop (Durasi tempuh). */
  durationHours: number;
  legs: RouteLeg[];
}

/**
 * - `priced`: Google priced the tolls on the route.
 * - `unknown_price`: the route has a toll Google cannot price.
 * - `none`: Google found no toll on the route.
 * - `unavailable`: Google's toll service did not answer (switched off, daily cap reached, error).
 */
export type TollQuoteStatus = 'priced' | 'unknown_price' | 'none' | 'unavailable';

export interface TollAccess {
  /** Zero-based route leg, in the same stop order as the toll quote. */
  legIndex: number;
  /** Google's navigation instructions, not independently verified gate names. */
  entrance: string | null;
  exit: string | null;
}

export interface TollQuote {
  status: TollQuoteStatus;
  /** Whole rupiah, only for `priced`. */
  amount: number | null;
  /** Absent on older quotes; an empty array means Google did not identify the access directions. */
  access?: TollAccess[];
}

export interface RouteQuote {
  measurement: RouteMeasurement;
  toll: TollQuote;
  /** ISO time the route was measured. */
  measuredAt: string;
}

export function isRouteQuoteFresh(
  measuredAt: string,
  now: Date = new Date(),
  days = ROUTE_QUOTE_REUSE_DAYS,
): boolean {
  const measured = Date.parse(measuredAt);
  if (!Number.isFinite(measured)) return false;
  const age = now.getTime() - measured;
  return age >= 0 && age < days * 24 * 60 * 60 * 1000;
}

/** Whether Google's toll answer can stand in for the toll, or someone has to type it. */
export function tollNeedsTyping(status: TollQuoteStatus): boolean {
  return status === 'unknown_price' || status === 'unavailable';
}

/** What the toll field starts at after a route is measured. */
export function initialTollAmount(toll: TollQuote): number | null {
  if (toll.status === 'priced') return toll.amount ?? 0;
  if (toll.status === 'none') return 0;
  return null;
}

// ── Input ──────────────────────────────────────────────────────────────────

/** `google`: the toll is Google's answer. `manual`: someone typed it. */
export type TollSource = 'google' | 'manual';

export interface SimulationJourneyInput {
  stops: string[];
  /** The map pin of each stop, in the same order; null for a stop known only by name. */
  stopLocations: Array<DriverJourneyLocation | null>;
  vehicleName: DriverVehicleName;
  departureDate: string;
  departureTime: string;
  returnDate: string;
  returnTime: string;
  tollSource: TollSource;
  /** Only read when `tollSource` is `manual`. */
  tollAmount: number;
  parkingFee: number;
  withoutDriver?: boolean;
}

export interface SimulationInput {
  eventName: string;
  journeys: SimulationJourneyInput[];
}

export class SimulationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationInputError';
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isRealDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function moneyField(value: unknown, label: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_SIMULATION_MONEY) {
    throw new SimulationInputError(`${label} tidak valid.`);
  }
  return amount;
}

/** The stops of one Perjalanan, in order, without UNIPDU at either end. */
export function parseSimulationStops(raw: unknown, prefix = ''): string[] {
  const fail = (text: string) => new SimulationInputError(
    prefix ? `${prefix}${text}` : `${text.charAt(0).toUpperCase()}${text.slice(1)}`,
  );
  if (!Array.isArray(raw) || raw.some((stop) => typeof stop !== 'string')) {
    throw fail('daftar tujuan tidak valid.');
  }
  const stops = (raw as string[]).map((stop) => stop.trim());
  if (stops.length === 0 || stops.some((stop) => !stop)) {
    throw fail('isi setiap tujuan atau hapus baris yang kosong.');
  }
  if (stops.length > MAX_SIMULATION_STOPS) {
    throw fail(`maksimal ${MAX_SIMULATION_STOPS} tujuan.`);
  }
  if (stops.some((stop) => stop.length > MAX_SIMULATION_STOP_LENGTH)) {
    throw fail(`setiap tujuan maksimal ${MAX_SIMULATION_STOP_LENGTH} karakter.`);
  }
  return stops;
}

/** The stops of one Perjalanan with their map pins; a pin that does not belong to its stop is dropped. */
export function parseSimulationRoute(
  rawStops: unknown,
  rawLocations: unknown,
  prefix = '',
): { stops: string[]; stopLocations: Array<DriverJourneyLocation | null> } {
  const stops = parseSimulationStops(rawStops, prefix);
  return { stops, stopLocations: normalizeDriverJourneyLocations(rawLocations, stops) };
}

function parseJourney(raw: unknown, position: number): SimulationJourneyInput {
  const label = `Perjalanan ${position}`;
  if (!isRecord(raw)) throw new SimulationInputError(`${label} tidak valid.`);

  const { stops, stopLocations } = parseSimulationRoute(raw.stops, raw.stopLocations, `${label}: `);

  if (!isSimulationVehicle(raw.vehicleName)) {
    throw new SimulationInputError(`${label}: pilih kendaraan.`);
  }

  const departureDate = String(raw.departureDate ?? '');
  const returnDate = String(raw.returnDate ?? '');
  const departureTime = String(raw.departureTime ?? '');
  const returnTime = String(raw.returnTime ?? '');
  if (!isRealDate(departureDate) || !TIME.test(departureTime)) {
    throw new SimulationInputError(`${label}: isi tanggal dan jam berangkat.`);
  }
  if (!isRealDate(returnDate) || !TIME.test(returnTime)) {
    throw new SimulationInputError(`${label}: isi tanggal dan jam kembali.`);
  }
  if (`${returnDate}T${returnTime}` <= `${departureDate}T${departureTime}`) {
    throw new SimulationInputError(`${label}: waktu kembali harus setelah waktu berangkat.`);
  }

  if (raw.tollSource !== 'google' && raw.tollSource !== 'manual') {
    throw new SimulationInputError(`${label}: sumber biaya tol tidak valid.`);
  }
  const tollSource = raw.tollSource;
  const tollAmount = tollSource === 'manual' ? moneyField(raw.tollAmount, `${label}: biaya tol`) : 0;
  const parkingFee = moneyField(raw.parkingFee ?? 0, `${label}: biaya parkir`);
  const withoutDriver = Boolean(raw.withoutDriver);

  return {
    stops,
    stopLocations,
    vehicleName: raw.vehicleName,
    departureDate,
    departureTime,
    returnDate,
    returnTime,
    tollSource,
    tollAmount,
    parkingFee,
    withoutDriver,
  };
}

/** Validates a Simulasi as the page sends it. Throws `SimulationInputError` with a message for the user. */
export function parseSimulationInput(raw: unknown): SimulationInput {
  if (!isRecord(raw)) throw new SimulationInputError('Data simulasi tidak valid.');
  const eventName = typeof raw.eventName === 'string' ? raw.eventName.trim() : '';
  if (!eventName) throw new SimulationInputError('Nama kegiatan wajib diisi.');
  if (eventName.length > MAX_SIMULATION_EVENT_NAME_LENGTH) {
    throw new SimulationInputError(`Nama kegiatan maksimal ${MAX_SIMULATION_EVENT_NAME_LENGTH} karakter.`);
  }
  if (!Array.isArray(raw.journeys) || raw.journeys.length === 0) {
    throw new SimulationInputError('Tambahkan minimal satu perjalanan.');
  }
  if (raw.journeys.length > MAX_SIMULATION_JOURNEYS) {
    throw new SimulationInputError(`Maksimal ${MAX_SIMULATION_JOURNEYS} perjalanan dalam satu simulasi.`);
  }
  return {
    eventName,
    journeys: raw.journeys.map((journey, index) => parseJourney(journey, index + 1)),
  };
}

// ── Cost ───────────────────────────────────────────────────────────────────

export interface SimulationJourneyResult extends SimulationJourneyInput {
  withoutDriver: boolean;
  route: RouteMeasurement & { measuredAt: string };
  tollQuote: TollQuote;
  /** The toll counted in the total. */
  tollFee: number;
  vehicleRate: number;
  fuelCost: number;
  pay: PlannedDriverJourneyResult;
  total: number;
}

export interface SimulationResult {
  journeys: SimulationJourneyResult[];
  grandTotal: number;
}

/** The toll a Perjalanan counts. Throws when Google could not price it and nobody typed it. */
export function resolveSimulationToll(
  journey: Pick<SimulationJourneyInput, 'tollSource' | 'tollAmount'>,
  quote: TollQuote,
): number {
  if (journey.tollSource === 'manual') return journey.tollAmount;
  if (quote.status === 'priced') return quote.amount ?? 0;
  if (quote.status === 'none') return 0;
  throw new SimulationInputError(
    quote.status === 'unknown_price'
      ? 'Rute melewati tol yang tarifnya tidak diketahui Google. Isi biaya tol.'
      : 'Tarif tol tidak tersedia dari Google. Isi biaya tol.',
  );
}

/**
 * How the toll was settled, for the "diubah manual" mark: `override` when
 * someone replaced a Google price, `filled` when Google had no price.
 */
export function simulationTollMark(
  journey: Pick<SimulationJourneyResult, 'tollSource' | 'tollQuote'>,
): 'override' | 'filled' | null {
  if (journey.tollSource !== 'manual') return null;
  return journey.tollQuote.status === 'priced' || journey.tollQuote.status === 'none'
    ? 'override'
    : 'filled';
}

export function calculateSimulationJourney(
  journey: SimulationJourneyInput,
  quote: RouteQuote,
): SimulationJourneyResult {
  const { measurement } = quote;
  const withoutDriver = Boolean(journey.withoutDriver);
  const rawPay = calculatePlannedDriverJourney({
    loopDistanceKm: measurement.distanceKm,
    loopDurationHours: measurement.durationHours,
    departureDate: journey.departureDate,
    departureTime: journey.departureTime,
    returnDate: journey.returnDate,
    returnTime: journey.returnTime,
  });
  const pay: PlannedDriverJourneyResult = withoutDriver
    ? {
        ...rawPay,
        componentJarak: 0,
        componentWaktu: 0,
        shortTripMeal: 0,
        mealWage: 0,
        nightPremium: 0,
        upahBersih: 0,
      }
    : rawPay;
  const fuelCost = calculateLoopFuelCost(measurement.distanceKm, journey.vehicleName);
  const tollFee = resolveSimulationToll(journey, quote.toll);
  return {
    ...journey,
    withoutDriver,
    stops: [...journey.stops],
    stopLocations: journey.stops.map((_, index) => {
      const location = journey.stopLocations?.[index];
      return location ? { ...location } : null;
    }),
    route: {
      distanceKm: measurement.distanceKm,
      durationHours: measurement.durationHours,
      legs: measurement.legs.map((leg) => ({ ...leg })),
      measuredAt: quote.measuredAt,
    },
    tollQuote: { ...quote.toll },
    tollFee,
    vehicleRate: DRIVER_VEHICLE_RATES[journey.vehicleName],
    fuelCost,
    pay,
    total: fuelCost + tollFee + journey.parkingFee + pay.upahBersih,
  };
}

/** Every Perjalanan of a Simulasi with its route quote, in the same order. */
export function calculateSimulation(
  journeys: readonly SimulationJourneyInput[],
  quotes: readonly RouteQuote[],
): SimulationResult {
  if (journeys.length !== quotes.length) {
    throw new Error('Setiap perjalanan membutuhkan satu pengukuran rute.');
  }
  const results = journeys.map((journey, index) => calculateSimulationJourney(journey, quotes[index]));
  return {
    journeys: results,
    grandTotal: results.reduce((sum, journey) => sum + journey.total, 0),
  };
}

/** A saved Simulasi as the page receives it. */
export interface SimulationView {
  id: string;
  eventName: string;
  ownerName: string;
  isOwner: boolean;
  journeys: SimulationJourneyResult[];
  grandTotal: number;
  /** ISO time the figures were last worked out. */
  calculatedAt: string;
  updatedAt: string;
}

// ── Display ────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function formatRupiah(amount: number): string {
  return `Rp${Math.round(amount || 0).toLocaleString('id-ID')}`;
}

/** "2026-11-02" as "2 Nov 2026". */
export function formatPlanDate(value: string): string {
  if (!DATE_ONLY.test(value)) return value;
  const [year, month, day] = value.split('-').map(Number);
  return `${day} ${MONTHS_SHORT[month - 1]} ${year}`;
}

/** Departure and return as one line: "2 Nov 2026, 07:00 – 15:00" or across days. */
export function formatPlanSpan(
  journey: Pick<SimulationJourneyInput, 'departureDate' | 'departureTime' | 'returnDate' | 'returnTime'>,
): string {
  const start = `${formatPlanDate(journey.departureDate)}, ${journey.departureTime}`;
  return journey.returnDate === journey.departureDate
    ? `${start} – ${journey.returnTime}`
    : `${start} – ${formatPlanDate(journey.returnDate)}, ${journey.returnTime}`;
}

export function formatKm(km: number): string {
  return `${(Math.round(km * 10) / 10).toLocaleString('id-ID')} km`;
}

/** Hours as "8j 05m". */
export function formatHours(hours: number): string {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  return `${Math.floor(totalMinutes / 60)}j ${String(totalMinutes % 60).padStart(2, '0')}m`;
}

export interface CostLine {
  label: string;
  amount: number;
}

/** The Upah Bersih broken into the parts the sopir is paid, as the page and the printout show it. */
export function upahBersihLines(journey: SimulationJourneyResult): CostLine[] {
  if (journey.withoutDriver) return [];
  const { pay, route } = journey;
  const lines: CostLine[] = [
    { label: `Komponen jarak (${formatKm(route.distanceKm)} × Rp300)`, amount: pay.componentJarak },
    { label: `Komponen waktu (${formatHours(route.durationHours)} × Rp5.000/jam)`, amount: pay.componentWaktu },
    { label: `Uang makan (${formatHours(pay.journeyDurationHours)})`, amount: pay.mealWage },
  ];
  if (pay.shortTripMeal > 0) lines.push({ label: 'Uang makan perjalanan singkat', amount: pay.shortTripMeal });
  if (pay.nightCount > 0) {
    lines.push({ label: `Premium malam (${pay.nightCount} malam × Rp50.000)`, amount: pay.nightPremium });
  }
  return lines;
}

export function tollLineLabel(journey: SimulationJourneyResult): string {
  const mark = simulationTollMark(journey);
  if (mark === 'override') return 'Tol (diubah manual)';
  if (mark === 'filled') return 'Tol (diisi manual)';
  return 'Tol';
}
