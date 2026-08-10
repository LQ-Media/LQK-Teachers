// LQK Teachers Portal — service worker.
// Purpose: make the app installable (Chrome requires a SW with a fetch handler)
// and degrade gracefully offline. Deliberately conservative for an authed app:
// navigations are network-first (so the auth proxy always runs and data is
// fresh), only immutable static assets are cached, and nothing user-specific
// is stored. Bump VERSION to force old caches out.
const VERSION = "lqk-v5"; // bumped 2026-08-10 to add /qibla to the offline routes
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

// Routes whose shell may be kept for offline use. Deliberately narrow: these
// three hold public religious text and a bearing computed on the device — no
// personal data. Everything else — the dashboard, the hafalan tracker, work
// hours, admin — carries student, pay or roster data and is never written to
// the cache, so an offline device cannot surface it.
//
// /qibla is safe because its city reference points are bundled in the JS: once
// the page and its chunks are cached, picking a place and reading a bearing
// needs no network at all.
const OFFLINE_ROUTES = [/^\/quran(\/|$)/, /^\/dzikir(\/|$)/, /^\/qibla(\/|$)/];
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

// ---- Azan push notifications -------------------------------------------
// The server (lib/azan/scheduler.js) sends a push at each enabled prayer's
// time. Browsers require userVisibleOnly subscriptions, so every push shows
// a notification; tapping it opens the Solat & Azan page, which plays the
// user's chosen azan on arrival (see components/solat/AzanPlayer.js).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // non-JSON push — show a generic notice
  }
  const title = data.title || "Prayer time";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "It's time to pray.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.prayer ? `azan-${data.prayer}` : "azan",
      data: { url: data.url || "/solat", prayer: data.prayer || null },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/solat";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
