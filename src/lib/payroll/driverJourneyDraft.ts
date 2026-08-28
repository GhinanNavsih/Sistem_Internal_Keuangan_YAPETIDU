import {
  DEFAULT_DRIVER_JOURNEY_LOCATION,
  DEFAULT_DRIVER_JOURNEY_POINT,
  DEFAULT_FUEL_PROCUREMENT_MODE,
  MAX_MAIN_DESTINATIONS,
  isDriverVehicleName,
  isFuelProcurementMode,
  normalizeDriverJourneyLocation,
  type DriverJourneyLocation,
  type DriverVehicleName,
  type FuelProcurementMode,
} from './driverJourney';

export const DRIVER_JOURNEY_DRAFT_STORAGE_VERSION = 1;

const DEFAULT_AUTHORIZATION_VEHICLE: DriverVehicleName = 'Suzuki XL7';
const MAX_DESTINATION_TEXT_LENGTH = 300;
const MAX_ACTIVITY_NAME_LENGTH = 180;
const MAX_DRAFT_ID_LENGTH = 200;

export type DriverJourneyDraftMapTarget = 'start' | 'end' | number;

/** The part of the authorization form that is safe to persist locally. */
export interface DriverJourneyAuthorizationDraftState {
  hasUserChanges: boolean;
  editingJourneyId: string | null;
  activityName: string;
  activityDate: string;
  startPoint: string;
  startPointLocation: DriverJourneyLocation | null;
  endPoint: string;
  endPointLocation: DriverJourneyLocation | null;
  additionalDestinations: string[];
  additionalDestinationLocations: Array<DriverJourneyLocation | null>;
  selectedVehicle: DriverVehicleName;
  fuelProcurementMode: FuelProcurementMode;
  tollFee: string;
  assignedDriverId: string;
  calcDistance: number | null;
  calcDuration: number | null;
  inputDuration: number | null;
  showMapSelector: boolean;
  mapTarget: DriverJourneyDraftMapTarget;
  mapSearchText: string;
  mapAddress: string;
  mapLocation: DriverJourneyLocation | null;
}

export interface DriverJourneyAuthorizationDraft extends DriverJourneyAuthorizationDraftState {
  version: number;
  periodToken: string;
  savedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPeriodToken(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function boundedString(value: unknown, fallback = '', maxLength = Number.MAX_SAFE_INTEGER): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeMoneyInput(value: unknown): string {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? Number(digits).toLocaleString('id-ID') : '';
}

function cloneLocation(location: DriverJourneyLocation | null): DriverJourneyLocation | null {
  return location ? { ...location } : null;
}

/**
 * Keeps drafts isolated between accounts and payroll periods. The period is
 * stored in the payload as well, so a stale render can never be restored into
 * a different period merely because it found the expected localStorage key.
 */
export function driverJourneyDraftStorageKey(
  userId: string,
  periodToken: string,
): string {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId || !isPeriodToken(periodToken)) return '';
  return `unipdu:driver-journey-draft:v${DRIVER_JOURNEY_DRAFT_STORAGE_VERSION}:${encodeURIComponent(normalizedUserId)}:${periodToken}`;
}

export function createDriverJourneyAuthorizationDraft(
  state: DriverJourneyAuthorizationDraftState,
  periodToken: string,
  savedAt = new Date().toISOString(),
): DriverJourneyAuthorizationDraft {
  return {
    version: DRIVER_JOURNEY_DRAFT_STORAGE_VERSION,
    periodToken,
    savedAt,
    hasUserChanges: state.hasUserChanges,
    editingJourneyId: state.editingJourneyId,
    activityName: state.activityName,
    activityDate: state.activityDate,
    startPoint: state.startPoint,
    startPointLocation: cloneLocation(state.startPointLocation),
    endPoint: state.endPoint,
    endPointLocation: cloneLocation(state.endPointLocation),
    // Copy both arrays together. Their positional pairing is what keeps a
    // destination's coordinates attached after a reload.
    additionalDestinations: [...state.additionalDestinations],
    additionalDestinationLocations: state.additionalDestinationLocations.map(cloneLocation),
    selectedVehicle: state.selectedVehicle,
    fuelProcurementMode: state.fuelProcurementMode,
    tollFee: state.tollFee,
    assignedDriverId: state.assignedDriverId,
    calcDistance: state.calcDistance,
    calcDuration: state.calcDuration,
    inputDuration: state.inputDuration,
    showMapSelector: state.showMapSelector,
    mapTarget: state.mapTarget,
    mapSearchText: state.mapSearchText,
    mapAddress: state.mapAddress,
    mapLocation: cloneLocation(state.mapLocation),
  };
}

export function serializeDriverJourneyAuthorizationDraft(
  state: DriverJourneyAuthorizationDraftState,
  periodToken: string,
  savedAt = new Date().toISOString(),
): string {
  return JSON.stringify(createDriverJourneyAuthorizationDraft(state, periodToken, savedAt));
}

function normalizeMapTarget(
  value: unknown,
  additionalDestinationCount: number,
): DriverJourneyDraftMapTarget {
  if (value === 'start' || value === 'end') return value;
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value < additionalDestinationCount
  ) {
    return value;
  }
  return 'end';
}

/**
 * Parses only the fields this page knows how to restore. Malformed or
 * cross-period drafts are ignored, while intentionally blank destination rows
 * remain in the arrays so the timeline shape is never silently compressed.
 */
export function parseDriverJourneyAuthorizationDraft(
  raw: string | null,
  expectedPeriodToken: string,
): DriverJourneyAuthorizationDraft | null {
  if (!raw || !isPeriodToken(expectedPeriodToken)) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (
      parsed.version !== DRIVER_JOURNEY_DRAFT_STORAGE_VERSION ||
      parsed.periodToken !== expectedPeriodToken ||
      parsed.hasUserChanges !== true
    ) {
      return null;
    }

    const startPoint = boundedString(
      parsed.startPoint,
      DEFAULT_DRIVER_JOURNEY_POINT,
      MAX_DESTINATION_TEXT_LENGTH,
    ).trim() || DEFAULT_DRIVER_JOURNEY_POINT;
    const endPoint = boundedString(parsed.endPoint, '', MAX_DESTINATION_TEXT_LENGTH).trim();
    const rawAdditionalDestinations = Array.isArray(parsed.additionalDestinations)
      ? parsed.additionalDestinations
      : [];
    const additionalDestinations = rawAdditionalDestinations
      .slice(0, Math.max(0, MAX_MAIN_DESTINATIONS - 1))
      .map((destination) => boundedString(destination, '', MAX_DESTINATION_TEXT_LENGTH).trim());
    const rawAdditionalLocations = Array.isArray(parsed.additionalDestinationLocations)
      ? parsed.additionalDestinationLocations
      : [];
    const additionalDestinationLocations = additionalDestinations.map((destination, index) => (
      destination
        ? normalizeDriverJourneyLocation(rawAdditionalLocations[index], destination) || null
        : null
    ));

    const startPointLocation = normalizeDriverJourneyLocation(
      parsed.startPointLocation,
      startPoint,
    ) || (startPoint === DEFAULT_DRIVER_JOURNEY_POINT
      ? { ...DEFAULT_DRIVER_JOURNEY_LOCATION }
      : null);
    const endPointLocation = endPoint
      ? normalizeDriverJourneyLocation(parsed.endPointLocation, endPoint) || null
      : null;

    const selectedVehicle = isDriverVehicleName(parsed.selectedVehicle)
      ? parsed.selectedVehicle
      : DEFAULT_AUTHORIZATION_VEHICLE;
    const fuelProcurementMode = selectedVehicle === 'Ndalem'
      ? DEFAULT_FUEL_PROCUREMENT_MODE
      : isFuelProcurementMode(parsed.fuelProcurementMode)
        ? parsed.fuelProcurementMode
        : DEFAULT_FUEL_PROCUREMENT_MODE;

    const mapSearchText = boundedString(parsed.mapSearchText, '', MAX_DESTINATION_TEXT_LENGTH);
    const rawMapAddress = boundedString(parsed.mapAddress, '', MAX_DESTINATION_TEXT_LENGTH).trim();
    const rawMapLocation = normalizeDriverJourneyLocation(
      parsed.mapLocation,
      rawMapAddress || undefined,
    );
    const mapAddress = rawMapAddress || rawMapLocation?.address || '';
    const mapLocation = rawMapLocation
      ? normalizeDriverJourneyLocation(rawMapLocation, mapAddress)
      : null;

    return {
      version: DRIVER_JOURNEY_DRAFT_STORAGE_VERSION,
      periodToken: expectedPeriodToken,
      savedAt: boundedString(parsed.savedAt),
      hasUserChanges: true,
      editingJourneyId: typeof parsed.editingJourneyId === 'string' && parsed.editingJourneyId.trim()
        ? parsed.editingJourneyId.trim().slice(0, MAX_DRAFT_ID_LENGTH)
        : null,
      activityName: boundedString(parsed.activityName, '', MAX_ACTIVITY_NAME_LENGTH),
      activityDate: typeof parsed.activityDate === 'string' && isDateOnly(parsed.activityDate)
        ? parsed.activityDate
        : todayDateOnly(),
      startPoint,
      startPointLocation,
      endPoint,
      endPointLocation,
      additionalDestinations,
      additionalDestinationLocations,
      selectedVehicle,
      fuelProcurementMode,
      tollFee: normalizeMoneyInput(parsed.tollFee),
      assignedDriverId: boundedString(parsed.assignedDriverId).trim(),
      calcDistance: nonNegativeNumber(parsed.calcDistance),
      calcDuration: nonNegativeNumber(parsed.calcDuration),
      inputDuration: nonNegativeNumber(parsed.inputDuration),
      showMapSelector: parsed.showMapSelector === true,
      mapTarget: normalizeMapTarget(parsed.mapTarget, additionalDestinations.length),
      mapSearchText,
      mapAddress,
      mapLocation,
    };
  } catch {
    return null;
  }
}
