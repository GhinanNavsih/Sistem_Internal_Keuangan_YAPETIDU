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
  Upload,
} from 'lucide-react';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getTodayDateString } from '@/lib/payroll/driverPiket';
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
import { SatpamPostId } from '@/lib/payroll/domain';
import {
  calculateDriverNetWage,
  calculateJourneyElapsedHours,
  calculateNightPremium,
  calculateJourneyDateTimeTimings,
  getMealAllowanceForDuration as calculateMealAllowanceForDuration,
  getShortTripMealWageComponent,
} from '@/lib/payroll/driverJourney';
import { parseImageExif } from '@/lib/exif';
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
  shiftName?: 'Pagi' | 'Sore' | 'Malam' | string;
  shiftType?: 'Harian' | 'Jumat & Libur' | 'Lembur Sendiri' | 'Lembur Cover' | 'Off-Duty' | string;
  postName?: string;
  ketuaShiftId?: string;
  ketuaShiftName?: string;
  coveredEmployeeId?: string;
  overtimeReason?: string;
}

interface SatpamPostAssignment {
  employeeId: string;
  shiftType: string;
  coveredEmployeeId?: string;
  overtimeReason?: string;
}

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

function getTodayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getInitialSatpamDateISO(): string {
  const d = new Date();
  const hours = d.getHours();
  // If it's between midnight 00:00 and 08:30 in local time, default to yesterday
  if (hours < 8 || (hours === 8 && d.getMinutes() < 30)) {
    const yesterday = new Date(d);
    yesterday.setDate(d.getDate() - 1);
    return yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');
  }
  return getTodayISO();
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
  const { profile, logout, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editReportIdParam = searchParams.get('editReportId');
  const fuelFileInputRef = React.useRef<HTMLInputElement>(null);
  const tollFileInputRef = React.useRef<HTMLInputElement>(null);

  const userJobCategory = profile?.permittedCategories?.[0] || '';
  const isKebersihan = [
    'KEBERSIHAN',
    'KEBERSIHAN_IC',
    'KEBERSIHAN_PONTI',
    'PONTI',
  ].includes(userJobCategory);
  const isSopir = userJobCategory === 'SOPIR';
  const isKetuaShiftSatpam = (profile?.role as string) === 'ketua_shift_satpam';
  const isRegularSatpam = profile?.permittedCategories?.includes('SATPAM') && !isKetuaShiftSatpam && profile?.role !== 'honorer';

  // ── Satpam Shift Teams States ──
  const [myShiftTeam, setMyShiftTeam] = useState<any | null>(null);
  const [allSatpamEmployees, setAllSatpamEmployees] = useState<any[]>([]);
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
  const satpamRequestIdsRef = useRef<Record<string, string>>({});
  const [isExtraPostVisible, setIsExtraPostVisible] = useState(false);
  const [loadingSubmittedSatpam, setLoadingSubmittedSatpam] = useState(false);
  const [isSatpamReportSubmitted, setIsSatpamReportSubmitted] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);


  // ── Period ──
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const periodToken = useMemo(() => `${year}-${String(month).padStart(2, '0')}`, [year, month]);

  // ── Activities ──
  const [activities, setActivities] = useState<ActivityReport[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Form state ──
  const [showForm, setShowForm] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityReport | null>(null);
  const [formActivityType, setFormActivityType] = useState<'Piket' | 'Standby' | 'Ro\'an' | 'Lainnya' | 'Buang Sampah'>('Piket');
  const [formName, setFormName] = useState('Piket');
  const [formCustomName, setFormCustomName] = useState('');
  const [formDate, setFormDate] = useState(getTodayISO());
  const [formTimeStart, setFormTimeStart] = useState('');
  const [formTimeEnd, setFormTimeEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
  const [creatingPiketSpj, setCreatingPiketSpj] = useState(false);

  // Self Piket SPJ calculation states
  const [selfPiketCalcDistance, setSelfPiketCalcDistance] = useState<number | null>(null);
  const [selfPiketCalcDuration, setSelfPiketCalcDuration] = useState<number | null>(null);
  const [selfPiketCalculating, setSelfPiketCalculating] = useState(false);
  const [selfPiketCalcError, setSelfPiketCalcError] = useState('');
  const [selfPiketTollFee, setSelfPiketTollFee] = useState<string>('');
  const [mapTargetMode, setMapTargetMode] = useState<'piketStart' | 'piketEnd' | 'extra' | null>(null);
  const lastSelfPiketCalculatedRef = useRef<{ start: string; end: string }>({ start: '', end: '' });

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
      const tollFeeVal = selfPiketTollFee ? parseInt(selfPiketTollFee.replace(/\D/g, ''), 10) || 0 : 0;

      const createdJourney = await authenticatedJson<{ journeyId: string }>('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_self',
          activityName: selfPiketActivityName.trim(),
          startPoint: selfPiketStartPoint.trim(),
          endPoint: selfPiketEndPoint.trim(),
          distanceKm: selfPiketCalcDistance,
          durationHours: selfPiketCalcDuration,
          tollParkingFee: tollFeeVal,
        }),
      });

      setShowSelfPiketSpjModal(false);
      setSelfPiketActivityName('');
      setSelfPiketEndPoint('');
      setSelfPiketCalcDistance(null);
      setSelfPiketCalcDuration(null);
      setSelfPiketTollFee('');
      lastSelfPiketCalculatedRef.current = { start: '', end: '' };
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
        Number.isSafeInteger(activeReportingJourney.draftNightCount) &&
          activeReportingJourney.draftNightCount >= 0
          ? activeReportingJourney.draftNightCount
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
      await authenticatedJson('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save_draft',
          journeyId,
          draft: {
            timeStart: formTimeStart,
            timeEnd: formTimeEnd,
            nightCount: formNightCount,
            fuelFee: fuelVal,
            tollParkingFee: tollVal,
            fuelReceiptUrl: formFuelReceiptUrls.join(','),
            tollReceiptUrl: formTollReceiptUrls.join(','),
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
          employees: { id: string; name: string }[];
          regularPayType: 'Harian' | 'Jumat & Libur';
          holidayCalendarConfigured: boolean;
        }>(`/api/satpam/config?dutyDate=${encodeURIComponent(satpamReportDate)}`, {
          method: 'GET',
        });
        setMyShiftTeam(config.team);
        setAllSatpamEmployees(config.employees);
        setSatpamRegularPayType(config.regularPayType);
        setHolidayCalendarConfigured(config.holidayCalendarConfigured);
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

    // 3. Active claimed journeys for this driver
    const qMyClaimed = query(
      collection(db, 'DriverJourneys'),
      where('employeeId', '==', profile.linkedEmployeeId),
      where('status', '==', 'claimed')
    );
    const unsubMyClaimed = onSnapshot(qMyClaimed, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMyClaimedJourneys(list);
    }, (err) => {
      console.error('Error listening to claimed journeys:', err);
    });

    return () => {
      unsubUnassigned();
      unsubMyAssigned();
      unsubMyClaimed();
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
    setFormTripType('Dalam Kota');
    setFormVehicleType('Mobil Kecil');
    setFormNightCount(0);
    setFormFuelFee('');
    setFormTollParkingFee('');
    setFormFuelReceiptUrls([]);
    setFormTollReceiptUrls([]);
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
    if (calculateElapsedHours(formTimeStart, formTimeEnd, formNightCount) <= 0) {
      setMessage({ type: 'error', text: 'Jam tiba dan jumlah malam tidak membentuk durasi perjalanan yang valid.' });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      return;
    }

    try {
      const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
      const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;

      if (fuelVal > 0 && formFuelReceiptUrls.length === 0) {
        setMessage({ type: 'error', text: 'Mohon unggah bukti reimburse BBM terlebih dahulu.' });
        isSubmittingRef.current = false;
        setSubmitting(false);
        skipSaveDraftRef.current = false;
        return;
      }
      if (tollVal > 0 && formTollReceiptUrls.length === 0) {
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

      const baseCostVal = activeReportingJourney.baseOperationalCost ||
        ((activeReportingJourney.totalOperationalCost || 0) - preAuthorizedMeal - (activeReportingJourney.tollParkingFee || 0));
      const preAuthorizedToll = activeReportingJourney.tollParkingFee || 0;
      const totalPreAuthorizedAllowance = baseCostVal + preAuthorizedToll;

      const totalActualSpent = fuelVal + tollVal;

      const timings = calculateJourneyDateTimeTimings({
        dateStart: formDate,
        timeStart: formTimeStart,
        dateEnd: formIsMultiDay ? (formDateEnd || formDate) : formDate,
        timeEnd: formTimeEnd,
        isMultiDay: formIsMultiDay,
      });
      const effectiveNightCount = formIsMultiDay ? timings.nightCount : formNightCount;
      const elapsedHours = timings.durationHours > 0 ? timings.durationHours : calculateElapsedHours(
        formTimeStart,
        formTimeEnd,
        effectiveNightCount,
      );
      const actualMealAllowance = getMealAllowanceForDuration(
        elapsedHours,
        activeReportingJourney.vehicleName,
      );
      const extraMealAllowance = isNdalem ? 0 : Math.max(0, actualMealAllowance - preAuthorizedMeal);

      const extraFuelCost = isNdalem ? 0 : Math.max(0, fuelVal - baseCostVal);
      const extraTollCost = Math.max(0, tollVal - preAuthorizedToll);

      // Positive Reimburse Delta before unspent deduction
      const positiveReimburseDelta = extraMealAllowance + extraFuelCost + extraTollCost + extraOperationalCost;

      // Operational Allowance Savings / Unspent Cash
      const unspentCash = Math.max(0, totalPreAuthorizedAllowance - totalActualSpent);

      // Deductions: Step 1 (Subtract from Reimburse Delta) & Step 2 (Subtract from Upah Bersih)
      const finalReimburseDelta = Math.max(0, positiveReimburseDelta - unspentCash);
      const remainingUnspentCash = Math.max(0, unspentCash - positiveReimburseDelta);

      // Driver Base Wage & Final Net Wage
      const nightPremium = calculateNightPremium(effectiveNightCount);
      const baseDriverWage = calculateDriverNetWage(
        calculatedDistanceKm,
        calculatedDurationHours > 0 ? calculatedDurationHours : elapsedHours,
        effectiveNightCount,
      );
      const finalUpahBersih = Math.max(0, baseDriverWage - remainingUnspentCash);

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
            dateEnd: formIsMultiDay ? (formDateEnd || formDate) : formDate,
            isMultiDay: formIsMultiDay,
            fuelFee: fuelVal,
            tollParkingFee: tollVal,
            fuelReceiptUrl: formFuelReceiptUrls.join(','),
            tollReceiptUrl: formTollReceiptUrls.join(','),
            points: [activeReportingJourney.startPoint, activeReportingJourney.endPoint, ...extraLocs.map(l => l.destination)],
            distanceKm: calculatedDistanceKm,
            durationHours: calculatedDurationHours > 0 ? calculatedDurationHours : elapsedHours,
            journeyId: activeReportingJourney.id,
            extraActivities,
            extraDistanceKm,
            extraOperationalCost,
            extraFuelCost,
            extraTollCost,
            extraMealAllowance,
            actualMealAllowance,
            positiveReimburseDelta,
            baseDriverWage,
            upahBersih: finalUpahBersih,
            reimburseDelta: finalReimburseDelta,
            unspentCash,
            remainingUnspentCash,
            baseOperationalCost: baseCostVal,
            preAuthorizedMeal,
            preAuthorizedToll,
            customDurationPP: preAuthorizedDurationPP,
            totalPreAuthorizedAllowance,
            totalActualSpent,
            totalOperationalCost: activeReportingJourney.totalOperationalCost || 0,
            vehicleRate: activeReportingJourney.vehicleRate ?? 1000,
            componentJarak: calculatedDistanceKm * 300,
            componentWaktu: calculatedDurationHours * 5000,
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
    return allSatpamEmployees.filter(emp => groupEmployeeIds.includes(emp.id));
  }, [allSatpamEmployees, groupEmployeeIds]);

  const externalEmployees = useMemo(() => {
    return allSatpamEmployees.filter(emp => !groupEmployeeIds.includes(emp.id));
  }, [allSatpamEmployees, groupEmployeeIds]);

  const teamNumber = useMemo(() => {
    if (!myShiftTeam) return 1;
    return parseInt(myShiftTeam.id.split('_')[1], 10) || 1;
  }, [myShiftTeam]);

  const activeShift = useMemo(() => {
    if (!isKetuaShiftSatpam) return 'Pagi';
    return getSatpamShiftForTeam(teamNumber, satpamReportDate);
  }, [isKetuaShiftSatpam, teamNumber, satpamReportDate]);

  const satpamPendingStorageKey = useMemo(
    () =>
      profile?.linkedEmployeeId
        ? `unipdu:satpam-pending:${profile.linkedEmployeeId}:${satpamReportDate}:${activeShift}`
        : '',
    [profile?.linkedEmployeeId, satpamReportDate, activeShift],
  );

  useEffect(() => {
    if (!isKetuaShiftSatpam || !profile?.linkedEmployeeId || !satpamReportDate || !activeShift) return;

    let isMounted = true;
    setLoadingSubmittedSatpam(true);

    const q = query(
      collection(db, 'ActivityReports'),
      where('activityDate', '==', satpamReportDate),
      where('shiftName', '==', activeShift),
      where('jobCategory', '==', 'SATPAM'),
      where('ketuaShiftId', '==', profile.linkedEmployeeId)
    );

    getDocs(q).then((snap) => {
      if (!isMounted) return;

      const defaultShiftTypeForDate = getDefaultShiftTypeForDate(satpamReportDate);

      if (!snap.empty) {
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

        snap.docs.forEach((doc) => {
          const data = doc.data();
          const rawPostName = data.postName || '';

          if (rawPostName.startsWith('Tambahan:') || data.assignmentKind === 'extra') {
            foundExtra = true;
            extraEmpId = data.employeeId || '';
            extraPName = rawPostName.replace('Tambahan:', '').split(':')[0].trim();
            const matchedPost = POSTS_CONFIG.find(p => p.name === extraPName || p.id === extraPName);
            if (matchedPost) {
              extraPName = matchedPost.id;
            }
            extraSType = data.shiftType || 'Lembur Sendiri';
            extraReason = data.overtimeReason || '';
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
                  };
                }
              }
            }
          }
        });

        setPostAssignments(newAssignments);
        if (foundExtra) {
          setExtraEmployeeId(extraEmpId);
          setExtraPostName(extraPName);
          setExtraShiftType(extraSType);
          setExtraOvertimeReason(extraReason);
          setIsExtraPostVisible(true);
        } else {
          setExtraEmployeeId('');
          setExtraPostName('');
          setExtraShiftType('Lembur Sendiri');
          setExtraOvertimeReason('');
          setIsExtraPostVisible(false);
        }
        setIsSatpamReportSubmitted(true);
      } else {
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
            const pending = rawPending ? JSON.parse(rawPending) : null;
            if (
              pending?.requestId &&
              pending?.payload?.dutyDate === satpamReportDate &&
              Array.isArray(pending.payload.assignments)
            ) {
              for (const assignment of pending.payload.assignments) {
                if (!blankAssignments[assignment.postId]) continue;
                blankAssignments[assignment.postId] = {
                  employeeId: assignment.employeeId || '',
                  shiftType: assignment.coveredEmployeeId
                    ? 'Lembur Cover'
                    : defaultShiftTypeForDate,
                  coveredEmployeeId: assignment.coveredEmployeeId || '',
                  overtimeReason: assignment.overtimeReason || '',
                };
              }
              const pendingExtra = pending.payload.extraAssignment;
              setExtraEmployeeId(pendingExtra?.employeeId || '');
              setExtraPostName(pendingExtra?.postId || '');
              setExtraShiftType('Lembur Sendiri');
              setExtraOvertimeReason(pendingExtra?.overtimeReason || '');
              setIsExtraPostVisible(Boolean(pendingExtra));
              satpamRequestIdsRef.current[
                `${satpamReportDate}_${activeShift}`
              ] = pending.requestId;
              restoredPending = true;
              setMessage({
                type: 'error',
                text: 'Pengiriman sebelumnya belum terkonfirmasi. Draf lokal dipulihkan; kirim ulang dengan data yang sama.',
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
      setLoadingSubmittedSatpam(false);
    }).catch((err) => {
      console.error('Error fetching submitted Satpam reports:', err);
      if (isMounted) {
        setLoadingSubmittedSatpam(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [
    satpamReportDate,
    activeShift,
    profile?.linkedEmployeeId,
    satpamPendingStorageKey,
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

  const handleSelectGuard = (postId: string, employeeId: string) => {
    setPostAssignments(prev => {
      const isExternal = !groupEmployeeIds.includes(employeeId) && employeeId !== '';
      const defaultType = isExternal
        ? 'Lembur Cover'
        : getDefaultShiftTypeForDate(satpamReportDate);

      return {
        ...prev,
        [postId]: {
          employeeId,
          shiftType: defaultType,
          coveredEmployeeId: '',
          overtimeReason: '',
        }
      };
    });
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
        assignments: Object.entries(postAssignments).map(([postId, assignment]) => ({
          postId: postId as SatpamPostId,
          employeeId: assignment.employeeId,
          ...(assignment.shiftType === 'Lembur Cover' && {
            coveredEmployeeId: assignment.coveredEmployeeId,
            overtimeReason: assignment.overtimeReason,
          }),
        })),
        ...(isExtraPostVisible && extraEmployeeId && extraPostName && {
          extraAssignment: {
            postId: extraPostName as SatpamPostId,
            employeeId: extraEmployeeId,
            overtimeReason: extraOvertimeReason,
          },
        }),
      };
      if (satpamPendingStorageKey) {
        window.localStorage.setItem(
          satpamPendingStorageKey,
          JSON.stringify({ requestId, payload, savedAt: new Date().toISOString() }),
        );
      }

      await authenticatedJson('/api/satpam/shifts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      delete satpamRequestIdsRef.current[requestKey];
      if (satpamPendingStorageKey) {
        window.localStorage.removeItem(satpamPendingStorageKey);
      }

      setMessage({ type: 'success', text: `Berhasil mengirim laporan shift ${activeShift} tanggal ${satpamReportDate}.` });

      // Reset post selection
      const defaultShiftTypeForReset = getDefaultShiftTypeForDate(satpamReportDate);
      setPostAssignments({
        'Pos 1': { employeeId: '', shiftType: defaultShiftTypeForReset },
        'Pos 2': { employeeId: '', shiftType: defaultShiftTypeForReset },
        'Pos 3': { employeeId: '', shiftType: defaultShiftTypeForReset },
        'Pos 4': { employeeId: '', shiftType: defaultShiftTypeForReset },
        'Pos 5': { employeeId: '', shiftType: defaultShiftTypeForReset },
        'Pos 6': { employeeId: '', shiftType: defaultShiftTypeForReset },
        'Pos 7': { employeeId: '', shiftType: defaultShiftTypeForReset },
        'Pos 8': { employeeId: '', shiftType: defaultShiftTypeForReset },
        'Pos 9': { employeeId: '', shiftType: defaultShiftTypeForReset },
      });
      setExtraEmployeeId('');
      setExtraPostName('');
      setExtraShiftType('Lembur Sendiri');
      setExtraOvertimeReason('');
      setIsExtraPostVisible(false);
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
    if (!holidayCalendarConfigured) {
      setMessage({
        type: 'error',
        text: `Kalender hari libur ${satpamReportDate.slice(0, 4)} belum dikonfigurasi oleh Finance.`,
      });
      return;
    }

    // Validate that all 9 posts are assigned
    const emptyPostEntry = Object.entries(postAssignments).find(([, assignment]) => !assignment.employeeId);
    if (emptyPostEntry) {
      const [postId] = emptyPostEntry;
      const postName = POSTS_CONFIG.find(p => p.id === postId)?.name || '';
      setMessage({
        type: 'error',
        text: `${postId}${postName ? ` (${postName})` : ''} masih kosong. Silakan pilih petugas.`
      });
      return;
    }
    if (!Object.values(postAssignments).some(
      assignment => assignment.employeeId === profile.linkedEmployeeId,
    )) {
      setMessage({ type: 'error', text: 'Ketua Shift wajib menjaga salah satu dari sembilan pos.' });
      return;
    }
    const invalidCover = Object.entries(postAssignments).find(([, assignment]) =>
      assignment.shiftType === 'Lembur Cover' &&
      (!assignment.coveredEmployeeId || (assignment.overtimeReason || '').trim().length < 8),
    );
    if (invalidCover) {
      setMessage({
        type: 'error',
        text: `${invalidCover[0]}: pilih anggota yang digantikan dan isi alasan minimal 8 karakter.`,
      });
      return;
    }

    if (isExtraPostVisible && extraEmployeeId && !extraPostName.trim()) {
      setMessage({ type: 'error', text: 'Nama pos tambahan harus diisi jika petugas tambahan dipilih.' });
      return;
    }
    if (
      isExtraPostVisible &&
      extraEmployeeId &&
      extraOvertimeReason.trim().length < 8
    ) {
      setMessage({ type: 'error', text: 'Alasan Lembur Sendiri wajib minimal 8 karakter.' });
      return;
    }

    // Intercept with confirmation modal if activeShift is Malam
    if (activeShift === 'Malam') {
      setShowConfirmModal(true);
    } else {
      await executeSubmitSatpamShift();
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
                : Math.max(0, (activity.tollParkingFee || 0) + (activity.extraMealAllowance || 0) + (activity.extraFuelCost || 0));

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
                  variant="ghost"
                  size="icon"
                  className="text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded-xl h-9 w-9 flex items-center justify-center cursor-pointer"
                  title="Riwayat Perjalanan"
                >
                  <Compass className="w-4.5 h-4.5 text-indigo-600" />
                </Button>
              </Link>
            )}
            <Link href="/employee/payslip">
              <Button
                variant="ghost"
                size="icon"
                className="text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded-xl h-9 w-9 flex items-center justify-center cursor-pointer"
                title="Slip Gaji"
              >
                <Banknote className="w-4.5 h-4.5 text-emerald-600" />
              </Button>
            </Link>

            <Button
              onClick={() => logout()}
              variant="ghost"
              size="icon"
              className="text-slate-400 hover:text-rose-500 rounded-xl h-9 w-9 flex items-center justify-center"
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

        {/* ── Satpam Shift Team Daily Logging Form (Ketua Shift only) ── */}
        {isKetuaShiftSatpam && (
          <Card className="bg-white rounded-2xl shadow-sm border-none overflow-hidden py-0">
            <CardHeader className="bg-gradient-to-r from-purple-600 to-indigo-600 p-5 text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md">
                  <ClipboardList className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold text-white">Lapor Roster Shift Regu</CardTitle>
                  <CardDescription className="text-purple-100 text-xs mt-0.5">
                    {myShiftTeam ? `Regu ${myShiftTeam.id.split('_')[1]} (Ketua: ${myShiftTeam.ketuaShiftName})` : 'Mengambil data regu...'}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {loadingSatpamConfig ? (
                <div className="py-8 flex flex-col items-center justify-center text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-600 mb-2" />
                  <span className="text-xs font-semibold">Memuat data regu Satpam...</span>
                </div>
              ) : (
                <form onSubmit={handleSubmitSatpamShift} className="space-y-4">
                  {/* Date selection & Shift Display */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 pb-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="satpamDate" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Pilih Tanggal Dinas
                      </Label>
                      <Input
                        id="satpamDate"
                        type="date"
                        value={satpamReportDate}
                        onChange={(e) => setSatpamReportDate(e.target.value)}
                        className="rounded-xl border-slate-200 focus:border-purple-400 focus:ring-purple-400/20 text-sm font-bold text-slate-700 bg-white"
                        required
                      />
                    </div>

                    <div className="flex flex-col justify-center space-y-1">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Jadwal Shift Roster</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge className="bg-purple-100 hover:bg-purple-100 text-purple-800 border-none font-extrabold text-sm px-3.5 py-1 rounded-xl">
                          Shift {activeShift}
                        </Badge>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {activeShift === 'Pagi' ? '08:00 - 14:00' : activeShift === 'Sore' ? '14:00 - 22:00' : '22:00 - 08:00 (H+1)'}
                        </span>
                      </div>
                    </div>

                    {/* Shift Date Range Helper */}
                    <div className="sm:col-span-2 pt-1 border-t border-slate-200/60 mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
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
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-1.5 pl-0.5">
                      Penugasan Pos Keamanan (9 Pos)
                    </h3>

                    <div className="space-y-3.5">
                      {POSTS_CONFIG.map((post) => {
                        const defaultShiftTypeForRender = getDefaultShiftTypeForDate(satpamReportDate);
                        const val = postAssignments[post.id] || { employeeId: '', shiftType: defaultShiftTypeForRender };
                        const assignedElsewhere = [
                          ...Object.entries(postAssignments)
                            .filter(([postId]) => postId !== post.id)
                            .map(([, assignment]) => assignment.employeeId),
                          extraEmployeeId
                        ].filter(Boolean);
                        return (
                          <div key={post.id} className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center bg-white p-3 rounded-xl border border-slate-200 hover:shadow-sm transition-shadow">
                            {/* Pos Name Label */}
                            <div className="md:col-span-3">
                              <span className="text-xs font-black text-slate-500 uppercase block tracking-wider leading-tight">{post.id}</span>
                              <span className="text-xs font-extrabold text-slate-800 truncate block mt-0.5">{post.name}</span>
                            </div>

                            {/* Guard Dropdown */}
                            <div className="md:col-span-5">
                              <Select
                                value={val.employeeId || 'none'}
                                onValueChange={(v: string | null) => handleSelectGuard(post.id, v === 'none' || v === null ? '' : v)}
                                disabled={isSatpamReportSubmitted || loadingSubmittedSatpam}
                              >
                                <SelectTrigger className="w-full text-sm font-extrabold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-2.5 h-10 flex items-center justify-between">
                                  <span className={val.employeeId ? "truncate" : "truncate text-slate-400 font-normal"}>
                                    {allSatpamEmployees.find(emp => emp.id === val.employeeId)?.name || '-- Pilih Petugas --'}
                                  </span>
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white max-h-[300px] overflow-y-auto">
                                  <SelectItem value="none" className="text-sm py-2 pl-3 text-slate-400 italic">
                                    -- Kosongkan Pos --
                                  </SelectItem>
                                  <SelectGroup>
                                    <SelectLabel className="text-xs font-black text-purple-600 px-2 py-1.5 bg-purple-50/50">Anggota Regu Anda</SelectLabel>
                                    {groupEmployees.filter(emp => !assignedElsewhere.includes(emp.id)).map(emp => (
                                      <SelectItem key={emp.id} value={emp.id} className="text-sm py-2 pl-3">
                                        {emp.name} {emp.id === profile.linkedEmployeeId ? '(Anda)' : ''}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                  <SelectSeparator className="my-1" />
                                  <SelectGroup>
                                    <SelectLabel className="text-xs font-black text-slate-400 px-2 py-1.5 bg-slate-50">Satpam Regu Lain (Lembur Cover)</SelectLabel>
                                    {externalEmployees.filter(emp => !assignedElsewhere.includes(emp.id)).map(emp => (
                                      <SelectItem key={emp.id} value={emp.id} className="text-sm py-2 pl-3">
                                        {emp.name}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Server-derived pay type */}
                            <div className="md:col-span-4">
                              <div className="w-full text-sm font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 h-10 flex items-center">
                                {val.shiftType} ({val.shiftType === 'Lembur Cover'
                                  ? 'Rp50.000'
                                  : val.shiftType === 'Jumat & Libur'
                                    ? 'Rp25.000'
                                    : 'Rp12.500'})
                              </div>
                            </div>
                            {val.shiftType === 'Lembur Cover' && (
                              <>
                                <div className="md:col-span-6">
                                  <Select
                                    value={val.coveredEmployeeId || 'none'}
                                    onValueChange={(value: string | null) =>
                                      handleCoverDetail(post.id, 'coveredEmployeeId', value === 'none' || value === null ? '' : value)}
                                    disabled={isSatpamReportSubmitted || loadingSubmittedSatpam}
                                  >
                                    <SelectTrigger className="w-full h-10 rounded-lg bg-amber-50 border-amber-200 text-sm font-bold">
                                      <span>
                                        {groupEmployees.find(emp => emp.id === val.coveredEmployeeId)?.name ||
                                          '-- Pilih anggota yang digantikan --'}
                                      </span>
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">-- Pilih anggota --</SelectItem>
                                      {groupEmployees
                                        .filter(emp => !assignedEmployeeIds.includes(emp.id))
                                        .map(emp => (
                                          <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="md:col-span-6">
                                  <Input
                                    value={val.overtimeReason || ''}
                                    onChange={event =>
                                      handleCoverDetail(post.id, 'overtimeReason', event.target.value)}
                                    disabled={isSatpamReportSubmitted || loadingSubmittedSatpam}
                                    placeholder="Alasan cover / referensi ketidakhadiran"
                                    className="h-10 rounded-lg bg-amber-50 border-amber-200"
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}

                      {!isExtraPostVisible ? (
                        !isSatpamReportSubmitted && (
                          <div
                            onClick={() => setIsExtraPostVisible(true)}
                            className="flex items-center justify-center bg-slate-50/50 hover:bg-slate-50 p-4 rounded-xl border border-dashed border-slate-300 hover:border-slate-400 hover:shadow-sm transition-all cursor-pointer h-[66px] animate-in fade-in duration-200"
                          >
                            <span className="text-sm font-extrabold text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5">
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
                              disabled={isSatpamReportSubmitted || loadingSubmittedSatpam}
                            >
                              <SelectTrigger className="w-full text-sm font-extrabold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-2.5 h-10 flex items-center justify-between">
                                <span className={extraPostName ? "truncate" : "truncate text-slate-400 font-normal"}>
                                  {POSTS_CONFIG.find(p => p.id === extraPostName || p.name === extraPostName)?.name || '-- Pilih Pos --'}
                                </span>
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white">
                                <SelectItem value="none" className="text-sm py-2 pl-3 text-slate-400 italic">
                                  -- Pilih Pos --
                                </SelectItem>
                                {POSTS_CONFIG.map((post) => (
                                  <SelectItem key={post.id} value={post.id} className="text-sm py-2 pl-3">
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
                              disabled={isSatpamReportSubmitted || loadingSubmittedSatpam}
                            >
                              <SelectTrigger className="w-full text-sm font-extrabold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-2.5 h-10 flex items-center justify-between">
                                <span className={extraEmployeeId ? "truncate" : "truncate text-slate-400 font-normal"}>
                                  {allSatpamEmployees.find(emp => emp.id === extraEmployeeId)?.name || '-- Pilih Petugas --'}
                                </span>
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border border-slate-100 shadow-xl bg-white max-h-[300px] overflow-y-auto">
                                <SelectItem value="none" className="text-sm py-2 pl-3 text-slate-400 italic">
                                  -- Kosongkan Pos --
                                </SelectItem>
                                <SelectGroup>
                                  <SelectLabel className="text-xs font-black text-purple-600 px-2 py-1.5 bg-purple-50/50">Anggota Regu Anda</SelectLabel>
                                  {groupEmployees.filter(emp => !Object.values(postAssignments).map(a => a.employeeId).includes(emp.id)).map(emp => (
                                    <SelectItem key={emp.id} value={emp.id} className="text-sm py-2 pl-3">
                                      {emp.name} {emp.id === profile.linkedEmployeeId ? '(Anda)' : ''}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Fixed overtime type */}
                          <div className="md:col-span-3">
                            <div className="w-full text-sm font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 h-10 flex items-center">
                              Lembur Sendiri (Rp30.000)
                            </div>
                          </div>

                          {/* Cancel/Remove Button */}
                          <div className="md:col-span-1 flex justify-center">
                            {!isSatpamReportSubmitted && (
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
                                }}
                                className="text-slate-400 hover:text-red-500 transition-colors p-1"
                              >
                                <X className="w-5 h-5" />
                              </Button>
                            )}
                          </div>
                          <div className="md:col-span-12">
                            <Input
                              value={extraOvertimeReason}
                              onChange={event => setExtraOvertimeReason(event.target.value)}
                              disabled={isSatpamReportSubmitted || loadingSubmittedSatpam}
                              placeholder="Alasan/otorisasi Lembur Sendiri (minimal 8 karakter)"
                              className="h-10 rounded-lg bg-indigo-50/50 border-indigo-200"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Libur & Rest Info */}
                  <div className="p-4 rounded-xl bg-purple-50/50 border border-purple-100 text-xs font-medium space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-purple-700">Anggota Libur (Regu Istirahat):</span>
                      <Badge className="bg-purple-100 text-purple-800 border-none font-bold text-[10px] rounded-md py-px px-1.5">Auto-Approved</Badge>
                    </div>
                    {offDutyMembers.length === 0 ? (
                      <p className="text-slate-400 italic">Semua anggota regu sedang ditugaskan di pos.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {offDutyMembers.map(emp => (
                          <Badge key={emp.id} variant="outline" className="bg-white border-purple-200 text-purple-700 font-extrabold text-[10px] py-0.5 px-2 rounded-md">
                            {emp.name} (Libur)
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-2">
                    <Button
                      type="submit"
                      disabled={satpamSubmitting || isSatpamReportSubmitted || loadingSubmittedSatpam}
                      className={`w-full rounded-xl font-extrabold text-sm h-11 flex items-center justify-center gap-2 border-none shadow-md ${isSatpamReportSubmitted
                        ? 'bg-emerald-600 hover:bg-emerald-600 text-white cursor-not-allowed shadow-emerald-100'
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
                      ) : isSatpamReportSubmitted ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-white animate-bounce" />
                          <span>Laporan Regu Shift {activeShift} Sudah Dikirim & Disetujui</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 text-white" />
                          <span>Kirim Laporan Regu Shift {activeShift}</span>
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
                      Karena jadwal piket Anda aktif hari ini, Anda dapat membuat SPJ (Surat Perintah Jalan) sendiri khusus kendaraan <strong>Ndalem</strong>.
                    </p>
                    {myClaimedJourneys.length > 0 && (
                      <p className="text-[11px] font-bold text-amber-200 mt-1 flex items-center gap-1.5 bg-amber-950/40 p-2.5 rounded-xl border border-amber-400/30">
                        <AlertCircle className="w-4 h-4 text-amber-300 shrink-0" />
                        Anda memiliki perjalanan aktif yang sedang berjalan. Selesaikan laporan perjalanan tersebut terlebih dahulu untuk dapat membuat SPJ Piket baru.
                      </p>
                    )}
                  </div>

                  <Button
                    disabled={myClaimedJourneys.length > 0}
                    onClick={() => setShowSelfPiketSpjModal(true)}
                    className="shrink-0 rounded-xl bg-white text-emerald-900 hover:bg-emerald-50 font-extrabold text-xs h-10 px-4 gap-2 cursor-pointer shadow-md border-none disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4 text-emerald-700" />
                    Buat SPJ Piket (Ndalem)
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-slate-100 border border-slate-200 text-slate-600 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>
                    Pembuatan SPJ mandiri hanya aktif pada hari jadwal piket Anda.
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
                            const baseWage = (j.distanceKm * 2 * 300) + ((j.durationHours || 0) * 2 * 5000);
                            const maxWage = baseWage * 1.25;
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
                  const baseWage = (j.distanceKm * 2 * 300) + ((j.durationHours || 0) * 2 * 5000);
                  const maxWage = baseWage * 1.25;

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
                              const baseWage = (j.distanceKm * 2 * 300) + ((j.durationHours || 0) * 2 * 5000);
                              const maxWage = baseWage * 1.25;
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
                      : 'Tekan tombol "+" di bawah untuk menambahkan kegiatan baru.'
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
                            <div className="text-sm font-bold text-slate-800 truncate">{activity.activityName}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-slate-400 font-medium">{activity.activityDate}</span>
                              <span className="text-[11px] text-slate-300">•</span>
                              <span className="text-[11px] text-slate-400 font-medium">
                                {activity.activityType === 'Buang Sampah' || activity.activityName === 'Buang Sampah'
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
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Waktu</span>
                                <p className="text-sm font-semibold text-slate-700 mt-0.5">
                                  {activity.activityType === 'Buang Sampah' || activity.activityName === 'Buang Sampah'
                                    ? activity.timeStart
                                    : `${activity.timeStart} – ${activity.timeEnd}`}
                                </p>
                              </div>
                            </div>

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
                                        Estimasi Upah: {fmtRp(activity.fee)}
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
                            {canEdit && (activity.jobCategory !== 'SATPAM' || profile?.role === 'honorer') && (
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
      {!isRegularSatpam && !isSopir && (
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-xl shadow-teal-300/40 hover:shadow-2xl hover:shadow-teal-300/50 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* ── Add / Edit Activity Dialog ─────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] rounded-3xl border-none shadow-2xl bg-white p-0 overflow-hidden">
          <div className="bg-gradient-to-r from-teal-500 to-cyan-600 p-5 pb-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                {editingActivity
                  ? <><Pencil className="w-4.5 h-4.5" /> Edit Kegiatan</>
                  : <><Sparkles className="w-4.5 h-4.5" /> Lapor Kegiatan Baru</>
                }
              </DialogTitle>
              <DialogDescription className="text-teal-100 text-xs mt-1">
                {editingActivity
                  ? 'Perbarui detail dan ajukan ulang kegiatan ini.'
                  : 'Masukkan detail kegiatan yang telah Anda selesaikan hari ini.'
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
                          setFormDateEnd('');
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
                  const effectiveNights = formIsMultiDay ? timings.nightCount : formNightCount;
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
              <div className="space-y-1.5 animate-in fade-in duration-200">
                <Label htmlFor="activityNameInput" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
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
                  className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                  required
                  autoFocus
                  autoComplete="off"
                />
              </div>
            )}

            {/* Date */}
            <div className="space-y-1.5">
              <Label htmlFor="activityDate" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Tanggal Kegiatan
              </Label>
              <Input
                id="activityDate"
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                required
              />
            </div>

            {/* Time Range */}
            <div className={formActivityType === 'Buang Sampah' ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-3'}>
              <div className="space-y-1.5">
                <Label htmlFor="timeStart" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Waktu Mulai
                </Label>
                <div className="relative">
                  <Timer className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <Input
                    id="timeStart"
                    type="text"
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
                    className="pl-9 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                    required
                  />
                </div>
              </div>
              {formActivityType !== 'Buang Sampah' && (
                <div className="space-y-1.5">
                  <Label htmlFor="timeEnd" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Waktu Selesai
                  </Label>
                  <div className="relative">
                    <Timer className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <Input
                      id="timeEnd"
                      type="text"
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
                      className="pl-9 rounded-xl border-slate-200 focus:border-teal-400 focus:ring-teal-400/20 text-base sm:text-sm"
                      required
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={resetForm}
                className="flex-1 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={submitting || (isSopir && (calculatedDistanceKm <= 0 || JSON.stringify(formPoints) !== JSON.stringify(routeCalculatedPoints)))}
                className="flex-1 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-bold shadow-md shadow-teal-200 hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
              <DialogDescription className="text-amber-50 text-xs mt-1">
                Harap periksa kembali tanggal dinas untuk Shift Malam Anda.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="p-5 space-y-4 text-sm text-slate-600">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-start gap-2.5">
                <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-extrabold text-amber-900 text-sm">Roster Shift Malam (22:00 - 08:00 WIB)</h4>
                  <p className="text-xs text-amber-800/80 leading-relaxed mt-1">
                    Shift Malam dimulai pada malam hari **tanggal mulai** dan berakhir keesokan paginya. Roster tanggal dinas Anda adalah **tanggal saat shift malam Anda dimulai**.
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

      {/* Dialog for Self-Creating Piket SPJ (Rich Otorisasi SPJ Modal - Ndalem locked, No Operational Cost Calculation) */}
      <Dialog open={showSelfPiketSpjModal} onOpenChange={setShowSelfPiketSpjModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 sm:p-7">
          <DialogHeader className="border-b border-slate-100 pb-4">
            <DialogTitle className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-2">
              <Compass className="w-5 h-5 text-emerald-600 animate-spin-slow" />
              Otorisasi SPJ Piket Mandiri (Ndalem)
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

            {/* Kendaraan */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Jenis Kendaraan
              </Label>
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs font-extrabold flex items-center justify-between h-10">
                <span className="flex items-center gap-2">
                  <Car className="w-4 h-4 text-amber-600 shrink-0" />
                  Ndalem — Tanpa Uang Jalan Operasional
                </span>
                <Badge className="bg-amber-200 text-amber-950 border-none text-[9px] font-black shrink-0">Terkunci</Badge>
              </div>
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

            {/* Calculation Summary Preview (WITHOUT Operational Cost Calculation) */}
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
              </div>
            )}

            <DialogFooter className="pt-3 border-t border-slate-100 gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowSelfPiketSpjModal(false)}
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
