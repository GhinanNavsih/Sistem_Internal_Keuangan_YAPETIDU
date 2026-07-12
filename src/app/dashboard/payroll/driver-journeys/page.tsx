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
} from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  doc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';

const VEHICLE_RATES = {
  'Bis': 850,
  'Elf': 680,
  'Kijang LGX': 567,
  'Innova Hitam': 1000,
  'Innova Matic': 1250,
  'Suzuki XL7': 741,
};

function fmtRp(val: number): string {
  return 'Rp' + Math.round(val).toLocaleString('id-ID');
}

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

function DriverJourneysContent() {
  const { profile } = useAuth();
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [activityName, setActivityName] = useState('');
  const [startPoint, setStartPoint] = useState('UNIPDU Jombang, Jawa Timur');
  const [endPoint, setEndPoint] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<keyof typeof VEHICLE_RATES>('Suzuki XL7');

  // Calculated preview states
  const [calcDistance, setCalcDistance] = useState<number | null>(null);
  const [calcDuration, setCalcDuration] = useState<number | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState('');

  // Google Maps selector modal states
  const [showMapSelector, setShowMapSelector] = useState(false);
  const [mapSearchText, setMapSearchText] = useState('');
  const [mapAddress, setMapAddress] = useState('');
  const [mapTarget, setMapTarget] = useState<'start' | 'end'>('end');

  const mapRef = React.useRef<any>(null);
  const markerRef = React.useRef<any>(null);
  const mapElementRef = React.useRef<HTMLDivElement | null>(null);

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
      const updateAddress = (latLng: any) => {
        geocoder.geocode({ location: latLng }, (results: any, status: any) => {
          if (status === 'OK' && results[0]) {
            setMapAddress(results[0].formatted_address);
          } else {
            setMapAddress(`${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`);
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
          fields: ['formatted_address', 'geometry', 'name'],
        });

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (!place.geometry || !place.geometry.location) return;

          mapRef.current.setCenter(place.geometry.location);
          mapRef.current.setZoom(16);
          if (markerRef.current) {
            markerRef.current.setPosition(place.geometry.location);
          }

          if (place.formatted_address) {
            setMapAddress(place.formatted_address);
            setMapSearchText(place.name || place.formatted_address);
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

  // ── Calculate Route on the fly ──
  const handleCalculate = async () => {
    if (!startPoint.trim() || !endPoint.trim()) {
      setCalcError('Titik Awal dan Tujuan Akhir harus diisi.');
      return;
    }
    setCalculating(true);
    setCalcError('');
    setCalcDistance(null);
    setCalcDuration(null);

    try {
      const response = await fetch('/api/calculate-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: [startPoint, endPoint] }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Gagal menghitung rute.');
      }

      setCalcDistance(data.distanceKm);
      setCalcDuration(data.durationHours);
    } catch (err: any) {
      console.error(err);
      setCalcError(err.message || 'Terjadi kesalahan jaringan.');
    } finally {
      setCalculating(false);
    }
  };

  // ── Submit Journey Creation ──
  const handleCreateJourney = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activityName.trim() || !startPoint.trim() || !endPoint.trim() || calcDistance === null) {
      setMessage({ type: 'error', text: 'Pastikan rute telah dihitung dan Nama Kegiatan diisi.' });
      return;
    }

    setSaving(true);
    try {
      const rate = VEHICLE_RATES[selectedVehicle];
      const baseCost = calcDistance * 2 * rate; // PP
      const mealAllowance = baseCost * 0.2;
      const totalCost = baseCost * 1.2;

      // Unique Journey ID: JRN-[Date]-[RandomSuffix]
      const dateSanitized = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const journeyId = `JRN-${dateSanitized}-${randomSuffix}`;

      await setDoc(doc(db, 'DriverJourneys', journeyId), {
        activityName: activityName.trim(),
        startPoint: startPoint.trim(),
        endPoint: endPoint.trim(),
        vehicleName: selectedVehicle,
        vehicleRate: rate,
        distanceKm: calcDistance,
        durationHours: calcDuration || 0,
        baseOperationalCost: baseCost,
        mealAllowance: mealAllowance,
        totalOperationalCost: totalCost,
        status: 'unassigned',
        createdAt: serverTimestamp(),
        createdBy: profile?.uid || 'system',
        period: periodToken,
      });

      setMessage({ type: 'success', text: 'Perjalanan berhasil dibuat.' });
      // Reset form
      setActivityName('');
      setEndPoint('');
      setCalcDistance(null);
      setCalcDuration(null);
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
    if (!confirm('Apakah Anda yakin ingin menghapus perjalanan ini?')) return;
    try {
      await deleteDoc(doc(db, 'DriverJourneys', id));
      setMessage({ type: 'success', text: 'Perjalanan berhasil dihapus.' });
    } catch (err) {
      console.error(err);
      setMessage({ type: 'error', text: 'Gagal menghapus perjalanan.' });
    }
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

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 space-y-6">
      <SatkerPekaryaNavBar />

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

      {/* List Table */}
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
                    <TableHead className="text-xs font-bold text-slate-500">Uang Jalan (Prior)</TableHead>
                    <TableHead className="text-xs font-bold text-slate-500">Status / Driver</TableHead>
                    <TableHead className="text-xs font-bold text-slate-500 text-right pr-6">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredJourneys.map((j) => (
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
                        {j.distanceKm * 2} km <span className="text-[10px] text-slate-400 font-normal">(PP)</span>
                      </TableCell>
                      <TableCell>
                        <div className="font-black text-indigo-600 text-xs sm:text-sm">{fmtRp(j.totalOperationalCost)}</div>
                        <div className="text-[9px] text-slate-400 font-bold leading-tight">
                          Makan: {fmtRp(j.mealAllowance)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {j.status === 'unassigned' && (
                          <Badge className="bg-slate-100 text-slate-500 border border-slate-200 text-[9px] font-bold rounded-lg px-2 py-0.5">
                            Belum Diambil
                          </Badge>
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
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteJourney(j.id)}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-300 select-none">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Creation Modal */}
      <Dialog open={showAddForm} onOpenChange={(open) => {
        if (!open) {
          setActivityName('');
          setEndPoint('');
          setCalcDistance(null);
          setCalcDuration(null);
          setCalcError('');
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
            {/* Nama Kegiatan */}
            <div className="space-y-1.5">
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

            {/* Titik Mulai & Tujuan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Titik Awal (Origin)
                </Label>
                {!startPoint ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMapTarget('start');
                      setMapSearchText('');
                      setMapAddress('');
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
                  Tujuan Akhir (Destination)
                </Label>
                {!endPoint ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMapSearchText('');
                      setMapAddress('');
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

            {/* Kendaraan */}
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
                      {name} — {fmtRp(VEHICLE_RATES[name as keyof typeof VEHICLE_RATES])}/km
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Check Route Button */}
            <div className="pt-1.5">
              <Button
                type="button"
                disabled={calculating || !startPoint.trim() || !endPoint.trim()}
                onClick={handleCalculate}
                className="w-full text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white rounded-xl h-9"
              >
                {calculating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                    Menghitung Rute Google Maps...
                  </>
                ) : (
                  '✓ Cek Rute & Hitung Biaya Perjalanan'
                )}
              </Button>
            </div>

            {/* Calculation Errors */}
            {calcError && (
              <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-xl font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{calcError}</span>
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
                      <span className="text-xs font-extrabold text-slate-700">{fmtRp(VEHICLE_RATES[selectedVehicle])}/km</span>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs pt-1">
                    <div className="flex justify-between text-slate-500 font-medium">
                      <span>Biaya Jalan Dasar (PP)</span>
                      <span className="font-bold text-slate-700">{fmtRp(calcDistance * 2 * VEHICLE_RATES[selectedVehicle])}</span>
                    </div>
                    <div className="flex justify-between text-slate-500 font-medium">
                      <span>Uang Makan Sopir (20%)</span>
                      <span className="font-bold text-slate-700">{fmtRp((calcDistance * 2 * VEHICLE_RATES[selectedVehicle]) * 0.2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-800 font-black border-t border-indigo-200/60 pt-1.5 mt-1 text-sm">
                      <span>Total Uang Jalan (Operasional)</span>
                      <span className="text-indigo-700">{fmtRp((calcDistance * 2 * VEHICLE_RATES[selectedVehicle]) * 1.2)}</span>
                    </div>
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
                      <span>Komponen Jarak (Rp200/km)</span>
                      <span className="font-bold text-slate-700">{fmtRp(calcDistance * 2 * 200)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500 font-medium">
                      <span>Komponen Waktu (Rp5.000/jam)</span>
                      <span className="font-bold text-slate-700">{fmtRp((calcDuration ? calcDuration * 2 : 0) * 5000)}</span>
                    </div>
                    <div className="flex justify-between text-slate-800 font-black border-t border-emerald-200/60 pt-1.5 mt-1 text-sm">
                      <span>Kisaran Payout (Base - Max)</span>
                      <span className="text-emerald-700">
                        {fmtRp((calcDistance * 2 * 200) + ((calcDuration || 0) * 2 * 5000))} - {fmtRp(((calcDistance * 2 * 200) + ((calcDuration || 0) * 2 * 5000)) * 2.0)}
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
            {/* Search Input inside Map */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                ref={(el) => {
                  if (el) {
                    initAutocomplete(el);
                  }
                }}
                placeholder="Cari alamat, gedung, kota..."
                value={mapSearchText}
                onChange={(e) => setMapSearchText(e.target.value)}
                className="pl-9 h-10 rounded-xl text-xs bg-slate-50 border-slate-200 focus:bg-white transition-all"
              />
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
