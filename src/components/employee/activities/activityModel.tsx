"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  useAuth,
} from '@/lib/AuthContext';
import {
  useSearchParams,
  useRouter,
} from 'next/navigation';
import {
  db,
} from '@/lib/firebase';
import {
  uploadProofFile,
} from '@/lib/uploads';
import {
  countSubmittedSelfPiketJourneysOnDate,
  getTodayDateString,
} from '@/lib/payroll/driverPiket';
import {
  collection,
  getDoc,
  doc,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import {
  getSatpamShiftForTeam,
} from '@/utils/satpamRotation';
import {
  authenticatedJson,
  createFinancialRequestId,
} from '@/lib/payroll/client';
import {
  parseSatpamShiftPendingDraft,
  satpamShiftDraftStorageKey,
  type SatpamShiftPendingDraft,
} from '@/lib/satpamShiftDraft';
import {
  defaultSatpamAssignmentPayType,
  payrollPeriodForDutyDate,
  SatpamPostId,
  SatpamPayType,
  type PhotoAuditMetadata,
  type PhotoEvidence,
  type SatpamShiftAnomaly,
} from '@/lib/payroll/domain';
import {
  applyLiburDateSwap,
  findFirstUpcomingSwapDate,
  type SatpamDutyPlanDay,
} from '@/lib/payroll/satpamDutyPlan';
import {
  prepareProofImage,
} from '@/lib/photoEvidence';
import {
  DEFAULT_DRIVER_VEHICLE_NAME,
  DEFAULT_FUEL_PROCUREMENT_MODE,
  CURRENT_MEAL_ACCOUNTING_MODE,
  calculateDriverJourneyOperationalCosts,
  DEFAULT_DRIVER_JOURNEY_LOCATION,
  driverJourneyRoutePoint,
  fuelProcurementModeLabel,
  isFuelProcurementMode,
  MAX_DRIVER_JOURNEY_DESTINATIONS,
  MAX_DRIVER_JOURNEY_LOCATIONS,
  normalizeDriverJourneyLocation,
  type DriverJourneyLocation,
  type DriverVehicleName,
  type FuelProcurementMode,
} from '@/lib/payroll/driverJourney';

export interface VehicleFuelBalanceItem {
  vehicleName: string;
  availableBalance: number;
  pendingHoldAmount: number;
  accumulatedHoldAmount: number;
  pendingReleaseAmount: number;
}
import {
  PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH,
  useCostSafePlaceAutocomplete,
  type CostSafePlaceSuggestion,
} from '@/hooks/useCostSafePlaceAutocomplete';
import {
  SOPIR_JOURNEY_REPORT_PATH,
  type EmployeeActivityWorkflow,
} from '@/lib/employeeActivities';
import {
  fetchAssignedSpjEvents,
  type AssignedSpjEvent,
} from '@/lib/payroll/assignedSpjEvents';
import {
  filterEmployeeActivityHistory,
  summarizeEmployeeActivityHistory,
} from '@/lib/employeeActivityHistory';
import {
  loadGoogleMapsScript,
  type ActivityReport,
  type SatpamPostAssignment,
  type PendingDailyLiburSwap,
  getTodayISO,
  getInitialSatpamDateISO,
  createBlankSatpamAssignments,
  POSTS_CONFIG,
  type SatpamDraftSyncStatus,
  createSatpamDraftFingerprint,
} from './activityShared';
export {
  getEffectiveVehicleRate,
  DestinationImageBanner,
  calculateSopirDefaultFee,
  fmtRp,
  journeyMainDestinationLabel,
  getNextDayISO,
  padTime,
  calculateDefaultFee,
  getActivityFeeBreakdown,
  getStatusConfig,
  YEARS,
  POSTS_CONFIG,
} from './activityShared';

export interface ActivitiesContentProps {
  workflow: EmployeeActivityWorkflow;
}

export function useEmployeeActivitiesModel({ workflow }: ActivitiesContentProps) {
  const { profile: rawProfile, activeProfile, logout, user } = useAuth();
  const profile = activeProfile || rawProfile;
  const router = useRouter();
  const searchParams = useSearchParams();
  const editReportIdParam = searchParams.get('editReportId');
  const activityProofInputRef = React.useRef<HTMLInputElement>(null);
  const foundItemPhotoInputRef = React.useRef<HTMLInputElement>(null);

  const normalizedCategories =
    profile?.permittedCategories?.map((category) =>
      category.trim().toUpperCase(),
    ) || [];
  const userJobCategory = workflow === 'satpam'
    ? 'SATPAM'
    : workflow === 'sopir'
      ? 'SOPIR'
      : normalizedCategories.find(
          (category) => category !== 'SATPAM' && category !== 'SOPIR',
        ) || normalizedCategories[0] || '';
  const isKebersihan = [
    'KEBERSIHAN',
    'KEBERSIHAN_PONTI',
    'PONTI',
  ].includes(userJobCategory);
  const isSopir = userJobCategory === 'SOPIR';
  const supportsSpjProof = isKebersihan || userJobCategory === 'TEKNISI' || userJobCategory === 'SATPAM';
  const isKetuaShiftSatpam = (profile?.role as string) === 'ketua_shift_satpam';

  // ── Satpam Shift Teams States ──
  const [myShiftTeam, setMyShiftTeam] = useState<any | null>(null);
  const [allSatpamEmployees, setAllSatpamEmployees] = useState<any[]>([]);
  const [satpamPos9Guards, setSatpamPos9Guards] = useState<
    Array<{ employeeId: string; teamId: string; name: string }>
  >([]);
  const [loadingSatpamConfig, setLoadingSatpamConfig] = useState(false);
  const [satpamReportDate, setSatpamReportDate] = useState<string>(getInitialSatpamDateISO());
  const [satpamSubmitting, setSatpamSubmitting] = useState(false);
  const [postAssignments, setPostAssignments] = useState<
    Record<string, SatpamPostAssignment>
  >(() => createBlankSatpamAssignments('Harian'));
  const [extraPostName, setExtraPostName] = useState('');
  const [extraEmployeeId, setExtraEmployeeId] = useState('');
  const [extraShiftType, setExtraShiftType] = useState('Lembur Sendiri');
  const [extraOvertimeReason, setExtraOvertimeReason] = useState('');
  const [satpamRegularPayType, setSatpamRegularPayType] = useState<'Harian' | 'Jumat & Libur'>('Harian');
  const [holidayCalendarConfigured, setHolidayCalendarConfigured] = useState(false);
  const [satpamFlexibilityEnabled, setSatpamFlexibilityEnabled] = useState(true);
  const [satpamDutyPlan, setSatpamDutyPlan] = useState<{
    enabled: boolean;
    planId: string | null;
    revision: number;
    status: string;
    warning: string | null;
    fixedPost9EmployeeId: string | null;
    day: SatpamDutyPlanDay | null;
    generatedDays: SatpamDutyPlanDay[];
  } | null>(null);
  const [satpamSuggestedShiftName, setSatpamSuggestedShiftName] = useState<'Pagi' | 'Sore' | 'Malam'>('Pagi');
  const [satpamReportedShiftName, setSatpamReportedShiftName] = useState<'Pagi' | 'Sore' | 'Malam'>('Pagi');
  const [satpamOpenPeriods, setSatpamOpenPeriods] = useState<Array<{ period: string; startDate: string; endDate: string }>>([]);
  const [satpamOccurrenceId, setSatpamOccurrenceId] = useState('');
  const [satpamOccurrenceRevision, setSatpamOccurrenceRevision] = useState(0);
  const [satpamAuditorActionAt, setSatpamAuditorActionAt] = useState<any>(null);
  const [satpamReviewStatus, setSatpamReviewStatus] = useState<'draft' | 'pending_review' | 'under_review' | 'approved' | 'partially_approved' | 'declined'>('draft');
  const [satpamAnomalies, setSatpamAnomalies] = useState<SatpamShiftAnomaly[]>([]);
  const [satpamDraftHydrated, setSatpamDraftHydrated] = useState(false);
  const [satpamDraftSyncStatus, setSatpamDraftSyncStatus] =
    useState<SatpamDraftSyncStatus>('idle');
  const [satpamHasPendingDraft, setSatpamHasPendingDraft] = useState(false);
  const [satpamDraftRetryNonce, setSatpamDraftRetryNonce] = useState(0);
  const [copyingPreviousShift, setCopyingPreviousShift] = useState(false);
  const [satpamEmployeeSearch, setSatpamEmployeeSearch] = useState('');
  const satpamRequestIdsRef = useRef<Record<string, string>>({});
  const satpamDraftBaselineRef = useRef('');
  const satpamDraftDirtyRef = useRef(false);
  const satpamDraftGenerationRef = useRef(0);
  const satpamDraftSequenceRef = useRef(0);
  const satpamDraftSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [satpamDraftSessionId] = useState(() =>
    createFinancialRequestId('satpam_draft'),
  );
  // The duty date this form's postAssignments actually belong to. Tracked in a
  // ref because it has to update synchronously: when the date changes, React
  // re-runs the autosave effect in the same pass with the *previous* day's
  // roster still in state, and a state flag reset would not be visible yet.
  // Without this, the outgoing day's roster gets stamped onto the incoming
  // day's draft key, making every date look one day behind.
  const satpamHydratedDateRef = useRef('');
  // Async uploads and requests may finish after a slow mobile user has changed
  // the date. Compare their captured date with this ref before committing any
  // result so an old photo/response cannot mutate the newly selected form.
  const satpamSelectedDateRef = useRef(satpamReportDate);
  const [isExtraPostVisible, setIsExtraPostVisible] = useState(false);
  const [loadingSubmittedSatpam, setLoadingSubmittedSatpam] = useState(false);
  const [isSatpamReportSubmitted, setIsSatpamReportSubmitted] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingDailyLiburSwap, setPendingDailyLiburSwap] =
    useState<PendingDailyLiburSwap | null>(null);
  const [dailyLiburSwapWorking, setDailyLiburSwapWorking] = useState(false);
  const [dailyLiburSwapError, setDailyLiburSwapError] = useState('');
  // Guard-post proof photos, keyed by post id ('Pos 1'..'Pos 9', 'extra').
  const [postPhotoUploading, setPostPhotoUploading] = useState<Record<string, boolean>>({});
  const [extraPhotoUrl, setExtraPhotoUrl] = useState('');
  const [extraPhotoAuditMetadata, setExtraPhotoAuditMetadata] = useState<PhotoAuditMetadata | undefined>();
  const [satpamPreviewPhoto, setSatpamPreviewPhoto] = useState<{ url: string; title: string } | null>(null);
  const postPhotoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const setPostPhotoInputRef = useCallback(
    (postId: string, input: HTMLInputElement | null) => {
      postPhotoInputRefs.current[postId] = input;
    },
    [],
  );
  const openPostPhotoInput = useCallback((postId: string) => {
    postPhotoInputRefs.current[postId]?.click();
  }, []);
  const satpamShiftCardRef = useRef<HTMLDivElement | null>(null);


  // ── Period ──
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const periodToken = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);

  // ── Activities ──
  const [activities, setActivities] = useState<ActivityReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignedSpjEvents, setAssignedSpjEvents] = useState<AssignedSpjEvent[]>([]);
  const [loadedAssignedSpjKey, setLoadedAssignedSpjKey] = useState<string | null>(null);
  const assignedSpjRequestKey = `${profile?.linkedEmployeeId || ''}|${periodToken}`;
  const loadingAssignedSpjEvents = Boolean(profile?.linkedEmployeeId) &&
    loadedAssignedSpjKey !== assignedSpjRequestKey;

  // ── Form state ──
  const [showForm, setShowForm] = useState(false);
  const [showSatpamSpjChoice, setShowSatpamSpjChoice] = useState(false);
  const [showFoundItemForm, setShowFoundItemForm] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityReport | null>(null);
  const [formActivityType, setFormActivityType] = useState<'Piket' | 'Standby' | 'Ro\'an' | 'Lainnya' | 'Buang Sampah'>('Piket');
  const [formName, setFormName] = useState('Piket');
  const [formCustomName, setFormCustomName] = useState('');
  const [formDate, setFormDate] = useState(getTodayISO());
  const [formTimeStart, setFormTimeStart] = useState('');
  const [formTimeEnd, setFormTimeEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formProofPhoto, setFormProofPhoto] = useState<PhotoEvidence | null>(null);
  const [uploadingProofPhoto, setUploadingProofPhoto] = useState(false);
  const [foundItemCategory, setFoundItemCategory] = useState<'satpam_found_item' | 'satpam_reprimand'>('satpam_found_item');
  const [foundItemName, setFoundItemName] = useState('');
  const [foundItemDate, setFoundItemDate] = useState(getTodayISO());
  const [foundItemPhotos, setFoundItemPhotos] = useState<PhotoEvidence[]>([]);
  const [uploadingFoundItemPhotos, setUploadingFoundItemPhotos] = useState(false);
  const isSubmittingRef = useRef(false);
  const activityRequestIdRef = useRef<string | null>(null);
  const employeeActionModalOpen =
    showForm ||
    showSatpamSpjChoice ||
    showFoundItemForm;
  const employeeActionModalHistoryRef = useRef(false);
  const revertingEmployeeActionModalHistoryRef = useRef(false);

  useEffect(() => {
    const handlePopState = () => {
      if (revertingEmployeeActionModalHistoryRef.current) {
        revertingEmployeeActionModalHistoryRef.current = false;
        return;
      }
      if (!employeeActionModalHistoryRef.current) return;

      employeeActionModalHistoryRef.current = false;
      setShowForm(false);
      setShowSatpamSpjChoice(false);
      setShowFoundItemForm(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (employeeActionModalOpen && !employeeActionModalHistoryRef.current) {
      const currentHistoryState =
        window.history.state && typeof window.history.state === 'object'
          ? window.history.state
          : {};
      window.history.pushState(
        { ...currentHistoryState, __employeeActionModal: true },
        '',
        window.location.href,
      );
      employeeActionModalHistoryRef.current = true;
      return;
    }

    if (!employeeActionModalOpen && employeeActionModalHistoryRef.current) {
      employeeActionModalHistoryRef.current = false;
      revertingEmployeeActionModalHistoryRef.current = true;
      window.history.back();
    }
  }, [employeeActionModalOpen]);

  // ── SOPIR specific form states ──
  const [formTripType, setFormTripType] = useState<'Dalam Kota' | 'Luar Kota'>('Dalam Kota');
  const [formVehicleType, setFormVehicleType] = useState<string>('Mobil Kecil');
  const [formIsMultiDay, setFormIsMultiDay] = useState<boolean>(false);
  const [formDateEnd, setFormDateEnd] = useState<string>('');
  const [formNightCount, setFormNightCount] = useState<number>(0);
  const [formFuelFee, setFormFuelFee] = useState<string>('');
  const [formTollParkingFee, setFormTollParkingFee] = useState<string>('');
  const [formFuelReceiptUrls, setFormFuelReceiptUrls] = useState<string[]>([]);
  const [formTollReceiptUrls, setFormTollReceiptUrls] = useState<string[]>([]);
  const [formPoints, setFormPoints] = useState<string[]>(['Pool Unipdu', '']);
  const [calculatedDistanceKm, setCalculatedDistanceKm] = useState<number>(0);
  const [calculatedDurationHours, setCalculatedDurationHours] = useState<number>(0);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string>('');
  const [routeCalculatedPoints, setRouteCalculatedPoints] = useState<string[]>([]);

  // ── SOPIR Additional Activities states ──
  const [showMapSelector, setShowMapSelector] = useState(false);
  const [mapSearchText, setMapSearchText] = useState('');
  const [mapAddress, setMapAddress] = useState('');
  const [mapLocation, setMapLocation] = useState<DriverJourneyLocation | null>(null);
  const [mapSearchError, setMapSearchError] = useState('');

  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);
  const mapElementRef = React.useRef<HTMLDivElement | null>(null);
  const mapGeocodeRequestRef = React.useRef(0);
  const {
    suggestions: placeSuggestions,
    isSearching: isSearchingPlaces,
    searchError: placeSearchError,
    search: searchPlaces,
    cancelSearch: cancelPlaceSearch,
  } = useCostSafePlaceAutocomplete({ loadGoogleMapsScript });

  // ── Journey claiming & completion states ──
  const [unassignedJourneys, setUnassignedJourneys] = useState<any[]>([]);
  const [myAssignedJourneys, setMyAssignedJourneys] = useState<any[]>([]);
  const [myClaimedJourneys, setMyClaimedJourneys] = useState<any[]>([]);
  const [myDriverJourneys, setMyDriverJourneys] = useState<any[]>([]);
  const [loadingJourneys, setLoadingJourneys] = useState(false);
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  // ── Piket Active & Self-Creation States ──
  const [isPiketActiveToday, setIsPiketActiveToday] = useState(false);
  const [activePiketStationName, setActivePiketStationName] = useState<string>('');
  const [showSelfPiketSpjModal, setShowSelfPiketSpjModal] = useState(false);
  const [selfPiketActivityName, setSelfPiketActivityName] = useState('');
  const [selfPiketStartPoint, setSelfPiketStartPoint] = useState('UNIPDU Jombang, Jawa Timur');
  const [selfPiketStartPointLocation, setSelfPiketStartPointLocation] = useState<DriverJourneyLocation>(
    DEFAULT_DRIVER_JOURNEY_LOCATION,
  );
  const [selfPiketEndPoint, setSelfPiketEndPoint] = useState('');
  const [selfPiketEndPointLocation, setSelfPiketEndPointLocation] = useState<DriverJourneyLocation | null>(null);
  const [selfPiketVehicleName, setSelfPiketVehicleName] = useState<DriverVehicleName>(DEFAULT_DRIVER_VEHICLE_NAME);
  const [selfPiketFuelProcurementMode, setSelfPiketFuelProcurementMode] = useState<FuelProcurementMode>('hold_accumulate');
  const [selfPiketFuelBalances, setSelfPiketFuelBalances] = useState<VehicleFuelBalanceItem[]>([]);
  const [creatingPiketSpj, setCreatingPiketSpj] = useState(false);

  // Self Piket SPJ calculation states
  const [selfPiketCalcDistance, setSelfPiketCalcDistance] = useState<number | null>(null);
  const [selfPiketCalcDuration, setSelfPiketCalcDuration] = useState<number | null>(null);
  const [selfPiketCalculating, setSelfPiketCalculating] = useState(false);
  const [selfPiketCalcError, setSelfPiketCalcError] = useState('');
  const [selfPiketTollFee, setSelfPiketTollFee] = useState<string>('');
  const [mapTargetMode, setMapTargetMode] = useState<'piketStart' | 'piketEnd' | 'extra' | null>(null);
  const lastSelfPiketCalculatedRef = useRef<{ start: string; end: string }>({ start: '', end: '' });

  const loadSelfPiketFuelBalances = useCallback(async () => {
    if (!user || !isSopir) return;
    try {
      const result = await authenticatedJson<{ balances?: VehicleFuelBalanceItem[] }>(
        '/api/driver-journeys/vehicle-fuel-balances',
      );
      if (result?.balances) {
        setSelfPiketFuelBalances(result.balances);
      }
    } catch (err) {
      console.error('Error loading vehicle fuel balances:', err);
    }
  }, [user, isSopir]);

  useEffect(() => {
    if (showSelfPiketSpjModal) {
      void loadSelfPiketFuelBalances();
    }
  }, [showSelfPiketSpjModal, loadSelfPiketFuelBalances]);

  const selectedSelfPiketFuelBalance = useMemo(
    () => selfPiketFuelBalances.find((b) => b.vehicleName === selfPiketVehicleName) || null,
    [selfPiketFuelBalances, selfPiketVehicleName],
  );

  const selfPiketTollFeeValue = selfPiketTollFee
    ? parseInt(selfPiketTollFee.replace(/\D/g, ''), 10) || 0
    : 0;

  const selfPiketOperationalCosts = useMemo(() => {
    if (selfPiketCalcDistance === null || selfPiketCalcDuration === null) return null;
    const mode = selfPiketVehicleName === DEFAULT_DRIVER_VEHICLE_NAME
      ? DEFAULT_FUEL_PROCUREMENT_MODE
      : selfPiketFuelProcurementMode;
    const procuredAccumulatedAmount = mode === 'procure_release'
      ? Number(selectedSelfPiketFuelBalance?.accumulatedHoldAmount || 0)
      : 0;
    return calculateDriverJourneyOperationalCosts(
      selfPiketCalcDistance,
      selfPiketCalcDuration * 2,
      selfPiketVehicleName,
      selfPiketTollFeeValue,
      {
        fuelProcurementMode: mode,
        procuredAccumulatedAmount,
        mealAccountingMode: CURRENT_MEAL_ACCOUNTING_MODE,
      },
    );
  }, [
    selfPiketCalcDistance,
    selfPiketCalcDuration,
    selfPiketVehicleName,
    selfPiketFuelProcurementMode,
    selectedSelfPiketFuelBalance,
    selfPiketTollFeeValue,
  ]);

  const submittedSelfPiketSpjCount = useMemo(
    () => countSubmittedSelfPiketJourneysOnDate(
      getTodayDateString('Asia/Jakarta'),
      profile?.linkedEmployeeId || '',
      myDriverJourneys,
    ),
    [myDriverJourneys, profile?.linkedEmployeeId],
  );

  const resetSelfPiketForm = useCallback(() => {
    setSelfPiketActivityName('');
    setSelfPiketStartPoint('UNIPDU Jombang, Jawa Timur');
    setSelfPiketStartPointLocation(DEFAULT_DRIVER_JOURNEY_LOCATION);
    setSelfPiketEndPoint('');
    setSelfPiketEndPointLocation(null);
    setSelfPiketVehicleName(DEFAULT_DRIVER_VEHICLE_NAME);
    setSelfPiketFuelProcurementMode('hold_accumulate');
    setSelfPiketCalcDistance(null);
    setSelfPiketCalcDuration(null);
    setSelfPiketCalculating(false);
    setSelfPiketCalcError('');
    setSelfPiketTollFee('');
    setMapTargetMode(null);
    lastSelfPiketCalculatedRef.current = { start: '', end: '' };
  }, []);

  const openSelfPiketSpjModal = useCallback(() => {
    resetSelfPiketForm();
    setShowSelfPiketSpjModal(true);
  }, [resetSelfPiketForm]);

  const closeSelfPiketSpjModal = useCallback(() => {
    setShowSelfPiketSpjModal(false);
    resetSelfPiketForm();
  }, [resetSelfPiketForm]);

  // Real-time listener to check if current driver has an active piket schedule today
  useEffect(() => {
    if (!isSopir || !profile?.linkedEmployeeId) return;

    const todayStr = getTodayDateString('Asia/Jakarta');
    const qPiket = query(
      collection(db, 'DriverPiketSchedules'),
      where('date', '==', todayStr),
      where('driverId', '==', profile.linkedEmployeeId)
    );

    const unsubPiket = onSnapshot(
      qPiket,
      (snap) => {
        if (!snap.empty) {
          setIsPiketActiveToday(true);
          const data: any = snap.docs[0].data();
          setActivePiketStationName(data.stationName || '');
        } else {
          setIsPiketActiveToday(false);
          setActivePiketStationName('');
        }
      },
      (err) => {
        console.error('Error listening to driver piket schedule today:', err);
      }
    );

    return () => unsubPiket();
  }, [isSopir, profile?.linkedEmployeeId]);

  // Route calculation effect for self piket SPJ modal
  useEffect(() => {
    if (!showSelfPiketSpjModal || !selfPiketStartPoint || !selfPiketEndPoint) {
      setSelfPiketCalcDistance(null);
      setSelfPiketCalcDuration(null);
      return;
    }

    if (
      lastSelfPiketCalculatedRef.current.start === selfPiketStartPoint &&
      lastSelfPiketCalculatedRef.current.end === selfPiketEndPoint &&
      selfPiketCalcDistance !== null
    ) {
      return;
    }

    const timer = setTimeout(() => {
      const calculateRoute = async () => {
        setSelfPiketCalculating(true);
        setSelfPiketCalcError('');
        try {
          if (!user) throw new Error('Sesi tidak ditemukan.');
          const idToken = await user.getIdToken();
          const response = await fetch('/api/calculate-route', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              points: [
                driverJourneyRoutePoint(selfPiketStartPoint, selfPiketStartPointLocation),
                driverJourneyRoutePoint(selfPiketEndPoint, selfPiketEndPointLocation),
              ],
            }),
          });
          const data = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Gagal menghitung rute.');
          }

          setSelfPiketCalcDistance(data.distanceKm);
          setSelfPiketCalcDuration(data.durationHours);
          lastSelfPiketCalculatedRef.current = { start: selfPiketStartPoint, end: selfPiketEndPoint };
        } catch (err: any) {
          console.error(err);
          setSelfPiketCalcError(err.message || 'Terjadi kesalahan jaringan.');
        } finally {
          setSelfPiketCalculating(false);
        }
      };

      calculateRoute();
    }, 600);

    return () => clearTimeout(timer);
  }, [
    showSelfPiketSpjModal,
    selfPiketStartPoint,
    selfPiketStartPointLocation,
    selfPiketEndPoint,
    selfPiketEndPointLocation,
    user,
  ]);

  const handleCreateSelfPiketSpj = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !selfPiketActivityName.trim() ||
      !selfPiketEndPoint.trim() ||
      selfPiketCalcDistance === null ||
      selfPiketCalcDistance <= 0 ||
      selfPiketCalcDuration === null ||
      selfPiketCalcDuration <= 0
    ) {
      alert('Mohon lengkapi nama kegiatan dan tujuan perjalanan.');
      return;
    }
    if (!profile?.linkedEmployeeId) {
      alert('Profil Anda belum terhubung ke data Pegawai.');
      return;
    }
    if (myClaimedJourneys.length > 0) {
      alert('Anda masih memiliki tugas perjalanan aktif yang belum selesai dilaporkan. Selesaikan laporan perjalanan terlebih dahulu.');
      return;
    }

    setCreatingPiketSpj(true);
    try {
      const mode = selfPiketVehicleName === DEFAULT_DRIVER_VEHICLE_NAME
        ? DEFAULT_FUEL_PROCUREMENT_MODE
        : selfPiketFuelProcurementMode;
      const createdJourney = await authenticatedJson<{ journeyId: string }>('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_self',
          activityName: selfPiketActivityName.trim(),
          startPoint: selfPiketStartPoint.trim(),
          startPointLocation: selfPiketStartPointLocation,
          endPoint: selfPiketEndPoint.trim(),
          endPointLocation: selfPiketEndPointLocation,
          vehicleName: selfPiketVehicleName,
          fuelProcurementMode: mode,
          distanceKm: selfPiketCalcDistance,
          durationHours: selfPiketCalcDuration,
          tollParkingFee: selfPiketTollFeeValue,
        }),
      });

      closeSelfPiketSpjModal();
      router.push(`${SOPIR_JOURNEY_REPORT_PATH}?id=${createdJourney.journeyId}`);
    } catch (err: any) {
      console.error('Error creating self piket SPJ:', err);
      alert(err?.message || 'Gagal membuat SPJ piket. Coba lagi.');
    } finally {
      setCreatingPiketSpj(false);
    }
  };

  // Auto-open edit modal if editReportId param is passed from DriverHistoryPage
  useEffect(() => {
    if (!editReportIdParam || !profile?.linkedEmployeeId) return;

    const fetchAndEdit = async () => {
      try {
        const docRef = doc(db, 'ActivityReports', editReportIdParam);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const act = { id: docSnap.id, ...docSnap.data() } as ActivityReport;
          if (act.employeeId === profile.linkedEmployeeId && (act.status === 'pending' || act.status === 'declined')) {
            openEditForm(act);
          }
        }
      } catch (err) {
        console.error('Error fetching report to edit from URL param:', err);
      }
    };

    fetchAndEdit();
  }, [editReportIdParam, profile?.linkedEmployeeId]);

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
        // Compatibility path for records created before coordinates were stored.
        geocoder.geocode({ address: existingAddress, region: 'id' }, (results: any, status: any) => {
          if (status === 'OK' && results?.[0]?.geometry?.location) {
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





  const handleConfirmMapLocation = async () => {
    if (!mapAddress.trim() || !mapLocation) return;

    if (mapTargetMode === 'piketStart') {
      setSelfPiketStartPoint(mapAddress.trim());
      setSelfPiketStartPointLocation(mapLocation);
      setSelfPiketCalcDistance(null);
      lastSelfPiketCalculatedRef.current = { start: '', end: '' };
      resetMapSearch();
      setShowMapSelector(false);
      setMapTargetMode(null);
      return;
    }

    if (mapTargetMode === 'piketEnd') {
      setSelfPiketEndPoint(mapAddress.trim());
      setSelfPiketEndPointLocation(mapLocation);
      setSelfPiketCalcDistance(null);
      lastSelfPiketCalculatedRef.current = { start: '', end: '' };
      resetMapSearch();
      setShowMapSelector(false);
      setMapTargetMode(null);
    }
  };

  // ── Notifications ──
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Filter ──
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('all');

  // ── Expandable activity cards ──
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Enforce July 2026 to current month/year limit for Ketua Shift Satpam
  useEffect(() => {
    if (isKetuaShiftSatpam) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      if (year < 2026) {
        setYear(2026);
        setMonth(7);
      } else if (year > currentYear) {
        setYear(currentYear);
        setMonth(currentMonth);
      } else if (year === 2026 && month < 7) {
        setMonth(7);
      } else if (year === currentYear && month > currentMonth) {
        setMonth(currentMonth);
      }
    }
  }, [isKetuaShiftSatpam, year, month]);

  // ── Load the minimum Satpam directory through the authorized server DTO ──
  useEffect(() => {
    if (!isKetuaShiftSatpam || !profile?.linkedEmployeeId) return;

    const requestedDate = satpamReportDate;
    let isCurrentRequest = true;
    const loadSatpamConfig = async () => {
      setLoadingSatpamConfig(true);
      try {
        const config = await authenticatedJson<{
          requestedDutyDate: string;
          team: any;
          employees: { id: string; name: string; isActive?: boolean }[];
          pos9Guards: Array<{ employeeId: string; teamId: string; name: string }>;
          shiftName: 'Pagi' | 'Sore' | 'Malam';
          regularPayType: 'Harian' | 'Jumat & Libur';
          holidayCalendarConfigured: boolean;
          openPeriods: Array<{ period: string; startDate: string; endDate: string }>;
          planningPeriods: Array<{
            period: string;
            startDate: string;
            endDate: string;
            planningOnly?: boolean;
          }>;
          flexibilityEnabled: boolean;
          dutyPlan: {
            enabled: boolean;
            planId: string | null;
            revision: number;
            status: string;
            warning: string | null;
            fixedPost9EmployeeId: string | null;
            day: SatpamDutyPlanDay | null;
            generatedDays: SatpamDutyPlanDay[];
          };
        }>(`/api/satpam/config?dutyDate=${encodeURIComponent(requestedDate)}`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (
          !isCurrentRequest ||
          satpamSelectedDateRef.current !== requestedDate ||
          config.requestedDutyDate !== requestedDate
        ) {
          return;
        }
        setMyShiftTeam(config.team);
        setAllSatpamEmployees(config.employees);
        setSatpamPos9Guards(config.pos9Guards || []);
        setSatpamSuggestedShiftName(config.shiftName);
        setSatpamRegularPayType(config.regularPayType);
        setHolidayCalendarConfigured(config.holidayCalendarConfigured);
        setSatpamOpenPeriods(config.openPeriods || []);
        setSatpamFlexibilityEnabled(config.flexibilityEnabled !== false);
        setSatpamDutyPlan(config.dutyPlan || null);
      } catch (err) {
        if (!isCurrentRequest) return;
        console.error('Error loading Satpam shift configuration:', err);
        setMessage({
          type: 'error',
          text: err instanceof Error ? err.message : 'Konfigurasi Satpam gagal dimuat.',
        });
      } finally {
        if (isCurrentRequest) setLoadingSatpamConfig(false);
      }
    };

    void loadSatpamConfig();
    return () => {
      isCurrentRequest = false;
    };
  }, [isKetuaShiftSatpam, profile?.linkedEmployeeId, satpamReportDate]);

  useEffect(() => {
    if (!profile?.linkedEmployeeId || !userJobCategory || isKetuaShiftSatpam) return;
    authenticatedJson<{
      openPeriods: Array<{ period: string; startDate: string; endDate: string }>;
    }>('/api/payroll/periods', { method: 'GET' })
      .then((response) => setSatpamOpenPeriods(response.openPeriods || []))
      .catch((error) => {
        console.error('Error loading open payroll periods:', error);
      });
  }, [isKetuaShiftSatpam, profile?.linkedEmployeeId, userJobCategory]);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // ── Fetch Activities (dummy/refresh trigger for backward compatibility) ──
  const fetchActivities = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // ── Real-time Listener for Employee Activities ──
  useEffect(() => {
    if (!profile?.linkedEmployeeId) return;
    setLoading(true);

    const q = query(
      collection(db, 'ActivityReports'),
      where('employeeId', '==', profile.linkedEmployeeId),
      where('period', '==', periodToken),
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const list: ActivityReport[] = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      } as ActivityReport));

      // Sort by date desc, then by submittedAt desc
      list.sort((a, b) => {
        const dateCmp = b.activityDate.localeCompare(a.activityDate);
        if (dateCmp !== 0) return dateCmp;
        const aTime = a.submittedAt?.toDate?.()?.getTime?.() ?? 0;
        const bTime = b.submittedAt?.toDate?.()?.getTime?.() ?? 0;
        return bTime - aTime;
      });

      setActivities(list);
      setLoading(false);
    }, (err) => {
      console.error('Error listening to employee activities:', err);
      setMessage({ type: 'error', text: 'Gagal memuat data kegiatan.' });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [profile?.linkedEmployeeId, periodToken, refreshTrigger]);

  // Server-scoped history for administrator-assigned SPJ events. Employees
  // never receive the full KegiatanSpj documents or another worker's amount.
  useEffect(() => {
    if (!profile?.linkedEmployeeId || isSopir) {
      setAssignedSpjEvents([]);
      setLoadedAssignedSpjKey(assignedSpjRequestKey);
      return;
    }
    let active = true;
    fetchAssignedSpjEvents(periodToken)
      .then((events) => {
        if (!active) return;
        setAssignedSpjEvents(events);
        setLoadedAssignedSpjKey(assignedSpjRequestKey);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Error loading assigned SPJ history:', error);
        setAssignedSpjEvents([]);
        setLoadedAssignedSpjKey(assignedSpjRequestKey);
      });
    return () => {
      active = false;
    };
  }, [profile?.linkedEmployeeId, periodToken, refreshTrigger, assignedSpjRequestKey, isSopir]);

  // ── Real-time listener for Driver Journeys (Sopir only) ──
  useEffect(() => {
    if (!isSopir || !profile?.linkedEmployeeId) return;

    setLoadingJourneys(true);
    // 1. Unassigned journeys (Open Pool)
    const qUnassigned = query(
      collection(db, 'DriverJourneys'),
      where('status', 'in', ['unassigned', 'open'])
    );
    const unsubUnassigned = onSnapshot(qUnassigned, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUnassignedJourneys(list);
      setLoadingJourneys(false);
    }, (err) => {
      console.error('Error listening to unassigned journeys:', err);
      setLoadingJourneys(false);
    });

    // 2. Assigned journeys pre-allocated for this driver
    const qMyAssigned = query(
      collection(db, 'DriverJourneys'),
      where('assignedTo', '==', profile.linkedEmployeeId),
      where('status', '==', 'assigned')
    );
    const unsubMyAssigned = onSnapshot(qMyAssigned, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMyAssignedJourneys(list);
    }, (err) => {
      console.error('Error listening to assigned journeys:', err);
    });

    // 3. All journeys for this driver. The same feed drives both the active
    // claimed guard and the daily count of already submitted Piket SPJs.
    const qMyJourneys = query(
      collection(db, 'DriverJourneys'),
      where('employeeId', '==', profile.linkedEmployeeId)
    );
    const unsubMyJourneys = onSnapshot(qMyJourneys, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMyDriverJourneys(list);
      setMyClaimedJourneys(list.filter((journey: any) => journey.status === 'claimed'));
    }, (err) => {
      console.error('Error listening to driver journeys:', err);
    });

    return () => {
      unsubUnassigned();
      unsubMyAssigned();
      unsubMyJourneys();
    };
  }, [isSopir, profile?.linkedEmployeeId]);

  // Auto-redirect driver to dedicated /employee/activities/sopir/journey-report if an active claimed journey exists
  useEffect(() => {
    if (!isSopir) return;

    const cancelledJourneyId = typeof window !== 'undefined'
      ? sessionStorage.getItem('cancelled_driver_journey_id')
      : null;
    const cancelledJourneyAt = typeof window !== 'undefined'
      ? Number(sessionStorage.getItem('cancelled_driver_journey_at') || 0)
      : 0;
    const cancellationIsFresh = Boolean(
      cancelledJourneyId &&
      cancelledJourneyAt > 0 &&
      Date.now() - cancelledJourneyAt < 10 * 60 * 1000,
    );
    if (cancelledJourneyId && !cancellationIsFresh) {
      sessionStorage.removeItem('cancelled_driver_journey_id');
      sessionStorage.removeItem('cancelled_driver_journey_at');
    }

    const submittedJourneyId = typeof window !== 'undefined'
      ? sessionStorage.getItem('submitted_driver_journey_id')
      : null;
    const submittedJourneyAt = typeof window !== 'undefined'
      ? Number(sessionStorage.getItem('submitted_driver_journey_at') || 0)
      : 0;
    const submissionIsFresh = Boolean(
      submittedJourneyId &&
      submittedJourneyAt > 0 &&
      Date.now() - submittedJourneyAt < 10 * 60 * 1000,
    );
    if (submittedJourneyId && !submissionIsFresh) {
      sessionStorage.removeItem('submitted_driver_journey_id');
      sessionStorage.removeItem('submitted_driver_journey_at');
    }

    const activeJourney = myClaimedJourneys.find((j: any) => j.status === 'claimed');
    if (cancellationIsFresh) {
      // Keep the guard while the real-time listener settles. An empty snapshot
      // is not proof that the deleted journey is gone permanently: a cached
      // snapshot can briefly arrive afterward and otherwise cause a redirect
      // loop back to the deleted report.
      if (!activeJourney || activeJourney.id === cancelledJourneyId) return;
      sessionStorage.removeItem('cancelled_driver_journey_id');
      sessionStorage.removeItem('cancelled_driver_journey_at');
    }

    if (submissionIsFresh) {
      if (!activeJourney || activeJourney.id === submittedJourneyId) return;
      sessionStorage.removeItem('submitted_driver_journey_id');
      sessionStorage.removeItem('submitted_driver_journey_at');
    }

    if (activeJourney) {
      router.push(`${SOPIR_JOURNEY_REPORT_PATH}?id=${activeJourney.id}`);
    }
  }, [isSopir, myClaimedJourneys, router]);

  // ── Filtered activities ──
  const filteredActivities = useMemo(
    () => filterEmployeeActivityHistory(activities, statusFilter),
    [activities, statusFilter],
  );

  // ── Stats ──
  const stats = useMemo(
    () => summarizeEmployeeActivityHistory(activities),
    [activities],
  );

  // ── Form Handlers ──
  const resetForm = () => {
    activityRequestIdRef.current = null;
    const defaultType = isKebersihan ? 'Piket' : 'Lainnya';
    const defaultName = isKebersihan ? 'Piket' : (isSopir ? 'Perjalanan Dinas' : '');
    setFormActivityType(defaultType);
    setFormName(defaultName);
    setFormCustomName('');
    setFormDate(getTodayISO());
    setFormTimeStart('');
    setFormTimeEnd('');
    setFormIsMultiDay(false);
    setFormDateEnd('');
    setFormTripType('Dalam Kota');
    setFormVehicleType('Mobil Kecil');
    setFormNightCount(0);
    setFormFuelFee('');
    setFormTollParkingFee('');
    setFormFuelReceiptUrls([]);
    setFormTollReceiptUrls([]);
    setFormProofPhoto(null);
    setUploadingProofPhoto(false);
    setFormPoints(['Pool Unipdu', '']);
    setCalculatedDistanceKm(0);
    setCalculatedDurationHours(0);
    setRouteError('');
    setRouteCalculatedPoints([]);
    setEditingActivity(null);
    setShowForm(false);
  };

  const resetFoundItemForm = () => {
    activityRequestIdRef.current = null;
    setFoundItemCategory('satpam_found_item');
    setFoundItemName('');
    setFoundItemDate(getTodayISO());
    setFoundItemPhotos([]);
    setUploadingFoundItemPhotos(false);
    setEditingActivity(null);
    setShowFoundItemForm(false);
  };


  const openEditForm = (activity: ActivityReport) => {
    if (activity.jobCategory === 'SOPIR' && activity.journeyId) {
      router.push(`${SOPIR_JOURNEY_REPORT_PATH}?id=${activity.journeyId}`);
      return;
    }

    if (activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand') {
      setEditingActivity(activity);
      setFoundItemCategory(activity.reportKind);
      setFoundItemName(activity.itemName || activity.activityName || '');
      setFoundItemDate(activity.activityDate || getTodayISO());
      setFoundItemPhotos(
        activity.proofPhotos?.length
          ? activity.proofPhotos
          : activity.photoUrl && activity.photoAuditMetadata
            ? [
                {
                  url: activity.photoUrl,
                  auditMetadata: activity.photoAuditMetadata,
                },
              ]
            : [],
      );
      setShowFoundItemForm(true);
      return;
    }

    const cleanName = activity.activityName.replace(/\s*\(.*\)\s*$/, '');
    setEditingActivity(activity);
    const type = isKebersihan
      ? (activity.activityType || (['Piket', 'Standby', 'Ro\'an', 'Buang Sampah'].includes(cleanName) ? cleanName : 'Lainnya'))
      : 'Lainnya';
    setFormActivityType(type as any);
    if (type === 'Lainnya') {
      setFormCustomName(cleanName);
      setFormName(cleanName);
    } else {
      setFormName(cleanName);
      setFormCustomName('');
    }
    setFormDate(activity.activityDate);
    setFormTimeStart(activity.timeStart);
    setFormTimeEnd(activity.timeEnd);
    setFormProofPhoto(
      activity.photoUrl && activity.photoAuditMetadata
        ? { url: activity.photoUrl, auditMetadata: activity.photoAuditMetadata }
        : null,
    );

    // SOPIR fields prefill
    setFormTripType(activity.tripType || 'Dalam Kota');
    setFormVehicleType(activity.vehicleType || 'Mobil Kecil');
    setFormNightCount(activity.nightCount || 0);
    setFormFuelFee(activity.fuelFee ? String(activity.fuelFee) : '');
    setFormTollParkingFee(activity.tollParkingFee ? String(activity.tollParkingFee) : '');
    setFormPoints(activity.points || ['Pool Unipdu', '']);
    setCalculatedDistanceKm(activity.distanceKm || 0);
    setCalculatedDurationHours(activity.durationHours || 0);
    setRouteCalculatedPoints(activity.points || ['Pool Unipdu', '']);

    setShowForm(true);
  };

  const handleCalculateRoute = async () => {
    const activePoints = formPoints.map(p => p.trim()).filter(Boolean);
    if (activePoints.length < 2) {
      setRouteError('Minimal 2 lokasi rute harus diisi.');
      return;
    }
    if (activePoints.length > MAX_DRIVER_JOURNEY_LOCATIONS) {
      setRouteError(`Maksimal ${MAX_DRIVER_JOURNEY_DESTINATIONS} titik tujuan dapat dihitung.`);
      return;
    }

    setIsCalculatingRoute(true);
    setRouteError('');
    try {
      if (!user) throw new Error('Sesi tidak ditemukan.');
      const idToken = await user.getIdToken();
      const response = await fetch('/api/calculate-route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ points: activePoints }),
      });
      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Gagal menghitung rute.');
      }

      setCalculatedDistanceKm(resData.distanceKm);
      setCalculatedDurationHours(resData.durationHours);
      setRouteCalculatedPoints([...formPoints]);
      setMessage({ type: 'success', text: `Rute berhasil dihitung: ${resData.distanceKm} km | ${resData.durationHours} jam` });
    } catch (err: any) {
      console.error(err);
      setRouteError(err.message || 'Terjadi kesalahan saat menghitung rute.');
      setCalculatedDistanceKm(0);
      setCalculatedDurationHours(0);
      setRouteCalculatedPoints([]);
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  const handleStartAssignedJourney = async (journeyId: string) => {
    if (!profile?.linkedEmployeeId) return;
    if (myClaimedJourneys.length > 0) {
      setMessage({
        type: 'error',
        text: 'Anda sedang menjalankan perjalanan aktif. Selesaikan atau laporkan perjalanan aktif Anda terlebih dahulu.',
      });
      return;
    }

    setIsClaiming(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    try {
      await authenticatedJson('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({ action: 'claim', journeyId }),
      });
      router.push(`${SOPIR_JOURNEY_REPORT_PATH}?id=${journeyId}`);
    } catch (err) {
      console.error('Error starting assigned journey:', err);
      setMessage({ type: 'error', text: 'Gagal memulai perjalanan tugas.' });
    } finally {
      setIsClaiming(false);
    }
  };

  const handleClaimJourney = async (journeyId: string) => {
    if (!profile?.linkedEmployeeId) return;
    if (myClaimedJourneys.length > 0) {
      setMessage({
        type: 'error',
        text: 'Anda memiliki perjalanan aktif yang sedang berjalan. Selesaikan perjalanan tersebut terlebih dahulu.',
      });
      return;
    }

    setIsClaiming(true);
    // Purposeful delay to show the loading animation clearly to the user
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      await authenticatedJson('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({ action: 'claim', journeyId }),
      });
      router.push(`${SOPIR_JOURNEY_REPORT_PATH}?id=${journeyId}`);
    } catch (err) {
      console.error('Error claiming journey:', err);
      setMessage({ type: 'error', text: 'Gagal mengambil perjalanan.' });
    } finally {
      setIsClaiming(false);
    }
  };

  const handleCancelJourney = async (journeyId: string) => {
    if (!confirm('Apakah Anda yakin ingin membatalkan klaim perjalanan ini? Perjalanan akan tersedia kembali untuk sopir lain.')) {
      return;
    }

    setIsCancelling(true);
    // Purposeful delay to show the loading animation clearly to the user
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      await authenticatedJson('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({ action: 'cancel_claim', journeyId }),
      });
      setMessage({ type: 'success', text: 'Klaim perjalanan berhasil dibatalkan.' });
    } catch (err) {
      console.error('Error cancelling journey claim:', err);
      setMessage({ type: 'error', text: 'Gagal membatalkan klaim perjalanan.' });
    } finally {
      setIsCancelling(false);
    }
  };



  // ── Satpam Shift Team Logging Computations & Handlers ──
  const groupEmployeeIds = useMemo(() => {
    if (!myShiftTeam) return [];
    return [myShiftTeam.ketuaShiftId, ...(myShiftTeam.memberEmployeeIds || [])];
  }, [myShiftTeam]);

  const groupEmployees = useMemo(() => {
    return allSatpamEmployees.filter(emp => groupEmployeeIds.includes(emp.id) && emp.isActive !== false);
  }, [allSatpamEmployees, groupEmployeeIds]);

  const externalEmployees = useMemo(() => {
    return allSatpamEmployees.filter(emp => !groupEmployeeIds.includes(emp.id) && emp.isActive !== false);
  }, [allSatpamEmployees, groupEmployeeIds]);

  const pos9GuardIds = useMemo(
    () => new Set(satpamPos9Guards.map((guard) => guard.employeeId)),
    [satpamPos9Guards],
  );
  const pos9Employees = useMemo(
    () => allSatpamEmployees.filter(
      (employee) => pos9GuardIds.has(employee.id) && employee.isActive !== false,
    ),
    [allSatpamEmployees, pos9GuardIds],
  );

  const visibleGroupEmployees = useMemo(() => {
    const search = satpamEmployeeSearch.trim().toLocaleLowerCase('id');
    if (!search) return groupEmployees;
    return groupEmployees.filter((employee) =>
      String(employee.name || '').toLocaleLowerCase('id').includes(search),
    );
  }, [groupEmployees, satpamEmployeeSearch]);

  const visibleExternalEmployees = useMemo(() => {
    const search = satpamEmployeeSearch.trim().toLocaleLowerCase('id');
    if (!search) return externalEmployees;
    return externalEmployees.filter((employee) =>
      String(employee.name || '').toLocaleLowerCase('id').includes(search),
    );
  }, [externalEmployees, satpamEmployeeSearch]);

  const visiblePos9Employees = useMemo(() => {
    const search = satpamEmployeeSearch.trim().toLocaleLowerCase('id');
    if (!search) return pos9Employees;
    return pos9Employees.filter((employee) =>
      String(employee.name || '').toLocaleLowerCase('id').includes(search),
    );
  }, [pos9Employees, satpamEmployeeSearch]);

  const visibleAllSatpamEmployees = useMemo(() => {
    const search = satpamEmployeeSearch.trim().toLocaleLowerCase('id');
    if (!search) return allSatpamEmployees.filter((employee) => employee.isActive !== false);
    return allSatpamEmployees.filter(
      (employee) =>
        employee.isActive !== false &&
        String(employee.name || '').toLocaleLowerCase('id').includes(search),
    );
  }, [allSatpamEmployees, satpamEmployeeSearch]);

  const teamNumber = useMemo(() => {
    if (!myShiftTeam) return 1;
    return parseInt(myShiftTeam.id.split('_')[1], 10) || 1;
  }, [myShiftTeam]);

  const isCrossTeamPos9Guard = useCallback(
    (postId: string, employeeId: string) =>
      postId === 'Pos 9' &&
      Boolean(employeeId) &&
      pos9GuardIds.has(employeeId) &&
      !groupEmployeeIds.includes(employeeId) &&
      employeeId !== satpamDutyPlan?.fixedPost9EmployeeId,
    [groupEmployeeIds, pos9GuardIds, satpamDutyPlan?.fixedPost9EmployeeId],
  );

  const activeShift = useMemo(() => {
    if (!isKetuaShiftSatpam) return 'Pagi';
    return satpamReportedShiftName;
  }, [isKetuaShiftSatpam, satpamReportedShiftName]);

  const calculatedSuggestedShift = useMemo(
    () => getSatpamShiftForTeam(teamNumber, satpamReportDate),
    [teamNumber, satpamReportDate],
  );

  const isSatpamReportLocked =
    isSatpamReportSubmitted &&
    (Boolean(satpamAuditorActionAt) ||
      !['pending_review', 'draft'].includes(satpamReviewStatus));
  const isSatpamPhotoUploadInProgress = Object.values(
    postPhotoUploading,
  ).some(Boolean);

  // v3 retires v2 drafts that could still be poisoned when a production/mobile
  // GET failed: the old error path relabelled the previous date's in-memory form
  // as hydrated for the newly selected date and then autosaved it.
  const satpamPendingStorageKey = profile?.linkedEmployeeId
    ? satpamShiftDraftStorageKey(
        profile.linkedEmployeeId,
        satpamReportDate,
      )
    : '';

  useEffect(() => {
    if (!isKetuaShiftSatpam || !profile?.linkedEmployeeId || !satpamReportDate) return;

    const requestedDate = satpamReportDate;
    const defaultShiftTypeForDate = satpamRegularPayType;
    const hydrationGeneration = ++satpamDraftGenerationRef.current;
    let isMounted = true;
    setLoadingSubmittedSatpam(true);
    setSatpamDraftHydrated(false);
    setSatpamDraftSyncStatus('idle');
    setSatpamHasPendingDraft(false);
    satpamDraftBaselineRef.current = '';
    satpamDraftDirtyRef.current = false;
    satpamHydratedDateRef.current = '';

    // Clear every date-scoped value before starting the request. In particular,
    // never leave the previous day's photo URLs visible while production/mobile
    // networking is slow or fails.
    setPostAssignments(createBlankSatpamAssignments(defaultShiftTypeForDate));
    setSatpamOccurrenceId('');
    setSatpamOccurrenceRevision(0);
    setSatpamAuditorActionAt(null);
    setSatpamReviewStatus('draft');
    setSatpamAnomalies([]);
    setSatpamSuggestedShiftName(calculatedSuggestedShift);
    setSatpamReportedShiftName(calculatedSuggestedShift);
    setExtraEmployeeId('');
    setExtraPostName('');
    setExtraShiftType('Lembur Sendiri');
    setExtraOvertimeReason('');
    setExtraPhotoUrl('');
    setExtraPhotoAuditMetadata(undefined);
    setIsExtraPostVisible(false);
    setIsSatpamReportSubmitted(false);

    const restorePendingDraft = (
      pending: SatpamShiftPendingDraft | null,
      source: 'server' | 'local' | null,
      showRestoredMessage: boolean,
    ): boolean => {
      const restoredAssignments = createBlankSatpamAssignments(
        defaultShiftTypeForDate,
      );
      if (!pending) {
        setPostAssignments(restoredAssignments);
        setExtraEmployeeId('');
        setExtraPostName('');
        setExtraShiftType('Lembur Sendiri');
        setExtraOvertimeReason('');
        setExtraPhotoUrl('');
        setExtraPhotoAuditMetadata(undefined);
        setIsExtraPostVisible(false);
        satpamDraftBaselineRef.current = createSatpamDraftFingerprint({
          shiftName: calculatedSuggestedShift,
          assignments: restoredAssignments,
          extraVisible: false,
          extraEmployeeId: '',
          extraPostName: '',
          extraOvertimeReason: '',
          extraPhotoUrl: '',
        });
        satpamDraftDirtyRef.current = false;
        setSatpamHasPendingDraft(false);
        setSatpamDraftSyncStatus('idle');
        return false;
      }

      const restoredShiftName =
        pending.payload.shiftName || calculatedSuggestedShift;
      setSatpamReportedShiftName(restoredShiftName);
      for (const assignment of pending.payload.assignments) {
        if (!restoredAssignments[assignment.postId]) continue;
        restoredAssignments[assignment.postId] = {
          employeeId: assignment.employeeId || '',
          shiftType: assignment.coveredEmployeeId
            ? 'Lembur Cover'
            : assignment.shiftType || defaultShiftTypeForDate,
          coveredEmployeeId: assignment.coveredEmployeeId || '',
          overtimeReason: assignment.overtimeReason || '',
          photoUrl: assignment.photoUrl || '',
          photoAuditMetadata: assignment.photoAuditMetadata,
        };
      }
      const pendingExtra = pending.payload.extraAssignment;
      const restoredExtraVisible =
        pending.payload.extraVisible === true || Boolean(pendingExtra);
      setPostAssignments(restoredAssignments);
      setExtraEmployeeId(pendingExtra?.employeeId || '');
      setExtraPostName(pendingExtra?.postId || '');
      setExtraShiftType('Lembur Sendiri');
      setExtraOvertimeReason(pendingExtra?.overtimeReason || '');
      setExtraPhotoUrl(pendingExtra?.photoUrl || '');
      setExtraPhotoAuditMetadata(pendingExtra?.photoAuditMetadata);
      setIsExtraPostVisible(restoredExtraVisible);
      satpamDraftBaselineRef.current = createSatpamDraftFingerprint({
        shiftName: restoredShiftName,
        assignments: restoredAssignments,
        extraVisible: restoredExtraVisible,
        extraEmployeeId: pendingExtra?.employeeId || '',
        extraPostName: pendingExtra?.postId || '',
        extraOvertimeReason: pendingExtra?.overtimeReason || '',
        extraPhotoUrl: pendingExtra?.photoUrl || '',
        extraPhotoAuditMetadata: pendingExtra?.photoAuditMetadata,
      });
      // A local draft may be newer than the server copy (for example, when the
      // app was closed before the request completed). Force one sync pass even
      // though its restored form exactly matches the hydration baseline.
      satpamDraftDirtyRef.current = source === 'local';
      setSatpamHasPendingDraft(true);
      setSatpamDraftSyncStatus(
        source === 'server'
          ? 'saved'
          : window.navigator.onLine === false
            ? 'offline'
            : 'saving',
      );
      if (pending.requestId) {
        satpamRequestIdsRef.current[
          `${requestedDate}_${pending.payload.shiftName || calculatedSuggestedShift}`
        ] = pending.requestId;
      }
      if (showRestoredMessage) {
        setMessage({
          type: 'success',
          text: 'Draf laporan yang belum selesai berhasil dipulihkan.',
        });
      }
      return true;
    };

    const readPendingDraft = (): SatpamShiftPendingDraft | null => {
      if (!satpamPendingStorageKey) return null;
      try {
        return parseSatpamShiftPendingDraft(
          window.localStorage.getItem(satpamPendingStorageKey),
          requestedDate,
        );
      } catch (error) {
        console.warn('Draf antrean Satpam lokal tidak dapat dibaca:', error);
        return null;
      }
    };

    const choosePendingDraft = (
      serverDraft: SatpamShiftPendingDraft | null | undefined,
    ): {
      draft: SatpamShiftPendingDraft | null;
      source: 'server' | 'local' | null;
    } => {
      const localDraft = readPendingDraft();
      const normalizedServerDraft = serverDraft
        ? parseSatpamShiftPendingDraft(
            JSON.stringify(serverDraft),
            requestedDate,
          )
        : null;
      if (!localDraft && !normalizedServerDraft) {
        return { draft: null, source: null };
      }
      if (!normalizedServerDraft) {
        return { draft: localDraft, source: localDraft ? 'local' : null };
      }
      if (!localDraft) {
        return { draft: normalizedServerDraft, source: 'server' };
      }
      const localSavedAt = Date.parse(localDraft.savedAt || '');
      const serverSavedAt = Date.parse(normalizedServerDraft.savedAt || '');
      if (localDraft.revision && normalizedServerDraft.revision) {
        if (localDraft.revision !== normalizedServerDraft.revision) {
          return localDraft.revision > normalizedServerDraft.revision
            ? { draft: localDraft, source: 'local' }
            : { draft: normalizedServerDraft, source: 'server' };
        }
        if (
          JSON.stringify(localDraft.payload) !==
          JSON.stringify(normalizedServerDraft.payload)
        ) {
          // Same server revision plus different local content means the local
          // edit happened after that revision and has not synced yet.
          return { draft: localDraft, source: 'local' };
        }
        return { draft: normalizedServerDraft, source: 'server' };
      }
      return Number.isFinite(localSavedAt) &&
        (!Number.isFinite(serverSavedAt) || localSavedAt > serverSavedAt)
        ? { draft: localDraft, source: 'local' }
        : { draft: normalizedServerDraft, source: 'server' };
    };

    authenticatedJson<{
      requestedDutyDate: string;
      resolvedDutyDate: string | null;
      occurrence: null | {
        id: string;
        dutyDate?: string;
        revision?: number;
        status?: string;
        reviewStatus?: string;
        auditorActionAt?: any;
        reportedShiftName?: 'Pagi' | 'Sore' | 'Malam';
        suggestedShiftName?: 'Pagi' | 'Sore' | 'Malam';
        anomalies?: SatpamShiftAnomaly[];
      };
      assignments: Array<{
        assignmentKind?: 'primary' | 'extra';
        postId?: string;
        postName?: string;
        employeeId?: string;
        shiftType?: string;
        coveredEmployeeId?: string;
        overtimeReason?: string;
        photoUrl?: string;
        photoAuditMetadata?: PhotoAuditMetadata;
        dutyDate?: string;
      }>;
      draft?: SatpamShiftPendingDraft | null;
    }>(`/api/satpam/shifts?dutyDate=${encodeURIComponent(requestedDate)}`, {
      method: 'GET',
      cache: 'no-store',
    }).then((response) => {
      if (
        !isMounted ||
        satpamDraftGenerationRef.current !== hydrationGeneration ||
        satpamSelectedDateRef.current !== requestedDate
      ) {
        return;
      }
      const { occurrence, assignments } = response;
      const pendingDraft = choosePendingDraft(response.draft);
      if (
        response.requestedDutyDate !== requestedDate ||
        response.resolvedDutyDate !== (occurrence ? requestedDate : null) ||
        (occurrence?.dutyDate !== undefined &&
          occurrence.dutyDate !== requestedDate) ||
        assignments.some(
          (assignment) =>
            assignment.dutyDate !== undefined &&
            assignment.dutyDate !== requestedDate,
        )
      ) {
        throw new Error(
          'Server mengembalikan laporan untuk tanggal yang berbeda.',
        );
      }

      if (occurrence) {
        let newAssignments = createBlankSatpamAssignments(
          defaultShiftTypeForDate,
        );
        let foundExtra = false;
        let extraEmpId = '';
        let extraPName = '';
        let extraSType = 'Lembur Sendiri';
        let extraReason = '';
        let extraPhoto = '';
        let extraPhotoMetadata: PhotoAuditMetadata | undefined;

        assignments.forEach((data) => {
          const rawPostName = data.postId || data.postName || '';

          if (data.assignmentKind === 'extra') {
            foundExtra = true;
            extraEmpId = data.employeeId || '';
            extraPName = String(data.postId || rawPostName).replace('Tambahan:', '').split(':')[0].trim();
            const matchedPost = POSTS_CONFIG.find(p => p.name === extraPName || p.id === extraPName);
            if (matchedPost) {
              extraPName = matchedPost.id;
            }
            extraSType = data.shiftType || 'Lembur Sendiri';
            extraReason = data.overtimeReason || '';
            extraPhoto = data.photoUrl || '';
            extraPhotoMetadata = data.photoAuditMetadata;
          } else {
            const match = rawPostName.match(/^(Pos\s+\d+)/i);
            if (match) {
              const posId = match[1];
              const numMatch = posId.match(/\d+/);
              if (numMatch) {
                const normPosId = `Pos ${numMatch[0]}`;
                if (newAssignments[normPosId]) {
                  newAssignments[normPosId] = {
                    employeeId: data.employeeId || '',
                    shiftType: data.shiftType || defaultShiftTypeForDate,
                    coveredEmployeeId: data.coveredEmployeeId || '',
                    overtimeReason: data.overtimeReason || '',
                    photoUrl: data.photoUrl || '',
                    photoAuditMetadata: data.photoAuditMetadata,
                  };
                }
              }
            }
          }
        });

        const occurrenceRevision = Number(occurrence.revision || 1);
        const normalizedReviewStatus: typeof satpamReviewStatus =
          occurrence.status === 'approved' || occurrence.reviewStatus === 'approved'
            ? 'approved'
            : occurrence.reviewStatus === 'partially_approved'
              ? 'partially_approved'
              : occurrence.status === 'declined' || occurrence.reviewStatus === 'declined'
                ? 'declined'
                : occurrence.status === 'under_review' || occurrence.reviewStatus === 'under_review'
                  ? 'under_review'
                  : 'pending_review';
        const occurrenceLocked =
          Boolean(occurrence.auditorActionAt) ||
          !['pending_review', 'draft'].includes(normalizedReviewStatus);
        const candidateDraft = pendingDraft.draft;
        const candidateBaseId = candidateDraft?.payload.baseOccurrenceId;
        const candidateBaseRevision =
          candidateDraft?.payload.baseOccurrenceRevision;
        // Legacy local drafts did not record their base occurrence. They are
        // allowed once as an overlay so users affected by the old bug recover
        // their Tambah Petugas entry. Every new server draft is revision-bound.
        const draftMatchesOccurrence = Boolean(
          candidateDraft &&
            !occurrenceLocked &&
            (pendingDraft.source === 'local' && !candidateBaseId
              ? true
              : candidateBaseId === occurrence.id &&
                candidateBaseRevision === occurrenceRevision),
        );
        const appliedDraft = draftMatchesOccurrence ? candidateDraft : null;

        if (appliedDraft) {
          if (appliedDraft.payload.completeSnapshot) {
            newAssignments = createBlankSatpamAssignments(
              defaultShiftTypeForDate,
            );
          }
          appliedDraft.payload.assignments.forEach((assignment) => {
            if (!newAssignments[assignment.postId]) return;
            newAssignments[assignment.postId] = {
              employeeId: assignment.employeeId || '',
              shiftType: assignment.coveredEmployeeId
                ? 'Lembur Cover'
                : assignment.shiftType || defaultShiftTypeForDate,
              coveredEmployeeId: assignment.coveredEmployeeId || '',
              overtimeReason: assignment.overtimeReason || '',
              photoUrl: assignment.photoUrl || '',
              photoAuditMetadata: assignment.photoAuditMetadata,
            };
          });

          const draftExtra = appliedDraft.payload.extraAssignment;
          if (appliedDraft.payload.completeSnapshot) {
            foundExtra = appliedDraft.payload.extraVisible === true;
            extraEmpId = draftExtra?.employeeId || '';
            extraPName = draftExtra?.postId || '';
            extraSType = 'Lembur Sendiri';
            extraReason = draftExtra?.overtimeReason || '';
            extraPhoto = draftExtra?.photoUrl || '';
            extraPhotoMetadata = draftExtra?.photoAuditMetadata;
          } else if (draftExtra || appliedDraft.payload.extraVisible) {
            foundExtra = true;
            extraEmpId = draftExtra?.employeeId || '';
            extraPName = draftExtra?.postId || '';
            extraSType = 'Lembur Sendiri';
            extraReason = draftExtra?.overtimeReason || '';
            extraPhoto = draftExtra?.photoUrl || '';
            extraPhotoMetadata = draftExtra?.photoAuditMetadata;
          }
        }

        const restoredShiftName =
          appliedDraft?.payload.shiftName ||
          occurrence.reportedShiftName ||
          calculatedSuggestedShift;
        setPostAssignments(newAssignments);
        setSatpamOccurrenceId(occurrence.id);
        setSatpamOccurrenceRevision(occurrenceRevision);
        setSatpamAuditorActionAt(occurrence.auditorActionAt || null);
        setSatpamReviewStatus(normalizedReviewStatus);
        setSatpamAnomalies(Array.isArray(occurrence.anomalies) ? occurrence.anomalies : []);
        setSatpamReportedShiftName(restoredShiftName);
        if (occurrence.suggestedShiftName) setSatpamSuggestedShiftName(occurrence.suggestedShiftName);
        if (foundExtra) {
          setExtraEmployeeId(extraEmpId);
          setExtraPostName(extraPName);
          setExtraShiftType(extraSType);
          setExtraOvertimeReason(extraReason);
          setExtraPhotoUrl(extraPhoto);
          setExtraPhotoAuditMetadata(extraPhotoMetadata);
          setIsExtraPostVisible(true);
        } else {
          setExtraEmployeeId('');
          setExtraPostName('');
          setExtraShiftType('Lembur Sendiri');
          setExtraOvertimeReason('');
          setExtraPhotoUrl('');
          setExtraPhotoAuditMetadata(undefined);
          setIsExtraPostVisible(false);
        }
        satpamDraftBaselineRef.current = createSatpamDraftFingerprint({
          shiftName: restoredShiftName,
          assignments: newAssignments,
          extraVisible: foundExtra,
          extraEmployeeId: foundExtra ? extraEmpId : '',
          extraPostName: foundExtra ? extraPName : '',
          extraOvertimeReason: foundExtra ? extraReason : '',
          extraPhotoUrl: foundExtra ? extraPhoto : '',
          extraPhotoAuditMetadata: foundExtra
            ? extraPhotoMetadata
            : undefined,
        });
        satpamDraftDirtyRef.current =
          Boolean(appliedDraft) && pendingDraft.source === 'local';
        setSatpamHasPendingDraft(Boolean(appliedDraft));
        setSatpamDraftSyncStatus(
          !appliedDraft
            ? 'idle'
            : pendingDraft.source === 'server'
              ? 'saved'
              : window.navigator.onLine === false
                ? 'offline'
                : 'saving',
        );
        if (appliedDraft && pendingDraft.source === 'server' && satpamPendingStorageKey) {
          try {
            window.localStorage.setItem(
              satpamPendingStorageKey,
              JSON.stringify(appliedDraft),
            );
          } catch (error) {
            console.warn('Draf Satpam server tidak dapat dicadangkan lokal:', error);
          }
        }
        if (appliedDraft) {
          setMessage({
            type: 'success',
            text: 'Draf perubahan laporan, termasuk Tambah Petugas, berhasil dipulihkan.',
          });
        } else if (candidateDraft && occurrenceLocked) {
          if (satpamPendingStorageKey) {
            try {
              window.localStorage.removeItem(satpamPendingStorageKey);
            } catch (error) {
              console.warn('Draf laporan terkunci gagal dibersihkan lokal:', error);
            }
          }
          if (response.draft) {
            void authenticatedJson(
              `/api/satpam/shifts/draft?dutyDate=${encodeURIComponent(requestedDate)}`,
              { method: 'DELETE' },
            ).catch((error) => {
              console.warn('Draf laporan terkunci gagal dibersihkan:', error);
            });
          }
          setMessage({
            type: 'error',
            text: 'Draf perubahan tidak dapat diterapkan karena auditor sudah menangani laporan ini.',
          });
        } else if (candidateDraft) {
          setMessage({
            type: 'error',
            text: 'Draf berasal dari revisi laporan yang lebih lama dan tidak diterapkan otomatis. Muat ulang sebelum mengubah laporan.',
          });
        }
        setIsSatpamReportSubmitted(true);
      } else {
        restorePendingDraft(
          pendingDraft.draft,
          pendingDraft.source,
          Boolean(pendingDraft.draft),
        );
        if (
          pendingDraft.draft &&
          pendingDraft.source === 'server' &&
          satpamPendingStorageKey
        ) {
          try {
            window.localStorage.setItem(
              satpamPendingStorageKey,
              JSON.stringify(pendingDraft.draft),
            );
          } catch (error) {
            console.warn('Draf Satpam server tidak dapat dicadangkan lokal:', error);
          }
        }
        setIsSatpamReportSubmitted(false);
      }
      satpamHydratedDateRef.current = requestedDate;
      setSatpamDraftHydrated(true);
      setLoadingSubmittedSatpam(false);
    }).catch((err) => {
      if (
        !isMounted ||
        satpamDraftGenerationRef.current !== hydrationGeneration ||
        satpamSelectedDateRef.current !== requestedDate
      ) {
        return;
      }
      console.error('Error fetching submitted Satpam reports:', err);
      // The old implementation left the previous date's state intact here and
      // then marked it as hydrated for requestedDate. Restore only a v3 draft
      // whose payload independently names requestedDate; otherwise stay blank.
      const restoredLocalDraft = readPendingDraft();
      restorePendingDraft(
        restoredLocalDraft,
        restoredLocalDraft ? 'local' : null,
        false,
      );
      satpamHydratedDateRef.current = requestedDate;
      setSatpamDraftHydrated(true);
      setLoadingSubmittedSatpam(false);
      setMessage({
        type: 'error',
        text: restoredLocalDraft
          ? 'Status server gagal dimuat, tetapi draf dari perangkat ini berhasil dipulihkan dan akan disinkronkan saat koneksi tersedia.'
          : 'Status laporan tanggal ini gagal dimuat. Form dikosongkan agar data tanggal lain tidak ikut tersalin; coba muat ulang sebelum mengirim.',
      });
    });

    return () => {
      isMounted = false;
    };
  }, [
    isKetuaShiftSatpam,
    satpamReportDate,
    profile?.linkedEmployeeId,
    satpamPendingStorageKey,
    calculatedSuggestedShift,
    satpamRegularPayType,
  ]);

  useEffect(() => {
    if (
      !isKetuaShiftSatpam ||
      !satpamDraftHydrated ||
      isSatpamReportSubmitted ||
      satpamHasPendingDraft ||
      !satpamDutyPlan?.day
    ) {
      return;
    }
    // The duty plan is fetched separately from the report, so it can still hold
    // the previously selected date when the date changes. Prefilling from it
    // then would seed the form with the wrong day's roster.
    if (satpamDutyPlan.day.dutyDate !== satpamReportDate) {
      return;
    }
    if (satpamPendingStorageKey) {
      try {
        if (
          parseSatpamShiftPendingDraft(
            window.localStorage.getItem(satpamPendingStorageKey),
            satpamReportDate,
          )
        ) {
          return;
        }
      } catch (error) {
        console.warn('Draf Satpam lokal tidak dapat diperiksa:', error);
      }
    }
    const plannedAssignments = createBlankSatpamAssignments(
      satpamRegularPayType,
    );
    satpamDutyPlan.day.assignments.forEach((assignment) => {
      // Both the Ketua's own post and the designated Pos 9 guard follow the
      // same Friday/holiday calendar rate as an ordinary post by default
      // (resolveKetuaSatpamPayType / resolveDesignatedPos9PayType) — an
      // explicit Harian or Lembur Sendiri choice is what overrides that, not
      // the other way around.
      plannedAssignments[assignment.postId] = {
        employeeId: assignment.employeeId,
        shiftType: satpamRegularPayType,
      };
    });
    satpamDraftBaselineRef.current = createSatpamDraftFingerprint({
      shiftName: satpamDutyPlan.day.shiftName,
      assignments: plannedAssignments,
      extraVisible: false,
      extraEmployeeId: '',
      extraPostName: '',
      extraOvertimeReason: '',
      extraPhotoUrl: '',
    });
    satpamDraftDirtyRef.current = false;
    setPostAssignments(plannedAssignments);
    setSatpamReportedShiftName(satpamDutyPlan.day.shiftName);
  }, [
    isKetuaShiftSatpam,
    isSatpamReportSubmitted,
    satpamHasPendingDraft,
    satpamDraftHydrated,
    satpamDutyPlan,
    satpamPendingStorageKey,
    satpamRegularPayType,
    satpamReportDate,
  ]);

  useEffect(() => {
    if (
      !isKetuaShiftSatpam ||
      !satpamDraftHydrated ||
      !satpamPendingStorageKey ||
      satpamSubmitting ||
      isSatpamReportLocked
    ) {
      return;
    }
    // Never let one date's roster be written under another date's key.
    if (satpamHydratedDateRef.current !== satpamReportDate) {
      return;
    }
    const fingerprint = createSatpamDraftFingerprint({
      shiftName: activeShift,
      assignments: postAssignments,
      extraVisible: isExtraPostVisible,
      extraEmployeeId,
      extraPostName,
      extraOvertimeReason,
      extraPhotoUrl,
      extraPhotoAuditMetadata,
    });
    if (
      !satpamDraftDirtyRef.current &&
      fingerprint === satpamDraftBaselineRef.current
    ) {
      return;
    }
    satpamDraftDirtyRef.current = true;
    const assignments = POSTS_CONFIG.map((post) => {
      const assignment = postAssignments[post.id] || {
        employeeId: '',
        shiftType: satpamRegularPayType,
      };
      return {
        postId: post.id,
        employeeId: assignment.employeeId,
        shiftType: assignment.shiftType,
        coveredEmployeeId: assignment.coveredEmployeeId || '',
        overtimeReason: assignment.overtimeReason || '',
        photoUrl: assignment.photoUrl || '',
        ...(assignment.photoAuditMetadata
          ? { photoAuditMetadata: assignment.photoAuditMetadata }
          : {}),
      };
    });
    // Keep the extra card itself, even while every field is blank. On the
    // field this is a meaningful first step: the guard may open Tambah
    // Petugas, lock the phone, then continue at the next post.
    const extraAssignment = isExtraPostVisible
      ? {
          postId: extraPostName,
          employeeId: extraEmployeeId,
          overtimeReason: extraOvertimeReason,
          photoUrl: extraPhotoUrl,
          ...(extraPhotoAuditMetadata
            ? { photoAuditMetadata: extraPhotoAuditMetadata }
            : {}),
        }
      : null;
    const payload = {
      dutyDate: satpamReportDate,
      shiftName: activeShift,
      completeSnapshot: true,
      hasUserChanges: true,
      extraVisible: isExtraPostVisible,
      ...(satpamOccurrenceId && satpamOccurrenceRevision > 0
        ? {
            baseOccurrenceId: satpamOccurrenceId,
            baseOccurrenceRevision: satpamOccurrenceRevision,
          }
        : {}),
      ...(satpamDutyPlan?.planId && satpamDutyPlan.revision > 0
        ? {
            dutyPlanId: satpamDutyPlan.planId,
            dutyPlanRevision: satpamDutyPlan.revision,
          }
        : {}),
      assignments,
      ...(extraAssignment ? { extraAssignment } : {}),
    };
    const requestKey = `${satpamReportDate}_${activeShift}`;
    const savedAt = new Date().toISOString();
    try {
      const previousLocalDraft = parseSatpamShiftPendingDraft(
        window.localStorage.getItem(satpamPendingStorageKey),
        satpamReportDate,
      );
      window.localStorage.setItem(
        satpamPendingStorageKey,
        JSON.stringify({
          ...(previousLocalDraft?.id ? { id: previousLocalDraft.id } : {}),
          ...(previousLocalDraft?.revision
            ? { revision: previousLocalDraft.revision }
            : {}),
          ...(satpamRequestIdsRef.current[requestKey]
            ? { requestId: satpamRequestIdsRef.current[requestKey] }
            : previousLocalDraft?.requestId
              ? { requestId: previousLocalDraft.requestId }
            : {}),
          payload,
          savedAt,
        }),
      );
    } catch (error) {
      console.warn('Draf Satpam tidak dapat dicadangkan ke perangkat:', error);
    }
    setSatpamHasPendingDraft(true);
    setSatpamDraftSyncStatus(
      window.navigator.onLine === false ? 'offline' : 'saving',
    );

    const generation = satpamDraftGenerationRef.current;
    const clientSequence = ++satpamDraftSequenceRef.current;
    const timer = window.setTimeout(() => {
      satpamDraftSaveQueueRef.current = satpamDraftSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (
            satpamDraftGenerationRef.current !== generation ||
            satpamSelectedDateRef.current !== satpamReportDate ||
            satpamHydratedDateRef.current !== satpamReportDate ||
            clientSequence !== satpamDraftSequenceRef.current
          ) {
            return;
          }
          const savedDraft = await authenticatedJson<{
            draftId: string;
            revision: number;
            stale: boolean;
            savedAt: string;
          }>('/api/satpam/shifts/draft', {
            method: 'PUT',
            body: JSON.stringify({
              clientSessionId: satpamDraftSessionId,
              clientSequence,
              payload,
            }),
          });
          if (
            satpamDraftGenerationRef.current === generation &&
            satpamSelectedDateRef.current === satpamReportDate &&
            clientSequence === satpamDraftSequenceRef.current
          ) {
            try {
              const currentLocalDraft = parseSatpamShiftPendingDraft(
                window.localStorage.getItem(satpamPendingStorageKey),
                satpamReportDate,
              );
              if (currentLocalDraft) {
                window.localStorage.setItem(
                  satpamPendingStorageKey,
                  JSON.stringify({
                    ...currentLocalDraft,
                    id: savedDraft.draftId,
                    revision: savedDraft.revision,
                  }),
                );
              }
            } catch (error) {
              console.warn(
                'Revisi draf Satpam tidak dapat dicatat di perangkat:',
                error,
              );
            }
            satpamDraftBaselineRef.current = fingerprint;
            satpamDraftDirtyRef.current = false;
            setSatpamDraftSyncStatus('saved');
          }
        })
        .catch((error) => {
          if (
            satpamDraftGenerationRef.current !== generation ||
            satpamSelectedDateRef.current !== satpamReportDate ||
            clientSequence !== satpamDraftSequenceRef.current
          ) {
            return;
          }
          console.warn('Draf Satpam belum tersinkron ke server:', error);
          setSatpamDraftSyncStatus(
            window.navigator.onLine === false ? 'offline' : 'error',
          );
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    activeShift,
    extraEmployeeId,
    extraOvertimeReason,
    extraPhotoAuditMetadata,
    extraPhotoUrl,
    extraPostName,
    isExtraPostVisible,
    isKetuaShiftSatpam,
    isSatpamReportLocked,
    postAssignments,
    satpamDraftHydrated,
    satpamDraftRetryNonce,
    satpamDraftSessionId,
    satpamPendingStorageKey,
    satpamReportDate,
    satpamDutyPlan,
    satpamOccurrenceId,
    satpamOccurrenceRevision,
    satpamRegularPayType,
    satpamSubmitting,
  ]);

  useEffect(() => {
    if (!isKetuaShiftSatpam) return;
    const retryPendingDraft = () => {
      if (
        satpamHasPendingDraft &&
        (satpamDraftSyncStatus === 'offline' ||
          satpamDraftSyncStatus === 'error')
      ) {
        satpamDraftDirtyRef.current = true;
        setSatpamDraftRetryNonce((current) => current + 1);
      }
    };
    window.addEventListener('online', retryPendingDraft);
    return () => window.removeEventListener('online', retryPendingDraft);
  }, [
    isKetuaShiftSatpam,
    satpamDraftSyncStatus,
    satpamHasPendingDraft,
  ]);

  const assignedEmployeeIds = useMemo(() => {
    const list = Object.values(postAssignments).map(a => a.employeeId).filter(Boolean);
    if (extraEmployeeId) {
      list.push(extraEmployeeId);
    }
    return list;
  }, [postAssignments, extraEmployeeId]);

  const offDutyMembers = useMemo(() => {
    return groupEmployees.filter(emp => !assignedEmployeeIds.includes(emp.id));
  }, [groupEmployees, assignedEmployeeIds]);

  const isFriday = (dateStr: string) => {
    if (!dateStr) return false;
    const parts = dateStr.split('-');
    if (parts.length < 3) return false;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dateObj = new Date(y, m, d);
    return dateObj.getDay() === 5; // Friday is 5
  };

  const getDefaultShiftTypeForDate = (dateStr: string) => {
    if (dateStr === satpamReportDate) return satpamRegularPayType;
    return isFriday(dateStr) ? 'Jumat & Libur' : 'Harian';
  };

  const beginSatpamDateTransition = (nextValue: string) => {
    if (nextValue === satpamReportDate) return;
    // Invalidate old async work before React renders the new date. Event updates
    // are batched, so doing this synchronously closes the small window in which
    // a slow prior-date request/upload could otherwise commit its result.
    satpamSelectedDateRef.current = nextValue;
    satpamDraftGenerationRef.current += 1;
    satpamHydratedDateRef.current = '';
    satpamDraftBaselineRef.current = '';
    satpamDraftDirtyRef.current = false;
    setSatpamDraftHydrated(false);
    setSatpamDraftSyncStatus('idle');
    setSatpamHasPendingDraft(false);
    setLoadingSubmittedSatpam(true);
    setSatpamDutyPlan(null);
    setPostAssignments(
      createBlankSatpamAssignments(getDefaultShiftTypeForDate(nextValue)),
    );
    setSatpamOccurrenceId('');
    setSatpamOccurrenceRevision(0);
    setSatpamAuditorActionAt(null);
    setSatpamReviewStatus('draft');
    setSatpamAnomalies([]);
    setExtraEmployeeId('');
    setExtraPostName('');
    setExtraShiftType('Lembur Sendiri');
    setExtraOvertimeReason('');
    setExtraPhotoUrl('');
    setExtraPhotoAuditMetadata(undefined);
    setIsExtraPostVisible(false);
    setIsSatpamReportSubmitted(false);
    setPendingDailyLiburSwap(null);
    setDailyLiburSwapError('');
    setSatpamReportDate(nextValue);
  };

  const setSatpamDateShortcut = (dayOffset: number) => {
    const nextDate = new Date(`${getTodayISO()}T00:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + dayOffset);
    const nextValue = [
      nextDate.getUTCFullYear(),
      String(nextDate.getUTCMonth() + 1).padStart(2, '0'),
      String(nextDate.getUTCDate()).padStart(2, '0'),
    ].join('-');
    const isOpen = satpamOpenPeriods.some(
      (period) => nextValue >= period.startDate && nextValue <= period.endDate,
    );
    if (!isOpen) {
      setMessage({ type: 'error', text: 'Tanggal tersebut belum termasuk periode payroll yang terbuka.' });
      return;
    }
    beginSatpamDateTransition(nextValue);
  };

  const handleSatpamDateChange = (nextValue: string) => {
    if (!nextValue) return;
    const isOpen = satpamOpenPeriods.some(
      (period) => nextValue >= period.startDate && nextValue <= period.endDate,
    );
    if (!isOpen) {
      setMessage({
        type: 'error',
        text: 'Pilih tanggal yang berada dalam periode payroll terbuka.',
      });
      return;
    }
    beginSatpamDateTransition(nextValue);
  };

  const setPersonalSpjDate = (nextValue: string) => {
    if (!nextValue) return;
    if (
      userJobCategory === 'SATPAM' &&
      !satpamOpenPeriods.some(
        (period) => nextValue >= period.startDate && nextValue <= period.endDate,
      )
    ) {
      setMessage({
        type: 'error',
        text: 'Tanggal SPJ harus berada dalam periode payroll terbuka.',
      });
      return;
    }
    setFormDate(nextValue);
  };

  const setPersonalSpjDateShortcut = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    setPersonalSpjDate([
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-'));
  };

  const satpamFormWarnings = (() => {
    const warnings: string[] = [];
    const assigned = Object.entries(postAssignments).filter(([, value]) => value.employeeId);
    const assignedIds = assigned.map(([, value]) => value.employeeId);
    if (assigned.length < POSTS_CONFIG.length) {
      warnings.push(`${POSTS_CONFIG.length - assigned.length} pos belum diisi.`);
    }
    const pos9Assignment = postAssignments['Pos 9'];
    if (
      pos9Assignment?.employeeId &&
      pos9GuardIds.size > 0 &&
      !pos9GuardIds.has(pos9Assignment.employeeId)
    ) {
      warnings.push('Pos 9 diisi petugas pengganti, bukan salah satu dari tiga Pos 9 Satpam. Kepala SatKer perlu memeriksa substitusi ini.');
    }
    if (new Set(assignedIds).size !== assignedIds.length || (extraEmployeeId && assignedIds.includes(extraEmployeeId))) {
      warnings.push('Ada nama petugas yang dipilih lebih dari satu kali.');
    }
    if (profile?.linkedEmployeeId && !assignedIds.includes(profile.linkedEmployeeId) && extraEmployeeId !== profile.linkedEmployeeId) {
      warnings.push('Ketua Shift belum tercantum sebagai petugas.');
    }
    if (activeShift !== satpamSuggestedShiftName) {
      warnings.push(`Shift yang dipilih berbeda dari saran sistem (${satpamSuggestedShiftName}).`);
    }
    if (!holidayCalendarConfigured) {
      warnings.push('Kalender hari libur belum tersedia; auditor perlu menentukan klasifikasi bayar.');
    }
    if (assigned.some(([, value]) => !value.photoUrl) || (extraEmployeeId && !extraPhotoUrl)) {
      warnings.push('Ada penugasan tanpa foto bukti.');
    }
    if (assigned.some(([, value]) => value.shiftType === 'Lembur Cover' && !value.coveredEmployeeId)) {
      warnings.push('Ada Lembur Cover yang belum mencantumkan petugas yang digantikan.');
    }
    if (assigned.some(([, value]) => allSatpamEmployees.find((employee) => employee.id === value.employeeId)?.isActive === false)) {
      warnings.push('Ada data petugas yang perlu diverifikasi statusnya oleh auditor.');
    }
    return warnings;
  })();

  const copyPreviousSatpamShift = async () => {
    if (isSatpamReportLocked) return;
    setCopyingPreviousShift(true);
    try {
      const previous = await authenticatedJson<{
        occurrence: null | { reportedShiftName?: 'Pagi' | 'Sore' | 'Malam' };
        assignments: Array<{
          assignmentKind?: 'primary' | 'extra';
          postId?: string;
          employeeId?: string;
          shiftType?: string;
          coveredEmployeeId?: string;
          overtimeReason?: string;
        }>;
      }>(
        `/api/satpam/shifts?dutyDate=${encodeURIComponent(satpamReportDate)}&latestBefore=true`,
        { method: 'GET' },
      );
      if (!previous.occurrence) {
        setMessage({ type: 'error', text: 'Belum ada laporan sebelumnya yang dapat disalin.' });
        return;
      }
      const defaultType = getDefaultShiftTypeForDate(satpamReportDate);
      const copied = Object.fromEntries(
        POSTS_CONFIG.map((post) => [post.id, { employeeId: '', shiftType: defaultType }]),
      ) as Record<string, SatpamPostAssignment>;
      const copiedExtra = previous.assignments.find((assignment) => assignment.assignmentKind === 'extra');
      previous.assignments
        .filter((assignment) => assignment.assignmentKind !== 'extra' && assignment.postId && copied[assignment.postId])
        .forEach((assignment) => {
          copied[assignment.postId!] = {
            employeeId: assignment.employeeId || '',
            shiftType: assignment.shiftType || defaultType,
            coveredEmployeeId: assignment.coveredEmployeeId || '',
            overtimeReason: assignment.overtimeReason || '',
          };
        });
      setPostAssignments(copied);
      setExtraEmployeeId(copiedExtra?.employeeId || '');
      setExtraPostName(copiedExtra?.postId || '');
      setExtraOvertimeReason(copiedExtra?.overtimeReason || '');
      setExtraPhotoUrl('');
      setExtraPhotoAuditMetadata(undefined);
      setIsExtraPostVisible(Boolean(copiedExtra));
      setMessage({ type: 'success', text: 'Nama petugas dari laporan terakhir sudah disalin. Foto tidak ikut disalin.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Laporan terakhir gagal disalin.' });
    } finally {
      setCopyingPreviousShift(false);
    }
  };

  const handleShiftTypeChange = (postId: string, shiftType: string) => {
    setPostAssignments(prev => ({
      ...prev,
      [postId]: {
        ...prev[postId],
        shiftType,
        ...(shiftType !== 'Lembur Cover' && {
          coveredEmployeeId: '',
          overtimeReason: '',
        }),
      }
    }));
  };

  const applyGuardSelection = (
    postId: string,
    employeeId: string,
    forced?: {
      shiftType: string;
      coveredEmployeeId?: string;
      overtimeReason?: string;
    },
  ) => {
    setPostAssignments(prev => {
      const isExternal = !groupEmployeeIds.includes(employeeId) && employeeId !== '';
      const defaultType =
        forced?.shiftType ||
        defaultSatpamAssignmentPayType(
          isExternal,
          getDefaultShiftTypeForDate(satpamReportDate),
        );

      return {
        ...prev,
        [postId]: {
          employeeId,
          shiftType: defaultType,
          // Always reset cover metadata on a guard swap. Carrying over a
          // previous guard's 'Lembur Cover' + coveredEmployeeId would let a
          // regular in-roster guard silently inherit the Rp50.000 cover rate
          // meant for whoever was assigned to this post before.
          coveredEmployeeId: forced?.coveredEmployeeId || '',
          overtimeReason: forced?.overtimeReason || '',
          // Keep any photo already taken at this post; a mis-tap on the guard
          // dropdown should not force the Ketua Shift back out to re-shoot it.
          photoUrl: prev[postId]?.photoUrl || '',
        }
      };
    });
  };

  const handleSelectGuard = (postId: string, employeeId: string) => {
    const planDay = satpamDutyPlan?.day;
    const plannedAssignment = planDay?.assignments.find(
      (assignment) => assignment.postId === postId,
    );
    const isOffDutyReplacement = Boolean(
      employeeId &&
        planDay &&
        plannedAssignment &&
        employeeId === planDay.offDutyEmployeeId &&
        employeeId !== plannedAssignment.employeeId,
    );
    if (!isOffDutyReplacement || !planDay || !plannedAssignment) {
      applyGuardSelection(postId, employeeId);
      return;
    }

    const guardAId = plannedAssignment.employeeId;
    const guardBId = employeeId;
    const dateY = findFirstUpcomingSwapDate(
      satpamDutyPlan?.generatedDays || [],
      planDay.dutyDate,
      guardAId,
      guardBId,
    );
    const previousAssignment = postAssignments[postId];
    setDailyLiburSwapError('');
    setPendingDailyLiburSwap({
      dateX: planDay.dutyDate,
      dateY,
      guardAId,
      guardBId,
      postXId: postId as SatpamPostId,
      guardAName:
        allSatpamEmployees.find((employee) => employee.id === guardAId)?.name ||
        guardAId,
      guardBName:
        allSatpamEmployees.find((employee) => employee.id === guardBId)?.name ||
        guardBId,
      previousAssignment: previousAssignment
        ? {
            employeeId: previousAssignment.employeeId,
            shiftType: previousAssignment.shiftType,
            coveredEmployeeId: previousAssignment.coveredEmployeeId,
            overtimeReason: previousAssignment.overtimeReason,
          }
        : undefined,
    });
    if (dateY) {
      applyGuardSelection(postId, employeeId, { shiftType: 'Harian' });
    } else {
      applyGuardSelection(postId, employeeId, {
        shiftType: 'Lembur Cover',
        coveredEmployeeId: guardAId,
        overtimeReason: 'Menggantikan petugas yang dijadwalkan pada pos ini.',
      });
    }
  };

  const cancelDailyLiburSwap = () => {
    const prompt = pendingDailyLiburSwap;
    if (prompt?.previousAssignment) {
      applyGuardSelection(prompt.postXId, prompt.previousAssignment.employeeId, {
        shiftType: prompt.previousAssignment.shiftType,
        coveredEmployeeId: prompt.previousAssignment.coveredEmployeeId,
        overtimeReason: prompt.previousAssignment.overtimeReason,
      });
    }
    setPendingDailyLiburSwap(null);
    setDailyLiburSwapError('');
  };

  const useDailyLemburCover = () => {
    const prompt = pendingDailyLiburSwap;
    if (prompt) {
      applyGuardSelection(prompt.postXId, prompt.guardBId, {
        shiftType: 'Lembur Cover',
        coveredEmployeeId: prompt.guardAId,
        overtimeReason: 'Menggantikan petugas yang dijadwalkan pada pos ini.',
      });
    }
    setPendingDailyLiburSwap(null);
    setDailyLiburSwapError('');
  };

  const confirmDailyLiburSwap = async () => {
    const requestedDateY = pendingDailyLiburSwap?.dateY;
    if (
      !requestedDateY ||
      !satpamDutyPlan?.planId ||
      !myShiftTeam?.id
    ) {
      useDailyLemburCover();
      return;
    }
    setDailyLiburSwapWorking(true);
    setDailyLiburSwapError('');
    try {
      const prompt = pendingDailyLiburSwap;
      const result = await authenticatedJson<{
        revision: number;
        swapDateY: string | null;
      }>('/api/satpam/duty-plans', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'swap_libur_days',
          period: payrollPeriodForDutyDate(prompt.dateX),
          teamId: myShiftTeam.id,
          expectedRevision: satpamDutyPlan.revision,
          requestId: createFinancialRequestId('satpam-report-libur-swap'),
          reason: '',
          dateX: prompt.dateX,
          expectedDateY: prompt.dateY,
          guardAId: prompt.guardAId,
          guardBId: prompt.guardBId,
          postXId: prompt.postXId,
        }),
      });
      const swappedDays = applyLiburDateSwap(
        satpamDutyPlan.generatedDays,
        prompt.dateX,
        result.swapDateY || requestedDateY,
        prompt.guardAId,
        prompt.guardBId,
        prompt.postXId,
      );
      const updatedDay = swappedDays.find(
        (day) => day.dutyDate === prompt.dateX,
      ) || null;
      setSatpamDutyPlan((current) =>
        current
          ? {
              ...current,
              revision: result.revision,
              day: updatedDay,
              generatedDays: swappedDays,
            }
          : current,
      );
      applyGuardSelection(prompt.postXId, prompt.guardBId, {
        shiftType: 'Harian',
      });
      setPendingDailyLiburSwap(null);
      setMessage({
        type: 'success',
        text: `Tanggal Libur berhasil ditukar dengan ${result.swapDateY || prompt.dateY}. Laporan ini tetap penugasan reguler.`,
      });
    } catch (cause) {
      const prompt = pendingDailyLiburSwap;
      applyGuardSelection(prompt.postXId, prompt.guardBId, {
        shiftType: 'Lembur Cover',
        coveredEmployeeId: prompt.guardAId,
        overtimeReason: 'Menggantikan petugas yang dijadwalkan pada pos ini.',
      });
      setDailyLiburSwapError(
        cause instanceof Error
          ? `${cause.message} Shift otomatis diubah menjadi Lembur Cover.`
          : 'Tanggal Libur tidak dapat ditukar. Shift otomatis diubah menjadi Lembur Cover.',
      );
      setPendingDailyLiburSwap((current) =>
        current ? { ...current, dateY: null } : current,
      );
    } finally {
      setDailyLiburSwapWorking(false);
    }
  };

  const handleUploadPostPhoto = async (postId: string, file: File) => {
    if (!profile?.linkedEmployeeId) return;
    const uploadDutyDate = satpamReportDate;
    const uploadShiftName = activeShift;
    if (satpamHydratedDateRef.current !== uploadDutyDate) {
      setMessage({
        type: 'error',
        text: 'Tunggu sampai jadwal tanggal ini selesai dimuat sebelum mengunggah foto.',
      });
      return;
    }
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Bukti pos harus berupa foto (JPG/PNG).' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Ukuran foto maksimal 5 MB.' });
      return;
    }

    setPostPhotoUploading(prev => ({ ...prev, [postId]: true }));
    try {
      const prepared = await prepareProofImage(file);
      const safePost = postId.replace(/[^A-Za-z0-9_-]/g, '_');
      const downloadUrl = await uploadProofFile('/api/uploads/satpam-shifts', prepared.file, {
        ketuaShiftId: profile.linkedEmployeeId,
        filenameHint: `${uploadDutyDate}_${uploadShiftName}_${safePost}`,
      });

      if (
        satpamSelectedDateRef.current !== uploadDutyDate ||
        satpamHydratedDateRef.current !== uploadDutyDate
      ) {
        return;
      }

      if (postId === 'extra') {
        setExtraPhotoUrl(downloadUrl);
        setExtraPhotoAuditMetadata(prepared.auditMetadata);
      } else {
        setPostAssignments(prev => ({
          ...prev,
          [postId]: { ...prev[postId], photoUrl: downloadUrl, photoAuditMetadata: prepared.auditMetadata },
        }));
      }

      // Once an auditor has acted on this report, the normal "Kirim Laporan"
      // resubmission (which is what would otherwise persist this) is
      // rejected outright by satpamKetuaEditConflict. A missing proof photo
      // is the one narrow exception: it doesn't change who's assigned, the
      // post, or the pay type, so it's persisted straight away here instead
      // of waiting on a submission that will never be allowed to happen.
      if (isSatpamReportLocked && satpamOccurrenceId) {
        try {
          await authenticatedJson('/api/satpam/shifts/photo', {
            method: 'POST',
            body: JSON.stringify({
              requestId: createFinancialRequestId('satpam_shift_photo'),
              occurrenceId: satpamOccurrenceId,
              assignmentKind: postId === 'extra' ? 'extra' : 'primary',
              postId: postId === 'extra' ? extraPostName : postId,
              photoUrl: downloadUrl,
              photoAuditMetadata: prepared.auditMetadata,
            }),
          });
        } catch (persistErr) {
          console.error('Error persisting post-lock photo:', persistErr);
          setMessage({
            type: 'error',
            text: `Foto terunggah tetapi gagal disimpan ke laporan: ${persistErr instanceof Error ? persistErr.message : 'Coba lagi.'}`,
          });
          return;
        }
      }
      setMessage({ type: 'success', text: `Foto bukti ${postId === 'extra' ? 'Lembur Sendiri' : postId} berhasil diunggah.` });
    } catch (err) {
      console.error('Error uploading guard post photo:', err);
      setMessage({ type: 'error', text: `Gagal mengunggah foto ${postId}. Coba lagi.` });
    } finally {
      setPostPhotoUploading(prev => ({ ...prev, [postId]: false }));
    }
  };

  const handleRemovePostPhoto = (postId: string) => {
    if (postId === 'extra') {
      setExtraPhotoUrl('');
      setExtraPhotoAuditMetadata(undefined);
      return;
    }
    setPostAssignments(prev => ({
      ...prev,
      [postId]: { ...prev[postId], photoUrl: '', photoAuditMetadata: undefined },
    }));
  };

  const handleUploadActivityProof = async (file: File) => {
    if (!profile?.linkedEmployeeId) return;
    setUploadingProofPhoto(true);
    try {
      const prepared = await prepareProofImage(file);
      const url = await uploadProofFile('/api/uploads/activity-proofs', prepared.file, {
        employeeId: profile.linkedEmployeeId,
      });
      setFormProofPhoto({ url, auditMetadata: prepared.auditMetadata });
      setMessage({ type: 'success', text: 'Foto bukti kegiatan berhasil diunggah.' });
    } catch (error) {
      console.error('Error uploading SPJ proof photo:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Gagal mengunggah foto bukti kegiatan.',
      });
    } finally {
      setUploadingProofPhoto(false);
    }
  };

  const handleUploadFoundItemPhotos = async (files: File[]) => {
    if (!profile?.linkedEmployeeId || files.length === 0) return;
    const remainingSlots = 5 - foundItemPhotos.length;
    if (remainingSlots <= 0) {
      setMessage({ type: 'error', text: 'Maksimal lima foto untuk satu laporan.' });
      return;
    }
    if (files.length > remainingSlots) {
      setMessage({
        type: 'error',
        text: `Anda hanya dapat menambahkan ${remainingSlots} foto lagi.`,
      });
      return;
    }

    setUploadingFoundItemPhotos(true);
    const uploaded: PhotoEvidence[] = [];
    try {
      for (const [index, file] of files.entries()) {
        const prepared = await prepareProofImage(file);
        const url = await uploadProofFile('/api/uploads/activity-proofs', prepared.file, {
          employeeId: profile.linkedEmployeeId,
          filenameHint: `found-item-${index}`,
        });
        uploaded.push({
          url,
          auditMetadata: prepared.auditMetadata,
        });
      }
      setFoundItemPhotos((current) => [...current, ...uploaded].slice(0, 5));
      setMessage({
        type: 'success',
        text: `${uploaded.length} foto berhasil diunggah.`,
      });
    } catch (error) {
      if (uploaded.length > 0) {
        setFoundItemPhotos((current) => [...current, ...uploaded].slice(0, 5));
      }
      console.error('Error uploading found-item photos:', error);
      setMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Sebagian foto gagal diunggah. Silakan coba lagi.',
      });
    } finally {
      setUploadingFoundItemPhotos(false);
    }
  };

  const handleCoverDetail = (
    postId: string,
    field: 'coveredEmployeeId' | 'overtimeReason',
    value: string,
  ) => {
    setPostAssignments(prev => ({
      ...prev,
      [postId]: {
        ...prev[postId],
        [field]: value,
      }
    }));
  };

  const executeSubmitSatpamShift = async () => {
    if (!profile?.linkedEmployeeId) return;
    const submissionDate = satpamReportDate;
    if (satpamHydratedDateRef.current !== submissionDate) {
      setMessage({
        type: 'error',
        text: 'Tunggu sampai status laporan tanggal ini selesai dimuat.',
      });
      return;
    }
    setSatpamSubmitting(true);
    // Stop any debounced/in-flight draft write from racing the final
    // transaction. The submit API deletes the server draft atomically; waiting
    // here ensures an older autosave cannot recreate it immediately afterward.
    satpamDraftGenerationRef.current += 1;
    try {
      await satpamDraftSaveQueueRef.current.catch(() => undefined);
      if (satpamSelectedDateRef.current !== submissionDate) return;
      const requestKey = `${submissionDate}_${activeShift}`;
      const requestId =
        satpamRequestIdsRef.current[requestKey] ||
        createFinancialRequestId('satpam_shift');
      satpamRequestIdsRef.current[requestKey] = requestId;
      const payload = {
        requestId,
        dutyDate: submissionDate,
        shiftName: activeShift,
        ...(satpamDutyPlan?.planId && satpamDutyPlan.revision > 0
          ? {
              dutyPlanId: satpamDutyPlan.planId,
              dutyPlanRevision: satpamDutyPlan.revision,
            }
          : {}),
        ...(satpamOccurrenceId
          ? {
              occurrenceId: satpamOccurrenceId,
              expectedRevision: satpamOccurrenceRevision,
            }
          : {}),
        assignments: Object.entries(postAssignments)
          .filter(([, assignment]) => Boolean(assignment.employeeId))
          .map(([postId, assignment]) => ({
            postId: postId as SatpamPostId,
            employeeId: assignment.employeeId,
            shiftType: (assignment.shiftType || getDefaultShiftTypeForDate(submissionDate)) as SatpamPayType,
            ...(assignment.shiftType === 'Lembur Cover' && {
              coveredEmployeeId: assignment.coveredEmployeeId,
              overtimeReason: assignment.overtimeReason,
            }),
            ...(assignment.photoUrl ? { photoUrl: assignment.photoUrl } : {}),
            ...(assignment.photoUrl && assignment.photoAuditMetadata
              ? { photoAuditMetadata: assignment.photoAuditMetadata }
              : {}),
          })),
        ...(isExtraPostVisible && extraEmployeeId && extraPostName && {
          extraAssignment: {
            postId: extraPostName as SatpamPostId,
            employeeId: extraEmployeeId,
            overtimeReason: extraOvertimeReason,
            ...(extraPhotoUrl ? { photoUrl: extraPhotoUrl } : {}),
            ...(extraPhotoUrl && extraPhotoAuditMetadata
              ? { photoAuditMetadata: extraPhotoAuditMetadata }
              : {}),
          },
        }),
      };
      if (satpamPendingStorageKey) {
        try {
          const currentDraft = parseSatpamShiftPendingDraft(
            window.localStorage.getItem(satpamPendingStorageKey),
            submissionDate,
          );
          window.localStorage.setItem(
            satpamPendingStorageKey,
            JSON.stringify(
              currentDraft
                ? { ...currentDraft, requestId }
                : {
                    requestId,
                    payload,
                    savedAt: new Date().toISOString(),
                  },
            ),
          );
        } catch (error) {
          console.warn('ID pengiriman draf Satpam tidak dapat dicadangkan:', error);
        }
      }

      const result = await authenticatedJson<{
        occurrenceId: string;
        revision: number;
        anomalies?: SatpamShiftAnomaly[];
      }>('/api/satpam/shifts', {
        method: satpamOccurrenceId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      delete satpamRequestIdsRef.current[requestKey];
      if (satpamPendingStorageKey) {
        try {
          window.localStorage.removeItem(satpamPendingStorageKey);
        } catch (error) {
          console.warn('Draf Satpam lokal gagal dibersihkan:', error);
        }
      }
      if (satpamSelectedDateRef.current !== submissionDate) return;

      satpamDraftGenerationRef.current += 1;
      satpamDraftBaselineRef.current = createSatpamDraftFingerprint({
        shiftName: activeShift,
        assignments: postAssignments,
        extraVisible: isExtraPostVisible,
        extraEmployeeId,
        extraPostName,
        extraOvertimeReason,
        extraPhotoUrl,
        extraPhotoAuditMetadata,
      });
      satpamDraftDirtyRef.current = false;
      setSatpamHasPendingDraft(false);
      setSatpamDraftSyncStatus('idle');
      setMessage({
        type: 'success',
        text: satpamOccurrenceId
          ? 'Perubahan laporan tersimpan dan menunggu pemeriksaan auditor.'
          : `Laporan shift ${activeShift} tanggal ${submissionDate} terkirim dan menunggu audit Kepala SatKer.`,
      });
      setSatpamOccurrenceId(result.occurrenceId);
      setSatpamOccurrenceRevision(result.revision);
      setSatpamAnomalies(result.anomalies || []);
      setSatpamReviewStatus('pending_review');
      setIsSatpamReportSubmitted(true);
      fetchActivities();
    } catch (err) {
      console.error('Error submitting Satpam shift reports:', err);
      if (satpamSelectedDateRef.current === submissionDate) {
        satpamDraftDirtyRef.current = true;
        setSatpamHasPendingDraft(true);
        setSatpamDraftSyncStatus(
          window.navigator.onLine === false ? 'offline' : 'error',
        );
        setSatpamDraftRetryNonce((current) => current + 1);
      }
      setMessage({
        type: 'error',
        text:
          err instanceof Error
            ? `${err.message} Draf tetap tersimpan dan akan dicoba sinkron kembali.`
            : 'Gagal mengirim laporan shift. Draf tetap tersimpan dan akan dicoba sinkron kembali.',
      });
    } finally {
      setSatpamSubmitting(false);
      setShowConfirmModal(false);
    }
  };

  const handleSubmitSatpamShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.linkedEmployeeId || satpamSubmitting) return;
    if (isSatpamReportLocked) {
      setMessage({ type: 'error', text: 'Laporan sudah ditangani auditor sehingga tidak dapat diubah lagi.' });
      return;
    }
    if (!satpamFlexibilityEnabled) {
      const assigned = Object.values(postAssignments).filter(
        (assignment) => assignment.employeeId,
      );
      if (
        assigned.length !== POSTS_CONFIG.length ||
        new Set(assigned.map((assignment) => assignment.employeeId)).size !==
          POSTS_CONFIG.length ||
        !assigned.some(
          (assignment) => assignment.employeeId === profile.linkedEmployeeId,
        )
      ) {
        setMessage({
          type: 'error',
          text: 'Regu ini masih memakai alur lama: sembilan pos harus diisi unik dan Ketua Shift harus tercantum.',
        });
        return;
      }
    }
    const assignedCount =
      Object.values(postAssignments).filter((assignment) => assignment.employeeId).length +
      (isExtraPostVisible && extraEmployeeId ? 1 : 0);
    if (assignedCount < 1) {
      setMessage({ type: 'error', text: 'Pilih sekurang-kurangnya satu nama petugas sebelum mengirim.' });
      return;
    }

    // Intercept with confirmation modal if activeShift is Malam
    if (activeShift === 'Malam') {
      setShowConfirmModal(true);
    } else {
      await executeSubmitSatpamShift();
    }
  };

  const handleSubmitFoundItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile?.linkedEmployeeId || isSubmittingRef.current) return;
    const isReprimand = foundItemCategory === 'satpam_reprimand';
    if (foundItemName.trim().length < 2) {
      setMessage({
        type: 'error',
        text: isReprimand
          ? 'Keterangan teguran wajib diisi minimal 2 karakter.'
          : 'Nama barang wajib diisi minimal 2 karakter.',
      });
      return;
    }
    if (!foundItemDate) {
      setMessage({ type: 'error', text: 'Tanggal kejadian wajib diisi.' });
      return;
    }
    if (
      !satpamOpenPeriods.some(
        (period) =>
          foundItemDate >= period.startDate && foundItemDate <= period.endDate,
      )
    ) {
      setMessage({
        type: 'error',
        text: 'Tanggal kejadian harus berada dalam periode payroll terbuka.',
      });
      return;
    }
    if (foundItemPhotos.length < 1 || foundItemPhotos.length > 5) {
      setMessage({
        type: 'error',
        text: 'Lampirkan minimal satu dan maksimal lima foto.',
      });
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);
    try {
      const requestId =
        activityRequestIdRef.current ||
        createFinancialRequestId(
          editingActivity
            ? (isReprimand ? 'reprimand_resubmit' : 'found_item_resubmit')
            : (isReprimand ? 'reprimand_submit' : 'found_item_submit'),
        );
      activityRequestIdRef.current = requestId;
      await authenticatedJson('/api/pekarya/activities', {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          reportId: editingActivity?.id,
          reportKind: foundItemCategory,
          itemName: foundItemName.trim(),
          activityName: foundItemName.trim(),
          activityDate: foundItemDate,
          proofPhotos: foundItemPhotos,
        }),
      });
      activityRequestIdRef.current = null;
      setMessage({
        type: 'success',
        text: editingActivity
          ? 'Laporan berhasil diperbarui dan diajukan ulang.'
          : isReprimand
            ? 'Teguran pengendara berhasil dilaporkan.'
            : 'Penemuan barang berhasil dilaporkan.',
      });
      resetFoundItemForm();
      fetchActivities();
    } catch (error) {
      console.error('Error submitting found-item/reprimand report:', error);
      setMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Gagal menyimpan laporan. Silakan coba lagi.',
      });
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.linkedEmployeeId || isSubmittingRef.current) return;

    const isBuangSampah = formActivityType === 'Buang Sampah';

    if (!formName.trim()) {
      setMessage({ type: 'error', text: 'Jenis kegiatan harus diisi.' });
      return;
    }
    if (!formDate) {
      setMessage({ type: 'error', text: 'Tanggal kegiatan harus diisi.' });
      return;
    }
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!formTimeStart) {
      setMessage({ type: 'error', text: 'Waktu mulai harus diisi.' });
      return;
    }
    if (!timeRegex.test(formTimeStart)) {
      setMessage({ type: 'error', text: 'Format waktu mulai harus JJ:MM (contoh: 08:00).' });
      return;
    }
    if (!isBuangSampah) {
      if (!formTimeEnd) {
        setMessage({ type: 'error', text: 'Waktu selesai harus diisi.' });
        return;
      }
      if (!timeRegex.test(formTimeEnd)) {
        setMessage({ type: 'error', text: 'Format waktu selesai harus HH:MM (contoh: 17:00).' });
        return;
      }
      if (formTimeEnd === formTimeStart) {
        setMessage({ type: 'error', text: 'Waktu selesai tidak boleh sama dengan waktu mulai.' });
        return;
      }
    }

    // Google Maps Route Verification for Drivers
    const isRouteChanged = JSON.stringify(formPoints) !== JSON.stringify(routeCalculatedPoints);
    if (isSopir) {
      if (calculatedDistanceKm <= 0 || isRouteChanged) {
        setMessage({ type: 'error', text: 'Silakan klik "Cek Rute & Jarak" terlebih dahulu untuk memverifikasi rute.' });
        return;
      }
    }

    const routeSummary = isSopir ? ` (${formPoints.map(p => p.trim()).filter(Boolean).join(' → ')})` : '';
    const finalActivityName = isSopir ? formName.trim().replace(/\s*\(.*\)\s*$/, '') + routeSummary : formName.trim();

    const driverFields = isSopir ? {
      tripType: formTripType,
      vehicleType: formVehicleType,
      nightCount: formNightCount,
      fuelFee: formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0,
      tollParkingFee: formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0,
      fuelReceiptUrl: formFuelReceiptUrls.join(','),
      tollReceiptUrl: formTollReceiptUrls.join(','),
      points: formPoints.map(p => p.trim()).filter(Boolean),
      distanceKm: calculatedDistanceKm,
      durationHours: calculatedDurationHours,
    } : {};

    isSubmittingRef.current = true;
    setSubmitting(true);
    try {
      const requestId =
        activityRequestIdRef.current ||
        createFinancialRequestId(editingActivity ? 'activity_resubmit' : 'activity_submit');
      activityRequestIdRef.current = requestId;
      await authenticatedJson('/api/pekarya/activities', {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          reportId: editingActivity?.id,
          activityName: finalActivityName,
          activityType: formActivityType,
          activityDate: formDate,
          timeStart: formTimeStart,
          timeEnd: isBuangSampah ? '' : formTimeEnd,
          driverData: isSopir ? driverFields : undefined,
          ...(formProofPhoto ? { proofPhoto: formProofPhoto } : {}),
        }),
      });
      activityRequestIdRef.current = null;
      setMessage({
        type: 'success',
        text: editingActivity
          ? 'Kegiatan berhasil diperbarui dan diajukan ulang.'
          : 'Kegiatan berhasil dilaporkan.',
      });

      resetForm();
      fetchActivities();
    } catch (err) {
      console.error('Error submitting activity:', err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menyimpan kegiatan. Silakan coba lagi.',
      });
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  return {
    workflow,
    logout,
    profile,
    router,
    activityProofInputRef,
    foundItemPhotoInputRef,
    userJobCategory,
    isKebersihan,
    isSopir,
    supportsSpjProof,
    isKetuaShiftSatpam,
    myShiftTeam,
    allSatpamEmployees,
    loadingSatpamConfig,
    satpamReportDate,
    satpamSubmitting,
    postAssignments,
    extraPostName,
    setExtraPostName,
    extraEmployeeId,
    setExtraEmployeeId,
    setExtraShiftType,
    setExtraOvertimeReason,
    satpamFlexibilityEnabled,
    satpamDutyPlan,
    satpamSuggestedShiftName,
    setSatpamReportedShiftName,
    satpamOpenPeriods,
    satpamReviewStatus,
    satpamAnomalies,
    satpamDraftHydrated,
    satpamDraftSyncStatus,
    satpamHasPendingDraft,
    isExtraPostVisible,
    setIsExtraPostVisible,
    loadingSubmittedSatpam,
    isSatpamReportSubmitted,
    showConfirmModal,
    setShowConfirmModal,
    pendingDailyLiburSwap,
    dailyLiburSwapWorking,
    dailyLiburSwapError,
    postPhotoUploading,
    setExtraPhotoUrl,
    extraPhotoUrl,
    setExtraPhotoAuditMetadata,
    setSatpamPreviewPhoto,
    satpamPreviewPhoto,
    setPostPhotoInputRef,
    openPostPhotoInput,
    satpamShiftCardRef,
    month,
    setMonth,
    year,
    setYear,
    activities,
    loading,
    assignedSpjEvents,
    loadingAssignedSpjEvents,
    setShowForm,
    showForm,
    setShowSatpamSpjChoice,
    showSatpamSpjChoice,
    setShowFoundItemForm,
    showFoundItemForm,
    editingActivity,
    formActivityType,
    setFormActivityType,
    setFormName,
    formName,
    formCustomName,
    setFormCustomName,
    formDate,
    setFormDate,
    formTimeStart,
    setFormTimeStart,
    formTimeEnd,
    setFormTimeEnd,
    submitting,
    formProofPhoto,
    setFormProofPhoto,
    uploadingProofPhoto,
    setFoundItemCategory,
    foundItemCategory,
    foundItemName,
    setFoundItemName,
    foundItemDate,
    setFoundItemDate,
    foundItemPhotos,
    setFoundItemPhotos,
    uploadingFoundItemPhotos,
    formTripType,
    setFormTripType,
    formVehicleType,
    setFormVehicleType,
    formIsMultiDay,
    setFormIsMultiDay,
    setFormDateEnd,
    formDateEnd,
    formNightCount,
    setFormNightCount,
    formFuelFee,
    setFormFuelFee,
    formTollParkingFee,
    setFormTollParkingFee,
    formPoints,
    setFormPoints,
    setCalculatedDistanceKm,
    calculatedDistanceKm,
    setCalculatedDurationHours,
    calculatedDurationHours,
    isCalculatingRoute,
    setRouteError,
    routeError,
    routeCalculatedPoints,
    showMapSelector,
    setShowMapSelector,
    mapSearchText,
    setMapSearchText,
    setMapAddress,
    mapAddress,
    setMapLocation,
    mapLocation,
    setMapSearchError,
    mapSearchError,
    cancelPlaceSearch,
    placeSuggestions,
    isSearchingPlaces,
    placeSearchError,
    unassignedJourneys,
    myAssignedJourneys,
    myClaimedJourneys,
    loadingJourneys,
    isClaiming,
    isCancelling,
    isPiketActiveToday,
    activePiketStationName,
    showSelfPiketSpjModal,
    selfPiketActivityName,
    setSelfPiketActivityName,
    selfPiketStartPoint,
    selfPiketStartPointLocation,
    selfPiketEndPoint,
    selfPiketEndPointLocation,
    selfPiketVehicleName,
    setSelfPiketVehicleName,
    selfPiketFuelProcurementMode,
    setSelfPiketFuelProcurementMode,
    selfPiketFuelBalances,
    selectedSelfPiketFuelBalance,
    creatingPiketSpj,
    setSelfPiketCalcDistance,
    selfPiketCalcDistance,
    selfPiketCalcDuration,
    selfPiketCalculating,
    selfPiketCalcError,
    setMapTargetMode,
    lastSelfPiketCalculatedRef,
    selfPiketOperationalCosts,
    submittedSelfPiketSpjCount,
    openSelfPiketSpjModal,
    closeSelfPiketSpjModal,
    handleCreateSelfPiketSpj,
    resetMapSearch,
    handleMapSearchChange,
    handlePlaceSuggestionSelect,
    handleMapSearchKeyDown,
    initMap,
    handleConfirmMapLocation,
    message,
    setMessage,
    setStatusFilter,
    statusFilter,
    expandedId,
    setExpandedId,
    filteredActivities,
    stats,
    resetForm,
    resetFoundItemForm,
    openEditForm,
    handleCalculateRoute,
    handleStartAssignedJourney,
    handleClaimJourney,
    handleCancelJourney,
    groupEmployeeIds,
    groupEmployees,
    pos9GuardIds,
    visibleGroupEmployees,
    visibleExternalEmployees,
    visiblePos9Employees,
    visibleAllSatpamEmployees,
    isCrossTeamPos9Guard,
    activeShift,
    isSatpamReportLocked,
    isSatpamPhotoUploadInProgress,
    assignedEmployeeIds,
    offDutyMembers,
    getDefaultShiftTypeForDate,
    handleSatpamDateChange,
    setPersonalSpjDate,
    satpamFormWarnings,
    handleShiftTypeChange,
    handleSelectGuard,
    cancelDailyLiburSwap,
    useDailyLemburCover,
    confirmDailyLiburSwap,
    handleUploadPostPhoto,
    handleRemovePostPhoto,
    handleUploadActivityProof,
    handleUploadFoundItemPhotos,
    handleCoverDetail,
    executeSubmitSatpamShift,
    handleSubmitSatpamShift,
    handleSubmitFoundItem,
    handleSubmit,
  };
}

export type EmployeeActivitiesModel = ReturnType<typeof useEmployeeActivitiesModel>;
