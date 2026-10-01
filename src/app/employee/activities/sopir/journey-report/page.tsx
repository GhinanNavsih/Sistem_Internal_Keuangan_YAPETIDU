"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { FloatingSnackbar } from '@/components/ui/floating-snackbar';
import { useAuth } from '@/lib/AuthContext';
import { ImageExifViewer } from '@/components/ImageExifViewer';
import { JourneyReportPageSkeleton } from '@/components/JourneyReportSkeleton';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { ReceiptAttachments } from '@/components/ui/receipt-attachments';
import { StatusDot } from '@/components/ui/status-dot';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Loader2,
  ArrowUp,
  ArrowDown,
  Compass,
  Plus,
  Search,
  MoreHorizontal,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { uploadProofFile } from '@/lib/uploads';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import {
  EMPLOYEE_ACTIVITY_PATHS,
  getEmployeeActivityWorkflow,
} from '@/lib/employeeActivities';
import {
  calculateDriverReimbursementSettlement,
  calculateDriverNetWage,
  calculateJourneyElapsedHours,
  calculateNightPremium,
  journeyDayCount,
  calculateJourneyDateTimeTimings,
  calculateEditableDriverJourneyTimeline,
  getShortTripMealWageComponent,
  getMealAllowanceForDuration,
  getGrossMealAllowanceForDuration,
  getMealWageComponent,
  resolveMealAccountingMode,
  getMealTierCount,
  DEFAULT_DRIVER_JOURNEY_LOCATION,
  DEFAULT_DRIVER_JOURNEY_POINT,
  DEFAULT_FUEL_PROCUREMENT_MODE,
  closeDriverJourneyRoundTrip,
  driverJourneyRoutePoint,
  isFuelProcurementMode,
  MAX_DRIVER_JOURNEY_DESTINATIONS,
  normalizeDriverJourneyLocation,
  normalizeDriverJourneyLocations,
  normalizeDriverJourneyDestinations,
  normalizeDriverJourneyStartPoint,
  driverJourneyStartPointLabel,
  type DriverJourneyLocation,
  type FuelProcurementMode,
} from '@/lib/payroll/driverJourney';
import { driverVehicleChangeBlocker, isSelfCreatedDriverJourney } from '@/lib/payroll/driverPiket';
import {
  ChangeJourneyVehicleDialog,
  type ChangeJourneyVehicleResult,
} from '@/components/employee/activities/ChangeJourneyVehicleDialog';
import { prepareProofImage, type PhotoEvidence } from '@/lib/photoEvidence';
import type { PhotoAuditMetadata } from '@/lib/payroll/domain';
import {
  PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH,
  type CostSafePlaceSuggestion,
  useCostSafePlaceAutocomplete,
} from '@/hooks/useCostSafePlaceAutocomplete';
import { useJourneyReportDraft } from '@/hooks/useJourneyReportDraft';
import { isLocalJourneyReportDraftNewer } from '@/lib/payroll/driverJourneyReportDraft';

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

function fmtRp(val: number): string {
  return 'Rp' + Math.ceil(val).toLocaleString('id-ID');
}

/**
 * A rupiah field driven by the page's string state (dots between thousands,
 * digits only). The page also clears these values from outside, e.g. when the
 * vehicle changes to Ndalem, so the value stays fully controlled here.
 */
function RupiahInput({ id, value, onValue }: { id: string; value: string; onValue: (value: string) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">Rp</span>
      <Input
        id={id}
        inputMode="numeric"
        placeholder="0"
        value={value}
        onChange={(e) => {
          const val = e.target.value.replace(/\D/g, '');
          onValue(val ? Number(val).toLocaleString('id-ID') : '');
        }}
        className="h-10 pl-9 tabular-nums"
      />
    </div>
  );
}

function getTodayISO(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

/** Firestore timestamps reach the client as `{_seconds}` once JSON-serialized. */
function firestoreDateFrom(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null;
  const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof timestamp.toDate === 'function') return timestamp.toDate();
  const seconds = timestamp.seconds ?? timestamp._seconds;
  return typeof seconds === 'number' ? new Date(seconds * 1_000) : null;
}

function jakartaClockTimeFrom(value: unknown): string | null {
  const date = firestoreDateFrom(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function jakartaDateFrom(value: unknown): string | null {
  const date = firestoreDateFrom(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getNextDayISO(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLegDistance(text: string): number {
  if (!text) return 0;
  const num = parseFloat(text.replace(/,/g, ''));
  if (isNaN(num)) return 0;
  if (text.toLowerCase().includes('m') && !text.toLowerCase().includes('k')) {
    return num / 1000;
  }
  return num;
}



function calculateElapsedHours(start: string, end: string, nightCount: number): number {
  if (!start || !end) return 0;
  try {
    return calculateJourneyElapsedHours(start, end, nightCount);
  } catch {
    return 0;
  }
}

/** Digit mask for the JJ:MM clock inputs, clamping to 23:59 as it is typed. */
function maskClockInput(raw: string): string {
  let val = raw.replace(/[^0-9]/g, '');
  if (val.length > 4) val = val.slice(0, 4);
  if (val.length === 1 && parseInt(val, 10) > 2) val = `0${val}`;
  if (val.length >= 2) {
    const hours = parseInt(val.slice(0, 2), 10);
    if (hours > 23) val = '23' + val.slice(2);
  }
  if (val.length === 4) {
    const minutes = parseInt(val.slice(2, 4), 10);
    if (minutes > 59) val = val.slice(0, 2) + '59';
  }
  return val.length > 2 ? `${val.slice(0, 2)}:${val.slice(2)}` : val;
}

function padTime(time: string): string {
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

function JourneyReportContent() {
  const { user, profile: rawProfile, activeProfile, loading: authLoading } = useAuth();
  const profile = activeProfile || rawProfile;
  const router = useRouter();
  const searchParams = useSearchParams();
  const journeyIdParam = searchParams.get('id');
  const editReportIdParam = searchParams.get('editReportId');

  const fuelFileInputRef = useRef<HTMLInputElement>(null);
  const tollFileInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);
  const skipSaveDraftRef = useRef(false);
  const skipJourneyLoadRef = useRef(false);
  const journeyLoadAttemptRef = useRef<string | null>(null);

  const isSopir = getEmployeeActivityWorkflow(profile || {}) === 'sopir';

  const [activeReportingJourney, setActiveReportingJourney] = useState<any | null>(null);
  const [selectedFuelMode, setSelectedFuelMode] = useState<FuelProcurementMode>(DEFAULT_FUEL_PROCUREMENT_MODE);
  const [selectingFuelMode, setSelectingFuelMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states
  const [formDate, setFormDate] = useState('');
  const [formTimeStart, setFormTimeStart] = useState('');
  const [formTimeEnd, setFormTimeEnd] = useState('');
  const [formIsMultiDay, setFormIsMultiDay] = useState(false);
  const [formDateEnd, setFormDateEnd] = useState('');
  const [formNightCount, setFormNightCount] = useState<number>(0);
  const [formNdalemMealMoneyFee, setFormNdalemMealMoneyFee] = useState<string>('');
  const [formFuelFee, setFormFuelFee] = useState('');
  const [formTollParkingFee, setFormTollParkingFee] = useState('');
  const [formFuelReceiptUrls, setFormFuelReceiptUrls] = useState<string[]>([]);
  const [formTollReceiptUrls, setFormTollReceiptUrls] = useState<string[]>([]);
  const [formFuelReceiptEvidence, setFormFuelReceiptEvidence] = useState<PhotoEvidence[]>([]);
  const [formTollReceiptEvidence, setFormTollReceiptEvidence] = useState<PhotoEvidence[]>([]);
  const [uploadingFuelReceipt, setUploadingFuelReceipt] = useState(false);
  const [uploadingTollReceipt, setUploadingTollReceipt] = useState(false);
  const [selectedExifImage, setSelectedExifImage] = useState<{ url: string; title: string; auditMetadata?: PhotoAuditMetadata | null } | null>(null);

  const [extraActivities, setExtraActivities] = useState<any[]>([]);
  const [calculatedDistanceKm, setCalculatedDistanceKm] = useState(0);
  const [calculatedDurationHours, setCalculatedDurationHours] = useState(0);
  const [outboundDistanceKm, setOutboundDistanceKm] = useState<number | null>(null);
  const [outboundDurationHours, setOutboundDurationHours] = useState<number | null>(null);
  const [isCalculatingExtraRoute, setIsCalculatingExtraRoute] = useState(false);
  const [extraRouteError, setExtraRouteError] = useState('');
  const [hasMeasuredRoundTrip, setHasMeasuredRoundTrip] = useState(false);
  const [routeHydrationKey, setRouteHydrationKey] = useState<string | null>(null);

  const isInvalidSingleDayTime = useMemo(() => {
    const isMultiDayJourney = formIsMultiDay || (Boolean(formDateEnd) && formDateEnd > formDate);
    if (isMultiDayJourney) return false;
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(formTimeStart)) return false;
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(formTimeEnd)) return false;
    const startMins = parseInt(formTimeStart.split(':')[0], 10) * 60 + parseInt(formTimeStart.split(':')[1], 10);
    const endMins = parseInt(formTimeEnd.split(':')[0], 10) * 60 + parseInt(formTimeEnd.split(':')[1], 10);
    return endMins <= startMins;
  }, [formIsMultiDay, formDate, formDateEnd, formTimeStart, formTimeEnd]);

  // Map selector modal
  const [showMapSelector, setShowMapSelector] = useState(false);
  const [mapSearchText, setMapSearchText] = useState('');
  const [mapAddress, setMapAddress] = useState('');
  const [mapLocation, setMapLocation] = useState<DriverJourneyLocation | null>(null);
  const [mapSearchError, setMapSearchError] = useState('');
  const [mapTargetIndex, setMapTargetIndex] = useState<number | null>(null);

  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapGeocodeRequestRef = useRef(0);
  const {
    suggestions: placeSuggestions,
    isSearching: isSearchingPlaces,
    searchError: placeSearchError,
    search: searchPlaces,
    cancelSearch: cancelPlaceSearch,
  } = useCostSafePlaceAutocomplete({ loadGoogleMapsScript });

  const [draftLoadedJourneyId, setDraftLoadedJourneyId] = useState<string | null>(null);
  const routeHydratedJourneyRef = useRef<string | null>(null);
  const routeCalculationRequestRef = useRef(0);

  // Load journey data & restore draft
  useEffect(() => {
    if (authLoading) return;
    if (!profile?.linkedEmployeeId || !isSopir) {
      setLoading(false);
      return;
    }
    const linkedEmployeeId = profile.linkedEmployeeId;
    const journeyLoadKey = [
      linkedEmployeeId,
      journeyIdParam || 'active-journey',
      editReportIdParam || '',
    ].join(':');
    if (journeyLoadAttemptRef.current === journeyLoadKey) return;
    journeyLoadAttemptRef.current = journeyLoadKey;
    let cancelled = false;

    const fetchJourney = async () => {
      if (cancelled || skipJourneyLoadRef.current) return;
      setLoading(true);
      setDraftLoadedJourneyId(null);
      try {
        let targetId = journeyIdParam;
        if (!targetId) {
          if (!user) throw new Error('Sesi tidak ditemukan.');
          const idToken = await user.getIdToken();
          const res = await fetch(`/api/driver-journeys?driverId=${encodeURIComponent(linkedEmployeeId)}`, {
            headers: { Authorization: `Bearer ${idToken}` },
            cache: 'no-store',
          });
          if (res.ok) {
            const data = await res.json();
            const claimed = (data.journeys || []).find((j: any) => j.status === 'claimed');
            if (claimed) targetId = claimed.id;
          }
        }

        if (cancelled || skipJourneyLoadRef.current) return;

        if (!targetId) {
          router.replace(EMPLOYEE_ACTIVITY_PATHS.sopir);
          return;
        }

        const cancelledJourneyId = typeof window !== 'undefined'
          ? sessionStorage.getItem('cancelled_driver_journey_id')
          : null;
        if (cancelledJourneyId === targetId) {
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('cancelled_driver_journey_id');
          }
          skipJourneyLoadRef.current = true;
          setLoading(false);
          router.replace(EMPLOYEE_ACTIVITY_PATHS.sopir);
          return;
        }

        const journeyResult = await authenticatedJson<{ journey: any }>(
          `/api/driver-journeys?journeyId=${encodeURIComponent(targetId)}`,
        );

        if (cancelled || skipJourneyLoadRef.current) return;

        if (journeyResult.journey) {
          let reportData: any = journeyResult.journey;
          const isExplicitEdit = Boolean(editReportIdParam);
          if (editReportIdParam) {
            reportData.editingActivityDocId = editReportIdParam;
            try {
              const actSnap = await getDoc(doc(db, 'ActivityReports', editReportIdParam));
              if (actSnap.exists()) {
                reportData = { ...reportData, ...actSnap.data(), editingActivityDocId: editReportIdParam };
              }
            } catch (e) {
              console.error('Error fetching ActivityReport doc for edit:', e);
            }
          }

          // ActivityReports keep the submitted route in `points`, while the
          // journey document keeps the canonical start/destination fields.
          // Preserve submitted address edits when reopening a report without
          // misaligning the stored coordinate arrays.
          const submittedPoints = Array.isArray(reportData.points)
            ? reportData.points.filter((point: unknown): point is string => (
                typeof point === 'string' && Boolean(point.trim())
              ))
            : [];
          if (isExplicitEdit && submittedPoints.length >= 2) {
            reportData.startPoint = submittedPoints[0].trim();
            reportData.mainDestinations = submittedPoints.slice(1).map((point: string) => point.trim());
            reportData.endPoint = reportData.mainDestinations[0];
          }

          if (reportData.status !== 'claimed' && !isExplicitEdit) {
            // A direct link to an assigned or already-submitted journey must
            // never mutate the assignment as a side effect of loading the form.
            if (typeof window !== 'undefined' && targetId) {
              sessionStorage.setItem('submitted_driver_journey_id', targetId);
              sessionStorage.setItem('submitted_driver_journey_at', String(Date.now()));
            }
            skipJourneyLoadRef.current = true;
            setLoading(false);
            router.replace(EMPLOYEE_ACTIVITY_PATHS.sopir);
            return;
          }
          // Check for local storage auto-saved draft
          const localDraftKey = `journey_draft_${targetId}`;
          let localDraft: any = null;
          try {
            const raw = typeof window !== 'undefined' ? localStorage.getItem(localDraftKey) : null;
            if (raw) localDraft = JSON.parse(raw);
          } catch (e) {
            console.error('Error parsing local draft:', e);
          }
          if (localDraft && !isLocalJourneyReportDraftNewer(localDraft.updatedAt, reportData.draftClientUpdatedAt)) {
            localDraft = null;
          }

          const storedStartPoint =
            localDraft?.startPoint ??
            reportData.draftStartPoint ??
            reportData.startPoint ??
            DEFAULT_DRIVER_JOURNEY_POINT;
          const storedMainDestinations =
            localDraft?.mainDestinations ??
            reportData.draftMainDestinations ??
            reportData.mainDestinations;
          const initialMainDestinations = normalizeDriverJourneyDestinations(
            storedMainDestinations,
            Array.isArray(storedMainDestinations) && storedMainDestinations.length === 0
              ? '' : reportData.draftEndPoint ?? reportData.endPoint,
          );
          const normalizedStartPoint =
            typeof storedStartPoint === 'string' && storedStartPoint.trim()
              ? storedStartPoint.trim()
              : DEFAULT_DRIVER_JOURNEY_POINT;
          const normalizedStartPointLocation = normalizeDriverJourneyLocation(
            localDraft?.startPointLocation ??
              reportData.draftStartPointLocation ??
              reportData.startPointLocation,
            normalizedStartPoint,
          ) || (normalizedStartPoint === DEFAULT_DRIVER_JOURNEY_POINT
            ? { ...DEFAULT_DRIVER_JOURNEY_LOCATION }
            : null);
          const initialMainDestinationLocations = normalizeDriverJourneyLocations(
            localDraft?.mainDestinationLocations ??
              reportData.draftMainDestinationLocations ??
              reportData.mainDestinationLocations,
            initialMainDestinations,
          );
          const normalizedReportData = {
            ...reportData,
            startPoint: normalizedStartPoint,
            startPointLocation: normalizedStartPointLocation,
            mainDestinations: initialMainDestinations,
            mainDestinationLocations: initialMainDestinationLocations,
            endPoint: initialMainDestinations[0] || reportData.endPoint || '',
          };
          setActiveReportingJourney(normalizedReportData);
          setSelectedFuelMode(
            isFuelProcurementMode(normalizedReportData.fuelProcurementMode)
              ? normalizedReportData.fuelProcurementMode
              : DEFAULT_FUEL_PROCUREMENT_MODE,
          );

          // On a self-authorized SPJ the departure is the moment the sopir hit
          // "Otorisasi & Mulai Perjalanan". The server derives it from
          // `authorizedAt` on submit regardless, so show that same figure rather
          // than a draft value that would silently be overwritten. An assigned
          // journey's `authorizedAt` is only when the Kepala Satker raised it,
          // so those keep the sopir's own entry.
          const authorizedDeparture = normalizedReportData.departureLockedToAuthorization === true
            ? jakartaClockTimeFrom(reportData.authorizedAt)
            : null;
          const initialDate =
            (authorizedDeparture ? jakartaDateFrom(reportData.authorizedAt) : null) ??
            localDraft?.formDate ??
            reportData.draftDate ??
            reportData.activityDate ??
            reportData.dateStart ??
            reportData.journeyDate ??
            getTodayISO();
          setFormDate(initialDate);

          const initialTimeStart =
            authorizedDeparture ??
            localDraft?.formTimeStart ??
            reportData.draftTimeStart ??
            reportData.timeStart ??
            '';
          setFormTimeStart(initialTimeStart);

          const initialTimeEnd = localDraft?.formTimeEnd ?? reportData.draftTimeEnd ?? reportData.timeEnd ?? '';
          setFormTimeEnd(initialTimeEnd);

          // Whether a journey ran overnight is decided by its own clock times, never
          // by how long after the trip the sopir got around to filling in the report.
          // Seeding it from `activityDate < today` marked same-day trips as lintas
          // hari and handed them a phantom premium malam during audit.
          const explicitIsMultiDay = localDraft?.formIsMultiDay ?? reportData.draftIsMultiDay ?? reportData.isMultiDay;
          const explicitDateEnd = localDraft?.formDateEnd ?? reportData.draftDateEnd ?? reportData.dateEnd;
          const hasNightSignal = Boolean(
            (reportData.nightCount && reportData.nightCount > 0) ||
            (reportData.draftNightCount && reportData.draftNightCount > 0),
          );
          const seedTimeline = calculateEditableDriverJourneyTimeline({
            dateStart: initialDate,
            timeStart: initialTimeStart,
            dateEnd: typeof explicitDateEnd === 'string' ? explicitDateEnd : undefined,
            timeEnd: initialTimeEnd,
            isMultiDay: explicitIsMultiDay === true || hasNightSignal,
          });

          const initialDateEnd = explicitDateEnd ?? seedTimeline.dateEnd;
          setFormDateEnd(initialDateEnd);

          const initialIsMultiDay = explicitIsMultiDay ?? (seedTimeline.isMultiDay || hasNightSignal);
          setFormIsMultiDay(initialIsMultiDay);

          const storedExtraLocs =
            localDraft?.extraActivities ??
            reportData.draftExtraActivities ??
            reportData.extraActivities ??
            [];
          const storedExtraActivities = Array.isArray(storedExtraLocs) ? storedExtraLocs : [];

          // Every destination is an equal stop on one ordered list, so the route
          // can follow the order actually driven — a place the sopir stopped at
          // mid-journey may sit before an authorized one. Older reports kept the
          // first destination outside `extraActivities`; it is folded back in
          // here so the whole route lives in a single array.
          const storedStops = storedExtraActivities.filter(
            (activity) => activity?.type === 'tambah_lokasi' && activity?.destination,
          );
          const storedStopAddresses = new Set<string>(
            storedStops.map((activity) => String(activity.destination).trim()),
          );
          const authorizedLocationFor = (address: string) => {
            const index = initialMainDestinations.indexOf(address);
            return index >= 0 ? initialMainDestinationLocations[index] : null;
          };
          const toStop = (address: string, existing?: Record<string, unknown>) => {
            const { isMainDestination: _legacyFlag, ...rest } = existing || {};
            return {
              ...rest,
              type: 'tambah_lokasi',
              destination: address,
              // The approver's coordinate wins where a stop is part of the plan
              // (they may have refined it); the sopir's own pick covers the rest.
              destinationLocation:
                normalizeDriverJourneyLocation(authorizedLocationFor(address), address) ||
                normalizeDriverJourneyLocation(existing?.destinationLocation, address) ||
                null,
            };
          };
          const [firstAuthorized, ...laterAuthorized] = initialMainDestinations;
          const initialExtraLocs = [
            // A legacy report's first destination leads the route.
            ...(firstAuthorized && !storedStopAddresses.has(firstAuthorized)
              ? [toStop(firstAuthorized)]
              : []),
            ...storedStops.map((activity) => (
              toStop(String(activity.destination).trim(), activity)
            )),
            // Destinations authorized after the sopir last saved land at the end,
            // where they can be moved into place.
            ...laterAuthorized
              .filter((address: string) => !storedStopAddresses.has(address))
              .map((address: string) => toStop(address)),
          ];
          setExtraActivities(initialExtraLocs);

          const rawFuelVal = localDraft?.formFuelFee !== undefined
            ? localDraft.formFuelFee
            : (reportData.draftFuelFee !== undefined && reportData.draftFuelFee !== null
              ? (reportData.draftFuelFee ? Number(reportData.draftFuelFee).toLocaleString('id-ID') : '')
              : (isExplicitEdit && reportData.fuelFee !== undefined && reportData.fuelFee !== null ? (reportData.fuelFee ? Number(reportData.fuelFee).toLocaleString('id-ID') : '') : ''));
          setFormFuelFee(rawFuelVal);

          const rawTollVal = localDraft?.formTollParkingFee !== undefined
            ? localDraft.formTollParkingFee
            : (reportData.draftTollParkingFee !== undefined && reportData.draftTollParkingFee !== null
              ? (reportData.draftTollParkingFee ? Number(reportData.draftTollParkingFee).toLocaleString('id-ID') : '')
              : (isExplicitEdit && reportData.tollParkingFee !== undefined && reportData.tollParkingFee !== null ? (reportData.tollParkingFee ? Number(reportData.tollParkingFee).toLocaleString('id-ID') : '') : ''));
          setFormTollParkingFee(rawTollVal);

          const rawFuelUrls = reportData.draftFuelReceiptUrl ?? reportData.fuelReceiptUrl ?? '';
          setFormFuelReceiptUrls(
            Array.isArray(localDraft?.formFuelReceiptUrls)
              ? localDraft.formFuelReceiptUrls
              : (rawFuelUrls ? (typeof rawFuelUrls === 'string' ? rawFuelUrls.split(',').filter(Boolean) : rawFuelUrls) : [])
          );
          setFormFuelReceiptEvidence(
            Array.isArray(localDraft?.formFuelReceiptEvidence)
              ? localDraft.formFuelReceiptEvidence
              : (reportData.draftFuelReceiptUrl !== undefined
                ? (Array.isArray(reportData.draftFuelReceiptEvidence) ? reportData.draftFuelReceiptEvidence : [])
                : (Array.isArray(reportData.fuelReceiptEvidence) ? reportData.fuelReceiptEvidence : []))
          );

          const rawTollUrls = reportData.draftTollReceiptUrl ?? reportData.tollReceiptUrl ?? '';
          setFormTollReceiptUrls(
            Array.isArray(localDraft?.formTollReceiptUrls)
              ? localDraft.formTollReceiptUrls
              : (rawTollUrls ? (typeof rawTollUrls === 'string' ? rawTollUrls.split(',').filter(Boolean) : rawTollUrls) : [])
          );
          setFormTollReceiptEvidence(
            Array.isArray(localDraft?.formTollReceiptEvidence)
              ? localDraft.formTollReceiptEvidence
              : (reportData.draftTollReceiptUrl !== undefined
                ? (Array.isArray(reportData.draftTollReceiptEvidence) ? reportData.draftTollReceiptEvidence : [])
                : (Array.isArray(reportData.tollReceiptEvidence) ? reportData.tollReceiptEvidence : []))
          );

          const initialNightCount = localDraft?.formNightCount !== undefined
            ? localDraft.formNightCount
            : (Number.isSafeInteger(reportData.draftNightCount) && reportData.draftNightCount >= 0
              ? reportData.draftNightCount
              : (Number.isSafeInteger(reportData.nightCount) && reportData.nightCount >= 0 ? reportData.nightCount : 0));
          setFormNightCount(initialNightCount);

          const rawNdalemMoney = localDraft?.formNdalemMealMoneyFee !== undefined
            ? localDraft.formNdalemMealMoneyFee
            : (reportData.draftNdalemMealMoneyReceived !== undefined && reportData.draftNdalemMealMoneyReceived !== null
              ? reportData.draftNdalemMealMoneyReceived
              : (reportData.ndalemMealMoneyReceived !== undefined && reportData.ndalemMealMoneyReceived !== null ? reportData.ndalemMealMoneyReceived : ''));
          setFormNdalemMealMoneyFee(
            rawNdalemMoney !== undefined && rawNdalemMoney !== ''
              ? (typeof rawNdalemMoney === 'string' ? rawNdalemMoney : Number(rawNdalemMoney).toLocaleString('id-ID'))
              : ''
          );

          const baseRoundTripDistance = Number(reportData.totalDistanceKm) > 0
            ? Number(reportData.totalDistanceKm)
            : Math.max(0, Number(reportData.distanceKm || 0) * 2);
          const baseRoundTripDuration = Number(reportData.customDurationPP) > 0
            ? Number(reportData.customDurationPP)
            : Math.max(0, Number(reportData.durationHours || 0) * 2);
          const hasExtraLocations = initialExtraLocs.some(
            (location: any) => location?.type === 'tambah_lokasi' && Boolean(location?.destination),
          );
          const storedCalculatedDistance = localDraft?.calculatedDistanceKm ?? reportData.draftCalculatedDistanceKm;
          const storedCalculatedDuration = localDraft?.calculatedDurationHours ?? reportData.draftCalculatedDurationHours;
          const submittedDistance = Number(reportData.submittedDistanceKm || 0);
          const submittedDuration = Number(reportData.submittedDurationHours || 0);
          const initialDist = isExplicitEdit && submittedDistance > 0
            ? submittedDistance
            : hasExtraLocations && Number(storedCalculatedDistance) > 0
              ? Number(storedCalculatedDistance)
              : baseRoundTripDistance;
          const initialDur = isExplicitEdit && submittedDuration > 0
            ? submittedDuration
            : hasExtraLocations && Number(storedCalculatedDuration) > 0
              ? Number(storedCalculatedDuration)
              : baseRoundTripDuration;
          setCalculatedDistanceKm(initialDist);
          setCalculatedDurationHours(initialDur);
          setOutboundDistanceKm(localDraft?.outboundDistanceKm ?? null);
          setOutboundDurationHours(localDraft?.outboundDurationHours ?? null);
          setHasMeasuredRoundTrip(false);
          setRouteHydrationKey(targetId);

          setDraftLoadedJourneyId(targetId);
        } else {
          // Journey document does not exist — clean up any orphan ActivityReports
          try {
            await authenticatedJson(`/api/pekarya/activities?journeyId=${encodeURIComponent(targetId)}`, { method: 'DELETE' });
          } catch (e) { }
          router.replace(EMPLOYEE_ACTIVITY_PATHS.sopir);
        }
      } catch (e) {
        if (cancelled || skipJourneyLoadRef.current) return;
        if (e instanceof Error && e.message.includes('Perjalanan dinas tidak ditemukan')) {
          skipJourneyLoadRef.current = true;
          router.replace(EMPLOYEE_ACTIVITY_PATHS.sopir);
          return;
        }
        console.error('Error loading journey:', e);
        router.replace(EMPLOYEE_ACTIVITY_PATHS.sopir);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchJourney();
    return () => {
      cancelled = true;
      if (journeyLoadAttemptRef.current === journeyLoadKey) {
        journeyLoadAttemptRef.current = null;
      }
    };
  }, [journeyIdParam, editReportIdParam, profile?.linkedEmployeeId, isSopir, authLoading, router, user]);

  const recalculateRouteChain = useCallback(async (
    list: any[],
    overrideStartPoint?: string,
    overrideStartPointLocation?: DriverJourneyLocation | null,
  ) => {
    if (!activeReportingJourney) return;
    const requestId = ++routeCalculationRequestRef.current;
    const currentStartPoint = overrideStartPoint || activeReportingJourney.startPoint;
    const currentStartPointLocation = overrideStartPoint
      ? overrideStartPointLocation
      : activeReportingJourney.startPointLocation;
    const extraLocs = list.filter(a => a.type === 'tambah_lokasi' && a.destination);

    if (extraLocs.length === 0) {
      if (requestId !== routeCalculationRequestRef.current) return;
      setIsCalculatingExtraRoute(false);
      setExtraRouteError('');
      setHasMeasuredRoundTrip(false);
      setCalculatedDistanceKm(0);
      setCalculatedDurationHours(0);
      setOutboundDistanceKm(0);
      setOutboundDurationHours(0);
      return;
    }

    setIsCalculatingExtraRoute(true);
    setExtraRouteError('');
    setHasMeasuredRoundTrip(false);
    try {
      if (!user) throw new Error('Sesi tidak ditemukan.');
      const idToken = await user.getIdToken();
      // The stop list is the route, in order, and closes back at the departure
      // point. Nothing is pinned to a fixed position any more.
      const points = closeDriverJourneyRoundTrip([
        driverJourneyRoutePoint(currentStartPoint, currentStartPointLocation),
        ...extraLocs.map((location) => (
          driverJourneyRoutePoint(location.destination, location.destinationLocation)
        )),
      ]);
      if (points.length < 3) {
        throw new Error('Titik awal dan minimal satu tujuan wajib diisi sebelum rute diukur.');
      }

      const response = await fetch('/api/calculate-route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ points }),
      });
      const resData = await response.json();
      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Gagal menghitung rute.');
      }
      if (!(resData.distanceKm > 0) || !Number.isFinite(resData.durationHours)) {
        throw new Error('Google Maps tidak mengembalikan jarak pulang-pergi yang valid.');
      }
      if (requestId !== routeCalculationRequestRef.current) return;

      setCalculatedDistanceKm(resData.distanceKm);
      setCalculatedDurationHours(resData.durationHours);

      if (resData.legs && resData.legs.length > 0) {
        const leg0Dist = parseLegDistance(resData.legs[0].distanceText) || resData.legs[0].distanceKm || 0;
        const leg0Dur = resData.legs[0].durationHours || 0;
        setOutboundDistanceKm(leg0Dist);
        setOutboundDurationHours(leg0Dur);
      }

      const updated = [...list];
      let locCounter = 0;
      updated.forEach((act, idx) => {
        if (act.type === 'tambah_lokasi') {
          if (act.destination) {
            // `points` opens with the departure point and every stop follows in
            // order, so the leg arriving at stop `n` is `legs[n]`. It used to be
            // `legs[n + 1]` only because the first destination was pinned ahead
            // of the list rather than being part of it.
            const leg = resData.legs[locCounter];
            if (leg) {
              const dist = parseLegDistance(leg.distanceText);
              const dur = leg.durationHours || 0;
              const cost = dist * (activeReportingJourney?.vehicleRate || 0);
              updated[idx] = {
                ...act,
                distanceText: leg.distanceText,
                distanceKm: dist,
                durationHours: dur,
                durationText: leg.durationText || '',
                legCost: cost
              };
            }
            locCounter++;
          } else {
            updated[idx] = {
              ...act,
              distanceText: '',
              distanceKm: 0,
              durationHours: 0,
              durationText: '',
              legCost: 0
            };
          }
        }
      });
      setExtraActivities(updated);
      setHasMeasuredRoundTrip(true);

    } catch (err: any) {
      if (requestId !== routeCalculationRequestRef.current) return;
      console.error(err);
      setHasMeasuredRoundTrip(false);
      setExtraRouteError(err.message || 'Terjadi kesalahan saat menghitung rute.');
    } finally {
      if (requestId === routeCalculationRequestRef.current) {
        setIsCalculatingExtraRoute(false);
      }
    }
  }, [activeReportingJourney, user]);

  // Rebuild the complete start → destination → ... → start route as soon as
  // the journey report is hydrated. Previously this only happened after the
  // main destination was reconfirmed in the location modal.
  useEffect(() => {
    if (
      !routeHydrationKey ||
      !activeReportingJourney ||
      activeReportingJourney.id !== routeHydrationKey
    ) return;
    if (routeHydratedJourneyRef.current === routeHydrationKey) return;
    routeHydratedJourneyRef.current = routeHydrationKey;

    void recalculateRouteChain(extraActivities);
  }, [routeHydrationKey, activeReportingJourney?.id, extraActivities, recalculateRouteChain]);

  // Every stop, in the order the sopir drove it. There is no privileged first
  // destination any more, so both of these are just the stop list projected
  // onto the shapes the rest of the app already stores.
  const currentStops = useMemo(() => (
    extraActivities.filter((activity) => (
      activity?.type === 'tambah_lokasi' && activity?.destination
    ))
  ), [extraActivities]);

  const currentMainDestinations = useMemo<string[]>(() => (
    currentStops.map((activity) => String(activity.destination).trim()).filter(Boolean)
  ), [currentStops]);

  const currentMainDestinationLocations = useMemo(() => (
    currentStops.map((activity) => (
      normalizeDriverJourneyLocation(activity.destinationLocation, activity.destination)
    ))
  ), [currentStops]);

  // Mirrors the server, which re-derives this from the journey document on
  // submit. A report still being filled in has not been paid, so a journey
  // authorized before the policy settles under the current one.
  const mealAccountingMode = resolveMealAccountingMode(
    activeReportingJourney?.mealAccountingMode,
    { alreadyApproved: false },
  );
  const mealPaidInWage = mealAccountingMode === 'upah_bersih_gross';

  const getOriginForLocationIndex = (index: number): string => {
    if (!activeReportingJourney) return '';
    for (let i = index - 1; i >= 0; i--) {
      if (extraActivities[i].type === 'tambah_lokasi' && extraActivities[i].destination) {
        return extraActivities[i].destination;
      }
    }
    // The first stop is reached from the departure point, not from another stop.
    return activeReportingJourney.startPoint;
  };

  const getReturnLegDetails = () => {
    if (!activeReportingJourney) return { distanceText: '', legCost: 0, distanceKm: 0, durationHours: 0 };

    let extraSum = 0;
    let extraDurSum = 0;
    extraActivities.forEach(act => {
      if (act.type === 'tambah_lokasi' && act.distanceKm) {
        extraSum += act.distanceKm;
        extraDurSum += act.durationHours || 0;
      }
    });

    // Every stop now carries the leg that arrives at it, the first destination
    // included, so the legs already sum to the whole route minus the closing
    // leg home. Subtracting a separate outbound leg here would count it twice.
    const returnDist = Math.max(0, calculatedDistanceKm - extraSum);
    const returnDur = Math.max(0, calculatedDurationHours - extraDurSum);
    const returnCost = returnDist * (activeReportingJourney.vehicleRate || 0);

    return {
      distanceText: `${returnDist.toFixed(1)} km`,
      legCost: returnCost,
      distanceKm: returnDist,
      durationHours: returnDur
    };
  };

  const draftAutosave = useJourneyReportDraft(
    activeReportingJourney?.id === draftLoadedJourneyId ? draftLoadedJourneyId : null,
    {
      formDate,
      formDateEnd,
      formIsMultiDay,
      formTimeStart,
      formTimeEnd,
      formNightCount,
      formNdalemMealMoneyFee,
      formFuelFee,
      formTollParkingFee,
      formFuelReceiptUrls,
      formTollReceiptUrls,
      formFuelReceiptEvidence,
      formTollReceiptEvidence,
      startPoint: activeReportingJourney?.startPoint || '',
      startPointLocation: activeReportingJourney?.startPointLocation || null,
      mainDestinations: currentMainDestinations,
      mainDestinationLocations: currentMainDestinationLocations,
      extraActivities,
      calculatedDistanceKm,
      calculatedDurationHours,
      outboundDistanceKm,
      outboundDurationHours,
    },
  );

  const handleBackToDashboard = async () => {
    if (activeReportingJourney && !skipSaveDraftRef.current) {
      await draftAutosave.flush();
    }
    router.push(EMPLOYEE_ACTIVITY_PATHS.sopir);
  };

  const resetMapSearch = () => {
    cancelPlaceSearch();
    mapGeocodeRequestRef.current += 1;
    setMapSearchError('');
  };

  const geocodeMapSearch = (queryText: string, displayLabel?: string) => {
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
            mapRef.current?.setCenter(location);
            mapRef.current?.setZoom(16);
            markerRef.current?.setPosition(location);

            // Google may return an Open Location Code (for example,
            // "F74H+J34") as the formatted address. Keep the place title the
            // sopir selected for display and persistence while still using the
            // geocoder result's coordinates for routing.
            const selectedAddress = displayLabel?.trim() || firstResult.formatted_address || normalizedQuery;
            setMapAddress(selectedAddress);
            setMapSearchText(selectedAddress);
            setMapLocation({
              address: selectedAddress,
              latitude: typeof location.lat === 'function' ? location.lat() : Number(location.lat),
              longitude: typeof location.lng === 'function' ? location.lng() : Number(location.lng),
            });
            setMapSearchError('');
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
    setMapSearchText(suggestion.primaryText);
    geocodeMapSearch(suggestion.queryText, suggestion.primaryText);
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

  const handleAddLocation = () => {
    if (currentMainDestinations.length >= MAX_DRIVER_JOURNEY_DESTINATIONS) {
      setExtraRouteError(`Maksimal ${MAX_DRIVER_JOURNEY_DESTINATIONS} titik tujuan dapat ditambahkan.`);
      return;
    }
    const newIdx = extraActivities.length;
    routeCalculationRequestRef.current += 1;
    resetMapSearch();
    setIsCalculatingExtraRoute(false);
    setHasMeasuredRoundTrip(false);
    setExtraRouteError('');
    setExtraActivities([...extraActivities, {
      type: 'tambah_lokasi',
      destination: '',
      destinationLocation: null,
    }]);
    setMapTargetIndex(newIdx);
    setMapSearchText('');
    setMapAddress('');
    setMapLocation(null);
    setShowMapSelector(true);
  };

  const handleRemoveExtraActivity = async (index: number) => {
    const updated = extraActivities.filter((_, idx) => idx !== index);
    setExtraActivities(updated);
    await recalculateRouteChain(updated);
  };

  // Reordering is how the sopir records the order actually driven, so a stop
  // added mid-journey can be moved ahead of one that was planned.
  const handleMoveExtraActivity = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= extraActivities.length) return;
    const updated = [...extraActivities];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setExtraActivities(updated);
    await recalculateRouteChain(updated);
  };

  const handleConfirmMapLocation = async () => {
    if (mapTargetIndex === -2) {
      const newStartPoint = mapAddress.trim();
      if (!newStartPoint || !mapLocation) return;
      setActiveReportingJourney((prev: any) => ({
        ...prev,
        startPoint: newStartPoint,
        startPointLocation: mapLocation,
      }));
      resetMapSearch();
      setShowMapSelector(false);
      setMapTargetIndex(null);
      await recalculateRouteChain(
        extraActivities,
        newStartPoint,
        mapLocation,
      );
      return;
    }

    if (mapTargetIndex === null || !mapLocation) return;
    const updated = [...extraActivities];
    if (!updated[mapTargetIndex]) return;
    updated[mapTargetIndex] = {
      ...updated[mapTargetIndex],
      destination: mapAddress.trim(),
      destinationLocation: mapLocation,
    };
    setExtraActivities(updated);
    resetMapSearch();
    setShowMapSelector(false);
    setMapTargetIndex(null);
    await recalculateRouteChain(updated);
  };

  const handleCloseMapSelector = () => {
    resetMapSearch();
    setShowMapSelector(false);
    if (
      mapTargetIndex !== null &&
      mapTargetIndex !== -2 &&
      extraActivities[mapTargetIndex] &&
      !extraActivities[mapTargetIndex].destination
    ) {
      setExtraActivities((prev) => prev.filter((_, idx) => idx !== mapTargetIndex));
    }
    setMapTargetIndex(null);
  };

  const handleUploadReceipt = async (file: File, type: 'bbm' | 'toll') => {
    if (!activeReportingJourney) return;
    const isBbm = type === 'bbm';
    if (isBbm) setUploadingFuelReceipt(true);
    else setUploadingTollReceipt(true);

    try {
      const prepared = await prepareProofImage(file);
      const downloadUrl = await uploadProofFile('/api/uploads/receipts', prepared.file, {
        journeyId: activeReportingJourney.id,
        type,
      });
      if (isBbm) {
        setFormFuelReceiptUrls(prev => [...prev, downloadUrl]);
        setFormFuelReceiptEvidence(prev => [...prev, { url: downloadUrl, auditMetadata: prepared.auditMetadata }]);
      } else {
        setFormTollReceiptUrls(prev => [...prev, downloadUrl]);
        setFormTollReceiptEvidence(prev => [...prev, { url: downloadUrl, auditMetadata: prepared.auditMetadata }]);
      }
      setMessage({ type: 'success', text: `Bukti ${isBbm ? 'BBM' : 'Tol & Parkir'} berhasil diunggah.` });
    } catch (err: any) {
      console.error(`Error uploading ${type} receipt:`, err);
      setMessage({ type: 'error', text: `Gagal mengunggah bukti ${isBbm ? 'BBM' : 'Tol & Parkir'}. Coba lagi.` });
    } finally {
      if (isBbm) setUploadingFuelReceipt(false);
      else setUploadingTollReceipt(false);
    }
  };

  const [showCancelModal, setShowCancelModal] = useState(false);

  const isSelfCreatedJourney = useMemo(() => {
    return activeReportingJourney ? isSelfCreatedDriverJourney(activeReportingJourney) : false;
  }, [activeReportingJourney]);

  // Same rule the server enforces: only a self-authorized journey still under
  // way, with no BBM held yet, may switch vehicles.
  const canChangeVehicle = useMemo(() => {
    return Boolean(
      activeReportingJourney &&
        !activeReportingJourney.editingActivityDocId &&
        driverVehicleChangeBlocker(activeReportingJourney) === null,
    );
  }, [activeReportingJourney]);
  const [showVehicleDialog, setShowVehicleDialog] = useState(false);

  const handleVehicleChanged = (result: ChangeJourneyVehicleResult) => {
    if (!result.changed) return;
    setActiveReportingJourney((previous: any) => previous ? {
      ...previous,
      vehicleName: result.vehicleName,
      vehicleRate: result.vehicleRate,
      fuelProcurementMode: result.fuelProcurementMode,
      fuelReservationVehicleName: result.vehicleName,
      fuelModeSelectionRequired: false,
      fuelBalance: result.fuelBalance,
      driverVehicleChanges: result.driverVehicleChanges,
    } : previous);
    setSelectedFuelMode(result.fuelProcurementMode);
    // Neither a hold nor Ndalem takes a fuel purchase; a stale amount would
    // otherwise demand a receipt the form no longer shows.
    if (result.fuelProcurementMode === 'hold_accumulate' || result.vehicleName === 'Ndalem') {
      setFormFuelFee('');
      setFormFuelReceiptUrls([]);
      setFormFuelReceiptEvidence([]);
    }
    setMessage({ type: 'success', text: `Kendaraan diganti ke ${result.vehicleName}.` });
  };

  // Only journeys authorized under the "authorizing is departing" rule carry
  // this flag, so reports already in flight when it shipped stay editable.
  const isDepartureLocked = useMemo(() => {
    return activeReportingJourney?.departureLockedToAuthorization === true;
  }, [activeReportingJourney?.departureLockedToAuthorization]);

  const canEditMainDestination = useMemo(() => {
    return activeReportingJourney?.status === 'claimed';
  }, [activeReportingJourney?.status]);

  const activeFuelMode: FuelProcurementMode = isFuelProcurementMode(
    activeReportingJourney?.fuelProcurementMode,
  )
    ? activeReportingJourney.fuelProcurementMode
    : selectedFuelMode;
  const fuelModeSelectionRequired = Boolean(
    activeReportingJourney?.fuelModeSelectionRequired &&
      activeReportingJourney?.vehicleName !== 'Ndalem',
  );

  const handleSelectFuelMode = async (mode: FuelProcurementMode) => {
    if (!activeReportingJourney || selectingFuelMode) return;
    setSelectingFuelMode(true);
    try {
      const result = await authenticatedJson<{
        fuelProcurementMode: FuelProcurementMode;
        fuelBalance: any;
        heldFuelAmount?: number;
        procuredAccumulatedAmount?: number;
        fuelAllowanceForSettlement?: number;
        fuelTotalAllocation?: number;
        totalOperationalCost?: number;
      }>('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({
          action: 'select_fuel_mode',
          journeyId: activeReportingJourney.id,
          fuelProcurementMode: mode,
        }),
      });
      setSelectedFuelMode(result.fuelProcurementMode);
      if (result.fuelProcurementMode === 'hold_accumulate') {
        setFormFuelFee('');
        setFormFuelReceiptUrls([]);
        setFormFuelReceiptEvidence([]);
      }
      setActiveReportingJourney((previous: any) => previous ? {
        ...previous,
        fuelProcurementMode: result.fuelProcurementMode,
        heldFuelAmount: result.heldFuelAmount ?? previous.heldFuelAmount,
        procuredAccumulatedAmount:
          result.procuredAccumulatedAmount ?? previous.procuredAccumulatedAmount,
        fuelAllowanceForSettlement:
          result.fuelAllowanceForSettlement ?? previous.fuelAllowanceForSettlement,
        fuelTotalAllocation: result.fuelTotalAllocation ?? previous.fuelTotalAllocation,
        totalOperationalCost: result.totalOperationalCost ?? previous.totalOperationalCost,
        fuelModeSelectionRequired: false,
        fuelBalance: result.fuelBalance ?? previous.fuelBalance,
      } : previous);
      setMessage({ type: 'success', text: 'Mode pengadaan BBM berhasil disimpan.' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Mode pengadaan BBM gagal disimpan.' });
    } finally {
      setSelectingFuelMode(false);
    }
  };

  const handleOpenCancelModal = () => {
    setShowCancelModal(true);
  };

  const handleConfirmCancelClaim = async () => {
    if (!activeReportingJourney || isCancelling) return;

    setIsCancelling(true);
    skipSaveDraftRef.current = true;
    skipJourneyLoadRef.current = true;
    try {
      await draftAutosave.pause();
      await authenticatedJson(
        `/api/pekarya/activities?journeyId=${encodeURIComponent(activeReportingJourney.id)}${activeReportingJourney.activityDocId ? `&reportId=${encodeURIComponent(activeReportingJourney.activityDocId)}` : ''}`,
        { method: 'DELETE' }
      );

      if (typeof window !== 'undefined' && activeReportingJourney?.id) {
        localStorage.removeItem(`journey_draft_${activeReportingJourney.id}`);
        sessionStorage.setItem('cancelled_driver_journey_id', activeReportingJourney.id);
        sessionStorage.setItem('cancelled_driver_journey_at', String(Date.now()));
      }
      setShowCancelModal(false);
      setActiveReportingJourney(null);
      router.replace(EMPLOYEE_ACTIVITY_PATHS.sopir);
    } catch (err: any) {
      console.error('Error cancelling journey claim:', err);
      setMessage({ type: 'error', text: err.message || 'Gagal membatalkan klaim perjalanan.' });
      setIsCancelling(false);
      skipSaveDraftRef.current = false;
      skipJourneyLoadRef.current = false;
      draftAutosave.resume();
      setShowCancelModal(false);
    }
  };

  const handleCompleteJourneySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReportingJourney || isSubmittingRef.current) return;
    if (isCalculatingExtraRoute || !hasMeasuredRoundTrip || extraRouteError) {
      setMessage({
        type: 'error',
        text: 'Jarak pulang-pergi aktual harus berhasil diukur Google Maps sebelum laporan dikirim.',
      });
      return;
    }
    if (fuelModeSelectionRequired) {
      setMessage({ type: 'error', text: 'Pilih mode pengadaan BBM sebelum mengirim laporan.' });
      return;
    }
    if (!profile?.linkedEmployeeId) {
      setMessage({ type: 'error', text: 'Akun Anda belum terhubung ke data Pegawai.' });
      return;
    }
    if (!activeReportingJourney.startPoint?.trim() || currentMainDestinations.length === 0) {
      setMessage({ type: 'error', text: 'Titik awal dan minimal satu tujuan utama wajib diisi.' });
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);
    skipSaveDraftRef.current = true;

    if (!formDate) {
      setMessage({ type: 'error', text: 'Tanggal perjalanan harus diisi.' });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      return;
    }
    const timeRegex = /^([0-9]{2}):([0-9]{2})$/;
    if (!formTimeStart || !formTimeEnd || !timeRegex.test(formTimeStart) || !timeRegex.test(formTimeEnd)) {
      setMessage({ type: 'error', text: 'Format waktu berangkat dan tiba harus JJ:MM (contoh: 08:00).' });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      return;
    }
    const checkTimings = calculateJourneyDateTimeTimings({
      dateStart: formDate,
      timeStart: formTimeStart,
      dateEnd: formIsMultiDay ? (formDateEnd || formDate) : formDate,
      timeEnd: formTimeEnd,
      isMultiDay: formIsMultiDay,
    });

    if (isInvalidSingleDayTime) {
      setMessage({
        type: 'error',
        text: `Jam tiba (${formTimeEnd}) tidak boleh sebelum atau sama dengan jam berangkat (${formTimeStart}) pada perjalanan hari yang sama. Silakan centang "Perjalanan Lintas Hari / Menginap" jika perjalanan melintasi tengah malam.`,
      });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      return;
    }

    if (checkTimings.durationHours <= 0) {
      setMessage({ type: 'error', text: 'Jam tiba dan tanggal tidak membentuk durasi perjalanan yang valid.' });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      return;
    }

    try {
      const isHoldAccumulate = activeFuelMode === 'hold_accumulate';
      const fuelVal = isHoldAccumulate
        ? 0
        : (formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0);
      const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;
      const submittedFuelReceiptUrls = !isHoldAccumulate && fuelVal > 0
        ? formFuelReceiptUrls.filter(Boolean)
        : [];
      const submittedTollReceiptUrls = tollVal > 0
        ? formTollReceiptUrls.filter(Boolean)
        : [];
      const submittedFuelReceiptEvidence =
        submittedFuelReceiptUrls.length > 0 &&
        formFuelReceiptEvidence.length === submittedFuelReceiptUrls.length
          ? formFuelReceiptEvidence
          : [];
      const submittedTollReceiptEvidence =
        submittedTollReceiptUrls.length > 0 &&
        formTollReceiptEvidence.length === submittedTollReceiptUrls.length
          ? formTollReceiptEvidence
          : [];

      if (
        activeFuelMode === 'procure_release' &&
        (fuelVal <= 0 || submittedFuelReceiptUrls.length === 0)
      ) {
        setMessage({
          type: 'error',
          text: 'Mode Cairkan wajib menyertakan nominal pembelian aktual dan bukti BBM.',
        });
        isSubmittingRef.current = false;
        setSubmitting(false);
        skipSaveDraftRef.current = false;
        return;
      }

      if (fuelVal <= 0 || submittedFuelReceiptUrls.length === 0) {
        setFormFuelReceiptUrls([]);
        setFormFuelReceiptEvidence([]);
      }
      if (tollVal <= 0 || submittedTollReceiptUrls.length === 0) {
        setFormTollReceiptUrls([]);
        setFormTollReceiptEvidence([]);
      }

      if (!isHoldAccumulate && fuelVal > 0 && submittedFuelReceiptUrls.length === 0) {
        setMessage({ type: 'error', text: 'Mohon unggah bukti reimburse BBM terlebih dahulu.' });
        isSubmittingRef.current = false;
        setSubmitting(false);
        skipSaveDraftRef.current = false;
        return;
      }
      if (tollVal > 0 && submittedTollReceiptUrls.length === 0) {
        setMessage({ type: 'error', text: 'Mohon unggah bukti tol & parkir terlebih dahulu.' });
        isSubmittingRef.current = false;
        setSubmitting(false);
        skipSaveDraftRef.current = false;
        return;
      }

      const isNdalem = activeReportingJourney.vehicleName === 'Ndalem';
      const originalTotalDist = (activeReportingJourney.distanceKm || 0) * 2;
      const extraDistanceKm = Math.max(0, calculatedDistanceKm - originalTotalDist);
      const extraOperationalCost = 0; // Extra mileage is compensated via Upah Bersih Sopir (distance component), not automatic cash reimbursement without receipts

      const preAuthorizedDurationPP = activeReportingJourney.customDurationPP || (activeReportingJourney.durationHours ? activeReportingJourney.durationHours * 2 : 0);
      // No meal cash is advanced under the new mode — it is earned in Upah
      // Bersih — so there is no allowance to settle against.
      const preAuthorizedMeal = mealPaidInWage
        ? 0
        : isNdalem
          ? 0
          : (activeReportingJourney.mealAllowance !== undefined && activeReportingJourney.mealAllowance !== null && activeReportingJourney.mealAllowance > 0
            ? activeReportingJourney.mealAllowance
            : getMealAllowanceForDuration(preAuthorizedDurationPP));

      const preAuthorizedToll = activeReportingJourney.preAuthorizedToll !== undefined && activeReportingJourney.preAuthorizedToll !== null
        ? Number(activeReportingJourney.preAuthorizedToll)
        : (activeReportingJourney.status === 'claimed' ? Number(activeReportingJourney.tollParkingFee || 0) : 0);
      const baseCostVal = activeReportingJourney.baseOperationalCost !== undefined && activeReportingJourney.baseOperationalCost !== null
        ? Number(activeReportingJourney.baseOperationalCost)
        : Math.max(0, (activeReportingJourney.totalOperationalCost || 0) - preAuthorizedMeal - preAuthorizedToll);
      const procuredAccumulatedAmount = activeFuelMode === 'procure_release'
        ? Math.max(0, Number(activeReportingJourney.procuredAccumulatedAmount || 0))
        : 0;
      const timings = calculateJourneyDateTimeTimings({
        dateStart: formDate,
        timeStart: formTimeStart,
        dateEnd: formIsMultiDay ? (formDateEnd || formDate) : formDate,
        timeEnd: formTimeEnd,
        isMultiDay: formIsMultiDay,
      });
      const effectiveDateEnd = formIsMultiDay ? (formDateEnd || formDate) : formDate;
      const effectiveNightCount = formIsMultiDay ? timings.nightCount : 0;
      const elapsedHours = timings.durationHours > 0 ? timings.durationHours : calculateElapsedHours(formTimeStart, formTimeEnd, effectiveNightCount);
      const routeDurationHours = calculatedDurationHours > 0 ? calculatedDurationHours : elapsedHours;
      const submittedDurationHours = elapsedHours > 0 ? elapsedHours : routeDurationHours;

      const ndalemMealMoneyVal = formNdalemMealMoneyFee ? (parseInt(formNdalemMealMoneyFee.replace(/\D/g, ''), 10) || 0) : 0;
      // Gross under the new mode: money handed over during the trip is
      // recorded but never nets the entitlement down.
      const actualMealAllowance = mealPaidInWage
        ? getGrossMealAllowanceForDuration(elapsedHours)
        : getMealAllowanceForDuration(
            elapsedHours,
            activeReportingJourney.vehicleName,
            ndalemMealMoneyVal,
          );
      const extraMealAllowance = mealPaidInWage
        ? 0
        : isNdalem ? actualMealAllowance : Math.max(0, actualMealAllowance - preAuthorizedMeal);

      const settlement = calculateDriverReimbursementSettlement({
        fuelAllowance: isNdalem ? 0 : baseCostVal,
        fuelSpent: isNdalem ? 0 : fuelVal,
        tollAllowance: preAuthorizedToll,
        tollSpent: tollVal,
        additionalReimbursement: extraMealAllowance + extraOperationalCost,
        fuelProcurementMode: isNdalem ? DEFAULT_FUEL_PROCUREMENT_MODE : activeFuelMode,
        procuredAccumulatedAmount,
      });
      const authorizedTotalOperationalCost =
        settlement.effectiveFuelAllowance + preAuthorizedMeal + preAuthorizedToll;
      const adjustedTotalOperationalCost = Math.max(
        0,
        authorizedTotalOperationalCost +
          settlement.netOperationalDelta +
          extraMealAllowance +
          extraOperationalCost,
      );

      const nightPremium = calculateNightPremium(effectiveNightCount);
      const baseDriverWage = calculateDriverNetWage({
        distanceKm: calculatedDistanceKm,
        travelTimeHours: routeDurationHours,
        elapsedDurationHours: submittedDurationHours,
        nightCount: effectiveNightCount,
        mealAccountingMode,
      });
      const finalUpahBersih = Math.max(0, baseDriverWage - settlement.remainingUnspentCash);

      // The stop list is the route: one ordered chain from the departure point
      // through every destination, no stop grouped ahead of another.
      const submittedRoutePoints = [
        activeReportingJourney.startPoint,
        ...currentMainDestinations,
      ];

      const startShort = (activeReportingJourney.startPoint || '').split(',')[0].trim();
      const routeText = ` (${[startShort, ...currentMainDestinations.map((destination: string) => (
        destination.split(',')[0].trim()
      ))].join(' → ')})`;
      let finalActivityName = ((activeReportingJourney.activityName || 'Perjalanan Sopir') + routeText).trim();
      if (finalActivityName.length > 180) {
        finalActivityName = finalActivityName.slice(0, 177) + '...';
      }

      await draftAutosave.pause();
      await authenticatedJson('/api/pekarya/activities', {
        method: 'POST',
        body: JSON.stringify({
          requestId: createFinancialRequestId('driver_activity_submit'),
          reportId: activeReportingJourney.editingActivityDocId || undefined,
          activityName: finalActivityName,
          activityType: 'Lainnya',
          activityDate: formDate,
          timeStart: formTimeStart,
          timeEnd: formTimeEnd,
          driverData: {
            tripType: calculatedDistanceKm > 50 ? 'Luar Kota' : 'Dalam Kota',
            vehicleType: activeReportingJourney.vehicleName,
            fuelProcurementMode: activeFuelMode,
            heldFuelAmount: activeFuelMode === 'hold_accumulate' ? Math.ceil(baseCostVal) : 0,
            procuredAccumulatedAmount,
            nightCount: effectiveNightCount,
            dateStart: formDate,
            dateEnd: effectiveDateEnd,
            isMultiDay: formIsMultiDay,
            fuelFee: fuelVal,
            tollParkingFee: tollVal,
            fuelReceiptUrl: submittedFuelReceiptUrls.join(','),
            tollReceiptUrl: submittedTollReceiptUrls.join(','),
            ...(submittedFuelReceiptEvidence.length > 0 ? { fuelReceiptEvidence: submittedFuelReceiptEvidence } : {}),
            ...(submittedTollReceiptEvidence.length > 0 ? { tollReceiptEvidence: submittedTollReceiptEvidence } : {}),
            startPoint: activeReportingJourney.startPoint,
            startPointLocation: activeReportingJourney.startPointLocation || null,
            mainDestinations: currentMainDestinations,
            mainDestinationLocations: currentMainDestinationLocations,
            points: submittedRoutePoints,
            reportedEndPoint: currentMainDestinations[0] || activeReportingJourney.endPoint || undefined,
            distanceKm: calculatedDistanceKm,
            durationHours: submittedDurationHours,
            routeDurationHours,
            journeyId: activeReportingJourney.id,
            extraActivities,
            extraDistanceKm,
            extraOperationalCost,
            extraFuelCost: settlement.extraFuelCost,
            extraTollCost: settlement.extraTollCost,
            extraMealAllowance,
            ndalemMealMoneyReceived: formNdalemMealMoneyFee ? (parseInt(formNdalemMealMoneyFee.replace(/\D/g, ''), 10) || 0) : 0,
            positiveReimburseDelta: settlement.positiveReimburseDelta,
            baseDriverWage,
            upahBersih: finalUpahBersih,
            reimburseDelta: settlement.reimburseDelta,
            unspentCash: settlement.unspentCash,
            remainingUnspentCash: settlement.remainingUnspentCash,
            netOperationalDelta: settlement.netOperationalDelta,
            fuelAllowanceSurplus: settlement.fuelAllowanceSurplus,
            tollAllowanceSurplus: settlement.tollAllowanceSurplus,
            fuelAllowanceForSettlement: settlement.effectiveFuelAllowance,
            fuelTotalAllocation: settlement.effectiveFuelAllowance,
            baseOperationalCost: baseCostVal,
            preAuthorizedMeal,
            preAuthorizedToll,
            customDurationPP: preAuthorizedDurationPP,
            totalPreAuthorizedAllowance: settlement.totalPreAuthorizedAllowance,
            totalActualSpent: settlement.totalActualSpent,
            totalOperationalCost: adjustedTotalOperationalCost,
            vehicleRate: activeReportingJourney.vehicleRate ?? 1000,
            componentJarak: Math.ceil(calculatedDistanceKm * 300),
            componentWaktu: Math.ceil(routeDurationHours * 5000),
            nightPremium,
          },
        }),
      });

      if (typeof window !== 'undefined' && activeReportingJourney?.id) {
        localStorage.removeItem(`journey_draft_${activeReportingJourney.id}`);
        sessionStorage.setItem('submitted_driver_journey_id', activeReportingJourney.id);
        sessionStorage.setItem('submitted_driver_journey_at', String(Date.now()));
      }
      router.replace('/employee/driver-history');
    } catch (err: any) {
      console.error('Error submitting journey report:', err);
      setMessage({ type: 'error', text: err.message || 'Gagal mengirim laporan perjalanan.' });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      draftAutosave.resume();
    }
  };

  const initMap = (element: HTMLDivElement) => {
    loadGoogleMapsScript(() => {
      const google = (window as any).google;
      if (!google) return;
      if (mapRef.current && mapElementRef.current === element) return;
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
        map: map,
        draggable: true,
        animation: google.maps.Animation.DROP,
      });
      markerRef.current = marker;

      const geocoder = new google.maps.Geocoder();

      const updateAddress = (latLng: any, syncSearchText = true) => {
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
          setMapLocation({ address, latitude, longitude });
          if (syncSearchText) setMapSearchText(address);
          setMapSearchError('');
        });
      };

      const existingAddress = mapAddress;
      const existingLocation = normalizeDriverJourneyLocation(mapLocation, existingAddress);
      if (existingLocation) {
        const position = {
          lat: existingLocation.latitude,
          lng: existingLocation.longitude,
        };
        map.setCenter(position);
        map.setZoom(15);
        marker.setPosition(position);
        setMapLocation(existingLocation);
      } else if (existingAddress) {
        // Compatibility path for existing reports saved before coordinates.
        geocoder.geocode({ address: existingAddress, region: 'id' }, (results: any, status: any) => {
          if (status === 'OK' && results[0] && results[0].geometry && results[0].geometry.location) {
            const loc = results[0].geometry.location;
            const address = results[0].formatted_address || existingAddress;
            map.setCenter(loc);
            map.setZoom(15);
            marker.setPosition(loc);
            setMapAddress(address);
            setMapSearchText(address);
            setMapLocation({
              address,
              latitude: typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat),
              longitude: typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng),
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
        const pos = marker.getPosition();
        if (pos) updateAddress(pos);
      });

      map.addListener('click', (e: any) => {
        if (e.latLng) {
          marker.setPosition(e.latLng);
          updateAddress(e.latLng);
        }
      });
    });
  };

  if (loading) {
    return <JourneyReportPageSkeleton />;
  }

  if (!activeReportingJourney) return null;

  const returnLeg = getReturnLegDetails();

  // ── Derived figures for the render. Same formulas the inline blocks used;
  //    they are computed once here so every section reads the same numbers.
  const isNdalem = activeReportingJourney.vehicleName === 'Ndalem';
  const journeyTimings = calculateJourneyDateTimeTimings({
    dateStart: formDate,
    timeStart: formTimeStart,
    dateEnd: formIsMultiDay ? (formDateEnd || formDate) : formDate,
    timeEnd: formTimeEnd,
    isMultiDay: formIsMultiDay,
  });
  const effectiveNights = formIsMultiDay ? journeyTimings.nightCount : 0;
  const isNextDayArriveBefore5AM = (formDateEnd && formDateEnd > formDate) && parseInt(formTimeEnd.split(':')[0], 10) < 5;
  const elapsedHours = journeyTimings.durationHours > 0
    ? journeyTimings.durationHours
    : calculateElapsedHours(formTimeStart, formTimeEnd, effectiveNights);

  const preAuthorizedToll = activeReportingJourney.preAuthorizedToll !== undefined && activeReportingJourney.preAuthorizedToll !== null
    ? Number(activeReportingJourney.preAuthorizedToll)
    : (activeReportingJourney.status === 'claimed' ? Number(activeReportingJourney.tollParkingFee || 0) : 0);
  const baseCostVal = activeReportingJourney.baseOperationalCost !== undefined && activeReportingJourney.baseOperationalCost !== null
    ? Number(activeReportingJourney.baseOperationalCost)
    : Math.max(0, (activeReportingJourney.totalOperationalCost || 0) - (activeReportingJourney.mealAllowance || 0) - preAuthorizedToll);
  const procuredAmount = activeFuelMode === 'procure_release'
    ? Math.max(0, Number(activeReportingJourney.procuredAccumulatedAmount || 0))
    : 0;
  const displayedFuelAllowance = activeFuelMode === 'hold_accumulate'
    ? 0
    : baseCostVal + procuredAmount;

  const totalHakUangMakan = mealPaidInWage
    ? getGrossMealAllowanceForDuration(elapsedHours)
    : getMealAllowanceForDuration(elapsedHours, activeReportingJourney.vehicleName);
  const qtyHakMakan = Math.round(totalHakUangMakan / 20000);
  const mealMoneyProvided = formNdalemMealMoneyFee ? (parseInt(formNdalemMealMoneyFee.replace(/\D/g, ''), 10) || 0) : 0;
  const unpaidDeltaRp = Math.max(0, totalHakUangMakan - mealMoneyProvided);

  const originalTotalDist = (activeReportingJourney.distanceKm || 0) * 2;
  const extraDistanceKm = Math.max(0, calculatedDistanceKm - originalTotalDist);
  const extraOperationalCost = 0; // Extra mileage is compensated via Upah Bersih Sopir (distance component), not automatic cash reimbursement without receipts
  const originalMealAllowance = activeReportingJourney.mealAllowance || 0;
  const submittedDurationHours = elapsedHours > 0 ? elapsedHours : calculatedDurationHours;
  const actualMealAllowance =
    elapsedHours > 0
      ? (mealPaidInWage
        ? getGrossMealAllowanceForDuration(elapsedHours)
        : getMealAllowanceForDuration(
          elapsedHours,
          activeReportingJourney.vehicleName,
          mealMoneyProvided,
        ))
      : originalMealAllowance;
  // Meal is earned in Upah Bersih under the new mode, so it adds
  // nothing to the reimbursement side of this table.
  const extraMealAllowance = mealPaidInWage
    ? 0
    : isNdalem ? actualMealAllowance : Math.max(0, actualMealAllowance - originalMealAllowance);
  const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
  const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;

  const settlement = calculateDriverReimbursementSettlement({
    fuelAllowance: isNdalem ? 0 : baseCostVal,
    fuelSpent: isNdalem ? 0 : fuelVal,
    tollAllowance: preAuthorizedToll,
    tollSpent: tollVal,
    additionalReimbursement: extraMealAllowance + extraOperationalCost,
    fuelProcurementMode: isNdalem ? DEFAULT_FUEL_PROCUREMENT_MODE : activeFuelMode,
    procuredAccumulatedAmount: procuredAmount,
  });
  const baseDriverWage = calculateDriverNetWage({
    distanceKm: calculatedDistanceKm,
    travelTimeHours: calculatedDurationHours,
    elapsedDurationHours: submittedDurationHours,
    nightCount: effectiveNights,
    mealAccountingMode,
  });
  const finalUpahBersih = Math.max(0, baseDriverWage - settlement.remainingUnspentCash);
  const shortTripMeal = getShortTripMealWageComponent(submittedDurationHours);
  const mealWage = getMealWageComponent(submittedDurationHours, mealAccountingMode);
  const extraToll = isSelfCreatedJourney ? tollVal : tollVal - preAuthorizedToll;

  const journeyDateLabel = (() => {
    const d = formDate || activeReportingJourney.activityDate || getTodayISO();
    return new Date(d.includes('T') ? d : `${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  })();

  const handleTimeEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^0-9]/g, '');
    if (val.length > 4) val = val.slice(0, 4);
    if (val.length === 1 && parseInt(val, 10) > 2) val = `0${val}`;
    if (val.length >= 2) {
      const hours = parseInt(val.slice(0, 2), 10);
      if (hours > 23) val = '23' + val.slice(2);
    }
    if (val.length === 4) {
      const minutes = parseInt(val.slice(2, 4), 10);
      if (minutes > 59) val = val.slice(0, 2) + '59';
    }
    if (val.length > 2) {
      setFormTimeEnd(`${val.slice(0, 2)}:${val.slice(2)}`);
    } else {
      setFormTimeEnd(val);
    }
  };

  // Each stop stores the leg that arrives at it, and the timeline shows it
  // under that stop; the closing leg home shows under Pulang.
  const legLine = (leg: { distanceText?: string; distanceKm?: number; durationHours?: number } | undefined) =>
    leg?.distanceText && leg.distanceKm !== undefined ? (
      <div className="text-[13px] tabular-nums text-slate-500">
        {leg.distanceText} ({fmtRp(Math.ceil((leg.distanceKm * 300) + ((leg.durationHours || 0) * 5000)))})
      </div>
    ) : null;

  const openStartPointPicker = () => {
    resetMapSearch();
    setMapTargetIndex(-2);
    setMapSearchText(activeReportingJourney.startPoint || '');
    setMapAddress(activeReportingJourney.startPoint || '');
    setMapLocation(
      normalizeDriverJourneyLocation(
        activeReportingJourney.startPointLocation,
        activeReportingJourney.startPoint,
      ),
    );
    setShowMapSelector(true);
  };

  const openStopPicker = (index: number, act: (typeof extraActivities)[number]) => {
    resetMapSearch();
    setMapTargetIndex(index);
    setMapSearchText(act.destination || '');
    setMapAddress(act.destination || '');
    setMapLocation(
      normalizeDriverJourneyLocation(
        act.destinationLocation,
        act.destination,
      ),
    );
    setShowMapSelector(true);
  };

  const timeStartField = (
    <Field label="Jam Berangkat" htmlFor="journeyTimeStart">
      <Input
        id="journeyTimeStart"
        type="text"
        inputMode="numeric"
        maxLength={5}
        placeholder="JJ:MM"
        value={formTimeStart}
        disabled={isDepartureLocked}
        onChange={(e) => setFormTimeStart(maskClockInput(e.target.value))}
        onBlur={(e) => setFormTimeStart(padTime(e.target.value))}
        className="h-10 tabular-nums"
        required={!formIsMultiDay}
      />
    </Field>
  );
  const timeEndField = (
    <Field label="Jam Tiba / Selesai" htmlFor="journeyTimeEnd">
      <Input
        id="journeyTimeEnd"
        type="text"
        inputMode="numeric"
        maxLength={5}
        placeholder="JJ:MM"
        value={formTimeEnd}
        onChange={handleTimeEndChange}
        onBlur={(e) => setFormTimeEnd(padTime(e.target.value))}
        aria-invalid={!formIsMultiDay && isInvalidSingleDayTime ? true : undefined}
        className="h-10 tabular-nums"
        required={!formIsMultiDay}
      />
    </Field>
  );

  // Kirim's label says why it cannot be pressed yet.
  const submitLabel = submitting
    ? 'Mengirim…'
    : isCalculatingExtraRoute
      ? 'Menghitung rute…'
      : extraRouteError
        ? 'Rute gagal dihitung'
        : !hasMeasuredRoundTrip
          ? 'Tentukan tujuan'
          : 'Kirim laporan';

  const receiptTitle = (label: string, urls: string[], index: number) =>
    `${label} ${urls.length > 1 ? `#${index + 1}` : ''}`.trim();

  // Non-self-authorized journeys compare what was plotted with what happened.
  const renderPlanVsActual = () => {
    const getStratumLabel = (hours: number): string => {
      if (hours <= 0) return '—';
      const days = Math.floor(hours / 24);
      const remainder = hours % 24;
      return days > 0
        ? `${days} hari + ${remainder.toFixed(1)} jam`
        : `${remainder.toFixed(1)} jam`;
    };

    const preAuthorizedDurationPP = activeReportingJourney.customDurationPP || (activeReportingJourney.durationHours ? activeReportingJourney.durationHours * 2 : 0);
    const plotStrata = getStratumLabel(preAuthorizedDurationPP);
    const actualStrata = getStratumLabel(elapsedHours);
    const dash = <span className="text-slate-400">—</span>;

    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm tabular-nums">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
              <th className="pb-2 pr-2 font-medium">Aspek</th>
              <th className="pb-2 px-2 text-right font-medium">Plotingan</th>
              <th className="pb-2 px-2 text-right font-medium">Aktual</th>
              <th className="pb-2 pl-2 text-right font-medium">Delta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-900">
            <tr>
              <td className="py-2 pr-2">Jarak</td>
              <td className="py-2 px-2 text-right">{originalTotalDist.toFixed(1)} km</td>
              <td className="py-2 px-2 text-right">{calculatedDistanceKm.toFixed(1)} km</td>
              <td className="py-2 pl-2 text-right">
                {extraDistanceKm > 0 ? `+${extraDistanceKm.toFixed(1)} km` : dash}
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-2">
                {activeFuelMode === 'hold_accumulate' ? 'BBM (ditahan)' : 'BBM'}
              </td>
              <td className="py-2 px-2 text-right">
                {activeFuelMode === 'hold_accumulate' ? dash : fmtRp(Math.ceil(settlement.effectiveFuelAllowance))}
              </td>
              <td className="py-2 px-2 text-right">
                {activeFuelMode === 'hold_accumulate' ? dash : fmtRp(Math.ceil(fuelVal))}
              </td>
              <td className="py-2 pl-2 text-right">
                {settlement.fuelDelta !== 0
                  ? `${settlement.fuelDelta > 0 ? '+' : '-'}${fmtRp(Math.ceil(Math.abs(settlement.fuelDelta)))}`
                  : dash}
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-2">
                Uang makan
                {mealPaidInWage && (
                  <span className="block text-xs text-slate-500">Dibayar di upah bersih</span>
                )}
              </td>
              <td className="py-2 px-2 text-right">{mealPaidInWage ? dash : plotStrata}</td>
              <td className="py-2 px-2 text-right">{actualStrata}</td>
              <td className="py-2 pl-2 text-right">
                {!mealPaidInWage && extraMealAllowance > 0 ? `+${fmtRp(Math.ceil(extraMealAllowance))}` : dash}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  const fuelModeLabel = activeFuelMode === 'hold_accumulate'
    ? 'Tahan & akumulasi'
    : activeFuelMode === 'procure_release'
      ? 'Cairkan saldo'
      : 'Standard langsung';

  const sectionClass = 'space-y-4 border-t border-slate-200 py-5';
  const sectionTitleClass = 'text-sm font-semibold text-slate-900';

  return (
    <div className="min-h-screen bg-white pb-24 font-sans text-sm text-slate-700">
      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <h1 className="text-base font-semibold text-slate-900">Laporan Perjalanan</h1>
          <Link
            href="/employee/driver-history"
            aria-label="Riwayat Perjalanan"
            title="Riwayat Perjalanan"
            className={buttonVariants({ variant: 'ghost' })}
          >
            <Compass />
            <span className="hidden sm:inline">Riwayat</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4">
        <form onSubmit={handleCompleteJourneySubmit}>

          {/* ── Trip summary ─────────────────────────────────────────── */}
          <section className="space-y-3 py-5">
            <h2 className="text-base font-semibold leading-snug text-slate-900">
              {/* The stored name carries the route in brackets; the Rute rows show it. */}
              {String(activeReportingJourney.activityName || '').split(' (')[0]}
            </h2>
            <DetailList>
              <DetailRow label="Kendaraan">
                {activeReportingJourney.vehicleName}
                {canChangeVehicle && (
                  <button
                    type="button"
                    onClick={() => setShowVehicleDialog(true)}
                    disabled={submitting}
                    aria-label={`Ganti kendaraan (sekarang ${activeReportingJourney.vehicleName})`}
                    className="ml-3 rounded text-sm font-medium text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
                  >
                    Ganti
                  </button>
                )}
              </DetailRow>
              <DetailRow label="Tanggal">{journeyDateLabel}</DetailRow>
              <DetailRow label="Rute">
                <span className="break-words">
                  {(activeReportingJourney.startPoint || '').split(',')[0]} → {(currentMainDestinations[0] || '').split(',')[0]}
                  {currentMainDestinations.length > 1 && ` +${currentMainDestinations.length - 1}`}
                </span>
              </DetailRow>
            </DetailList>
          </section>

          {/* ── Fuel procurement ─────────────────────────────────────── */}
          {(!isNdalem || fuelModeSelectionRequired) && (
            <section className={sectionClass}>
              <h2 className={sectionTitleClass}>Pengadaan BBM</h2>
              {fuelModeSelectionRequired ? (
                <>
                  <p className="text-[13px] text-slate-500">Pilih satu mode sebelum laporan dapat dikirim.</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {([
                      ['standard_direct', 'Standard langsung', 'BBM dibayar dan disettle sesuai aturan lama.'],
                      ['hold_accumulate', 'Tahan & akumulasi', 'Jatah trip mengurangi Tersedia lalu masuk Akumulasi setelah disetujui; tanpa kuitansi.'],
                      ['procure_release', 'Cairkan saldo', 'Akumulasi digabung dengan jatah trip; nominal pembelian dan kuitansi wajib.'],
                    ] as const).map(([mode, title, description]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => handleSelectFuelMode(mode)}
                        disabled={selectingFuelMode}
                        className="rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-blue-500 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
                      >
                        <span className="block text-sm font-medium text-slate-900">{title}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-slate-500">{description}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <DetailList>
                    <DetailRow label="Mode (dikunci untuk perjalanan ini)">{fuelModeLabel}</DetailRow>
                  </DetailList>
                  {activeFuelMode === 'hold_accumulate' && (
                    <Callout>Jangan unggah kuitansi BBM; jatah sudah mengurangi Tersedia dan menjadi Akumulasi saat audit disetujui.</Callout>
                  )}
                  {activeFuelMode === 'procure_release' && (
                    <Callout>Akumulasi yang dikunci ditambahkan ke jatah trip; nominal pembelian dan kuitansi BBM wajib.</Callout>
                  )}
                </>
              )}
              {!isNdalem && activeReportingJourney.fuelBalance && (
                <DetailList>
                  <DetailRow label="Tersedia">{fmtRp(Number(activeReportingJourney.fuelBalance.availableBalance || 0))}</DetailRow>
                  <DetailRow label="Akumulasi">{fmtRp(Number(activeReportingJourney.fuelBalance.accumulatedHoldAmount || 0))}</DetailRow>
                  <DetailRow label="Menunggu">{fmtRp(Number(activeReportingJourney.fuelBalance.pendingHoldAmount || 0) + Number(activeReportingJourney.fuelBalance.pendingReleaseAmount || 0))}</DetailRow>
                </DetailList>
              )}
            </section>
          )}

          {/* ── Route ────────────────────────────────────────────────── */}
          <section className={sectionClass}>
            <div className="flex items-center justify-between gap-2">
              <h2 className={sectionTitleClass}>Rute</h2>
              {/* With no destination yet, the same button sits in the route itself. */}
              {currentStops.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={currentMainDestinations.length >= MAX_DRIVER_JOURNEY_DESTINATIONS}
                  title={
                    currentMainDestinations.length >= MAX_DRIVER_JOURNEY_DESTINATIONS
                      ? `Maksimal ${MAX_DRIVER_JOURNEY_DESTINATIONS} titik tujuan`
                      : undefined
                  }
                  onClick={handleAddLocation}
                >
                  <Plus />
                  Tambah lokasi
                </Button>
              )}
            </div>

            <ol className="relative ml-1.5 space-y-5 border-l border-dashed border-slate-300 pl-5">
              {/* Start */}
              <li className="relative flex items-start justify-between gap-3">
                <span aria-hidden className="absolute -left-[26px] top-1.5 size-2.5 rounded-full bg-blue-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500">Berangkat</div>
                  <div
                    className="truncate text-sm font-medium text-slate-900"
                    title={normalizeDriverJourneyStartPoint(activeReportingJourney.startPoint)}
                  >
                    {driverJourneyStartPointLabel(activeReportingJourney.startPoint)}
                  </div>
                </div>
                {canEditMainDestination && (
                  <Button type="button" variant="ghost" onClick={openStartPointPicker} className="shrink-0 text-blue-600">
                    Ubah
                  </Button>
                )}
              </li>

              {/* Stops */}
              {currentStops.length === 0 ? (
                <li className="relative">
                  <span aria-hidden className="absolute -left-[26px] top-1.5 size-2.5 rounded-full border-2 border-slate-300 bg-white" />
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={handleAddLocation}
                    className="h-10 w-full border-dashed text-blue-600"
                  >
                    <Plus />
                    Tambah lokasi
                  </Button>
                </li>
              ) : (
                extraActivities.map((act, index) => {
                  if (act.type !== 'tambah_lokasi') return null;
                  const stopNumber = extraActivities
                    .slice(0, index + 1)
                    .filter((entry) => entry?.type === 'tambah_lokasi').length;
                  const isFirstStop = !extraActivities
                    .slice(0, index)
                    .some((entry) => entry?.type === 'tambah_lokasi');
                  const isLastStop = !extraActivities
                    .slice(index + 1)
                    .some((entry) => entry?.type === 'tambah_lokasi');
                  return (
                    <li key={index} className="relative flex items-start justify-between gap-2">
                      <span aria-hidden className="absolute -left-[26px] top-1.5 size-2.5 rounded-full bg-blue-600" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-slate-500">Tujuan {stopNumber}</div>
                        {act.destination ? (
                          <>
                            <div className="truncate text-sm font-medium text-slate-900" title={act.destination}>
                              {act.destination.split(',')[0]}
                            </div>
                            {legLine(act)}
                          </>
                        ) : (
                          <div className="mt-0.5 space-y-1.5">
                            <StatusDot tone="warning">Lokasi belum dipilih</StatusDot>
                            <div>
                              <Button type="button" variant="outline" size="sm" onClick={() => openStopPicker(index, act)}>
                                Pilih lokasi
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isFirstStop || isCalculatingExtraRoute}
                          onClick={() => handleMoveExtraActivity(index, -1)}
                          aria-label={`Naikkan tujuan ${stopNumber}`}
                          title="Naikkan urutan"
                          className="text-slate-500"
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isLastStop || isCalculatingExtraRoute}
                          onClick={() => handleMoveExtraActivity(index, 1)}
                          aria-label={`Turunkan tujuan ${stopNumber}`}
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
                                aria-label={`Aksi lain untuk tujuan ${stopNumber}`}
                                title="Aksi lain"
                                className="text-slate-500"
                              />
                            }
                          >
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem className="text-sm font-medium" onClick={() => openStopPicker(index, act)}>
                              {act.destination ? 'Ubah lokasi' : 'Pilih lokasi'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-sm font-medium text-red-600 data-highlighted:bg-red-50"
                              onClick={() => handleRemoveExtraActivity(index)}
                            >
                              Hapus tujuan
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </li>
                  );
                })
              )}

              {/* Return */}
              <li className="relative">
                <span aria-hidden className="absolute -left-[26px] top-1.5 size-2.5 rounded-full bg-blue-600" />
                <div className="text-xs text-slate-500">Pulang</div>
                <div
                  className="truncate text-sm font-medium text-slate-900"
                  title={normalizeDriverJourneyStartPoint(activeReportingJourney.startPoint)}
                >
                  {driverJourneyStartPointLabel(activeReportingJourney.startPoint)}
                </div>
                {currentStops.length > 0 ? (
                  legLine(returnLeg)
                ) : (
                  <div className="text-[13px] text-slate-500">Kembali ke titik awal; dihitung setelah tujuan ditentukan.</div>
                )}
              </li>
            </ol>
          </section>

          {/* ── Time ─────────────────────────────────────────────────── */}
          <section className={sectionClass}>
            <h2 className={sectionTitleClass}>Waktu</h2>

            <div className="flex items-center gap-2.5">
              <input
                id="toggleMultiDay"
                type="checkbox"
                checked={formIsMultiDay}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setFormIsMultiDay(checked);
                  if (!checked) {
                    setFormNightCount(0);
                    setFormDateEnd(formDate);
                  } else {
                    const startMins = parseInt((formTimeStart || '00:00').split(':')[0], 10) * 60 + parseInt((formTimeStart || '00:00').split(':')[1], 10);
                    const endMins = parseInt((formTimeEnd || '00:00').split(':')[0], 10) * 60 + parseInt((formTimeEnd || '00:00').split(':')[1], 10);
                    if (endMins <= startMins || !formDateEnd || formDateEnd === formDate) {
                      setFormDateEnd(getNextDayISO(formDate || getTodayISO()));
                    }
                  }
                }}
                className="size-4 cursor-pointer rounded border-slate-300 accent-blue-600"
              />
              <Label htmlFor="toggleMultiDay" className="cursor-pointer text-slate-900">
                Perjalanan Lintas Hari / Menginap
              </Label>
            </div>

            {!formIsMultiDay ? (
              <div className="grid grid-cols-2 gap-3">
                {timeStartField}
                {timeEndField}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Tanggal Berangkat" htmlFor="dateStartInput">
                    <Input
                      id="dateStartInput"
                      type="date"
                      value={formDate}
                      disabled={isDepartureLocked}
                      onChange={(e) => setFormDate(e.target.value)}
                      className="h-10"
                    />
                  </Field>
                  {timeStartField}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Tanggal Tiba / Selesai" htmlFor="dateEndInput">
                    <Input
                      id="dateEndInput"
                      type="date"
                      value={formDateEnd || formDate}
                      onChange={(e) => setFormDateEnd(e.target.value)}
                      className="h-10"
                    />
                  </Field>
                  {timeEndField}
                </div>
              </div>
            )}

            {isDepartureLocked && (
              <p className="text-xs text-slate-500">Jam berangkat terkunci ke waktu otorisasi SPJ.</p>
            )}

            {!formIsMultiDay && isInvalidSingleDayTime && (
              <Callout tone="error">
                Jam tiba ({formTimeEnd}) tidak boleh sebelum atau sama dengan jam berangkat ({formTimeStart}) pada perjalanan hari yang sama. Centang &ldquo;Perjalanan lintas hari / menginap&rdquo; jika melewati tengah malam.
              </Callout>
            )}

            <p className="tabular-nums text-slate-700">
              Durasi{' '}
              <span className="font-medium text-slate-900">
                {journeyTimings.durationHours > 0 ? journeyTimings.durationHours.toFixed(1) : '0'} jam
              </span>
              {' · '}
              {isNextDayArriveBefore5AM && effectiveNights === 0
                ? 'tanpa menginap (tiba sebelum 05:00)'
                : `${effectiveNights} malam`}
            </p>

            {isCalculatingExtraRoute && (
              <p className="flex items-center gap-2 text-slate-500">
                <Loader2 className="size-4 animate-spin" />
                Menghitung rute…
              </p>
            )}

            {extraRouteError && (
              <Callout
                tone="error"
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void recalculateRouteChain(extraActivities)}
                    disabled={isCalculatingExtraRoute}
                  >
                    Coba lagi
                  </Button>
                }
              >
                {extraRouteError}
              </Callout>
            )}
          </section>

          {/* ── Expenses ─────────────────────────────────────────────── */}
          <section className={sectionClass}>
            <h2 className={sectionTitleClass}>Pengeluaran</h2>

            <Field
              label="Uang Diberikan Selama Perjalanan"
              htmlFor="mealMoneyProvided"
              hint={mealPaidInWage
                ? 'Tidak mengurangi SPJ.'
                : `Hak ${qtyHakMakan}x makan: ${fmtRp(totalHakUangMakan)}`}
            >
              <RupiahInput id="mealMoneyProvided" value={formNdalemMealMoneyFee} onValue={setFormNdalemMealMoneyFee} />
            </Field>
            {!mealPaidInWage && unpaidDeltaRp > 0 && (
              <p className="tabular-nums text-slate-700">
                Kekurangan uang makan <span className="font-medium text-slate-900">+{fmtRp(unpaidDeltaRp)}</span>
              </p>
            )}

            {!isNdalem && (
              activeFuelMode === 'hold_accumulate' ? (
                <Callout>
                  BBM ditahan untuk akumulasi kendaraan. Alokasi {fmtRp(Math.ceil(baseCostVal))} sudah mengurangi Tersedia {activeReportingJourney.vehicleName} dan menjadi Akumulasi setelah audit disetujui. Kuitansi BBM tidak diperlukan.
                </Callout>
              ) : (
                <div className="space-y-2">
                  <Field label="BBM Terbeli" htmlFor="journeyFuel" hint={`Jatah ${fmtRp(Math.ceil(displayedFuelAllowance))}`}>
                    <RupiahInput id="journeyFuel" value={formFuelFee} onValue={setFormFuelFee} />
                  </Field>
                  <input
                    type="file"
                    ref={fuelFileInputRef}
                    accept="image/*,application/pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadReceipt(f, 'bbm');
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                  <ReceiptAttachments
                    urls={formFuelReceiptUrls}
                    label="Bukti BBM"
                    uploading={uploadingFuelReceipt}
                    onUploadClick={() => fuelFileInputRef.current?.click()}
                    onView={(index) => setSelectedExifImage({
                      url: formFuelReceiptUrls[index],
                      title: receiptTitle('Bukti BBM', formFuelReceiptUrls, index),
                      auditMetadata: formFuelReceiptEvidence.find((item) => item.url === formFuelReceiptUrls[index])?.auditMetadata,
                    })}
                    onRemove={(index) => {
                      setFormFuelReceiptUrls(prev => prev.filter((_, i) => i !== index));
                      setFormFuelReceiptEvidence(prev => prev.filter((_, i) => i !== index));
                    }}
                  />
                </div>
              )
            )}

            <div className="space-y-2">
              <Field label="Tol & Parkir Terbayar" htmlFor="journeyToll" hint={`Jatah ${fmtRp(Math.ceil(preAuthorizedToll))}`}>
                <RupiahInput id="journeyToll" value={formTollParkingFee} onValue={setFormTollParkingFee} />
              </Field>
              <input
                type="file"
                ref={tollFileInputRef}
                accept="image/*,application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadReceipt(f, 'toll');
                  e.target.value = '';
                }}
                className="hidden"
              />
              <ReceiptAttachments
                urls={formTollReceiptUrls}
                label="Bukti tol & parkir"
                uploading={uploadingTollReceipt}
                onUploadClick={() => tollFileInputRef.current?.click()}
                onView={(index) => setSelectedExifImage({
                  url: formTollReceiptUrls[index],
                  title: receiptTitle('Bukti Tol & Parkir', formTollReceiptUrls, index),
                  auditMetadata: formTollReceiptEvidence.find((item) => item.url === formTollReceiptUrls[index])?.auditMetadata,
                })}
                onRemove={(index) => {
                  setFormTollReceiptUrls(prev => prev.filter((_, i) => i !== index));
                  setFormTollReceiptEvidence(prev => prev.filter((_, i) => i !== index));
                }}
              />
            </div>
          </section>

          {/* ── Wage breakdown ───────────────────────────────────────── */}
          <section className={sectionClass}>
            <h2 className={sectionTitleClass}>
              {isSelfCreatedJourney ? 'Rincian Biaya & Upah Bersih' : 'Penyesuaian & Biaya Akhir'}
            </h2>

            {!isSelfCreatedJourney && renderPlanVsActual()}

            <DetailList>
              {!isSelfCreatedJourney && settlement.extraFuelCost > 0 && (
                <DetailRow label="Kelebihan BBM (delta)">+{fmtRp(Math.ceil(settlement.extraFuelCost))}</DetailRow>
              )}
              {!isSelfCreatedJourney && extraMealAllowance > 0 && (
                <DetailRow label="Kekurangan uang makan (delta)">+{fmtRp(Math.ceil(extraMealAllowance))}</DetailRow>
              )}
              {extraToll > 0 && (
                <DetailRow label={isSelfCreatedJourney || preAuthorizedToll === 0 ? 'Reimburse tol & parkir' : 'Kelebihan tol & parkir (delta)'}>
                  +{fmtRp(Math.ceil(extraToll))}
                </DetailRow>
              )}
              {isSelfCreatedJourney ? (
                tollVal > 0 && (
                  <DetailRow label="Total reimburse (tol & parkir)" emphasis>{fmtRp(Math.ceil(tollVal))}</DetailRow>
                )
              ) : (
                <DetailRow label="Total reimburse (delta)" emphasis>{fmtRp(Math.ceil(settlement.reimburseDelta))}</DetailRow>
              )}
              <DetailRow label={`Komponen jarak (${calculatedDistanceKm.toFixed(1)} km)`}>{fmtRp(Math.ceil(calculatedDistanceKm * 300))}</DetailRow>
              <DetailRow label={`Komponen waktu (${calculatedDurationHours.toFixed(1)} jam)`}>{fmtRp(Math.ceil(calculatedDurationHours * 5000))}</DetailRow>
              {shortTripMeal > 0 && (
                <DetailRow label="Uang makan perjalanan (≤ 2 jam)">+{fmtRp(shortTripMeal)}</DetailRow>
              )}
              {mealWage > 0 && (
                <DetailRow label={`Uang makan (${Math.round(mealWage / 20000)}x makan)`}>+{fmtRp(mealWage)}</DetailRow>
              )}
              <DetailRow label="Durasi kalender">
                {submittedDurationHours.toFixed(1)} jam / {journeyDayCount(submittedDurationHours)} hari
              </DetailRow>
              {effectiveNights > 0 && (
                <DetailRow label={`Insentif menginap (${effectiveNights} × Rp50.000)`}>+{fmtRp(calculateNightPremium(effectiveNights))}</DetailRow>
              )}
              {settlement.remainingUnspentCash > 0 && (
                <DetailRow label="Potongan sisa kas operasional">
                  <span className="text-red-600">-{fmtRp(Math.ceil(settlement.remainingUnspentCash))}</span>
                </DetailRow>
              )}
              <DetailRow label="Upah Bersih Sopir" emphasis>
                <span className="text-emerald-700">{fmtRp(Math.ceil(finalUpahBersih))}</span>
              </DetailRow>
            </DetailList>
          </section>

          <FloatingSnackbar message={message} />

          <div className="border-t border-slate-200 py-4 text-center">
            <Button
              type="button"
              variant="danger-ghost"
              onClick={handleOpenCancelModal}
              disabled={isCancelling || submitting}
              title={isSelfCreatedJourney ? 'Menghapus SPJ mandiri secara permanen' : 'Mengembalikan perjalanan ke pool'}
            >
              {isCancelling && <Loader2 className="animate-spin" />}
              {isSelfCreatedJourney ? 'Hapus perjalanan' : 'Batalkan klaim'}
            </Button>
          </div>

          {/* ── Actions ──────────────────────────────────────────────── */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
              <div role="status" aria-live="polite" className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-500">
                {draftAutosave.status === 'saving' && <Loader2 className="size-4 shrink-0 animate-spin" />}
                <span>
                  {draftAutosave.status === 'saving'
                    ? 'Menyimpan draft…'
                    : draftAutosave.status === 'saved'
                      ? 'Draft tersimpan otomatis'
                      : draftAutosave.conflict ? 'Draft berubah di sesi lain' : 'Sinkronisasi draft tertunda'}
                </span>
                {draftAutosave.status === 'error' && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => {
                    if (draftAutosave.conflict) window.location.reload();
                    else void draftAutosave.flush();
                  }} disabled={submitting || isCancelling}>
                    {draftAutosave.conflict ? 'Muat ulang' : 'Coba lagi'}
                  </Button>
                )}
              </div>
              <Button
                type="submit"
                variant="accent"
                disabled={
                  submitting ||
                  isCalculatingExtraRoute ||
                  !hasMeasuredRoundTrip ||
                  Boolean(extraRouteError)
                }
                className="h-10 shrink-0 px-4"
              >
                {submitting && <Loader2 className="animate-spin" />}
                {submitLabel}
              </Button>
            </div>
          </div>

        </form>

        {/* Map location picker */}
        <Dialog
          open={showMapSelector}
          onOpenChange={(open) => {
            if (!open) handleCloseMapSelector();
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="top-4 max-h-[calc(100dvh-2rem)] translate-y-0 overflow-y-auto sm:max-w-lg"
          >
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-slate-900">Pilih lokasi</DialogTitle>
            </DialogHeader>

            <Field label="Cari Tempat Atau Alamat" htmlFor="mapSearch" error={mapSearchError || placeSearchError || undefined}
              hint={mapSearchText.trim().length > 0 && mapSearchText.trim().length < PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH
                ? `Ketik minimal ${PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH} karakter untuk menampilkan saran.`
                : undefined}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" />
                <Input
                  id="mapSearch"
                  type="text"
                  value={mapSearchText}
                  onChange={(e) => handleMapSearchChange(e.target.value)}
                  onKeyDown={handleMapSearchKeyDown}
                  onBlur={() => {
                    window.setTimeout(cancelPlaceSearch, 150);
                  }}
                  autoComplete="off"
                  placeholder="Contoh: Rest Area KM 57, Unair Kampus C"
                  className="h-10 pl-9"
                />
              </div>
              {(isSearchingPlaces || placeSuggestions.length > 0) && (
                <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {isSearchingPlaces && (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
                      <Loader2 className="size-3.5 animate-spin" />
                      Mencari lokasi…
                    </div>
                  )}
                  {placeSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handlePlaceSuggestionSelect(suggestion);
                      }}
                      className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                    >
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {suggestion.primaryText}
                      </span>
                      {suggestion.secondaryText && suggestion.secondaryText !== suggestion.primaryText && (
                        <span className="block truncate text-xs text-slate-500">
                          {suggestion.secondaryText}
                        </span>
                      )}
                    </button>
                  ))}
                  {placeSuggestions.length > 0 && (
                    <div className="border-t border-slate-100 px-3 py-1 text-right text-xs text-slate-400">
                      Powered by Google
                    </div>
                  )}
                </div>
              )}
            </Field>

            <div
              ref={(el) => {
                if (el) initMap(el);
              }}
              className="h-56 w-full overflow-hidden rounded-lg border border-slate-200"
            />

            <DetailList>
              <DetailRow label="Alamat terpilih">
                <span className="break-words">{mapAddress || 'Geser pin atau cari tempat'}</span>
              </DetailRow>
              {mapLocation && (
                <DetailRow label="Koordinat">
                  {mapLocation.latitude.toFixed(6)}, {mapLocation.longitude.toFixed(6)}
                </DetailRow>
              )}
            </DetailList>

            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={handleCloseMapSelector}>
                Batal
              </Button>
              <Button
                type="button"
                variant="accent"
                size="lg"
                onClick={handleConfirmMapLocation}
                disabled={!mapAddress || !mapLocation}
              >
                Gunakan lokasi ini
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {canChangeVehicle && showVehicleDialog && (
          <ChangeJourneyVehicleDialog
            open
            onOpenChange={setShowVehicleDialog}
            journeyId={activeReportingJourney.id}
            currentVehicle={activeReportingJourney.vehicleName}
            currentFuelMode={activeFuelMode}
            fuelModeSelectionRequired={activeReportingJourney.fuelModeSelectionRequired === true}
            onChanged={handleVehicleChanged}
          />
        )}

        <ConfirmDialog
          open={showCancelModal}
          onOpenChange={setShowCancelModal}
          title={isSelfCreatedJourney ? 'Hapus perjalanan?' : 'Batalkan klaim?'}
          description={
            isSelfCreatedJourney
              ? 'Perjalanan ini Anda otorisasi sendiri. Jika dibatalkan, perjalanan dihapus permanen dan tidak masuk ke pool sopir lain.'
              : 'Perjalanan dikembalikan ke pool agar bisa diambil sopir lain.'
          }
          confirmLabel={isSelfCreatedJourney ? 'Hapus perjalanan' : 'Batalkan klaim'}
          destructive={isSelfCreatedJourney}
          loading={isCancelling}
          onConfirm={handleConfirmCancelClaim}
        />

        {/* Image EXIF Metadata Viewer Modal */}
        {selectedExifImage && (
          <ImageExifViewer
            imageUrl={selectedExifImage.url}
            title={selectedExifImage.title}
            auditMetadata={selectedExifImage.auditMetadata}
            activityDate={formDate}
            isOpen={Boolean(selectedExifImage)}
            onClose={() => setSelectedExifImage(null)}
            showMetadata={false}
          />
        )}

      </div>
    </div>
  );
}

export default function JourneyReportPage() {
  return (
    <Suspense fallback={<JourneyReportPageSkeleton />}>
      <JourneyReportContent />
    </Suspense>
  );
}
