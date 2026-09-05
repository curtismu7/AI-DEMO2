// Minimal PWA service worker — installability + offline-friendly static
// assets only. It never touches anything session/auth-related: API calls,
// the SSE/WebSocket paths, and the HTML document itself always go straight
// to the network, untouched. See REGRESSION_PLAN.md "BFF langchain chat-WS
// proxy — token custody" for why nothing here may intercept a request that
// could carry a credential.
//
// Cache-first applies ONLY to Vite's hashed build output (/assets/*-<hash>.*)
// and the small set of static icons the manifest references — content-hashed
// filenames change on every deploy, so a cache-first strategy for them can
// never serve stale code.

const STATIC_CACHE = 'ai-demo-static-v1';
const PRECACHE_URLS = ['/favicon-32.png', '/apple-touch-icon.png', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isHashedBuildAsset(url) {
  return url.pathname.startsWith('/assets/') && /-[a-z0-9]{8,}\.(js|css|png|jpg|svg|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!isHashedBuildAsset(url) && !PRECACHE_URLS.includes(url.pathname)) return;

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
