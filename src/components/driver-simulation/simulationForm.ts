import {
  calculateSimulationJourney,
  initialTollAmount,
  normalizeSimulationStops,
  simulationRouteKey,
  type RouteQuote,
  type SimulationInput,
  type SimulationJourneyInput,
  type SimulationJourneyResult,
  type SimulationView,
  type TollSource,
} from '@/lib/driverJourneySimulation';
import type { DriverVehicleName } from '@/lib/payroll/driverJourney';

/** One Perjalanan as the form holds it: text as typed, plus the last route answer. */
export interface JourneyForm {
  key: string;
  stops: string[];
  vehicleName: DriverVehicleName | '';
  departureDate: string;
  departureTime: string;
  returnDate: string;
  returnTime: string;
  tollSource: TollSource;
  /** Digits only; empty means not filled in yet. */
  tollInput: string;
  parkingInput: string;
  quote: RouteQuote | null;
  /** The stops the quote was measured for. */
  quoteKey: string;
}

export interface SimulationForm {
  eventName: string;
  journeys: JourneyForm[];
}

let nextKey = 0;
function newKey(): string {
  nextKey += 1;
  return `journey-${Date.now().toString(36)}-${nextKey}`;
}

export function jakartaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

/** A new Perjalanan; dates follow the previous one so a multi-car event needs less typing. */
export function emptyJourney(previous?: JourneyForm): JourneyForm {
  const date = previous?.departureDate || jakartaToday();
  return {
    key: newKey(),
    stops: [''],
    vehicleName: '',
    departureDate: date,
    departureTime: previous?.departureTime || '',
    returnDate: previous?.returnDate || date,
    returnTime: previous?.returnTime || '',
    tollSource: 'google',
    tollInput: '',
    parkingInput: '',
    quote: null,
    quoteKey: '',
  };
}

export function emptyForm(): SimulationForm {
  return { eventName: '', journeys: [emptyJourney()] };
}

function digits(value: number): string {
  return value > 0 ? String(Math.round(value)) : '0';
}

export function journeyFormFromResult(journey: SimulationJourneyResult): JourneyForm {
  return {
    key: newKey(),
    stops: [...journey.stops],
    vehicleName: journey.vehicleName,
    departureDate: journey.departureDate,
    departureTime: journey.departureTime,
    returnDate: journey.returnDate,
    returnTime: journey.returnTime,
    tollSource: journey.tollSource,
    tollInput: digits(journey.tollSource === 'manual' ? journey.tollAmount : journey.tollFee),
    parkingInput: journey.parkingFee > 0 ? String(journey.parkingFee) : '',
    quote: {
      measurement: {
        distanceKm: journey.route.distanceKm,
        durationHours: journey.route.durationHours,
        legs: journey.route.legs,
      },
      toll: journey.tollQuote,
      measuredAt: journey.route.measuredAt,
    },
    quoteKey: simulationRouteKey(journey.stops),
  };
}

export function formFromView(view: SimulationView): SimulationForm {
  return {
    eventName: view.eventName,
    journeys: view.journeys.map(journeyFormFromResult),
  };
}

/** The toll field after a route is measured: Google's answer, or what was typed when Google has none. */
export function applyQuote(journey: JourneyForm, quote: RouteQuote): JourneyForm {
  const initial = initialTollAmount(quote.toll);
  const keepTyped = journey.tollSource === 'manual' ? journey.tollInput : '';
  return {
    ...journey,
    quote,
    quoteKey: simulationRouteKey(journey.stops),
    tollSource: initial === null ? 'manual' : 'google',
    tollInput: initial === null ? keepTyped : digits(initial),
  };
}

export function hasFreshQuote(journey: JourneyForm): boolean {
  return Boolean(journey.quote) && journey.quoteKey === simulationRouteKey(journey.stops);
}

function toInput(journey: JourneyForm): SimulationJourneyInput | null {
  if (!journey.vehicleName) return null;
  return {
    stops: normalizeSimulationStops(journey.stops),
    vehicleName: journey.vehicleName,
    departureDate: journey.departureDate,
    departureTime: journey.departureTime,
    returnDate: journey.returnDate,
    returnTime: journey.returnTime,
    tollSource: journey.tollSource,
    tollAmount: journey.tollSource === 'manual' && journey.tollInput !== '' ? Number(journey.tollInput) : 0,
    parkingFee: journey.parkingInput ? Number(journey.parkingInput) : 0,
  };
}

export type JourneyPreview =
  | { state: 'ready'; result: SimulationJourneyResult }
  | { state: 'blocked'; reason: string };

/** The figures for one Perjalanan as the form stands, or what is still missing. */
export function previewJourney(journey: JourneyForm): JourneyPreview {
  if (normalizeSimulationStops(journey.stops).length === 0) {
    return { state: 'blocked', reason: 'Isi minimal satu tujuan.' };
  }
  if (!journey.vehicleName) return { state: 'blocked', reason: 'Pilih kendaraan.' };
  if (!journey.departureDate || !journey.departureTime) {
    return { state: 'blocked', reason: 'Isi tanggal dan jam berangkat.' };
  }
  if (!journey.returnDate || !journey.returnTime) {
    return { state: 'blocked', reason: 'Isi tanggal dan jam kembali.' };
  }
  if (`${journey.returnDate}T${journey.returnTime}` <= `${journey.departureDate}T${journey.departureTime}`) {
    return { state: 'blocked', reason: 'Waktu kembali harus setelah waktu berangkat.' };
  }
  if (!hasFreshQuote(journey) || !journey.quote) {
    return { state: 'blocked', reason: 'Hitung rute dulu.' };
  }
  if (journey.tollSource === 'manual' && journey.tollInput === '') {
    return { state: 'blocked', reason: 'Isi biaya tol.' };
  }
  const input = toInput(journey);
  if (!input) return { state: 'blocked', reason: 'Pilih kendaraan.' };
  try {
    return { state: 'ready', result: calculateSimulationJourney(input, journey.quote) };
  } catch (error) {
    return { state: 'blocked', reason: error instanceof Error ? error.message : 'Data belum lengkap.' };
  }
}

export function toSimulationInput(form: SimulationForm): SimulationInput {
  return {
    eventName: form.eventName.trim(),
    journeys: form.journeys.map((journey) => {
      const input = toInput(journey);
      if (!input) throw new Error('Pilih kendaraan untuk setiap perjalanan.');
      return input;
    }),
  };
}

/** Compares what would be saved, ignoring how the form got there. */
export function sameSimulationInput(a: SimulationForm, b: SimulationForm): boolean {
  const shape = (form: SimulationForm) => JSON.stringify({
    eventName: form.eventName.trim(),
    journeys: form.journeys.map((journey) => ({
      stops: normalizeSimulationStops(journey.stops),
      vehicleName: journey.vehicleName,
      departureDate: journey.departureDate,
      departureTime: journey.departureTime,
      returnDate: journey.returnDate,
      returnTime: journey.returnTime,
      tollSource: journey.tollSource,
      tollInput: journey.tollSource === 'manual' ? journey.tollInput : '',
      parkingInput: journey.parkingInput.replace(/^0+$/, ''),
    })),
  });
  return shape(a) === shape(b);
}
