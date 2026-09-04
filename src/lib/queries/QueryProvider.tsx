"use client";

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_GC_TIME, STALE_TIME } from './keys';

/**
 * Wraps the app in a TanStack Query cache so that repeat visits to a page reuse
 * the data already pulled instead of re-reading whole Firestore collections on
 * every mount.
 *
 * Defaults are tuned for an internal admin tool on a metered Firestore:
 * - `staleTime` of 5 minutes so navigating away and back is instant. Per-query
 *   overrides live in `STALE_TIME` (see keys.ts).
 * - `refetchOnWindowFocus: false` — collections here are large and rarely change
 *   under the user's feet; alt-tabbing should not trigger a full re-read.
 * - `retry: 1` — a Firestore permission error will never succeed on retry, so
 *   failing fast keeps the UI responsive.
 *
 * Writes are responsible for invalidating what they changed; nothing here
 * expires financial data on its own.
 */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  // Created lazily in state so the client survives re-renders but is never
  // shared between users/requests.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: STALE_TIME.default,
            gcTime: DEFAULT_GC_TIME,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
