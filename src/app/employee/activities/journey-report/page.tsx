"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { ImageExifViewer } from '@/components/ImageExifViewer';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Loader2,
  ArrowLeft,
  Clock,
  Compass,
  MapPin,
  Send,
  Save,
  XCircle,
  Plus,
  Trash2,
  Upload,
  Sparkles,
  Search,
  CheckCircle2,
  Eye,
  AlertCircle,
  Banknote,
} from 'lucide-react';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
  calculateDriverReimbursementSettlement,
  calculateDriverNetWage,
  calculateJourneyElapsedHours,
  calculateNightPremium,
  journeyDayCount,
  calculateJourneyDateTimeTimings,
  getShortTripMealWageComponent,
  getMealAllowanceForDuration,
  getMealTierCount,
} from '@/lib/payroll/driverJourney';
import { prepareProofImage, type PhotoEvidence } from '@/lib/photoEvidence';
import type { PhotoAuditMetadata } from '@/lib/payroll/domain';

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

function fmtRp(val: number): string {
  return 'Rp' + Math.ceil(val).toLocaleString('id-ID');
}

function getTodayISO(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
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

const getPlacesSearchQuery = (endPoint: string): string => {
  if (!endPoint) return '';
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

const getDominantColorFromImage = async (imgUrl: string): Promise<{ hex: string; rgb: { r: number; g: number; b: number } } | null> => {
  try {
    let sourceUrl = imgUrl;

    if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) {
      try {
        const apiRes = await fetch(`/api/get-image-color?url=${encodeURIComponent(imgUrl)}`);
        if (apiRes.ok) {
          const json = await apiRes.json();
          if (json.dataUrl) {
            sourceUrl = json.dataUrl;
          }
        }
      } catch (err) {
        console.warn('Proxy fetch for image color failed, using direct url fallback:', err);
      }
    }

    return new Promise((resolve) => {
      // If we don't have a converted dataUrl, skip canvas extraction safely to prevent CORS console warnings
      if (!sourceUrl.startsWith('data:')) {
        resolve(null);
        return;
      }

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          canvas.width = 64;
          canvas.height = 64;
          ctx.drawImage(img, 0, 0, 64, 64);
          const imageData = ctx.getImageData(0, 0, 64, 64);
          const data = imageData.data;

          const buckets: { [key: string]: { r: number; g: number; b: number; count: number } } = {};
          const step = 24;

          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha < 128) continue;

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const maxRGB = Math.max(r, g, b);
            const minRGB = Math.min(r, g, b);
            const chroma = maxRGB - minRGB;

            // Filter out pure white, dark black, and flat gray to highlight vivid landmark features
            if (maxRGB > 240 && chroma < 20) continue;
            if (maxRGB < 25) continue;

            const qR = Math.min(255, Math.floor(r / step) * step + Math.floor(step / 2));
            const qG = Math.min(255, Math.floor(g / step) * step + Math.floor(step / 2));
            const qB = Math.min(255, Math.floor(b / step) * step + Math.floor(step / 2));

            const key = `${qR},${qG},${qB}`;
            const weight = 1 + (chroma / 255) * 1.5;

            if (!buckets[key]) {
              buckets[key] = { r: qR, g: qG, b: qB, count: weight };
            } else {
              buckets[key].count += weight;
            }
          }

          let dominantBucket: { r: number; g: number; b: number; count: number } | null = null;
          for (const key in buckets) {
            if (!dominantBucket || buckets[key].count > dominantBucket.count) {
              dominantBucket = buckets[key];
            }
          }

          if (!dominantBucket) {
            resolve({ hex: '#4F46E5', rgb: { r: 79, g: 70, b: 229 } });
            return;
          }

          const { r, g, b } = dominantBucket;
          const hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
          resolve({ hex, rgb: { r, g, b } });
        } catch (e) {
          console.warn('Canvas error reading dominant color:', e);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = sourceUrl;
    });
  } catch (e) {
    console.error('getDominantColorFromImage error:', e);
    return null;
  }
};

const DestinationImageBanner = ({
  destination,
  cachedUrl,
  onColorExtracted,
}: {
  destination: string;
  cachedUrl?: string;
  onColorExtracted?: (hex: string, rgb: { r: number; g: number; b: number }) => void;
}) => {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [extractedHex, setExtractedHex] = useState<string | null>(null);

  useEffect(() => {
    if (cachedUrl) {
      setImgUrl(cachedUrl);
      setLoading(false);
      return;
    }

    if (!destination || typeof window === 'undefined') {
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

        service.textSearch({ query: searchQuery }, (results: any, status: any) => {
          if (status === g.maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
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

          service.findPlaceFromQuery({ query: searchQuery, fields: ['photos'] }, (results2: any, status2: any) => {
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

    loadGoogleMapsScript(() => {
      checkAndFetch();
    });
  }, [destination, cachedUrl]);

  useEffect(() => {
    if (!imgUrl) return;
    let isMounted = true;
    getDominantColorFromImage(imgUrl).then((colorData) => {
      if (isMounted && colorData) {
        setExtractedHex(colorData.hex);
        onColorExtracted?.(colorData.hex, colorData.rgb);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [imgUrl, onColorExtracted]);

  if (loading) {
    return (
      <div className="relative w-full h-[clamp(240px,38vh,360px)] bg-slate-100 flex items-center justify-center animate-pulse overflow-hidden">
        <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!imgUrl) {
    return (
      <div className="relative w-full h-[clamp(240px,38vh,360px)] bg-gradient-to-br from-blue-100 to-slate-100 flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#2563eb_1px,transparent_1px)] [background-size:16px_16px]" />
        <Compass className="w-10 h-10 text-blue-400/50 relative z-10" />
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-slate-50 via-slate-50/70 to-transparent" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-[clamp(240px,38vh,360px)] overflow-hidden bg-slate-100">
      <img
        src={imgUrl}
        alt={destination}
        className="absolute inset-0 w-full h-full object-cover object-center hover:scale-105 transition-transform duration-500"
        onError={() => setImgUrl(null)}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-slate-50 via-slate-50/75 to-transparent" />
    </div>
  );
};

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

  const userJobCategory = profile?.permittedCategories?.[0] || '';
  const isSopir = userJobCategory === 'SOPIR';

  const [activeReportingJourney, setActiveReportingJourney] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [themeColor, setThemeColor] = useState<{ hex: string; rgb: { r: number; g: number; b: number } } | null>(null);

  const handleColorExtracted = useCallback((hex: string, rgb: { r: number; g: number; b: number }) => {
    setThemeColor({ hex, rgb });
  }, []);

  const pageBgStyle = useMemo(() => {
    if (!themeColor) return { backgroundColor: '#f8fafc' };
    const { r, g, b } = themeColor.rgb;
    return {
      background: `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, 0.35) 0%, rgba(${r}, ${g}, ${b}, 0.16) 600px, rgba(${r}, ${g}, ${b}, 0.10) 100%)`,
      transition: 'background 0.8s ease-in-out',
    };
  }, [themeColor]);

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
  const [mapAddressImage, setMapAddressImage] = useState<string | null>(null);
  const [mapTargetIndex, setMapTargetIndex] = useState<number | null>(null);

  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);

  const isDraftLoadedRef = useRef(false);
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
          router.replace('/employee/activities');
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
          router.replace('/employee/activities');
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

          if (reportData.status !== 'claimed' && !isExplicitEdit) {
            // A direct link to an assigned or already-submitted journey must
            // never mutate the assignment as a side effect of loading the form.
            if (typeof window !== 'undefined' && targetId) {
              sessionStorage.setItem('submitted_driver_journey_id', targetId);
              sessionStorage.setItem('submitted_driver_journey_at', String(Date.now()));
            }
            skipJourneyLoadRef.current = true;
            setLoading(false);
            router.replace('/employee/activities');
            return;
          }
          setActiveReportingJourney(reportData);

          // Check for local storage auto-saved draft
          const localDraftKey = `journey_draft_${targetId}`;
          let localDraft: any = null;
          try {
            const raw = typeof window !== 'undefined' ? localStorage.getItem(localDraftKey) : null;
            if (raw) localDraft = JSON.parse(raw);
          } catch (e) {
            console.error('Error parsing local draft:', e);
          }

          const initialDate = localDraft?.formDate ?? reportData.activityDate ?? reportData.dateStart ?? reportData.journeyDate ?? getTodayISO();
          setFormDate(initialDate);

          const todayISO = getTodayISO();
          const isOvernightOrMultiDay = initialDate < todayISO;

          const initialDateEnd = localDraft?.formDateEnd ?? reportData.draftDateEnd ?? reportData.dateEnd ?? (isOvernightOrMultiDay ? todayISO : initialDate);
          setFormDateEnd(initialDateEnd);

          const initialIsMultiDay = localDraft?.formIsMultiDay ?? reportData.draftIsMultiDay ?? reportData.isMultiDay ?? (
            isOvernightOrMultiDay ||
            (reportData.nightCount && reportData.nightCount > 0) ||
            (reportData.draftNightCount && reportData.draftNightCount > 0) ||
            false
          );
          setFormIsMultiDay(initialIsMultiDay);

          const initialExtraLocs = localDraft?.extraActivities ?? reportData.draftExtraActivities ?? reportData.extraActivities ?? [];
          setExtraActivities(initialExtraLocs);

          const initialTimeStart = localDraft?.formTimeStart ?? reportData.draftTimeStart ?? reportData.timeStart ?? '';
          setFormTimeStart(initialTimeStart);

          const initialTimeEnd = localDraft?.formTimeEnd ?? reportData.draftTimeEnd ?? reportData.timeEnd ?? '';
          setFormTimeEnd(initialTimeEnd);

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

          const rawFuelUrls = reportData.draftFuelReceiptUrl || reportData.fuelReceiptUrl || '';
          setFormFuelReceiptUrls(
            Array.isArray(localDraft?.formFuelReceiptUrls)
              ? localDraft.formFuelReceiptUrls
              : (rawFuelUrls ? (typeof rawFuelUrls === 'string' ? rawFuelUrls.split(',').filter(Boolean) : rawFuelUrls) : [])
          );
          setFormFuelReceiptEvidence(
            Array.isArray(localDraft?.formFuelReceiptEvidence)
              ? localDraft.formFuelReceiptEvidence
              : (Array.isArray(reportData.fuelReceiptEvidence) ? reportData.fuelReceiptEvidence : [])
          );

          const rawTollUrls = reportData.draftTollReceiptUrl || reportData.tollReceiptUrl || '';
          setFormTollReceiptUrls(
            Array.isArray(localDraft?.formTollReceiptUrls)
              ? localDraft.formTollReceiptUrls
              : (rawTollUrls ? (typeof rawTollUrls === 'string' ? rawTollUrls.split(',').filter(Boolean) : rawTollUrls) : [])
          );
          setFormTollReceiptEvidence(
            Array.isArray(localDraft?.formTollReceiptEvidence)
              ? localDraft.formTollReceiptEvidence
              : (Array.isArray(reportData.tollReceiptEvidence) ? reportData.tollReceiptEvidence : [])
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
          setRouteHydrationKey(targetId);

          setTimeout(() => {
            isDraftLoadedRef.current = true;
          }, 100);
        } else {
          // Journey document does not exist — clean up any orphan ActivityReports
          try {
            await authenticatedJson(`/api/pekarya/activities?journeyId=${encodeURIComponent(targetId)}`, { method: 'DELETE' });
          } catch (e) { }
          router.replace('/employee/activities');
        }
      } catch (e) {
        if (cancelled || skipJourneyLoadRef.current) return;
        if (e instanceof Error && e.message.includes('Perjalanan dinas tidak ditemukan')) {
          skipJourneyLoadRef.current = true;
          router.replace('/employee/activities');
          return;
        }
        console.error('Error loading journey:', e);
        router.replace('/employee/activities');
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
  }, [journeyIdParam, profile?.linkedEmployeeId, isSopir, authLoading, router, user]);

  const recalculateRouteChain = useCallback(async (list: any[], overrideEndPoint?: string, forceRouteCalculation = false) => {
    if (!activeReportingJourney) return;
    const requestId = ++routeCalculationRequestRef.current;
    const currentEndPoint = overrideEndPoint || activeReportingJourney.endPoint;
    const extraLocs = list.filter(a => a.type === 'tambah_lokasi' && a.destination);
    if (extraLocs.length === 0 && !overrideEndPoint && !forceRouteCalculation) {
      setCalculatedDistanceKm((activeReportingJourney.distanceKm || 0) * 2);
      setCalculatedDurationHours((activeReportingJourney.durationHours || 0) * 2);
      setOutboundDistanceKm(null);
      setOutboundDurationHours(null);
      setIsCalculatingExtraRoute(false);
      return;
    }

    setIsCalculatingExtraRoute(true);
    setExtraRouteError('');
    try {
      if (!user) throw new Error('Sesi tidak ditemukan.');
      const idToken = await user.getIdToken();
      const points = [
        activeReportingJourney.startPoint,
        currentEndPoint,
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
        throw new Error(resData.error || 'Gagal menghitung rute.');
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
      if (requestId !== routeCalculationRequestRef.current) return;
      console.error(err);
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

    void recalculateRouteChain(extraActivities, undefined, true);
  }, [routeHydrationKey, activeReportingJourney?.id, extraActivities, recalculateRouteChain]);

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

  // Auto-save form progress to localStorage synchronously on any state change
  useEffect(() => {
    if (!activeReportingJourney || !isDraftLoadedRef.current) return;
    const localDraftKey = `journey_draft_${activeReportingJourney.id}`;
    const draftPayload = {
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
      extraActivities,
      calculatedDistanceKm,
      calculatedDurationHours,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(localDraftKey, JSON.stringify(draftPayload));
    } catch (e) {
      console.error('Failed to save draft to localStorage:', e);
    }
  }, [
    activeReportingJourney?.id,
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
    extraActivities,
    calculatedDistanceKm,
    calculatedDurationHours,
  ]);

  const handleSaveDraft = async () => {
    if (!activeReportingJourney) return;
    setIsSavingDraft(true);
    try {
      const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
      const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;
      const ndalemMealMoneyVal = formNdalemMealMoneyFee ? (parseInt(formNdalemMealMoneyFee.replace(/\D/g, ''), 10) || 0) : 0;
      const draftFuelReceiptUrls = fuelVal > 0 ? formFuelReceiptUrls.filter(Boolean) : [];
      const draftTollReceiptUrls = tollVal > 0 ? formTollReceiptUrls.filter(Boolean) : [];
      const draftFuelReceiptEvidence =
        draftFuelReceiptUrls.length > 0 && formFuelReceiptEvidence.length === draftFuelReceiptUrls.length
          ? formFuelReceiptEvidence
          : [];
      const draftTollReceiptEvidence =
        draftTollReceiptUrls.length > 0 && formTollReceiptEvidence.length === draftTollReceiptUrls.length
          ? formTollReceiptEvidence
          : [];
      const draftDateEnd = formIsMultiDay ? (formDateEnd || formDate) : formDate;
      const draftNightCount = formIsMultiDay ? formNightCount : 0;
      await authenticatedJson('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save_draft',
          journeyId: activeReportingJourney.id,
          draft: {
            date: formDate,
            dateEnd: draftDateEnd,
            isMultiDay: formIsMultiDay,
            timeStart: formTimeStart,
            timeEnd: formTimeEnd,
            nightCount: draftNightCount,
            ndalemMealMoneyReceived: ndalemMealMoneyVal,
            fuelFee: fuelVal,
            tollParkingFee: tollVal,
            fuelReceiptUrl: draftFuelReceiptUrls.join(','),
            tollReceiptUrl: draftTollReceiptUrls.join(','),
            ...(draftFuelReceiptEvidence.length > 0 ? { fuelReceiptEvidence: draftFuelReceiptEvidence } : {}),
            ...(draftTollReceiptEvidence.length > 0 ? { tollReceiptEvidence: draftTollReceiptEvidence } : {}),
            extraActivities,
            calculatedDistanceKm,
            calculatedDurationHours,
            endPoint: activeReportingJourney.endPoint,
          },
        }),
      });

      // Also ensure localStorage is synced
      const localDraftKey = `journey_draft_${activeReportingJourney.id}`;
      localStorage.setItem(localDraftKey, JSON.stringify({
        formDate,
        formDateEnd: draftDateEnd,
        formIsMultiDay,
        formTimeStart,
        formTimeEnd,
        formNightCount: draftNightCount,
        formNdalemMealMoneyFee,
        formFuelFee,
        formTollParkingFee,
        formFuelReceiptUrls: draftFuelReceiptUrls,
        formTollReceiptUrls: draftTollReceiptUrls,
        formFuelReceiptEvidence: draftFuelReceiptEvidence,
        formTollReceiptEvidence: draftTollReceiptEvidence,
        extraActivities,
        calculatedDistanceKm,
        calculatedDurationHours,
        updatedAt: Date.now(),
      }));

      setMessage({ type: 'success', text: 'Draft laporan berhasil disimpan.' });
    } catch (err) {
      console.error('Error saving draft:', err);
      setMessage({ type: 'error', text: 'Gagal menyimpan draft.' });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleBackToDashboard = async () => {
    if (activeReportingJourney && !skipSaveDraftRef.current) {
      await handleSaveDraft();
    }
    router.push('/employee/activities');
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
    if (mapTargetIndex === -1) {
      const newEndPoint = mapAddress;
      setActiveReportingJourney((prev: any) => ({
        ...prev,
        endPoint: newEndPoint
      }));
      setShowMapSelector(false);
      setMapTargetIndex(null);
      await recalculateRouteChain(extraActivities, newEndPoint);
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

  const handleUploadReceipt = async (file: File, type: 'bbm' | 'toll') => {
    if (!activeReportingJourney) return;
    const isBbm = type === 'bbm';
    if (isBbm) setUploadingFuelReceipt(true);
    else setUploadingTollReceipt(true);

    try {
      const prepared = await prepareProofImage(file);
      const fileRef = ref(storage, `receipts/${activeReportingJourney.id}/${type}_${Date.now()}.jpg`);
      await uploadBytes(fileRef, prepared.file);
      const downloadUrl = await getDownloadURL(fileRef);
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
    return Boolean(
      activeReportingJourney?.isSelfCreatedPiketSpj ||
      (typeof activeReportingJourney?.id === 'string' && activeReportingJourney.id.startsWith('JRN-PIKET-'))
    );
  }, [activeReportingJourney]);

  const canEditMainDestination = useMemo(() => {
    return activeReportingJourney?.status === 'claimed';
  }, [activeReportingJourney?.status]);

  const handleOpenCancelModal = () => {
    setShowCancelModal(true);
  };

  const handleConfirmCancelClaim = async () => {
    if (!activeReportingJourney || isCancelling) return;

    setIsCancelling(true);
    skipSaveDraftRef.current = true;
    skipJourneyLoadRef.current = true;
    try {
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
      router.replace('/employee/activities');
    } catch (err: any) {
      console.error('Error cancelling journey claim:', err);
      setMessage({ type: 'error', text: err.message || 'Gagal membatalkan klaim perjalanan.' });
      setIsCancelling(false);
      skipSaveDraftRef.current = false;
      skipJourneyLoadRef.current = false;
      setShowCancelModal(false);
    }
  };

  const handleCompleteJourneySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReportingJourney || isSubmittingRef.current) return;
    if (!profile?.linkedEmployeeId) {
      setMessage({ type: 'error', text: 'Akun Anda belum terhubung ke data Pegawai.' });
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
      const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
      const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;
      const submittedFuelReceiptUrls = fuelVal > 0
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

      if (fuelVal <= 0 || submittedFuelReceiptUrls.length === 0) {
        setFormFuelReceiptUrls([]);
        setFormFuelReceiptEvidence([]);
      }
      if (tollVal <= 0 || submittedTollReceiptUrls.length === 0) {
        setFormTollReceiptUrls([]);
        setFormTollReceiptEvidence([]);
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
        : (activeReportingJourney.status === 'claimed' ? Number(activeReportingJourney.tollParkingFee || 0) : 0);
      const baseCostVal = activeReportingJourney.baseOperationalCost !== undefined && activeReportingJourney.baseOperationalCost !== null
        ? Number(activeReportingJourney.baseOperationalCost)
        : Math.max(0, (activeReportingJourney.totalOperationalCost || 0) - preAuthorizedMeal - preAuthorizedToll);
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
      const actualMealAllowance = getMealAllowanceForDuration(
        elapsedHours,
        activeReportingJourney.vehicleName,
        ndalemMealMoneyVal,
      );
      const extraMealAllowance = isNdalem ? actualMealAllowance : Math.max(0, actualMealAllowance - preAuthorizedMeal);

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

      const nightPremium = calculateNightPremium(effectiveNightCount);
      const baseDriverWage = calculateDriverNetWage(
        calculatedDistanceKm,
        submittedDurationHours,
        effectiveNightCount,
      );
      const finalUpahBersih = Math.max(0, baseDriverWage - settlement.remainingUnspentCash);

      const extraLocs = extraActivities.filter(a => a.type === 'tambah_lokasi' && a.destination);
      const extraLocsText = extraLocs.map(l => l.destination.split(',')[0]).join(' → ');

      const startShort = (activeReportingJourney.startPoint || '').split(',')[0].trim();
      const endShort = (activeReportingJourney.endPoint || '').split(',')[0].trim();
      const routeText = ` (${startShort} → ${endShort}${extraLocsText ? ' → ' + extraLocsText : ''})`;
      let finalActivityName = ((activeReportingJourney.activityName || 'Perjalanan Sopir') + routeText).trim();
      if (finalActivityName.length > 180) {
        finalActivityName = finalActivityName.slice(0, 177) + '...';
      }

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
            points: [activeReportingJourney.startPoint, activeReportingJourney.endPoint, ...extraLocs.map(l => l.destination)],
            reportedEndPoint: activeReportingJourney.endPoint,
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
            ndalemMealMoneyReceived: isNdalem ? (formNdalemMealMoneyFee ? (parseInt(formNdalemMealMoneyFee.replace(/\D/g, ''), 10) || 0) : 0) : 0,
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
    }
  };

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

  const initAutocomplete = (inputEl: HTMLInputElement) => {
    loadGoogleMapsScript(() => {
      const google = (window as any).google;
      if (!google || !mapRef.current) return;
      try {
        const autocomplete = new google.maps.places.Autocomplete(inputEl, {
          fields: ['formatted_address', 'geometry', 'name'],
        });
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (place.geometry && place.geometry.location) {
            mapRef.current.setCenter(place.geometry.location);
            mapRef.current.setZoom(16);
            if (markerRef.current) markerRef.current.setPosition(place.geometry.location);
            const addr = place.formatted_address || place.name || inputEl.value;
            setMapAddress(addr);
            if (place.photos && place.photos.length > 0) {
              setMapAddressImage(place.photos[0].getUrl({ maxWidth: 1600, maxHeight: 800 }));
            }
          }
        });
      } catch (autoErr) {
        console.warn('Google Places Autocomplete initialization failed:', autoErr);
      }
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
        <span className="text-sm font-medium text-slate-500 ml-2">Memuat Laporan Perjalanan...</span>
      </div>
    );
  }

  if (!activeReportingJourney) return null;

  const returnLeg = getReturnLegDetails();

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24 text-slate-800 relative">
      {/* ── Top Header Bar ─────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 sticky top-0 z-30 shadow-md">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-extrabold text-base sm:text-lg">
            <CheckCircle2 className="w-5 h-5 text-white" />
            <span>Laporan Perjalanan</span>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/employee/driver-history">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl border border-white/25 text-white hover:bg-white/20 font-bold text-xs h-8 px-2.5 gap-1.5 cursor-pointer bg-white/10"
                title="Riwayat Perjalanan"
              >
                <Compass className="w-3.5 h-3.5 text-white" />
                <span className="hidden sm:inline">Riwayat</span>
              </Button>
            </Link>

            <Link href="/employee/payslip">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl border border-white/25 text-white hover:bg-white/20 font-bold text-xs h-8 px-2.5 gap-1.5 cursor-pointer bg-white/10"
                title="Slip Gaji"
              >
                <Banknote className="w-3.5 h-3.5 text-emerald-300" />
                <span className="hidden sm:inline">Slip Gaji</span>
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <form onSubmit={handleCompleteJourneySubmit} className="space-y-5">

          {/* Header Banner & Trip Specifications */}
          <div className="space-y-0">
            <div className="relative left-1/2 -mt-5 w-screen -translate-x-1/2 overflow-hidden">
              <DestinationImageBanner
                destination={activeReportingJourney.endPoint}
                cachedUrl={activeReportingJourney.destinationImageUrl}
                onColorExtracted={handleColorExtracted}
              />
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between px-4 py-4">
                <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-2 self-start rounded-full border border-white/40 bg-white/20 px-3.5 py-2 text-white shadow-[0_8px_30px_rgba(15,23,42,0.2)] ring-1 ring-white/10 backdrop-blur-xl">
                  <span className="shrink-0 text-[9px] font-black uppercase tracking-wide text-white/75">Keperluan</span>
                  <strong className="min-w-0 truncate text-[10px] font-extrabold text-white">{activeReportingJourney.activityName}</strong>
                </div>
                <div className="pointer-events-auto flex w-full items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-white/35 bg-slate-950/60 px-3 py-2 text-white shadow-[0_8px_30px_rgba(15,23,42,0.35)] ring-1 ring-white/10 backdrop-blur-xl">
                    <span className="shrink-0 text-[9px] font-black uppercase tracking-wide text-white/75">Kendaraan</span>
                    <strong className="min-w-0 truncate text-[10px] font-extrabold text-white">{activeReportingJourney.vehicleName}</strong>
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-white/35 bg-slate-950/60 px-3 py-2 text-white shadow-[0_8px_30px_rgba(15,23,42,0.35)] ring-1 ring-white/10 backdrop-blur-xl">
                    <span className="shrink-0 text-[9px] font-black uppercase tracking-wide text-white/75">Tanggal</span>
                    <strong className="min-w-0 truncate text-[10px] font-extrabold text-white">
                      {(() => {
                        const d = formDate || activeReportingJourney.activityDate || getTodayISO();
                        return new Date(d.includes('T') ? d : `${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                      })()}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Line Separator 1: Unified Route Timeline Section */}
          {(() => {
            const outbound = getOutboundLegDetails();
            const d0 = outbound.distanceKm;
            const dur0 = outbound.durationHours;
            const wage0 = (d0 * 300) + (dur0 * 5000);

            return (
              <div className="border-t border-slate-200/70 pt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-black text-blue-700 text-sm">
                    <Compass className="w-4 h-4 text-blue-600 animate-pulse" />
                    Rute Perjalanan (Timeline)
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddLocation}
                    className="h-6 px-2 text-[9px] font-bold border-blue-200 text-blue-700 hover:bg-blue-50 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                  >
                    + Tambah Lokasi
                  </Button>
                </div>

                <div className="relative pl-6 space-y-4">
                  <div className="absolute left-[9px] top-2 bottom-2 w-0.5 border-l-2 border-dashed border-blue-200" />

                  {/* Node 0: Start */}
                  <div className="relative flex items-start gap-2.5 text-xs">
                    <div className="absolute -left-[20px] top-1 w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow-sm" />
                    <div className="space-y-0.5 min-w-0">
                      <span className="text-[9px] text-blue-700 font-black block">Titik Keberangkatan</span>
                      <div className="font-extrabold text-black truncate" title={activeReportingJourney.startPoint}>
                        🏫 {activeReportingJourney.startPoint.split(',')[0]}
                      </div>
                      <div className="text-[9px] text-slate-800 font-bold">
                        Jarak Leg: <span className="text-emerald-700 font-extrabold">{d0.toFixed(1)} km</span> (Upah Bersih: <span className="text-emerald-600 font-extrabold">{fmtRp(Math.ceil(wage0))}</span>)
                      </div>
                    </div>
                  </div>

                  {/* Node 1: Main Destination */}
                  <div className="relative flex items-center justify-between gap-3 text-xs">
                    <div className="absolute -left-[20px] top-1 w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow-sm" />
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <span className="text-[9px] text-blue-700 font-black block">Tujuan Utama</span>
                      <div className="font-extrabold text-black truncate" title={activeReportingJourney.endPoint}>
                        🎯 {activeReportingJourney.endPoint}
                      </div>
                    </div>
                    {canEditMainDestination && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setMapTargetIndex(-1);
                          setMapSearchText(activeReportingJourney.endPoint || '');
                          setMapAddress(activeReportingJourney.endPoint || '');
                          setShowMapSelector(true);
                        }}
                        className="text-[10px] font-bold text-blue-700 hover:text-blue-800 bg-white border border-slate-200 px-2.5 h-7 rounded-lg cursor-pointer shrink-0"
                      >
                        Ubah
                      </Button>
                    )}
                  </div>

                  {/* Extra Location Nodes */}
                  {extraActivities.map((act, index) => {
                    if (act.type !== 'tambah_lokasi') return null;
                    return (
                      <div key={index} className="relative flex items-center justify-between gap-3 text-xs pl-0.5">
                        <div className="absolute -left-[20px] top-[5px] w-3 h-3 rounded-full bg-teal-500 border-2 border-white shadow-sm" />

                        <div className="flex-1 min-w-0 space-y-1">
                          {act.destination ? (
                            <div className="space-y-0.5">
                              <span className="text-[9px] text-teal-700 font-black block">Tujuan Tambahan</span>
                              <div className="text-xs font-black text-black truncate" title={act.destination}>
                                📍 {act.destination.split(',')[0]}
                              </div>
                              {act.distanceText && act.distanceKm !== undefined && (
                                <div className="text-[9px] text-slate-800 font-bold">
                                  Jarak Leg: <span className="text-emerald-700 font-extrabold">{act.distanceText}</span> (Upah Bersih: <span className="text-emerald-600 font-extrabold">{fmtRp(Math.ceil((act.distanceKm * 300) + ((act.durationHours || 0) * 5000)))}</span>)
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs font-bold text-slate-700 italic">
                              Belum memilih lokasi
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setMapTargetIndex(index);
                              setMapSearchText(act.destination || '');
                              setMapAddress(act.destination || '');
                              setShowMapSelector(true);
                            }}
                            className="text-[10px] font-bold text-blue-700 hover:text-blue-800 bg-white border border-slate-200 px-2.5 h-7 rounded-lg cursor-pointer"
                          >
                            {act.destination ? 'Ubah' : 'Pilih'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => handleRemoveExtraActivity(index)}
                            className="h-7 w-7 p-0 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Final Node: Return to Start */}
                  <div className="relative flex items-start gap-2.5 text-xs">
                    <div className="absolute -left-[20px] top-1 w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow-sm" />
                    <div className="space-y-0.5 min-w-0">
                      <span className="text-[9px] text-blue-700 font-black block">Titik Kepulangan</span>
                      <div className="font-extrabold text-black truncate" title={activeReportingJourney.startPoint}>
                        🏫 {activeReportingJourney.startPoint.split(',')[0]}
                      </div>
                      <div className="text-[9px] text-slate-800 font-bold">
                        Jarak Leg: <span className="text-emerald-700 font-extrabold">{returnLeg.distanceText}</span> (Upah Bersih: <span className="text-emerald-600 font-extrabold">{fmtRp(Math.ceil((returnLeg.distanceKm * 300) + ((returnLeg.durationHours || 0) * 5000)))}</span>)
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            );
          })()}

          {/* Line Separator 2: Input Data & Pengeluaran Operasional Section */}
          <div className="border-t border-slate-200/70 pt-5 space-y-4">
            {/* Toggle Lintas Hari / Menginap Above Time Controls */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50/60 border border-blue-100">
              <div className="flex items-center gap-2">
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
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <Label htmlFor="toggleMultiDay" className="text-xs font-black text-slate-900 cursor-pointer select-none">
                  Perjalanan Lintas Hari / Menginap
                </Label>
              </div>
              <span className="text-[10px] font-bold text-blue-700">
                {formIsMultiDay ? 'Multi-Hari Active' : 'Hari yang sama'}
              </span>
            </div>

            {!formIsMultiDay ? (
              /* 1-Row Layout for Single-Day Trip */
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="journeyTimeStart" className="text-xs font-black text-slate-900">
                      Jam Berangkat
                    </Label>
                    <Input
                      id="journeyTimeStart"
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
                      className="rounded-xl border-slate-300 focus:border-blue-500 text-sm h-10 px-3 font-semibold text-slate-900"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="journeyTimeEnd" className="text-xs font-black text-slate-900">
                      Jam Tiba / Selesai
                    </Label>
                    <Input
                      id="journeyTimeEnd"
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
                      className={`rounded-xl text-sm h-10 px-3 font-semibold transition-colors ${isInvalidSingleDayTime
                        ? 'border-rose-400 focus:border-rose-500 bg-rose-50/30 text-rose-900'
                        : 'border-slate-300 focus:border-blue-500 text-slate-900'
                        }`}
                      required
                    />
                  </div>
                </div>

                {isInvalidSingleDayTime && (
                  <div className="p-2.5 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 mt-2 animate-in fade-in duration-200">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>
                      Jam tiba ({formTimeEnd}) tidak boleh sebelum atau sama dengan jam berangkat ({formTimeStart}) pada perjalanan hari yang sama. Silakan centang <strong>Perjalanan Lintas Hari / Menginap</strong> jika perjalanan melintasi tengah malam.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              /* 2-Row Layout for Multi-Day / Overnight Trip */
              <div className="space-y-3 animate-in fade-in duration-200">
                {/* Row 1: Departure Date & Time */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="dateStartInput" className="text-xs font-black text-slate-900">
                      Tanggal Berangkat
                    </Label>
                    <Input
                      id="dateStartInput"
                      type="date"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      className="rounded-xl border-slate-200 focus:border-blue-400 text-xs font-semibold text-slate-900 h-10 px-2.5"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="timeStartMulti" className="text-xs font-black text-slate-900">
                      Jam Berangkat
                    </Label>
                    <Input
                      id="timeStartMulti"
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
                      className="rounded-xl border-slate-200 focus:border-blue-400 text-xs font-semibold text-slate-900 h-10 px-3"
                    />
                  </div>
                </div>

                {/* Row 2: Arrival Date & Time */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="dateEndInput" className="text-xs font-black text-slate-900">
                      Tanggal Tiba / Selesai
                    </Label>
                    <Input
                      id="dateEndInput"
                      type="date"
                      value={formDateEnd || formDate}
                      onChange={(e) => setFormDateEnd(e.target.value)}
                      className="rounded-xl border-slate-200 focus:border-blue-400 text-xs font-semibold text-slate-900 h-10 px-2.5"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="timeEndMulti" className="text-xs font-black text-slate-900">
                      Jam Tiba / Selesai
                    </Label>
                    <Input
                      id="timeEndMulti"
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
                      className="rounded-xl border-slate-200 focus:border-blue-400 text-xs font-semibold text-slate-900 h-10 px-3"
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
              const isNextDayArriveBefore5AM = (formDateEnd && formDateEnd > formDate) && parseInt(formTimeEnd.split(':')[0], 10) < 5;

              return (
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 pt-1">
                  <span>💡 Durasi Terhitung:</span>
                  <span className="text-emerald-700 font-extrabold">
                    {timings.durationHours > 0 ? timings.durationHours.toFixed(1) : '0'} Jam{' '}
                    {isNextDayArriveBefore5AM && effectiveNights === 0
                      ? '(Tanpa Menginap - Tiba sebelum 05:00)'
                      : `(${effectiveNights} Malam)`}
                  </span>
                </div>
              );
            })()}

            {/* Loader for API Recalculation */}
            {isCalculatingExtraRoute && (
              <div className="flex items-center justify-center p-2 text-[10px] text-blue-600 font-bold bg-blue-50/50 rounded-lg border border-blue-100/50 mt-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5 text-blue-600" />
                Menghitung rute perjalanan...
              </div>
            )}

            {extraRouteError && (
              <div className="p-2 text-[10px] bg-rose-50 border border-rose-200 text-rose-700 rounded-lg font-semibold flex items-center gap-2 mt-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>{extraRouteError}</span>
              </div>
            )}

            {/* Ndalem Meal Evaluation Form Fields (Uncarded) */}
            {activeReportingJourney.vehicleName === 'Ndalem' ? (
              (() => {
                const timings = calculateJourneyDateTimeTimings({
                  dateStart: formDate,
                  timeStart: formTimeStart,
                  dateEnd: formIsMultiDay ? (formDateEnd || formDate) : formDate,
                  timeEnd: formTimeEnd,
                  isMultiDay: formIsMultiDay,
                });
                const effectiveNightCount = formIsMultiDay ? timings.nightCount : 0;
                const elapsedHours = timings.durationHours > 0 ? timings.durationHours : calculateElapsedHours(formTimeStart, formTimeEnd, effectiveNightCount);
                const totalHakUangMakan = getMealAllowanceForDuration(elapsedHours, 'Suzuki XL7');
                const qtyHakMakan = Math.round(totalHakUangMakan / 20000);
                const ndalemMealMoneyVal = formNdalemMealMoneyFee ? (parseInt(formNdalemMealMoneyFee.replace(/\D/g, ''), 10) || 0) : 0;
                const unpaidDeltaRp = Math.max(0, totalHakUangMakan - ndalemMealMoneyVal);

                return (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="ndalemMealMoney" className="text-xs font-black text-slate-900 flex items-center justify-between">
                        <span>Uang Diberikan Selama Perjalanan</span>
                        <span className="text-slate-900 font-bold normal-case">
                          (Hak {qtyHakMakan}x Makan: <strong className="text-emerald-700 font-black">{fmtRp(totalHakUangMakan)}</strong>)
                        </span>
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-blue-700">Rp</span>
                        <Input
                          id="ndalemMealMoney"
                          placeholder="0"
                          value={formNdalemMealMoneyFee}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            setFormNdalemMealMoneyFee(val ? Number(val).toLocaleString('id-ID') : '');
                          }}
                          className="pl-8 rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400/20 text-xs font-bold text-blue-700 h-10 w-full"
                        />
                      </div>
                    </div>

                    {unpaidDeltaRp > 0 ? (
                      <div className="p-3 bg-blue-50 border border-blue-200/80 rounded-xl text-xs font-bold text-blue-900 flex items-center justify-between">
                        <span>Kekurangan Uang Makan:</span>
                        <span className="text-sm font-black text-blue-700">+{fmtRp(unpaidDeltaRp)}</span>
                      </div>
                    ) : (
                      <div className="p-3 bg-blue-50 border border-blue-200/80 rounded-xl text-xs font-bold text-blue-900 flex items-center justify-between">
                        <span>Uang Makan Ndalem Terpenuhi:</span>
                        <span className="text-xs font-black text-blue-700">Tidak ada selisih (Rp0)</span>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              (() => {
                const preAuthorizedToll = activeReportingJourney.preAuthorizedToll !== undefined && activeReportingJourney.preAuthorizedToll !== null
                  ? Number(activeReportingJourney.preAuthorizedToll)
                  : (activeReportingJourney.status === 'claimed' ? Number(activeReportingJourney.tollParkingFee || 0) : 0);
                const baseCostVal = activeReportingJourney.baseOperationalCost !== undefined && activeReportingJourney.baseOperationalCost !== null
                  ? Number(activeReportingJourney.baseOperationalCost)
                  : Math.max(0, (activeReportingJourney.totalOperationalCost || 0) - (activeReportingJourney.mealAllowance || 0) - preAuthorizedToll);
                return (
                  <div className="space-y-2">
                    <Label htmlFor="journeyFuel" className="text-xs font-black text-slate-900">
                      BBM Terbeli <span className="text-blue-600 font-extrabold normal-case tracking-normal">({`Jatah: ${fmtRp(Math.ceil(baseCostVal))}`})</span>
                    </Label>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-blue-700">Rp</span>
                        <Input
                          id="journeyFuel"
                          placeholder="0"
                          value={formFuelFee}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            setFormFuelFee(val ? Number(val).toLocaleString('id-ID') : '');
                          }}
                          className="pl-8 rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400/20 text-xs font-bold text-blue-700 h-10 w-full"
                        />
                      </div>
                      <div className="shrink-0 w-28 sm:w-32">
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
                        <Button
                          type="button"
                          onClick={() => fuelFileInputRef.current?.click()}
                          disabled={uploadingFuelReceipt}
                          className={`w-full rounded-xl text-[11px] sm:text-xs font-extrabold h-10 px-2 flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${formFuelReceiptUrls.length > 0
                            ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-900 border-slate-200 shadow-sm'
                            }`}
                        >
                          {uploadingFuelReceipt ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto text-slate-900" />
                          ) : formFuelReceiptUrls.length > 0 ? (
                            <>
                              <Plus className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              <span className="truncate">Tambah Bukti</span>
                            </>
                          ) : (
                            <>
                              <Upload className="w-3.5 h-3.5 text-slate-900 shrink-0" />
                              <span className="truncate">Upload Bukti</span>
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {formFuelReceiptUrls.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {formFuelReceiptUrls.map((url, index) => (
                          <div key={index} className="flex items-center justify-between gap-2 p-2 bg-blue-50/80 border border-blue-200 rounded-xl text-[11px]">
                            <div className="flex items-center gap-1.5 truncate font-bold text-blue-800">
                              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              <span className="truncate">
                                Bukti BBM {formFuelReceiptUrls.length > 1 ? `#${index + 1}` : 'terunggah'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setSelectedExifImage({
                                  url,
                                  title: `Bukti BBM ${formFuelReceiptUrls.length > 1 ? `#${index + 1}` : ''}`,
                                  auditMetadata: formFuelReceiptEvidence.find((item) => item.url === url)?.auditMetadata,
                                })}
                                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[10px] flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                              >
                                <Eye className="w-3 h-3" /> Lihat Foto
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setFormFuelReceiptUrls(prev => prev.filter((_, i) => i !== index));
                                  setFormFuelReceiptEvidence(prev => prev.filter((_, i) => i !== index));
                                }}
                                className="p-1 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors cursor-pointer"
                                title="Hapus Bukti Ini"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()
            )}

            {/* Tol & Parkir Row */}
            {(() => {
              const preAuthorizedTollVal = activeReportingJourney
                ? (activeReportingJourney.preAuthorizedToll !== undefined && activeReportingJourney.preAuthorizedToll !== null
                  ? Number(activeReportingJourney.preAuthorizedToll)
                  : (activeReportingJourney.status === 'claimed' ? Number(activeReportingJourney.tollParkingFee || 0) : 0))
                : 0;
              return (
                <div className="space-y-2">
                  <Label htmlFor="journeyToll" className="text-xs font-black text-slate-900">
                    Tol & Parkir Terbayar <span className="text-blue-600 font-extrabold normal-case tracking-normal">({`Jatah: ${fmtRp(Math.ceil(preAuthorizedTollVal))}`})</span>
                  </Label>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-blue-700">Rp</span>
                      <Input
                        id="journeyToll"
                        placeholder="0"
                        value={formTollParkingFee}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setFormTollParkingFee(val ? Number(val).toLocaleString('id-ID') : '');
                        }}
                        className="pl-8 rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400/20 text-xs font-bold text-blue-700 h-10 w-full"
                      />
                    </div>
                    <div className="shrink-0 w-28 sm:w-32">
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
                      <Button
                        type="button"
                        onClick={() => tollFileInputRef.current?.click()}
                        disabled={uploadingTollReceipt}
                        className={`w-full rounded-xl text-[11px] sm:text-xs font-bold h-10 px-2 flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${formTollReceiptUrls.length > 0
                          ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 shadow-sm'
                          }`}
                      >
                        {uploadingTollReceipt ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto text-slate-500" />
                        ) : formTollReceiptUrls.length > 0 ? (
                          <>
                            <Plus className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <span className="truncate">Tambah Bukti</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span className="truncate">Upload Bukti</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {formTollReceiptUrls.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {formTollReceiptUrls.map((url, index) => (
                        <div key={index} className="flex items-center justify-between gap-2 p-2 bg-blue-50/80 border border-blue-200 rounded-xl text-[11px]">
                          <div className="flex items-center gap-1.5 truncate font-bold text-blue-800">
                            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <span className="truncate">
                              Bukti Tol & Parkir {formTollReceiptUrls.length > 1 ? `#${index + 1}` : 'terunggah'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                                onClick={() => setSelectedExifImage({
                                  url,
                                  title: `Bukti Tol & Parkir ${formTollReceiptUrls.length > 1 ? `#${index + 1}` : ''}`,
                                  auditMetadata: formTollReceiptEvidence.find((item) => item.url === url)?.auditMetadata,
                                })}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[10px] flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                            >
                              <Eye className="w-3 h-3" /> Lihat Foto
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setFormTollReceiptUrls(prev => prev.filter((_, i) => i !== index));
                                setFormTollReceiptEvidence(prev => prev.filter((_, i) => i !== index));
                              }}
                              className="p-1 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors cursor-pointer"
                              title="Hapus Bukti Ini"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Rincian Biaya Laporan & Table Delta Breakdown Card */}
          {(() => {
            const isNdalem = activeReportingJourney.vehicleName === 'Ndalem';
            const originalTotalDist = (activeReportingJourney.distanceKm || 0) * 2;
            const extraDistanceKm = Math.max(0, calculatedDistanceKm - originalTotalDist);
            const extraOperationalCost = 0; // Extra mileage is compensated via Upah Bersih Sopir (distance component), not automatic cash reimbursement without receipts

            const originalMealAllowance = activeReportingJourney.mealAllowance || 0;
            const tableTimings = calculateJourneyDateTimeTimings({
              dateStart: formDate,
              timeStart: formTimeStart,
              dateEnd: formIsMultiDay ? (formDateEnd || formDate) : formDate,
              timeEnd: formTimeEnd,
              isMultiDay: formIsMultiDay,
            });
            const effectiveTableNights = formIsMultiDay ? tableTimings.nightCount : 0;
            const elapsedHours = tableTimings.durationHours > 0 ? tableTimings.durationHours : calculateElapsedHours(
              formTimeStart,
              formTimeEnd,
              effectiveTableNights,
            );
            const submittedDurationHours = elapsedHours > 0 ? elapsedHours : calculatedDurationHours;
            const ndalemMealMoneyVal = formNdalemMealMoneyFee ? (parseInt(formNdalemMealMoneyFee.replace(/\D/g, ''), 10) || 0) : 0;
            const actualMealAllowance =
              elapsedHours > 0
                ? getMealAllowanceForDuration(
                  elapsedHours,
                  activeReportingJourney.vehicleName,
                  ndalemMealMoneyVal,
                )
                : originalMealAllowance;
            const extraMealAllowance = isNdalem ? actualMealAllowance : Math.max(0, actualMealAllowance - originalMealAllowance);

            const preAuthorizedTollInCalc = activeReportingJourney.preAuthorizedToll !== undefined && activeReportingJourney.preAuthorizedToll !== null
              ? Number(activeReportingJourney.preAuthorizedToll)
              : (activeReportingJourney.status === 'claimed' ? Number(activeReportingJourney.tollParkingFee || 0) : 0);

            const baseCostVal = activeReportingJourney.baseOperationalCost !== undefined && activeReportingJourney.baseOperationalCost !== null
              ? Number(activeReportingJourney.baseOperationalCost)
              : Math.max(0, (activeReportingJourney.totalOperationalCost || 0) - (activeReportingJourney.mealAllowance || 0) - preAuthorizedTollInCalc);

            const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
            const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;

            const settlement = calculateDriverReimbursementSettlement({
              fuelAllowance: isNdalem ? 0 : baseCostVal,
              fuelSpent: isNdalem ? 0 : fuelVal,
              tollAllowance: preAuthorizedTollInCalc,
              tollSpent: tollVal,
              additionalReimbursement: extraMealAllowance + extraOperationalCost,
            });

            return (
              <div className="border-t border-slate-200/70 pt-5 text-slate-900 text-xs space-y-2 font-bold">
                <span className="font-black text-blue-700 text-sm block mb-1.5">
                  Kalkulasi Penyesuaian & Biaya Akhir
                </span>
                {(() => {
                  const getStratumLabel = (hours: number): string => {
                    if (hours <= 0) return '—';
                    const days = Math.floor(hours / 24);
                    const remainder = hours % 24;
                    return days > 0
                      ? `${days} hari + ${remainder.toFixed(1)} jam`
                      : `${remainder.toFixed(1)} jam`;
                  };

                  const preAuthorizedDurationPP = activeReportingJourney.customDurationPP || (activeReportingJourney.durationHours ? activeReportingJourney.durationHours * 2 : 0);
                  const preAuthorizedMeal = isNdalem
                    ? 0
                    : (activeReportingJourney.mealAllowance !== undefined && activeReportingJourney.mealAllowance !== null && activeReportingJourney.mealAllowance > 0
                      ? activeReportingJourney.mealAllowance
                      : getMealAllowanceForDuration(preAuthorizedDurationPP));

                  const plotStrata = getStratumLabel(preAuthorizedDurationPP);
                  const actualStrata = getStratumLabel(elapsedHours);

                  return (
                    <div className="overflow-x-auto py-2">
                      <table className="w-full text-[10px] text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 text-black font-extrabold text-[9px]">
                            <th className="pb-1.5 font-black text-black">Aspek</th>
                            <th className="pb-1.5 font-black text-center text-black">Plotingan</th>
                            <th className="pb-1.5 font-black text-center text-black">Aktual</th>
                            <th className="pb-1.5 font-black text-right text-black">Delta</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-black font-extrabold">
                          <tr>
                            <td className="py-2 text-black font-extrabold">Jarak</td>
                            <td className="py-2 text-center font-extrabold text-emerald-700">{originalTotalDist.toFixed(1)} km</td>
                            <td className="py-2 text-center font-black text-emerald-700">{calculatedDistanceKm.toFixed(1)} km</td>
                            <td className="py-2 text-right font-black text-emerald-700">
                              {extraDistanceKm > 0 ? (
                                <span>+{extraDistanceKm.toFixed(1)} km</span>
                              ) : (
                                <span className="text-black font-extrabold">—</span>
                              )}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 text-black font-extrabold">BBM</td>
                            <td className="py-2 text-center font-extrabold text-blue-700"><span>{fmtRp(Math.ceil(baseCostVal))}</span></td>
                            <td className="py-2 text-center font-black text-blue-700">{fmtRp(Math.ceil(fuelVal))}</td>
                            <td className="py-2 text-right font-black text-blue-700">
                              {settlement.fuelDelta !== 0 ? (
                                <span>
                                  {settlement.fuelDelta > 0 ? '+' : '-'}
                                  {fmtRp(Math.ceil(Math.abs(settlement.fuelDelta)))}
                                </span>
                              ) : (
                                <span className="text-black font-extrabold">—</span>
                              )}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 text-black font-extrabold">Uang Makan</td>
                            <td className="py-2 text-center font-extrabold text-blue-700">{plotStrata}</td>
                            <td className="py-2 text-center font-black text-blue-700">{actualStrata}</td>
                            <td className="py-2 text-right font-black text-blue-700">
                              {extraMealAllowance > 0 ? (
                                <span>+{fmtRp(Math.ceil(extraMealAllowance))}</span>
                              ) : (
                                <span className="text-black font-extrabold">—</span>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {settlement.extraFuelCost > 0 && (
                  <div className="flex justify-between text-slate-900 font-extrabold">
                    <span>Kelebihan BBM (Delta)</span>
                    <span className="font-black text-blue-700">+{fmtRp(Math.ceil(settlement.extraFuelCost))}</span>
                  </div>
                )}
                {extraMealAllowance > 0 && (
                  <div className="flex justify-between text-slate-900 font-extrabold">
                    <span>Kekurangan Uang Makan (Delta)</span>
                    <span className="font-black text-blue-700">+{fmtRp(Math.ceil(extraMealAllowance))}</span>
                  </div>
                )}
                {(() => {
                  const preAuthorizedToll = activeReportingJourney.preAuthorizedToll !== undefined && activeReportingJourney.preAuthorizedToll !== null
                    ? Number(activeReportingJourney.preAuthorizedToll)
                    : (activeReportingJourney.status === 'claimed' ? Number(activeReportingJourney.tollParkingFee || 0) : 0);
                  const extraToll = tollVal - preAuthorizedToll;
                  if (extraToll > 0) {
                    return (
                      <div className="flex justify-between text-slate-900 font-extrabold">
                        <span>{preAuthorizedToll > 0 ? 'Kelebihan Tol & Parkir (Delta)' : 'Reimburse Tol & Parkir'}</span>
                        <span className="font-black text-blue-700">+{fmtRp(Math.ceil(extraToll))}</span>
                      </div>
                    );
                  }
                  return null;
                })()}
                {(() => {
                  const baseDriverWage = calculateDriverNetWage(
                    calculatedDistanceKm,
                    submittedDurationHours,
                    effectiveTableNights,
                  );
                  const finalUpahBersih = Math.max(0, baseDriverWage - settlement.remainingUnspentCash);

                  return (
                    <>
                      <div className="py-2 border-y border-blue-200/50 flex justify-between font-black text-blue-700 text-sm">
                        <span>Total Reimburse (Delta)</span>
                        <span>{fmtRp(Math.ceil(settlement.reimburseDelta))}</span>
                      </div>

                      <div className="flex justify-between text-black text-[10px] font-extrabold pl-2">
                        <span>• Komponen Jarak ({calculatedDistanceKm.toFixed(1)} km)</span>
                        <span className="text-emerald-700 font-black">{fmtRp(Math.ceil(calculatedDistanceKm * 300))}</span>
                      </div>
                      {(() => {
                        const activeHours = submittedDurationHours;
                        const shortTripMeal = getShortTripMealWageComponent(activeHours);
                        return (
                          <>
                            <div className="flex justify-between text-black text-[10px] font-extrabold pl-2">
                              <span>• Komponen Waktu ({activeHours.toFixed(1)} jam)</span>
                              <span className="text-emerald-700 font-black">{fmtRp(Math.ceil(activeHours * 5000))}</span>
                            </div>
                            {shortTripMeal > 0 && (
                              <div className="flex justify-between text-black text-[10px] font-extrabold pl-2">
                                <span>• Uang Makan Perjalanan (≤ 2 Jam)</span>
                                <span className="text-emerald-700 font-black">+{fmtRp(shortTripMeal)}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-black text-[10px] font-extrabold pl-2">
                              <span>• Durasi Kalender</span>
                              <span className="text-emerald-700 font-extrabold">
                                {activeHours.toFixed(1)} jam / {journeyDayCount(activeHours)} hari
                              </span>
                            </div>
                          </>
                        );
                      })()}
                      {effectiveTableNights > 0 && (
                        <div className="flex justify-between text-black text-[10px] font-extrabold pl-2">
                          <span>• Insentif Menginap / Premium Malam ({effectiveTableNights} × Rp50.000)</span>
                          <span className="text-emerald-700 font-black">+{fmtRp(calculateNightPremium(effectiveTableNights))}</span>
                        </div>
                      )}
                      {settlement.remainingUnspentCash > 0 && (
                        <div className="flex justify-between text-blue-700 text-[10px] font-bold pl-2">
                          <span>• Potongan Sisa Kas Operasional (ke Upah Bersih)</span>
                          <span className="font-extrabold">-{fmtRp(Math.ceil(settlement.remainingUnspentCash))}</span>
                        </div>
                      )}

                      <div className="py-2 border-y border-emerald-200/50 flex justify-between font-black text-emerald-700 text-sm">
                        <span>Upah Bersih Sopir</span>
                        <span>{fmtRp(Math.ceil(finalUpahBersih))}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            );
          })()}

          {/* Toast / Validation Alert placed above submit buttons */}
          {message && (
            <div className={`flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold shadow-sm border ${message.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}>
              <span className="text-base leading-none">
                {message.type === 'success' ? '✓' : '⚠️'}
              </span>
              <span className="font-bold">{message.text}</span>
            </div>
          )}

          <div className="pt-2 flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              onClick={handleOpenCancelModal}
              disabled={isCancelling || submitting}
              variant="outline"
              className="w-full sm:w-auto rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs h-10 px-4 cursor-pointer"
              title={isSelfCreatedJourney ? "Membatalkan dan menghapus SPJ Mandiri secara permanen" : "Kembalikan perjalanan ke Pool"}
            >
              {isCancelling ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : (
                isSelfCreatedJourney ? <Trash2 className="w-4 h-4 mr-1 text-rose-500" /> : <XCircle className="w-4 h-4 mr-1 text-rose-500" />
              )}
              <span>{isSelfCreatedJourney ? 'Hapus & Batalkan Perjalanan' : 'Batalkan Klaim Perjalanan'}</span>
            </Button>

            <div className="flex gap-2 flex-1 justify-end">
              <Button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSavingDraft || submitting}
                variant="outline"
                className="flex-1 sm:flex-initial rounded-xl border-slate-200 text-slate-900 hover:bg-slate-50 font-bold text-xs h-10 px-4 cursor-pointer"
              >
                {isSavingDraft ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1 text-slate-900" />}
                <span>Simpan Draft</span>
              </Button>

              <Button
                type="submit"
                disabled={submitting}
                className="flex-1 sm:flex-initial rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm h-10 px-5 cursor-pointer shadow-md shadow-blue-100 border-none"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    <span>Mengirim...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-1.5" />
                    <span>Ya, Kirim Laporan</span>
                  </>
                )}
              </Button>
            </div>
          </div>

        </form>

        {/* Map Location Selector Modal */}
        {showMapSelector && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <Card className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border-none overflow-hidden">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-extrabold text-slate-900">Pilih Lokasi Tambahan</h3>
                  <button
                    onClick={() => setShowMapSelector(false)}
                    className="text-slate-900 hover:text-black p-1 rounded-full hover:bg-slate-100"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-black text-slate-900">Cari Nama Tempat / Alamat</Label>
                  <div className="relative">
                    <Input
                      ref={(el) => {
                        if (el) initAutocomplete(el);
                      }}
                      type="text"
                      value={mapSearchText}
                      onChange={(e) => setMapSearchText(e.target.value)}
                      placeholder="Contoh: Rest Area KM 57, Unair Kampus C..."
                      className="rounded-xl border-slate-200 pl-9 text-xs font-bold text-slate-900 h-10"
                    />
                    <Search className="w-4 h-4 text-slate-900 absolute left-3 top-3" />
                  </div>
                </div>

                <div
                  ref={(el) => {
                    if (el) initMap(el);
                  }}
                  className="w-full h-56 rounded-2xl overflow-hidden border border-slate-200"
                />

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/60 text-xs">
                  <span className="text-[10px] font-black text-slate-900 block mb-0.5">Alamat Terpilih:</span>
                  <p className="font-extrabold text-black">{mapAddress || 'Geser pin atau cari tempat'}</p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowMapSelector(false)}
                    className="rounded-xl border-slate-200 text-xs font-bold text-slate-900 h-10"
                  >
                    Batal
                  </Button>
                  <Button
                    type="button"
                    onClick={handleConfirmMapLocation}
                    disabled={!mapAddress}
                    className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs h-10 px-4"
                  >
                    Gunakan Lokasi Ini
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Custom Cancellation Confirmation Dialog Modal */}
        <Dialog open={showCancelModal} onOpenChange={setShowCancelModal}>
          <DialogContent className="max-w-md rounded-3xl p-6 bg-white border border-slate-100 shadow-2xl">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                {isSelfCreatedJourney ? (
                  <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                    <Trash2 className="w-4 h-4 text-rose-600" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                  </div>
                )}
                <span>{isSelfCreatedJourney ? 'Konfirmasi Hapus & Batal Perjalanan' : 'Konfirmasi Batal Klaim'}</span>
              </DialogTitle>
              <DialogDescription render={<div />} className="text-xs text-slate-900 font-bold leading-relaxed pt-1">
                {isSelfCreatedJourney ? (
                  <div className="p-3.5 bg-rose-50/80 border border-rose-200/80 rounded-2xl space-y-1.5 text-rose-950 font-semibold text-xs">
                    <div className="font-extrabold text-rose-900 flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      Catatan SPJ Piket Mandiri:
                    </div>
                    <div className="text-rose-900 text-[11.5px] leading-normal">
                      Perjalanan ini diotorisasi mandiri oleh Anda. Jika Anda membatalkan, perjalanan ini akan <strong>dihapus secara permanen</strong> dan <strong>tidak akan dimasukkan ke Pool</strong> sopir lain.
                    </div>
                  </div>
                ) : (
                  <span>Apakah Anda yakin ingin membatalkan klaim perjalanan ini? Perjalanan akan dikembalikan ke Pool agar dapat diambil oleh sopir lain.</span>
                )}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowCancelModal(false)}
                disabled={isCancelling}
                className="rounded-xl font-bold text-slate-900 hover:bg-slate-100 text-xs h-10 px-4 cursor-pointer"
              >
                Tutup / Kembali
              </Button>
              <Button
                type="button"
                onClick={handleConfirmCancelClaim}
                disabled={isCancelling}
                className={`rounded-xl font-bold text-xs h-10 px-5 gap-1.5 cursor-pointer shadow-md ${isSelfCreatedJourney
                  ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200'
                  : 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-200'
                  }`}
              >
                {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                  isSelfCreatedJourney ? <Trash2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />
                )}
                <span>{isSelfCreatedJourney ? 'Ya, Hapus & Batalkan' : 'Ya, Batalkan Klaim'}</span>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      }
    >
      <JourneyReportContent />
    </Suspense>
  );
}
