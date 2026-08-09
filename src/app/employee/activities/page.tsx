"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useAuth } from '@/lib/AuthContext';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  LogOut,
  Plus,
  X,
  Clock,
  CalendarDays,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ClipboardList,
  Pencil,
  Send,
  Banknote,
  ChevronDown,
  ChevronUp,
  Timer,
  Sparkles,
  Trash2,
  MapPin,
  ArrowRight,
  Compass,
  Car,
  Search,
  Eye,
  Target,
  Save,
  Camera,
  PackageSearch,
  Images,
  ShieldCheck,
} from 'lucide-react';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  countSubmittedSelfPiketJourneysOnDate,
  getTodayDateString,
} from '@/lib/payroll/driverPiket';
import {
  collection,
  getDocs,
  getDoc,
  addDoc,
  doc,
  query,
  where,
  orderBy,
  Timestamp,
  onSnapshot,
} from 'firebase/firestore';
import { getSatpamShiftForTeam } from '@/utils/satpamRotation';
import { MONTHS_ID } from '@/utils/rekapConfig';
import { authenticatedJson, createFinancialRequestId } from '@/lib/payroll/client';
import {
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
import { prepareProofImage } from '@/lib/photoEvidence';
import {
  DEFAULT_DRIVER_VEHICLE_NAME,
  DRIVER_VEHICLE_NAMES,
  DRIVER_VEHICLE_RATES,
  calculateDriverNetWage,
  calculateDriverJourneyOperationalCosts,
  calculateDriverReimbursementSettlement,
  calculateJourneyElapsedHours,
  calculateNightPremium,
  calculateJourneyDateTimeTimings,
  calculateEstimatedDriverWage,
  getMealAllowanceForDuration as calculateMealAllowanceForDuration,
  getShortTripMealWageComponent,
  type DriverVehicleName,
} from '@/lib/payroll/driverJourney';
import { parseImageExif } from '@/lib/exif';
import { ImageExifViewer } from '@/components/ImageExifViewer';
import { SatpamAbsencePanel } from '@/components/satpam/SatpamDutyAndAbsencePanels';
import { PekaryaOfficialLeavePanel } from '@/components/pekarya/PekaryaOfficialLeavePanel';
import {
  SwapLiburConfirmModal,
  type SwapLiburPrompt,
} from '@/components/satpam/SwapLiburConfirmModal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from '@/components/ui/select';

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

interface ActivityReport {
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
  hasUangMakan?: boolean;
  declineReason?: string;
  submittedAt?: any;
  reviewedAt?: any;
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
  extraActivities?: any[];
  vehicleRate?: number;
  baseOperationalCost?: number;
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
  authorizedAt?: any;
  journeyDate?: string;
  claimedAt?: any;
  completedAt?: any;
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
  auditorActionAt?: any;
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
  submittedFeeRecommendation?: number;
}

interface SatpamPostAssignment {
  employeeId: string;
  shiftType: string;
  coveredEmployeeId?: string;
  overtimeReason?: string;
  photoUrl?: string;
  photoAuditMetadata?: PhotoAuditMetadata;
}

type PendingDailyLiburSwap = SwapLiburPrompt & {
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

const getPlacesSearchQuery = (endPoint: string): string => {
  const firstSegment = endPoint.split(',')[0].trim();

  if (!firstSegment.toLowerCase().startsWith('jl.') && !firstSegment.toLowerCase().startsWith('jalan')) {
    return firstSegment;
  }

  const parts = endPoint.split(',').map(p => p.trim());
  const streetPart = parts[0];
  const cleanStreet = streetPart.replace(/\bNo\s*\.?\s*\d+[-\d]*/i, '').trim();

  const cities = ['Surabaya', 'Jombang', 'Sidoarjo', 'Gresik', 'Malang', 'Bangkalan', 'Madura', 'Mojokerto', 'Kediri'];
  let city = '';
  for (const part of parts) {
    for (const c of cities) {
      if (part.toLowerCase().includes(c.toLowerCase())) {
        city = c;
        break;
      }
    }
    if (city) break;
  }

  if (city) {
    return `${cleanStreet}, ${city}`;
  }

  return cleanStreet;
};

const LATEST_VEHICLE_RATES: Record<string, number> = {
  'Bis': 2500,
  'Elf': 1350,
  'Kijang LGX': 1200,
  'Innova Hitam': 1250,
  'Innova Matic': 1450,
  'Suzuki': 1000,
  'Suzuki XL7': 1000,
  'Ndalem': 0,
};

function getEffectiveVehicleRate(vName?: string, savedRate?: number): number {
  if (!vName) return savedRate || 1000;
  if (LATEST_VEHICLE_RATES[vName] !== undefined) return LATEST_VEHICLE_RATES[vName];
  for (const [k, v] of Object.entries(LATEST_VEHICLE_RATES)) {
    if (vName.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return savedRate || 1000;
}

const DestinationImageBanner = ({ destination, cachedUrl }: { destination: string; cachedUrl?: string }) => {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (cachedUrl) {
      setImgUrl(cachedUrl);
      setLoading(false);
      return;
    }

    if (typeof window === 'undefined') {
      setLoading(false);
      return;
    }

    const checkAndFetch = () => {
      const g = (window as any).google;
      if (!g || !g.maps || !g.maps.places) {
        setLoading(false);
        return;
      }

      const searchQuery = getPlacesSearchQuery(destination);
      const cacheKey = `place_img_hd_${encodeURIComponent(searchQuery)}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setImgUrl(cached);
        setLoading(false);
        return;
      }

      try {
        const dummy = document.createElement('div');
        const service = new g.maps.places.PlacesService(dummy);

        // textSearch returns multiple candidate establishments (such as UPN for Rungkut Madya)
        service.textSearch({
          query: searchQuery
        }, (results: any, status: any) => {
          if (status === g.maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
            // Find the first result candidate that has photos
            const matchWithPhoto = results.find((r: any) => r.photos && r.photos.length > 0);
            if (matchWithPhoto) {
              const url = matchWithPhoto.photos[0].getUrl({ maxWidth: 1600, maxHeight: 800 });
              if (url) {
                localStorage.setItem(cacheKey, url);
                setImgUrl(url);
                setLoading(false);
                return;
              }
            }
          }

          // Fallback: If textSearch yields nothing or no photos, try findPlaceFromQuery
          service.findPlaceFromQuery({
            query: searchQuery,
            fields: ['photos']
          }, (results2: any, status2: any) => {
            if (status2 === g.maps.places.PlacesServiceStatus.OK && results2 && results2[0]?.photos?.[0]) {
              const url = results2[0].photos[0].getUrl({ maxWidth: 1600, maxHeight: 800 });
              if (url) {
                localStorage.setItem(cacheKey, url);
                setImgUrl(url);
              }
            }
            setLoading(false);
          });
        });
      } catch (e) {
        console.error('Error fetching places photo:', e);
        setLoading(false);
      }
    };

    const g = (window as any).google;
    if (g && g.maps && g.maps.places) {
      checkAndFetch();
    } else {
      const timer = setTimeout(checkAndFetch, 1000);
      return () => clearTimeout(timer);
    }
  }, [destination]);

  if (loading) {
    return (
      <div className="w-full h-32 bg-slate-50 flex items-center justify-center animate-pulse">
        <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!imgUrl) {
    return (
      <div className="w-full h-32 bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#4f46e5_1px,transparent_1px)] [background-size:16px_16px]" />
        <Compass className="w-10 h-10 text-indigo-400/50 relative z-10" />
      </div>
    );
  }

  return (
    <div className="w-full h-32 relative overflow-hidden border-b border-slate-100">
      <img
        src={imgUrl}
        alt={destination}
        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
        onError={() => setImgUrl(null)}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
    </div>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isWeekend(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

function calculateSopirDefaultFee(
  _tripType?: 'Dalam Kota' | 'Luar Kota',
  _vehicleType?: string,
  nightCount = 0,
  _activityDate?: string,
  _fuelFee?: number,
  _tollParkingFee?: number,
  distanceKm?: number,
  durationHours?: number
): number {
  return calculateDriverNetWage(distanceKm || 0, durationHours || 0, nightCount);
}

function fmtRp(val: number): string {
  return 'Rp' + val.toLocaleString('id-ID');
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

function calculateDefaultFee(timeStart: string, timeEnd: string, activityType?: string, activityName?: string): number {
  if (activityType === 'Buang Sampah' || activityName === 'Buang Sampah') {
    return 5000;
  }

  if (!timeStart || !timeEnd) return 0;

  // Parse HH:MM format
  const [sh, sm] = timeStart.split(':').map(Number);
  const [eh, em] = timeEnd.split(':').map(Number);

  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return 0;

  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;

  const halfHours = Math.round(minutes / 30);

  // Determine activity type
  let type = activityType;
  if (!type && activityName) {
    const nameLower = activityName.toLowerCase();
    if (nameLower === 'piket' || nameLower.startsWith('piket ')) {
      type = 'Piket';
    } else if (nameLower === 'standby' || nameLower.startsWith('standby ')) {
      type = 'Standby';
    } else if (nameLower === 'ro\'an' || nameLower === 'roan' || nameLower.startsWith('ro\'an ') || nameLower.startsWith('roan ')) {
      type = 'Ro\'an';
    } else {
      type = 'Lainnya';
    }
  }

  if (!type) {
    type = 'Lainnya';
  }

  const isPiketOrStandby = type === 'Piket' || type === 'Standby';
  const rate = isPiketOrStandby ? 2000 : 2500;

  return halfHours * rate;
}

function getActivityFeeBreakdown(timeStart: string, timeEnd: string, activityType?: string, activityName?: string): string {
  if (activityType === 'Buang Sampah' || activityName === 'Buang Sampah') {
    return 'Tarif Flat';
  }

  if (!timeStart || !timeEnd) return '';

  const [sh, sm] = timeStart.split(':').map(Number);
  const [eh, em] = timeEnd.split(':').map(Number);

  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return '';

  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;

  const halfHours = Math.round(minutes / 30);

  let type = activityType;
  if (!type && activityName) {
    const nameLower = activityName.toLowerCase();
    if (nameLower === 'piket' || nameLower.startsWith('piket ')) {
      type = 'Piket';
    } else if (nameLower === 'standby' || nameLower.startsWith('standby ')) {
      type = 'Standby';
    } else if (nameLower === 'ro\'an' || nameLower === 'roan' || nameLower.startsWith('ro\'an ') || nameLower.startsWith('roan ')) {
      type = 'Ro\'an';
    } else {
      type = 'Lainnya';
    }
  }

  if (!type) {
    type = 'Lainnya';
  }

  const isPiketOrStandby = type === 'Piket' || type === 'Standby';
  const rate = isPiketOrStandby ? 2000 : 2500;

  return `${halfHours} × Rp${rate.toLocaleString('id-ID')}/30m`;
}

function getStatusConfig(status: string) {
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
function getTodayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getInitialSatpamDateISO(): string {
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

/**
 * A locally queued Satpam draft only counts as work in progress once it holds a
 * real assignment. An empty payload must read as "no draft", otherwise the
 * autosave would keep the published duty plan from ever prefilling the form.
 */
function satpamDraftHasContent(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    const assignments = parsed?.payload?.assignments;
    return (
      (Array.isArray(assignments) &&
        assignments.some(
          (assignment: { employeeId?: string }) => assignment?.employeeId,
        )) ||
      Boolean(parsed?.payload?.extraAssignment?.employeeId)
    );
  } catch {
    return false;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

const YEARS = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i);

const POSTS_CONFIG = [
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



function ActivitiesContent() {
  const { profile: rawProfile, activeProfile, logout, user } = useAuth();
  const profile = activeProfile || rawProfile;
  const router = useRouter();
  const searchParams = useSearchParams();
  const editReportIdParam = searchParams.get('editReportId');
  const fuelFileInputRef = React.useRef<HTMLInputElement>(null);
  const tollFileInputRef = React.useRef<HTMLInputElement>(null);
  const activityProofInputRef = React.useRef<HTMLInputElement>(null);
  const foundItemPhotoInputRef = React.useRef<HTMLInputElement>(null);

  const userJobCategory = profile?.permittedCategories?.[0] || '';
  const isKebersihan = [
    'KEBERSIHAN',
    'KEBERSIHAN_PONTI',
    'PONTI',
  ].includes(userJobCategory);
  const isSopir = userJobCategory === 'SOPIR';
  const supportsSpjProof = isKebersihan || userJobCategory === 'TEKNISI' || userJobCategory === 'SATPAM';
  const isKetuaShiftSatpam = (profile?.role as string) === 'ketua_shift_satpam';
  const isRegularSatpam =
    profile?.permittedCategories?.includes('SATPAM') &&
    !isKetuaShiftSatpam;

  // ── Satpam Shift Teams States ──
  const [myShiftTeam, setMyShiftTeam] = useState<any | null>(null);
  const [allSatpamEmployees, setAllSatpamEmployees] = useState<any[]>([]);
  const [satpamPos9Guards, setSatpamPos9Guards] = useState<
    Array<{ employeeId: string; teamId: string; name: string }>
  >([]);
  const [loadingSatpamConfig, setLoadingSatpamConfig] = useState(false);
  const [satpamReportDate, setSatpamReportDate] = useState<string>(getInitialSatpamDateISO());
  const [satpamSubmitting, setSatpamSubmitting] = useState(false);
  const [postAssignments, setPostAssignments] = useState<Record<string, SatpamPostAssignment>>({
    'Pos 1': { employeeId: '', shiftType: 'Harian' },
    'Pos 2': { employeeId: '', shiftType: 'Harian' },
    'Pos 3': { employeeId: '', shiftType: 'Harian' },
    'Pos 4': { employeeId: '', shiftType: 'Harian' },
    'Pos 5': { employeeId: '', shiftType: 'Harian' },
    'Pos 6': { employeeId: '', shiftType: 'Harian' },
    'Pos 7': { employeeId: '', shiftType: 'Harian' },
    'Pos 8': { employeeId: '', shiftType: 'Harian' },
    'Pos 9': { employeeId: '', shiftType: 'Harian' },
  });
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
  const [copyingPreviousShift, setCopyingPreviousShift] = useState(false);
  const [satpamEmployeeSearch, setSatpamEmployeeSearch] = useState('');
  const satpamRequestIdsRef = useRef<Record<string, string>>({});
  // The duty-plan prefill writes the system's suggested roster into
  // postAssignments before the guard has touched anything. Without this flag
  // the very next autosave tick would persist that untouched suggestion as a
  // localStorage "pending draft," which then re-triggers the "draft restored"
  // notice on every future page load even though the guard never edited it.
  const satpamSkipNextAutosaveRef = useRef(false);
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
  const satpamShiftCardRef = useRef<HTMLDivElement | null>(null);


  // ── Period ──
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const periodToken = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);

  // ── Activities ──
  const [activities, setActivities] = useState<ActivityReport[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Form state ──
  const [showForm, setShowForm] = useState(false);
  const [showSatpamSpjChoice, setShowSatpamSpjChoice] = useState(false);
  const [showSatpamAbsenceForm, setShowSatpamAbsenceForm] = useState(false);
  const [showPekaryaOfficialLeaveForm, setShowPekaryaOfficialLeaveForm] = useState(false);
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
  const skipSaveDraftRef = useRef(false);

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
  const formFuelReceiptUrl = formFuelReceiptUrls.join(',');
  const formTollReceiptUrl = formTollReceiptUrls.join(',');
  const [uploadingFuelReceipt, setUploadingFuelReceipt] = useState<boolean>(false);
  const [uploadingTollReceipt, setUploadingTollReceipt] = useState<boolean>(false);
  const [formPoints, setFormPoints] = useState<string[]>(['Pool Unipdu', '']);
  const [calculatedDistanceKm, setCalculatedDistanceKm] = useState<number>(0);
  const [calculatedDurationHours, setCalculatedDurationHours] = useState<number>(0);
  const [outboundDistanceKm, setOutboundDistanceKm] = useState<number | null>(null);
  const [outboundDurationHours, setOutboundDurationHours] = useState<number | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string>('');
  const [routeCalculatedPoints, setRouteCalculatedPoints] = useState<string[]>([]);

  // ── SOPIR Additional Activities states ──
  const [extraActivities, setExtraActivities] = useState<any[]>([]);
  const [showMapSelector, setShowMapSelector] = useState(false);
  const [mapSearchText, setMapSearchText] = useState('');
  const [mapAddress, setMapAddress] = useState('');
  const [mapAddressImage, setMapAddressImage] = useState<string | null>(null);
  const [mapTargetIndex, setMapTargetIndex] = useState<number | null>(null);
  const [isCalculatingExtraRoute, setIsCalculatingExtraRoute] = useState(false);
  const [extraRouteError, setExtraRouteError] = useState('');

  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);
  const mapElementRef = React.useRef<HTMLDivElement | null>(null);

  // ── Journey claiming & completion states ──
  const [unassignedJourneys, setUnassignedJourneys] = useState<any[]>([]);
  const [myAssignedJourneys, setMyAssignedJourneys] = useState<any[]>([]);
  const [myClaimedJourneys, setMyClaimedJourneys] = useState<any[]>([]);
  const [myDriverJourneys, setMyDriverJourneys] = useState<any[]>([]);
  const [loadingJourneys, setLoadingJourneys] = useState(false);
  const [activeReportingJourney, setActiveReportingJourney] = useState<any | null>(null);
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [isSavingDraft, setIsSavingDraft] = useState<boolean>(false);

  // ── Piket Active & Self-Creation States ──
  const [isPiketActiveToday, setIsPiketActiveToday] = useState(false);
  const [activePiketStationName, setActivePiketStationName] = useState<string>('');
  const [showSelfPiketSpjModal, setShowSelfPiketSpjModal] = useState(false);
  const [selfPiketActivityName, setSelfPiketActivityName] = useState('');
  const [selfPiketStartPoint, setSelfPiketStartPoint] = useState('UNIPDU Jombang, Jawa Timur');
  const [selfPiketEndPoint, setSelfPiketEndPoint] = useState('');
  const [selfPiketVehicleName, setSelfPiketVehicleName] = useState<DriverVehicleName>(DEFAULT_DRIVER_VEHICLE_NAME);
  const [creatingPiketSpj, setCreatingPiketSpj] = useState(false);

  // Self Piket SPJ calculation states
  const [selfPiketCalcDistance, setSelfPiketCalcDistance] = useState<number | null>(null);
  const [selfPiketCalcDuration, setSelfPiketCalcDuration] = useState<number | null>(null);
  const [selfPiketCalculating, setSelfPiketCalculating] = useState(false);
  const [selfPiketCalcError, setSelfPiketCalcError] = useState('');
  const [selfPiketTollFee, setSelfPiketTollFee] = useState<string>('');
  const [mapTargetMode, setMapTargetMode] = useState<'piketStart' | 'piketEnd' | 'extra' | null>(null);
  const lastSelfPiketCalculatedRef = useRef<{ start: string; end: string }>({ start: '', end: '' });

  const selfPiketTollFeeValue = selfPiketTollFee
    ? parseInt(selfPiketTollFee.replace(/\D/g, ''), 10) || 0
    : 0;
  const selfPiketOperationalCosts = useMemo(() => {
    if (selfPiketCalcDistance === null || selfPiketCalcDuration === null) return null;
    return calculateDriverJourneyOperationalCosts(
      selfPiketCalcDistance,
      selfPiketCalcDuration * 2,
      selfPiketVehicleName,
      selfPiketTollFeeValue,
    );
  }, [
    selfPiketCalcDistance,
    selfPiketCalcDuration,
    selfPiketVehicleName,
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
    setSelfPiketEndPoint('');
    setSelfPiketVehicleName(DEFAULT_DRIVER_VEHICLE_NAME);
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
            body: JSON.stringify({ points: [selfPiketStartPoint, selfPiketEndPoint] }),
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
  }, [showSelfPiketSpjModal, selfPiketStartPoint, selfPiketEndPoint, user]);

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
      const createdJourney = await authenticatedJson<{ journeyId: string }>('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_self',
          activityName: selfPiketActivityName.trim(),
          startPoint: selfPiketStartPoint.trim(),
          endPoint: selfPiketEndPoint.trim(),
          vehicleName: selfPiketVehicleName,
          distanceKm: selfPiketCalcDistance,
          durationHours: selfPiketCalcDuration,
          tollParkingFee: selfPiketTollFeeValue,
        }),
      });

      closeSelfPiketSpjModal();
      router.push(`/employee/activities/journey-report?id=${createdJourney.journeyId}`);
    } catch (err: any) {
      console.error('Error creating self piket SPJ:', err);
      alert('Gagal membuat SPJ piket. Coba lagi.');
    } finally {
      setCreatingPiketSpj(false);
    }
  };

  // Reset states and initialize original distance/duration when reporting journey changes
  useEffect(() => {
    if (activeReportingJourney) {
      const journeyDate =
        activeReportingJourney.draftDate ||
        activeReportingJourney.activityDate ||
        activeReportingJourney.dateStart ||
        activeReportingJourney.journeyDate ||
        getTodayISO();
      const journeyIsMultiDay = activeReportingJourney.draftIsMultiDay ?? activeReportingJourney.isMultiDay ?? false;
      setFormDate(journeyDate);
      setFormIsMultiDay(Boolean(journeyIsMultiDay));
      setFormDateEnd(
        journeyIsMultiDay
          ? (activeReportingJourney.draftDateEnd || activeReportingJourney.dateEnd || journeyDate)
          : journeyDate,
      );
      setExtraActivities(activeReportingJourney.draftExtraActivities || []);
      setFormTimeStart(activeReportingJourney.draftTimeStart || '08:00');
      setFormTimeEnd(activeReportingJourney.draftTimeEnd || '17:00');
      setFormFuelFee(activeReportingJourney.draftFuelFee || '');
      setFormTollParkingFee(activeReportingJourney.draftTollParkingFee || '');
      const rawFuel = activeReportingJourney.draftFuelReceiptUrl || activeReportingJourney.fuelReceiptUrl || '';
      setFormFuelReceiptUrls(rawFuel ? rawFuel.split(',').filter(Boolean) : []);
      const rawToll = activeReportingJourney.draftTollReceiptUrl || activeReportingJourney.tollReceiptUrl || '';
      setFormTollReceiptUrls(rawToll ? rawToll.split(',').filter(Boolean) : []);
      setFormNightCount(
        journeyIsMultiDay &&
        Number.isSafeInteger(activeReportingJourney.draftNightCount) &&
          activeReportingJourney.draftNightCount >= 0
          ? activeReportingJourney.draftNightCount
          : journeyIsMultiDay && Number.isSafeInteger(activeReportingJourney.nightCount) && activeReportingJourney.nightCount >= 0
            ? activeReportingJourney.nightCount
            : 0,
      );
      setCalculatedDistanceKm(
        activeReportingJourney.draftCalculatedDistanceKm !== undefined
          ? activeReportingJourney.draftCalculatedDistanceKm
          : (activeReportingJourney.distanceKm || 0) * 2
      );
      setCalculatedDurationHours(
        activeReportingJourney.draftCalculatedDurationHours !== undefined
          ? activeReportingJourney.draftCalculatedDurationHours
          : (activeReportingJourney.durationHours || 0) * 2
      );
      setExtraRouteError('');
    }
  }, [activeReportingJourney]);

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

      const updateAddressImage = (query: string) => {
        try {
          const service = new google.maps.places.PlacesService(map || document.createElement('div'));
          service.textSearch({ query }, (results: any, status: any) => {
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
          fields: ['formatted_address', 'geometry', 'name', 'photos'],
        });

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (!place.geometry || !place.geometry.location) return;

          mapRef.current.setCenter(place.geometry.location);
          mapRef.current.setZoom(16);
          if (markerRef.current) {
            markerRef.current.setPosition(place.geometry.location);
          }

          // Handle photos inside place object
          if (place.photos && place.photos[0]) {
            setMapAddressImage(place.photos[0].getUrl({ maxWidth: 1600, maxHeight: 800 }));
          } else if (place.name || place.formatted_address) {
            // Try to resolve photo via textSearch
            const query = place.name || place.formatted_address;
            const service = new google.maps.places.PlacesService(mapRef.current);
            service.textSearch({ query }, (res: any, stat: any) => {
              if (stat === google.maps.places.PlacesServiceStatus.OK && res && res[0]?.photos?.[0]) {
                setMapAddressImage(res[0].photos[0].getUrl({ maxWidth: 1600, maxHeight: 800 }));
              } else {
                setMapAddressImage(null);
              }
            });
          } else {
            setMapAddressImage(null);
          }

          if (place.formatted_address) {
            const name = place.name;
            const address = place.formatted_address;
            if (name && !name.toLowerCase().startsWith('jl.') && !name.toLowerCase().startsWith('jalan') && !address.toLowerCase().startsWith(name.toLowerCase())) {
              setMapAddress(`${name}, ${address}`);
              setMapSearchText(`${name}, ${address}`);
            } else {
              setMapAddress(address);
              setMapSearchText(address);
            }
          } else {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: place.geometry.location }, (results: any, status: any) => {
              if (status === 'OK' && results[0]) {
                setMapAddress(results[0].formatted_address);
              }
            });
          }
        });
      } catch (autoErr) {
        console.warn('Google Places Autocomplete initialization failed:', autoErr);
      }
    });
  };

  const parseLegDistance = (text: string): number => {
    if (!text) return 0;
    const num = parseFloat(text.replace(/,/g, ''));
    if (isNaN(num)) return 0;
    if (text.toLowerCase().includes('m') && !text.toLowerCase().includes('k')) {
      return num / 1000;
    }
    return num;
  };

  const recalculateRouteChain = async (list: any[]) => {
    if (!activeReportingJourney) return;
    const extraLocs = list.filter(a => a.type === 'tambah_lokasi' && a.destination);
    if (extraLocs.length === 0) {
      setCalculatedDistanceKm((activeReportingJourney.distanceKm || 0) * 2);
      setCalculatedDurationHours((activeReportingJourney.durationHours || 0) * 2);
      setOutboundDistanceKm(null);
      setOutboundDurationHours(null);
      return;
    }

    setIsCalculatingExtraRoute(true);
    setExtraRouteError('');
    try {
      if (!user) throw new Error('Sesi tidak ditemukan.');
      const idToken = await user.getIdToken();
      const points = [
        activeReportingJourney.startPoint,
        activeReportingJourney.endPoint,
        ...extraLocs.map(l => l.destination),
        activeReportingJourney.startPoint
      ];

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
        throw new Error(resData.error || 'Gagal menghitung rute tambahan.');
      }

      setCalculatedDistanceKm(resData.distanceKm);
      setCalculatedDurationHours(resData.durationHours);

      if (resData.legs && resData.legs.length > 0) {
        const leg0Dist = parseLegDistance(resData.legs[0].distanceText) || resData.legs[0].distanceKm || 0;
        const leg0Dur = resData.legs[0].durationHours || 0;
        setOutboundDistanceKm(leg0Dist);
        setOutboundDurationHours(leg0Dur);
      }

      // Map leg details back to the extraActivities state
      const updated = [...list];
      let locCounter = 0;
      updated.forEach((act, idx) => {
        if (act.type === 'tambah_lokasi') {
          if (act.destination) {
            const leg = resData.legs[locCounter + 1];
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

    } catch (err: any) {
      console.error(err);
      setExtraRouteError(err.message || 'Terjadi kesalahan saat menghitung rute tambahan.');
    } finally {
      setIsCalculatingExtraRoute(false);
    }
  };

  const getOriginForLocationIndex = (index: number): string => {
    if (!activeReportingJourney) return '';
    for (let i = index - 1; i >= 0; i--) {
      if (extraActivities[i].type === 'tambah_lokasi' && extraActivities[i].destination) {
        return extraActivities[i].destination;
      }
    }
    return activeReportingJourney.endPoint;
  };

  const getOutboundLegDetails = () => {
    if (!activeReportingJourney) return { distanceKm: 0, durationHours: 0 };
    if (outboundDistanceKm !== null && outboundDistanceKm > 0) {
      return {
        distanceKm: outboundDistanceKm,
        durationHours: outboundDurationHours || 0,
      };
    }

    let extraSum = 0;
    let extraDurSum = 0;
    extraActivities.forEach(act => {
      if (act.type === 'tambah_lokasi' && act.distanceKm) {
        extraSum += act.distanceKm;
        extraDurSum += act.durationHours || 0;
      }
    });

    const baseDist = activeReportingJourney.distanceKm || 0;
    const baseDur = activeReportingJourney.durationHours || 0;
    const totalDist = activeReportingJourney.totalDistanceKm || (baseDist * 2);

    if (baseDist > 0 && (Math.abs(baseDist - totalDist) < 1 || baseDist >= calculatedDistanceKm - 0.5)) {
      const halfDist = Math.max(0, (calculatedDistanceKm - extraSum) / 2);
      const halfDur = Math.max(0, (calculatedDurationHours - extraDurSum) / 2);
      return {
        distanceKm: halfDist,
        durationHours: halfDur,
      };
    }

    return {
      distanceKm: baseDist,
      durationHours: baseDur,
    };
  };

  const getReturnLegDetails = () => {
    if (!activeReportingJourney) return { distanceText: '', legCost: 0, distanceKm: 0, durationHours: 0 };

    const outbound = getOutboundLegDetails();
    let extraSum = 0;
    let extraDurSum = 0;
    extraActivities.forEach(act => {
      if (act.type === 'tambah_lokasi' && act.distanceKm) {
        extraSum += act.distanceKm;
        extraDurSum += act.durationHours || 0;
      }
    });

    const returnDist = Math.max(0, calculatedDistanceKm - outbound.distanceKm - extraSum);
    const returnDur = Math.max(0, calculatedDurationHours - outbound.durationHours - extraDurSum);
    const returnCost = returnDist * (activeReportingJourney.vehicleRate || 0);

    return {
      distanceText: `${returnDist.toFixed(1)} km`,
      legCost: returnCost,
      distanceKm: returnDist,
      durationHours: returnDur
    };
  };

  const getMealAllowanceForDuration = (hours: number, vehicleName?: string): number => {
    if (vehicleName === 'Ndalem') return 0;
    return calculateMealAllowanceForDuration(hours, vehicleName);
  };

  const calculateElapsedHours = (start: string, end: string, nightCount: number): number => {
    if (!start || !end) return 0;
    try {
      return calculateJourneyElapsedHours(start, end, nightCount);
    } catch {
      return 0;
    }
  };

  const handleSaveDraft = async (journeyId: string) => {
    try {
      const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
      const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;
      const draftDateEnd = formIsMultiDay ? (formDateEnd || formDate) : formDate;
      await authenticatedJson('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save_draft',
          journeyId,
          draft: {
            date: formDate,
            dateEnd: draftDateEnd,
            isMultiDay: formIsMultiDay,
            timeStart: formTimeStart,
            timeEnd: formTimeEnd,
            nightCount: formIsMultiDay ? formNightCount : 0,
            fuelFee: fuelVal,
            tollParkingFee: tollVal,
            fuelReceiptUrl: fuelVal > 0 ? formFuelReceiptUrls.filter(Boolean).join(',') : '',
            tollReceiptUrl: tollVal > 0 ? formTollReceiptUrls.filter(Boolean).join(',') : '',
            extraActivities,
            calculatedDistanceKm,
            calculatedDurationHours,
          },
        }),
      });
    } catch (err) {
      console.error('Error saving draft:', err);
    }
  };

  const handleAddLocation = () => {
    const newIdx = extraActivities.length;
    setExtraActivities([...extraActivities, { type: 'tambah_lokasi', destination: '' }]);
    setMapTargetIndex(newIdx);
    setMapSearchText('');
    setMapAddress('');
    setShowMapSelector(true);
  };

  const handleRemoveExtraActivity = async (index: number) => {
    const updated = extraActivities.filter((_, idx) => idx !== index);
    setExtraActivities(updated);
    await recalculateRouteChain(updated);
  };

  const handleConfirmMapLocation = async () => {
    if (mapTargetMode === 'piketStart') {
      setSelfPiketStartPoint(mapAddress);
      setSelfPiketCalcDistance(null);
      lastSelfPiketCalculatedRef.current = { start: '', end: '' };
      setShowMapSelector(false);
      setMapTargetMode(null);
      return;
    }

    if (mapTargetMode === 'piketEnd') {
      setSelfPiketEndPoint(mapAddress);
      setSelfPiketCalcDistance(null);
      lastSelfPiketCalculatedRef.current = { start: '', end: '' };
      setShowMapSelector(false);
      setMapTargetMode(null);
      return;
    }

    if (mapTargetIndex === null) return;
    const updated = [...extraActivities];
    updated[mapTargetIndex] = {
      ...updated[mapTargetIndex],
      destination: mapAddress
    };
    setExtraActivities(updated);
    setShowMapSelector(false);
    setMapTargetIndex(null);
    await recalculateRouteChain(updated);
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

    const loadSatpamConfig = async () => {
      setLoadingSatpamConfig(true);
      try {
        const config = await authenticatedJson<{
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
        }>(`/api/satpam/config?dutyDate=${encodeURIComponent(satpamReportDate)}`, {
          method: 'GET',
        });
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
        console.error('Error loading Satpam shift configuration:', err);
        setMessage({
          type: 'error',
          text: err instanceof Error ? err.message : 'Konfigurasi Satpam gagal dimuat.',
        });
      } finally {
        setLoadingSatpamConfig(false);
      }
    };

    loadSatpamConfig();
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

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

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

  // Auto-redirect driver to dedicated /employee/activities/journey-report if an active claimed journey exists
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
      router.push(`/employee/activities/journey-report?id=${activeJourney.id}`);
    }
  }, [isSopir, myClaimedJourneys, router]);

  // ── Filtered activities ──
  const filteredActivities = useMemo(() => {
    if (statusFilter === 'all') return activities;
    return activities.filter(a => a.status === statusFilter);
  }, [activities, statusFilter]);

  // ── Stats ──
  const stats = useMemo(() => {
    const pending = activities.filter(a => a.status === 'pending').length;
    const approved = activities.filter(a => a.status === 'approved');
    const declined = activities.filter(a => a.status === 'declined').length;
    const totalApprovedFee = approved.reduce((sum, a) => sum + (a.fee || 0), 0);
    return { pending, approved: approved.length, declined, totalApprovedFee };
  }, [activities]);

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
    setUploadingFuelReceipt(false);
    setUploadingTollReceipt(false);
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

  useEffect(() => {
    if (activeReportingJourney) {
      const rawFuel = activeReportingJourney.draftFuelReceiptUrl || activeReportingJourney.fuelReceiptUrl || '';
      setFormFuelReceiptUrls(rawFuel ? rawFuel.split(',').filter(Boolean) : []);
      const rawToll = activeReportingJourney.draftTollReceiptUrl || activeReportingJourney.tollReceiptUrl || '';
      setFormTollReceiptUrls(rawToll ? rawToll.split(',').filter(Boolean) : []);
    } else {
      setFormFuelReceiptUrls([]);
      setFormTollReceiptUrls([]);
    }
  }, [activeReportingJourney]);

  const openEditForm = (activity: ActivityReport) => {
    if (activity.jobCategory === 'SOPIR' && activity.journeyId) {
      router.push(`/employee/activities/journey-report?id=${activity.journeyId}`);
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
      router.push(`/employee/activities/journey-report?id=${journeyId}`);
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
      router.push(`/employee/activities/journey-report?id=${journeyId}`);
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

  const compressImage = (file: File): Promise<File> => {
    // Preserve original file intact to retain EXIF metadata (creation timestamp, GPS coordinates, device model) for auditing.
    return Promise.resolve(file);
  };

  const handleUploadReceipt = async (file: File, type: 'bbm' | 'toll') => {
    if (!activeReportingJourney) return;
    const isBbm = type === 'bbm';
    if (isBbm) {
      setUploadingFuelReceipt(true);
    } else {
      setUploadingTollReceipt(true);
    }

    try {
      const processedFile = await compressImage(file);
      const extension = processedFile.name.split('.').pop() || 'jpg';
      const fileRef = ref(storage, `receipts/${activeReportingJourney.id}/${type}_${Date.now()}.${extension}`);
      await uploadBytes(fileRef, processedFile);
      const downloadUrl = await getDownloadURL(fileRef);
      if (isBbm) {
        setFormFuelReceiptUrls(prev => [...prev, downloadUrl]);
      } else {
        setFormTollReceiptUrls(prev => [...prev, downloadUrl]);
      }
      setMessage({ type: 'success', text: `Bukti ${isBbm ? 'BBM' : 'Tol & Parkir'} berhasil diunggah.` });
    } catch (err: any) {
      console.error(`Error uploading ${type} receipt:`, err);
      setMessage({ type: 'error', text: `Gagal mengunggah bukti ${isBbm ? 'BBM' : 'Tol & Parkir'}. Coba lagi.` });
    } finally {
      if (isBbm) {
        setUploadingFuelReceipt(false);
      } else {
        setUploadingTollReceipt(false);
      }
    }
  };

  const handleCompleteJourneySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReportingJourney || isSubmittingRef.current) return;
    if (!profile?.linkedEmployeeId) {
      setMessage({ type: 'error', text: 'Akun Anda belum terhubung ke data Pegawai. Silakan hubungi Admin.' });
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
    if (!formTimeStart || !formTimeEnd) {
      setMessage({ type: 'error', text: 'Waktu mulai dan selesai harus diisi.' });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      return;
    }
    if (!timeRegex.test(formTimeStart)) {
      setMessage({ type: 'error', text: 'Format waktu berangkat harus JJ:MM (contoh: 08:00).' });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      return;
    }
    if (!timeRegex.test(formTimeEnd)) {
      setMessage({ type: 'error', text: 'Format waktu tiba harus JJ:MM (contoh: 17:00).' });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      return;
    }
    if (calculateElapsedHours(formTimeStart, formTimeEnd, formIsMultiDay ? formNightCount : 0) <= 0) {
      setMessage({ type: 'error', text: 'Jam tiba dan jumlah malam tidak membentuk durasi perjalanan yang valid.' });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      return;
    }

    try {
      const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
      const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;
      const submittedFuelReceiptUrls = fuelVal > 0 ? formFuelReceiptUrls.filter(Boolean) : [];
      const submittedTollReceiptUrls = tollVal > 0 ? formTollReceiptUrls.filter(Boolean) : [];

      if (fuelVal <= 0 || submittedFuelReceiptUrls.length === 0) {
        setFormFuelReceiptUrls([]);
      }
      if (tollVal <= 0 || submittedTollReceiptUrls.length === 0) {
        setFormTollReceiptUrls([]);
      }

      if (fuelVal > 0 && submittedFuelReceiptUrls.length === 0) {
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

      // Calculate extra & allowance deduction values
      const isNdalem = activeReportingJourney.vehicleName === 'Ndalem';
      const originalTotalDist = (activeReportingJourney.distanceKm || 0) * 2;
      const extraDistanceKm = Math.max(0, calculatedDistanceKm - originalTotalDist);
      const extraOperationalCost = 0; // Extra mileage is compensated via Upah Bersih Sopir (distance component), not automatic cash reimbursement without receipts

      const preAuthorizedDurationPP = activeReportingJourney.customDurationPP || (activeReportingJourney.durationHours ? activeReportingJourney.durationHours * 2 : 0);
      const preAuthorizedMeal = isNdalem
        ? 0
        : (activeReportingJourney.mealAllowance !== undefined && activeReportingJourney.mealAllowance !== null && activeReportingJourney.mealAllowance > 0
          ? activeReportingJourney.mealAllowance
          : getMealAllowanceForDuration(preAuthorizedDurationPP));

      const preAuthorizedToll = activeReportingJourney.preAuthorizedToll !== undefined && activeReportingJourney.preAuthorizedToll !== null
        ? Number(activeReportingJourney.preAuthorizedToll)
        : Number(activeReportingJourney.tollParkingFee || 0);
      const baseCostVal = activeReportingJourney.baseOperationalCost !== undefined && activeReportingJourney.baseOperationalCost !== null
        ? Number(activeReportingJourney.baseOperationalCost)
        : Math.max(
          0,
          Number(activeReportingJourney.totalOperationalCost || 0) -
            preAuthorizedMeal -
            preAuthorizedToll,
        );

      const timings = calculateJourneyDateTimeTimings({
        dateStart: formDate,
        timeStart: formTimeStart,
        dateEnd: formIsMultiDay ? (formDateEnd || formDate) : formDate,
        timeEnd: formTimeEnd,
        isMultiDay: formIsMultiDay,
      });
      const effectiveDateEnd = formIsMultiDay ? (formDateEnd || formDate) : formDate;
      const effectiveNightCount = formIsMultiDay ? timings.nightCount : 0;
      const elapsedHours = timings.durationHours > 0 ? timings.durationHours : calculateElapsedHours(
        formTimeStart,
        formTimeEnd,
        effectiveNightCount,
      );
      const routeDurationHours = calculatedDurationHours > 0 ? calculatedDurationHours : elapsedHours;
      const submittedDurationHours = elapsedHours > 0 ? elapsedHours : routeDurationHours;
      const actualMealAllowance = getMealAllowanceForDuration(
        elapsedHours,
        activeReportingJourney.vehicleName,
      );
      const extraMealAllowance = isNdalem
        ? actualMealAllowance
        : Math.max(0, actualMealAllowance - preAuthorizedMeal);

      const settlement = calculateDriverReimbursementSettlement({
        fuelAllowance: isNdalem ? 0 : baseCostVal,
        fuelSpent: isNdalem ? 0 : fuelVal,
        tollAllowance: preAuthorizedToll,
        tollSpent: tollVal,
        additionalReimbursement: extraMealAllowance + extraOperationalCost,
      });
      const authorizedTotalOperationalCost = activeReportingJourney.totalOperationalCost !== undefined
        ? Number(activeReportingJourney.totalOperationalCost || 0)
        : baseCostVal + preAuthorizedMeal + preAuthorizedToll;
      const adjustedTotalOperationalCost = Math.max(
        0,
        authorizedTotalOperationalCost +
          settlement.netOperationalDelta +
          extraMealAllowance +
          extraOperationalCost,
      );

      // Driver Base Wage & Final Net Wage
      const nightPremium = calculateNightPremium(effectiveNightCount);
      const baseDriverWage = calculateDriverNetWage(
        calculatedDistanceKm,
        submittedDurationHours,
        effectiveNightCount,
      );
      const finalUpahBersih = Math.max(0, baseDriverWage - settlement.remainingUnspentCash);

      const extraLocs = extraActivities.filter(a => a.type === 'tambah_lokasi' && a.destination);
      const extraLocsText = extraLocs.map(l => l.destination.split(',')[0]).join(' → ');

      const routeText = ` (${activeReportingJourney.startPoint.split(',')[0]} → ${activeReportingJourney.endPoint}${extraLocsText ? ' → ' + extraLocsText : ''})`;
      const finalActivityName = activeReportingJourney.activityName + routeText;

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
            nightCount: effectiveNightCount,
            dateStart: formDate,
            dateEnd: effectiveDateEnd,
            isMultiDay: formIsMultiDay,
            fuelFee: fuelVal,
            tollParkingFee: tollVal,
            fuelReceiptUrl: submittedFuelReceiptUrls.join(','),
            tollReceiptUrl: submittedTollReceiptUrls.join(','),
            points: [activeReportingJourney.startPoint, activeReportingJourney.endPoint, ...extraLocs.map(l => l.destination)],
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
            actualMealAllowance,
            positiveReimburseDelta: settlement.positiveReimburseDelta,
            baseDriverWage,
            upahBersih: finalUpahBersih,
            reimburseDelta: settlement.reimburseDelta,
            unspentCash: settlement.unspentCash,
            remainingUnspentCash: settlement.remainingUnspentCash,
            netOperationalDelta: settlement.netOperationalDelta,
            fuelAllowanceSurplus: settlement.fuelAllowanceSurplus,
            tollAllowanceSurplus: settlement.tollAllowanceSurplus,
            baseOperationalCost: baseCostVal,
            preAuthorizedMeal,
            preAuthorizedToll,
            customDurationPP: preAuthorizedDurationPP,
            totalPreAuthorizedAllowance: settlement.totalPreAuthorizedAllowance,
            totalActualSpent: settlement.totalActualSpent,
            totalOperationalCost: adjustedTotalOperationalCost,
            vehicleRate: activeReportingJourney.vehicleRate ?? 1000,
            componentJarak: Math.ceil(calculatedDistanceKm * 300),
            componentWaktu: Math.ceil(submittedDurationHours * 5000),
            nightPremium,
          },
        }),
      });

      setMessage({ type: 'success', text: activeReportingJourney.editingActivityDocId ? 'Laporan perjalanan berhasil diperbarui.' : 'Perjalanan dinas berhasil dilaporkan.' });

      setActiveReportingJourney(null);
      resetForm();
      fetchActivities();
    } catch (err) {
      console.error('Error reporting journey completion:', err);
      setMessage({ type: 'error', text: 'Gagal mengirimkan laporan perjalanan.' });
      skipSaveDraftRef.current = false;
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
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

  const satpamPendingStorageKey = useMemo(
    () =>
      profile?.linkedEmployeeId
        ? `unipdu:satpam-draft:${profile.linkedEmployeeId}:${satpamReportDate}`
        : '',
    [profile?.linkedEmployeeId, satpamReportDate],
  );

  useEffect(() => {
    if (!isKetuaShiftSatpam || !profile?.linkedEmployeeId || !satpamReportDate) return;

    let isMounted = true;
    setLoadingSubmittedSatpam(true);
    setSatpamDraftHydrated(false);

    authenticatedJson<{
      occurrence: null | {
        id: string;
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
      }>;
    }>(`/api/satpam/shifts?dutyDate=${encodeURIComponent(satpamReportDate)}`, {
      method: 'GET',
    }).then(({ occurrence, assignments }) => {
      if (!isMounted) return;

      const defaultShiftTypeForDate = getDefaultShiftTypeForDate(satpamReportDate);

      if (occurrence) {
        const newAssignments: Record<string, SatpamPostAssignment> = {
          'Pos 1': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 2': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 3': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 4': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 5': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 6': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 7': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 8': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 9': { employeeId: '', shiftType: defaultShiftTypeForDate },
        };
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

        setPostAssignments(newAssignments);
        setSatpamOccurrenceId(occurrence.id);
        setSatpamOccurrenceRevision(Number(occurrence.revision || 1));
        setSatpamAuditorActionAt(occurrence.auditorActionAt || null);
        setSatpamReviewStatus(
          occurrence.status === 'approved' || occurrence.reviewStatus === 'approved'
            ? 'approved'
            : occurrence.reviewStatus === 'partially_approved'
              ? 'partially_approved'
            : occurrence.status === 'declined' || occurrence.reviewStatus === 'declined'
              ? 'declined'
              : occurrence.status === 'under_review' || occurrence.reviewStatus === 'under_review'
                ? 'under_review'
                : 'pending_review',
        );
        setSatpamAnomalies(Array.isArray(occurrence.anomalies) ? occurrence.anomalies : []);
        if (occurrence.reportedShiftName) setSatpamReportedShiftName(occurrence.reportedShiftName);
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
        setIsSatpamReportSubmitted(true);
      } else {
        setSatpamOccurrenceId('');
        setSatpamOccurrenceRevision(0);
        setSatpamAuditorActionAt(null);
        setSatpamReviewStatus('draft');
        setSatpamAnomalies([]);
        setSatpamSuggestedShiftName(calculatedSuggestedShift);
        setSatpamReportedShiftName(calculatedSuggestedShift);
        const blankAssignments: Record<string, SatpamPostAssignment> = {
          'Pos 1': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 2': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 3': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 4': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 5': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 6': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 7': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 8': { employeeId: '', shiftType: defaultShiftTypeForDate },
          'Pos 9': { employeeId: '', shiftType: defaultShiftTypeForDate },
        };
        let restoredPending = false;
        if (satpamPendingStorageKey) {
          try {
            const rawPending = window.localStorage.getItem(satpamPendingStorageKey);
            const pending = satpamDraftHasContent(rawPending)
              ? JSON.parse(rawPending!)
              : null;
            if (
              pending &&
              pending?.payload?.dutyDate === satpamReportDate &&
              Array.isArray(pending.payload.assignments)
            ) {
              if (['Pagi', 'Sore', 'Malam'].includes(pending.payload.shiftName)) {
                setSatpamReportedShiftName(pending.payload.shiftName);
              }
              for (const assignment of pending.payload.assignments) {
                if (!blankAssignments[assignment.postId]) continue;
                blankAssignments[assignment.postId] = {
                  employeeId: assignment.employeeId || '',
                  shiftType: assignment.coveredEmployeeId
                    ? 'Lembur Cover'
                    : defaultShiftTypeForDate,
                  coveredEmployeeId: assignment.coveredEmployeeId || '',
                  overtimeReason: assignment.overtimeReason || '',
                  photoUrl: assignment.photoUrl || '',
                  photoAuditMetadata: assignment.photoAuditMetadata,
                };
              }
              const pendingExtra = pending.payload.extraAssignment;
              setExtraEmployeeId(pendingExtra?.employeeId || '');
              setExtraPostName(pendingExtra?.postId || '');
              setExtraShiftType('Lembur Sendiri');
              setExtraOvertimeReason(pendingExtra?.overtimeReason || '');
              setExtraPhotoUrl(pendingExtra?.photoUrl || '');
              setExtraPhotoAuditMetadata(pendingExtra?.photoAuditMetadata);
              setIsExtraPostVisible(Boolean(pendingExtra));
              if (pending.requestId) {
                satpamRequestIdsRef.current[
                  `${satpamReportDate}_${pending.payload.shiftName || calculatedSuggestedShift}`
                ] = pending.requestId;
              }
              restoredPending = true;
              setMessage({
                type: 'success',
                text: 'Draf laporan yang belum selesai berhasil dipulihkan.',
              });
            }
          } catch (error) {
            console.warn('Draf antrean Satpam lokal tidak dapat dipulihkan:', error);
          }
        }
        setPostAssignments(blankAssignments);
        if (!restoredPending) {
          setExtraEmployeeId('');
          setExtraPostName('');
          setExtraShiftType('Lembur Sendiri');
          setExtraOvertimeReason('');
          setIsExtraPostVisible(false);
        }
        setIsSatpamReportSubmitted(false);
      }
      setSatpamDraftHydrated(true);
      setLoadingSubmittedSatpam(false);
    }).catch((err) => {
      console.error('Error fetching submitted Satpam reports:', err);
      if (isMounted) {
        setSatpamDraftHydrated(true);
        setLoadingSubmittedSatpam(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [
    satpamReportDate,
    profile?.linkedEmployeeId,
    satpamPendingStorageKey,
    calculatedSuggestedShift,
  ]);

  useEffect(() => {
    if (
      !isKetuaShiftSatpam ||
      !satpamDraftHydrated ||
      isSatpamReportSubmitted ||
      !satpamDutyPlan?.day
    ) {
      return;
    }
    if (
      satpamPendingStorageKey &&
      satpamDraftHasContent(
        window.localStorage.getItem(satpamPendingStorageKey),
      )
    ) {
      return;
    }
    const plannedAssignments: Record<string, SatpamPostAssignment> = {
      'Pos 1': { employeeId: '', shiftType: satpamRegularPayType },
      'Pos 2': { employeeId: '', shiftType: satpamRegularPayType },
      'Pos 3': { employeeId: '', shiftType: satpamRegularPayType },
      'Pos 4': { employeeId: '', shiftType: satpamRegularPayType },
      'Pos 5': { employeeId: '', shiftType: satpamRegularPayType },
      'Pos 6': { employeeId: '', shiftType: satpamRegularPayType },
      'Pos 7': { employeeId: '', shiftType: satpamRegularPayType },
      'Pos 8': { employeeId: '', shiftType: satpamRegularPayType },
      'Pos 9': { employeeId: '', shiftType: satpamRegularPayType },
    };
    satpamDutyPlan.day.assignments.forEach((assignment) => {
      plannedAssignments[assignment.postId] = {
        employeeId: assignment.employeeId,
        shiftType:
          assignment.employeeId === myShiftTeam?.ketuaShiftId ||
          (assignment.postId === 'Pos 9' && pos9GuardIds.has(assignment.employeeId))
            ? 'Harian'
            : satpamRegularPayType,
      };
    });
    satpamSkipNextAutosaveRef.current = true;
    setPostAssignments(plannedAssignments);
    setSatpamReportedShiftName(satpamDutyPlan.day.shiftName);
  }, [
    isKetuaShiftSatpam,
    isSatpamReportSubmitted,
    satpamDraftHydrated,
    satpamDutyPlan,
    satpamPendingStorageKey,
    satpamRegularPayType,
    myShiftTeam?.ketuaShiftId,
    pos9GuardIds,
  ]);

  useEffect(() => {
    if (
      !isKetuaShiftSatpam ||
      !satpamDraftHydrated ||
      !satpamPendingStorageKey ||
      isSatpamReportLocked
    ) {
      return;
    }
    if (satpamSkipNextAutosaveRef.current) {
      satpamSkipNextAutosaveRef.current = false;
      return;
    }
    const assignments = Object.entries(postAssignments)
      .filter(([, assignment]) => Boolean(assignment.employeeId))
      .map(([postId, assignment]) => ({
        postId,
        employeeId: assignment.employeeId,
        shiftType: assignment.shiftType,
        coveredEmployeeId: assignment.coveredEmployeeId,
        overtimeReason: assignment.overtimeReason,
        photoUrl: assignment.photoUrl,
        photoAuditMetadata: assignment.photoAuditMetadata,
      }));
    const extraAssignment =
      isExtraPostVisible && extraEmployeeId
        ? {
            postId: extraPostName,
            employeeId: extraEmployeeId,
            overtimeReason: extraOvertimeReason,
            photoUrl: extraPhotoUrl,
            photoAuditMetadata: extraPhotoAuditMetadata,
          }
        : null;
    // A blank form is not a draft. Storing one would both raise a spurious
    // "draft restored" notice and permanently block the duty-plan prefill,
    // which treats any stored draft as work the guard already started.
    if (assignments.length === 0 && !extraAssignment) {
      window.localStorage.removeItem(satpamPendingStorageKey);
      return;
    }
    const payload = {
      dutyDate: satpamReportDate,
      shiftName: activeShift,
      ...(satpamDutyPlan?.planId && satpamDutyPlan.revision > 0
        ? {
            dutyPlanId: satpamDutyPlan.planId,
            dutyPlanRevision: satpamDutyPlan.revision,
          }
        : {}),
      assignments,
      ...(extraAssignment ? { extraAssignment } : {}),
    };
    window.localStorage.setItem(
      satpamPendingStorageKey,
      JSON.stringify({ payload, savedAt: new Date().toISOString() }),
    );
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
    satpamPendingStorageKey,
    satpamReportDate,
    satpamDutyPlan,
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

  const setSatpamDateShortcut = (dayOffset: number) => {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + dayOffset);
    const nextValue = [
      nextDate.getFullYear(),
      String(nextDate.getMonth() + 1).padStart(2, '0'),
      String(nextDate.getDate()).padStart(2, '0'),
    ].join('-');
    const isOpen = satpamOpenPeriods.some(
      (period) => nextValue >= period.startDate && nextValue <= period.endDate,
    );
    if (!isOpen) {
      setMessage({ type: 'error', text: 'Tanggal tersebut belum termasuk periode payroll yang terbuka.' });
      return;
    }
    setSatpamReportDate(nextValue);
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
    setSatpamReportDate(nextValue);
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
      const isDesignatedPos9 =
        postId === 'Pos 9' && Boolean(employeeId) && pos9GuardIds.has(employeeId);
      const isKetua = employeeId !== '' && employeeId === myShiftTeam?.ketuaShiftId;
      const defaultType =
        forced?.shiftType ||
        (isKetua || isDesignatedPos9
          ? 'Harian'
          : isExternal
            ? 'Harian'
            : getDefaultShiftTypeForDate(satpamReportDate));

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
      const fileRef = ref(
        storage,
        `satpam_shifts/${profile.linkedEmployeeId}/${satpamReportDate}_${activeShift}_${safePost}_${Date.now()}.jpg`,
      );
      await uploadBytes(fileRef, prepared.file);
      const downloadUrl = await getDownloadURL(fileRef);

      if (postId === 'extra') {
        setExtraPhotoUrl(downloadUrl);
        setExtraPhotoAuditMetadata(prepared.auditMetadata);
      } else {
        setPostAssignments(prev => ({
          ...prev,
          [postId]: { ...prev[postId], photoUrl: downloadUrl, photoAuditMetadata: prepared.auditMetadata },
        }));
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
      const fileRef = ref(
        storage,
        `activity_proofs/${profile.linkedEmployeeId}/${Date.now()}.jpg`,
      );
      await uploadBytes(fileRef, prepared.file);
      const url = await getDownloadURL(fileRef);
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
        const fileRef = ref(
          storage,
          `activity_proofs/${profile.linkedEmployeeId}/found-item-${Date.now()}-${index}.jpg`,
        );
        await uploadBytes(fileRef, prepared.file);
        uploaded.push({
          url: await getDownloadURL(fileRef),
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
    setSatpamSubmitting(true);
    try {
      const requestKey = `${satpamReportDate}_${activeShift}`;
      const requestId =
        satpamRequestIdsRef.current[requestKey] ||
        createFinancialRequestId('satpam_shift');
      satpamRequestIdsRef.current[requestKey] = requestId;
      const payload = {
        requestId,
        dutyDate: satpamReportDate,
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
            shiftType: (assignment.shiftType || getDefaultShiftTypeForDate(satpamReportDate)) as SatpamPayType,
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
        window.localStorage.setItem(
          satpamPendingStorageKey,
          JSON.stringify({ requestId, payload, savedAt: new Date().toISOString() }),
        );
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
        window.localStorage.removeItem(satpamPendingStorageKey);
      }

      setMessage({
        type: 'success',
        text: satpamOccurrenceId
          ? 'Perubahan laporan tersimpan dan menunggu pemeriksaan auditor.'
          : `Laporan shift ${activeShift} tanggal ${satpamReportDate} terkirim dan menunggu audit Kepala SatKer.`,
      });
      setSatpamOccurrenceId(result.occurrenceId);
      setSatpamOccurrenceRevision(result.revision);
      setSatpamAnomalies(result.anomalies || []);
      setSatpamReviewStatus('pending_review');
      setIsSatpamReportSubmitted(true);
      fetchActivities();
    } catch (err) {
      console.error('Error submitting Satpam shift reports:', err);
      setMessage({
        type: 'error',
        text:
          err instanceof Error
            ? `${err.message} Draf tetap tersimpan lokal untuk dicoba ulang.`
            : 'Gagal mengirim laporan shift. Draf tetap tersimpan lokal untuk dicoba ulang.',
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

  // ── Loading State ──
  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center relative overflow-hidden">
        {/* Subtle decorative blobs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin relative z-10" />
      </div>
    );
  }

  if (!profile.linkedEmployeeId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 flex items-center justify-center p-6 relative overflow-hidden">
        {/* Subtle decorative blobs */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
        <Card className="max-w-md w-full rounded-3xl border-none shadow-xl bg-white relative z-10">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-rose-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Akun Belum Terhubung</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Akun Anda belum dihubungkan dengan data pegawai di sistem. Silakan hubungi administrator BAK untuk konfigurasi akun.
            </p>
            <Button
              onClick={() => logout()}
              variant="outline"
              className="rounded-xl mt-4"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Keluar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Helper to render driver travel history
  const renderRiwayatSopir = () => {
    return (
      <div className="space-y-4 animate-in fade-in duration-200">
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-white rounded-2xl shadow-sm border border-slate-100">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-indigo-600">{stats.approved + stats.pending + stats.declined}</div>
              <div className="text-[11px] font-semibold text-slate-400 mt-0.5">Total Perjalanan</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl shadow-lg shadow-indigo-200/40 border-none">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-extrabold text-white">
                {fmtRp(activities.filter(a => a.status === 'approved').reduce((sum, a) => sum + (a.upahBersih || 0), 0))}
              </div>
              <div className="text-[11px] font-semibold text-indigo-100 mt-0.5">Upah Bersih Disetujui</div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setStatusFilter('all')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'all'
              ? 'bg-slate-800 text-white shadow-md'
              : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
              }`}
          >
            Semua ({activities.length})
          </button>
          <button
            onClick={() => setStatusFilter('pending')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'pending'
              ? 'bg-amber-500 text-white shadow-md'
              : 'bg-white text-amber-600 border border-amber-200 hover:bg-amber-50'
              }`}
          >
            Menunggu ({stats.pending})
          </button>
          <button
            onClick={() => setStatusFilter('approved')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'approved'
              ? 'bg-emerald-500 text-white shadow-md'
              : 'bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50'
              }`}
          >
            Disetujui ({stats.approved})
          </button>
          <button
            onClick={() => setStatusFilter('declined')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'declined'
              ? 'bg-rose-500 text-white shadow-md'
              : 'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50'
              }`}
          >
            Ditolak ({stats.declined})
          </button>
        </div>

        {loading ? (
          <div className="py-16 flex flex-col items-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
            <span className="text-sm font-medium animate-pulse">Memuat riwayat perjalanan...</span>
          </div>
        ) : filteredActivities.length === 0 ? (
          <Card className="bg-white rounded-2xl shadow-sm border border-slate-100">
            <CardContent className="py-16 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                <Compass className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-base font-bold text-slate-700">Belum Ada Riwayat Perjalanan</h3>
              <p className="text-xs text-slate-400 max-w-xs mt-1.5 leading-relaxed">
                {statusFilter !== 'all'
                  ? `Tidak ada riwayat perjalanan berstatus "${getStatusConfig(statusFilter).label}" pada periode ini.`
                  : 'Perjalanan dinas yang Anda ambil dan laporkan akan muncul di sini.'
                }
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {filteredActivities.map((activity) => {
              const sc = getStatusConfig(activity.status);
              const reimburseDelta = activity.reimburseDelta !== undefined
                ? activity.reimburseDelta
                : calculateDriverReimbursementSettlement({
                  fuelAllowance: activity.vehicleType === 'Ndalem' ? 0 : Number(activity.baseOperationalCost || 0),
                  fuelSpent: activity.vehicleType === 'Ndalem'
                    ? 0
                    : activity.fuelFee !== undefined
                      ? Number(activity.fuelFee || 0)
                      : Number(activity.baseOperationalCost || 0) + Number(activity.extraFuelCost || 0),
                  tollAllowance: Number(activity.preAuthorizedToll || 0),
                  tollSpent: activity.tollParkingFee !== undefined
                    ? Number(activity.tollParkingFee || 0)
                    : Number(activity.preAuthorizedToll || 0) + Number(activity.extraTollCost || 0),
                  additionalReimbursement: Number(activity.extraMealAllowance || 0) + Number(activity.extraOperationalCost || 0),
                }).reimburseDelta;

              return (
                <Card key={activity.id} className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden hover:border-slate-300 transition-all animate-in fade-in duration-150">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${sc.dotClass}`} />
                        <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md ${sc.bgClass} ${sc.textClass} border ${sc.borderClass}`}>
                          {sc.label}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-md">
                        {activity.vehicleType || 'Kendaraan'}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-xs sm:text-sm font-extrabold text-slate-800 leading-snug">
                        {activity.activityName.split(' (')[0]}
                      </h4>
                      {activity.activityName.includes(' (') && (
                        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-500 font-semibold bg-slate-50/60 p-2 rounded-lg border border-slate-100">
                          <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span className="truncate flex-1 text-slate-700 font-extrabold">
                            {activity.activityName.split(' (')[1].replace(')', '')}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2.5 mt-2 text-[10px] text-slate-400 font-bold">
                        <span className="flex items-center gap-1">📅 {activity.activityDate}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">⏱️ {activity.timeStart} – {activity.timeEnd}</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-2.5 border-t border-slate-100">
                      <div className="flex gap-4">
                        <div>
                          <span className="block text-[8px] text-slate-400 font-extrabold uppercase leading-tight">Total Reimburse (Delta)</span>
                          <span className="text-xs font-black text-blue-600">{fmtRp(Math.ceil(reimburseDelta))}</span>
                        </div>
                        <div>
                          <span className="block text-[8px] text-slate-400 font-extrabold uppercase leading-tight">Upah Bersih</span>
                          <span className="text-xs font-black text-emerald-600">{fmtRp(Math.ceil(activity.upahBersih || 0))}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 items-end">
                        {activity.fuelReceiptUrl && (
                          <div className="flex flex-wrap gap-1 justify-end">
                            {activity.fuelReceiptUrl.split(',').filter(Boolean).map((url, idx, arr) => (
                              <a
                                key={idx}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[9px] font-bold text-emerald-600 hover:text-emerald-800 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md transition-colors"
                              >
                                📄 Bukti BBM {arr.length > 1 ? `#${idx + 1}` : ''}
                              </a>
                            ))}
                          </div>
                        )}
                        {activity.tollReceiptUrl && (
                          <div className="flex flex-wrap gap-1 justify-end">
                            {activity.tollReceiptUrl.split(',').filter(Boolean).map((url, idx, arr) => (
                              <a
                                key={idx}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[9px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md transition-colors"
                              >
                                📄 Bukti Tol {arr.length > 1 ? `#${idx + 1}` : ''}
                              </a>
                            ))}
                          </div>
                        )}
                        {(activity.status === 'pending' || activity.status === 'declined') && (
                          <Button
                            onClick={() => openEditForm(activity)}
                            variant="outline"
                            size="sm"
                            className="rounded-lg border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-bold text-xs h-7 px-2.5 gap-1 cursor-pointer"
                          >
                            <Pencil className="w-3 h-3 text-indigo-600" />
                            <span>Edit</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
      {/* ── Notifications ────────────────────────────────────────────── */}
      {message && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[10000] flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold shadow-xl border max-w-[90%] w-[420px] animate-in fade-in slide-in-from-top-4 duration-300 ${message.type === 'success'
          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
          : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}>
          {message.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          }
          <span className="flex-1 leading-snug">{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="text-slate-400 hover:text-slate-600 font-black ml-2 text-xs cursor-pointer focus:outline-none"
          >
            ✕
          </button>
        </div>
      )}
      {/* Subtle decorative blobs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm relative z-20">
        <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-200/50">
              <ClipboardList className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-tight">Laporan Kegiatan</h1>
              <p className="text-[11px] text-slate-400 font-medium">{profile.displayName || 'Karyawan'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {isSopir && (
              <Link href="/employee/driver-history">
                <Button
                  variant="outline"
                  size="icon"
                  className="text-slate-600 hover:text-indigo-650 hover:bg-slate-50 border border-slate-200 bg-white rounded-xl h-9 w-9 flex items-center justify-center shadow-sm cursor-pointer"
                  title="Riwayat Perjalanan"
                >
                  <Compass className="w-4.5 h-4.5 text-indigo-500" />
                </Button>
              </Link>
            )}
            {isKetuaShiftSatpam && (
              <Link href="/employee/satpam-duty-plan">
                <Button
                  variant="outline"
                  size="icon"
                  className="text-slate-600 hover:text-indigo-650 hover:bg-slate-50 border border-slate-200 bg-white rounded-xl h-9 w-9 flex items-center justify-center shadow-sm cursor-pointer"
                  title="Jadwal Regu"
                >
                  <CalendarDays className="w-4.5 h-4.5 text-indigo-500" />
                </Button>
              </Link>
            )}
            <Link href="/employee/payslip">
              <Button
                variant="outline"
                size="icon"
                className="text-slate-600 hover:text-indigo-650 hover:bg-slate-50 border border-slate-200 bg-white rounded-xl h-9 w-9 flex items-center justify-center shadow-sm cursor-pointer"
                title="Slip Gaji"
              >
                <Banknote className="w-4.5 h-4.5 text-emerald-600" />
              </Button>
            </Link>

            <Button
              onClick={() => logout()}
              variant="ghost"
              size="icon"
              className="text-slate-400 hover:text-rose-500 rounded-xl h-9 w-9 border border-slate-150/40 bg-white shadow-sm flex items-center justify-center cursor-pointer"
              title="Keluar"
            >
              <LogOut className="w-4.5 h-4.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-5 relative z-10">

        {/* ── Period Selector (Non-Driver Users Only) ────────────────── */}
        {!isSopir && (
          <Card className="bg-white rounded-2xl shadow-sm border-none">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <CalendarDays className="w-4 h-4 text-teal-500 shrink-0" />
                <div className="flex items-center gap-2 flex-1">
                  <Select value={String(month)} onValueChange={(v) => v && setMonth(parseInt(v))}>
                    <SelectTrigger className="text-sm font-bold text-slate-700 bg-slate-50 rounded-xl border border-slate-200 h-10 px-3 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                      {MONTHS_ID.map((m, i) => {
                        const now = new Date();
                        const currentYear = now.getFullYear();
                        const currentMonth = now.getMonth() + 1;
                        const isHidden = isKetuaShiftSatpam && (
                          (year === 2026 && (i + 1) < 7) ||
                          (year === currentYear && (i + 1) > currentMonth) ||
                          (year > currentYear)
                        );
                        if (isHidden) return null;
                        return (
                          <SelectItem
                            key={i + 1}
                            value={String(i + 1)}
                          >
                            {m}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Select value={String(year)} onValueChange={(v) => v && setYear(parseInt(v))}>
                    <SelectTrigger className="text-sm font-bold text-slate-700 bg-slate-50 rounded-xl border border-slate-200 h-10 px-3 w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                      {YEARS.map(y => {
                        const now = new Date();
                        const currentYear = now.getFullYear();
                        const isHidden = isKetuaShiftSatpam && (
                          y < 2026 || y > currentYear
                        );
                        if (isHidden) return null;
                        return (
                          <SelectItem
                            key={y}
                            value={String(y)}
                          >
                            {y}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Izin Satpam lives in a modal behind its own FAB, and the duty plan
            has moved to /employee/satpam-duty-plan. */}

        {/* ── Satpam Shift Team Daily Logging Form (Ketua Shift only) ── */}
        {isKetuaShiftSatpam && (
          <Card ref={satpamShiftCardRef} className="bg-white rounded-2xl shadow-sm border-none overflow-hidden py-0 scroll-mt-4">
            <CardHeader className="bg-gradient-to-r from-purple-600 to-indigo-600 p-5 text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md">
                  <ClipboardList className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold text-white">Lapor Roster Shift Regu</CardTitle>
                  <CardDescription className="text-purple-100 text-base mt-1">
                    {myShiftTeam ? `Regu ${myShiftTeam.id.split('_')[1]} (Ketua: ${myShiftTeam.ketuaShiftName})` : 'Mengambil data regu...'}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {loadingSatpamConfig ? (
                <div className="py-8 flex flex-col items-center justify-center text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-600 mb-2" />
                  <span className="text-base font-semibold">Memuat data regu Satpam...</span>
                </div>
              ) : (
                <form onSubmit={handleSubmitSatpamShift} className="space-y-4">
                  {/* Date selection & Shift Display */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 pb-3">
                    <div className="space-y-2">
                      <Label htmlFor="satpamDate" className="text-sm font-bold text-slate-600">
                        Pilih Tanggal Dinas
                      </Label>
                      <Input
                        id="satpamDate"
                        type="date"
                        value={satpamReportDate}
                        onChange={(e) => handleSatpamDateChange(e.target.value)}
                        disabled={isSatpamReportLocked || !satpamFlexibilityEnabled}
                        className="h-12 rounded-xl border-slate-200 focus:border-purple-400 focus:ring-purple-400/20 text-base font-bold text-slate-700 bg-white"
                        required
                      />
                    </div>

                    <div className="flex flex-col justify-center space-y-2">
                      <Label className="text-sm font-bold text-slate-600">Shift yang Dilaporkan</Label>
                      <Select
                        value={activeShift}
                        onValueChange={(value) => value && setSatpamReportedShiftName(value as 'Pagi' | 'Sore' | 'Malam')}
                        disabled={
                          isSatpamReportLocked ||
                          loadingSubmittedSatpam ||
                          !satpamFlexibilityEnabled
                        }
                      >
                        <SelectTrigger className="h-12 w-full rounded-xl border border-slate-200 bg-white text-base font-bold text-slate-700 px-3 flex items-center justify-between shadow-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="w-[var(--radix-select-trigger-width)] min-w-[280px] rounded-xl border border-slate-100 shadow-xl bg-white p-1.5 z-50">
                          <SelectItem value="Pagi" className="rounded-lg font-semibold py-2.5 px-3 cursor-pointer">
                            <span className="font-bold text-slate-800">Shift Pagi</span>
                            <span className="ml-2 text-xs font-medium text-slate-500">(08:00 – 14:00 WIB)</span>
                          </SelectItem>
                          <SelectItem value="Sore" className="rounded-lg font-semibold py-2.5 px-3 cursor-pointer">
                            <span className="font-bold text-slate-800">Shift Sore</span>
                            <span className="ml-2 text-xs font-medium text-slate-500">(14:00 – 22:00 WIB)</span>
                          </SelectItem>
                          <SelectItem value="Malam" className="rounded-lg font-semibold py-2.5 px-3 cursor-pointer">
                            <span className="font-bold text-slate-800">Shift Malam</span>
                            <span className="ml-2 text-xs font-medium text-slate-500">(22:00 – 08:00 WIB)</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-sm text-slate-600">
                        Saran sistem: <strong>Shift {satpamSuggestedShiftName}</strong>. Anda tetap boleh memilih shift yang benar.
                      </p>
                      {!satpamFlexibilityEnabled && (
                        <p className="text-sm font-semibold text-amber-800">
                          Alur fleksibel sedang diuji pada regu lain; regu ini masih memakai tanggal dan rota hari ini.
                        </p>
                      )}
                    </div>


                    {/* Shift Date Range Helper */}
                    <div className="sm:col-span-2 pt-2 border-t border-slate-200/60 mt-1 flex items-start gap-2 text-base font-semibold text-slate-600">
                      <Clock className="w-3.5 h-3.5 text-purple-500" />
                      <span>
                        Waktu Dinas: {(() => {
                          if (!satpamReportDate) return '';
                          const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
                          const startDate = new Date(satpamReportDate);
                          const startStr = startDate.toLocaleDateString('id-ID', options);
                          if (activeShift === 'Malam') {
                            const endDate = new Date(startDate);
                            endDate.setDate(startDate.getDate() + 1);
                            const endStr = endDate.toLocaleDateString('id-ID', options);
                            return `${startStr} (22:00) s/d ${endStr} (08:00 WIB)`;
                          } else if (activeShift === 'Pagi') {
                            return `${startStr} (08:00 s/d 14:00 WIB)`;
                          } else {
                            return `${startStr} (14:00 s/d 22:00 WIB)`;
                          }
                        })()}
                      </span>
                    </div>
                  </div>

                  {/* 9 Posts Duty Grid */}
                  <div className="space-y-3">
                    {satpamDutyPlan?.warning && (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-950">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                          <span>{satpamDutyPlan.warning}</span>
                        </div>
                      </div>
                    )}
                    <h3 className="text-base font-bold text-slate-600 border-b border-slate-100 pb-2">
                      Penugasan Pos Keamanan (9 Pos)
                    </h3>
                    {pos9GuardIds.size < 3 && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                        Tiga petugas Pos 9 belum lengkap dari rencana regu periode ini. Pos 9 tetap dapat dilaporkan, tetapi perlu diperiksa Kepala SatKer.
                      </div>
                    )}

                    <div className="space-y-3.5">
                      {POSTS_CONFIG.map((post) => {
                        const defaultShiftTypeForRender = getDefaultShiftTypeForDate(satpamReportDate);
                        const val = postAssignments[post.id] || { employeeId: '', shiftType: defaultShiftTypeForRender };
                        const isCrossTeamPos9 = isCrossTeamPos9Guard(post.id, val.employeeId);
                        const isExternalGuard = Boolean(
                          val.employeeId && !groupEmployeeIds.includes(val.employeeId),
                        );
        const isKetuaGuard = Boolean(
                          val.employeeId && val.employeeId === myShiftTeam?.ketuaShiftId,
                        );
                        const isPos9 = post.id === 'Pos 9';
                        const isDesignatedPos9 = Boolean(
                          isPos9 && val.employeeId && pos9GuardIds.has(val.employeeId),
                        );
                        const selectedShiftType = isKetuaGuard
                          ? (['Harian', 'Lembur Sendiri'].includes(val.shiftType)
                            ? val.shiftType
                            : 'Harian')
                          : isCrossTeamPos9
                          ? (['Harian', 'Lembur Sendiri', 'Lembur Cover'].includes(val.shiftType)
                            ? val.shiftType
                            : defaultShiftTypeForRender)
                          : isDesignatedPos9
                            ? (['Harian', 'Jumat & Libur', 'Lembur Sendiri'].includes(val.shiftType)
                              ? val.shiftType
                              : 'Harian')
                          : isExternalGuard
                            ? (['Harian', 'Lembur Cover'].includes(val.shiftType)
                              ? val.shiftType
                              : 'Harian')
                            : (val.shiftType === 'Lembur Cover'
                              ? 'Lembur Cover'
                              : defaultShiftTypeForRender);
                        const plannedEmployeeForPost = satpamDutyPlan?.day?.assignments.find(
                          (assignment) => assignment.postId === post.id,
                        )?.employeeId;
                        const coverCandidates = isCrossTeamPos9 && satpamDutyPlan?.fixedPost9EmployeeId
                          ? groupEmployees.filter((employee) => employee.id === satpamDutyPlan.fixedPost9EmployeeId)
                          : isExternalGuard && plannedEmployeeForPost
                            ? groupEmployees.filter((employee) => employee.id === plannedEmployeeForPost)
                            : visibleGroupEmployees.filter((employee) => !assignedEmployeeIds.includes(employee.id));
                        const isPlannedRegular = Boolean(
                          val.employeeId &&
                          satpamDutyPlan?.day?.assignments.some(
                            assignment => assignment.employeeId === val.employeeId,
                          ),
                        );
                        const plannedPayLabel = isPlannedRegular
                          ? `${defaultShiftTypeForRender} (${defaultShiftTypeForRender === 'Jumat & Libur' ? 'Rp25.000' : 'Rp12.500'})`
                          : val.employeeId
                            ? 'Lembur Cover (Rp50.000)'
                            : 'Pilih petugas dahulu';
                        return (
                          <div key={post.id} className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center bg-white p-3 rounded-xl border border-slate-200 hover:shadow-sm transition-shadow">
                            {/* Pos Name Label */}
                            <div className="md:col-span-3">
                              <span className="text-base font-black text-slate-600 block leading-tight">{post.id}</span>
                              <span className="text-base font-extrabold text-slate-900 block mt-1">{post.name}</span>
                              {post.id === 'Pos 2' && (
                                <span className="mt-1 block text-sm font-bold text-blue-700">
                                  Ketua Shift / Keliling
                                </span>
                              )}
                              {post.id === 'Pos 9' && satpamDutyPlan?.day && (
                                <span className="mt-1 block text-sm font-bold text-violet-700">
                                  Pos 9 Satpam Regu
                                </span>
                              )}
                            </div>

                            {/* Guard Dropdown */}
                            <div className="md:col-span-5">
                              <Select
                                value={val.employeeId || 'none'}
                                onValueChange={(v: string | null) => handleSelectGuard(post.id, v === 'none' || v === null ? '' : v)}
                                disabled={isSatpamReportLocked || loadingSubmittedSatpam}
                              >
                                <SelectTrigger className="w-full text-base font-extrabold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 h-12 flex items-center justify-between">
                                  <span className={val.employeeId ? "truncate" : "truncate text-slate-400 font-normal"}>
                                    {allSatpamEmployees.find(emp => emp.id === val.employeeId)?.name || '-- Pilih Petugas --'}
                                  </span>
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white max-h-[300px] overflow-y-auto">
                                  <SelectItem value="none" className="text-base py-3 pl-3 text-slate-500 italic">
                                    -- Kosongkan Pos --
                                  </SelectItem>
                                  {post.id === 'Pos 9' ? (
                                    <SelectGroup>
                                      <SelectLabel className="text-base font-black text-violet-700 px-2 py-2 bg-violet-50/50">
                                        Tiga Pos 9 Satpam
                                      </SelectLabel>
                                      {visiblePos9Employees.map(emp => (
                                        <SelectItem key={emp.id} value={emp.id} className="text-base py-3 pl-3">
                                          {emp.name}
                                        </SelectItem>
                                      ))}
                                      <SelectSeparator className="my-1" />
                                      <SelectLabel className="text-base font-black text-slate-600 px-2 py-2 bg-slate-50">
                                        Petugas Satpam Lain (pengganti)
                                      </SelectLabel>
                                      {visibleAllSatpamEmployees
                                        .filter((employee) => !pos9GuardIds.has(employee.id))
                                        .map((emp) => (
                                          <SelectItem key={emp.id} value={emp.id} className="text-base py-3 pl-3">
                                            {emp.name} {groupEmployeeIds.includes(emp.id) ? '· Regu Anda' : '· Regu lain'}
                                          </SelectItem>
                                        ))}
                                    </SelectGroup>
                                  ) : (
                                    <>
                                      <SelectGroup>
                                        <SelectLabel className="text-base font-black text-purple-700 px-2 py-2 bg-purple-50/50">Anggota Regu Anda</SelectLabel>
                                        {visibleGroupEmployees.map(emp => (
                                          <SelectItem key={emp.id} value={emp.id} className="text-base py-3 pl-3">
                                            {emp.name} {emp.id === profile.linkedEmployeeId ? '(Anda)' : ''}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                      <SelectSeparator className="my-1" />
                                      <SelectGroup>
                                        <SelectLabel className="text-base font-black text-slate-600 px-2 py-2 bg-slate-50">Satpam Regu Lain (Substitusi — default Harian)</SelectLabel>
                                        {visibleExternalEmployees.map(emp => (
                                          <SelectItem key={emp.id} value={emp.id} className="text-base py-3 pl-3">
                                            {emp.name} {emp.isActive === false ? '· perlu verifikasi' : ''}
                                          </SelectItem>
                                        ))}
                                      </SelectGroup>
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Shift / pay type is normally derived from the work
                                calendar. Ketua Shift defaults to Harian and can
                                choose Lembur Sendiri. Any Satpam from another
                                regu defaults to Harian, with an explicit
                                Lembur Cover option.
                                The designated cross-team Pos 9 guards additionally
                                retain the Lembur Sendiri option. */}
                            <div className="md:col-span-4">
                              {satpamDutyPlan?.enabled && satpamDutyPlan.day && !isExternalGuard && !isPos9 && !isKetuaGuard ? (
                                <div className="flex min-h-12 w-full items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-base font-extrabold text-indigo-800">
                                  {plannedPayLabel}
                                </div>
                              ) : (
                              <Select
                                value={selectedShiftType}
                                onValueChange={(type: string | null) => {
                                  if (type) handleShiftTypeChange(post.id, type);
                                }}
                                disabled={isSatpamReportLocked || loadingSubmittedSatpam}
                              >
                                <SelectTrigger className="w-full h-12 text-base font-extrabold text-slate-700 bg-white border border-slate-200 rounded-lg">
                                  <SelectValue placeholder="Pilih Jenis Shift" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white">
                                  {isKetuaGuard ? (
                                    <>
                                      <SelectItem value="Harian" className="text-base font-bold">
                                        Harian (Rp12.500)
                                      </SelectItem>
                                      <SelectItem value="Lembur Sendiri" className="text-base font-bold">
                                        Lembur Sendiri (Rp30.000)
                                      </SelectItem>
                                    </>
                                  ) : isCrossTeamPos9 ? (
                                    <>
                                      <SelectItem value="Harian" className="text-base font-bold">
                                        Harian (Rp12.500)
                                      </SelectItem>
                                      <SelectItem value="Lembur Sendiri" className="text-base font-bold">Lembur Sendiri (Rp30.000)</SelectItem>
                                      <SelectItem value="Lembur Cover" className="text-base font-bold">Lembur Cover (Rp50.000)</SelectItem>
                                    </>
                                  ) : isDesignatedPos9 ? (
                                    <>
                                      <SelectItem value="Harian" className="text-base font-bold">
                                        Harian (Rp12.500)
                                      </SelectItem>
                                      {defaultShiftTypeForRender === 'Jumat & Libur' && (
                                        <SelectItem value="Jumat & Libur" className="text-base font-bold">
                                          Jumat &amp; Libur (Rp25.000)
                                        </SelectItem>
                                      )}
                                      <SelectItem value="Lembur Sendiri" className="text-base font-bold">
                                        Lembur Sendiri (Rp30.000)
                                      </SelectItem>
                                    </>
                                  ) : isExternalGuard ? (
                                    <>
                                      <SelectItem value="Harian" className="text-base font-bold">
                                        Harian (Rp12.500)
                                      </SelectItem>
                                      <SelectItem value="Lembur Cover" className="text-base font-bold">Lembur Cover (Rp50.000)</SelectItem>
                                    </>
                                  ) : (
                                    <SelectItem value={defaultShiftTypeForRender} className="text-base font-bold">
                                      {defaultShiftTypeForRender} ({defaultShiftTypeForRender === 'Jumat & Libur' ? 'Rp25.000' : 'Rp12.500'})
                                    </SelectItem>
                                  )}
                                  {!isCrossTeamPos9 && !isExternalGuard && !isPos9 && (
                                    <SelectItem value="Lembur Cover" className="text-base font-bold">
                                      Lembur Cover (Rp50.000)
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                              )}
                            </div>
                            {val.shiftType === 'Lembur Cover' && (
                              <div className="md:col-span-12">
                                <Select
                                  value={val.coveredEmployeeId || 'none'}
                                  onValueChange={(value: string | null) =>
                                    handleCoverDetail(post.id, 'coveredEmployeeId', value === 'none' || value === null ? '' : value)}
                                  disabled={isSatpamReportLocked || loadingSubmittedSatpam}
                                >
                                  <SelectTrigger className="w-full h-12 rounded-lg bg-amber-50 border-amber-200 text-base font-bold">
                                    <span>
                                      {groupEmployees.find(emp => emp.id === val.coveredEmployeeId)?.name ||
                                        '-- Pilih anggota yang digantikan --'}
                                    </span>
                                  </SelectTrigger>
                                  <SelectContent className="w-[var(--radix-select-trigger-width)] min-w-[240px] rounded-xl border border-slate-100 shadow-xl bg-white p-1 z-50">
                                    <SelectItem value="none">-- Pilih anggota --</SelectItem>
                                    {coverCandidates.map(emp => (
                                        <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                            {/* Guard-post proof photo; use the native Android photo/files source picker. */}
                            <div className="md:col-span-12">
                              <input
                                type="file"
                                accept="image/*"
                                ref={el => { postPhotoInputRefs.current[post.id] = el; }}
                                onChange={event => {
                                  const file = event.target.files?.[0];
                                  if (file) handleUploadPostPhoto(post.id, file);
                                  event.target.value = '';
                                }}
                                className="hidden"
                              />
                              {val.photoUrl ? (
                                <div className="flex items-center justify-between gap-2 p-2 bg-blue-50/80 border border-blue-200 rounded-xl text-base">
                                  <div className="flex items-center gap-1.5 truncate font-bold text-blue-800">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                    <span className="truncate">Foto bukti {post.id} terunggah</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setSatpamPreviewPhoto({ url: val.photoUrl!, title: `${post.id} — ${post.name}` })}
                                      className="min-h-12 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-base flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                                    >
                                      <Eye className="w-3 h-3" /> Lihat Foto
                                    </button>
                                    {!isSatpamReportLocked && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemovePostPhoto(post.id)}
                                        className="h-12 w-12 flex items-center justify-center hover:bg-rose-100 text-rose-600 rounded-lg transition-colors cursor-pointer"
                                        title="Hapus Foto Ini"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                !isSatpamReportLocked && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    disabled={postPhotoUploading[post.id] || loadingSubmittedSatpam}
                                    onClick={() => postPhotoInputRefs.current[post.id]?.click()}
                                    className="w-full h-12 rounded-lg border-dashed border-slate-300 bg-slate-50/60 hover:bg-slate-100 text-base font-bold text-slate-700 gap-2"
                                  >
                                    {postPhotoUploading[post.id] ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Camera className="w-3.5 h-3.5 text-slate-500" />
                                    )}
                                    <span>{postPhotoUploading[post.id] ? 'Mengunggah...' : 'Upload Foto'}</span>
                                  </Button>
                                )
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {!isExtraPostVisible ? (
                        !isSatpamReportLocked && (
                          <div
                            onClick={() => setIsExtraPostVisible(true)}
                            className="flex items-center justify-center bg-slate-50/50 hover:bg-slate-50 p-4 rounded-xl border border-dashed border-slate-300 hover:border-slate-400 hover:shadow-sm transition-all cursor-pointer h-[66px] animate-in fade-in duration-200"
                          >
                            <span className="text-base font-extrabold text-indigo-600 hover:text-indigo-700 flex items-center gap-2">
                              <Plus className="w-4.5 h-4.5" /> Tambah Petugas
                            </span>
                          </div>
                        )
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center bg-white p-3 rounded-xl border border-slate-200 hover:shadow-sm transition-shadow animate-in fade-in slide-in-from-top-2 duration-300">
                          {/* Pilih Pos Dropdown */}
                          <div className="md:col-span-3">
                            <Select
                              value={extraPostName || 'none'}
                              onValueChange={(v: string | null) => setExtraPostName(v === 'none' || v === null ? '' : v)}
                              disabled={isSatpamReportLocked || loadingSubmittedSatpam}
                            >
                              <SelectTrigger className="w-full text-base font-extrabold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 h-12 flex items-center justify-between">
                                <span className={extraPostName ? "truncate" : "truncate text-slate-400 font-normal"}>
                                  {POSTS_CONFIG.find(p => p.id === extraPostName || p.name === extraPostName)?.name || '-- Pilih Pos --'}
                                </span>
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white">
                                <SelectItem value="none" className="text-base py-3 pl-3 text-slate-500 italic">
                                  -- Pilih Pos --
                                </SelectItem>
                                {POSTS_CONFIG.map((post) => (
                                  <SelectItem key={post.id} value={post.id} className="text-base py-3 pl-3">
                                    {post.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Pilih Petugas Dropdown */}
                          <div className="md:col-span-5">
                            <Select
                              value={extraEmployeeId || 'none'}
                              onValueChange={(v: string | null) => {
                                const empId = v === 'none' || v === null ? '' : v;
                                setExtraEmployeeId(empId);
                                if (empId) {
                                  setExtraShiftType('Lembur Sendiri');
                                }
                              }}
                              disabled={isSatpamReportLocked || loadingSubmittedSatpam}
                            >
                              <SelectTrigger className="w-full text-base font-extrabold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 h-12 flex items-center justify-between">
                                <span className={extraEmployeeId ? "truncate" : "truncate text-slate-400 font-normal"}>
                                  {allSatpamEmployees.find(emp => emp.id === extraEmployeeId)?.name || '-- Pilih Petugas --'}
                                </span>
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white max-h-[300px] overflow-y-auto">
                                <SelectItem value="none" className="text-base py-3 pl-3 text-slate-500 italic">
                                  -- Kosongkan Pos --
                                </SelectItem>
                                <SelectGroup>
                                  <SelectLabel className="text-base font-black text-purple-700 px-2 py-2 bg-purple-50/50">Anggota Regu Anda</SelectLabel>
                                  {visibleGroupEmployees
                                    .filter(emp =>
                                      !satpamDutyPlan?.day ||
                                      emp.id === satpamDutyPlan.day.offDutyEmployeeId,
                                    )
                                    .map(emp => (
                                    <SelectItem key={emp.id} value={emp.id} className="text-base py-3 pl-3">
                                      {emp.name} {emp.id === profile.linkedEmployeeId ? '(Anda)' : ''} {emp.isActive === false ? '· perlu verifikasi' : ''}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Fixed overtime type */}
                          <div className="md:col-span-3">
                            <div className="w-full text-base font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 h-12 flex items-center">
                              Lembur Sendiri (Rp30.000)
                            </div>
                          </div>

                          {/* Cancel/Remove Button */}
                          <div className="md:col-span-1 flex justify-center">
                            {!isSatpamReportLocked && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setIsExtraPostVisible(false);
                                  setExtraPostName('');
                                  setExtraEmployeeId('');
                                  setExtraShiftType('Lembur Sendiri');
                                  setExtraOvertimeReason('');
                                  setExtraPhotoUrl('');
                                  setExtraPhotoAuditMetadata(undefined);
                                }}
                                className="h-12 w-12 p-0 text-slate-400 hover:text-red-500 transition-colors"
                              >
                                <X className="w-5 h-5" />
                              </Button>
                            )}
                          </div>

                          <div className="md:col-span-12">
                            <input
                              type="file"
                              accept="image/*"
                              ref={el => { postPhotoInputRefs.current['extra'] = el; }}
                              onChange={event => {
                                const file = event.target.files?.[0];
                                if (file) handleUploadPostPhoto('extra', file);
                                event.target.value = '';
                              }}
                              className="hidden"
                            />
                            {extraPhotoUrl ? (
                              <div className="flex items-center justify-between gap-2 p-2 bg-indigo-50 border border-indigo-200 rounded-xl text-base">
                                <div className="flex items-center gap-1.5 truncate font-bold text-indigo-800">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                  <span className="truncate">Foto bukti Lembur Sendiri terunggah</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setSatpamPreviewPhoto({ url: extraPhotoUrl, title: 'Lembur Sendiri' })}
                                    className="min-h-12 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-base flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                                  >
                                    <Eye className="w-3 h-3" /> Lihat Foto
                                  </button>
                                  {!isSatpamReportLocked && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemovePostPhoto('extra')}
                                      className="h-12 w-12 flex items-center justify-center hover:bg-rose-100 text-rose-600 rounded-lg transition-colors cursor-pointer"
                                      title="Hapus Foto Ini"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              !isSatpamReportLocked && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={postPhotoUploading['extra'] || loadingSubmittedSatpam}
                                  onClick={() => postPhotoInputRefs.current['extra']?.click()}
                                  className="w-full h-12 rounded-lg border-dashed border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 text-base font-bold text-indigo-700 gap-2"
                                >
                                  {postPhotoUploading['extra'] ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Camera className="w-3.5 h-3.5" />
                                  )}
                                  <span>{postPhotoUploading['extra'] ? 'Mengunggah...' : 'Upload Foto'}</span>
                                </Button>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Plain-language summary */}
                  <div className="p-4 rounded-xl bg-purple-50/50 border border-purple-100 text-base font-medium space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-purple-800">Ringkasan sebelum dikirim</span>
                      <Badge variant="outline" className="bg-white border-purple-200 text-purple-800">
                        {assignedEmployeeIds.length} penugasan
                      </Badge>
                    </div>
                    {offDutyMembers.length === 0 ? (
                      <p className="text-slate-600">Semua anggota regu tercantum dalam laporan.</p>
                    ) : (
                      <p className="text-slate-600">
                        Belum tercantum: {offDutyMembers.map((employee) => employee.name).join(', ')}.
                      </p>
                    )}
                  </div>

                  {(satpamFormWarnings.length > 0 || satpamAnomalies.length > 0) && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-950">
                      <div className="flex items-start gap-2 font-bold">
                        <AlertCircle className="mt-0.5 w-5 h-5 shrink-0" />
                        <span>Laporan tetap boleh dikirim. Auditor akan memeriksa catatan berikut:</span>
                      </div>
                      <ul className="mt-2 pl-5 list-disc space-y-1.5">
                        {(satpamFormWarnings.length > 0
                          ? satpamFormWarnings
                          : satpamAnomalies.map((anomaly) => anomaly.message)
                        ).map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  )}

                  {isSatpamReportSubmitted && (
                    <div className={`rounded-xl border p-4 text-base ${
                      isSatpamReportLocked
                        ? 'border-blue-300 bg-blue-50 text-blue-950'
                        : 'border-emerald-300 bg-emerald-50 text-emerald-950'
                    }`}>
                      <p className="font-bold">
                        Status: {
                          satpamReviewStatus === 'approved'
                            ? 'Disetujui'
                            : satpamReviewStatus === 'partially_approved'
                              ? 'Disetujui Sebagian'
                            : satpamReviewStatus === 'declined'
                              ? 'Ditolak'
                              : isSatpamReportLocked
                                ? 'Sedang Diperiksa'
                                : 'Menunggu Auditor'
                        }
                      </p>
                      <p className="mt-1">
                        {isSatpamReportLocked
                          ? 'Auditor sudah menangani laporan ini. Perubahan berikutnya dilakukan oleh auditor.'
                          : 'Anda masih dapat mengubah laporan ini sampai auditor mulai menanganinya.'}
                      </p>
                    </div>
                  )}
                  {!isSatpamReportSubmitted && satpamDraftHydrated && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-base text-slate-700">
                      <strong>Status: Draft.</strong> Perubahan tersimpan otomatis di perangkat ini sampai laporan dikirim.
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="pt-2">
                    <Button
                      type="submit"
                      disabled={satpamSubmitting || isSatpamReportLocked || loadingSubmittedSatpam}
                      className={`w-full rounded-xl font-extrabold text-base min-h-12 flex items-center justify-center gap-2 border-none shadow-md ${isSatpamReportLocked
                        ? 'bg-slate-500 hover:bg-slate-500 text-white cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-purple-100 cursor-pointer'
                        }`}
                    >
                      {satpamSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                          <span>Mengirim Laporan Regu...</span>
                        </>
                      ) : loadingSubmittedSatpam ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                          <span>Memeriksa Status Laporan...</span>
                        </>
                      ) : isSatpamReportLocked ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-white" />
                          <span>{
                            satpamReviewStatus === 'approved'
                              ? 'Laporan Disetujui'
                              : satpamReviewStatus === 'partially_approved'
                                ? 'Laporan Disetujui Sebagian'
                              : satpamReviewStatus === 'declined'
                                ? 'Laporan Ditolak'
                                : 'Sedang Diperiksa Auditor'
                          }</span>
                        </>
                      ) : isSatpamReportSubmitted ? (
                        <>
                          <Save className="w-4 h-4 text-white" />
                          <span>Simpan Perubahan</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 text-white" />
                          <span>Laporkan Shift</span>
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Driver Journeys Panel (Sopir only) ───────────────────────── */}
        {isSopir && (
          <div className="space-y-4">
            {/* Active Piket Banner & Self-Creation Button */}
            {isPiketActiveToday ? (
              <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-700 text-white rounded-2xl p-4 sm:p-5 shadow-sm space-y-3 relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider bg-white/20 px-2.5 py-0.5 rounded-full text-emerald-100 flex items-center gap-1.5 w-fit">
                      <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping" />
                      Jadwal Piket Aktif Hari Ini {activePiketStationName ? `• Stasiun: ${activePiketStationName}` : ''}
                    </span>
                    <h3 className="text-sm sm:text-base font-extrabold mt-1.5 text-white">
                      Anda Bertugas Piket Hari Ini!
                    </h3>
                    <p className="text-xs text-emerald-100/90 mt-0.5">
                      Karena jadwal piket Anda aktif hari ini, Anda dapat mengotorisasi SPJ (Surat Perintah Jalan) sendiri. Kendaraan default adalah <strong>Ndalem</strong>, tetapi Anda dapat memilih kendaraan lain bila diperlukan.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 border border-white/20 px-2.5 py-1 text-[11px] font-extrabold text-white">
                        <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                        SPJ Piket Terbuat Hari Ini: {submittedSelfPiketSpjCount} SPJ
                      </span>
                      {myClaimedJourneys.length === 0 && (
                        <span className="text-[11px] font-semibold text-emerald-100">
                          Anda dapat membuat SPJ Piket berikutnya setelah perjalanan sebelumnya selesai.
                        </span>
                      )}
                    </div>
                    {myClaimedJourneys.length > 0 && (
                      <p className="text-[11px] font-bold text-amber-200 mt-1 flex items-center gap-1.5 bg-amber-950/40 p-2.5 rounded-xl border border-amber-400/30">
                        <AlertCircle className="w-4 h-4 text-amber-300 shrink-0" />
                        Anda memiliki perjalanan aktif yang sedang berjalan. Selesaikan laporan perjalanan tersebut terlebih dahulu untuk dapat membuat SPJ Piket baru.
                      </p>
                    )}
                  </div>

                  <Button
                    disabled={myClaimedJourneys.length > 0}
                    onClick={openSelfPiketSpjModal}
                    className="shrink-0 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 font-extrabold text-xs h-10 px-4 gap-2 cursor-pointer shadow-md border-none disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4 text-emerald-700" />
                    Buat SPJ Piket
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-slate-100 border border-slate-200 text-slate-700 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>
                    {myClaimedJourneys.length > 0
                      ? `Anda memiliki ${myClaimedJourneys.length} perjalanan aktif. Selesaikan laporan perjalanan Anda di bawah ini.`
                      : 'Pembuatan SPJ mandiri hanya aktif pada hari jadwal piket Anda.'}
                  </span>
                </div>
              </div>
            )}

            {/* 1. Bucket Top: Horizontal Carousel for Assigned Tasks */}
            {myAssignedJourneys.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between pl-1">
                  <h3 className="text-xs font-bold text-purple-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Target className="w-4 h-4 text-purple-600" />
                    Tugas Penugasan Khusus Anda ({myAssignedJourneys.length})
                  </h3>
                  <span className="text-[10px] font-extrabold text-purple-700 bg-purple-100/80 border border-purple-200 px-2 py-0.5 rounded-full">
                    Jadwal Mendatang
                  </span>
                </div>

                <div className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none gap-3 pb-2 pt-1 -mx-1 px-1">
                  {myAssignedJourneys.map((j) => (
                    <Card key={j.id} className="min-w-[280px] sm:min-w-[320px] max-w-[340px] snap-start shrink-0 bg-gradient-to-br from-purple-900 via-indigo-900 to-slate-900 text-white rounded-2xl shadow-md border-none overflow-hidden relative flex flex-col justify-between">
                      <div className="absolute top-0 right-0 w-28 h-28 rounded-full bg-purple-500/10 -translate-y-4 translate-x-4 blur-md pointer-events-none" />
                      <CardContent className="p-4 space-y-3 relative z-10 flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold tracking-wider text-purple-200 uppercase bg-purple-500/40 border border-purple-400/30 px-2 py-0.5 rounded-md">
                              Ditugaskan Khusus
                            </span>
                            {j.activityDate && (
                              <span className="text-[10px] font-bold text-purple-200 bg-white/10 px-2 py-0.5 rounded-md">
                                {new Date(j.activityDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm font-bold mt-2 text-white leading-snug">
                            {j.activityName}
                          </h4>
                        </div>

                        <div className="p-2.5 rounded-xl bg-white/10 text-white text-xs font-medium space-y-1 mt-2">
                          <div className="flex items-center gap-1.5 text-purple-100">
                            <MapPin className="w-4 h-4 text-purple-300 shrink-0" />
                            <span className="font-semibold text-white/95">Tujuan:</span>
                            <span className="truncate flex-1 font-extrabold text-white" title={j.endPoint}>{j.endPoint}</span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-white/10 text-[10px] text-purple-200">
                            <span>Kendaraan: <strong>{j.vehicleName}</strong></span>
                            <span>Operasional: <strong>{fmtRp(j.totalOperationalCost)}</strong></span>
                          </div>
                          {(() => {
                            const est = calculateEstimatedDriverWage(j.distanceKm * 2, (j.durationHours || 0) * 2);
                            const baseWage = j.estimatedBaseDriverWage || est.baseWage;
                            const maxWage = j.estimatedMaxDriverWage || est.maxWage;
                            return (
                              <div className="pt-1 border-t border-white/10 text-[10px] text-purple-200 flex justify-between items-center">
                                <span>Estimasi Upah:</span>
                                <span className="font-black text-amber-300">{fmtRp(baseWage)} - {fmtRp(maxWage)}</span>
                              </div>
                            );
                          })()}
                        </div>

                        <Button
                          disabled={myClaimedJourneys.length > 0 || isClaiming}
                          onClick={() => handleStartAssignedJourney(j.id)}
                          className="w-full mt-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white font-extrabold text-xs h-9 gap-1.5 cursor-pointer shadow-sm border-none disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isClaiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          Mulai Perjalanan Tugas
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Bucket Middle: Active claimed journeys */}
            {myClaimedJourneys.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wider pl-1">
                  Perjalanan Aktif Anda
                </h3>
                {myClaimedJourneys.map((j) => {
                  const est = calculateEstimatedDriverWage(j.distanceKm * 2, (j.durationHours || 0) * 2);
                  const baseWage = j.estimatedBaseDriverWage || est.baseWage;
                  const maxWage = j.estimatedMaxDriverWage || est.maxWage;

                  return (
                    <div key={j.id} className="bg-white rounded-2xl border-2 border-indigo-200 shadow-xs overflow-hidden p-4 sm:p-5 space-y-3.5">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black tracking-wider text-emerald-700 uppercase bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            Dalam Perjalanan
                          </span>
                          <span className="text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                            {j.vehicleName} ({fmtRp(getEffectiveVehicleRate(j.vehicleName, j.vehicleRate))}/km)
                          </span>
                        </div>
                        <h4 className="text-base sm:text-lg font-extrabold mt-2.5 text-slate-900 leading-snug">
                          {j.activityName}
                        </h4>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200/80 p-2.5 rounded-xl">
                        <MapPin className="w-4 h-4 text-indigo-600 shrink-0" />
                        <span className="font-bold text-slate-500">Tujuan utama:</span>
                        <span className="truncate flex-1 font-extrabold text-slate-800" title={j.endPoint}>{j.endPoint}</span>
                      </div>

                      {/* 2-Column Cards Grid: Left = Biaya Operasional, Right = Estimasi Upah Sopir */}
                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        <div className="bg-indigo-50/70 border border-indigo-100 p-3.5 rounded-xl space-y-0.5">
                          <span className="block text-[9px] font-black text-indigo-600 uppercase tracking-wider">Biaya Operasional</span>
                          <span className="text-xs sm:text-sm font-black text-indigo-900 block">{fmtRp(j.totalOperationalCost)}</span>
                        </div>
                        <div className="bg-emerald-50/70 border border-emerald-100 p-3.5 rounded-xl space-y-0.5">
                          <span className="block text-[9px] font-black text-emerald-600 uppercase tracking-wider">Estimasi Upah Sopir</span>
                          <span className="text-xs sm:text-sm font-black text-emerald-900 block">{fmtRp(baseWage)} - {fmtRp(maxWage)}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-1 border-t border-slate-100">
                        <Button
                          onClick={() => {
                            if (typeof window !== 'undefined') {
                              sessionStorage.removeItem('cancelled_driver_journey_id');
                            }
                            router.push(`/employee/activities/journey-report?id=${j.id}`);
                          }}
                          className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs sm:text-sm h-10.5 gap-2 cursor-pointer shadow-md shadow-indigo-100 transition-all border-none"
                        >
                          <CheckCircle2 className="w-4.5 h-4.5" />
                          Laporan Perjalanan
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => handleCancelJourney(j.id)}
                          className="w-full rounded-xl bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 font-bold text-xs h-9 gap-1.5 cursor-pointer transition-all"
                        >
                          <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                          Batalkan Klaim Perjalanan
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 3. Bucket Bottom: Open / Unassigned Journeys Pool */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center gap-1.5">
                <Compass className="w-4.5 h-4.5 text-slate-400" />
                Pemesanan Perjalanan Terbuka (Pool)
              </h3>
              {loadingJourneys ? (
                <div className="p-6 text-center text-slate-400 bg-white border border-slate-100 rounded-2xl flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                  <span className="text-xs font-medium">Memuat perjalanan terbuka...</span>
                </div>
              ) : unassignedJourneys.length === 0 ? (
                <div className="p-6 text-center text-slate-400 bg-white/50 border border-dashed border-slate-200 rounded-2xl">
                  <span className="text-xs font-medium">Belum ada perjalanan dinas terbuka di pool umum.</span>
                </div>
              ) : (
                <div>
                  {myClaimedJourneys.length > 0 && (
                    <div className="p-3.5 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl font-bold flex items-center gap-2 mb-3">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Anda memiliki perjalanan aktif. Selesaikan atau laporkan terlebih dahulu sebelum mengambil perjalanan baru.</span>
                    </div>
                  )}
                  {unassignedJourneys.map((j) => (
                    <div key={j.id} className="pt-6 pb-8 border-b-2 border-slate-300/80 space-y-3.5 first:pt-2">
                      <div className="rounded-2xl overflow-hidden shadow-xs border border-slate-200/60">
                        <DestinationImageBanner destination={j.endPoint} cachedUrl={j.destinationImageUrl} />
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-md">
                              Pool Umum
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {j.activityDate && (
                              <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md">
                                {new Date(j.activityDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            )}
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-md">
                              {j.vehicleName} ({fmtRp(getEffectiveVehicleRate(j.vehicleName, j.vehicleRate))}/km)
                            </span>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-xs sm:text-sm font-extrabold text-slate-800 leading-snug">{j.activityName}</h4>
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-500 font-semibold">
                            <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            <span className="truncate flex-1 font-extrabold text-slate-700" title={j.endPoint}>{j.endPoint}</span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-2.5 border-t border-slate-200/60">
                          <div className="flex gap-4">
                            <div>
                              <span className="block text-[8px] text-slate-400 font-extrabold uppercase leading-tight">Biaya Operasional</span>
                              <span className="text-xs font-black text-indigo-600">{fmtRp(j.totalOperationalCost)}</span>
                            </div>
                            {(() => {
                              const est = calculateEstimatedDriverWage(j.distanceKm * 2, (j.durationHours || 0) * 2);
                              const baseWage = j.estimatedBaseDriverWage || est.baseWage;
                              const maxWage = j.estimatedMaxDriverWage || est.maxWage;
                              return (
                                <div>
                                  <span className="block text-[8px] text-slate-400 font-extrabold uppercase leading-tight">Upah Bersih</span>
                                  <span className="text-xs font-black text-emerald-600">{fmtRp(baseWage)} - {fmtRp(maxWage)}</span>
                                </div>
                              );
                            })()}
                          </div>

                          <Button
                            disabled={myClaimedJourneys.length > 0}
                            onClick={() => handleClaimJourney(j.id)}
                            className="rounded-lg bg-indigo-50 hover:bg-indigo-600 border border-indigo-100 hover:border-indigo-600 text-indigo-700 hover:text-white font-extrabold !text-[9px] sm:!text-[12px] !leading-tight !h-auto py-1 px-2 sm:py-1.5 sm:px-3 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-100 disabled:cursor-not-allowed whitespace-normal text-center"
                          >
                            Ambil<br />Perjalanan
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {isSopir ? null : (
          <>
            {/* ── Stats Summary ────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="bg-white rounded-2xl shadow-sm border-none">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-extrabold text-teal-600">{stats.approved + stats.pending + stats.declined}</div>
                  <div className="text-[11px] font-semibold text-slate-400 mt-0.5">Total Kegiatan</div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-teal-500 to-cyan-600 rounded-2xl shadow-lg shadow-teal-200/40 border-none">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-extrabold text-white">{fmtRp(stats.totalApprovedFee)}</div>
                  <div className="text-[11px] font-semibold text-teal-100 mt-0.5">
                    {userJobCategory === 'SATPAM' ? 'Total Pekerjaan Disetujui' : 'Total SPJ Disetujui'}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── Mini Stats Row ──────────────────────────────────────────── */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStatusFilter('all')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'all'
                  ? 'bg-slate-800 text-white shadow-md'
                  : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                  }`}
              >
                Semua ({activities.length})
              </button>
              <button
                onClick={() => setStatusFilter('pending')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'pending'
                  ? 'bg-amber-500 text-white shadow-md'
                  : 'bg-white text-amber-600 border border-amber-200 hover:bg-amber-50'
                  }`}
              >
                Menunggu ({stats.pending})
              </button>
              <button
                onClick={() => setStatusFilter('approved')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'approved'
                  ? 'bg-emerald-500 text-white shadow-md'
                  : 'bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50'
                  }`}
              >
                Disetujui ({stats.approved})
              </button>
              <button
                onClick={() => setStatusFilter('declined')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${statusFilter === 'declined'
                  ? 'bg-rose-500 text-white shadow-md'
                  : 'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50'
                  }`}
              >
                Ditolak ({stats.declined})
              </button>
            </div>

            {/* ── Activity List ────────────────────────────────────────────── */}
            {loading ? (
              <div className="py-16 flex flex-col items-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-teal-500 mb-3" />
                <span className="text-sm font-medium animate-pulse">Memuat kegiatan...</span>
              </div>
            ) : filteredActivities.length === 0 ? (
              <Card className="bg-white rounded-2xl shadow-sm border-none">
                <CardContent className="py-16 flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
                    <ClipboardList className="w-8 h-8 text-slate-300" />
                  </div>
                  <h3 className="text-base font-bold text-slate-700">Belum Ada Kegiatan</h3>
                  <p className="text-xs text-slate-400 max-w-xs mt-1.5 leading-relaxed">
                    {statusFilter !== 'all'
                      ? `Tidak ada kegiatan berstatus "${getStatusConfig(statusFilter).label}" pada periode ini.`
                      : userJobCategory === 'SATPAM'
                        ? 'Gunakan tombol “Lapor SPJ Pribadi” di atas untuk menambahkan kegiatan.'
                        : 'Tekan tombol “Tambah Kegiatan” untuk membuat laporan baru.'
                    }
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2.5">
                {filteredActivities.map((activity) => {
                  const sc = getStatusConfig(activity.status);
                  const StatusIcon = sc.icon;
                  const isExpanded = expandedId === activity.id;
                  const canEdit = activity.status === 'declined' || activity.status === 'pending';

                  return (
                    <Card
                      key={activity.id}
                      className={`bg-white rounded-2xl shadow-sm border-none overflow-hidden transition-all duration-200 ${isExpanded ? 'ring-2 ring-teal-200/60' : ''
                        }`}
                    >
                      <CardContent className="p-0">
                        {/* Main row — tap to expand */}
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : activity.id)}
                          className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50/50 transition-colors"
                        >
                          {/* Status dot */}
                          <div className={`w-2.5 h-2.5 rounded-full ${sc.dotClass} shrink-0`} />

                          {/* Activity info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-bold text-slate-800">{activity.activityName}</div>
                              {activity.reportKind === 'satpam_found_item' && (
                                <Badge className="shrink-0 border-none bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                                  Penemuan Barang
                                </Badge>
                              )}
                              {activity.reportKind === 'satpam_reprimand' && (
                                <Badge className="shrink-0 border-none bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                                  Teguran Pengendara
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-slate-400 font-medium">{activity.activityDate}</span>
                              <span className="text-[11px] text-slate-300">•</span>
                              <span className="text-[11px] text-slate-400 font-medium">
                                {activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand'
                                  ? `${activity.proofPhotos?.length || (activity.photoUrl ? 1 : 0)} foto`
                                  : activity.activityType === 'Buang Sampah' || activity.activityName === 'Buang Sampah'
                                  ? activity.timeStart
                                  : `${activity.timeStart} – ${activity.timeEnd}`}
                              </span>
                            </div>
                          </div>

                          {/* Status badge */}
                          <Badge className={`${sc.bgClass} ${sc.textClass} border ${sc.borderClass} text-[10px] font-bold rounded-lg px-2 py-0.5 shrink-0`}>
                            {sc.label}
                          </Badge>

                          {/* Chevron */}
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4 text-slate-300 shrink-0" />
                            : <ChevronDown className="w-4 h-4 text-slate-300 shrink-0" />
                          }
                        </button>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 border-t border-slate-50 space-y-3 animate-in slide-in-from-top-2 duration-200">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Tanggal</span>
                                <p className="text-sm font-semibold text-slate-700 mt-0.5">{activity.activityDate}</p>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">
                                  {activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand' ? 'Bukti' : 'Waktu'}
                                </span>
                                <p className="text-sm font-semibold text-slate-700 mt-0.5">
                                  {activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand'
                                    ? `${activity.proofPhotos?.length || (activity.photoUrl ? 1 : 0)} foto`
                                    : activity.activityType === 'Buang Sampah' || activity.activityName === 'Buang Sampah'
                                    ? activity.timeStart
                                    : `${activity.timeStart} – ${activity.timeEnd}`}
                                </p>
                              </div>
                            </div>

                            {(activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand') && (
                              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-amber-950">
                                  <PackageSearch className="h-4 w-4" />
                                  {activity.reportKind === 'satpam_reprimand' ? 'Foto Bukti Teguran' : 'Foto Barang Temuan'}
                                </div>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                  {(activity.proofPhotos?.length
                                    ? activity.proofPhotos
                                    : activity.photoUrl
                                      ? [{ url: activity.photoUrl }]
                                      : []
                                  ).map((photo, index) => (
                                    <div key={photo.url} className="aspect-square overflow-hidden rounded-xl bg-slate-100">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={photo.url}
                                        alt={`Foto barang ${index + 1}`}
                                        className="h-full w-full object-cover"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Driver details section */}
                            {activity.jobCategory === 'SOPIR' && (
                              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5 text-xs text-slate-600">
                                {activity.points && activity.points.length > 0 && (
                                  <div className="space-y-0.5 pb-1.5 border-b border-slate-200/60">
                                    <span className="font-semibold text-slate-400 text-[10px] uppercase block tracking-wider">Rute Perjalanan:</span>
                                    <div className="font-bold text-slate-700 text-xs pl-0.5 leading-relaxed">
                                      {activity.points.join(' → ')}
                                    </div>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="font-semibold text-slate-400">Jenis Kendaraan:</span>
                                  <span className="font-bold text-slate-700">{activity.vehicleType || 'Mobil Kecil'}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="font-semibold text-slate-400">Tipe Perjalanan:</span>
                                  <span className="font-bold text-slate-700">{activity.tripType || 'Dalam Kota'}</span>
                                </div>
                                {activity.distanceKm && activity.distanceKm > 0 ? (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-400">Jarak / Waktu Tempuh:</span>
                                    <span className="font-bold text-slate-700">{activity.distanceKm} km ({activity.durationHours || 0} jam)</span>
                                  </div>
                                ) : null}
                                <div className="flex justify-between">
                                  <span className="font-semibold text-slate-400">Jumlah Malam:</span>
                                  <span className="font-bold text-slate-700">{activity.nightCount || 0} malam</span>
                                </div>
                                {((activity.fuelFee && activity.fuelFee > 0) || (activity.tollParkingFee && activity.tollParkingFee > 0)) && (
                                  <div className="pt-1.5 border-t border-slate-200/60 mt-1.5 space-y-1">
                                    {activity.fuelFee && activity.fuelFee > 0 && (
                                      <div className="flex justify-between">
                                        <span className="font-semibold text-slate-400">Reimburse BBM:</span>
                                        <span className="font-bold text-slate-700">{fmtRp(activity.fuelFee)}</span>
                                      </div>
                                    )}
                                    {activity.tollParkingFee && activity.tollParkingFee > 0 && (
                                      <div className="flex justify-between">
                                        <span className="font-semibold text-slate-400">Reimburse Tol & Parkir:</span>
                                        <span className="font-bold text-slate-700">{fmtRp(activity.tollParkingFee)}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Satpam details section */}
                            {activity.jobCategory === 'SATPAM' && (activity.shiftName || activity.shiftType || activity.postName || activity.ketuaShiftName) && (
                              <div className="p-3 rounded-xl bg-purple-50/50 border border-purple-100/60 space-y-1.5 text-xs text-purple-950">
                                <div className="flex justify-between">
                                  <span className="font-semibold text-slate-500">Nama Petugas:</span>
                                  <span className="font-bold text-slate-800">{activity.employeeName}</span>
                                </div>
                                {activity.shiftName && (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-500">Nama Shift:</span>
                                    <span className="font-bold text-slate-800">Shift {activity.shiftName}</span>
                                  </div>
                                )}
                                {activity.shiftType && (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-500">Kategori Shift:</span>
                                    <span className="font-bold text-slate-800">{activity.shiftType}</span>
                                  </div>
                                )}
                                {activity.postName && (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-500">Lokasi Pos:</span>
                                    <span className="font-bold text-slate-800">{activity.postName}</span>
                                  </div>
                                )}
                                {activity.ketuaShiftName && (
                                  <div className="flex justify-between">
                                    <span className="font-semibold text-slate-500">Dilaporkan Oleh:</span>
                                    <span className="font-bold text-slate-800">{activity.ketuaShiftName}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {activity.status === 'approved' && activity.jobCategory === 'SATPAM' && (
                              <div className="flex flex-col gap-1 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <Banknote className="w-4 h-4 text-emerald-600" />
                                    <span className="text-sm font-bold text-emerald-700">{fmtRp(activity.fee)}</span>
                                  </div>
                                  {activity.shiftType && (
                                    <span className="text-xs text-emerald-600/70 font-bold">
                                      ({activity.shiftType === 'Off-Duty' ? 'Hari Libur' : `Tarif Shift ${activity.shiftType}`})
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}

                            {activity.status === 'approved' && activity.jobCategory !== 'SATPAM' && activity.fee > 0 && (
                              <div className="flex flex-col gap-1 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <Banknote className="w-4 h-4 text-emerald-600" />
                                    <span className="text-sm font-bold text-emerald-700">{fmtRp(activity.fee)}</span>
                                  </div>
                                  {activity.jobCategory === 'SOPIR' ? (
                                    <span className="text-xs text-emerald-600/70 font-medium">
                                      (Termasuk Biaya SPJ & Reimburse)
                                    </span>
                                  ) : (
                                    (() => {
                                      const breakdown = getActivityFeeBreakdown(activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName);
                                      return breakdown && (
                                        <span className="text-xs text-emerald-600/70 font-medium">
                                          ({breakdown}{activity.hasUangMakan ? ' + Rp7.500 Uang Makan' : ''})
                                        </span>
                                      );
                                    })()
                                  )}
                                  {activity.jobCategory !== 'SOPIR' && activity.hasUangMakan && (
                                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none text-[10px] font-bold rounded-lg px-2 py-0.5">
                                      + Uang Makan
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            )}

                            {activity.status === 'pending' && (
                              activity.jobCategory === 'SATPAM' ? (
                                <div className="flex flex-col gap-1 p-3 rounded-xl bg-amber-50 border border-amber-200">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <div className="flex items-center gap-2">
                                      <Banknote className="w-4 h-4 text-amber-600" />
                                      <span className="text-sm font-bold text-amber-700">
                                        {activity.reportKind === 'satpam_found_item' || activity.reportKind === 'satpam_reprimand'
                                          ? `Rekomendasi SPJ: ${fmtRp(activity.submittedFeeRecommendation || (activity.reportKind === 'satpam_reprimand' ? 15_000 : 5_000))}`
                                          : `Estimasi Upah: ${fmtRp(activity.fee)}`}
                                      </span>
                                    </div>
                                    {activity.shiftType ? (
                                      <span className="text-xs text-amber-600/70 font-medium">
                                        (Tarif Shift {activity.shiftType} - Menunggu Verifikasi)
                                      </span>
                                    ) : (
                                      <span className="text-xs text-amber-600/70 font-medium">
                                        (Menunggu Verifikasi)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : activity.jobCategory === 'SOPIR' ? (
                                (() => {
                                  const est = calculateSopirDefaultFee(
                                    activity.tripType,
                                    activity.vehicleType,
                                    activity.nightCount,
                                    activity.activityDate,
                                    activity.fuelFee,
                                    activity.tollParkingFee
                                  );
                                  return (
                                    <div className="flex flex-col gap-1 p-3 rounded-xl bg-amber-50 border border-amber-200">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <div className="flex items-center gap-2">
                                          <Banknote className="w-4 h-4 text-amber-600" />
                                          <span className="text-sm font-bold text-amber-700">
                                            Estimasi SPJ: {fmtRp(est)}
                                          </span>
                                        </div>
                                        <span className="text-xs text-amber-600/70 font-medium">
                                          (Menunggu persetujuan SatKer)
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })()
                              ) : (
                                (() => {
                                  const baseFee = calculateDefaultFee(activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName);

                                  // Calculate if it qualifies for Uang Makan
                                  const [sh, sm] = activity.timeStart.split(':').map(Number);
                                  const [eh, em] = activity.timeEnd.split(':').map(Number);
                                  let minutes = (eh * 60 + em) - (sh * 60 + sm);
                                  if (minutes < 0) minutes += 24 * 60;
                                  const halfHours = Math.round(minutes / 30);
                                  const qualifies = halfHours > 4 && activity.activityType !== 'Buang Sampah' && activity.activityName !== 'Buang Sampah';

                                  const totalEstimated = qualifies ? baseFee + 7500 : baseFee;
                                  const breakdown = getActivityFeeBreakdown(activity.timeStart, activity.timeEnd, activity.activityType, activity.activityName);

                                  // Format breakdown with asterisk if qualifies
                                  const breakdownStr = breakdown
                                    ? (qualifies ? `(${breakdown} + *Rp7.500*)` : `(${breakdown})`)
                                    : '';

                                  return (
                                    <div className="flex flex-col gap-1 p-3 rounded-xl bg-amber-50 border border-amber-200">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <div className="flex items-center gap-2">
                                          <Banknote className="w-4 h-4 text-amber-600" />
                                          <span className="text-sm font-bold text-amber-700">
                                            Estimasi Upah: {fmtRp(totalEstimated)}
                                          </span>
                                        </div>
                                        {breakdownStr && (
                                          <span className="text-xs text-amber-600/70 font-medium">
                                            {breakdownStr}
                                          </span>
                                        )}
                                      </div>
                                      {qualifies && (
                                        <span className="text-xs text-amber-600 font-medium ml-6">
                                          * Uang Makan jika disetujui oleh Kepala SatKer
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()
                              )
                            )}

                            {activity.status === 'declined' && activity.declineReason && (
                              <div className="p-3 rounded-xl bg-rose-50 border border-rose-100">
                                <span className="text-[10px] font-bold text-rose-400 uppercase block mb-1">Alasan Penolakan</span>
                                <p className="text-sm text-rose-700 font-medium">{activity.declineReason}</p>
                              </div>
                            )}

                            {/* Edit / Re-submit action */}
                            {canEdit &&
                              activity.reportKind !== 'satpam_shift_assignment' &&
                              !activity.sourceOccurrenceId && (
                              <Button
                                onClick={() => openEditForm(activity)}
                                variant="outline"
                                size="sm"
                                className="w-full rounded-xl border-teal-200 text-teal-600 hover:bg-teal-50 font-bold text-xs"
                              >
                                <Pencil className="w-3.5 h-3.5 mr-1.5" />
                                {activity.status === 'declined' ? 'Edit & Ajukan Ulang' : 'Edit Kegiatan'}
                              </Button>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Bottom spacer for FAB */}
        <div className="h-20" />
      </div>

      {/* ── Floating Action Button ─────────────────────────────────────── */}
      {!isSopir && (
        <button
          onClick={() => {
            if (userJobCategory === 'SATPAM') {
              setShowSatpamSpjChoice(true);
            } else {
              resetForm();
              setShowForm(true);
            }
          }}
          className="fixed bottom-6 right-6 z-40 min-w-14 h-14 px-4 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-xl shadow-teal-300/40 hover:shadow-2xl hover:shadow-teal-300/50 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center gap-2"
        >
          <Plus className="w-6 h-6" />
          <span className="font-bold">
            {userJobCategory === 'SATPAM' ? 'Lapor SPJ Pribadi' : 'Tambah Kegiatan'}
          </span>
        </button>
      )}

      {/* ── Ajukan Izin FAB (Satpam) ───────────────────────────────────── */}
      {userJobCategory === 'SATPAM' && profile.linkedEmployeeId && (
        <button
          onClick={() => setShowSatpamAbsenceForm(true)}
          className="fixed bottom-6 left-6 z-40 min-w-14 h-14 px-4 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-xl shadow-amber-300/40 hover:shadow-2xl hover:shadow-amber-300/50 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center gap-2"
        >
          <ShieldCheck className="w-6 h-6" />
          <span className="font-bold">Ajukan Izin</span>
        </button>
      )}

      {/* ── Ajukan Izin Resmi FAB (all non-Satpam Pekarya) ─────────────── */}
      {userJobCategory && userJobCategory !== 'SATPAM' && profile.linkedEmployeeId && (
        <button
          onClick={() => setShowPekaryaOfficialLeaveForm(true)}
          className="fixed bottom-6 left-6 z-40 min-w-14 h-14 px-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-xl shadow-indigo-300/40 hover:shadow-2xl hover:shadow-indigo-300/50 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center gap-2"
        >
          <ShieldCheck className="w-6 h-6" />
          <span className="font-bold">Ajukan Izin Resmi</span>
        </button>
      )}

      {/* ── Ajukan Izin Satpam ─────────────────────────────────────────── */}
      <Dialog open={showSatpamAbsenceForm} onOpenChange={setShowSatpamAbsenceForm}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] sm:max-w-lg max-w-[calc(100%-2rem)] rounded-3xl border-none bg-white p-0 shadow-2xl overflow-y-auto">
          <div className="sticky top-0 z-10 bg-gradient-to-r from-amber-500 to-orange-500 p-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl font-bold text-white">
                <ShieldCheck className="h-5 w-5" />
                Ajukan Izin Satpam
              </DialogTitle>
              <DialogDescription className="mt-1 text-base text-amber-50">
                Anda sendiri yang mengajukan alasan kepada Kepala SatKer. Bukti
                foto boleh dikosongkan.
              </DialogDescription>
            </DialogHeader>
          </div>
          {profile.linkedEmployeeId && (
            <SatpamAbsencePanel
              embedded
              employeeId={profile.linkedEmployeeId}
              openPeriods={satpamOpenPeriods}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Ajukan Izin Resmi Pekarya ──────────────────────────────────── */}
      <Dialog
        open={showPekaryaOfficialLeaveForm}
        onOpenChange={setShowPekaryaOfficialLeaveForm}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] sm:max-w-lg max-w-[calc(100%-2rem)] rounded-3xl border-none bg-white p-0 shadow-2xl overflow-y-auto">
          <div className="sticky top-0 z-10 bg-gradient-to-r from-indigo-500 to-blue-600 p-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl font-bold text-white">
                <ShieldCheck className="h-5 w-5" />
                Ajukan Izin Resmi
              </DialogTitle>
              <DialogDescription className="mt-1 text-base text-indigo-50">
                Pilih laporan scan masuk &amp; scan keluar atau izin resmi untuk
                diperiksa oleh Kepala SatKer.
              </DialogDescription>
            </DialogHeader>
          </div>
          {profile.linkedEmployeeId && (
            <PekaryaOfficialLeavePanel
              embedded
              employeeId={profile.linkedEmployeeId}
              openPeriods={satpamOpenPeriods}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Satpam personal-SPJ report type chooser ─────────────────── */}
      <Dialog open={showSatpamSpjChoice} onOpenChange={setShowSatpamSpjChoice}>
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] rounded-3xl border-none bg-white p-0 shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-teal-500 to-cyan-600 p-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl font-bold text-white">
                <Sparkles className="h-5 w-5" /> Lapor SPJ Pribadi
              </DialogTitle>
              <DialogDescription className="mt-1 text-base text-teal-50">
                Pilih jenis laporan yang ingin Anda kirim.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-3 p-5">
            <button
              type="button"
              onClick={() => {
                setShowSatpamSpjChoice(false);
                resetForm();
                setShowForm(true);
              }}
              className="flex min-h-24 w-full items-center gap-4 rounded-2xl border-2 border-teal-200 bg-teal-50 p-4 text-left transition-colors hover:bg-teal-100 active:bg-teal-100"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-teal-600 text-white">
                <ClipboardList className="h-7 w-7" />
              </span>
              <span>
                <span className="block text-lg font-black text-slate-900">Lapor Kegiatan</span>
                <span className="mt-1 block text-base leading-5 text-slate-600">
                  Kegiatan pribadi dengan waktu mulai dan selesai.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSatpamSpjChoice(false);
                setFoundItemCategory('satpam_found_item');
                setShowFoundItemForm(true);
              }}
              className="flex min-h-24 w-full items-center gap-4 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-left transition-colors hover:bg-amber-100 active:bg-amber-100"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white">
                <PackageSearch className="h-7 w-7" />
              </span>
              <span>
                <span className="block text-lg font-black text-slate-900">Laporan Lainnya</span>
                <span className="mt-1 block text-base leading-5 text-slate-600">
                  Penemuan barang atau teguran pengendara, dengan bukti foto.
                </span>
              </span>
            </button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowSatpamSpjChoice(false)}
              className="min-h-12 w-full rounded-xl text-base font-bold text-slate-600"
            >
              Batal
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Satpam found-item report ─────────────────────────────────── */}
      <Dialog open={showFoundItemForm} onOpenChange={setShowFoundItemForm}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] sm:max-w-lg max-w-[calc(100%-2rem)] rounded-3xl border-none bg-white p-0 shadow-2xl overflow-y-auto">
          <div className="sticky top-0 z-10 bg-gradient-to-r from-amber-500 to-orange-500 p-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl font-bold text-white">
                <PackageSearch className="h-5 w-5" />
                {editingActivity ? 'Edit Laporan Lainnya' : 'Laporan Lainnya'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-base text-amber-50">
                Satu laporan untuk satu kejadian. Kepala SatKer akan memeriksa foto dan nominalnya.
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={handleSubmitFoundItem} className="space-y-5 p-5">
            <div className="space-y-2">
              <Label htmlFor="foundItemCategory" className="text-base font-bold text-slate-700">
                Jenis Laporan
              </Label>
              <Select
                value={foundItemCategory}
                onValueChange={(value) =>
                  setFoundItemCategory(value as 'satpam_found_item' | 'satpam_reprimand')
                }
                disabled={Boolean(editingActivity)}
              >
                <SelectTrigger id="foundItemCategory" className="h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-base font-bold text-slate-700">
                  <SelectValue>
                    {foundItemCategory === 'satpam_reprimand'
                      ? 'Teguran Pengendara (Rp15.000)'
                      : 'Penemuan Barang (Rp5.000)'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                  <SelectItem value="satpam_found_item" className="text-base py-3">
                    Penemuan Barang (Rp5.000)
                  </SelectItem>
                  <SelectItem value="satpam_reprimand" className="text-base py-3">
                    Teguran Pengendara (Rp15.000)
                  </SelectItem>
                </SelectContent>
              </Select>
              {editingActivity && (
                <p className="text-sm text-slate-500">Jenis laporan tidak dapat diubah setelah dibuat.</p>
              )}
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-base text-amber-950">
              Rekomendasi awal kompensasi{' '}
              <strong>{foundItemCategory === 'satpam_reprimand' ? 'Rp15.000' : 'Rp5.000'}</strong>.
              Nominal akhir ditentukan saat audit.
            </div>

            <div className="space-y-2">
              <Label htmlFor="foundItemName" className="text-base font-bold text-slate-700">
                {foundItemCategory === 'satpam_reprimand' ? 'Keterangan Teguran' : 'Nama Barang'}
              </Label>
              <Input
                id="foundItemName"
                value={foundItemName}
                onChange={(event) => setFoundItemName(event.target.value)}
                placeholder={
                  foundItemCategory === 'satpam_reprimand'
                    ? 'Contoh: Motor Honda Beat, plat merah, 3 penumpang'
                    : 'Contoh: Kunci motor dengan gantungan merah'
                }
                maxLength={180}
                autoComplete="off"
                autoFocus
                required
                className="h-14 rounded-xl border-slate-300 px-4 text-base"
              />
              <p className="text-sm text-slate-500">
                {foundItemCategory === 'satpam_reprimand'
                  ? 'Buat laporan terpisah untuk setiap teguran.'
                  : 'Buat laporan terpisah jika menemukan barang lain.'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="foundItemDate" className="text-base font-bold text-slate-700">
                {foundItemCategory === 'satpam_reprimand' ? 'Tanggal Kejadian' : 'Tanggal Penemuan'}
              </Label>
              <Input
                id="foundItemDate"
                type="date"
                value={foundItemDate}
                onChange={(event) => {
                  const nextDate = event.target.value;
                  if (
                    nextDate &&
                    !satpamOpenPeriods.some(
                      (period) =>
                        nextDate >= period.startDate && nextDate <= period.endDate,
                    )
                  ) {
                    setMessage({
                      type: 'error',
                      text: 'Tanggal kejadian harus berada dalam periode payroll terbuka.',
                    });
                    return;
                  }
                  setFoundItemDate(nextDate);
                }}
                required
                className="h-14 rounded-xl border-slate-300 px-4 text-base"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-base font-bold text-slate-700">
                  {foundItemCategory === 'satpam_reprimand' ? 'Foto Bukti' : 'Foto Barang'}
                </Label>
                <Badge className="border-none bg-slate-100 text-sm font-bold text-slate-700">
                  {foundItemPhotos.length}/5 foto
                </Badge>
              </div>
              <p className="text-sm text-slate-500">Wajib minimal satu foto. Anda dapat mengunggah sampai lima sudut foto.</p>
              <input
                ref={foundItemPhotoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  void handleUploadFoundItemPhotos(Array.from(event.target.files || []));
                  event.target.value = '';
                }}
              />

              {foundItemPhotos.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {foundItemPhotos.map((photo, index) => (
                    <div
                      key={photo.url}
                      className="relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt={`Foto bukti ${index + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-xs font-bold text-white">
                        Foto {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setFoundItemPhotos((photos) =>
                            photos.filter((candidate) => candidate.url !== photo.url),
                          )
                        }
                        className="absolute bottom-2 right-2 flex h-12 w-12 items-center justify-center rounded-xl bg-white/95 text-rose-600 shadow-lg"
                        aria-label={`Hapus foto ${index + 1}`}
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {foundItemPhotos.length < 5 && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploadingFoundItemPhotos}
                  onClick={() => foundItemPhotoInputRef.current?.click()}
                  className="min-h-14 w-full gap-2 rounded-xl border-dashed border-amber-300 bg-amber-50 text-base font-bold text-amber-900"
                >
                  {uploadingFoundItemPhotos ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Images className="h-5 w-5" />
                  )}
                  {uploadingFoundItemPhotos
                    ? 'Mengunggah foto…'
                    : foundItemPhotos.length === 0
                      ? 'Upload Foto'
                      : 'Tambah Foto'}
                </Button>
              )}
            </div>

            <div className="flex gap-3 border-t border-slate-100 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={resetFoundItemForm}
                className="min-h-12 flex-1 rounded-xl text-base font-bold text-slate-600"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={
                  submitting ||
                  uploadingFoundItemPhotos ||
                  foundItemPhotos.length < 1
                }
                className="min-h-12 flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-base font-bold text-white"
              >
                {submitting ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Send className="mr-2 h-5 w-5" />
                )}
                {editingActivity ? 'Ajukan Ulang' : 'Laporkan'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Add / Edit Activity Dialog ─────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] rounded-3xl border-none shadow-2xl bg-white p-0 overflow-hidden">
          <div className="bg-gradient-to-r from-teal-500 to-cyan-600 p-5 pb-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                {editingActivity
                  ? <><Pencil className="w-4.5 h-4.5" /> Edit Kegiatan</>
                  : <><Sparkles className="w-4.5 h-4.5" /> {userJobCategory === 'SATPAM' ? 'Lapor SPJ Pribadi' : 'Lapor Kegiatan Baru'}</>
                }
              </DialogTitle>
              <DialogDescription className="text-teal-100 text-base mt-1">
                {editingActivity
                  ? 'Perbarui detail dan ajukan ulang kegiatan ini.'
                  : userJobCategory === 'SATPAM'
                    ? 'Isi kegiatan, tanggal, serta waktu mulai dan selesai. Jadwal shift tidak membatasi SPJ pribadi.'
                    : 'Masukkan detail kegiatan yang telah Anda selesaikan.'
                }
              </DialogDescription>
            </DialogHeader>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {isKebersihan ? (
              <>
                {/* Activity Type Selection */}
                <div className="space-y-1.5">
                  <Label htmlFor="activityType" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Jenis Kegiatan
                  </Label>
                  {/* Native select on mobile for bug-free scrolling/zooming */}
                  <div className="block sm:hidden">
                    <select
                      value={formActivityType}
                      onChange={(e) => {
                        const val = e.target.value as any;
                        setFormActivityType(val);
                        if (val !== 'Lainnya') {
                          setFormName(val);
                        } else {
                          setFormName(formCustomName || '');
                        }
                      }}
                      className="w-full text-base font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3 pr-10 appearance-none focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20"
                      style={{
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%2394a3b8\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")',
                        backgroundPosition: 'right 12px center',
                        backgroundSize: '16px 16px',
                        backgroundRepeat: 'no-repeat',
                      }}
                    >
                      <option value="Piket">Piket</option>
                      <option value="Standby">Standby</option>
                      <option value="Ro'an">Ro'an</option>
                      <option value="Buang Sampah">Buang Sampah</option>
                      <option value="Lainnya">Lainnya</option>
                    </select>
                  </div>

                  {/* Custom select on larger screens (tablet/desktop) */}
                  <div className="hidden sm:block">
                    <Select
                      value={formActivityType}
                      onValueChange={(val: any) => {
                        setFormActivityType(val);
                        if (val !== 'Lainnya') {
                          setFormName(val);
                        } else {
                          setFormName(formCustomName || '');
                        }
                      }}
                    >
                      <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                        <SelectItem value="Piket">Piket</SelectItem>
                        <SelectItem value="Standby">Standby</SelectItem>
                        <SelectItem value="Ro'an">Ro'an</SelectItem>
                        <SelectItem value="Buang Sampah">Buang Sampah</SelectItem>
                        <SelectItem value="Lainnya">Lainnya</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Custom Activity Name (shown only if 'Lainnya' is selected) */}
                {formActivityType === 'Lainnya' && (
                  <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
                    <Label htmlFor="activityCustomName" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Jenis Kegiatan Kustom
                    </Label>
                    <Input
                      id="activityCustomName"
                      placeholder="Contoh: Memindahkan Barang"
                      value={formCustomName}
                      onChange={(e) => {
                        setFormCustomName(e.target.value);
                        setFormName(e.target.value);
                      }}
                      className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                      required
                      autoFocus
                      autoComplete="off"
                    />
                  </div>
                )}
              </>
            ) : isSopir ? (
              <div className="space-y-4 animate-in fade-in duration-200">
                {/* Nama Kegiatan */}
                <div className="space-y-1.5">
                  <Label htmlFor="activityNameInput" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Keperluan / Catatan Perjalanan
                  </Label>
                  <Input
                    id="activityNameInput"
                    placeholder="Contoh: Mengantar Rektor Dinas ke Surabaya"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      setFormCustomName(e.target.value);
                    }}
                    className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                    required
                    autoFocus
                    autoComplete="off"
                  />
                </div>

                {/* Rute Perjalanan (Destinasi) */}
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                    Rute Perjalanan (Destinasi)
                  </Label>
                  <div className="space-y-2">
                    {formPoints.map((point, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 w-16 text-right select-none">
                          {idx === 0 ? 'Mulai (Pool)' : idx === formPoints.length - 1 ? 'Tujuan Akhir' : `Singgah ${idx}`}
                        </span>
                        <div className="relative flex-1">
                          <Input
                            placeholder={idx === 0 ? 'Contoh: Pool Unipdu, Jombang' : 'Nama kota/gedung/lokasi'}
                            value={point}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormPoints(prev => {
                                const copy = [...prev];
                                copy[idx] = val;
                                return copy;
                              });
                              setCalculatedDistanceKm(0);
                              setCalculatedDurationHours(0);
                              setRouteError('');
                            }}
                            className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm pr-2 h-10"
                            required
                            autoComplete="off"
                          />
                        </div>
                        {formPoints.length > 2 && idx > 0 && idx < formPoints.length - 1 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setFormPoints(prev => prev.filter((_, i) => i !== idx));
                              setCalculatedDistanceKm(0);
                              setCalculatedDurationHours(0);
                              setRouteError('');
                            }}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-rose-500 rounded-xl"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2 pt-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFormPoints(prev => {
                          const copy = [...prev];
                          copy.splice(copy.length - 1, 0, '');
                          return copy;
                        });
                        setCalculatedDistanceKm(0);
                        setCalculatedDurationHours(0);
                        setRouteError('');
                      }}
                      className="text-[11px] font-bold border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 px-3 h-8"
                    >
                      + Tambah Titik Singgah
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      disabled={isCalculatingRoute || formPoints.some(p => !p.trim())}
                      onClick={handleCalculateRoute}
                      className="text-[11px] font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl px-3 h-8 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isCalculatingRoute ? 'Menghitung...' : '✓ Cek Rute & Jarak'}
                    </Button>
                  </div>
                </div>

                {routeError && (
                  <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl font-medium">
                    ⚠️ {routeError}
                  </div>
                )}

                {calculatedDistanceKm > 0 && JSON.stringify(formPoints) === JSON.stringify(routeCalculatedPoints) && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-100 rounded-xl space-y-1.5 animate-in fade-in duration-200">
                    <div className="flex justify-between text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                      <span>Rincian Rute Terverifikasi</span>
                      <span className="text-emerald-600 font-extrabold">Terhitung</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="bg-white p-2 rounded-lg border border-slate-100 text-center">
                        <span className="block text-[9px] text-slate-400 font-bold uppercase">Jarak Tempuh</span>
                        <span className="text-sm font-extrabold text-slate-800">{calculatedDistanceKm} km</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-100 text-center">
                        <span className="block text-[9px] text-slate-400 font-bold uppercase">Estimasi Waktu</span>
                        <span className="text-sm font-extrabold text-slate-800">{calculatedDurationHours} jam</span>
                      </div>
                    </div>
                    <div className="pt-2 text-center border-t border-dashed border-slate-200">
                      <span className="text-[9px] font-bold text-slate-400 uppercase block">Estimasi Uang SPJ</span>
                      <span className="text-sm font-black text-teal-600">
                        {fmtRp(calculateSopirDefaultFee(
                          formTripType,
                          formVehicleType,
                          formNightCount,
                          formDate,
                          formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0,
                          formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0,
                          calculatedDistanceKm,
                          calculatedDurationHours
                        ))}
                      </span>
                    </div>
                  </div>
                )}

                {calculatedDistanceKm > 0 && JSON.stringify(formPoints) !== JSON.stringify(routeCalculatedPoints) && (
                  <div className="p-3 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-xl font-medium">
                    ⚠️ Rute telah diubah. Silakan klik "Cek Rute & Jarak" kembali sebelum mengirim.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {/* Tipe Perjalanan */}
                  <div className="space-y-1.5">
                    <Label htmlFor="tripType" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Tipe Perjalanan
                    </Label>
                    <Select
                      value={formTripType}
                      onValueChange={(val: any) => setFormTripType(val)}
                    >
                      <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                        <SelectItem value="Dalam Kota">Dalam Kota</SelectItem>
                        <SelectItem value="Luar Kota">Luar Kota</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Jenis Kendaraan */}
                  <div className="space-y-1.5">
                    <Label htmlFor="vehicleType" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Jenis Kendaraan
                    </Label>
                    <Select
                      value={formVehicleType}
                      onValueChange={(val: any) => setFormVehicleType(val)}
                    >
                      <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                        <SelectItem value="Mobil Kecil">Mobil Kecil</SelectItem>
                        <SelectItem value="Bus/Truk">Bus / Truk</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Toggle Lintas Hari / Menginap Above Time Controls */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-teal-50/60 border border-teal-100">
                  <div className="flex items-center gap-2">
                    <input
                      id="toggleMultiDayApp"
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
                            setFormDateEnd(getNextDayISO(formDate || new Date().toISOString().split('T')[0]));
                          }
                        }
                      }}
                      className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 cursor-pointer"
                    />
                    <Label htmlFor="toggleMultiDayApp" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                      Perjalanan Lintas Hari / Menginap
                    </Label>
                  </div>
                  <span className="text-[10px] font-semibold text-teal-700">
                    {formIsMultiDay ? 'Multi-Hari Active' : 'Hari yang sama'}
                  </span>
                </div>

                {formIsMultiDay && (
                  /* 2-Row Layout for Multi-Day / Overnight Trip */
                  <div className="space-y-3 animate-in fade-in duration-200">
                    {/* Row 1: Departure Date & Time */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="appDateStartInput" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Tanggal Berangkat
                        </Label>
                        <Input
                          id="appDateStartInput"
                          type="date"
                          value={formDate}
                          onChange={(e) => setFormDate(e.target.value)}
                          className="rounded-xl border-slate-200 focus:border-teal-400 text-xs h-9 px-2.5 bg-white"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="appTimeStartMulti" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Jam Berangkat
                        </Label>
                        <Input
                          id="appTimeStartMulti"
                          type="text"
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="JJ:MM"
                          value={formTimeStart}
                          onChange={(e) => {
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
                              setFormTimeStart(`${val.slice(0, 2)}:${val.slice(2)}`);
                            } else {
                              setFormTimeStart(val);
                            }
                          }}
                          onBlur={(e) => setFormTimeStart(padTime(e.target.value))}
                          className="rounded-xl border-slate-200 focus:border-teal-400 text-xs h-9 px-3 bg-white"
                        />
                      </div>
                    </div>

                    {/* Row 2: Arrival Date & Time */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="appDateEndInput" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Tanggal Tiba / Selesai
                        </Label>
                        <Input
                          id="appDateEndInput"
                          type="date"
                          value={formDateEnd || formDate}
                          onChange={(e) => setFormDateEnd(e.target.value)}
                          className="rounded-xl border-slate-200 focus:border-teal-400 text-xs h-9 px-2.5 bg-white"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="appTimeEndMulti" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Jam Tiba / Selesai
                        </Label>
                        <Input
                          id="appTimeEndMulti"
                          type="text"
                          inputMode="numeric"
                          maxLength={5}
                          placeholder="JJ:MM"
                          value={formTimeEnd}
                          onChange={(e) => {
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
                          }}
                          onBlur={(e) => setFormTimeEnd(padTime(e.target.value))}
                          className="rounded-xl border-slate-200 focus:border-teal-400 text-xs h-9 px-3 bg-white"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {(() => {
                  const timings = calculateJourneyDateTimeTimings({
                    dateStart: formDate,
                    timeStart: formTimeStart,
                    dateEnd: formIsMultiDay ? (formDateEnd || formDate) : formDate,
                    timeEnd: formTimeEnd,
                    isMultiDay: formIsMultiDay,
                  });
                  const effectiveNights = formIsMultiDay ? timings.nightCount : 0;
                  return (
                    <div className="text-xs font-bold text-slate-600 flex items-center gap-1.5 pt-1">
                      <span>💡 Durasi Terhitung:</span>
                      <span className="text-teal-700 font-extrabold">
                        {timings.durationHours > 0 ? timings.durationHours.toFixed(1) : '0'} Jam ({effectiveNights} Malam)
                      </span>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-3">
                  {/* Biaya BBM */}
                  <div className="space-y-1.5">
                    <Label htmlFor="fuelFee" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      BBM (Reimburse)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">Rp</span>
                      <Input
                        id="fuelFee"
                        type="text"
                        placeholder="0"
                        value={formFuelFee}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setFormFuelFee(val ? Number(val).toLocaleString('id-ID') : '');
                        }}
                        className="pl-8 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm font-semibold text-slate-700"
                      />
                    </div>
                  </div>

                  {/* Biaya Tol & Parkir */}
                  <div className="space-y-1.5">
                    <Label htmlFor="tollParkingFee" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Tol & Parkir (Reimburse)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">Rp</span>
                      <Input
                        id="tollParkingFee"
                        type="text"
                        placeholder="0"
                        value={formTollParkingFee}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setFormTollParkingFee(val ? Number(val).toLocaleString('id-ID') : '');
                        }}
                        className="pl-8 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm font-semibold text-slate-700"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Free text input for other job categories */
              <div className="space-y-2 animate-in fade-in duration-200">
                <Label htmlFor="activityNameInput" className="text-sm font-bold text-slate-600">
                  Nama Kegiatan
                </Label>
                <Input
                  id="activityNameInput"
                  placeholder="Masukkan nama kegiatan..."
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    setFormCustomName(e.target.value);
                  }}
                  className="h-12 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base"
                  required
                  autoFocus
                  autoComplete="off"
                />
              </div>
            )}

            {/* Date */}
            <div className="space-y-1.5">
              <Label htmlFor="activityDate" className="text-base font-bold text-slate-600">
                Tanggal Kegiatan
              </Label>
              <Input
                id="activityDate"
                type="date"
                value={formDate}
                onChange={(e) =>
                  userJobCategory === 'SATPAM'
                    ? setPersonalSpjDate(e.target.value)
                    : setFormDate(e.target.value)
                }
                className="h-12 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base"
                required
              />
            </div>

            {/* Time Range */}
            <div className={formActivityType === 'Buang Sampah' ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-3'}>
              <div className="space-y-1.5">
                <Label htmlFor="timeStart" className="text-base font-bold text-slate-600">
                  Waktu Mulai
                </Label>
                <div className="relative">
                  <Timer className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <Input
                    id="timeStart"
                    type={userJobCategory === 'SATPAM' ? 'time' : 'text'}
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="JJ:MM"
                    value={formTimeStart}
                    onChange={(e) => {
                      let val = e.target.value.replace(/[^0-9]/g, '');
                      if (val.length > 4) val = val.slice(0, 4);
                      if (val.length === 1 && parseInt(val, 10) > 2) {
                        val = `0${val}`;
                      }
                      if (val.length >= 2) {
                        const hours = parseInt(val.slice(0, 2), 10);
                        if (hours > 23) val = '23' + val.slice(2);
                      }
                      if (val.length === 4) {
                        const minutes = parseInt(val.slice(2, 4), 10);
                        if (minutes > 59) val = val.slice(0, 2) + '59';
                      }
                      if (val.length > 2) {
                        setFormTimeStart(`${val.slice(0, 2)}:${val.slice(2)}`);
                      } else {
                        setFormTimeStart(val);
                      }
                    }}
                    onBlur={(e) => {
                      setFormTimeStart(padTime(e.target.value));
                    }}
                    className="pl-9 h-12 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base"
                    required
                  />
                </div>
              </div>
              {formActivityType !== 'Buang Sampah' && (
                <div className="space-y-1.5">
                  <Label htmlFor="timeEnd" className="text-base font-bold text-slate-600">
                    Waktu Selesai
                  </Label>
                  <div className="relative">
                    <Timer className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <Input
                      id="timeEnd"
                      type={userJobCategory === 'SATPAM' ? 'time' : 'text'}
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="JJ:MM"
                      value={formTimeEnd}
                      onChange={(e) => {
                        let val = e.target.value.replace(/[^0-9]/g, '');
                        if (val.length > 4) val = val.slice(0, 4);
                        if (val.length === 1 && parseInt(val, 10) > 2) {
                          val = `0${val}`;
                        }
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
                      }}
                      onBlur={(e) => {
                        setFormTimeEnd(padTime(e.target.value));
                      }}
                      className="pl-9 h-12 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base"
                      required
                    />
                  </div>
                </div>
              )}
            </div>

            {supportsSpjProof && (
              <div className="space-y-1.5">
                <Label className="text-base font-bold text-slate-600">
                  Foto Bukti Kegiatan (Opsional)
                </Label>
                <input
                  ref={activityProofInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleUploadActivityProof(file);
                    event.target.value = '';
                  }}
                />
                {formProofPhoto ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/80 px-3 py-2 text-base">
                    <div className="flex min-w-0 items-center gap-1.5 font-bold text-blue-800">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                      <span className="truncate">Foto bukti kegiatan terunggah</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormProofPhoto(null)}
                      className="h-12 w-12 flex items-center justify-center rounded-lg text-rose-600 transition-colors hover:bg-rose-100"
                      title="Hapus Foto Ini"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploadingProofPhoto}
                    onClick={() => activityProofInputRef.current?.click()}
                    className="h-12 w-full gap-2 rounded-xl border-dashed border-slate-300 bg-slate-50/60 text-base font-bold text-slate-700 hover:bg-slate-100"
                  >
                    {uploadingProofPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                    <span>{uploadingProofPhoto ? 'Mengunggah Foto...' : 'Upload Foto'}</span>
                  </Button>
                )}
              </div>
            )}

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={resetForm}
                className="min-h-12 flex-1 rounded-xl text-base font-bold text-slate-600 hover:bg-slate-50"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={submitting || uploadingProofPhoto || (isSopir && (calculatedDistanceKm <= 0 || JSON.stringify(formPoints) !== JSON.stringify(routeCalculatedPoints)))}
                className="min-h-12 flex-1 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-base text-white font-bold shadow-md shadow-teal-200 hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                {editingActivity ? 'Ajukan Ulang' : 'Laporkan'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Satpam Night Shift Date Confirmation Dialog ───────────────────── */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] rounded-3xl border-none shadow-2xl bg-white p-0 overflow-hidden">
          <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-5 pb-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-white animate-pulse" /> Konfirmasi Tanggal Dinas
              </DialogTitle>
              <DialogDescription className="text-amber-50 text-base mt-1">
                Harap periksa kembali tanggal dinas untuk Shift Malam Anda.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="p-5 space-y-4 text-base text-slate-600">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-start gap-2.5">
                <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-extrabold text-amber-900 text-base">Roster Shift Malam (22:00 - 08:00 WIB)</h4>
                  <p className="text-base text-amber-800 leading-relaxed mt-1">
                    Shift Malam dimulai pada tanggal yang dipilih dan berakhir keesokan paginya. Gunakan tanggal saat shift malam mulai.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tanggal Dinas Terpilih</span>
                <span className="font-black text-slate-800 text-sm">
                  {(() => {
                    if (!satpamReportDate) return '';
                    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
                    return new Date(satpamReportDate).toLocaleDateString('id-ID', options);
                  })()}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Jam Dinas Dinas</span>
                <span className="font-extrabold text-indigo-600 text-xs bg-indigo-50 px-2.5 py-1 rounded-md">
                  {(() => {
                    if (!satpamReportDate) return '';
                    const startDate = new Date(satpamReportDate);
                    const endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + 1);
                    const formatOpt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
                    const startStr = startDate.toLocaleDateString('id-ID', formatOpt);
                    const endStr = endDate.toLocaleDateString('id-ID', formatOpt);
                    return `${startStr} (22:00) s/d ${endStr} (08:00 WIB)`;
                  })()}
                </span>
              </div>
            </div>

            <p className="text-xs font-medium text-slate-400 text-center leading-relaxed">
              Jika shift Anda dimulai pada malam **{(() => {
                if (!satpamReportDate) return '';
                const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
                return new Date(satpamReportDate).toLocaleDateString('id-ID', options);
              })()}**, silakan klik **Ya, Kirim Laporan**. Jika tidak, silakan batalkan dan sesuaikan tanggal dinas.
            </p>
          </div>

          <DialogFooter className="p-5 pt-0 border-t-0 flex flex-row items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
              className="flex-1 rounded-xl border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors h-11"
            >
              Batalkan
            </Button>
            <Button
              type="button"
              onClick={executeSubmitSatpamShift}
              className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-extrabold hover:from-amber-600 hover:to-orange-700 shadow-md shadow-orange-100 transition-colors h-11 border-none"
            >
              Ya, Kirim Laporan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>











      {/* Google Maps Selector Dialog */}
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

            {/* Selected Location Image Preview (Google Maps style) */}
            {mapAddressImage && (
              <div className="w-full h-32 rounded-xl overflow-hidden border border-slate-100 shadow-sm relative group bg-slate-50 animate-fade-in">
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
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 h-10"
              >
                Konfirmasi Lokasi
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog for self-authorizing a journey during an active piket shift. */}
      <Dialog
        open={showSelfPiketSpjModal}
        onOpenChange={(open) => {
          if (open) openSelfPiketSpjModal();
          else closeSelfPiketSpjModal();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 sm:p-7">
          <DialogHeader className="border-b border-slate-100 pb-4">
            <DialogTitle className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-2">
              <Compass className="w-5 h-5 text-emerald-600 animate-spin-slow" />
              Otorisasi SPJ Piket Mandiri
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateSelfPiketSpj} className="space-y-4 pt-2">
            {myClaimedJourneys.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs font-semibold flex items-center gap-2.5 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Anda masih memiliki tugas perjalanan aktif yang belum selesai dilaporkan. Selesaikan laporan perjalanan aktif terlebih dahulu sebelum membuat SPJ Piket baru.</span>
              </div>
            )}
            {/* Nama Kegiatan & Tanggal Perjalanan */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="selfPiketActivityName" className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Nama Kegiatan / Keperluan
                </Label>
                <Input
                  id="selfPiketActivityName"
                  placeholder="Contoh: Mengantar Gus Ufik ke Surabaya"
                  value={selfPiketActivityName}
                  onChange={(e) => setSelfPiketActivityName(e.target.value)}
                  required
                  className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-xs sm:text-sm h-10 px-3 font-semibold"
                />
              </div>

              <div className="md:col-span-1 space-y-1.5">
                <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Tanggal Perjalanan
                </Label>
                <Input
                  type="date"
                  value={getTodayDateString('Asia/Jakarta')}
                  disabled
                  className="rounded-xl border-slate-200 bg-slate-50 font-bold text-xs h-10 px-3 cursor-not-allowed"
                />
              </div>
            </div>

            {/* Titik Mulai (Origin) & Tujuan Utama (Destination) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Titik Awal
                </Label>
                {!selfPiketStartPoint ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMapTargetMode('piketStart');
                      setMapSearchText('');
                      setMapAddress('');
                      setMapAddressImage(null);
                      setShowMapSelector(true);
                    }}
                    className="w-full rounded-xl border border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/30 hover:bg-emerald-50/50 text-emerald-700 h-10 px-4 flex items-center justify-center gap-1.5 font-bold text-xs cursor-pointer transition-all"
                  >
                    <MapPin className="w-4 h-4" />
                    Pilih Titik Awal di Peta
                  </Button>
                ) : (
                  <div className="p-3 bg-emerald-50/40 border border-emerald-100 rounded-xl flex items-center justify-between gap-3 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 overflow-hidden text-xs text-emerald-950 font-semibold flex-1">
                      <MapPin className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                      <span className="truncate" title={selfPiketStartPoint}>{selfPiketStartPoint}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setMapTargetMode('piketStart');
                        setMapSearchText(selfPiketStartPoint);
                        setMapAddress(selfPiketStartPoint);
                        setMapAddressImage(null);
                        setShowMapSelector(true);
                      }}
                      className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 bg-white hover:bg-slate-50 border border-slate-200 px-2.5 h-7 rounded-lg shrink-0 cursor-pointer"
                    >
                      Ubah
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Tujuan Utama
                </Label>
                {!selfPiketEndPoint ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMapTargetMode('piketEnd');
                      setMapSearchText('');
                      setMapAddress('');
                      setMapAddressImage(null);
                      setShowMapSelector(true);
                    }}
                    className="w-full rounded-xl border border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/30 hover:bg-emerald-50/50 text-emerald-700 h-10 px-4 flex items-center justify-center gap-1.5 font-bold text-xs cursor-pointer transition-all"
                  >
                    <MapPin className="w-4 h-4" />
                    Pilih Lokasi Tujuan di Peta
                  </Button>
                ) : (
                  <div className="p-3 bg-emerald-50/40 border border-emerald-100 rounded-xl flex items-center justify-between gap-3 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 overflow-hidden text-xs text-emerald-950 font-semibold flex-1">
                      <MapPin className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                      <span className="truncate" title={selfPiketEndPoint}>{selfPiketEndPoint}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setMapTargetMode('piketEnd');
                        setMapSearchText(selfPiketEndPoint);
                        setMapAddress(selfPiketEndPoint);
                        setMapAddressImage(null);
                        setShowMapSelector(true);
                      }}
                      className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 bg-white hover:bg-slate-50 border border-slate-200 px-2.5 h-7 rounded-lg shrink-0 cursor-pointer"
                    >
                      Ubah
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Kendaraan: Ndalem remains the default, but other vehicles use the same
                operational allowance rules as a Kepala Satker authorization. */}
            <div className="space-y-1.5">
              <Label htmlFor="selfPiketVehicle" className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Jenis Kendaraan
              </Label>
              <Select
                value={selfPiketVehicleName}
                onValueChange={(value) => {
                  if (value && DRIVER_VEHICLE_NAMES.includes(value as DriverVehicleName)) {
                    setSelfPiketVehicleName(value as DriverVehicleName);
                  }
                }}
              >
                <SelectTrigger id="selfPiketVehicle" className="w-full text-xs font-extrabold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                  <SelectValue>
                    {selfPiketVehicleName === DEFAULT_DRIVER_VEHICLE_NAME
                      ? 'Ndalem — Default, tanpa BBM'
                      : `${selfPiketVehicleName} — Rp${DRIVER_VEHICLE_RATES[selfPiketVehicleName].toLocaleString('id-ID')}/km`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white text-xs">
                  {DRIVER_VEHICLE_NAMES.map((vehicleName) => (
                    <SelectItem key={vehicleName} value={vehicleName}>
                      {vehicleName === DEFAULT_DRIVER_VEHICLE_NAME
                        ? 'Ndalem — Default, tanpa BBM'
                        : `${vehicleName} — Rp${DRIVER_VEHICLE_RATES[vehicleName].toLocaleString('id-ID')}/km`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-500 font-semibold">
                Ndalem dipilih otomatis. Kendaraan lain mendapat anggaran BBM dan uang makan sesuai otorisasi Kepala SatKer.
              </p>
            </div>

            {/* Calculation Loader */}
            {selfPiketCalculating && (
              <div className="flex items-center justify-center p-3 text-xs text-emerald-700 font-bold bg-emerald-50/60 rounded-xl border border-emerald-200/60 animate-in fade-in duration-200">
                <Loader2 className="w-4 h-4 animate-spin mr-2 text-emerald-600" />
                Mengevaluasi rute & durasi Google Maps...
              </div>
            )}

            {/* Calculation Errors */}
            {selfPiketCalcError && (
              <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl font-semibold flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{selfPiketCalcError}</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    lastSelfPiketCalculatedRef.current = { start: '', end: '' };
                    setSelfPiketCalcDistance(null);
                  }}
                  className="text-[10px] font-bold bg-rose-600 hover:bg-rose-700 text-white h-7 px-2.5 rounded-lg shrink-0 cursor-pointer"
                >
                  Coba Lagi
                </Button>
              </div>
            )}

            {/* Calculation Summary Preview */}
            {selfPiketCalcDistance !== null && (
              <div className="p-4 bg-gradient-to-br from-emerald-50/80 to-teal-50/50 border border-emerald-200/80 rounded-2xl space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
                  <span className="text-[10px] font-black text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-emerald-600" />
                    Rincian Perjalanan & Estimasi Upah Sopir
                  </span>
                  <Badge className="bg-emerald-200/80 text-emerald-950 border-none text-[9px] font-black">
                    Piket Mandiri
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-slate-700 text-xs font-semibold">
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100 shadow-xs">
                    <span className="block text-[9px] text-slate-400 font-extrabold uppercase">Jarak Tempuh PP</span>
                    <span className="text-xs sm:text-sm font-black text-emerald-900">{(selfPiketCalcDistance * 2).toFixed(1)} km</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100 shadow-xs">
                    <span className="block text-[9px] text-slate-400 font-extrabold uppercase">Estimasi Waktu Tempuh PP</span>
                    <span className="text-xs sm:text-sm font-black text-emerald-900">
                      {((selfPiketCalcDuration || 0) * 2).toFixed(1)} Jam
                    </span>
                  </div>
                </div>

                {(() => {
                  const durPP = (selfPiketCalcDuration || 0) * 2;
                  const compJarak = Math.ceil(selfPiketCalcDistance * 2 * 300);
                  const compWaktu = Math.ceil(durPP * 5000);
                  const shortTripMeal = getShortTripMealWageComponent(durPP);
                  const baseWage = compJarak + compWaktu + shortTripMeal;
                  const maxWage = Math.ceil(baseWage * 1.25);

                  return (
                    <div className="bg-white p-3 rounded-xl border border-emerald-200/80 space-y-1.5 shadow-xs">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-extrabold text-slate-700">Estimasi Upah Bersih Sopir:</span>
                        <span className="text-xs sm:text-sm font-black text-emerald-700">{fmtRp(baseWage)} - {fmtRp(maxWage)}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100 font-semibold">
                        <span>
                          Komponen Jarak ({fmtRp(compJarak)}) + Komponen Waktu ({fmtRp(compWaktu)})
                          {shortTripMeal > 0 ? ` + Uang Makan (≤2 Jam: ${fmtRp(shortTripMeal)})` : ''}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {selfPiketOperationalCosts && (
                  <div className="bg-white p-3 rounded-xl border border-blue-200/80 space-y-1.5 shadow-xs">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-extrabold text-slate-700">Biaya Operasional SPJ:</span>
                      <span className="text-xs sm:text-sm font-black text-blue-700">
                        {fmtRp(selfPiketOperationalCosts.totalOperationalCost)}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100 font-semibold">
                      BBM {fmtRp(selfPiketOperationalCosts.baseOperationalCost)} + Uang makan {fmtRp(selfPiketOperationalCosts.mealAllowance)} + Tol/parkir {fmtRp(selfPiketOperationalCosts.tollParkingFee)}
                    </div>
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="pt-3 border-t border-slate-100 gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={closeSelfPiketSpjModal}
                className="rounded-xl font-bold text-slate-500 text-xs px-4 cursor-pointer hover:bg-slate-100"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={
                  creatingPiketSpj ||
                  selfPiketCalculating ||
                  !selfPiketEndPoint.trim() ||
                  selfPiketCalcDistance === null ||
                  selfPiketCalcDistance <= 0 ||
                  selfPiketCalcDuration === null ||
                  selfPiketCalcDuration <= 0 ||
                  myClaimedJourneys.length > 0
                }
                className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-xs px-6 h-10 gap-2 shadow-md shadow-emerald-200 cursor-pointer disabled:opacity-50"
              >
                {creatingPiketSpj ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Otorisasi & Mulai Perjalanan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Journey Claiming Loading Overlay ───────────────────────────── */}
      {isClaiming && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center gap-4 text-white animate-in fade-in duration-300">
          <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-8 flex flex-col items-center gap-4 max-w-sm mx-4 text-center shadow-2xl">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
            <div className="space-y-1.5">
              <h4 className="font-extrabold text-sm text-slate-100">Memproses...</h4>
              <p className="text-xs font-semibold text-slate-400">Mengkonfirmasi Penerimaan Perjalanan</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Journey Cancellation Loading Overlay ────────────────────────── */}
      {isCancelling && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center gap-4 text-white animate-in fade-in duration-300">
          <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-8 flex flex-col items-center gap-4 max-w-sm mx-4 text-center shadow-2xl">
            <Loader2 className="w-10 h-10 animate-spin text-rose-500" />
            <div className="space-y-1.5">
              <h4 className="font-extrabold text-sm text-slate-100">Memproses...</h4>
              <p className="text-xs font-semibold text-slate-400">Membatalkan Klaim Perjalanan</p>
            </div>
          </div>
        </div>
      )}

      <SwapLiburConfirmModal
        open={Boolean(pendingDailyLiburSwap)}
        prompt={pendingDailyLiburSwap}
        working={dailyLiburSwapWorking}
        error={dailyLiburSwapError}
        onSwap={() => void confirmDailyLiburSwap()}
        onCover={useDailyLemburCover}
        onCancel={cancelDailyLiburSwap}
      />

      {/* Guard-post photo preview. Metadata stays hidden here; the EXIF audit
          view belongs to the Kepala SatKer, mirroring the driver receipt flow. */}
      {satpamPreviewPhoto && (
        <ImageExifViewer
          imageUrl={satpamPreviewPhoto.url}
          title={satpamPreviewPhoto.title}
          activityDate={satpamReportDate}
          isOpen={Boolean(satpamPreviewPhoto)}
          onClose={() => setSatpamPreviewPhoto(null)}
          showMetadata={false}
        />
      )}
    </div>
  );
}

export default function EmployeeActivitiesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    }>
      <ActivitiesContent />
    </Suspense>
  );
}
