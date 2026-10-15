"use client";

import React, { useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { loadGoogleMapsScript } from '@/components/employee/activities/activityShared';
import { Button } from '@/components/ui/button';
import { DetailList, DetailRow } from '@/components/ui/detail-list';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH,
  type CostSafePlaceSuggestion,
  useCostSafePlaceAutocomplete,
} from '@/hooks/useCostSafePlaceAutocomplete';
import {
  DEFAULT_DRIVER_JOURNEY_LOCATION,
  normalizeDriverJourneyLocation,
  type DriverJourneyLocation,
} from '@/lib/payroll/driverJourney';

interface LocationPickerDialogProps {
  /** The stop being changed, or empty for a new one. */
  initialAddress?: string;
  initialLocation?: DriverJourneyLocation | null;
  onConfirm: (address: string, location: DriverJourneyLocation) => void;
  onClose: () => void;
}

/**
 * The sopir journey report's "Pilih lokasi" picker: search a place (cost-safe
 * autocomplete, then one geocode for the chosen suggestion), or drop and drag a
 * pin on the map. Mount it only while it is open, so every opening starts from
 * the stop it was opened for.
 */
export function LocationPickerDialog({
  initialAddress = '',
  initialLocation = null,
  onConfirm,
  onClose,
}: LocationPickerDialogProps) {
  const [mapSearchText, setMapSearchText] = useState(initialAddress);
  const [mapAddress, setMapAddress] = useState(initialAddress);
  const [mapLocation, setMapLocation] = useState<DriverJourneyLocation | null>(
    normalizeDriverJourneyLocation(initialLocation, initialAddress),
  );
  const [mapSearchError, setMapSearchError] = useState('');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const close = () => {
    cancelPlaceSearch();
    mapGeocodeRequestRef.current += 1;
    onClose();
  };

  const geocodeMapSearch = (queryText: string, displayLabel?: string) => {
    const normalizedQuery = queryText.trim();
    if (!normalizedQuery) return;

    const requestId = ++mapGeocodeRequestRef.current;
    cancelPlaceSearch();
    setMapSearchError('');

    loadGoogleMapsScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (results: any[], status: string) => {
            if (requestId !== mapGeocodeRequestRef.current) return;

            const firstResult = Array.isArray(results)
              ? results.find((result) => result?.geometry?.location)
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

            // Keep the place title that was picked: Google may format the
            // address as a plus code, while the coordinates route the trip.
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

  const initMap = (element: HTMLDivElement) => {
    loadGoogleMapsScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateAddress = (latLng: any) => {
        cancelPlaceSearch();
        mapGeocodeRequestRef.current += 1;
        setMapSearchError('');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geocoder.geocode({ location: latLng }, (results: any, status: any) => {
          const latitude = typeof latLng.lat === 'function' ? latLng.lat() : Number(latLng.lat);
          const longitude = typeof latLng.lng === 'function' ? latLng.lng() : Number(latLng.lng);
          const address = status === 'OK' && results?.[0]?.formatted_address
            ? results[0].formatted_address
            : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
          setMapAddress(address);
          setMapLocation({ address, latitude, longitude });
          setMapSearchText(address);
          setMapSearchError('');
        });
      };

      const existingLocation = normalizeDriverJourneyLocation(initialLocation, initialAddress);
      if (existingLocation) {
        const position = { lat: existingLocation.latitude, lng: existingLocation.longitude };
        map.setCenter(position);
        map.setZoom(15);
        marker.setPosition(position);
      } else if (initialAddress) {
        // A stop saved before stops were picked on the map has a name only.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geocoder.geocode({ address: initialAddress, region: 'id' }, (results: any, status: any) => {
          if (status === 'OK' && results[0]?.geometry?.location) {
            const loc = results[0].geometry.location;
            map.setCenter(loc);
            map.setZoom(15);
            marker.setPosition(loc);
            setMapLocation({
              address: initialAddress,
              latitude: typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat),
              longitude: typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng),
            });
          } else {
            setMapSearchError('Alamat lama tidak dapat dipetakan. Cari lokasi atau geser pin.');
          }
        });
      }

      marker.addListener('dragend', () => {
        const position = marker.getPosition();
        if (position) updateAddress(position);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.addListener('click', (event: any) => {
        if (event.latLng) {
          marker.setPosition(event.latLng);
          updateAddress(event.latLng);
        }
      });
    });
  };

  const confirm = () => {
    const address = mapAddress.trim();
    if (!address || !mapLocation) return;
    cancelPlaceSearch();
    onConfirm(address, { ...mapLocation, address });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent
        showCloseButton={false}
        className="top-4 max-h-[calc(100dvh-2rem)] translate-y-0 overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-slate-900">Pilih lokasi</DialogTitle>
        </DialogHeader>

        <Field
          label="Cari Tempat Atau Alamat"
          htmlFor="simulationMapSearch"
          error={mapSearchError || placeSearchError || undefined}
          hint={mapSearchText.trim().length > 0 && mapSearchText.trim().length < PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH
            ? `Ketik minimal ${PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH} karakter untuk menampilkan saran.`
            : undefined}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" />
            <Input
              id="simulationMapSearch"
              type="text"
              value={mapSearchText}
              onChange={(event) => handleMapSearchChange(event.target.value)}
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
                    <span className="block truncate text-xs text-slate-500">{suggestion.secondaryText}</span>
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
          ref={(element) => {
            if (element) initMap(element);
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
          <Button type="button" variant="outline" size="lg" onClick={close}>
            Batal
          </Button>
          <Button type="button" variant="accent" size="lg" onClick={confirm} disabled={!mapAddress || !mapLocation}>
            Gunakan lokasi ini
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
