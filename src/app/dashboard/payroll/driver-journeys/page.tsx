"use client";

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import SatkerPekaryaNavBar from '@/components/SatkerPekaryaNavBar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  Plus,
  Loader2,
  Trash2,
  AlertCircle,
  MapPin,
  Car,
  Compass,
  ArrowRight,
  Search,
  CheckCircle2,
  Pencil,
  Calendar,
  XCircle,
  CalendarDays,
  UserCheck,
  Users,
  Check,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { DriverPiketSchedule, PIKET_STATIONS, PiketStationKey } from '@/lib/payroll/driverPiket';
import { getMealAllowanceForDuration } from '@/lib/payroll/driverJourney';
import { authenticatedJson } from '@/lib/payroll/client';
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  setDoc,
  doc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';

const VEHICLE_RATES = {
  'Bis': 2500,
  'Elf': 1350,
  'Kijang LGX': 1200,
  'Innova Hitam': 1250,
  'Innova Matic': 1450,
  'Suzuki XL7': 1000,
  'Ndalem': 0,
};

function fmtRp(val: number): string {
  return 'Rp' + Math.round(val).toLocaleString('id-ID');
}

function formatIndonesianDate(dateStr: string): string {
  if (!dateStr) return 'Tanpa Tanggal';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const dateObj = new Date(year, month, day);
  return dateObj.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function getJourneyDate(j: any): string {
  if (j.activityDate) return j.activityDate;

  // Fallback to ID-based date if activityDate is missing
  if (j.id && j.id.startsWith('JRN-')) {
    const parts = j.id.split('-');
    if (parts.length >= 2 && parts[1].length === 8) {
      const ymd = parts[1];
      const y = ymd.slice(0, 4);
      const m = ymd.slice(4, 6);
      const d = ymd.slice(6, 8);
      return `${y}-${m}-${d}`;
    }
  }

  // Second fallback to createdAt
  if (j.createdAt?.seconds) {
    const d = new Date(j.createdAt.seconds * 1000);
    return d.toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

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

function DriverJourneysContent() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read URL params
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10);
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10);
  const periodToken = `${year}-${String(month).padStart(2, '0')}`;

  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog & Form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingJourneyId, setEditingJourneyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [activityName, setActivityName] = useState('');
  const [activityDate, setActivityDate] = useState(new Date().toISOString().slice(0, 10));
  const [startPoint, setStartPoint] = useState('UNIPDU Jombang, Jawa Timur');
  const [endPoint, setEndPoint] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<keyof typeof VEHICLE_RATES>('Suzuki XL7');
  const [tollFee, setTollFee] = useState<string>('');

  // Driver Assignment States
  const [drivers, setDrivers] = useState<any[]>([]);
  const [assignedDriverId, setAssignedDriverId] = useState<string>('');

  // Piket Schedule States
  const [activeTab, setActiveTab] = useState<'journeys' | 'piket'>('journeys');
  const [piketSchedules, setPiketSchedules] = useState<DriverPiketSchedule[]>([]);
  const [selectedPiketDate, setSelectedPiketDate] = useState<string | null>(null);
  const [showPiketDialog, setShowPiketDialog] = useState(false);
  const [savingPiket, setSavingPiket] = useState(false);

  // Real-time listener for Driver Piket Schedules in current period
  useEffect(() => {
    const q = query(
      collection(db, 'DriverPiketSchedules'),
      where('period', '==', periodToken)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DriverPiketSchedule));
        setPiketSchedules(list);
      },
      (err) => {
        console.error('Error fetching driver piket schedules:', err);
      }
    );
    return () => unsub();
  }, [periodToken]);

  const daysInMonth = useMemo(() => {
    return new Date(year, month, 0).getDate();
  }, [year, month]);

  const firstDayOffset = useMemo(() => {
    const day = new Date(year, month - 1, 1).getDay();
    return (day + 6) % 7; // Monday = 0, ..., Sunday = 6
  }, [year, month]);

  const getScheduleForStation = (dateStr: string, stationKey: PiketStationKey, fallbackIdx: number) => {
    const byKey = piketSchedules.find((s) => s.date === dateStr && s.stationKey === stationKey);
    if (byKey) return byKey;
    const unkeyed = piketSchedules.filter((s) => s.date === dateStr && !s.stationKey);
    return unkeyed[fallbackIdx] || null;
  };

  const assignDriverToStation = async (stationKey: PiketStationKey, stationName: string, driverId: string) => {
    if (!selectedPiketDate) return;
    setSavingPiket(true);
    try {
      const docId = `PIKET-${selectedPiketDate}-${stationKey}`;
      const docRef = doc(db, 'DriverPiketSchedules', docId);

      if (!driverId || driverId === 'unassigned') {
        await deleteDoc(docRef);
      } else {
        // Prevent assigning a driver who is already picked in another station on this date
        const conflict = piketSchedules.find(
          (s) => s.date === selectedPiketDate && s.driverId === driverId && (s.stationKey ? s.stationKey !== stationKey : s.id !== docId)
        );
        if (conflict) {
          setMessage({
            type: 'error',
            text: `Sopir ini sudah ditugaskan pada stasiun ${conflict.stationName || 'lain'} untuk tanggal ini.`
          });
          return;
        }

        const selectedDriver = drivers.find((d) => d.id === driverId);
        const driverName = selectedDriver?.name || selectedDriver?.personal_info?.name || selectedDriver?.displayName || driverId;
        await setDoc(docRef, {
          id: docId,
          period: periodToken,
          date: selectedPiketDate,
          stationKey,
          stationName,
          driverId,
          driverName,
          assignedBy: profile?.displayName || profile?.email || 'Kepala SatKer',
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error('Error assigning driver to piket station:', err);
      setMessage({ type: 'error', text: 'Gagal memperbarui jadwal piket.' });
    } finally {
      setSavingPiket(false);
    }
  };

  useEffect(() => {
    const fetchDrivers = async () => {
      try {
        const q = query(
          collection(db, 'Employees_BlueCollar'),
          where('employment.status', '==', 'active'),
          where('employment.jobCategory', '==', 'SOPIR')
        );
        const snap = await getDocs(q);
        const list = snap.docs.map((d: any) => {
          const data = d.data();
          const name = data.personal_info?.name || data.name || data.displayName || d.id;
          return { id: d.id, ...data, name };
        });
        setDrivers(list);
      } catch (err) {
        console.error('Error fetching drivers:', err);
      }
    };
    fetchDrivers();
  }, []);

  const getDriverStatus = (empId: string) => {
    const activeCount = journeys.filter(j => (j.employeeId === empId || j.assignedTo === empId) && j.status === 'claimed').length;
    const assignedCount = journeys.filter(j => j.assignedTo === empId && j.status === 'assigned').length;
    return { activeCount, assignedCount };
  };

  // Calculated preview states
  const [calcDistance, setCalcDistance] = useState<number | null>(null);
  const [calcDuration, setCalcDuration] = useState<number | null>(null); // Google Maps one-way duration
  const [inputDuration, setInputDuration] = useState<number | null>(null); // User editable PP duration
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState('');

  // Google Maps selector modal states
  const [showMapSelector, setShowMapSelector] = useState(false);
  const [mapSearchText, setMapSearchText] = useState('');
  const [mapAddress, setMapAddress] = useState('');
  const [mapAddressImage, setMapAddressImage] = useState<string | null>(null);
  const [mapTarget, setMapTarget] = useState<'start' | 'end'>('end');

  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);
  const mapElementRef = React.useRef<HTMLDivElement | null>(null);
  const lastCalculatedRef = React.useRef<{ start: string; end: string }>({ start: '', end: '' });

  // Dynamic preview calculations for meal allowance (Option 2: Flat Rate based on Duration)
  const totalDurationPP = inputDuration !== null ? inputDuration : (calcDuration ? calcDuration * 2 : 0);
  const dynamicMealAllowance = selectedVehicle === 'Ndalem'
    ? 0
    : getMealAllowanceForDuration(totalDurationPP, selectedVehicle);

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

      const existingAddress = mapTarget === 'start' ? startPoint : endPoint;
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

  // ── Real-time listener for Journeys ──
  useEffect(() => {
    setLoading(true);
    const q = query(
      collection(db, 'DriverJourneys'),
      where('period', '==', periodToken)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        // Sort newest first
        list.sort((a: any, b: any) => {
          const aTime = a.createdAt?.seconds || 0;
          const bTime = b.createdAt?.seconds || 0;
          return bTime - aTime;
        });
        setJourneys(list);
        setLoading(false);
      },
      (err) => {
        console.error('Error fetching driver journeys:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [periodToken]);

  // ── Automatic debounced route calculation ──
  useEffect(() => {
    if (!startPoint.trim() || !endPoint.trim()) {
      setCalcDistance(null);
      setCalcDuration(null);
      return;
    }

    // Skip only if we already successfully calculated distance for these exact points
    if (
      lastCalculatedRef.current.start === startPoint &&
      lastCalculatedRef.current.end === endPoint &&
      calcDistance !== null
    ) {
      return;
    }

    const timer = setTimeout(() => {
      const calculateRoute = async () => {
        setCalculating(true);
        setCalcError('');
        try {
          if (!user) throw new Error('Sesi tidak ditemukan.');
          const idToken = await user.getIdToken();
          const response = await fetch('/api/calculate-route', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ points: [startPoint, endPoint] }),
          });
          const data = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Gagal menghitung rute.');
          }

          setCalcDistance(data.distanceKm);
          setCalcDuration(data.durationHours);
          setInputDuration(data.durationHours * 2);
          lastCalculatedRef.current = { start: startPoint, end: endPoint };
        } catch (err: any) {
          console.error(err);
          setCalcError(err.message || 'Terjadi kesalahan jaringan.');
        } finally {
          setCalculating(false);
        }
      };

      calculateRoute();
    }, 600);

    return () => clearTimeout(timer);
  }, [startPoint, endPoint, user]);

  // ── Submit Journey Creation ──
  const handleCreateJourney = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activityName.trim() || !startPoint.trim() || !endPoint.trim() || calcDistance === null) {
      setMessage({ type: 'error', text: 'Pastikan rute telah dihitung dan Nama Kegiatan diisi.' });
      return;
    }

    setSaving(true);
    try {
      const tollFeeVal = tollFee ? parseInt(tollFee.replace(/\D/g, ''), 10) || 0 : 0;

      let journeyId = editingJourneyId;
      if (!journeyId) {
        // Unique Journey ID: JRN-[Date]-[RandomSuffix]
        const dateSanitized = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        journeyId = `JRN-${dateSanitized}-${randomSuffix}`;
      }

      const durPP = totalDurationPP;

      await authenticatedJson('/api/driver-journeys', {
        method: 'POST',
        body: JSON.stringify({
          action: 'authorize',
          journeyId,
          period: periodToken,
          activityName: activityName.trim(),
          activityDate,
          startPoint: startPoint.trim(),
          endPoint: endPoint.trim(),
          vehicleName: selectedVehicle,
          distanceKm: calcDistance,
          durationHours: calcDuration,
          customDurationPP: durPP,
          tollParkingFee: tollFeeVal,
          destinationImageUrl: mapAddressImage || null,
          assignedTo: assignedDriverId || null,
        }),
      });

      setMessage({
        type: 'success',
        text: editingJourneyId ? 'Perjalanan berhasil diperbarui.' : 'Perjalanan berhasil dibuat.',
      });
      // Reset form
      setActivityName('');
      setActivityDate(new Date().toISOString().slice(0, 10));
      setEndPoint('');
      setCalcDistance(null);
      setCalcDuration(null);
      setInputDuration(null);
      setEditingJourneyId(null);
      setAssignedDriverId('');
      setTollFee('');
      lastCalculatedRef.current = { start: '', end: '' };
      setShowAddForm(false);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal membuat perjalanan. Coba lagi.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Delete Journey (Only unassigned ones) ──
  const handleDeleteJourney = async (id: string) => {
    void id;
    setMessage({
      type: 'error',
      text: 'Penghapusan perjalanan dinonaktifkan agar riwayat tetap utuh. Gunakan pembatalan beralasan.',
    });
  };

  // ── Filtered list ──
  const filteredJourneys = useMemo(() => {
    return journeys.filter((j) => {
      const nameMatch = j.activityName?.toLowerCase().includes(searchQuery.toLowerCase());
      const destMatch = j.endPoint?.toLowerCase().includes(searchQuery.toLowerCase());
      const driverMatch = j.employeeName?.toLowerCase().includes(searchQuery.toLowerCase());
      return nameMatch || destMatch || driverMatch;
    });
  }, [journeys, searchQuery]);

  // ── Group filtered journeys by activityDate ──
  const groupedJourneys = useMemo(() => {
    const groupsMap: { [key: string]: any[] } = {};

    // Sort journeys by activityDate descending (newest first), then by createdAt descending
    const sorted = [...filteredJourneys].sort((a, b) => {
      const dateA = getJourneyDate(a);
      const dateB = getJourneyDate(b);
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA); // Newest date first
      }
      const timeA = a.createdAt?.seconds || 0;
      const timeB = b.createdAt?.seconds || 0;
      return timeB - timeA;
    });

    sorted.forEach((j) => {
      const dateKey = getJourneyDate(j) || 'Tanpa Tanggal';
      if (!groupsMap[dateKey]) {
        groupsMap[dateKey] = [];
      }
      groupsMap[dateKey].push(j);
    });

    // Convert map to array of objects to guarantee sorted order
    const orderedDates = Object.keys(groupsMap).sort((a, b) => {
      if (a === 'Tanpa Tanggal') return 1;
      if (b === 'Tanpa Tanggal') return -1;
      return b.localeCompare(a); // Newest date first
    });

    return orderedDates.map(dateKey => ({
      dateKey,
      journeys: groupsMap[dateKey]
    }));
  }, [filteredJourneys]);

  return (
    <div className="min-h-screen bg-slate-50">
      <SatkerPekaryaNavBar />

      <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <Compass className="w-6 h-6 text-indigo-600 animate-spin-slow" />
            Pre-Otorisasi Perjalanan Driver
          </h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Buat rute, hitung uang jalan (BBM & Makan), dan kelola perjalanan dinas sopir untuk periode {periodToken}.
          </p>
        </div>

        <Button
          onClick={() => setShowAddForm(true)}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 text-xs px-4 h-10 gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Buat Perjalanan Baru
        </Button>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl border flex items-center gap-3 animate-in fade-in duration-200 text-xs font-semibold ${message.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setActiveTab('journeys')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${activeTab === 'journeys'
            ? 'bg-indigo-600 text-white shadow-sm'
            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
        >
          <Compass className="w-4 h-4" />
          Daftar Perjalanan SPJ ({filteredJourneys.length})
        </button>

        <button
          onClick={() => setActiveTab('piket')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${activeTab === 'piket'
            ? 'bg-indigo-600 text-white shadow-sm'
            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
        >
          <CalendarDays className="w-4 h-4" />
          Jadwal Piket Sopir ({piketSchedules.length} Shift)
        </button>
      </div>

      {activeTab === 'journeys' ? (
        /* List Table */
        <Card className="border-slate-200/60 shadow-sm rounded-2xl overflow-hidden bg-white">
          <CardHeader className="border-b border-slate-100 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-sm font-extrabold text-slate-800">Daftar Perjalanan</CardTitle>
              <CardDescription className="text-xs mt-0.5">Total {filteredJourneys.length} perjalanan dalam periode ini.</CardDescription>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Cari kegiatan/tujuan/driver..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 rounded-xl text-xs bg-slate-50 border-slate-200 focus:bg-white transition-all"
              />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center p-12 gap-2.5">
                <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                <p className="text-xs text-slate-400 font-bold">Memuat data rute perjalanan...</p>
              </div>
            ) : filteredJourneys.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <Compass className="w-12 h-12 text-slate-200 mb-2" />
                <h3 className="text-sm font-bold text-slate-700">Belum Ada Perjalanan</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                  Belum ada rute terotorisasi yang dibuat pada periode ini. Klik tombol "Buat Perjalanan Baru" di atas untuk memulai.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow className="border-slate-100">
                      <TableHead className="text-xs font-bold text-slate-500 pl-6">Kegiatan & Rute</TableHead>
                      <TableHead className="text-xs font-bold text-slate-500">Kendaraan</TableHead>
                      <TableHead className="text-xs font-bold text-slate-500">Jarak PP</TableHead>
                      <TableHead className="text-xs font-bold text-slate-500">Biaya Operasional</TableHead>
                      <TableHead className="text-xs font-bold text-slate-500">Estimasi Upah Sopir</TableHead>
                      <TableHead className="text-xs font-bold text-slate-500">Status / Driver</TableHead>
                      <TableHead className="text-xs font-bold text-slate-500 text-right pr-6">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedJourneys.map((group) => (
                      <React.Fragment key={group.dateKey}>
                        {/* Visual Group Subheading */}
                        <TableRow className="bg-slate-50/70 hover:bg-slate-50/70 border-slate-100/70 select-none">
                          <TableCell colSpan={7} className="pl-6 py-2">
                            <div className="flex items-center gap-1.5 text-indigo-700">
                              <Calendar className="w-3.5 h-3.5 shrink-0" />
                              <span className="text-[10px] font-extrabold uppercase tracking-wider">
                                {formatIndonesianDate(group.dateKey)}
                              </span>
                              <span className="text-[9px] font-bold text-slate-400 tracking-normal normal-case">
                                ({group.journeys.length} perjalanan)
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>

                        {group.journeys.map((j) => (
                          <TableRow key={j.id} className="hover:bg-slate-50/50 border-slate-100 transition-colors">
                            <TableCell className="pl-6 py-4">
                              <div className="font-bold text-slate-800 text-xs sm:text-sm">{j.activityName}</div>
                              <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-500 font-semibold">
                                <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                <span className="truncate max-w-[150px]" title={j.startPoint}>{j.startPoint.split(',')[0]}</span>
                                <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                                <span className="truncate max-w-[150px] font-extrabold text-slate-700" title={j.endPoint}>{j.endPoint}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 font-bold text-slate-700 text-xs">
                                <Car className="w-4 h-4 text-slate-400 shrink-0" />
                                {j.vehicleName}
                              </div>
                              <div className="text-[10px] text-slate-400 font-semibold">{fmtRp(j.vehicleRate)}/km</div>
                            </TableCell>
                            <TableCell className="font-bold text-slate-700 text-xs">
                              {j.distanceKm * 2} km
                            </TableCell>
                            <TableCell>
                              <div className="font-black text-indigo-600 text-xs sm:text-sm">{fmtRp(j.totalOperationalCost)}</div>
                              <div className="text-[9px] text-slate-400 font-bold leading-tight">
                                Makan: {fmtRp(j.mealAllowance)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-black text-emerald-600 text-xs sm:text-sm">
                                {j.status === 'completed' ? (
                                  <span>{fmtRp(j.upahBersih || ((j.newTotalDistanceKm || j.distanceKm * 2) * 300 + (j.newTotalDurationHours || (j.durationHours || 0) * 2) * 5000))}</span>
                                ) : (
                                  <span>
                                    {fmtRp((j.distanceKm * 2 * 300) + ((j.durationHours || 0) * 2 * 5000))} - {fmtRp(((j.distanceKm * 2 * 300) + ((j.durationHours || 0) * 2 * 5000)) * 1.25)}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {j.status === 'unassigned' && (
                                <Badge className="bg-slate-100 text-slate-500 border border-slate-200 text-[9px] font-bold rounded-lg px-2 py-0.5">
                                  Belum Ditugaskan
                                </Badge>
                              )}
                              {j.status === 'assigned' && (
                                <div className="space-y-1">
                                  <Badge className="bg-purple-50 text-purple-700 border border-purple-200 text-[9px] font-bold rounded-lg px-2 py-0.5">
                                    Ditugaskan
                                  </Badge>
                                  <div className="text-[10px] font-bold text-slate-600 block">{j.assignedToName || 'Sopir'}</div>
                                </div>
                              )}
                              {j.status === 'claimed' && (
                                <div className="space-y-1">
                                  <Badge className="bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold rounded-lg px-2 py-0.5">
                                    Aktif Jalan
                                  </Badge>
                                  <div className="text-[10px] font-bold text-slate-600 block">{j.employeeName}</div>
                                </div>
                              )}
                              {j.status === 'completed' && (
                                <div className="space-y-1">
                                  <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-bold rounded-lg px-2 py-0.5">
                                    Selesai
                                  </Badge>
                                  <div className="text-[10px] font-bold text-slate-600 block">{j.employeeName}</div>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              {j.status === 'unassigned' ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditingJourneyId(j.id);
                                      setActivityName(j.activityName);
                                      setActivityDate(getJourneyDate(j));
                                      setStartPoint(j.startPoint);
                                      setEndPoint(j.endPoint);
                                      setSelectedVehicle(j.vehicleName);
                                      setCalcDistance(j.distanceKm);
                                      setCalcDuration(j.durationHours);
                                      setInputDuration(j.customDurationPP || (j.durationHours ? j.durationHours * 2 : 0));
                                      setTollFee(j.tollParkingFee ? String(j.tollParkingFee) : '');
                                      setAssignedDriverId(j.assignedTo || '');
                                      lastCalculatedRef.current = { start: j.startPoint, end: j.endPoint };
                                      setShowAddForm(true);
                                    }}
                                    className="h-8 w-8 p-0 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl cursor-pointer"
                                    title="Edit Perjalanan"
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteJourney(j.id)}
                                    className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl cursor-pointer"
                                    title="Hapus Perjalanan"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-[10px] font-semibold text-slate-300 select-none">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Piket Calendar Card */
        <Card className="border-slate-200/60 shadow-sm rounded-2xl overflow-hidden bg-white">
          <CardHeader className="border-b border-slate-100 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
                <CalendarDays className="w-4.5 h-4.5 text-indigo-600" />
                Jadwal Standby / Piket Sopir ({periodToken})
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Klik pada tanggal di bawah untuk menentukan sopir piket yang bertugas. Driver yang memiliki piket aktif dapat membuat SPJ sendiri (Ndalem).
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-6 space-y-4">
            {/* Calendar Grid Header */}
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold text-slate-500 pb-2 border-b border-slate-100">
              <div>Senin</div>
              <div>Selasa</div>
              <div>Rabu</div>
              <div>Kamis</div>
              <div>Jumat</div>
              <div>Sabtu</div>
              <div>Minggu</div>
            </div>

            {/* Calendar Days Grid */}
            <div className="grid grid-cols-7 gap-2">
              {/* Blank leading offset cells */}
              {Array.from({ length: firstDayOffset }).map((_, idx) => (
                <div key={`offset-${idx}`} className="h-24 sm:h-28 rounded-xl bg-slate-50/50 border border-dashed border-slate-100" />
              ))}

              {/* Day cells */}
              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const dayNum = idx + 1;
                const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const assigned = piketSchedules.filter((s) => s.date === dateStr);
                const isToday = new Date().toISOString().slice(0, 10) === dateStr;

                return (
                  <div
                    key={dateStr}
                    onClick={() => {
                      setSelectedPiketDate(dateStr);
                      setShowPiketDialog(true);
                    }}
                    className={`min-h-[145px] sm:min-h-[165px] rounded-xl border p-2 flex flex-col justify-between transition-all cursor-pointer group hover:border-indigo-400 hover:shadow-md ${isToday
                      ? 'bg-indigo-50/50 border-indigo-300 ring-2 ring-indigo-500/20'
                      : assigned.length > 0
                        ? 'bg-white border-slate-200'
                        : 'bg-slate-50/70 border-slate-100 hover:bg-white'
                      }`}
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-1 mb-1">
                      <span className={`text-xs font-black ${isToday ? 'text-indigo-600' : 'text-slate-700'}`}>
                        {dayNum}
                      </span>
                      {assigned.length > 0 ? (
                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200 text-[9px] font-extrabold px-1.5 py-0">
                          {assigned.length}/5 Piket
                        </Badge>
                      ) : (
                        <span className="text-[9px] text-slate-300 font-semibold">Kosong</span>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-1 scrollbar-none">
                      {PIKET_STATIONS.map((station, sIdx) => {
                        const sched = getScheduleForStation(dateStr, station.key, sIdx);
                        return (
                          <div
                            key={station.key}
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border flex items-center justify-between gap-1 transition-all ${sched
                              ? 'bg-emerald-50 text-emerald-900 border-emerald-200/80 shadow-xs'
                              : 'bg-slate-50/60 text-slate-400 border-slate-100 hover:bg-slate-100/80'
                              }`}
                            title={sched ? `${station.name}: ${sched.driverName}` : `${station.name}: Belum Ditugaskan`}
                          >
                            <span className="truncate text-[9px] font-black text-slate-500 uppercase tracking-tight w-14 shrink-0">
                              {station.name}
                            </span>
                            <span className={`truncate text-[10px] font-bold ${sched ? 'text-emerald-800' : 'text-slate-300 font-normal italic'}`}>
                              {(() => {
                                if (!sched) return '—';
                                const d = drivers.find((drv) => drv.id === sched.driverId);
                                if (d?.name && d.name !== sched.driverId) return d.name;
                                if (sched.driverName && !sched.driverName.startsWith('BC_')) return sched.driverName;
                                return d?.name || sched.driverName || sched.driverId;
                              })()}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="text-[9px] font-extrabold text-indigo-600 group-hover:opacity-100 transition-opacity flex items-center gap-1 justify-end pt-1 border-t border-slate-100">
                      <span>+ Atur Piket</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog for Assigning Drivers to 5 Piket Stations on Selected Date */}
      <Dialog open={showPiketDialog} onOpenChange={setShowPiketDialog}>
        <DialogContent className="max-w-lg rounded-3xl p-6 sm:p-7">
          <DialogHeader className="border-b border-slate-100 pb-3">
            <DialogTitle className="text-base font-black text-slate-800 flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-indigo-600" />
              Kelola 5 Stasiun Piket ({selectedPiketDate ? formatIndonesianDate(selectedPiketDate) : ''})
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 mt-0.5">
              Tentukan sopir bertugas pada setiap stasiun piket untuk tanggal ini.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 my-3">
            {PIKET_STATIONS.map((station, sIdx) => {
              const currentSched = selectedPiketDate ? getScheduleForStation(selectedPiketDate, station.key, sIdx) : null;
              const selectedDriverId = currentSched?.driverId || 'unassigned';

              // Get driver IDs assigned to other stations on the selected date
              const assignedOtherDriverIds = selectedPiketDate
                ? piketSchedules
                    .filter((s) => {
                      if (s.date !== selectedPiketDate || !s.driverId || s.driverId === 'unassigned') return false;
                      if (s.stationKey) return s.stationKey !== station.key;
                      return currentSched ? s.id !== currentSched.id : true;
                    })
                    .map((s) => s.driverId)
                : [];

              return (
                <div
                  key={station.key}
                  className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-black text-xs shrink-0">
                      <Compass className="w-4 h-4 text-indigo-600" />
                    </div>
                    <div>
                      <div className="text-xs font-black text-slate-800">{station.name}</div>
                      <div className="text-[10px] text-slate-400 font-semibold">Stasiun Standby Sopir</div>
                    </div>
                  </div>

                  <Select
                    value={selectedDriverId}
                    disabled={savingPiket}
                    onValueChange={(val: string | null) => {
                      assignDriverToStation(station.key, station.name, val || 'unassigned');
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-[210px] h-9 text-xs font-bold bg-white rounded-xl border border-slate-200">
                      <SelectValue placeholder="-- Pilih Sopir --">
                        {(() => {
                          if (selectedDriverId === 'unassigned') return '-- Belum Ditugaskan --';
                          const selectedDriver = drivers.find((d) => d.id === selectedDriverId);
                          return selectedDriver ? (selectedDriver.name || selectedDriver.personal_info?.name || selectedDriver.id) : selectedDriverId;
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                      <SelectItem value="unassigned" className="text-xs text-slate-400 italic">
                        -- Belum Ditugaskan --
                      </SelectItem>
                      {drivers.map((d) => {
                        const driverName = d.name || d.personal_info?.name || d.id;
                        const isAssignedElsewhere = assignedOtherDriverIds.includes(d.id);
                        return (
                          <SelectItem
                            key={d.id}
                            value={d.id}
                            disabled={isAssignedElsewhere}
                            className="text-xs font-bold"
                          >
                            {driverName}{isAssignedElsewhere ? ' (Sudah Ditugaskan)' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>

          <DialogFooter className="pt-2 border-t border-slate-100">
            <Button
              onClick={() => setShowPiketDialog(false)}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs h-10 cursor-pointer"
            >
              Selesai & Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Creation Modal */}
      <Dialog open={showAddForm} onOpenChange={(open) => {
        if (!open) {
          setActivityName('');
          setActivityDate(new Date().toISOString().slice(0, 10));
          setEndPoint('');
          setCalcDistance(null);
          setCalcDuration(null);
          setInputDuration(null);
          setCalcError('');
          setEditingJourneyId(null);
          setAssignedDriverId('');
          setTollFee('');
          lastCalculatedRef.current = { start: '', end: '' };
        }
        setShowAddForm(open);
      }}>
        <DialogContent className="md:max-w-[760px] rounded-2xl bg-white border-slate-100 shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-extrabold text-slate-800 flex items-center gap-2">
              <Compass className="w-5 h-5 text-indigo-600" />
              Otorisasi Perjalanan Dinas
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400 mt-1">
              Masukkan detail perjalanan untuk menghitung estimasi biaya operasional driver (BBM & Uang Makan).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateJourney} className="space-y-4 pt-2.5">
            {/* Nama Kegiatan & Tanggal */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="journeyName" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Keperluan / Nama Kegiatan
                </Label>
                <Input
                  id="journeyName"
                  placeholder="Contoh: Mengantar Dekan FIK Rapat di UINSA"
                  value={activityName}
                  onChange={(e) => setActivityName(e.target.value)}
                  className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-sm h-10 px-3"
                  required
                  autoComplete="off"
                />
              </div>
              <div className="md:col-span-1 space-y-1.5">
                <Label htmlFor="journeyDate" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Tanggal Perjalanan
                </Label>
                <Input
                  id="journeyDate"
                  type="date"
                  value={activityDate}
                  onChange={(e) => setActivityDate(e.target.value)}
                  className="rounded-xl border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20 text-sm h-10 px-3"
                  required
                />
              </div>
            </div>

            {/* Penugasan Sopir (Opsional) */}
            <div className="space-y-1.5">
              <Label htmlFor="driverAssignment" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Penugasan Sopir (Opsional)
              </Label>
              <Select value={assignedDriverId || 'unassigned'} onValueChange={(v: string | null) => setAssignedDriverId(!v || v === 'unassigned' ? '' : v)}>
                <SelectTrigger id="driverAssignment" className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                  <SelectValue>
                    {(() => {
                      if (!assignedDriverId || assignedDriverId === 'unassigned') {
                        return 'Buka Pool Umum (Belum Ditugaskan)';
                      }
                      const selectedDriver = drivers.find(d => d.id === assignedDriverId);
                      if (!selectedDriver) return assignedDriverId;
                      const { activeCount, assignedCount } = getDriverStatus(assignedDriverId);
                      let statusBadge = 'Bebas';
                      if (activeCount > 0) statusBadge = `${activeCount} Aktif Jalan`;
                      else if (assignedCount > 0) statusBadge = `${assignedCount} Terjadwal`;
                      return `${selectedDriver.name || 'Sopir'} • [${statusBadge}]`;
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">-- Buka Pool Umum (Belum Ditugaskan) --</SelectItem>
                  {drivers.map(driver => {
                    const { activeCount, assignedCount } = getDriverStatus(driver.id);
                    let statusBadge = 'Bebas';
                    if (activeCount > 0) statusBadge = `${activeCount} Aktif Jalan`;
                    else if (assignedCount > 0) statusBadge = `${assignedCount} Terjadwal`;

                    return (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name || 'Sopir'} • [{statusBadge}]
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {assignedDriverId && (() => {
                const { activeCount, assignedCount } = getDriverStatus(assignedDriverId);
                if (activeCount > 0 || assignedCount > 0) {
                  return (
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] font-semibold text-amber-800 flex items-center gap-2 mt-1 animate-in fade-in duration-200">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Sopir ini memiliki {activeCount > 0 ? `${activeCount} tugas aktif sedang berjalan` : `${assignedCount} tugas terjadwal`}. Perjalanan ini akan masuk sebagai tugas mendatang bagi sopir tersebut.</span>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Titik Mulai & Tujuan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Titik Awal
                </Label>
                {!startPoint ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMapTarget('start');
                      setMapSearchText('');
                      setMapAddress('');
                      setMapAddressImage(null);
                      setShowMapSelector(true);
                    }}
                    className="w-full rounded-xl border border-dashed border-indigo-300 hover:border-indigo-500 bg-indigo-50/30 hover:bg-indigo-50/50 text-indigo-700 h-10 px-4 flex items-center justify-center gap-1.5 font-bold text-xs cursor-pointer transition-all"
                  >
                    <MapPin className="w-4 h-4" />
                    Pilih Titik Awal di Peta
                  </Button>
                ) : (
                  <div className="p-3 bg-indigo-50/40 border border-indigo-100 rounded-xl flex items-center justify-between gap-3 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 overflow-hidden text-xs text-indigo-900 font-semibold flex-1">
                      <MapPin className="w-4.5 h-4.5 text-indigo-600 shrink-0" />
                      <span className="truncate" title={startPoint}>{startPoint}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setMapTarget('start');
                        setMapSearchText(startPoint);
                        setMapAddress(startPoint);
                        setMapAddressImage(null);
                        setShowMapSelector(true);
                      }}
                      className="text-[10px] font-bold text-indigo-700 hover:text-indigo-800 bg-white hover:bg-slate-50 border border-slate-200 px-2.5 h-7 rounded-lg shrink-0 cursor-pointer"
                    >
                      Ubah
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Tujuan Utama
                </Label>
                {!endPoint ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMapSearchText('');
                      setMapAddress('');
                      setMapAddressImage(null);
                      setShowMapSelector(true);
                    }}
                    className="w-full rounded-xl border border-dashed border-indigo-300 hover:border-indigo-500 bg-indigo-50/30 hover:bg-indigo-50/50 text-indigo-700 h-10 px-4 flex items-center justify-center gap-1.5 font-bold text-xs cursor-pointer transition-all"
                  >
                    <MapPin className="w-4 h-4" />
                    Pilih Lokasi Tujuan di Peta
                  </Button>
                ) : (
                  <div className="p-3 bg-indigo-50/40 border border-indigo-100 rounded-xl flex items-center justify-between gap-3 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 overflow-hidden text-xs text-indigo-900 font-semibold flex-1">
                      <MapPin className="w-4.5 h-4.5 text-indigo-600 shrink-0" />
                      <span className="truncate" title={endPoint}>{endPoint}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setMapSearchText(endPoint);
                        setMapAddress(endPoint);
                        setMapAddressImage(null);
                        setShowMapSelector(true);
                      }}
                      className="text-[10px] font-bold text-indigo-700 hover:text-indigo-800 bg-white hover:bg-slate-50 border border-slate-200 px-2.5 h-7 rounded-lg shrink-0 cursor-pointer"
                    >
                      Ubah
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Kendaraan, Durasi & Tol */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="vehicleSelect" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Jenis Kendaraan
                </Label>
                <Select
                  value={selectedVehicle}
                  onValueChange={(val: any) => {
                    setSelectedVehicle(val);
                  }}
                >
                  <SelectTrigger className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-slate-100 shadow-xl bg-white">
                    {Object.keys(VEHICLE_RATES).map((name) => (
                      <SelectItem key={name} value={name}>
                        {name === 'Ndalem' ? 'Ndalem — Tanpa Uang Jalan' : `${name} — ${fmtRp(VEHICLE_RATES[name as keyof typeof VEHICLE_RATES])}/km`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="durationInput" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Durasi Perjalanan PP (Jam)
                </Label>
                <Input
                  id="durationInput"
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="Contoh: 3.0"
                  value={inputDuration !== null ? inputDuration : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setInputDuration(val === '' ? null : parseFloat(val));
                  }}
                  className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tollInput" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Estimasi Tol & Parkir (Rp)
                </Label>
                <Input
                  id="tollInput"
                  type="text"
                  placeholder="Contoh: 50.000"
                  value={tollFee}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setTollFee(val ? Number(val).toLocaleString('id-ID') : '');
                  }}
                  className="w-full text-sm font-bold text-slate-700 bg-white rounded-xl border border-slate-200 h-10 px-3"
                />
              </div>
            </div>

            {/* Calculation Loader */}
            {calculating && (
              <div className="flex items-center justify-center p-3 text-xs text-indigo-600 font-bold bg-indigo-50/50 rounded-xl border border-indigo-100/50 animate-in fade-in duration-200">
                <Loader2 className="w-4 h-4 animate-spin mr-2 text-indigo-600" />
                Mengevaluasi rute & durasi Google Maps...
              </div>
            )}

            {/* Calculation Errors */}
            {calcError && (
              <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl font-semibold flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{calcError}</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    lastCalculatedRef.current = { start: '', end: '' };
                    setCalcDistance(null);
                  }}
                  className="text-[10px] font-bold bg-rose-600 hover:bg-rose-700 text-white h-7 px-2.5 rounded-lg shrink-0"
                >
                  Coba Lagi
                </Button>
              </div>
            )}

            {/* Calculation Summary Preview */}
            {calcDistance !== null && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Rincian Estimasi Biaya Otorisasi */}
                <div className="p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-1.5 animate-in fade-in duration-200">
                  <span className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider block">
                    Rincian Estimasi Biaya Otorisasi
                  </span>

                  <div className="grid grid-cols-2 gap-2 text-slate-600 text-xs font-semibold">
                    <div className="bg-white p-2 rounded-lg border border-slate-100">
                      <span className="block text-[8px] text-slate-400 font-bold uppercase">Jarak Pulang-Pergi</span>
                      <span className="text-xs font-extrabold text-slate-700">{(calcDistance * 2).toFixed(1)} km</span>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-100">
                      <span className="block text-[8px] text-slate-400 font-bold uppercase">Tarif Mobil</span>
                      <span className="text-xs font-extrabold text-slate-700">
                        {selectedVehicle === 'Ndalem' ? 'Tanpa Tarif' : `${fmtRp(VEHICLE_RATES[selectedVehicle])}/km`}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs pt-1">
                    <div className="flex justify-between text-slate-500 font-medium">
                      <span>Biaya BBM (PP)</span>
                      <span className="font-bold text-slate-700">{fmtRp(calcDistance * 2 * VEHICLE_RATES[selectedVehicle])}</span>
                    </div>
                    <div className="flex justify-between text-slate-500 font-medium">
                      <span>Uang Makan Sopir (Flat Durasi)</span>
                      <span className="font-bold text-slate-700">{fmtRp(dynamicMealAllowance)}</span>
                    </div>
                    {(() => {
                      const tollFeeVal = tollFee ? parseInt(tollFee.replace(/\D/g, ''), 10) || 0 : 0;
                      return (
                        <>
                          {tollFeeVal > 0 && (
                            <div className="flex justify-between text-slate-500 font-medium animate-in fade-in duration-150">
                              <span>Estimasi Tol & Parkir</span>
                              <span className="font-bold text-slate-700">{fmtRp(tollFeeVal)}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-slate-800 font-black border-t border-indigo-200/60 pt-1.5 mt-1 text-sm">
                            <span>Total Uang Jalan (Operasional)</span>
                            <span className="text-indigo-700">{fmtRp((calcDistance * 2 * VEHICLE_RATES[selectedVehicle]) + dynamicMealAllowance + tollFeeVal)}</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Kisaran Pendapatan Bersih Driver */}
                <div className="p-3.5 bg-emerald-50/70 border border-emerald-100 rounded-xl space-y-1.5 animate-in fade-in duration-200">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                    Kisaran Pendapatan Bersih Driver
                  </span>

                  <div className="grid grid-cols-2 gap-2 text-slate-600 text-xs font-semibold">
                    <div className="bg-white p-2 rounded-lg border border-slate-100">
                      <span className="block text-[8px] text-slate-400 font-bold uppercase">Jarak Pulang-Pergi</span>
                      <span className="text-xs font-extrabold text-slate-700">{(calcDistance * 2).toFixed(1)} km</span>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-100">
                      <span className="block text-[8px] text-slate-400 font-bold uppercase">Estimasi Waktu PP</span>
                      <span className="text-xs font-extrabold text-slate-700">{(calcDuration ? calcDuration * 2 : 0).toFixed(1)} jam</span>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs pt-1">
                    <div className="flex justify-between text-slate-500 font-medium">
                      <span>Komponen Jarak (Rp300/km)</span>
                      <span className="font-bold text-slate-700">{fmtRp(calcDistance * 2 * 300)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500 font-medium">
                      <span>Komponen Waktu (Rp5.000/jam)</span>
                      <span className="font-bold text-slate-700">{fmtRp((calcDuration ? calcDuration * 2 : 0) * 5000)}</span>
                    </div>
                    <div className="flex justify-between text-amber-600 font-medium">
                      <span>Aktivitas di Perjalanan</span>
                      <span className="font-bold text-amber-700">s.d. +{fmtRp(((calcDistance * 2 * 300) + ((calcDuration ? calcDuration * 2 : 0) * 5000)) * 0.25)}</span>
                    </div>
                    <div className="flex justify-between text-slate-800 font-black border-t border-emerald-200/60 pt-1.5 mt-1 text-sm">
                      <span>Kisaran Upah Bersih</span>
                      <span className="text-emerald-700">
                        {fmtRp((calcDistance * 2 * 300) + ((calcDuration ? calcDuration * 2 : 0) * 5000))} - {fmtRp(((calcDistance * 2 * 300) + ((calcDuration ? calcDuration * 2 : 0) * 5000)) * 1.25)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="pt-2 border-t border-slate-100 gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAddForm(false)}
                className="rounded-xl font-bold text-slate-500 hover:bg-slate-50 text-xs px-4"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={saving || calcDistance === null}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 h-10"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Otorisasi & Publikasikan
              </Button>
            </DialogFooter>
          </form>
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
                onClick={() => {
                  if (mapTarget === 'start') {
                    setStartPoint(mapAddress);
                  } else {
                    setEndPoint(mapAddress);
                  }
                  lastCalculatedRef.current = { start: '', end: '' };
                  setCalcDistance(null);
                  setShowMapSelector(false);
                }}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 h-10"
              >
                Konfirmasi Lokasi
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

export default function DriverJourneysPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    }>
      <DriverJourneysContent />
    </Suspense>
  );
}
