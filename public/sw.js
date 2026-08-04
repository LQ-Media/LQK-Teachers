// LQK Teachers Portal — service worker.
// Purpose: make the app installable (Chrome requires a SW with a fetch handler)
// and degrade gracefully offline. Deliberately conservative for an authed app:
// navigations are network-first (so the auth proxy always runs and data is
// fresh), only immutable static assets are cached, and nothing user-specific
// is stored. Bump VERSION to force old caches out.
const VERSION = "lqk-v2";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

// Routes whose shell may be kept for offline use. Deliberately narrow: these
// two hold public religious text only. Everything else — the dashboard, the
// hafalan tracker, work hours, admin — carries student, pay or roster data and
// is never written to the cache, so an offline device cannot surface it.
const OFFLINE_ROUTES = [/^\/quran(\/|$)/, /^\/dzikir(\/|$)/];
const PRECACHE = [
  "/offline.html",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-icon.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: always try the network (keeps auth + data fresh). For the
  // two reader routes the successful response is also kept, so reopening them
  // without a connection still gets a working page instead of the offline
  // notice. Anything else falls straight through to /offline.html.
  if (req.mode === "navigate") {
    const cacheable = OFFLINE_ROUTES.some((re) => re.test(url.pathname));
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (cacheable && res.ok) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch {
          if (cacheable) {
            const cached = await caches.match(req, { cacheName: PAGE_CACHE, ignoreSearch: true });
            if (cached) return cached;
          }
          return caches.match("/offline.html");
        }
      })()
    );
    return;
  }

  // Immutable static assets (hashed JS/CSS, icons, fonts): cache-first.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    PRECACHE.includes(url.pathname) ||
    /\.(png|svg|ico|webp|woff2?)$/.test(url.pathname);

  if (isStatic) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, res.clone());
          return res;
        } catch {
          return cached || Response.error();
        }
      })()
    );
  }
  // Everything else (API, dynamic data): pass through to the network untouched.
});
