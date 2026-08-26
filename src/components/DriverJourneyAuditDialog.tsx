"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  Compass,
  Trash2,
  Plus,
  Lock,
  Edit2,
  MapPin,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import type { PhotoAuditMetadata, PhotoEvidence } from '@/lib/payroll/domain';
import {
  calculateEditableDriverJourneyTimeline,
  calculateDriverReimbursementSettlement,
  calculateDriverNetWage,
  calculateJourneyElapsedHours,
  calculateNightPremium,
  getMealAllowanceForDuration,
  journeyDayCount,
  MAX_DRIVER_JOURNEY_DESTINATIONS,
  MAX_DRIVER_JOURNEY_LOCATIONS,
  DEFAULT_DRIVER_JOURNEY_LOCATION,
  DEFAULT_FUEL_PROCUREMENT_MODE,
  closeDriverJourneyRoundTrip,
  driverJourneyRoutePoint,
  isFuelProcurementMode,
  normalizeDriverJourneyLocation,
  resolveDriverJourneyPointLocations,
  formatDurationHoursAsJamMenit,
  type DriverJourneyLocation,
  type FuelProcurementMode,
} from '@/lib/payroll/driverJourney';
import { pekaryaPayrollPeriodForDate } from '@/lib/payroll/pekaryaSpj';
import { authenticatedJson } from '@/lib/payroll/client';
import {
  PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH,
  useCostSafePlaceAutocomplete,
  type CostSafePlaceSuggestion,
} from '@/hooks/useCostSafePlaceAutocomplete';

// ─── Google Maps loader ──────────────────────────────────────────────────────

const loadGoogleMapsScript = (callback: () => void) => {
  if (typeof window === 'undefined') return;
  const g = (window as any).google;
  if (g && g.maps && g.maps.Map) {
    if (g.maps.places?.AutocompleteSuggestion) {
      callback();
    } else if (g.maps.importLibrary) {
      void g.maps.importLibrary('places').then((placesLib: Record<string, unknown>) => {
        g.maps.places = g.maps.places || {};
        Object.assign(g.maps.places, placesLib);
        callback();
      }).catch(() => callback());
    } else {
      callback();
    }
    return;
  }

  const onScriptLoad = async () => {
    const googleObj = (window as any).google;
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
          googleObj.maps.places = googleObj.maps.places || {};
          Object.assign(googleObj.maps.places, placesLib);
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

/**
 * The subset of an `ActivityReports` document the Kepala SatKer audits when a
 * sopir settles a journey. Kept structural so both the Activity Review page and
 * the Driver Journeys page can hand their own row type straight in.
 */
export interface DriverAuditReport {
  id: string;
  employeeId: string;
  employeeName: string;
  activityName: string;
  activityDate: string;
  status: string;
  payrollPeriod?: string;
  /** Links the report back to its pre-authorized `DriverJourneys` document. */
  journeyId?: string;
  timeStart?: string;
  timeEnd?: string;
  dateStart?: string;
  dateEnd?: string;
  isMultiDay?: boolean;
  distanceKm?: number;
  durationHours?: number;
  routeDurationHours?: number;
  customDurationPP?: number;
  vehicleType?: string;
  nightCount?: number;
  points?: string[];
  startPoint?: string;
  startPointLocation?: DriverJourneyLocation | null;
  endPoint?: string;
  mainDestinations?: string[];
  mainDestinationLocations?: Array<DriverJourneyLocation | null>;
  /**
   * The sopir's own stop log. Ad hoc stops keep their picked coordinates only
   * here — `mainDestinations`/`mainDestinationLocations` cover the
   * pre-authorized stops alone — so this is the only place the auditor can
   * recover exact coordinates for a stop the sopir added mid-journey.
   */
  extraActivities?: Array<Record<string, unknown>>;
  baseOperationalCost?: number;
  fuelProcurementMode?: FuelProcurementMode;
  heldFuelAmount?: number;
  procuredAccumulatedAmount?: number;
  fuelAllowanceForSettlement?: number;
  fuelTotalAllocation?: number;
  preAuthorizedMeal?: number;
  preAuthorizedToll?: number;
  fuelFee?: number;
  tollParkingFee?: number;
  extraFuelCost?: number;
  extraTollCost?: number;
  ndalemMealMoneyReceived?: number;
  fuelReceiptUrl?: string;
  tollReceiptUrl?: string;
  fuelReceiptEvidence?: PhotoEvidence[];
  tollReceiptEvidence?: PhotoEvidence[];
}

function auditReportPointLocations(
  report: DriverAuditReport,
  points: string[],
): Array<DriverJourneyLocation | null> {
  return resolveDriverJourneyPointLocations({
    points,
    startPoint: report.startPoint,
    startPointLocation: report.startPointLocation,
    mainDestinations: report.mainDestinations,
    mainDestinationLocations: report.mainDestinationLocations,
    extraActivities: report.extraActivities,
  });
}

/** Exactly the `driverReview` body accepted by `/api/pekarya/activities/review`. */
export interface DriverReviewPayload {
  distanceKm: number;
  durationHours: number;
  /** Cumulative Google Directions travel time between destinations; drives Komponen Waktu. */
  routeDurationHours: number;
  timeStart: string;
  timeEnd: string;
  dateStart: string;
  dateEnd: string;
  isMultiDay: boolean;
  actualFuelExpenditure: number;
  fuelDelta: number;
  tollDelta: number;
  mealDelta: number;
  ndalemMealMoneyReceived: number;
  vehicleType: string;
  nightCount: number;
  points: string[];
  startPointLocation: DriverJourneyLocation | null;
  mainDestinationLocations: Array<DriverJourneyLocation | null>;
}

interface DriverJourneyAuditDialogProps {
  /** Open when non-null. The audit form is editable only while status is `pending`. */
  report: DriverAuditReport | null;
  onOpenChange: (open: boolean) => void;
  actionLoading: boolean;
  onApprove: (payload: DriverReviewPayload) => void | Promise<void>;
  onDecline: () => void;
  onOpenPhoto: (image: {
    url: string;
    title: string;
    auditMetadata?: PhotoAuditMetadata | null;
  }) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VEHICLE_RATES: Record<string, number> = {
  'Bis': 2500,
  'Elf': 1350,
  'Kijang LGX': 1200,
  'Innova Hitam': 1250,
  'Innova Matic': 1450,
  'Suzuki': 1000,
  'Suzuki XL7': 1000,
  'Ndalem': 0,
};

const VEHICLE_OPTIONS = [
  'Suzuki XL7',
  'Bis',
  'Elf',
  'Kijang LGX',
  'Innova Hitam',
  'Innova Matic',
  'Ndalem',
];

const MAX_MEAL_MONEY_RECEIVED = 100_000_000;

function clampMealMoneyReceived(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_MEAL_MONEY_RECEIVED, Math.max(0, Math.trunc(value)));
}

function parseMealMoneyReceived(value: string): number {
  if (value.trim() === '') return 0;
  return clampMealMoneyReceived(Number(value));
}

function getVehicleRate(vType: string) {
  return VEHICLE_RATES[vType] ?? 1000;
}

function fmtRp(val: number): string {
  return 'Rp' + val.toLocaleString('id-ID');
}

// Prefer the geocoded lat/lng (exact) over the raw address text (ambiguous —
// Google Maps may resolve a bare place name to the wrong branch/city).
function auditPointToMapValue(loc: DriverJourneyLocation | null, address: string): string | null {
  if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
    return `${loc.latitude},${loc.longitude}`;
  }
  const trimmed = address.trim();
  return trimmed || null;
}

// Builds a Google Maps directions deep link so the auditor can visually
// replicate the exact route (origin + waypoints + destination, in order)
// with one click, instead of re-entering each stop manually.
function buildGoogleMapsRouteUrl(
  points: string[],
  locations: Array<DriverJourneyLocation | null>,
): string | null {
  const values = points
    .map((pt, idx) => auditPointToMapValue(locations[idx] ?? null, pt))
    .filter((v): v is string => Boolean(v));
  if (values.length < 2) return null;

  const origin = values[0];
  const destination = values[values.length - 1];
  const waypoints = values.slice(1, -1);

  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: 'driving',
  });
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function auditRoundTripRoutePoints(
  points: string[],
  locations: Array<DriverJourneyLocation | null>,
): string[] {
  if (points.length < 2 || points.some((point) => !point.trim())) return [];
  return closeDriverJourneyRoundTrip(points.map((point, index) => (
    driverJourneyRoutePoint(point, locations[index])
  )));
}

function auditRoundTripRouteKey(
  points: string[],
  locations: Array<DriverJourneyLocation | null>,
): string {
  const routePoints = auditRoundTripRoutePoints(points, locations);
  return routePoints.length >= 3 ? JSON.stringify(routePoints) : '';
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DriverJourneyAuditDialog({
  report,
  onOpenChange,
  actionLoading,
  onApprove,
  onDecline,
  onOpenPhoto,
}: DriverJourneyAuditDialogProps) {
  const [auditTimeStart, setAuditTimeStart] = useState('');
  const [auditTimeEnd, setAuditTimeEnd] = useState('');
  const [auditDateStart, setAuditDateStart] = useState('');
  const [auditDateEnd, setAuditDateEnd] = useState('');
  const [auditIsMultiDay, setAuditIsMultiDay] = useState(false);
  const [auditDistanceKm, setAuditDistanceKm] = useState<number>(0);
  const [auditDurationHours, setAuditDurationHours] = useState<number>(0);
  const [auditAuthorizedDurationPP, setAuditAuthorizedDurationPP] = useState<number>(0);
  const [auditFuelDelta, setAuditFuelDelta] = useState<number>(0);
  const [auditTollDelta, setAuditTollDelta] = useState<number>(0);
  const [auditMealMoneyReceivedInput, setAuditMealMoneyReceivedInput] = useState('0');
  const [auditVehicleType, setAuditVehicleType] = useState<string>('Suzuki XL7');
  const [auditNightCount, setAuditNightCount] = useState<number>(0);
  const [auditPoints, setAuditPoints] = useState<string[]>([]);
  const [auditPointLocations, setAuditPointLocations] = useState<Array<DriverJourneyLocation | null>>([]);
  // Keyed by the origin point's index in `auditPoints` — the leg leaving that
  // stop toward the next one. Only set when both stops are real (non-blank)
  // and directly adjacent, so a still-empty "Tambah Lokasi" slot never gets
  // attributed a leg that actually skipped over it.
  const [auditLegWages, setAuditLegWages] = useState<Record<number, { distanceKm: number; durationHours: number }>>({});
  // Cumulative Google Directions travel time between destinations for the
  // whole round trip. Drives Komponen Waktu. It must NOT come from summing
  // `auditLegWages`, which only keys legs that land on two directly-adjacent
  // point indices and therefore silently drops the route's final closing leg.
  const [auditRouteDurationHours, setAuditRouteDurationHours] = useState<number>(0);
  const [isManualDurationOverride, setIsManualDurationOverride] = useState<boolean>(false);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [routeCalcError, setRouteCalcError] = useState<string>('');
  const [measuredRouteKey, setMeasuredRouteKey] = useState<string>('');

  // Google Maps Location Picker Modal state
  const [showMapSelector, setShowMapSelector] = useState(false);
  const [mapSearchText, setMapSearchText] = useState('');
  const [mapAddress, setMapAddress] = useState('');
  const [mapLocation, setMapLocation] = useState<DriverJourneyLocation | null>(null);
  const [mapSearchError, setMapSearchError] = useState('');
  const [mapTargetIndex, setMapTargetIndex] = useState<number | null>(null);

  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);
  const mapElementRef = React.useRef<HTMLDivElement | null>(null);
  const mapGeocodeRequestRef = React.useRef(0);
  const routeCalculationRequestRef = React.useRef(0);
  const {
    suggestions: placeSuggestions,
    isSearching: isSearchingPlaces,
    searchError: placeSearchError,
    search: searchPlaces,
    cancelSearch: cancelPlaceSearch,
  } = useCostSafePlaceAutocomplete({ loadGoogleMapsScript });

  // A confirmed journey may be reopened for edits only while its payroll
  // period is still accepting input. `null` means "checking" so the form
  // stays locked until we actually know, rather than briefly flashing editable.
  const [periodOpen, setPeriodOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (!report || report.status !== 'approved') {
      setPeriodOpen(null);
      return;
    }
    let cancelled = false;
    const period =
      report.payrollPeriod ||
      pekaryaPayrollPeriodForDate(report.dateStart || report.activityDate);
    setPeriodOpen(null);
    getDoc(doc(db, 'PayrollPeriods', period))
      .then((snapshot) => {
        if (cancelled) return;
        setPeriodOpen(snapshot.data()?.attendanceStatus !== 'closed');
      })
      .catch(() => {
        if (!cancelled) setPeriodOpen(false);
      });
    return () => {
      cancelled = true;
    };
  }, [report?.id, report?.status, report?.payrollPeriod, report?.dateStart, report?.activityDate]);

  // Hold/procure-release fuel accumulation settles against a shared vehicle
  // balance the instant it is first approved (see the "Mode terkunci setelah
  // klaim" badge below); only standard-direct cash reimbursement can be
  // safely recomputed after the fact.
  const isFuelLockedForReEdit =
    isFuelProcurementMode(report?.fuelProcurementMode) &&
    report?.fuelProcurementMode !== DEFAULT_FUEL_PROCUREMENT_MODE;
  const canReEditConfirmed =
    report?.status === 'approved' && periodOpen === true && !isFuelLockedForReEdit;
  const isEditable = report?.status === 'pending' || canReEditConfirmed;
  const canDecline = report?.status === 'pending';

  // Seed the form once per opened report, during render rather than in an
  // effect so the first paint already shows the submitted figures. Keying on
  // the id rather than the object keeps live Firestore snapshots from wiping an
  // audit that is already in progress.
  const [seededReportId, setSeededReportId] = useState<string | null>(null);
  if (!report && seededReportId !== null) {
    // Closing discards the draft so reopening the same report starts from the
    // sopir's submitted figures again rather than the abandoned edits.
    setSeededReportId(null);
  }
  if (report && report.id !== seededReportId) {
    setSeededReportId(report.id);
    const distKm = report.distanceKm || 0;
    const durHrs = report.durationHours || 0;
    const authDurPP =
      report.customDurationPP !== undefined &&
      report.customDurationPP !== null &&
      report.customDurationPP > 0
        ? report.customDurationPP
        : durHrs;
    const vType = report.vehicleType || 'Suzuki XL7';
    const dateStart = report.dateStart || report.activityDate;
    const dateEnd = report.dateEnd || dateStart;
    const initialTimeline = calculateEditableDriverJourneyTimeline({
      dateStart,
      dateEnd,
      timeStart: report.timeStart || '',
      timeEnd: report.timeEnd || '',
      isMultiDay: report.isMultiDay === true,
    });
    setAuditTimeStart(report.timeStart || '');
    setAuditTimeEnd(report.timeEnd || '');
    setAuditDateStart(initialTimeline.dateStart);
    setAuditDateEnd(initialTimeline.dateEnd);
    setAuditIsMultiDay(initialTimeline.isMultiDay);
    const seededElapsedHours = initialTimeline.durationHours > 0 ? initialTimeline.durationHours : durHrs;
    setAuditDistanceKm(distKm);
    setAuditDurationHours(seededElapsedHours);
    setAuditRouteDurationHours(
      report.routeDurationHours && report.routeDurationHours > 0
        ? report.routeDurationHours
        : seededElapsedHours,
    );
    setAuditAuthorizedDurationPP(authDurPP);
    setAuditVehicleType(vType);
    setAuditNightCount(
      initialTimeline.durationHours > 0 ? initialTimeline.nightCount : (report.nightCount || 0),
    );

    const pts =
      report.points && report.points.length > 0
        ? report.points
        : [report.startPoint || 'UNIPDU Jombang, Jawa Timur', report.endPoint || ''];
    setAuditPoints(pts);
    setAuditPointLocations(auditReportPointLocations(report, pts));
    setIsManualDurationOverride(false);
    setIsCalculatingRoute(false);
    setMeasuredRouteKey('');
    setRouteCalcError('');

    const rate = getVehicleRate(vType);
    const fuelMode = isFuelProcurementMode(report.fuelProcurementMode)
      ? report.fuelProcurementMode
      : DEFAULT_FUEL_PROCUREMENT_MODE;
    const procuredAmount = fuelMode === 'procure_release'
      ? Math.max(0, Number(report.procuredAccumulatedAmount || 0))
      : 0;
    const baseFuel =
      report.baseOperationalCost !== undefined && report.baseOperationalCost !== null
        ? report.baseOperationalCost
        : Math.ceil(distKm * rate);
    const effectiveFuel = fuelMode === 'hold_accumulate' ? 0 : baseFuel + procuredAmount;

    const preToll = report.preAuthorizedToll ?? 0;
    // Keep these deltas signed: allowance savings must remain visible so they
    // can offset overage in the other operational category during approval.
    const fuelDelta =
      report.fuelFee !== undefined && report.fuelFee !== null
        ? (fuelMode === 'hold_accumulate' || vType === 'Ndalem' ? 0 : Number(report.fuelFee) - effectiveFuel)
        : (report.extraFuelCost ?? 0);
    const tollDelta =
      report.tollParkingFee !== undefined && report.tollParkingFee !== null
        ? Number(report.tollParkingFee) - preToll
        : (report.extraTollCost ?? 0);

    setAuditFuelDelta(fuelDelta);
    setAuditTollDelta(tollDelta);
    setAuditMealMoneyReceivedInput(
      String(clampMealMoneyReceived(report.ndalemMealMoneyReceived ?? 0)),
    );
    setAuditLegWages({});
  }

  // Measure every editable audit as a real round trip as soon as it opens. A
  // locked historical approval is measured only for its leg breakdown; its
  // stored payroll value is never restated merely by viewing it.
  useEffect(() => {
    if (!report) return;
    const pts =
      report.points && report.points.length > 0
        ? report.points
        : [report.startPoint || 'UNIPDU Jombang, Jawa Timur', report.endPoint || ''];
    const reportPointLocations = auditReportPointLocations(report, pts);
    void recalculateRouteFromPoints(pts, {
      updateTotals: isEditable,
      pointLocations: reportPointLocations,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id, isEditable]);

  const resetMapSearch = () => {
    cancelPlaceSearch();
    mapGeocodeRequestRef.current += 1;
    setMapSearchError('');
  };

  const geocodeMapSearch = (queryText: string) => {
    const normalizedQuery = queryText.trim();
    if (!normalizedQuery) return;
    const requestId = ++mapGeocodeRequestRef.current;
    cancelPlaceSearch();
    setMapSearchError('');

    loadGoogleMapsScript(() => {
      const google = (window as any).google;
      if (!google?.maps?.Geocoder) {
        if (requestId === mapGeocodeRequestRef.current) {
          setMapSearchError('Layanan peta belum siap. Silakan coba lagi.');
        }
        return;
      }

      try {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode(
          { address: normalizedQuery, region: 'id' },
          (results: any[], status: string) => {
            if (requestId !== mapGeocodeRequestRef.current) return;
            const firstResult = Array.isArray(results)
              ? results.find((result: any) => result?.geometry?.location)
              : null;
            if (status !== 'OK' || !firstResult) {
              setMapAddress('');
              setMapLocation(null);
              setMapSearchError('Lokasi tidak ditemukan. Pilih hasil lain atau geser pin di peta.');
              return;
            }

            const location = firstResult.geometry.location;
            const address = firstResult.formatted_address || normalizedQuery;
            mapRef.current?.setCenter(location);
            mapRef.current?.setZoom(16);
            markerRef.current?.setPosition(location);
            setMapAddress(address);
            setMapSearchText(address);
            setMapLocation({
              address,
              latitude: typeof location.lat === 'function' ? location.lat() : Number(location.lat),
              longitude: typeof location.lng === 'function' ? location.lng() : Number(location.lng),
            });
          },
        );
      } catch (error) {
        console.warn('Google address search failed:', error);
        if (requestId === mapGeocodeRequestRef.current) {
          setMapAddress('');
          setMapLocation(null);
          setMapSearchError('Lokasi tidak dapat dicari. Silakan coba kata kunci lain.');
        }
      }
    });
  };

  const handleMapSearchChange = (value: string) => {
    setMapSearchText(value);
    setMapAddress('');
    setMapLocation(null);
    setMapSearchError('');
    searchPlaces(value);
  };

  const handlePlaceSuggestionSelect = (suggestion: CostSafePlaceSuggestion) => {
    cancelPlaceSearch();
    setMapSearchText(suggestion.queryText);
    geocodeMapSearch(suggestion.queryText);
  };

  const handleMapSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      cancelPlaceSearch();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (placeSuggestions[0]) {
      handlePlaceSuggestionSelect(placeSuggestions[0]);
      return;
    }
    setMapSearchError(
      mapSearchText.trim().length < PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH
        ? `Ketik minimal ${PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH} karakter untuk mencari lokasi.`
        : 'Pilih salah satu saran lokasi sebelum melanjutkan.',
    );
  };

  const focusMapOnLocation = React.useCallback((location: DriverJourneyLocation | null) => {
    if (!location || !mapRef.current || !markerRef.current) return false;
    const position = { lat: location.latitude, lng: location.longitude };
    mapRef.current.setCenter(position);
    mapRef.current.setZoom(15);
    markerRef.current.setPosition(position);
    return true;
  }, []);

  const initMap = (element: HTMLDivElement) => {
    loadGoogleMapsScript(() => {
      const google = (window as any).google;
      if (!google) return;
      if (mapRef.current && mapElementRef.current === element) {
        const existingLocation = normalizeDriverJourneyLocation(mapLocation, mapAddress);
        if (existingLocation) {
          focusMapOnLocation(existingLocation);
        }
        return;
      }
      mapElementRef.current = element;

      const unipduCoords = {
        lat: DEFAULT_DRIVER_JOURNEY_LOCATION.latitude,
        lng: DEFAULT_DRIVER_JOURNEY_LOCATION.longitude,
      };
      const map = new google.maps.Map(element, {
        center: unipduCoords,
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      mapRef.current = map;
      const marker = new google.maps.Marker({
        position: unipduCoords,
        map,
        draggable: true,
        animation: google.maps.Animation.DROP,
      });
      markerRef.current = marker;
      const geocoder = new google.maps.Geocoder();

      const updateAddress = (latLng: any) => {
        cancelPlaceSearch();
        mapGeocodeRequestRef.current += 1;
        setMapSearchError('');
        geocoder.geocode({ location: latLng }, (results: any, status: any) => {
          const latitude = typeof latLng.lat === 'function' ? latLng.lat() : Number(latLng.lat);
          const longitude = typeof latLng.lng === 'function' ? latLng.lng() : Number(latLng.lng);
          const address = status === 'OK' && results?.[0]?.formatted_address
            ? results[0].formatted_address
            : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
          setMapAddress(address);
          setMapSearchText(address);
          setMapLocation({ address, latitude, longitude });
        });
      };

      const existingAddress = mapAddress;
      const existingLocation = normalizeDriverJourneyLocation(mapLocation, existingAddress);
      if (existingLocation) {
        const position = { lat: existingLocation.latitude, lng: existingLocation.longitude };
        map.setCenter(position);
        map.setZoom(15);
        marker.setPosition(position);
        setMapLocation(existingLocation);
      } else if (existingAddress) {
        // Compatibility path for reports created before coordinates were stored.
        geocoder.geocode({ address: existingAddress, region: 'id' }, (results: any, status: any) => {
          if (status === 'OK' && results?.[0]?.geometry?.location) {
            const location = results[0].geometry.location;
            const address = results[0].formatted_address || existingAddress;
            map.setCenter(location);
            map.setZoom(15);
            marker.setPosition(location);
            setMapAddress(address);
            setMapSearchText(address);
            setMapLocation({
              address,
              latitude: typeof location.lat === 'function' ? location.lat() : Number(location.lat),
              longitude: typeof location.lng === 'function' ? location.lng() : Number(location.lng),
            });
          } else {
            setMapSearchError('Alamat lama tidak dapat dipetakan. Cari lokasi atau geser pin.');
          }
        });
      } else {
        setMapAddress('');
        setMapLocation(null);
      }

      marker.addListener('dragend', () => {
        const position = marker.getPosition();
        if (position) updateAddress(position);
      });
      map.addListener('click', (event: any) => {
        if (event.latLng) {
          marker.setPosition(event.latLng);
          updateAddress(event.latLng);
        }
      });
    });
  };

  // The dialog content can reuse the same map element between different
  // "Ubah" clicks. Keep the marker and viewport tied to the newly selected
  // destination instead of leaving the previous point displayed.
  useEffect(() => {
    if (!showMapSelector || !mapLocation) return;
    focusMapOnLocation(mapLocation);
  }, [showMapSelector, mapLocation, focusMapOnLocation]);

  const handleOpenMapForIndex = (index: number) => {
    resetMapSearch();
    setMapTargetIndex(index);
    const currentVal = auditPoints[index] || '';
    const currentLocation = normalizeDriverJourneyLocation(
      auditPointLocations[index],
      currentVal,
    );
    setMapAddress(currentVal);
    setMapSearchText(currentVal);
    setMapLocation(currentLocation);
    setShowMapSelector(true);
    if (!currentLocation && currentVal.trim() && mapRef.current) {
      // Older reports may have an address but no saved coordinates. If the map
      // already exists, geocode that address now; a fresh map is handled by
      // initMap's compatibility path above.
      geocodeMapSearch(currentVal);
    }
  };

  /**
   * Recomputes the route across `pointsToCalc` through the same
   * `/api/calculate-route` endpoint the sopir's own journey report submission
   * uses, instead of querying the browser Directions SDK directly. Re-auditing
   * an unedited route now reproduces the stored figure exactly rather than
   * merely agreeing with it, since both sides are one measurement, not two
   * that happen to use the same formula.
   *
   * The request closes the loop back to the departure point instead of
   * doubling the one-way total. Doubling only holds for a simple A→B journey;
   * on a multi-stop route the stored points already list every destination in
   * order, so doubling counts each intermediate leg twice and inflates the
   * distance component of the wage. Closing the loop mirrors how the sopir's
   * own journey report totals the route ([start, ...stops, start]).
   *
   * `updateTotals` is false only for a locked historical approval. Every
   * editable audit replaces its wage distance with this measured total.
   */
  async function recalculateRouteFromPoints(
    pointsToCalc: string[],
    {
      updateTotals = true,
      pointLocations = auditPointLocations,
    }: {
      updateTotals?: boolean;
      pointLocations?: Array<DriverJourneyLocation | null>;
    } = {},
  ): Promise<boolean> {
    const requestId = ++routeCalculationRequestRef.current;
    if (pointsToCalc.length > MAX_DRIVER_JOURNEY_LOCATIONS) {
      if (updateTotals) setMeasuredRouteKey('');
      setRouteCalcError(`Maksimal ${MAX_DRIVER_JOURNEY_DESTINATIONS} titik tujuan dapat dihitung.`);
      return false;
    }
    const validIndices = pointsToCalc
      .map((p, i) => (p && p.trim().length > 0 ? i : -1))
      .filter((i) => i !== -1);
    const routePts = auditRoundTripRoutePoints(pointsToCalc, pointLocations);
    if (validIndices.length !== pointsToCalc.length || routePts.length < 3) {
      if (updateTotals) setMeasuredRouteKey('');
      setRouteCalcError('Lengkapi titik awal dan seluruh tujuan sebelum mengukur rute.');
      return false;
    }
    const routeKey = JSON.stringify(routePts);

    setIsCalculatingRoute(true);
    setRouteCalcError('');
    if (updateTotals) setMeasuredRouteKey('');
    try {
      const resData = await authenticatedJson<{
        success: boolean;
        distanceKm: number;
        durationHours: number;
        legs: Array<{ distanceKm: number; durationHours: number }>;
      }>('/api/calculate-route', {
        method: 'POST',
        body: JSON.stringify({ points: routePts }),
      });
      if (requestId !== routeCalculationRequestRef.current) return false;
      if (
        !(resData.distanceKm > 0) ||
        !Number.isFinite(resData.durationHours) ||
        resData.durationHours < 0
      ) {
        throw new Error('Google Maps tidak mengembalikan jarak dan waktu tempuh yang valid.');
      }

      const legWages: Record<number, { distanceKm: number; durationHours: number }> = {};
      (resData.legs || []).forEach((leg, legIdx) => {
        // Display-only, and intentionally skips legs that don't land on two
        // directly-adjacent point indices — a blank "Tambah Lokasi" slot
        // widens a leg across a gap in `pointsToCalc` — so this must never be
        // summed to get a route total; `resData.distanceKm`/`durationHours`
        // below already cover every leg, including the closing one home.
        const originIdx = validIndices[legIdx];
        const nextIdx = validIndices[legIdx + 1];
        if (nextIdx === originIdx + 1) {
          legWages[originIdx] = {
            distanceKm: leg.distanceKm || 0,
            durationHours: leg.durationHours || 0,
          };
        }
      });
      setAuditLegWages(legWages);

      if (updateTotals && resData.distanceKm > 0) {
        setAuditDistanceKm(resData.distanceKm);
        setAuditRouteDurationHours(resData.durationHours);
        setMeasuredRouteKey(routeKey);
      }
      return true;
    } catch (err) {
      if (requestId !== routeCalculationRequestRef.current) return false;
      console.error('Error in recalculateRouteFromPoints:', err);
      setRouteCalcError(err instanceof Error ? err.message : 'Gagal menghitung ulang rute.');
      if (updateTotals) setMeasuredRouteKey('');
      return false;
    } finally {
      if (requestId === routeCalculationRequestRef.current) {
        setIsCalculatingRoute(false);
      }
    }
  }

  const currentRouteKey = auditRoundTripRouteKey(auditPoints, auditPointLocations);
  const hasMeasuredCurrentRoute = Boolean(
    currentRouteKey && measuredRouteKey === currentRouteKey,
  );

  const handleConfirmMapLocation = () => {
    if (mapTargetIndex === null || !mapAddress || !mapLocation) return;
    const newPts = [...auditPoints];
    const newLocations = [...auditPointLocations];
    newPts[mapTargetIndex] = mapAddress.trim();
    newLocations[mapTargetIndex] = mapLocation;
    setAuditPoints(newPts);
    setAuditPointLocations(newLocations);
    resetMapSearch();
    setShowMapSelector(false);
    setMapTargetIndex(null);
    recalculateRouteFromPoints(newPts, { pointLocations: newLocations });
  };

  const handleAuditTimeChange = (field: 'start' | 'end', value: string) => {
    const nextTimeStart = field === 'start' ? value : auditTimeStart;
    const nextTimeEnd = field === 'end' ? value : auditTimeEnd;
    if (!report) return;

    if (field === 'start') setAuditTimeStart(value);
    else setAuditTimeEnd(value);

    const timeline = calculateEditableDriverJourneyTimeline({
      dateStart: auditDateStart || report.dateStart || report.activityDate,
      dateEnd: auditDateEnd || report.dateEnd || report.activityDate,
      timeStart: nextTimeStart,
      timeEnd: nextTimeEnd,
      isMultiDay: auditIsMultiDay,
    });

    setAuditDateEnd(timeline.dateEnd);
    setAuditIsMultiDay(timeline.isMultiDay);
    setAuditNightCount(timeline.nightCount);
    if (timeline.durationHours > 0) {
      setAuditDurationHours(timeline.durationHours);
      setAuditAuthorizedDurationPP(timeline.durationHours);
    }
  };

  const handleAuditDateChange = (field: 'start' | 'end', value: string) => {
    if (!report || !value) return;
    const nextDateStart = field === 'start' ? value : auditDateStart;
    const nextDateEnd = field === 'end' ? value : auditDateEnd;

    if (field === 'start') setAuditDateStart(value);

    // dateEnd is always re-derived from the timeline: it clamps back to
    // dateStart if the new start moved past it, and infers the next day when
    // dates read as same-day but the times still wrap past midnight.
    const timeline = calculateEditableDriverJourneyTimeline({
      dateStart: nextDateStart,
      dateEnd: nextDateEnd,
      timeStart: auditTimeStart,
      timeEnd: auditTimeEnd,
      isMultiDay: auditIsMultiDay,
    });

    setAuditDateEnd(timeline.dateEnd);
    setAuditIsMultiDay(timeline.isMultiDay);
    setAuditNightCount(timeline.nightCount);
    if (timeline.durationHours > 0) {
      setAuditDurationHours(timeline.durationHours);
      setAuditAuthorizedDurationPP(timeline.durationHours);
    }
  };

  const auditTimeline = useMemo(() => {
    if (!report) return null;
    return calculateEditableDriverJourneyTimeline({
      dateStart: auditDateStart || report.dateStart || report.activityDate,
      dateEnd: auditDateEnd || report.dateEnd || report.activityDate,
      timeStart: auditTimeStart,
      timeEnd: auditTimeEnd,
      isMultiDay: auditIsMultiDay,
    });
  }, [report, auditDateStart, auditDateEnd, auditIsMultiDay, auditTimeStart, auditTimeEnd]);

  const auditCalc = useMemo(() => {
    if (!report || !auditTimeline) return null;
    const rate = getVehicleRate(auditVehicleType);

    const originalDateStart = report.dateStart || report.activityDate;
    const originalDateEnd = report.dateEnd || originalDateStart;
    const originalIsMultiDay = report.isMultiDay === true || originalDateEnd > originalDateStart;
    const timelineChanged =
      auditTimeStart !== report.timeStart ||
      auditTimeEnd !== report.timeEnd ||
      auditDateStart !== originalDateStart ||
      auditDateEnd !== originalDateEnd ||
      auditIsMultiDay !== originalIsMultiDay;

    // Base BBM
    const fuelProcurementMode: FuelProcurementMode = isFuelProcurementMode(report.fuelProcurementMode)
      ? report.fuelProcurementMode
      : DEFAULT_FUEL_PROCUREMENT_MODE;
    const procuredAccumulatedAmount = fuelProcurementMode === 'procure_release'
      ? Math.max(0, Number(report.procuredAccumulatedAmount || 0))
      : 0;
    const baselineBBM =
      auditVehicleType !== report.vehicleType && auditVehicleType !== 'Ndalem'
        ? Math.ceil(auditDistanceKm * rate)
        : report.baseOperationalCost !== undefined && report.baseOperationalCost !== null
        ? report.baseOperationalCost
        : Math.ceil(auditDistanceKm * rate);
    const effectiveFuelAllowance = fuelProcurementMode === 'hold_accumulate'
      ? 0
      : baselineBBM + procuredAccumulatedAmount;
    const heldFuelAmount = fuelProcurementMode === 'hold_accumulate' ? baselineBBM : 0;

    let actualJourneyDurationHours = 0;
    try {
      actualJourneyDurationHours = calculateJourneyElapsedHours(
        auditTimeStart,
        auditTimeEnd,
        auditNightCount,
      );
    } catch {
      actualJourneyDurationHours = 0;
    }

    // Once the auditor edits the submitted times, the edited duration becomes
    // the new meal-allowance authorization baseline.
    const authDurForMeal = timelineChanged && actualJourneyDurationHours > 0
      ? actualJourneyDurationHours
      : auditAuthorizedDurationPP || auditDurationHours;
    const savedPreAuthorizedMeal = report.preAuthorizedMeal;
    const baselineMeal = auditVehicleType === 'Ndalem'
      ? 0
      : (!timelineChanged && savedPreAuthorizedMeal !== undefined && savedPreAuthorizedMeal !== null && savedPreAuthorizedMeal > 0
        ? savedPreAuthorizedMeal
        : getMealAllowanceForDuration(authDurForMeal, auditVehicleType));

    const baselineToll = report.preAuthorizedToll ?? 0;
    // Held fuel is committed to the vehicle ledger after approval; it is not
    // cash operational money and must not enter reimbursement or wage math.
    const totalBaseline = effectiveFuelAllowance + baselineMeal + baselineToll;

    const deltaFuel = fuelProcurementMode === 'hold_accumulate' || auditVehicleType === 'Ndalem'
      ? 0
      : auditFuelDelta;
    const deltaToll = auditTollDelta;
    const mealMoneyReceived = parseMealMoneyReceived(auditMealMoneyReceivedInput);
    // Full meal entitlement for the audited duration, before the money
    // already given to the driver is subtracted — shown next to the input
    // so the auditor has the same "Hak Nx Makan" context the sopir saw.
    const totalMealEntitlement = getMealAllowanceForDuration(
      actualJourneyDurationHours,
      auditVehicleType,
    );
    const actualMeal = getMealAllowanceForDuration(
      actualJourneyDurationHours,
      auditVehicleType,
      mealMoneyReceived,
    );
    const deltaMeal = auditVehicleType === 'Ndalem'
      ? actualMeal
      : Math.max(0, actualMeal - baselineMeal);
    const extraOps = 0; // Mileage distance is compensated via componentJarak in upahBersih, not cash reimbursement

    const wageDurationHours = timelineChanged && actualJourneyDurationHours > 0
      ? actualJourneyDurationHours
      : auditDurationHours;
    const componentJarak = Math.ceil(auditDistanceKm * 300);
    const componentWaktu = Math.ceil(auditRouteDurationHours * 5000);
    const premiumWeekend = 0;
    const nightPremium = calculateNightPremium(auditNightCount);
    const baseDriverWage = calculateDriverNetWage({
      distanceKm: auditDistanceKm,
      travelTimeHours: auditRouteDurationHours,
      elapsedDurationHours: wageDurationHours,
      nightCount: auditNightCount,
    });

    const actualFuel = fuelProcurementMode === 'hold_accumulate' || auditVehicleType === 'Ndalem'
      ? 0
      : Math.max(0, effectiveFuelAllowance + deltaFuel);
    const actualToll = Math.max(0, baselineToll + deltaToll);
    const settlement = calculateDriverReimbursementSettlement({
      fuelAllowance: auditVehicleType === 'Ndalem' ? 0 : baselineBBM,
      fuelSpent: actualFuel,
      tollAllowance: baselineToll,
      tollSpent: actualToll,
      additionalReimbursement: deltaMeal + extraOps,
      fuelProcurementMode: auditVehicleType === 'Ndalem'
        ? DEFAULT_FUEL_PROCUREMENT_MODE
        : fuelProcurementMode,
      procuredAccumulatedAmount,
    });
    const totalReimburseDelta = settlement.reimburseDelta;
    const upahBersih = Math.max(0, baseDriverWage - settlement.remainingUnspentCash);

    // The report may already contain the driver's submitted actuals. The
    // audit total must start from the original allowance, then apply the
    // signed audit deltas exactly once.
    const initialTotalOps = totalBaseline;
    const operationalCost = Math.max(
      0,
      Math.ceil(initialTotalOps + settlement.netOperationalDelta + deltaMeal + extraOps),
    );

    return {
      rate,
      baselineBBM,
      fuelProcurementMode,
      effectiveFuelAllowance,
      heldFuelAmount,
      procuredAccumulatedAmount,
      totalFuelAllocation: effectiveFuelAllowance,
      baselineMeal,
      baselineToll,
      totalBaseline,
      actualFuel,
      actualMeal,
      totalMealEntitlement,
      actualJourneyDurationHours,
      actualToll,
      deltaFuel,
      deltaToll,
      deltaMeal,
      extraOps,
      positiveDelta: settlement.positiveReimburseDelta,
      totalReimburseDelta,
      remainingUnspentCash: settlement.remainingUnspentCash,
      netOperationalDelta: settlement.netOperationalDelta,
      componentJarak,
      componentWaktu,
      premiumWeekend,
      nightPremium,
      upahBersih,
      durationHours: wageDurationHours,
      routeDurationHours: auditRouteDurationHours,
      timelineChanged,
      operationalCost,
    };
  }, [
    report,
    auditTimeline,
    auditDateStart,
    auditDateEnd,
    auditIsMultiDay,
    auditTimeStart,
    auditTimeEnd,
    auditDistanceKm,
    auditDurationHours,
    auditRouteDurationHours,
    auditFuelDelta,
    auditTollDelta,
    auditMealMoneyReceivedInput,
    auditVehicleType,
    auditNightCount,
    auditAuthorizedDurationPP,
  ]);

  const handleApprove = () => {
    if (!auditCalc || !hasMeasuredCurrentRoute || isCalculatingRoute) return;
    onApprove({
      distanceKm: auditDistanceKm,
      durationHours: auditCalc.durationHours,
      routeDurationHours: auditCalc.routeDurationHours,
      timeStart: auditTimeStart,
      timeEnd: auditTimeEnd,
      dateStart: auditDateStart,
      dateEnd: auditDateEnd,
      isMultiDay: auditIsMultiDay,
      actualFuelExpenditure: auditCalc.actualFuel,
      fuelDelta: auditFuelDelta,
      tollDelta: auditTollDelta,
      mealDelta: auditCalc.deltaMeal,
      ndalemMealMoneyReceived: parseMealMoneyReceived(auditMealMoneyReceivedInput),
      vehicleType: auditVehicleType,
      nightCount: auditNightCount,
      points: auditPoints,
      startPointLocation: normalizeDriverJourneyLocation(auditPointLocations[0], auditPoints[0]),
      // Positional, so the array always stays exactly `points.length - 1` long.
      // `normalizeDriverJourneyLocations` caps at MAX_MAIN_DESTINATIONS, which
      // made the server's matching length check unsatisfiable — and therefore
      // any route past that cap unapprovable.
      mainDestinationLocations: auditPoints.slice(1).map((address, index) => (
        normalizeDriverJourneyLocation(auditPointLocations[index + 1], address)
      )),
    });
  };

  const mapsRouteUrl = buildGoogleMapsRouteUrl(auditPoints, auditPointLocations);

  return (
    <>
      <Dialog open={report !== null} onOpenChange={onOpenChange}>
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] h-[92vh] max-h-[92vh] rounded-[28px] border-none shadow-2xl bg-white p-5 sm:p-7 flex flex-col justify-between overflow-hidden">
          <DialogHeader className="pb-2.5 border-b border-slate-100 shrink-0">
            <DialogTitle className="text-xl font-extrabold flex items-center gap-2.5 text-slate-800">
              <Compass className="w-6 h-6 text-indigo-500 shrink-0" />
              <span>
                {report?.status === 'pending'
                  ? 'Audit & Edit Perjalanan Sopir'
                  : canReEditConfirmed
                    ? 'Edit Perjalanan Sopir (Terkonfirmasi)'
                    : 'Detail Audit Perjalanan Sopir'}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Verifikasi rute, BBM, uang makan, dan hitung delta serta upah bersih sopir.
            </DialogDescription>
          </DialogHeader>

          {report?.status === 'approved' && (
            <div
              className={`shrink-0 mt-2.5 rounded-xl px-3.5 py-2 text-[11px] font-bold ${
                canReEditConfirmed
                  ? 'bg-amber-50 border border-amber-200 text-amber-800'
                  : 'bg-slate-100 border border-slate-200 text-slate-500'
              }`}
            >
              {canReEditConfirmed
                ? 'Perjalanan ini sudah dikonfirmasi. Periode payroll masih terbuka, sehingga masih bisa diedit dan disimpan ulang.'
                : isFuelLockedForReEdit
                  ? 'Perjalanan ini memakai akumulasi BBM yang sudah final saat diklaim; gunakan proses koreksi resmi untuk mengubahnya.'
                  : periodOpen === false
                    ? 'Periode payroll perjalanan ini sudah ditutup; data terkunci dan tidak dapat diedit lagi.'
                    : 'Memeriksa status periode payroll…'}
            </div>
          )}

          {report && auditCalc && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0 py-2 overflow-y-auto lg:overflow-hidden">
              {/* LEFT HALF: Card 1 (Journey Overview) & Card 2 (Parameter Audit) */}
              <div className="flex flex-col gap-4 overflow-y-auto pr-1">
                {/* CARD 1: Journey Overview Card */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-3 text-xs text-slate-600 shadow-xs">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Ringkasan Perjalanan</span>

                  <div className="grid grid-cols-2 gap-3 bg-white p-3 rounded-xl border border-slate-100">
                    <div>
                      <span className="font-semibold text-slate-400 text-[11px] block">Nama Sopir:</span>
                      <span className="font-extrabold text-slate-800 text-sm">{report.employeeName}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-400 text-[11px] block">Keperluan:</span>
                      <span className="font-extrabold text-slate-700">{report.activityName.split(' (')[0]}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 text-[10px] font-bold text-indigo-900">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>Mode BBM: <strong>{auditCalc.fuelProcurementMode === 'hold_accumulate' ? 'Tahan & akumulasi' : auditCalc.fuelProcurementMode === 'procure_release' ? 'Cairkan saldo' : 'Standard langsung'}</strong></span>
                      <Badge variant="outline" className="border-indigo-200 bg-white text-indigo-700 text-[9px]">Mode terkunci setelah klaim</Badge>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-slate-600">
                      <span>Hold perjalanan: <strong className="text-amber-700">{fmtRp(auditCalc.heldFuelAmount)}</strong></span>
                      <span>Akumulasi dikunci: <strong className="text-orange-700">{fmtRp(auditCalc.procuredAccumulatedAmount)}</strong></span>
                    </div>
                    {auditCalc.fuelProcurementMode === 'hold_accumulate' && <p className="mt-1 text-emerald-800">Saat disetujui, Hold berpindah ke Akumulasi tanpa kas atau kuitansi BBM.</p>}
                    {auditCalc.fuelProcurementMode === 'procure_release' && (
                      <p className="mt-1 text-orange-800">
                        Jatah gabungan {fmtRp(auditCalc.effectiveFuelAllowance)}; pembelian aktual yang akan menambah Tersedia {fmtRp(auditCalc.actualFuel)}.
                      </p>
                    )}
                    {auditCalc.fuelProcurementMode === 'procure_release' && auditVehicleType !== report.vehicleType && <p className="mt-1 text-indigo-800">Penggantian kendaraan akan menghitung ulang Akumulasi kendaraan pengganti di server.</p>}
                  </div>

                  {/* RUTE PERJALANAN TIMELINE EDITOR */}
                  <div className="space-y-3 pt-1.5 border-t border-slate-200/60">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-400 text-[10px] uppercase tracking-wider flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-indigo-500" />
                        Rute Perjalanan ({auditPoints.length} Lokasi)
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {mapsRouteUrl && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(mapsRouteUrl, '_blank', 'noopener,noreferrer')}
                            className="h-6 px-2 text-[9px] font-bold border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-md cursor-pointer whitespace-nowrap"
                          >
                            <ExternalLink className="w-3 h-3 mr-1" />
                            Buka di Google Maps
                          </Button>
                        )}
                        {isEditable && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={auditPoints.length >= MAX_DRIVER_JOURNEY_LOCATIONS}
                              title={
                                auditPoints.length >= MAX_DRIVER_JOURNEY_LOCATIONS
                                  ? `Maksimal ${MAX_DRIVER_JOURNEY_DESTINATIONS} titik tujuan`
                                  : undefined
                              }
                              onClick={() => {
                                const newPts = [...auditPoints, ''];
                                routeCalculationRequestRef.current += 1;
                                setIsCalculatingRoute(false);
                                setMeasuredRouteKey('');
                                setRouteCalcError('Pilih lokasi baru agar rute pulang-pergi dapat diukur ulang.');
                                setAuditPoints(newPts);
                                setAuditPointLocations([...auditPointLocations, null]);
                                handleOpenMapForIndex(newPts.length - 1);
                              }}
                              className="h-6 px-2 text-[9px] font-bold border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-md cursor-pointer whitespace-nowrap"
                            >
                              <Plus className="w-3 h-3 mr-0.5" />
                              Tambah Lokasi
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isCalculatingRoute || actionLoading}
                              onClick={() => recalculateRouteFromPoints(auditPoints)}
                              className="h-6 px-2 text-[9px] font-bold text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100 rounded-md cursor-pointer whitespace-nowrap"
                            >
                              {isCalculatingRoute ? (
                                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                              ) : (
                                <RefreshCw className="w-3 h-3 mr-1" />
                              )}
                              Hitung Ulang
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {routeCalcError && (
                      <p className="text-[10px] font-bold text-rose-600">{routeCalcError}</p>
                    )}
                    {isEditable && isCalculatingRoute && (
                      <p className="text-[10px] font-bold text-indigo-600">
                        Mengukur jarak pulang-pergi aktual untuk Upah Bersih…
                      </p>
                    )}

                    <div className="relative pl-6 space-y-3.5 max-h-[220px] overflow-y-auto pr-1">
                      <div className="absolute left-[9px] top-2 bottom-2 w-0.5 border-l-2 border-dashed border-indigo-200" />

                      {auditPoints.map((pt, idx) => {
                        const isFixedNode = idx <= 1;
                        const label = idx === 0 ? 'Titik Keberangkatan' : idx === 1 ? 'Tujuan Utama' : `Tujuan Tambahan #${idx - 1}`;
                        const emoji = idx === 0 ? '🏫' : idx === 1 ? '🎯' : '📍';
                        return (
                          <div key={idx} className="relative flex items-start justify-between gap-2.5 text-xs">
                            <div className={`absolute -left-[20px] top-1 w-3 h-3 rounded-full border-2 border-white shadow-sm ${isFixedNode ? 'bg-indigo-600' : 'bg-teal-500'}`} />
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <span className={`text-[9px] font-black block ${isFixedNode ? 'text-indigo-700' : 'text-teal-700'}`}>
                                {label}
                              </span>
                              {pt ? (
                                <div className="font-extrabold text-black truncate" title={pt}>
                                  {emoji} {pt.split(',')[0]}
                                </div>
                              ) : (
                                <div className="text-xs font-bold text-slate-400 italic">
                                  Belum memilih lokasi
                                </div>
                              )}
                              {auditLegWages[idx] && (
                                <div className="text-[9px] text-slate-500 font-bold">
                                  Jarak Leg: <span className="text-emerald-700 font-extrabold">{auditLegWages[idx].distanceKm.toFixed(1)} km</span>
                                  {' '}(Upah Bersih: <span className="text-emerald-600 font-extrabold">
                                    {fmtRp(Math.ceil(auditLegWages[idx].distanceKm * 300 + auditLegWages[idx].durationHours * 5000))}
                                  </span>)
                                </div>
                              )}
                            </div>
                            {isEditable && (
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenMapForIndex(idx)}
                                  className="h-7 px-2.5 text-[10px] font-bold text-indigo-700 hover:text-indigo-800 bg-white border border-slate-200 rounded-lg cursor-pointer"
                                >
                                  {pt ? 'Ubah' : 'Pilih'}
                                </Button>
                                {idx > 1 && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      const newPts = auditPoints.filter((_, i) => i !== idx);
                                      const newLocations = auditPointLocations.filter((_, i) => i !== idx);
                                      setAuditPoints(newPts);
                                      setAuditPointLocations(newLocations);
                                      recalculateRouteFromPoints(newPts, { pointLocations: newLocations });
                                    }}
                                    className="h-7 w-7 p-0 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Receipt Attachments with EXIF Audit Viewer */}
                  {(report.fuelReceiptUrl || report.tollReceiptUrl) && (
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200/60">
                      {report.fuelReceiptUrl && (
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Bukti BBM:</span>
                          {report.fuelReceiptUrl.split(',').filter(Boolean).map((url, idx, arr) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => onOpenPhoto({
                                url,
                                title: `Bukti BBM ${arr.length > 1 ? `#${idx + 1}` : ''}`,
                                auditMetadata: report.fuelReceiptEvidence?.find((item) => item.url === url)?.auditMetadata,
                              })}
                              className="text-[10px] font-extrabold text-emerald-800 hover:bg-emerald-100 bg-emerald-50 border border-emerald-300 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                            >
                              🔍 Audit Metadata & Foto BBM {arr.length > 1 ? `#${idx + 1}` : ''}
                            </button>
                          ))}
                        </div>
                      )}
                      {report.tollReceiptUrl && (
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Bukti Tol & Parkir:</span>
                          {report.tollReceiptUrl.split(',').filter(Boolean).map((url, idx, arr) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => onOpenPhoto({
                                url,
                                title: `Bukti Tol & Parkir ${arr.length > 1 ? `#${idx + 1}` : ''}`,
                                auditMetadata: report.tollReceiptEvidence?.find((item) => item.url === url)?.auditMetadata,
                              })}
                              className="text-[10px] font-extrabold text-indigo-800 hover:bg-indigo-100 bg-indigo-50 border border-indigo-300 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                            >
                              🔍 Audit Metadata & Foto Tol {arr.length > 1 ? `#${idx + 1}` : ''}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* CARD 2: Parameter Audit Perjalanan Card */}
                <div className="p-4 rounded-2xl bg-white border border-slate-200/80 space-y-3.5 shadow-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block">
                      Parameter Audit Perjalanan
                    </span>
                    {isEditable && (
                      <button
                        type="button"
                        onClick={() => setIsManualDurationOverride(!isManualDurationOverride)}
                        className="text-[10px] font-bold text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        {isManualDurationOverride ? <Lock className="w-3 h-3 text-slate-400" /> : <Edit2 className="w-3 h-3" />}
                        {isManualDurationOverride ? 'Kunci Durasi' : 'Ubah Durasi Manual'}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3.5 border-y border-indigo-100/70 py-3">
                    <div className="space-y-1">
                      <Label htmlFor="auditDateStart" className="text-[9.5px] font-bold text-slate-400 uppercase">
                        Tanggal Berangkat
                      </Label>
                      <Input
                        id="auditDateStart"
                        type="date"
                        value={auditDateStart}
                        onChange={(event) => handleAuditDateChange('start', event.target.value)}
                        disabled={!isEditable || actionLoading}
                        className="h-9 rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-800 focus:border-indigo-400"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="auditTimeStart" className="text-[9.5px] font-bold text-slate-400 uppercase">
                        Jam Berangkat
                      </Label>
                      <Input
                        id="auditTimeStart"
                        type="time"
                        value={auditTimeStart}
                        onChange={(event) => handleAuditTimeChange('start', event.target.value)}
                        disabled={!isEditable || actionLoading}
                        className="h-9 rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-800 focus:border-indigo-400"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="auditDateEnd" className="text-[9.5px] font-bold text-slate-400 uppercase">
                        Tanggal Tiba / Selesai
                      </Label>
                      <Input
                        id="auditDateEnd"
                        type="date"
                        value={auditDateEnd}
                        min={auditDateStart || undefined}
                        onChange={(event) => handleAuditDateChange('end', event.target.value)}
                        disabled={!isEditable || actionLoading}
                        className="h-9 rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-800 focus:border-indigo-400"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="auditTimeEnd" className="text-[9.5px] font-bold text-slate-400 uppercase">
                        Jam Tiba / Selesai
                      </Label>
                      <Input
                        id="auditTimeEnd"
                        type="time"
                        value={auditTimeEnd}
                        onChange={(event) => handleAuditTimeChange('end', event.target.value)}
                        disabled={!isEditable || actionLoading}
                        className="h-9 rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-800 focus:border-indigo-400"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl bg-indigo-50/70 px-3 py-2 text-[10px] font-bold text-indigo-800">
                    <span>
                      Durasi {auditIsMultiDay ? 'lintas hari' : 'hari yang sama'}:{' '}
                      {auditCalc.actualJourneyDurationHours > 0
                        ? `${auditCalc.actualJourneyDurationHours.toFixed(1).replace(/\.0$/, '')} jam`
                        : '—'}
                    </span>
                    <span>
                      {auditCalc.nightPremium > 0
                        ? `${auditNightCount} malam · +${fmtRp(auditCalc.nightPremium)}`
                        : 'Tanpa uang menginap'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <Label className="text-[9.5px] font-bold text-slate-400 uppercase">Jarak Tempuh PP (KM)</Label>
                        <span className={`text-[8.5px] font-extrabold flex items-center gap-0.5 ${hasMeasuredCurrentRoute ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {isCalculatingRoute ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Lock className="w-2.5 h-2.5" />}
                          {!isEditable
                            ? 'Nilai Disetujui'
                            : hasMeasuredCurrentRoute
                              ? 'Google Terukur'
                              : 'Menunggu Pengukuran'}
                        </span>
                      </div>
                      <Input
                        type="number"
                        value={auditDistanceKm || ''}
                        readOnly
                        disabled
                        className="rounded-xl text-xs font-bold bg-slate-100/70 border-slate-200 text-slate-600 cursor-not-allowed"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <Label className="text-[9.5px] font-bold text-slate-400 uppercase">Waktu Tempuh PP (JAM)</Label>
                        {!isManualDurationOverride && (
                          <span className="text-[8.5px] font-extrabold text-slate-400 flex items-center gap-0.5">
                            <Lock className="w-2.5 h-2.5" /> Otomatis Jadwal
                          </span>
                        )}
                      </div>
                      <Input
                        type="number"
                        value={auditDurationHours || ''}
                        onChange={(e) => setAuditDurationHours(Math.max(0, parseFloat(e.target.value) || 0))}
                        disabled={!isManualDurationOverride || !isEditable || actionLoading}
                        className={`rounded-xl text-xs font-bold transition-all ${!isManualDurationOverride
                            ? 'bg-slate-100/70 border-slate-200 text-slate-600 cursor-not-allowed'
                            : 'border-slate-200 focus:border-indigo-400 text-slate-800 bg-white'
                          }`}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[9.5px] font-bold text-slate-400 uppercase flex items-center justify-between gap-2">
                      <span>Uang Didapatkan Selama Perjalanan</span>
                      <span className="text-slate-500 font-bold normal-case text-[9.5px] whitespace-nowrap">
                        (Hak {Math.round(auditCalc.totalMealEntitlement / 20000)}x Makan: <strong className="text-emerald-700 font-black">{fmtRp(auditCalc.totalMealEntitlement)}</strong>)
                      </span>
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-indigo-700">Rp</span>
                      <Input
                        id="audit-meal-money-received"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_MEAL_MONEY_RECEIVED}
                        step={1000}
                        value={auditMealMoneyReceivedInput}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setAuditMealMoneyReceivedInput(
                            nextValue === ''
                              ? ''
                              : String(clampMealMoneyReceived(Number(nextValue))),
                          );
                        }}
                        disabled={!isEditable || actionLoading}
                        aria-label="Uang didapatkan selama perjalanan"
                        aria-describedby="audit-meal-money-received-help"
                        className="pl-8 rounded-xl text-xs font-bold border-indigo-200 hover:border-indigo-300 focus:border-indigo-500 text-slate-800 bg-white"
                      />
                    </div>
                    <p id="audit-meal-money-received-help" className="text-[9px] font-semibold text-slate-400">
                      Nilai ini dikurangkan dari hak uang makan saat audit.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[9px] font-bold text-slate-400 uppercase">
                        {auditCalc.fuelProcurementMode === 'hold_accumulate' ? 'BBM (Hold)' : 'Selisih BBM (+/-)'}
                      </Label>
                      <Input
                        type="number"
                        placeholder={auditCalc.fuelProcurementMode === 'hold_accumulate' ? 'Tidak berlaku' : 'Sesuai Anggaran'}
                        value={auditCalc.fuelProcurementMode === 'hold_accumulate' ? '' : (auditFuelDelta || '')}
                        onChange={(e) => setAuditFuelDelta(parseInt(e.target.value, 10) || 0)}
                        disabled={!isEditable || actionLoading || auditCalc.fuelProcurementMode === 'hold_accumulate'}
                        className={`rounded-xl text-xs font-bold transition-all ${!auditFuelDelta || auditFuelDelta === 0
                            ? 'bg-emerald-50/80 border-emerald-300 text-emerald-700 placeholder:text-emerald-600/70 focus:border-emerald-500 font-semibold'
                            : 'border-slate-200 focus:border-indigo-400 text-slate-800'
                          }`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] font-bold text-slate-400 uppercase">Uang Makan (Delta)</Label>
                      <Input
                        type="number"
                        placeholder="Sesuai Anggaran"
                        value={auditCalc.deltaMeal || ''}
                        readOnly
                        disabled
                        className={`rounded-xl text-xs font-bold transition-all ${auditCalc.deltaMeal === 0
                            ? 'bg-emerald-50/80 border-emerald-300 text-emerald-700 placeholder:text-emerald-600/70 focus:border-emerald-500 font-semibold'
                            : 'border-slate-200 focus:border-indigo-400 text-slate-800'
                          }`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[9px] font-bold text-slate-400 uppercase">Selisih Tol & Parkir (+/-)</Label>
                      <Input
                        type="number"
                        placeholder="Sesuai Anggaran"
                        value={auditTollDelta || ''}
                        onChange={(e) => setAuditTollDelta(parseInt(e.target.value, 10) || 0)}
                        disabled={!isEditable || actionLoading}
                        className={`rounded-xl text-xs font-bold transition-all ${!auditTollDelta || auditTollDelta === 0
                            ? 'bg-emerald-50/80 border-emerald-300 text-emerald-700 placeholder:text-emerald-600/70 focus:border-emerald-500 font-semibold'
                            : 'border-slate-200 focus:border-indigo-400 text-slate-800'
                          }`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3.5 items-center pt-1">
                    <div className="space-y-1">
                      <Label className="text-[9.5px] font-bold text-slate-400 uppercase">Jenis Kendaraan</Label>
                      {isEditable ? (
                        <Select value={auditVehicleType} onValueChange={(v) => setAuditVehicleType(v || 'Suzuki XL7')}>
                          <SelectTrigger className="text-xs font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-9 px-3">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white text-xs">
                            {VEHICLE_OPTIONS.map(v => (
                              <SelectItem key={v} value={v}>{v}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type="text"
                          value={auditVehicleType}
                          disabled
                          className="rounded-xl bg-slate-50 border-slate-200 text-xs font-bold"
                        />
                      )}
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="auditNightCount" className="text-[9.5px] font-bold text-slate-400 uppercase">
                        Jumlah Malam
                      </Label>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 w-9 rounded-xl p-0 text-lg font-black"
                          onClick={() => setAuditNightCount((count) => Math.max(0, count - 1))}
                          disabled={!isEditable || actionLoading || auditNightCount === 0}
                        >
                          −
                        </Button>
                        <Input
                          id="auditNightCount"
                          type="number"
                          min={0}
                          max={365}
                          step={1}
                          value={auditNightCount}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setAuditNightCount(
                              Number.isSafeInteger(value)
                                ? Math.min(365, Math.max(0, value))
                                : 0,
                            );
                          }}
                          disabled={!isEditable || actionLoading}
                          className="h-9 w-16 rounded-xl bg-white text-center font-black"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 w-9 rounded-xl p-0 text-lg font-black"
                          onClick={() => setAuditNightCount((count) => Math.min(365, count + 1))}
                          disabled={!isEditable || actionLoading || auditNightCount >= 365}
                        >
                          +
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT HALF: Card 3 (Komponen Earning) & Card 4 (Biaya Operasional Matrix) */}
              <div className="flex flex-col gap-4 overflow-y-auto pr-1">
                {/* CARD 3: Komponen Earning (Upah Bersih Sopir) Card */}
                <div className="p-4 rounded-2xl bg-indigo-50/40 border border-indigo-100/60 space-y-2.5 text-xs shadow-xs">
                  <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest block">Komponen Earning (Upah Bersih Sopir)</span>

                  <div className="grid grid-cols-2 gap-3 text-slate-600 font-medium pt-1">
                    <div className="flex justify-between bg-white p-2.5 rounded-xl border border-indigo-100/50">
                      <span>Komponen Jarak ({auditDistanceKm} km x Rp300)</span>
                      <span className="font-extrabold text-slate-800">{fmtRp(auditCalc.componentJarak)}</span>
                    </div>
                    <div className="flex justify-between bg-white p-2.5 rounded-xl border border-indigo-100/50">
                      <span>Komponen Waktu ({formatDurationHoursAsJamMenit(auditRouteDurationHours)} x Rp5.000)</span>
                      <span className="font-extrabold text-slate-800">{fmtRp(auditCalc.componentWaktu)}</span>
                    </div>
                  </div>

                  {(auditCalc.premiumWeekend > 0 || auditCalc.nightPremium > 0) && (
                    <div className="flex gap-3 pt-1">
                      {auditCalc.premiumWeekend > 0 && (
                        <div className="flex-1 flex justify-between bg-white p-2.5 rounded-xl border border-indigo-100/50">
                          <span>Weekend Premium</span>
                          <span className="font-extrabold text-slate-800">+{fmtRp(auditCalc.premiumWeekend)}</span>
                        </div>
                      )}
                      {auditCalc.nightPremium > 0 && (
                        <div className="flex-1 flex justify-between bg-white p-2.5 rounded-xl border border-indigo-100/50">
                          <span>Premium Malam ({auditNightCount} × Rp50.000)</span>
                          <span className="font-extrabold text-slate-800">+{fmtRp(auditCalc.nightPremium)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-between text-sm font-extrabold text-slate-800 pt-2 border-t border-indigo-200/50">
                    <span>Upah Bersih Sopir (Net Wage)</span>
                    <span className="font-black text-emerald-600 text-base">{fmtRp(auditCalc.upahBersih)}</span>
                  </div>
                  {auditCalc.remainingUnspentCash > 0 && (
                    <div className="flex justify-between text-[10px] font-bold text-blue-700">
                      <span>Potongan Sisa Kas Operasional</span>
                      <span>-{fmtRp(auditCalc.remainingUnspentCash)}</span>
                    </div>
                  )}
                </div>

                {/* CARD 4: Biaya Operasional (SPJ) — Matriks Perbandingan Card */}
                <div className="p-4 rounded-2xl bg-blue-50/40 border border-blue-150 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest block">
                      Biaya Operasional (SPJ) — Matriks Perbandingan
                    </span>
                    <Badge variant="outline" className="bg-blue-100/60 border-blue-200 text-blue-700 text-[10px] font-bold">
                      Otorisasi vs Audit
                    </Badge>
                  </div>

                  {/* Comparison Table */}
                  <div className="overflow-x-auto rounded-xl border border-blue-100 bg-white shadow-xs">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="bg-blue-100/40 text-[9.5px] font-extrabold text-blue-800 uppercase tracking-wider border-b border-blue-100">
                          <th className="py-2.5 px-3.5">Komponen Biaya</th>
                          <th className="py-2.5 px-3.5 text-right">Otorisasi (Jatah)</th>
                          <th className="py-2.5 px-3.5 text-right">Aktual / Audit</th>
                          <th className="py-2.5 px-3.5 text-right">Delta (Reimburse)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                        <tr>
                          <td className="py-2.5 px-3.5 font-semibold text-slate-800">
                            {auditCalc.fuelProcurementMode === 'hold_accumulate'
                              ? 'BBM (cash — tidak berlaku; jatah ditahan)'
                              : 'Biaya BBM (PP)'}
                            <span className="block text-[9px] text-slate-400 font-normal">
                              {auditDistanceKm} km @ {getVehicleRate(auditVehicleType)}/km
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-bold text-slate-600">{fmtRp(auditCalc.totalFuelAllocation)}</td>
                          <td className="py-2.5 px-3.5 text-right font-bold text-slate-800">{fmtRp(auditCalc.actualFuel)}</td>
                          <td className="py-2.5 px-3.5 text-right font-extrabold text-blue-600">
                            {auditCalc.deltaFuel !== 0
                              ? `${auditCalc.deltaFuel > 0 ? '+' : '-'}${fmtRp(Math.abs(auditCalc.deltaFuel))}`
                              : '—'}
                          </td>
                        </tr>

                        <tr>
                          <td className="py-2.5 px-3.5 font-semibold text-slate-800">
                            Uang Makan Stratum
                            <span className="block text-[9px] text-slate-400 font-normal">
                              Otorisasi {(auditAuthorizedDurationPP || auditDurationHours).toFixed(1).replace(/\.0$/, '')} jam;
                              aktual {auditCalc.actualJourneyDurationHours.toFixed(1).replace(/\.0$/, '')} jam
                              ({journeyDayCount(auditCalc.actualJourneyDurationHours)} hari)
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-bold text-slate-600">{fmtRp(auditCalc.baselineMeal)}</td>
                          <td className="py-2.5 px-3.5 text-right font-bold text-slate-800">{fmtRp(auditCalc.actualMeal)}</td>
                          <td className="py-2.5 px-3.5 text-right font-extrabold text-blue-600">
                            {auditCalc.deltaMeal > 0 ? `+${fmtRp(auditCalc.deltaMeal)}` : '—'}
                          </td>
                        </tr>

                        <tr>
                          <td className="py-2.5 px-3.5 font-semibold text-slate-800">Tol & Parkir</td>
                          <td className="py-2.5 px-3.5 text-right font-bold text-slate-600">{fmtRp(auditCalc.baselineToll)}</td>
                          <td className="py-2.5 px-3.5 text-right font-bold text-slate-800">{fmtRp(auditCalc.actualToll)}</td>
                          <td className="py-2.5 px-3.5 text-right font-extrabold text-blue-600">
                            {auditCalc.deltaToll !== 0
                              ? `${auditCalc.deltaToll > 0 ? '+' : '-'}${fmtRp(Math.abs(auditCalc.deltaToll))}`
                              : '—'}
                          </td>
                        </tr>

                        {auditCalc.extraOps > 0 && (
                          <tr className="bg-amber-50/40">
                            <td className="py-2.5 px-3.5 font-semibold text-amber-800">
                              Kelebihan Rute / Jarak
                              <span className="block text-[9px] text-amber-600 font-normal">Tambah titik lokasi</span>
                            </td>
                            <td className="py-2.5 px-3.5 text-right text-slate-400">—</td>
                            <td className="py-2.5 px-3.5 text-right font-bold text-amber-800">+{fmtRp(auditCalc.extraOps)}</td>
                            <td className="py-2.5 px-3.5 text-right font-extrabold text-amber-700">+{fmtRp(auditCalc.extraOps)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary Totals */}
                  <div className="space-y-1.5 pt-1 text-xs">
                    <div className="flex justify-between font-medium text-slate-500">
                      <span>Total Uang Jalan Awal (Otorisasi)</span>
                      <span className="font-bold text-slate-700">{fmtRp(auditCalc.totalBaseline)}</span>
                    </div>

                    <div className="flex justify-between font-medium text-blue-600">
                      <span>Total Kelebihan Reimburse (Total Delta)</span>
                      <span className="font-extrabold text-blue-700">+{fmtRp(auditCalc.totalReimburseDelta)}</span>
                    </div>

                    <div className="flex justify-between text-sm font-black text-slate-900 pt-2 border-t border-blue-200/80">
                      <span>Total Biaya Operasional (SPJ Akhir)</span>
                      <span className="text-blue-700 text-base font-black">{fmtRp(auditCalc.operationalCost)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-3 border-t border-slate-100 pt-3 shrink-0">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl font-bold text-slate-500">
              Kembali
            </Button>
            {canDecline && (
              <Button
                onClick={onDecline}
                disabled={actionLoading}
                className="rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 font-bold"
              >
                Tolak Perjalanan
              </Button>
            )}
            {isEditable && (
              <Button
                onClick={handleApprove}
                disabled={
                  actionLoading ||
                  isCalculatingRoute ||
                  !hasMeasuredCurrentRoute ||
                  Boolean(routeCalcError) ||
                  !auditCalc ||
                  auditCalc.actualJourneyDurationHours <= 0
                }
                className="rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold hover:shadow-lg shadow-indigo-100"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                {canReEditConfirmed ? 'Simpan Perubahan' : 'Audit & Setujui'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Google Maps Selector Dialog ──────────────────────────────────── */}
      <Dialog open={showMapSelector} onOpenChange={setShowMapSelector}>
        <DialogContent className="sm:max-w-[500px] rounded-2xl bg-white border-slate-100 shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-extrabold text-slate-800 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-indigo-600" />
              Pilih Tujuan di Google Maps
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400 mt-1">
              Cari lokasi atau geser pin merah ke lokasi tujuan perjalanan dinas.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="relative">
              <div className="flex h-11 items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3.5 shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/20">
                <Compass className="h-4.5 w-4.5 shrink-0 text-indigo-500" />
                <Input
                  placeholder="Cari lokasi tujuan dinas..."
                  value={mapSearchText}
                  onChange={(event) => handleMapSearchChange(event.target.value)}
                  onKeyDown={handleMapSearchKeyDown}
                  onBlur={() => window.setTimeout(cancelPlaceSearch, 150)}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={placeSuggestions.length > 0}
                  className="h-full flex-1 border-none bg-transparent p-0 text-xs font-bold text-slate-700 placeholder:text-slate-400 focus-visible:ring-0"
                />
                {isSearchingPlaces && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
                {mapSearchText && (
                  <button
                    type="button"
                    onClick={() => {
                      resetMapSearch();
                      setMapSearchText('');
                      setMapAddress('');
                      setMapLocation(null);
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Hapus pencarian"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                )}
                <div className="h-5 w-px shrink-0 bg-slate-200" />
                <button
                  type="button"
                  onClick={() => {
                    if (placeSuggestions[0]) {
                      handlePlaceSuggestionSelect(placeSuggestions[0]);
                    } else {
                      setMapSearchError(
                        mapSearchText.trim().length < PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH
                          ? `Ketik minimal ${PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH} karakter untuk mencari lokasi.`
                          : 'Pilih salah satu saran lokasi sebelum melanjutkan.',
                      );
                    }
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-indigo-500 transition-all hover:bg-indigo-50 hover:text-indigo-600"
                  aria-label="Pilih saran lokasi pertama"
                >
                  <Search className="h-4.5 w-4.5" />
                </button>
              </div>

              {placeSuggestions.length > 0 && (
                <div className="absolute inset-x-0 top-full z-[100] mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  {placeSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handlePlaceSuggestionSelect(suggestion)}
                      className="flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-indigo-50"
                    >
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                      <span className="min-w-0">
                        <strong className="block truncate text-[11px] text-slate-800">{suggestion.primaryText}</strong>
                        {suggestion.secondaryText && (
                          <span className="block truncate text-[10px] text-slate-500">{suggestion.secondaryText}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[10px] text-slate-400">
              Ketik minimal {PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH} karakter, lalu pilih salah satu saran.
            </p>
            {(mapSearchError || placeSearchError) && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-700">
                {mapSearchError || placeSearchError}
              </p>
            )}

            {/* Map Container */}
            <div
              ref={(el) => {
                if (el) {
                  initMap(el);
                }
              }}
              className="w-full h-[280px] rounded-xl border border-slate-100 overflow-hidden bg-slate-50 relative flex items-center justify-center"
            >
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                <span className="text-[10px] font-bold">Memuat Google Maps...</span>
              </div>
            </div>

            {/* Selected Address Box */}
            {mapAddress && (
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-600 leading-relaxed font-semibold">
                <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">Alamat Terpilih:</span>
                📍 {mapAddress}
              </div>
            )}

            <DialogFooter className="pt-2 border-t border-slate-100 gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowMapSelector(false)}
                className="rounded-xl font-bold text-slate-500 hover:bg-slate-50 text-xs px-4"
              >
                Batal
              </Button>
              <Button
                type="button"
                disabled={!mapAddress || !mapLocation}
                onClick={handleConfirmMapLocation}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 h-10 cursor-pointer"
              >
                Konfirmasi Lokasi
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default DriverJourneyAuditDialog;
