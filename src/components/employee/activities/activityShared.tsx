"use client";

import {
  Clock,
  CheckCircle2,
  XCircle,
  Compass,
} from 'lucide-react';
import {
  SatpamPostId,
  type PhotoAuditMetadata,
  type PhotoEvidence,
} from '@/lib/payroll/domain';
import {
  calculateDriverNetWage,
  normalizeDriverJourneyDestinations,
} from '@/lib/payroll/driverJourney';
import {
  calculateActivitySpjEstimate,
  pekaryaSpjRateBasis,
} from '@/lib/payroll/pekaryaSpj';
import {
  type SwapLiburPrompt,
} from '@/components/satpam/SwapLiburConfirmModal';

interface GoogleMapsRuntime {
  maps: {
    Map?: unknown;
    places?: Record<string, unknown> & { AutocompleteSuggestion?: unknown };
    importLibrary?: (library: string) => Promise<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

interface FirestoreTimestampLike {
  toDate?: () => Date;
}

export const loadGoogleMapsScript = (callback: () => void) => {
  if (typeof window === 'undefined') return;
  const g = (window as Window & { google?: GoogleMapsRuntime }).google;
  if (g && g.maps && g.maps.Map) {
    if (g.maps.places?.AutocompleteSuggestion) {
      callback();
    } else if (g.maps.importLibrary) {
      void g.maps.importLibrary('places').then((placesLib: Record<string, unknown>) => {
        const places = g.maps.places || {};
        g.maps.places = places;
        Object.assign(places, placesLib);
        callback();
      }).catch(() => callback());
    } else {
      callback();
    }
    return;
  }

  const onScriptLoad = async () => {
    const googleObj = (window as Window & { google?: GoogleMapsRuntime }).google;
    if (googleObj && googleObj.maps && googleObj.maps.importLibrary) {
      try {
        const [mapsLib, placesLib, geocodingLib, markerLib] = await Promise.all([
          googleObj.maps.importLibrary('maps'),
          googleObj.maps.importLibrary('places'),
          googleObj.maps.importLibrary('geocoding'),
          googleObj.maps.importLibrary('marker'),
        ]);
        if (mapsLib) Object.assign(googleObj.maps, mapsLib);
        if (geocodingLib) Object.assign(googleObj.maps, geocodingLib);
        if (markerLib) Object.assign(googleObj.maps, markerLib);
        if (placesLib) {
          const places = googleObj.maps.places || {};
          googleObj.maps.places = places;
          Object.assign(places, placesLib);
        }
      } catch (e) {
        console.error('Error importing Google Maps libraries:', e);
      }
    }
    callback();
  };

  const existingScript = document.getElementById('googleMapsScript') as HTMLScriptElement | null;
  if (existingScript) {
    if (existingScript.dataset.loaded === 'true') {
      onScriptLoad();
    } else {
      existingScript.addEventListener('load', onScriptLoad);
    }
    return;
  }

  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}&libraries=places`;
  script.id = 'googleMapsScript';
  script.async = true;
  script.defer = true;
  script.addEventListener('load', async () => {
    script.dataset.loaded = 'true';
    await onScriptLoad();
  });
  document.head.appendChild(script);
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ActivityReport {
  id: string;
  employeeId: string;
  employeeName: string;
  jobCategory: string;
  period: string;
  activityName: string;
  activityType?: 'Piket' | 'Standby' | 'Ro\'an' | 'Lainnya' | 'Buang Sampah';
  activityDate: string;
  timeStart: string;
  timeEnd: string;
  status: 'pending' | 'approved' | 'declined';
  fee: number;
  submittedFeeEstimate?: number;
  hasUangMakan?: boolean;
  declineReason?: string;
  submittedAt?: FirestoreTimestampLike;
  reviewedAt?: unknown;
  reviewedBy?: string;
  // SOPIR specific fields
  tripType?: 'Dalam Kota' | 'Luar Kota';
  vehicleType?: 'Mobil Kecil' | 'Bus/Truk' | string;
  nightCount?: number;
  fuelFee?: number;
  tollParkingFee?: number;
  points?: string[];
  distanceKm?: number;
  durationHours?: number;
  upahBersih?: number;
  extraMealAllowance?: number;
  extraFuelCost?: number;
  extraTollCost?: number;
  extraDistanceKm?: number;
  extraOperationalCost?: number;
  actualMealAllowance?: number;
  positiveReimburseDelta?: number;
  fuelReceiptUrl?: string;
  tollReceiptUrl?: string;
  journeyId?: string;
  extraActivities?: unknown[];
  vehicleRate?: number;
  baseOperationalCost?: number;
  fuelProcurementMode?: 'hold_accumulate' | 'procure_release' | 'standard_direct';
  procuredAccumulatedAmount?: number;
  mealAllowance?: number;
  preAuthorizedMeal?: number;
  preAuthorizedToll?: number;
  totalOperationalCost?: number;
  totalPreAuthorizedAllowance?: number;
  totalActualSpent?: number;
  reimburseDelta?: number;
  unspentCash?: number;
  remainingUnspentCash?: number;
  baseDriverWage?: number;
  componentJarak?: number;
  componentWaktu?: number;
  nightPremium?: number;
  authorizedAt?: unknown;
  journeyDate?: string;
  claimedAt?: unknown;
  completedAt?: unknown;
  customDurationPP?: number;
  // SATPAM specific fields
  reportKind?:
    | 'satpam_spj'
    | 'satpam_found_item'
    | 'satpam_reprimand'
    | 'satpam_shift_assignment'
    | 'pekarya_activity';
  sourceOccurrenceId?: string;
  sourceOccurrenceRevision?: number;
  auditorActionAt?: unknown;
  anomalyCodes?: string[];
  suggestedShiftName?: 'Pagi' | 'Sore' | 'Malam' | string;
  reportedShiftName?: 'Pagi' | 'Sore' | 'Malam' | string;
  shiftName?: 'Pagi' | 'Sore' | 'Malam' | string;
  shiftType?: 'Harian' | 'Jumat & Libur' | 'Lembur Sendiri' | 'Lembur Cover' | 'Off-Duty' | string;
  postName?: string;
  ketuaShiftId?: string;
  ketuaShiftName?: string;
  coveredEmployeeId?: string;
  overtimeReason?: string;
  photoUrl?: string;
  photoAuditMetadata?: PhotoAuditMetadata;
  itemName?: string;
  proofPhotos?: PhotoEvidence[];
  proofPhoto?: PhotoEvidence;
  submittedFeeRecommendation?: number;
}

export interface SatpamPostAssignment {
  employeeId: string;
  shiftType: string;
  coveredEmployeeId?: string;
  overtimeReason?: string;
  photoUrl?: string;
  photoAuditMetadata?: PhotoAuditMetadata;
}

export type PendingDailyLiburSwap = SwapLiburPrompt & {
  guardAId: string;
  guardBId: string;
  postXId: SatpamPostId;
  previousAssignment?: {
    employeeId: string;
    shiftType: string;
    coveredEmployeeId?: string;
    overtimeReason?: string;
  };
};

export const LATEST_VEHICLE_RATES: Record<string, number> = {
  'Bis': 2500,
  'Elf': 1350,
  'Kijang LGX': 1200,
  'Innova Hitam': 1250,
  'Innova Matic': 1450,
  'Suzuki': 1000,
  'Suzuki XL7': 1000,
  'Ndalem': 0,
};

export function getEffectiveVehicleRate(vName?: string, savedRate?: number): number {
  if (!vName) return savedRate || 1000;
  if (LATEST_VEHICLE_RATES[vName] !== undefined) return LATEST_VEHICLE_RATES[vName];
  for (const [k, v] of Object.entries(LATEST_VEHICLE_RATES)) {
    if (vName.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return savedRate || 1000;
}

export const DestinationImageBanner = ({ destination }: { destination: string }) => (
  <div className="relative flex h-32 w-full items-center justify-center overflow-hidden border-b border-slate-100 bg-gradient-to-br from-indigo-100 to-purple-100">
    <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#4f46e5_1px,transparent_1px)] [background-size:16px_16px]" />
    <div className="relative z-10 flex max-w-[80%] flex-col items-center gap-2 text-center text-indigo-700">
      <Compass className="h-9 w-9 text-indigo-400/70" />
      <strong className="line-clamp-2 text-[11px]">{destination}</strong>
    </div>
  </div>
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isWeekend(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

export function calculateSopirDefaultFee(
  _tripType?: 'Dalam Kota' | 'Luar Kota',
  _vehicleType?: string,
  nightCount = 0,
  _activityDate?: string,
  _fuelFee?: number,
  _tollParkingFee?: number,
  distanceKm?: number,
  durationHours?: number,
  routeDurationHours?: number
): number {
  return calculateDriverNetWage({
    distanceKm: distanceKm || 0,
    travelTimeHours: routeDurationHours ?? durationHours ?? 0,
    elapsedDurationHours: durationHours || 0,
    nightCount,
  });
}

export function fmtRp(val: number): string {
  return 'Rp' + val.toLocaleString('id-ID');
}

export function journeyMainDestinationLabel(journey: {
  mainDestinations?: unknown;
  endPoint?: unknown;
}): string {
  return normalizeDriverJourneyDestinations(
    journey?.mainDestinations,
    journey?.endPoint,
  )
    .map((destination) => destination.split(',')[0].trim())
    .join(' → ');
}

export function getNextDayISO(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function padTime(time: string): string {
  if (!time) return '';
  const parts = time.split(':');
  if (parts.length === 2) {
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padEnd(2, '0');
    return `${h}:${m}`;
  }
  if (parts.length === 1 && parts[0].length > 0) {
    return `${parts[0].padStart(2, '0')}:00`;
  }
  return time;
}

export function calculateDefaultFee(timeStart: string, timeEnd: string, activityType?: string, activityName?: string, activityDate?: string): number {
  if (!timeStart || !timeEnd) {
    return activityType === 'Buang Sampah' || activityName === 'Buang Sampah'
      ? 5_000
      : 0;
  }

  try {
    return calculateActivitySpjEstimate(timeStart, timeEnd, activityType, activityName, activityDate);
  } catch {
    return 0;
  }
}

export function getActivityFeeBreakdown(timeStart: string, timeEnd: string, activityType?: string, activityName?: string, activityDate?: string): string {
  if (activityType === 'Buang Sampah' || activityName === 'Buang Sampah') {
    return 'Tarif Flat';
  }

  if (!timeStart || !timeEnd) return '';

  const [sh, sm] = timeStart.split(':').map(Number);
  const [eh, em] = timeEnd.split(':').map(Number);

  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return '';

  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;

  const basis = pekaryaSpjRateBasis(minutes, activityType, activityName, activityDate);
  const rp = `Rp${basis.rate.toLocaleString('id-ID')}`;

  if (!basis.perMinute) {
    return `${Math.round(minutes / 30)} × ${rp}/30m`;
  }

  const breakdown = `${basis.billableMinutes} menit × ${rp}/jam`;
  return basis.minimumApplied ? `${breakdown} (min. 1 jam)` : breakdown;
}

export function getStatusConfig(status: string) {
  switch (status) {
    case 'approved':
      return {
        label: 'Disetujui',
        icon: CheckCircle2,
        bgClass: 'bg-emerald-50',
        textClass: 'text-emerald-700',
        borderClass: 'border-emerald-200',
        dotClass: 'bg-emerald-500',
      };
    case 'declined':
      return {
        label: 'Ditolak',
        icon: XCircle,
        bgClass: 'bg-rose-50',
        textClass: 'text-rose-700',
        borderClass: 'border-rose-200',
        dotClass: 'bg-rose-500',
      };
    default:
      return {
        label: 'Menunggu',
        icon: Clock,
        bgClass: 'bg-amber-50',
        textClass: 'text-amber-700',
        borderClass: 'border-amber-200',
        dotClass: 'bg-amber-500',
      };
  }
}

/**
 * Anchored to WIB (Asia/Jakarta) rather than the device's local calendar so a
 * phone with a misconfigured timezone doesn't report "today" as a different
 * date than the rest of the system (which is Jakarta-based throughout).
 */
export function getTodayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function getInitialSatpamDateISO(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const todayIso = `${values.year}-${values.month}-${values.day}`;
  const hours = Number(values.hour);
  const minutes = Number(values.minute);
  // If it's between midnight 00:00 and 08:30 WIB, default to yesterday.
  if (hours < 8 || (hours === 8 && minutes < 30)) {
    const yesterday = new Date(`${todayIso}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return yesterday.toISOString().slice(0, 10);
  }
  return todayIso;
}

export function createBlankSatpamAssignments(
  shiftType: string,
): Record<string, SatpamPostAssignment> {
  return Object.fromEntries(
    POSTS_CONFIG.map((post) => [
      post.id,
      { employeeId: '', shiftType },
    ]),
  ) as Record<string, SatpamPostAssignment>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const YEARS = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i);

export const POSTS_CONFIG = [
  { id: 'Pos 1', name: 'Pos IC' },
  { id: 'Pos 2', name: 'Pos Stasiun' },
  { id: 'Pos 3', name: 'Pos ATM Graha' },
  { id: 'Pos 4', name: 'Pos Plaza' },
  { id: 'Pos 5', name: 'Pos Masjid Induk' },
  { id: 'Pos 6', name: 'Pos Gor' },
  { id: 'Pos 7', name: 'Pos Saintek' },
  { id: 'Pos 8', name: 'Pos Parkiran FIK' },
  { id: 'Pos 9', name: 'Pos Hurun-inn' },
];

export type SatpamDraftSyncStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'error';

export function createSatpamDraftFingerprint(input: {
  shiftName: string;
  assignments: Record<string, SatpamPostAssignment>;
  extraVisible: boolean;
  extraEmployeeId: string;
  extraPostName: string;
  extraOvertimeReason: string;
  extraPhotoUrl: string;
  extraPhotoAuditMetadata?: PhotoAuditMetadata;
}): string {
  return JSON.stringify({
    shiftName: input.shiftName,
    assignments: POSTS_CONFIG.map((post) => {
      const assignment = input.assignments[post.id];
      return {
        postId: post.id,
        employeeId: assignment?.employeeId || '',
        shiftType: assignment?.shiftType || '',
        coveredEmployeeId: assignment?.coveredEmployeeId || '',
        overtimeReason: assignment?.overtimeReason || '',
        photoUrl: assignment?.photoUrl || '',
        photoAuditMetadata: assignment?.photoAuditMetadata || null,
      };
    }),
    extraVisible: input.extraVisible,
    extraAssignment: input.extraVisible
      ? {
          postId: input.extraPostName,
          employeeId: input.extraEmployeeId,
          overtimeReason: input.extraOvertimeReason,
          photoUrl: input.extraPhotoUrl,
          photoAuditMetadata: input.extraPhotoAuditMetadata || null,
        }
      : null,
  });
}

