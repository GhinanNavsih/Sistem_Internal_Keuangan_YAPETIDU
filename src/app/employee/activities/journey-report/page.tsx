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
  CheckCircle2,
  Eye,
  AlertCircle,
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

function fmtRp(val: number): string {
  return 'Rp' + Math.ceil(val).toLocaleString('id-ID');
}

function getTodayISO(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
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

  const [activeReportingJourney, setActiveReportingJourney] = useState<any | null>(null);
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
          setActiveReportingJourney(data);
          setFormDate(data.journeyDate || data.activityDate || new Date().toISOString().split('T')[0]);
          setExtraActivities(data.draftExtraActivities || []);
          setFormTimeStart(data.draftTimeStart || '08:00');
          setFormTimeEnd(data.draftTimeEnd || '17:00');
          setFormFuelFee(data.draftFuelFee ? Number(data.draftFuelFee).toLocaleString('id-ID') : '');
          setFormTollParkingFee(data.draftTollParkingFee ? Number(data.draftTollParkingFee).toLocaleString('id-ID') : '');

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

  const recalculateRouteChain = async (list: any[]) => {
    if (!activeReportingJourney) return;
    const extraLocs = list.filter(a => a.type === 'tambah_lokasi' && a.destination);
    if (extraLocs.length === 0) {
      setCalculatedDistanceKm((activeReportingJourney.distanceKm || 0) * 2);
      setCalculatedDurationHours((activeReportingJourney.durationHours || 0) * 2);
      return;
    }

    setIsCalculatingExtraRoute(true);
    setExtraRouteError('');
    try {
      const points = [
        activeReportingJourney.startPoint,
        activeReportingJourney.endPoint,
        ...extraLocs.map(l => l.destination),
        activeReportingJourney.startPoint
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

  const getReturnLegDetails = () => {
    if (!activeReportingJourney) return { distanceText: '', legCost: 0, distanceKm: 0, durationHours: 0 };
    const d0 = activeReportingJourney.distanceKm || 0;
    const dur0 = activeReportingJourney.durationHours || 0;
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
    const returnCost = returnDist * (activeReportingJourney.vehicleRate || 0);

    return {
      distanceText: `${returnDist.toFixed(1)} km`,
      legCost: returnCost,
      distanceKm: returnDist,
      durationHours: returnDur
    };
  };

  const handleSaveDraft = async () => {
    if (!activeReportingJourney) return;
    setIsSavingDraft(true);
    try {
      const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
      const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;
      const journeyRef = doc(db, 'DriverJourneys', activeReportingJourney.id);
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
    if (!activeReportingJourney) return;
    const isBbm = type === 'bbm';
    if (isBbm) setUploadingFuelReceipt(true);
    else setUploadingTollReceipt(true);

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
      if (isBbm) setUploadingFuelReceipt(false);
      else setUploadingTollReceipt(false);
    }
  };

  const handleCancelClaim = async () => {
    if (!activeReportingJourney || isCancelling) return;
    if (!confirm('Apakah Anda yakin ingin membatalkan klaim perjalanan ini? Perjalanan akan dikembalikan ke Pool.')) {
      return;
    }

    setIsCancelling(true);
    skipSaveDraftRef.current = true;
    try {
      const journeyRef = doc(db, 'DriverJourneys', activeReportingJourney.id);
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

      const isNdalem = activeReportingJourney.vehicleName === 'Ndalem';
      const originalTotalDist = (activeReportingJourney.distanceKm || 0) * 2;
      const extraDistanceKm = Math.max(0, calculatedDistanceKm - originalTotalDist);
      const extraOperationalCost = Math.ceil(extraDistanceKm * (activeReportingJourney.vehicleRate || 0));

      const preAuthorizedDurationPP = activeReportingJourney.customDurationPP || (activeReportingJourney.durationHours ? activeReportingJourney.durationHours * 2 : 0);
      const preAuthorizedMeal = isNdalem
        ? 0
        : (activeReportingJourney.mealAllowance !== undefined && activeReportingJourney.mealAllowance !== null && activeReportingJourney.mealAllowance > 0
            ? activeReportingJourney.mealAllowance
            : getMealAllowanceForDuration(preAuthorizedDurationPP));

      const baseCostVal = activeReportingJourney.baseOperationalCost ||
        ((activeReportingJourney.totalOperationalCost || 0) - (activeReportingJourney.mealAllowance || 0) - (activeReportingJourney.tollParkingFee || 0));
      const preAuthorizedToll = activeReportingJourney.tollParkingFee || 0;
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

      const journeyRef = doc(db, 'DriverJourneys', activeReportingJourney.id);
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
        authorizedAt: activeReportingJourney.authorizedAt || activeReportingJourney.createdAt || null,
        journeyDate: activeReportingJourney.journeyDate || activeReportingJourney.activityDate || null,
        claimedAt: activeReportingJourney.claimedAt || null,
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
        totalOperationalCost: activeReportingJourney.totalOperationalCost || 0,
        vehicleRate: activeReportingJourney.vehicleRate || 741,
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

  if (!activeReportingJourney) return null;

  const returnLeg = getReturnLegDetails();

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-24 text-slate-800 relative">
      {/* ── Top Header Bar ─────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 sticky top-0 z-30 shadow-md">
        <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <button
            onClick={handleBackToDashboard}
            className="flex items-center gap-2 text-xs font-bold text-white hover:text-indigo-100 transition-colors cursor-pointer bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl border border-white/20"
          >
            <ArrowLeft className="w-4 h-4 text-white" />
            <span>Dashboard</span>
          </button>

          <div className="flex items-center gap-2 text-white font-bold text-sm sm:text-base">
            <CheckCircle2 className="w-5 h-5 text-white" />
            <span>Laporan Perjalanan</span>
          </div>

          <Button
            onClick={handleSaveDraft}
            disabled={isSavingDraft}
            variant="ghost"
            size="sm"
            className="rounded-xl border border-white/30 text-white hover:bg-white/20 font-bold text-xs h-8 px-2.5 gap-1.5 cursor-pointer"
          >
            {isSavingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5 text-white" />}
            <span className="hidden sm:inline">Simpan Draft</span>
          </Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        {/* Toast Alert */}
        {message && (
          <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold shadow-md border bg-white border-slate-200">
            <span className={message.type === 'success' ? 'text-emerald-500' : 'text-rose-500'}>
              {message.type === 'success' ? '✓' : '⚠️'}
            </span>
            <span className="text-slate-700">{message.text}</span>
          </div>
        )}

        <form onSubmit={handleCompleteJourneySubmit} className="space-y-4">
          
          {/* Keperluan, Kendaraan & Tanggal Header Card */}
          {(() => {
            const baseCostVal = activeReportingJourney.baseOperationalCost ||
              ((activeReportingJourney.totalOperationalCost || 0) - (activeReportingJourney.mealAllowance || 0) - (activeReportingJourney.tollParkingFee || 0));
            const mealAllowanceVal = activeReportingJourney.mealAllowance || 0;
            const totalBaseline = activeReportingJourney.totalOperationalCost || 0;

            return (
              <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs text-xs font-semibold text-slate-500 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div>Keperluan: <strong className="text-slate-700 font-extrabold">{activeReportingJourney.activityName}</strong></div>
                    <div className="text-slate-300">•</div>
                    <div>Kendaraan: <strong className="text-slate-700 font-extrabold">{activeReportingJourney.vehicleName}</strong></div>
                    <div className="text-slate-300">•</div>
                    <div>
                      Tanggal: <strong className="text-slate-700 font-extrabold">
                        {(() => {
                          const d = formDate || activeReportingJourney.activityDate || getTodayISO();
                          return new Date(d.includes('T') ? d : `${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                        })()}
                      </strong>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-200/60 flex flex-wrap justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider gap-2">
                    <div className="flex gap-4">
                      <span>Tarif Kendaraan: <strong className="text-blue-600 normal-case font-black">{fmtRp(Math.ceil(baseCostVal))}</strong></span>
                      <span>Uang Makan: <strong className="text-blue-600 normal-case font-black">{fmtRp(Math.ceil(mealAllowanceVal))}</strong></span>
                    </div>
                    <div>
                      Uang Jalan Awal: <strong className="text-blue-600 normal-case font-black text-xs">{fmtRp(Math.ceil(totalBaseline))}</strong>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Unified Route Timeline Card */}
            {(() => {
              const d0 = activeReportingJourney.distanceKm || 0;
              const wage0 = (d0 * 300) + ((activeReportingJourney.durationHours || 0) * 5000);

              return (
              <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-indigo-700 uppercase tracking-wider">
                      <Compass className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                      Rute Perjalanan (Timeline)
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddLocation}
                      className="h-6 px-2 text-[9px] font-bold border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                    >
                      + Tambah Lokasi
                    </Button>
                  </div>

                  <div className="relative pl-6 space-y-4">
                    <div className="absolute left-[9px] top-2 bottom-2 w-0.5 border-l-2 border-dashed border-indigo-200" />

                    {/* Node 0: Start */}
                    <div className="relative flex items-start gap-2.5 text-xs">
                      <div className="absolute -left-[20px] top-1 w-3 h-3 rounded-full bg-indigo-600 border-2 border-white shadow-sm" />
                      <div className="space-y-0.5 min-w-0">
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">Titik Keberangkatan</span>
                        <div className="font-extrabold text-slate-700 truncate" title={activeReportingJourney.startPoint}>
                          🏫 {activeReportingJourney.startPoint.split(',')[0]}
                        </div>
                        <div className="text-[9px] text-slate-400 font-medium">
                          Jarak Leg: {d0.toFixed(1)} km (Upah Bersih: <span className="text-emerald-600 font-bold">{fmtRp(Math.ceil(wage0))}</span>)
                        </div>
                      </div>
                    </div>

                    {/* Node 1: Main Destination */}
                    <div className="relative flex items-start gap-2.5 text-xs">
                      <div className="absolute -left-[20px] top-1 w-3 h-3 rounded-full bg-indigo-600 border-2 border-white shadow-sm" />
                      <div className="space-y-0.5 min-w-0">
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">Tujuan Utama</span>
                        <div className="font-extrabold text-slate-700 truncate" title={activeReportingJourney.endPoint}>
                          🎯 {activeReportingJourney.endPoint}
                        </div>
                      </div>
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
                                <span className="text-[8px] uppercase tracking-wider text-teal-600 font-bold block">Tujuan Tambahan</span>
                                <div className="text-xs font-black text-slate-700 truncate" title={act.destination}>
                                  📍 {act.destination.split(',')[0]}
                                </div>
                                {act.distanceText && act.distanceKm !== undefined && (
                                  <div className="text-[9px] text-slate-400 font-medium">
                                    Jarak Leg: {act.distanceText} (Upah Bersih: <span className="text-emerald-600 font-bold">{fmtRp(Math.ceil((act.distanceKm * 300) + ((act.durationHours || 0) * 5000)))}</span>)
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-xs font-semibold text-slate-400 italic">
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
                              className="text-[10px] font-bold text-indigo-700 hover:text-indigo-800 bg-white border border-slate-200 px-2.5 h-7 rounded-lg cursor-pointer"
                            >
                              {act.destination ? 'Ubah' : 'Pilih'}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => handleRemoveExtraActivity(index)}
                              className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Final Node: Return to Start */}
                    <div className="relative flex items-start gap-2.5 text-xs">
                      <div className="absolute -left-[20px] top-1 w-3 h-3 rounded-full bg-indigo-600 border-2 border-white shadow-sm" />
                      <div className="space-y-0.5 min-w-0">
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">Titik Kepulangan</span>
                        <div className="font-extrabold text-slate-700 truncate" title={activeReportingJourney.startPoint}>
                          🏫 {activeReportingJourney.startPoint.split(',')[0]}
                        </div>
                        <div className="text-[9px] text-slate-400 font-medium">
                          Jarak Leg: {returnLeg.distanceText} (Upah Bersih: <span className="text-emerald-600 font-bold">{fmtRp(Math.ceil((returnLeg.distanceKm * 300) + ((returnLeg.durationHours || 0) * 5000)))}</span>)
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              );
            })()}

            {/* Input Data & Pengeluaran Operasional Card */}
            <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
              {/* Jam Berangkat / Tiba */}
              <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="journeyTimeStart" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Jam Berangkat
                </Label>
                <Input
                  id="journeyTimeStart"
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="HH:MM"
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
                  className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-sm h-10 px-3"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="journeyTimeEnd" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Jam Tiba / Selesai
                </Label>
                <Input
                  id="journeyTimeEnd"
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="HH:MM"
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
                  className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-sm h-10 px-3"
                  required
                />
              </div>
            </div>

            {/* Loader for API Recalculation */}
            {isCalculatingExtraRoute && (
              <div className="flex items-center justify-center p-2 text-[10px] text-indigo-600 font-bold bg-indigo-50/50 rounded-lg border border-indigo-100/50 mt-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5 text-indigo-600" />
                Menghitung rute tambahan...
              </div>
            )}

            {extraRouteError && (
              <div className="p-2 text-[10px] bg-rose-50 border border-rose-200 text-rose-700 rounded-lg font-semibold flex items-center gap-2 mt-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>{extraRouteError}</span>
              </div>
            )}

            {/* Reimburse BBM Row */}
            {activeReportingJourney.vehicleName === 'Ndalem' ? (
              <div className="p-3.5 bg-amber-50/60 border border-amber-100/60 rounded-2xl text-[11px] font-bold text-amber-800 leading-relaxed flex items-start gap-2.5">
                <span className="text-base leading-none">ℹ️</span>
                <span>Perjalanan Ndalem: Pengeluaran bensin & uang makan ditanggung oleh Ndalem. Tidak ada reimbursement bensin/uang makan dari kantor.</span>
              </div>
            ) : (
              (() => {
                const baseCostVal = activeReportingJourney.baseOperationalCost ||
                  ((activeReportingJourney.totalOperationalCost || 0) - (activeReportingJourney.mealAllowance || 0) - (activeReportingJourney.tollParkingFee || 0));
                return (
                  <div className="space-y-2">
                    <Label htmlFor="journeyFuel" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      BBM Terbeli <span className="text-blue-600 font-extrabold normal-case tracking-normal">({`Jatah: ${fmtRp(Math.ceil(baseCostVal))}`})</span>
                    </Label>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">Rp</span>
                        <Input
                          id="journeyFuel"
                          placeholder="0"
                          value={formFuelFee}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '');
                            setFormFuelFee(val ? Number(val).toLocaleString('id-ID') : '');
                          }}
                          className="pl-8 rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-xs h-10 w-full"
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
                          className={`w-full rounded-xl text-[11px] sm:text-xs font-bold h-10 px-2 flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${formFuelReceiptUrls.length > 0
                            ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 shadow-sm'
                            }`}
                        >
                          {uploadingFuelReceipt ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto text-slate-500" />
                          ) : formFuelReceiptUrls.length > 0 ? (
                            <>
                              <Plus className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
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

                    {formFuelReceiptUrls.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {formFuelReceiptUrls.map((url, index) => (
                          <div key={index} className="flex items-center justify-between gap-2 p-2 bg-emerald-50/80 border border-emerald-200 rounded-xl text-[11px]">
                            <div className="flex items-center gap-1.5 truncate font-bold text-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span className="truncate">
                                Bukti BBM {formFuelReceiptUrls.length > 1 ? `#${index + 1}` : 'terunggah'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] flex items-center gap-1 shadow-sm transition-colors"
                              >
                                <Eye className="w-3 h-3" /> Lihat
                              </a>
                              <button
                                type="button"
                                onClick={() => setFormFuelReceiptUrls(prev => prev.filter((_, i) => i !== index))}
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
              const preAuthorizedTollVal = activeReportingJourney ? (activeReportingJourney.tollParkingFee || 0) : 0;
              return (
                <div className="space-y-2">
                  <Label htmlFor="journeyToll" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Tol & Parkir Terbayar <span className="text-blue-600 font-extrabold normal-case tracking-normal">({`Jatah: ${fmtRp(Math.ceil(preAuthorizedTollVal))}`})</span>
                  </Label>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">Rp</span>
                      <Input
                        id="journeyToll"
                        placeholder="0"
                        value={formTollParkingFee}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          setFormTollParkingFee(val ? Number(val).toLocaleString('id-ID') : '');
                        }}
                        className="pl-8 rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-xs h-10 w-full"
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
                          ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200 shadow-sm'
                          }`}
                      >
                        {uploadingTollReceipt ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto text-slate-500" />
                        ) : formTollReceiptUrls.length > 0 ? (
                          <>
                            <Plus className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
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
                        <div key={index} className="flex items-center justify-between gap-2 p-2 bg-emerald-50/80 border border-emerald-200 rounded-xl text-[11px]">
                          <div className="flex items-center gap-1.5 truncate font-bold text-emerald-800">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">
                              Bukti Tol & Parkir {formTollReceiptUrls.length > 1 ? `#${index + 1}` : 'terunggah'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] flex items-center gap-1 shadow-sm transition-colors"
                            >
                              <Eye className="w-3 h-3" /> Lihat
                            </a>
                            <button
                              type="button"
                              onClick={() => setFormTollReceiptUrls(prev => prev.filter((_, i) => i !== index))}
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
              const extraOperationalCost = Math.ceil(extraDistanceKm * (activeReportingJourney.vehicleRate || 0));

              const originalMealAllowance = activeReportingJourney.mealAllowance || 0;
              const elapsedHours = (formTimeStart && formTimeEnd) ? calculateElapsedHours(formTimeStart, formTimeEnd) : 0;
              const actualMealAllowance = isNdalem ? 0 : ((formTimeStart && formTimeEnd) ? getMealAllowanceForDuration(elapsedHours) : originalMealAllowance);
              const extraMealAllowance = isNdalem ? 0 : Math.max(0, actualMealAllowance - originalMealAllowance);

              const baseCostVal = activeReportingJourney.baseOperationalCost ||
                ((activeReportingJourney.totalOperationalCost || 0) - (activeReportingJourney.mealAllowance || 0) - (activeReportingJourney.tollParkingFee || 0));

              const fuelVal = formFuelFee ? (parseInt(formFuelFee.replace(/\D/g, ''), 10) || 0) : 0;
              const tollVal = formTollParkingFee ? (parseInt(formTollParkingFee.replace(/\D/g, ''), 10) || 0) : 0;

              const extraFuelCost = isNdalem ? 0 : Math.max(0, fuelVal - baseCostVal);

              return (
                <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs text-slate-600 text-xs space-y-2 font-medium">
                  <span className="text-[9px] font-bold text-indigo-800 uppercase tracking-wider block mb-1">
                    Kalkulasi Penyesuaian & Biaya Akhir
                  </span>
                  {(() => {
                    const getStratumLabel = (allowance: number, hours: number): string => {
                      if (allowance === 5000) return '<2';
                      if (allowance === 20000) return '2 - 6';
                      if (allowance === 40000) return '6 - 12';
                      if (allowance === 60000) return '>12';
                      if (hours > 0 && hours < 2) return '<2';
                      if (hours >= 2 && hours <= 6) return '2 - 6';
                      if (hours > 6 && hours <= 12) return '6 - 12';
                      if (hours > 12) return '>12';
                      return '<2';
                    };

                    const preAuthorizedDurationPP = activeReportingJourney.customDurationPP || (activeReportingJourney.durationHours ? activeReportingJourney.durationHours * 2 : 0);
                    const preAuthorizedMeal = isNdalem
                      ? 0
                      : (activeReportingJourney.mealAllowance !== undefined && activeReportingJourney.mealAllowance !== null && activeReportingJourney.mealAllowance > 0
                          ? activeReportingJourney.mealAllowance
                          : getMealAllowanceForDuration(preAuthorizedDurationPP));

                    const plotStrata = getStratumLabel(preAuthorizedMeal, preAuthorizedDurationPP);
                    const actualStrata = getStratumLabel(actualMealAllowance, elapsedHours);

                    return (
                      <div className="overflow-x-auto border border-indigo-100/50 rounded-xl bg-white p-2.5 my-2">
                        <table className="w-full text-[10px] text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider text-[8px]">
                              <th className="pb-1.5 font-bold">Aspek</th>
                              <th className="pb-1.5 font-bold text-center">Plotingan</th>
                              <th className="pb-1.5 font-bold text-center">Aktual</th>
                              <th className="pb-1.5 font-bold text-right">Delta</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 text-slate-600 font-semibold">
                            <tr>
                              <td className="py-2 text-slate-500 font-bold">Jarak</td>
                              <td className="py-2 text-center font-bold text-slate-700">{originalTotalDist.toFixed(1)} km</td>
                              <td className="py-2 text-center font-bold text-indigo-600">{calculatedDistanceKm.toFixed(1)} km</td>
                              <td className="py-2 text-right font-black text-indigo-700">
                                {extraDistanceKm > 0 ? (
                                  <span>+{extraDistanceKm.toFixed(1)} km</span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 text-slate-500 font-bold">BBM</td>
                              <td className="py-2 text-center font-bold text-slate-700"><span className="text-blue-600">{fmtRp(Math.ceil(baseCostVal))}</span></td>
                              <td className="py-2 text-center font-bold text-blue-600">{fmtRp(Math.ceil(fuelVal))}</td>
                              <td className="py-2 text-right font-black text-blue-700">
                                {extraFuelCost > 0 ? (
                                  <span>+{fmtRp(Math.ceil(extraFuelCost))}</span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 text-slate-500 font-bold">Uang Makan</td>
                              <td className="py-2 text-center font-bold text-slate-700">{plotStrata}</td>
                              <td className="py-2 text-center font-bold text-indigo-600">{actualStrata}</td>
                              <td className="py-2 text-right font-black text-blue-700">
                                {extraMealAllowance > 0 ? (
                                  <span>+{fmtRp(Math.ceil(extraMealAllowance))}</span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}

                  {extraFuelCost > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Kelebihan BBM (Delta)</span>
                      <span className="font-bold text-blue-600">+{fmtRp(Math.ceil(extraFuelCost))}</span>
                    </div>
                  )}
                  {extraMealAllowance > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Kelebihan Uang Makan (Delta)</span>
                      <span className="font-bold text-blue-600">+{fmtRp(Math.ceil(extraMealAllowance))}</span>
                    </div>
                  )}
                  {(() => {
                    const preAuthorizedToll = activeReportingJourney.tollParkingFee || 0;
                    const extraToll = tollVal - preAuthorizedToll;
                    if (extraToll > 0) {
                      return (
                        <div className="flex justify-between text-slate-500">
                          <span>{preAuthorizedToll > 0 ? 'Kelebihan Tol & Parkir (Delta)' : 'Reimburse Tol & Parkir'}</span>
                          <span className="font-bold text-blue-600">+{fmtRp(Math.ceil(extraToll))}</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {(() => {
                    const preAuthorizedDurationPP = activeReportingJourney.customDurationPP || (activeReportingJourney.durationHours ? activeReportingJourney.durationHours * 2 : 0);
                    const preAuthorizedMeal = isNdalem
                      ? 0
                      : (activeReportingJourney.mealAllowance !== undefined && activeReportingJourney.mealAllowance !== null && activeReportingJourney.mealAllowance > 0
                          ? activeReportingJourney.mealAllowance
                          : getMealAllowanceForDuration(preAuthorizedDurationPP));

                    const preAuthorizedToll = activeReportingJourney.tollParkingFee || 0;
                    const totalPreAuthorizedAllowance = baseCostVal + preAuthorizedToll;
                    const totalActualSpent = fuelVal + tollVal;

                    const extraTollCost = Math.max(0, tollVal - preAuthorizedToll);
                    const positiveReimburseDelta = extraMealAllowance + extraFuelCost + extraTollCost + extraOperationalCost;
                    const unspentCash = Math.max(0, totalPreAuthorizedAllowance - totalActualSpent);

                    const finalReimburseDelta = Math.max(0, positiveReimburseDelta - unspentCash);
                    const remainingUnspentCash = Math.max(0, unspentCash - positiveReimburseDelta);

                    const baseDriverWage = calculatedDistanceKm * 300 + calculatedDurationHours * 5000 + (formIsOvernight ? 50000 : 0);
                    const finalUpahBersih = Math.max(0, baseDriverWage - remainingUnspentCash);

                    return (
                      <>
                        <div className="pt-2 border-t border-blue-200/50 flex justify-between font-black text-blue-600 text-sm">
                          <span>Total Reimburse (Delta)</span>
                          <span>{fmtRp(Math.ceil(finalReimburseDelta))}</span>
                        </div>
                        {unspentCash > 0 && (
                          <div className="flex justify-between text-slate-400 text-[10px] font-semibold pl-2">
                            <span>• Penghematan Uang Jalan Operasional</span>
                            <span className="text-amber-600 font-bold">-{fmtRp(Math.ceil(unspentCash))}</span>
                          </div>
                        )}

                        <div className="pt-1.5 border-t border-emerald-200/50 flex justify-between font-black text-emerald-700 text-xs">
                          <span>Upah Bersih Sopir</span>
                          <span>{fmtRp(Math.ceil(finalUpahBersih))}</span>
                        </div>
                        <div className="flex justify-between text-slate-400 text-[10px] font-semibold pl-2">
                          <span>• Komponen Jarak ({calculatedDistanceKm.toFixed(1)} km)</span>
                          <span>{fmtRp(Math.ceil(calculatedDistanceKm * 300))}</span>
                        </div>
                        <div className="flex justify-between text-slate-400 text-[10px] font-semibold pl-2">
                          <span>• Komponen Waktu ({calculatedDurationHours.toFixed(1)} jam)</span>
                          <span>{fmtRp(Math.ceil(calculatedDurationHours * 5000))}</span>
                        </div>
                        {formIsOvernight && (
                          <div className="flex justify-between text-slate-400 text-[10px] font-semibold pl-2">
                            <span>• Tambahan Menginap (Inap Dinas)</span>
                            <span>{fmtRp(50000)}</span>
                          </div>
                        )}
                        {remainingUnspentCash > 0 && (
                          <div className="flex justify-between text-amber-600 text-[10px] font-bold pl-2">
                            <span>• Potongan Sisa Kas Operasional (ke Upah Bersih)</span>
                            <span>-{fmtRp(Math.ceil(remainingUnspentCash))}</span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              );
            })()}

            {/* Bottom Form Actions */}
            <div className="pt-2 flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                onClick={handleCancelClaim}
                disabled={isCancelling || submitting}
                variant="outline"
                className="w-full sm:w-auto rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs h-10 px-4 cursor-pointer"
              >
                {isCancelling ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1 text-rose-500" />}
                <span>Batalkan Klaim Perjalanan</span>
              </Button>

              <div className="flex gap-2 flex-1 justify-end">
                <Button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={isSavingDraft || submitting}
                  variant="outline"
                  className="flex-1 sm:flex-initial rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-xs h-10 px-4 cursor-pointer"
                >
                  {isSavingDraft ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1 text-slate-500" />}
                  <span>Simpan Draft</span>
                </Button>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 sm:flex-initial rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm h-10 px-5 cursor-pointer shadow-md shadow-indigo-100 border-none"
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
