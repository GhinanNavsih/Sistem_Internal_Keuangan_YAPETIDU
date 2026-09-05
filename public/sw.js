const CACHE_NAME = 'bak-payroll-cache-v5';
const ASSETS_TO_CACHE = [
  '/manifest.json',
  '/Logo YAPETIDU (Transparent bg).png',
  '/Logo UNIPDU.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const path = url.pathname;

  // Normalize path to check against ASSETS_TO_CACHE (remove trailing slash if any)
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  
  const isPrecached = ASSETS_TO_CACHE.includes(path) || 
                      ASSETS_TO_CACHE.includes(normalizedPath) ||
                      (normalizedPath === '' && ASSETS_TO_CACHE.includes('/'));

  if (!isPrecached) {
    // Let all other requests (Next.js chunks, dynamic routes, APIs) bypass the service worker and load via network
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch new version in background (stale-while-revalidate)
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
            }
          })
          .catch(() => {/* Ignore network errors in background */});
        return cachedResponse;
      }

      return fetch(event.request);
    })
  );
});
