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
  DEFAULT_FUEL_PROCUREMENT_MODE,
  isFuelProcurementMode,
  type FuelProcurementMode,
} from '@/lib/payroll/driverJourney';
import { pekaryaPayrollPeriodForDate } from '@/lib/payroll/pekaryaSpj';

// ─── Google Maps loader ──────────────────────────────────────────────────────

const loadGoogleMapsScript = (callback: () => void) => {
  if (typeof window === 'undefined') return;
  const g = (window as any).google;
  if (g && g.maps && g.maps.Map) {
    callback();
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
  customDurationPP?: number;
  vehicleType?: string;
  nightCount?: number;
  points?: string[];
  startPoint?: string;
  endPoint?: string;
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

/** Exactly the `driverReview` body accepted by `/api/pekarya/activities/review`. */
export interface DriverReviewPayload {
  distanceKm: number;
  durationHours: number;
  timeStart: string;
  timeEnd: string;
  dateStart: string;
  dateEnd: string;
  isMultiDay: boolean;
  fuelDelta: number;
  tollDelta: number;
  mealDelta: number;
  ndalemMealMoneyReceived: number;
  vehicleType: string;
  nightCount: number;
  points: string[];
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

function getVehicleRate(vType: string) {
  return VEHICLE_RATES[vType] ?? 1000;
}

function fmtRp(val: number): string {
  return 'Rp' + val.toLocaleString('id-ID');
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
  const [auditNdalemMealMoney, setAuditNdalemMealMoney] = useState<number>(0);
  const [auditVehicleType, setAuditVehicleType] = useState<string>('Suzuki XL7');
  const [auditNightCount, setAuditNightCount] = useState<number>(0);
  const [auditPoints, setAuditPoints] = useState<string[]>([]);
  // Keyed by the origin point's index in `auditPoints` — the leg leaving that
  // stop toward the next one. Only set when both stops are real (non-blank)
  // and directly adjacent, so a still-empty "Tambah Lokasi" slot never gets
  // attributed a leg that actually skipped over it.
  const [auditLegWages, setAuditLegWages] = useState<Record<number, { distanceKm: number; durationHours: number }>>({});
  const [isManualDistanceOverride, setIsManualDistanceOverride] = useState<boolean>(false);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);

  // Google Maps Location Picker Modal state
  const [showMapSelector, setShowMapSelector] = useState(false);
  const [mapSearchText, setMapSearchText] = useState('');
  const [mapAddress, setMapAddress] = useState('');
  const [mapAddressImage, setMapAddressImage] = useState<string | null>(null);
  const [mapTargetIndex, setMapTargetIndex] = useState<number | null>(null);

  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);
  const mapElementRef = React.useRef<HTMLDivElement | null>(null);

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
    setAuditDistanceKm(distKm);
    setAuditDurationHours(initialTimeline.durationHours > 0 ? initialTimeline.durationHours : durHrs);
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
    setIsManualDistanceOverride(false);

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
    setAuditNdalemMealMoney(report.ndalemMealMoneyReceived ?? 0);
    setAuditLegWages({});
  }

  // Populates per-leg distance/wage figures as soon as a report opens, rather
  // than only after the auditor manually clicks "Hitung Ulang". Keyed on the
  // report id alone so later point edits (which already trigger their own
  // recalculation) don't cause a redundant second call here.
  useEffect(() => {
    if (!report) return;
    const pts =
      report.points && report.points.length > 0
        ? report.points
        : [report.startPoint || 'UNIPDU Jombang, Jawa Timur', report.endPoint || ''];
    recalculateRouteFromPoints(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  const initMap = (element: HTMLDivElement) => {
    loadGoogleMapsScript(() => {
      const google = (window as any).google;
      if (!google) return;
      if (mapRef.current && mapElementRef.current === element) return;

      mapElementRef.current = element;
      const unipduCoords = { lat: -7.5458, lng: 112.2858 };

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

      const updateAddressImage = (queryStr: string) => {
        try {
          const service = new google.maps.places.PlacesService(map || document.createElement('div'));
          service.textSearch({ query: queryStr }, (results: any, status: any) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
              const matchWithPhoto = results.find((r: any) => r.photos && r.photos.length > 0);
              if (matchWithPhoto) {
                setMapAddressImage(matchWithPhoto.photos[0].getUrl({ maxWidth: 1600, maxHeight: 800 }));
                return;
              }
            }
            setMapAddressImage(null);
          });
        } catch (e) {
          console.error(e);
          setMapAddressImage(null);
        }
      };

      const updateAddress = (latLng: any) => {
        geocoder.geocode({ location: latLng }, (results: any, status: any) => {
          if (status === 'OK' && results[0]) {
            setMapAddress(results[0].formatted_address);
            updateAddressImage(results[0].formatted_address);
          } else {
            setMapAddress(`${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`);
            setMapAddressImage(null);
          }
        });
      };

      const existingAddress = mapAddress;
      if (existingAddress && existingAddress !== 'UNIPDU Jombang, Jawa Timur' && existingAddress !== 'UNIPDU Jombang') {
        geocoder.geocode({ address: existingAddress }, (results: any, status: any) => {
          if (status === 'OK' && results[0] && results[0].geometry && results[0].geometry.location) {
            const loc = results[0].geometry.location;
            map.setCenter(loc);
            map.setZoom(15);
            marker.setPosition(loc);
            setMapAddress(results[0].formatted_address);
            updateAddressImage(results[0].formatted_address);
          } else {
            updateAddress(unipduCoords);
          }
        });
      } else {
        updateAddress(unipduCoords);
      }

      marker.addListener('dragend', () => {
        const pos = marker.getPosition();
        if (pos) {
          updateAddress(pos);
        }
      });

      map.addListener('click', (e: any) => {
        if (e.latLng) {
          marker.setPosition(e.latLng);
          updateAddress(e.latLng);
        }
      });
    });
  };

  const initAutocomplete = (inputEl: HTMLInputElement) => {
    loadGoogleMapsScript(() => {
      const google = (window as any).google;
      if (!google || !mapRef.current) return;

      try {
        const autocomplete = new google.maps.places.Autocomplete(inputEl, {
          types: ['geocode', 'establishment'],
        });

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (place.geometry && place.geometry.location) {
            mapRef.current.setCenter(place.geometry.location);
            mapRef.current.setZoom(16);
            if (markerRef.current) {
              markerRef.current.setPosition(place.geometry.location);
            }
            if (place.formatted_address) {
              setMapAddress(place.formatted_address);
              if (place.photos && place.photos.length > 0) {
                setMapAddressImage(place.photos[0].getUrl({ maxWidth: 1600, maxHeight: 800 }));
              }
            }
          }
        });
      } catch (e) {
        console.error('Autocomplete error:', e);
      }
    });
  };

  const handleOpenMapForIndex = (index: number) => {
    setMapTargetIndex(index);
    const currentVal = auditPoints[index] || '';
    setMapAddress(currentVal);
    setMapSearchText(currentVal);
    setMapAddressImage(null);
    setShowMapSelector(true);
  };

  const recalculateRouteFromPoints = (pointsToCalc: string[]) => {
    const validIndices = pointsToCalc
      .map((p, i) => (p && p.trim().length > 0 ? i : -1))
      .filter((i) => i !== -1);
    if (validIndices.length < 2) return;
    const validPts = validIndices.map((i) => pointsToCalc[i]);
    setIsCalculatingRoute(true);

    loadGoogleMapsScript(() => {
      const g = (window as any).google;
      if (!g || !g.maps) {
        setIsCalculatingRoute(false);
        return;
      }

      try {
        const service = new g.maps.DirectionsService();
        const origin = validPts[0];
        const destination = validPts[validPts.length - 1];
        const waypoints = validPts.slice(1, validPts.length - 1).map(pt => ({
          location: pt,
          stopover: true,
        }));

        service.route(
          {
            origin: origin,
            destination: destination,
            waypoints: waypoints,
            travelMode: g.maps.TravelMode.DRIVING,
          },
          (result: any, status: any) => {
            setIsCalculatingRoute(false);
            if (status === 'OK' && result && result.routes && result.routes[0]) {
              const route = result.routes[0];
              let totalMeters = 0;
              let totalSeconds = 0;
              const legWages: Record<number, { distanceKm: number; durationHours: number }> = {};

              route.legs.forEach((leg: any, legIdx: number) => {
                const distanceMeters = leg.distance?.value || 0;
                const durationSeconds = leg.duration?.value || 0;
                totalMeters += distanceMeters;
                totalSeconds += durationSeconds;

                const originIdx = validIndices[legIdx];
                const nextIdx = validIndices[legIdx + 1];
                if (nextIdx === originIdx + 1) {
                  legWages[originIdx] = {
                    distanceKm: distanceMeters / 1000,
                    durationHours: durationSeconds / 3600,
                  };
                }
              });
              setAuditLegWages(legWages);

              if (totalMeters > 0) {
                const oneWayKm = totalMeters / 1000;
                const oneWayHrs = totalSeconds / 3600;
                const roundTripKm = Math.round(oneWayKm * 2 * 10) / 10;
                const roundTripHrs = Math.round(oneWayHrs * 2 * 10) / 10;

                setAuditDistanceKm(roundTripKm);
                setAuditDurationHours(roundTripHrs);
              }
            } else {
              console.warn('DirectionsService route status:', status);
            }
          }
        );
      } catch (err) {
        console.error('Error in recalculateRouteFromPoints:', err);
        setIsCalculatingRoute(false);
      }
    });
  };

  const handleConfirmMapLocation = () => {
    if (mapTargetIndex === null || !mapAddress) return;
    const newPts = [...auditPoints];
    newPts[mapTargetIndex] = mapAddress;
    setAuditPoints(newPts);
    setShowMapSelector(false);
    setMapTargetIndex(null);
    recalculateRouteFromPoints(newPts);
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
    const totalBaseline = heldFuelAmount + effectiveFuelAllowance + baselineMeal + baselineToll;

    const deltaFuel = fuelProcurementMode === 'hold_accumulate' || auditVehicleType === 'Ndalem'
      ? 0
      : auditFuelDelta;
    const deltaToll = auditTollDelta;
    const ndalemMealMoney = auditNdalemMealMoney;
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
      ndalemMealMoney,
    );
    const deltaMeal = auditVehicleType === 'Ndalem'
      ? actualMeal
      : Math.max(0, actualMeal - baselineMeal);
    const extraOps = 0; // Mileage distance is compensated via componentJarak in upahBersih, not cash reimbursement

    const wageDurationHours = timelineChanged && actualJourneyDurationHours > 0
      ? actualJourneyDurationHours
      : auditDurationHours;
    const componentJarak = Math.ceil(auditDistanceKm * 300);
    const componentWaktu = Math.ceil(wageDurationHours * 5000);
    const premiumWeekend = 0;
    const nightPremium = calculateNightPremium(auditNightCount);
    const baseDriverWage = calculateDriverNetWage(
      auditDistanceKm,
      wageDurationHours,
      auditNightCount,
    );

    const actualFuel = fuelProcurementMode === 'hold_accumulate'
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
      totalFuelAllocation: heldFuelAmount + effectiveFuelAllowance,
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
    auditFuelDelta,
    auditTollDelta,
    auditNdalemMealMoney,
    auditVehicleType,
    auditNightCount,
    auditAuthorizedDurationPP,
  ]);

  const handleApprove = () => {
    if (!auditCalc) return;
    onApprove({
      distanceKm: auditDistanceKm,
      durationHours: auditCalc.durationHours,
      timeStart: auditTimeStart,
      timeEnd: auditTimeEnd,
      dateStart: auditDateStart,
      dateEnd: auditDateEnd,
      isMultiDay: auditIsMultiDay,
      fuelDelta: auditFuelDelta,
      tollDelta: auditTollDelta,
      mealDelta: auditCalc.deltaMeal,
      ndalemMealMoneyReceived: auditNdalemMealMoney,
      vehicleType: auditVehicleType,
      nightCount: auditNightCount,
      points: auditPoints,
    });
  };

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
                      <span>Ditahan: <strong className="text-amber-700">{fmtRp(auditCalc.heldFuelAmount)}</strong></span>
                      <span>Pool dicairkan: <strong className="text-orange-700">{fmtRp(auditCalc.procuredAccumulatedAmount)}</strong></span>
                    </div>
                    {auditCalc.fuelProcurementMode === 'hold_accumulate' && <p className="mt-1 text-emerald-800">Mode hold tidak memakai kuitansi atau settlement tunai BBM.</p>}
                    {auditCalc.fuelProcurementMode === 'procure_release' && auditVehicleType !== report.vehicleType && <p className="mt-1 text-indigo-800">Penggantian kendaraan akan menghitung ulang pool kendaraan pengganti di server.</p>}
                  </div>

                  {/* RUTE PERJALANAN TIMELINE EDITOR */}
                  <div className="space-y-3 pt-1.5 border-t border-slate-200/60">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-400 text-[10px] uppercase tracking-wider flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-indigo-500" />
                        Rute Perjalanan ({auditPoints.length} Lokasi)
                      </span>
                      {isEditable && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const newPts = [...auditPoints, ''];
                              setAuditPoints(newPts);
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
                        </div>
                      )}
                    </div>

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
                                      setAuditPoints(newPts);
                                      recalculateRouteFromPoints(newPts);
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
                        onClick={() => setIsManualDistanceOverride(!isManualDistanceOverride)}
                        className="text-[10px] font-bold text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        {isManualDistanceOverride ? <Lock className="w-3 h-3 text-slate-400" /> : <Edit2 className="w-3 h-3" />}
                        {isManualDistanceOverride ? 'Kunci (Otomatis Rute)' : 'Ubah Manual'}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3.5 border-y border-indigo-100/70 py-3">
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
                        {!isManualDistanceOverride && (
                          <span className="text-[8.5px] font-extrabold text-slate-400 flex items-center gap-0.5">
                            <Lock className="w-2.5 h-2.5" /> Otomatis Rute
                          </span>
                        )}
                      </div>
                      <Input
                        type="number"
                        value={auditDistanceKm || ''}
                        onChange={(e) => setAuditDistanceKm(Math.max(0, parseFloat(e.target.value) || 0))}
                        disabled={!isManualDistanceOverride || !isEditable || actionLoading}
                        className={`rounded-xl text-xs font-bold transition-all ${!isManualDistanceOverride
                            ? 'bg-slate-100/70 border-slate-200 text-slate-600 cursor-not-allowed'
                            : 'border-slate-200 focus:border-indigo-400 text-slate-800 bg-white'
                          }`}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <Label className="text-[9.5px] font-bold text-slate-400 uppercase">Waktu Tempuh PP (JAM)</Label>
                        {!isManualDistanceOverride && (
                          <span className="text-[8.5px] font-extrabold text-slate-400 flex items-center gap-0.5">
                            <Lock className="w-2.5 h-2.5" /> Otomatis Rute
                          </span>
                        )}
                      </div>
                      <Input
                        type="number"
                        value={auditDurationHours || ''}
                        onChange={(e) => setAuditDurationHours(Math.max(0, parseFloat(e.target.value) || 0))}
                        disabled={!isManualDistanceOverride || !isEditable || actionLoading}
                        className={`rounded-xl text-xs font-bold transition-all ${!isManualDistanceOverride
                            ? 'bg-slate-100/70 border-slate-200 text-slate-600 cursor-not-allowed'
                            : 'border-slate-200 focus:border-indigo-400 text-slate-800 bg-white'
                          }`}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[9.5px] font-bold text-slate-400 uppercase flex items-center justify-between gap-2">
                      <span>Uang Diberikan Selama Perjalanan</span>
                      <span className="text-slate-500 font-bold normal-case text-[9.5px] whitespace-nowrap">
                        (Hak {Math.round(auditCalc.totalMealEntitlement / 20000)}x Makan: <strong className="text-emerald-700 font-black">{fmtRp(auditCalc.totalMealEntitlement)}</strong>)
                      </span>
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-indigo-700">Rp</span>
                      <Input
                        type="number"
                        placeholder="0"
                        value={auditNdalemMealMoney || ''}
                        onChange={(e) => setAuditNdalemMealMoney(Math.max(0, parseInt(e.target.value, 10) || 0))}
                        disabled={!isEditable || actionLoading}
                        className="pl-8 rounded-xl text-xs font-bold border-slate-200 focus:border-indigo-400 text-slate-800 bg-white"
                      />
                    </div>
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
                      <span>Komponen Waktu ({auditDurationHours} jam x Rp5.000)</span>
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
                            Biaya BBM (PP)
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
                disabled={actionLoading || !auditCalc || auditCalc.actualJourneyDurationHours <= 0}
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
            {/* Search Input inside Map (Google Maps Themed Style) */}
            <div className="relative flex items-center bg-white border border-slate-200 rounded-2xl shadow-sm h-11 px-3.5 gap-2.5 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-400 transition-all">
              <div className="flex items-center justify-center w-5 text-indigo-500 shrink-0">
                <Compass className="w-4.5 h-4.5 animate-pulse" />
              </div>
              <Input
                ref={(el) => {
                  if (el) {
                    initAutocomplete(el);
                  }
                }}
                placeholder="Cari lokasi tujuan dinas..."
                value={mapSearchText}
                onChange={(e) => setMapSearchText(e.target.value)}
                className="flex-1 border-none bg-transparent p-0 focus-visible:ring-0 text-xs font-bold text-slate-700 h-full placeholder:text-slate-400"
              />
              {mapSearchText && (
                <button
                  type="button"
                  onClick={() => {
                    setMapSearchText('');
                    setMapAddress('');
                  }}
                  className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-slate-100 transition-all text-slate-400 hover:text-slate-600 shrink-0"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
              <div className="w-px h-5 bg-slate-200 shrink-0" />
              <button
                type="button"
                className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-indigo-50 transition-all text-indigo-500 hover:text-indigo-600 shrink-0"
              >
                <Search className="w-4.5 h-4.5" />
              </button>

              <style>{`
                .pac-container {
                  z-index: 99999 !important;
                  border-radius: 16px !important;
                  border: 1px solid #e2e8f0 !important;
                  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
                  -webkit-box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
                  background-color: #ffffff !important;
                  font-family: inherit !important;
                  padding: 6px 0 !important;
                  margin-top: 6px !important;
                  width: min(452px, calc(100vw - 3rem)) !important;
                  left: 50% !important;
                  transform: translateX(-50%) !important;
                }
                .pac-item {
                  padding: 10px 14px !important;
                  font-size: 11px !important;
                  font-weight: 600 !important;
                  color: #475569 !important;
                  cursor: pointer !important;
                  display: flex !important;
                  align-items: center !important;
                  gap: 8px !important;
                  border-top: 1px solid #f1f5f9 !important;
                  transition: all 0.15s ease !important;
                }
                .pac-item:hover {
                  background-color: #f8fafc !important;
                }
                .pac-item-query {
                  font-size: 11px !important;
                  font-weight: 850 !important;
                  color: #0f172a !important;
                }
                .pac-matched {
                  color: #4f46e5 !important;
                }
                .pac-icon {
                  margin-top: 0 !important;
                  background-image: none !important;
                  position: relative !important;
                  display: inline-block !important;
                  width: 14px !important;
                  height: 14px !important;
                  flex-shrink: 0 !important;
                }
                .pac-icon::before {
                  content: "📍" !important;
                  font-size: 10px !important;
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                }
              `}</style>
            </div>

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

            {/* Selected Location Image Preview */}
            {mapAddressImage && (
              <div className="w-full h-32 rounded-xl overflow-hidden border border-slate-100 shadow-sm relative group bg-slate-50 animate-fade-in">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mapAddressImage}
                  alt="Location Preview"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent flex items-end p-3">
                  <div className="text-[10px] text-white font-extrabold flex items-center gap-1 shadow-sm drop-shadow-md">
                    <Compass className="w-3.5 h-3.5 text-indigo-300 animate-spin-slow shrink-0" />
                    <span>Pratinjau Lokasi Terpilih</span>
                  </div>
                </div>
              </div>
            )}

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
                disabled={!mapAddress}
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
