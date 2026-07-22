"use client";

import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useAuth } from '@/lib/AuthContext';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
} from 'lucide-react';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';

const loadGoogleMapsScript = (callback: () => void) => {
  if (typeof window === 'undefined') return;
  if ((window as any).google) {
    callback();
    return;
  }
  const existingScript = document.getElementById('googleMapsScript');
  if (existingScript) {
    existingScript.addEventListener('load', callback);
    return;
  }
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}&libraries=places`;
  script.id = 'googleMapsScript';
  script.async = true;
  script.defer = true;
  script.addEventListener('load', callback);
  document.head.appendChild(script);
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
  if (city) return `${cleanStreet}, ${city}`;
  return cleanStreet;
};

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

    const g = (window as any).google;
    if (g && g.maps && g.maps.places) {
      checkAndFetch();
    } else {
      const timer = setTimeout(checkAndFetch, 1000);
      return () => clearTimeout(timer);
    }
  }, [destination, cachedUrl]);

  if (loading) {
    return (
      <div className="w-full h-36 bg-slate-50 flex items-center justify-center animate-pulse">
        <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!imgUrl) {
    return (
      <div className="w-full h-36 bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#4f46e5_1px,transparent_1px)] [background-size:16px_16px]" />
        <Compass className="w-10 h-10 text-indigo-400/50 relative z-10" />
      </div>
    );
  }

  return (
    <div className="w-full h-36 relative overflow-hidden">
      <img
        src={imgUrl}
        alt={destination}
        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
        onError={() => setImgUrl(null)}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
    </div>
  );
};

function fmtRp(val: number): string {
  return 'Rp' + val.toLocaleString('id-ID');
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

function getMealAllowanceForDuration(hours: number): number {
  if (hours > 0 && hours < 2) return 5000;
  if (hours >= 2 && hours <= 6) return 20000;
  if (hours > 6 && hours <= 12) return 40000;
  if (hours > 12) return 60000;
  return 0;
}

function calculateElapsedHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [hStart, mStart] = start.split(':').map(Number);
  const [hEnd, mEnd] = end.split(':').map(Number);
  let diffMinutes = (hEnd * 60 + mEnd) - (hStart * 60 + mStart);
  if (diffMinutes < 0) diffMinutes += 24 * 60;
  return diffMinutes / 60;
}

function JourneyReportContent() {
  const { profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const journeyIdParam = searchParams.get('id');

  const fuelFileInputRef = useRef<HTMLInputElement>(null);
  const tollFileInputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);
  const skipSaveDraftRef = useRef(false);

  const userJobCategory = profile?.permittedCategories?.[0] || '';
  const isSopir = userJobCategory === 'SOPIR';

  const [journey, setJourney] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states
  const [formDate, setFormDate] = useState('');
  const [formTimeStart, setFormTimeStart] = useState('08:00');
  const [formTimeEnd, setFormTimeEnd] = useState('17:00');
  const [formIsOvernight, setFormIsOvernight] = useState(false);
  const [formFuelFee, setFormFuelFee] = useState('');
  const [formTollParkingFee, setFormTollParkingFee] = useState('');
  const [formFuelReceiptUrls, setFormFuelReceiptUrls] = useState<string[]>([]);
  const [formTollReceiptUrls, setFormTollReceiptUrls] = useState<string[]>([]);
  const [uploadingFuelReceipt, setUploadingFuelReceipt] = useState(false);
  const [uploadingTollReceipt, setUploadingTollReceipt] = useState(false);

  const [extraActivities, setExtraActivities] = useState<any[]>([]);
  const [calculatedDistanceKm, setCalculatedDistanceKm] = useState(0);
  const [calculatedDurationHours, setCalculatedDurationHours] = useState(0);
  const [isCalculatingExtraRoute, setIsCalculatingExtraRoute] = useState(false);
  const [extraRouteError, setExtraRouteError] = useState('');

  // Live real-time calculations for Reimburse Delta & Upah Bersih
  const liveCalculations = useMemo(() => {
    if (!journey) return null;
    const isNdalem = journey.vehicleName === 'Ndalem';
    const originalTotalDist = (journey.distanceKm || 0) * 2;
    const extraDistanceKm = Math.max(0, calculatedDistanceKm - originalTotalDist);
    const extraOperationalCost = Math.ceil(extraDistanceKm * (journey.vehicleRate || 0));

    const preAuthorizedDurationPP = journey.customDurationPP || (journey.durationHours ? journey.durationHours * 2 : 0);
    const preAuthorizedMeal = isNdalem
      ? 0
      : (journey.mealAllowance !== undefined && journey.mealAllowance !== null && journey.mealAllowance > 0
          ? journey.mealAllowance
          : getMealAllowanceForDuration(preAuthorizedDurationPP));

    const baseCostVal = journey.baseOperationalCost ||
      ((journey.totalOperationalCost || 0) - preAuthorizedMeal - (journey.tollParkingFee || 0));
    const preAuthorizedToll = journey.tollParkingFee || 0;
    const totalPreAuthorizedAllowance = baseCostVal + preAuthorizedToll;

    const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
    const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;
    const totalActualSpent = fuelVal + tollVal;

    const elapsedHours = (formTimeStart && formTimeEnd) ? calculateElapsedHours(formTimeStart, formTimeEnd) : 0;
    const actualMealAllowance = isNdalem ? 0 : getMealAllowanceForDuration(elapsedHours);
    const extraMealAllowance = isNdalem ? 0 : Math.max(0, actualMealAllowance - preAuthorizedMeal);

    const extraFuelCost = isNdalem ? 0 : Math.max(0, fuelVal - baseCostVal);
    const extraTollCost = Math.max(0, tollVal - preAuthorizedToll);

    const positiveReimburseDelta = extraMealAllowance + extraFuelCost + extraTollCost + extraOperationalCost;
    const unspentCash = Math.max(0, totalPreAuthorizedAllowance - totalActualSpent);

    const finalReimburseDelta = Math.max(0, positiveReimburseDelta - unspentCash);
    const remainingUnspentCash = Math.max(0, unspentCash - positiveReimburseDelta);

    const premiumOvernight = formIsOvernight ? 50000 : 0;
    const componentJarak = calculatedDistanceKm * 300;
    const componentWaktu = calculatedDurationHours * 5000;
    const baseDriverWage = componentJarak + componentWaktu + premiumOvernight;
    const finalUpahBersih = Math.max(0, baseDriverWage - remainingUnspentCash);

    return {
      isNdalem,
      extraDistanceKm,
      extraOperationalCost,
      preAuthorizedMeal,
      actualMealAllowance,
      extraMealAllowance,
      baseCostVal,
      extraFuelCost,
      preAuthorizedToll,
      extraTollCost,
      totalPreAuthorizedAllowance,
      totalActualSpent,
      positiveReimburseDelta,
      unspentCash,
      finalReimburseDelta,
      remainingUnspentCash,
      premiumOvernight,
      componentJarak,
      componentWaktu,
      baseDriverWage,
      finalUpahBersih,
      elapsedHours,
      fuelVal,
      tollVal,
    };
  }, [journey, calculatedDistanceKm, calculatedDurationHours, formTimeStart, formTimeEnd, formIsOvernight, formFuelFee, formTollParkingFee]);

  // Map selector modal
  const [showMapSelector, setShowMapSelector] = useState(false);
  const [mapSearchText, setMapSearchText] = useState('');
  const [mapAddress, setMapAddress] = useState('');
  const [mapAddressImage, setMapAddressImage] = useState<string | null>(null);
  const [mapTargetIndex, setMapTargetIndex] = useState<number | null>(null);

  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);

  // Load journey data
  useEffect(() => {
    if (!profile?.linkedEmployeeId || !isSopir) {
      setLoading(false);
      return;
    }

    const fetchJourney = async () => {
      setLoading(true);
      try {
        let targetId = journeyIdParam;
        if (!targetId) {
          // Fallback: try fetching claimed journey for this driver
          const res = await fetch(`/api/driver-journeys?driverId=${profile.linkedEmployeeId}`);
          if (res.ok) {
            const data = await res.json();
            const claimed = (data.journeys || []).find((j: any) => j.status === 'claimed');
            if (claimed) targetId = claimed.id;
          }
        }

        if (!targetId) {
          router.replace('/employee/activities');
          return;
        }

        const docRef = doc(db, 'DriverJourneys', targetId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data: any = { id: docSnap.id, ...docSnap.data() };
          setJourney(data);
          setFormDate(data.journeyDate || data.activityDate || new Date().toISOString().split('T')[0]);
          setExtraActivities(data.draftExtraActivities || []);
          setFormTimeStart(data.draftTimeStart || '08:00');
          setFormTimeEnd(data.draftTimeEnd || '17:00');
          setFormFuelFee(data.draftFuelFee ? String(data.draftFuelFee) : '');
          setFormTollParkingFee(data.draftTollParkingFee ? String(data.draftTollParkingFee) : '');

          const rawFuel = data.draftFuelReceiptUrl || data.fuelReceiptUrl || '';
          setFormFuelReceiptUrls(rawFuel ? rawFuel.split(',').filter(Boolean) : []);

          const rawToll = data.draftTollReceiptUrl || data.tollReceiptUrl || '';
          setFormTollReceiptUrls(rawToll ? rawToll.split(',').filter(Boolean) : []);

          setFormIsOvernight(data.draftIsOvernight || false);
          setCalculatedDistanceKm(
            data.draftCalculatedDistanceKm !== undefined
              ? data.draftCalculatedDistanceKm
              : (data.distanceKm || 0) * 2
          );
          setCalculatedDurationHours(
            data.draftCalculatedDurationHours !== undefined
              ? data.draftCalculatedDurationHours
              : (data.durationHours || 0) * 2
          );
        } else {
          router.replace('/employee/activities');
        }
      } catch (e) {
        console.error('Error loading journey:', e);
        router.replace('/employee/activities');
      } finally {
        setLoading(false);
      }
    };

    fetchJourney();
  }, [journeyIdParam, profile?.linkedEmployeeId, isSopir, router]);

  // Recalculate route chain
  const recalculateRouteChain = async (list: any[]) => {
    if (!journey) return;
    const extraLocs = list.filter(a => a.type === 'tambah_lokasi' && a.destination);
    if (extraLocs.length === 0) {
      setCalculatedDistanceKm((journey.distanceKm || 0) * 2);
      setCalculatedDurationHours((journey.durationHours || 0) * 2);
      return;
    }

    setIsCalculatingExtraRoute(true);
    setExtraRouteError('');
    try {
      const points = [
        journey.startPoint,
        journey.endPoint,
        ...extraLocs.map(l => l.destination),
        journey.startPoint
      ];

      const response = await fetch('/api/calculate-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points }),
      });
      const resData = await response.json();
      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Gagal menghitung rute tambahan.');
      }

      setCalculatedDistanceKm(resData.distanceKm);
      setCalculatedDurationHours(resData.durationHours);

      const updated = [...list];
      let locCounter = 0;
      updated.forEach((act, idx) => {
        if (act.type === 'tambah_lokasi') {
          if (act.destination) {
            const leg = resData.legs[locCounter + 1];
            if (leg) {
              const dist = parseLegDistance(leg.distanceText);
              const dur = leg.durationHours || 0;
              const cost = dist * (journey?.vehicleRate || 0);
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
    if (!journey) return '';
    for (let i = index - 1; i >= 0; i--) {
      if (extraActivities[i].type === 'tambah_lokasi' && extraActivities[i].destination) {
        return extraActivities[i].destination;
      }
    }
    return journey.endPoint;
  };

  const getReturnLegDetails = () => {
    if (!journey) return { distanceText: '', legCost: 0, distanceKm: 0, durationHours: 0 };
    const d0 = journey.distanceKm || 0;
    const dur0 = journey.durationHours || 0;
    let extraSum = 0;
    let extraDurSum = 0;
    extraActivities.forEach(act => {
      if (act.type === 'tambah_lokasi' && act.distanceKm) {
        extraSum += act.distanceKm;
        extraDurSum += act.durationHours || 0;
      }
    });

    const returnDist = Math.max(0, calculatedDistanceKm - d0 - extraSum);
    const returnDur = Math.max(0, calculatedDurationHours - dur0 - extraDurSum);
    const returnCost = returnDist * (journey.vehicleRate || 0);

    return {
      distanceText: `${returnDist.toFixed(1)} km`,
      legCost: returnCost,
      distanceKm: returnDist,
      durationHours: returnDur
    };
  };

  const handleSaveDraft = async () => {
    if (!journey) return;
    setIsSavingDraft(true);
    try {
      const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
      const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;
      const journeyRef = doc(db, 'DriverJourneys', journey.id);
      await updateDoc(journeyRef, {
        draftTimeStart: formTimeStart,
        draftTimeEnd: formTimeEnd,
        draftIsOvernight: formIsOvernight,
        draftFuelFee: fuelVal,
        draftTollParkingFee: tollVal,
        draftFuelReceiptUrl: formFuelReceiptUrls.join(','),
        draftTollReceiptUrl: formTollReceiptUrls.join(','),
        draftExtraActivities: extraActivities,
        draftCalculatedDistanceKm: calculatedDistanceKm,
        draftCalculatedDurationHours: calculatedDurationHours,
        updatedAt: serverTimestamp()
      });
      setMessage({ type: 'success', text: 'Draft laporan berhasil disimpan.' });
    } catch (err) {
      console.error('Error saving draft:', err);
      setMessage({ type: 'error', text: 'Gagal menyimpan draft.' });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleBackToDashboard = async () => {
    if (journey && !skipSaveDraftRef.current) {
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

  const compressImage = (file: File): Promise<File> => {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        resolve(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxDim = 1200;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(
              (blob) => {
                if (blob) {
                  const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
                    type: 'image/jpeg',
                    lastModified: Date.now(),
                  });
                  resolve(compressedFile);
                } else {
                  resolve(file);
                }
              },
              'image/jpeg',
              0.75
            );
          } else {
            resolve(file);
          }
        };
        img.onerror = () => resolve(file);
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  };

  const handleUploadReceipt = async (file: File, type: 'bbm' | 'toll') => {
    if (!journey) return;
    const isBbm = type === 'bbm';
    if (isBbm) setUploadingFuelReceipt(true);
    else setUploadingTollReceipt(true);

    try {
      const processedFile = await compressImage(file);
      const extension = processedFile.name.split('.').pop() || 'jpg';
      const fileRef = ref(storage, `receipts/${journey.id}/${type}_${Date.now()}.${extension}`);
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
      if (isBbm) setUploadingFuelReceipt(false);
      else setUploadingTollReceipt(false);
    }
  };

  const handleCancelClaim = async () => {
    if (!journey || isCancelling) return;
    if (!confirm('Apakah Anda yakin ingin membatalkan klaim perjalanan ini? Perjalanan akan dikembalikan ke Pool.')) {
      return;
    }

    setIsCancelling(true);
    skipSaveDraftRef.current = true;
    try {
      const journeyRef = doc(db, 'DriverJourneys', journey.id);
      await updateDoc(journeyRef, {
        status: 'open',
        claimedBy: deleteField(),
        claimedByName: deleteField(),
        claimedAt: deleteField(),
        draftTimeStart: deleteField(),
        draftTimeEnd: deleteField(),
        draftIsOvernight: deleteField(),
        draftFuelFee: deleteField(),
        draftTollParkingFee: deleteField(),
        draftFuelReceiptUrl: deleteField(),
        draftTollReceiptUrl: deleteField(),
        draftExtraActivities: deleteField(),
        draftCalculatedDistanceKm: deleteField(),
        draftCalculatedDurationHours: deleteField(),
        updatedAt: serverTimestamp()
      });
      router.replace('/employee/activities');
    } catch (err) {
      console.error('Error cancelling journey claim:', err);
      setMessage({ type: 'error', text: 'Gagal membatalkan klaim perjalanan.' });
      setIsCancelling(false);
      skipSaveDraftRef.current = false;
    }
  };

  const handleCompleteJourneySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!journey || isSubmittingRef.current) return;
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
      setMessage({ type: 'error', text: 'Format waktu berangkat dan tiba harus HH:MM (contoh: 08:00).' });
      isSubmittingRef.current = false;
      setSubmitting(false);
      skipSaveDraftRef.current = false;
      return;
    }
    if (!formIsOvernight && formTimeEnd <= formTimeStart) {
      setMessage({ type: 'error', text: 'Waktu selesai harus lebih dari waktu mulai (centang "Tambahan Menginap" jika perjalanan lintas hari).' });
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

      const isNdalem = journey.vehicleName === 'Ndalem';
      const originalTotalDist = (journey.distanceKm || 0) * 2;
      const extraDistanceKm = Math.max(0, calculatedDistanceKm - originalTotalDist);
      const extraOperationalCost = Math.ceil(extraDistanceKm * (journey.vehicleRate || 0));

      const preAuthorizedDurationPP = journey.customDurationPP || (journey.durationHours ? journey.durationHours * 2 : 0);
      const preAuthorizedMeal = isNdalem
        ? 0
        : (journey.mealAllowance !== undefined && journey.mealAllowance !== null && journey.mealAllowance > 0
            ? journey.mealAllowance
            : getMealAllowanceForDuration(preAuthorizedDurationPP));

      const baseCostVal = journey.baseOperationalCost ||
        ((journey.totalOperationalCost || 0) - preAuthorizedMeal - (journey.tollParkingFee || 0));
      const preAuthorizedToll = journey.tollParkingFee || 0;
      const totalPreAuthorizedAllowance = baseCostVal + preAuthorizedToll;

      const totalActualSpent = fuelVal + tollVal;

      const elapsedHours = (formTimeStart && formTimeEnd) ? calculateElapsedHours(formTimeStart, formTimeEnd) : 0;
      const actualMealAllowance = isNdalem ? 0 : getMealAllowanceForDuration(elapsedHours);
      const extraMealAllowance = isNdalem ? 0 : Math.max(0, actualMealAllowance - preAuthorizedMeal);

      const extraFuelCost = isNdalem ? 0 : Math.max(0, fuelVal - baseCostVal);
      const extraTollCost = Math.max(0, tollVal - preAuthorizedToll);

      const positiveReimburseDelta = extraMealAllowance + extraFuelCost + extraTollCost + extraOperationalCost;
      const unspentCash = Math.max(0, totalPreAuthorizedAllowance - totalActualSpent);

      const finalReimburseDelta = Math.max(0, positiveReimburseDelta - unspentCash);
      const remainingUnspentCash = Math.max(0, unspentCash - positiveReimburseDelta);

      const premiumWeekend = 0;
      const premiumOvernight = formIsOvernight ? 50000 : 0;
      const baseDriverWage = calculatedDistanceKm * 300 + calculatedDurationHours * 5000 + premiumWeekend + premiumOvernight;
      const finalUpahBersih = Math.max(0, baseDriverWage - remainingUnspentCash);

      const journeyRef = doc(db, 'DriverJourneys', journey.id);
      await updateDoc(journeyRef, {
        status: 'completed',
        fuelFee: fuelVal,
        tollParkingFee: tollVal,
        fuelReceiptUrl: formFuelReceiptUrls.join(','),
        tollReceiptUrl: formTollReceiptUrls.join(','),
        isOvernight: formIsOvernight,
        activityDate: formDate,
        timeStart: formTimeStart,
        timeEnd: formTimeEnd,
        completedAt: serverTimestamp(),
        authorizedAt: journey.authorizedAt || journey.createdAt || null,
        journeyDate: journey.journeyDate || journey.activityDate || null,
        claimedAt: journey.claimedAt || null,
        extraActivities,
        extraDistanceKm,
        extraOperationalCost,
        extraFuelCost,
        extraTollCost,
        extraMealAllowance,
        actualMealAllowance,
        positiveReimburseDelta,
        newTotalDistanceKm: calculatedDistanceKm,
        newTotalDurationHours: calculatedDurationHours,
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
        totalOperationalCost: journey.totalOperationalCost || 0,
        vehicleRate: journey.vehicleRate || 741,
        componentJarak: calculatedDistanceKm * 300,
        componentWaktu: calculatedDurationHours * 5000,
        premiumOvernight: formIsOvernight ? 50000 : 0,
        draftTimeStart: deleteField(),
        draftTimeEnd: deleteField(),
        draftIsOvernight: deleteField(),
        draftFuelFee: deleteField(),
        draftTollParkingFee: deleteField(),
        draftFuelReceiptUrl: deleteField(),
        draftTollReceiptUrl: deleteField(),
        draftExtraActivities: deleteField(),
        draftCalculatedDistanceKm: deleteField(),
        draftCalculatedDurationHours: deleteField(),
        updatedAt: serverTimestamp()
      });

      router.replace('/employee/activities');
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
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mb-2" />
        <span className="text-sm font-medium text-slate-500 ml-2">Memuat Laporan Perjalanan...</span>
      </div>
    );
  }

  if (!journey) return null;

  const returnLeg = getReturnLegDetails();

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-28 text-slate-800 relative">
      {/* ── Top Header Bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={handleBackToDashboard}
            className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-indigo-600 transition-colors cursor-pointer bg-slate-100/70 hover:bg-indigo-50 px-3 py-1.5 rounded-xl border border-slate-200/60"
          >
            <ArrowLeft className="w-4 h-4 text-indigo-600" />
            <span>Dashboard</span>
          </button>

          <div className="text-center">
            <h1 className="text-xs sm:text-sm font-extrabold text-slate-900 leading-tight">Laporan Perjalanan</h1>
            <p className="text-[10px] text-slate-400 font-medium truncate max-w-[180px] sm:max-w-xs">{journey.purpose}</p>
          </div>

          <Button
            onClick={handleSaveDraft}
            disabled={isSavingDraft}
            variant="outline"
            size="sm"
            className="rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-bold text-xs h-8 px-2.5 gap-1.5 cursor-pointer"
          >
            {isSavingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5 text-indigo-600" />}
            <span className="hidden sm:inline">Simpan Draft</span>
          </Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* Toast Alert */}
        {message && (
          <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold shadow-md border bg-white border-slate-200">
            <span className={message.type === 'success' ? 'text-emerald-500' : 'text-rose-500'}>
              {message.type === 'success' ? '✓' : '⚠️'}
            </span>
            <span className="text-slate-700">{message.text}</span>
          </div>
        )}

        {/* ── Journey Card & Banner ──────────────────────────────────────── */}
        <Card className="bg-white rounded-3xl shadow-sm border border-slate-200/70 overflow-hidden">
          <DestinationImageBanner destination={journey.endPoint} cachedUrl={journey.destinationImageUrl} />
          <CardContent className="p-4 sm:p-5 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md">
                  {journey.vehicleName || 'Kendaraan'}
                </span>
                <span className="text-[10px] font-bold text-slate-400">
                  📅 {journey.journeyDate || journey.activityDate}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 leading-snug">
                {journey.purpose}
              </h2>
            </div>

            {/* Allowance overview grid */}
            <div className="grid grid-cols-3 gap-2 bg-slate-50/80 p-3 rounded-2xl border border-slate-200/60 text-xs">
              <div>
                <span className="text-[9px] text-slate-400 block font-bold uppercase">Tarif Mobil</span>
                <span className="font-extrabold text-slate-800">{fmtRp(journey.baseOperationalCost || 0)}</span>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 block font-bold uppercase">Uang Makan</span>
                <span className="font-extrabold text-indigo-600">{fmtRp(journey.mealAllowance || 0)}</span>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 block font-bold uppercase">Uang Jalan Awal</span>
                <span className="font-extrabold text-emerald-600">{fmtRp(journey.totalOperationalCost || 0)}</span>
              </div>
            </div>

            {/* ── Interactive Route Timeline ──────────────────────────── */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-800 tracking-wide uppercase flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-indigo-600" /> Rute Perjalanan (Timeline)
                </span>
                <Button
                  onClick={handleAddLocation}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs font-bold rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 px-2.5 gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Lokasi</span>
                </Button>
              </div>

              <div className="bg-slate-50/70 rounded-2xl p-4 border border-slate-200/60 space-y-3.5 relative">
                {/* Leg 1: Origin -> Destination */}
                <div className="flex items-start gap-3 relative">
                  <div className="flex flex-col items-center">
                    <div className="w-3.5 h-3.5 rounded-full bg-indigo-600 ring-4 ring-indigo-100 shrink-0 mt-0.5" />
                    <div className="w-0.5 h-12 bg-slate-300 my-1" />
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Titik Keberangkatan</span>
                    <h5 className="text-xs font-extrabold text-slate-800">🏫 {journey.startPoint}</h5>
                    <p className="text-[10px] text-slate-500 font-semibold">
                      Jarak Leg: {(journey.distanceKm || 0).toFixed(1)} km (Upah Bersih: {fmtRp((journey.distanceKm || 0) * 300)})
                    </p>
                  </div>
                </div>

                {/* Intermediate stops */}
                {extraActivities.map((act, idx) => {
                  if (act.type !== 'tambah_lokasi') return null;
                  const originName = getOriginForLocationIndex(idx);
                  return (
                    <div key={idx} className="flex items-start gap-3 relative">
                      <div className="flex flex-col items-center">
                        <div className="w-3.5 h-3.5 rounded-full bg-amber-500 ring-4 ring-amber-100 shrink-0 mt-0.5" />
                        <div className="w-0.5 h-12 bg-slate-300 my-1" />
                      </div>
                      <div className="flex-1 space-y-1 bg-white p-3 rounded-xl border border-slate-200/70 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider block">
                            Lokasi Tambahan #{idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveExtraActivity(idx)}
                            className="text-slate-400 hover:text-rose-600 p-0.5 cursor-pointer"
                            title="Hapus Lokasi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <h5 className="text-xs font-extrabold text-slate-800">
                          📍 {act.destination || 'Belum dipilih'}
                        </h5>
                        <p className="text-[10px] text-slate-400">Dari: {originName}</p>
                        {act.distanceText && (
                          <p className="text-[10px] text-emerald-600 font-bold">
                            Jarak Leg: {act.distanceText} (Upah Bersih: {fmtRp(act.legCost || 0)})
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Destination */}
                <div className="flex items-start gap-3 relative">
                  <div className="flex flex-col items-center">
                    <div className="w-3.5 h-3.5 rounded-full bg-purple-600 ring-4 ring-purple-100 shrink-0 mt-0.5" />
                    <div className="w-0.5 h-12 bg-slate-300 my-1" />
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <span className="text-[9px] font-bold text-purple-600 uppercase tracking-wider block">Tujuan Utama</span>
                    <h5 className="text-xs font-extrabold text-slate-800">🎯 {journey.endPoint}</h5>
                  </div>
                </div>

                {/* Return Leg */}
                <div className="flex items-start gap-3 relative">
                  <div className="flex flex-col items-center">
                    <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 ring-4 ring-emerald-100 shrink-0 mt-0.5" />
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider block">Titik Kepulangan</span>
                    <h5 className="text-xs font-extrabold text-slate-800">🏫 {journey.startPoint}</h5>
                    <p className="text-[10px] text-slate-500 font-semibold">
                      Jarak Leg Kepulangan: {returnLeg.distanceText} (Upah Bersih: {fmtRp(returnLeg.legCost)})
                    </p>
                  </div>
                </div>

                {isCalculatingExtraRoute && (
                  <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 animate-pulse pt-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Menghitung ulang rute dan upah...</span>
                  </div>
                )}

                {extraRouteError && (
                  <p className="text-xs text-rose-600 font-semibold pt-1">{extraRouteError}</p>
                )}
              </div>
            </div>

            {/* ── Form Inputs ─────────────────────────────────────────── */}
            <form onSubmit={handleCompleteJourneySubmit} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Jam Berangkat</Label>
                  <Input
                    type="text"
                    value={formTimeStart}
                    onChange={(e) => setFormTimeStart(e.target.value)}
                    placeholder="08:00"
                    className="rounded-xl border-slate-200 text-sm font-semibold h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Jam Tiba / Selesai</Label>
                  <Input
                    type="text"
                    value={formTimeEnd}
                    onChange={(e) => setFormTimeEnd(e.target.value)}
                    placeholder="17:00"
                    className="rounded-xl border-slate-200 text-sm font-semibold h-10"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
                <Checkbox
                  id="overnight"
                  checked={formIsOvernight}
                  onCheckedChange={(c) => setFormIsOvernight(!!c)}
                  className="rounded-md"
                />
                <Label htmlFor="overnight" className="text-xs font-bold text-slate-700 cursor-pointer">
                  Tambahan Menginap (Inap Dinas) (+Rp50.000)
                </Label>
              </div>

              {/* BBM Input & Receipts */}
              <div className="space-y-2 bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200/60">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-700">
                    BBM Terbeli <span className="text-[10px] text-slate-400 font-normal">(Jatah: {fmtRp(journey.baseOperationalCost || 0)})</span>
                  </Label>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">Rp</span>
                    <Input
                      type="text"
                      value={formFuelFee}
                      onChange={(e) => setFormFuelFee(e.target.value)}
                      placeholder="0"
                      className="pl-8 rounded-xl border-slate-200 text-sm font-bold h-10 bg-white"
                    />
                  </div>
                  <input
                    ref={fuelFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleUploadReceipt(e.target.files[0], 'bbm');
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => fuelFileInputRef.current?.click()}
                    disabled={uploadingFuelReceipt}
                    variant="outline"
                    className="rounded-xl border-slate-200 text-xs font-bold h-10 px-3 cursor-pointer bg-white"
                  >
                    {uploadingFuelReceipt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
                    <span>Upload Foto</span>
                  </Button>
                </div>
                {formFuelReceiptUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {formFuelReceiptUrls.map((url, i) => (
                      <div key={i} className="relative group">
                        <img src={url} alt="Struk BBM" className="w-14 h-14 object-cover rounded-xl border border-slate-200" />
                        <button
                          type="button"
                          onClick={() => setFormFuelReceiptUrls(formFuelReceiptUrls.filter((_, idx) => idx !== i))}
                          className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full p-0.5 shadow-md hover:bg-rose-600"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Toll & Parking Input & Receipts */}
              <div className="space-y-2 bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200/60">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-700">
                    Tol & Parkir Terbayar <span className="text-[10px] text-slate-400 font-normal">(Jatah: {fmtRp(journey.tollParkingFee || 0)})</span>
                  </Label>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">Rp</span>
                    <Input
                      type="text"
                      value={formTollParkingFee}
                      onChange={(e) => setFormTollParkingFee(e.target.value)}
                      placeholder="0"
                      className="pl-8 rounded-xl border-slate-200 text-sm font-bold h-10 bg-white"
                    />
                  </div>
                  <input
                    ref={tollFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleUploadReceipt(e.target.files[0], 'toll');
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => tollFileInputRef.current?.click()}
                    disabled={uploadingTollReceipt}
                    variant="outline"
                    className="rounded-xl border-slate-200 text-xs font-bold h-10 px-3 cursor-pointer bg-white"
                  >
                    {uploadingTollReceipt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
                    <span>Upload Foto</span>
                  </Button>
                </div>
                {formTollReceiptUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {formTollReceiptUrls.map((url, i) => (
                      <div key={i} className="relative group">
                        <img src={url} alt="Struk Tol" className="w-14 h-14 object-cover rounded-xl border border-slate-200" />
                        <button
                          type="button"
                          onClick={() => setFormTollReceiptUrls(formTollReceiptUrls.filter((_, idx) => idx !== i))}
                          className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full p-0.5 shadow-md hover:bg-rose-600"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Real-time Calculation Summary Card ─────────────────── */}
              {liveCalculations && (
                <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 text-white rounded-3xl p-4 sm:p-5 shadow-xl space-y-3.5 border border-indigo-700/50">
                  <div className="flex items-center justify-between border-b border-indigo-700/50 pb-2.5">
                    <span className="text-xs font-black uppercase tracking-wider text-indigo-200 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      Kalkulasi Otomatis (Real-time)
                    </span>
                    <span className="text-[10px] font-extrabold bg-indigo-800/80 text-indigo-200 px-2 py-0.5 rounded-md border border-indigo-700">
                      Otomatis
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Left: Total Reimburse (Delta) */}
                    <div className="bg-indigo-950/80 p-3 rounded-2xl border border-indigo-700/50 space-y-1">
                      <span className="text-[9px] font-black text-indigo-300 uppercase tracking-wider block">
                        Total Reimburse (Delta)
                      </span>
                      <span className="text-base sm:text-lg font-black text-blue-400 block">
                        {fmtRp(liveCalculations.finalReimburseDelta)}
                      </span>
                      {liveCalculations.positiveReimburseDelta > 0 && (
                        <p className="text-[9px] text-indigo-200 font-medium leading-tight">
                          Item ekstra: +{fmtRp(liveCalculations.positiveReimburseDelta)}
                        </p>
                      )}
                    </div>

                    {/* Right: Estimasi Upah Bersih */}
                    <div className="bg-emerald-950/80 p-3 rounded-2xl border border-emerald-700/50 space-y-1">
                      <span className="text-[9px] font-black text-emerald-300 uppercase tracking-wider block">
                        Estimasi Upah Bersih
                      </span>
                      <span className="text-base sm:text-lg font-black text-emerald-400 block">
                        {fmtRp(liveCalculations.finalUpahBersih)}
                      </span>
                      <p className="text-[9px] text-emerald-200 font-medium leading-tight">
                        Base: {fmtRp(liveCalculations.baseDriverWage)}
                        {liveCalculations.remainingUnspentCash > 0 && ` (-${fmtRp(liveCalculations.remainingUnspentCash)})`}
                      </p>
                    </div>
                  </div>

                  {/* Breakdown Badges */}
                  <div className="space-y-1.5 pt-1 text-[10px]">
                    {liveCalculations.extraDistanceKm > 0 && (
                      <div className="flex items-center justify-between bg-indigo-950/40 px-2.5 py-1 rounded-lg border border-indigo-800/40 text-indigo-200">
                        <span>Rute Tambahan (+{liveCalculations.extraDistanceKm.toFixed(1)} km)</span>
                        <span className="font-bold text-amber-300">+{fmtRp(liveCalculations.extraOperationalCost)}</span>
                      </div>
                    )}
                    {liveCalculations.extraMealAllowance > 0 && (
                      <div className="flex items-center justify-between bg-indigo-950/40 px-2.5 py-1 rounded-lg border border-indigo-800/40 text-indigo-200">
                        <span>Tambahan Uang Makan</span>
                        <span className="font-bold text-amber-300">+{fmtRp(liveCalculations.extraMealAllowance)}</span>
                      </div>
                    )}
                    {liveCalculations.extraFuelCost > 0 && (
                      <div className="flex items-center justify-between bg-indigo-950/40 px-2.5 py-1 rounded-lg border border-indigo-800/40 text-indigo-200">
                        <span>Kelebihan BBM</span>
                        <span className="font-bold text-amber-300">+{fmtRp(liveCalculations.extraFuelCost)}</span>
                      </div>
                    )}
                    {liveCalculations.extraTollCost > 0 && (
                      <div className="flex items-center justify-between bg-indigo-950/40 px-2.5 py-1 rounded-lg border border-indigo-800/40 text-indigo-200">
                        <span>Kelebihan Tol & Parkir</span>
                        <span className="font-bold text-amber-300">+{fmtRp(liveCalculations.extraTollCost)}</span>
                      </div>
                    )}
                    {liveCalculations.unspentCash > 0 && (
                      <div className="flex items-center justify-between bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-800/40 text-emerald-200">
                        <span>Sisa Uang Jalan Operasional</span>
                        <span className="font-bold text-emerald-300">-{fmtRp(liveCalculations.unspentCash)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Sticky Action Bar Footer ───────────────────────────── */}
              <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-lg border-t border-slate-200/80 p-3 shadow-lg">
                <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    onClick={handleCancelClaim}
                    disabled={isCancelling || submitting}
                    variant="outline"
                    className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs h-11 px-3 cursor-pointer shrink-0"
                  >
                    {isCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4 mr-1" />}
                    <span className="hidden sm:inline">Batalkan Klaim</span>
                  </Button>

                  <div className="flex items-center gap-2 flex-1 justify-end">
                    <Button
                      type="button"
                      onClick={handleSaveDraft}
                      disabled={isSavingDraft || submitting}
                      variant="outline"
                      className="rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-xs h-11 px-3 cursor-pointer"
                    >
                      {isSavingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1 text-slate-500" />}
                      <span>Draft</span>
                    </Button>

                    <Button
                      type="submit"
                      disabled={submitting}
                      className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm h-11 px-4 shadow-md shadow-indigo-200 cursor-pointer flex-1 sm:flex-initial"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          <span>Mengirim...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-1.5" />
                          <span>Kirim Laporan</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Map Location Selector Dialog */}
        {showMapSelector && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <Card className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border-none overflow-hidden">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-extrabold text-slate-900">Pilih Lokasi Tambahan</h3>
                  <button
                    onClick={() => setShowMapSelector(false)}
                    className="text-slate-400 hover:text-slate-700 p-1 rounded-full hover:bg-slate-100"
                  >
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-700">Cari Nama Tempat / Alamat</Label>
                  <div className="relative">
                    <Input
                      ref={(el) => {
                        if (el) initAutocomplete(el);
                      }}
                      type="text"
                      value={mapSearchText}
                      onChange={(e) => setMapSearchText(e.target.value)}
                      placeholder="Contoh: Rest Area KM 57, Unair Kampus C..."
                      className="rounded-xl border-slate-200 pl-9 text-xs font-medium h-10"
                    />
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  </div>
                </div>

                <div
                  ref={(el) => {
                    if (el) initMap(el);
                  }}
                  className="w-full h-56 rounded-2xl overflow-hidden border border-slate-200"
                />

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/60 text-xs">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block mb-0.5">Alamat Terpilih:</span>
                  <p className="font-extrabold text-slate-800">{mapAddress || 'Geser pin atau cari tempat'}</p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowMapSelector(false)}
                    className="rounded-xl border-slate-200 text-xs font-bold h-10"
                  >
                    Batal
                  </Button>
                  <Button
                    type="button"
                    onClick={handleConfirmMapLocation}
                    disabled={!mapAddress}
                    className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-10 px-4"
                  >
                    Gunakan Lokasi Ini
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
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
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      }
    >
      <JourneyReportContent />
    </Suspense>
  );
}
