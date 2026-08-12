"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

export const PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH = 4;
export const PLACE_AUTOCOMPLETE_DEBOUNCE_MS = 400;
const PLACE_AUTOCOMPLETE_CACHE_LIMIT = 50;

export interface CostSafePlaceSuggestion {
  id: string;
  primaryText: string;
  secondaryText: string;
  queryText: string;
}

interface UseCostSafePlaceAutocompleteOptions {
  loadGoogleMapsScript: (callback: () => void) => void;
}

interface GoogleAutocompletePredictionShape {
  text?: unknown;
  mainText?: unknown;
  secondaryText?: unknown;
  placeId?: unknown;
  place?: unknown;
}

interface GoogleAutocompleteSuggestionShape {
  placePrediction?: GoogleAutocompletePredictionShape | null;
}

interface GoogleAutocompleteSuggestionResponseShape {
  suggestions?: GoogleAutocompleteSuggestionShape[];
}

interface GoogleAutocompleteSuggestionServiceShape {
  fetchAutocompleteSuggestions: (request: {
    input: string;
    language: string;
    region: string;
    includedRegionCodes: string[];
  }) => Promise<GoogleAutocompleteSuggestionResponseShape>;
}

interface GooglePlacesLibraryShape {
  AutocompleteSuggestion?: GoogleAutocompleteSuggestionServiceShape;
}

interface GoogleMapsGlobalShape {
  maps?: {
    importLibrary?: (library: string) => Promise<unknown>;
    places?: GooglePlacesLibraryShape;
  };
}

function googleText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (
    value &&
    typeof value === 'object' &&
    'text' in value &&
    typeof (value as { text?: unknown }).text === 'string'
  ) {
    return (value as { text: string }).text.trim();
  }
  if (value && typeof (value as { toString?: unknown }).toString === 'function') {
    const text = String(value).trim();
    return text === '[object Object]' ? '' : text;
  }
  return '';
}

function toSuggestionOption(
  suggestion: GoogleAutocompleteSuggestionShape,
  index: number,
): CostSafePlaceSuggestion | null {
  const prediction = suggestion?.placePrediction;
  if (!prediction) return null;

  const fullText = googleText(prediction.text);
  const primaryText = googleText(prediction.mainText) || fullText;
  const secondaryText = googleText(prediction.secondaryText);
  const queryText = fullText || [primaryText, secondaryText].filter(Boolean).join(', ');
  if (!queryText) return null;

  const placeId = googleText(prediction.placeId) || googleText(prediction.place);
  return {
    id: placeId || `${queryText}-${index}`,
    primaryText,
    secondaryText,
    queryText,
  };
}

/**
 * Programmatic Autocomplete (New) without session tokens.
 *
 * This deliberately uses per-request billing. The selected text must be
 * resolved separately by Geocoding; no Place Details call is made here.
 */
export function useCostSafePlaceAutocomplete({
  loadGoogleMapsScript,
}: UseCostSafePlaceAutocompleteOptions) {
  const [suggestions, setSuggestions] = useState<CostSafePlaceSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const cacheRef = useRef(new Map<string, CostSafePlaceSuggestion[]>());

  const cancelSearch = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    requestRef.current += 1;
    setSuggestions([]);
    setIsSearching(false);
    setSearchError('');
  }, []);

  useEffect(() => cancelSearch, [cancelSearch]);

  const search = useCallback((value: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const normalizedQuery = value.trim().replace(/\s+/g, ' ');
    const requestId = ++requestRef.current;
    setSuggestions([]);
    setSearchError('');

    if (normalizedQuery.length < PLACE_AUTOCOMPLETE_MIN_QUERY_LENGTH) {
      setIsSearching(false);
      return;
    }

    const cacheKey = normalizedQuery.toLocaleLowerCase('id-ID');
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setSuggestions(cached);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(() => {
      loadGoogleMapsScript(() => {
        void (async () => {
          try {
            const google = (window as Window & { google?: GoogleMapsGlobalShape }).google;
            const importedPlacesLibrary = google?.maps?.importLibrary
              ? await google.maps.importLibrary('places')
              : google?.maps?.places;
            const placesLibrary = importedPlacesLibrary as GooglePlacesLibraryShape | undefined;
            const autocompleteSuggestion = placesLibrary?.AutocompleteSuggestion
              || google?.maps?.places?.AutocompleteSuggestion;

            if (!autocompleteSuggestion?.fetchAutocompleteSuggestions) {
              throw new Error('Google Places Autocomplete tidak tersedia.');
            }

            // No sessionToken is intentional: this flow uses per-request
            // Autocomplete, followed by one Geocoding request after selection.
            const response = await autocompleteSuggestion.fetchAutocompleteSuggestions({
              input: normalizedQuery,
              language: 'id',
              region: 'id',
              includedRegionCodes: ['id'],
            });

            if (requestId !== requestRef.current) return;
            const options = (Array.isArray(response?.suggestions) ? response.suggestions : [])
              .map(toSuggestionOption)
              .filter((option: CostSafePlaceSuggestion | null): option is CostSafePlaceSuggestion => Boolean(option))
              .slice(0, 5);

            if (cacheRef.current.size >= PLACE_AUTOCOMPLETE_CACHE_LIMIT) {
              const oldestCacheKey = cacheRef.current.keys().next().value;
              if (typeof oldestCacheKey === 'string') {
                cacheRef.current.delete(oldestCacheKey);
              }
            }
            cacheRef.current.set(cacheKey, options);
            setSuggestions(options);
            setSearchError(options.length === 0 ? 'Tidak ada saran lokasi yang cocok.' : '');
          } catch (error) {
            if (requestId !== requestRef.current) return;
            console.warn('Google Places suggestions unavailable:', error);
            setSuggestions([]);
            setSearchError('Saran lokasi tidak tersedia. Geser pin pada peta untuk memilih lokasi.');
          } finally {
            if (requestId === requestRef.current) {
              setIsSearching(false);
            }
          }
        })();
      });
    }, PLACE_AUTOCOMPLETE_DEBOUNCE_MS);
  }, [loadGoogleMapsScript]);

  return {
    suggestions,
    isSearching,
    searchError,
    search,
    cancelSearch,
  };
}
