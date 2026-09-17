// LQK Teachers Portal — service worker.
// Purpose: make the app installable (Chrome requires a SW with a fetch handler)
// and degrade gracefully offline. Deliberately conservative for an authed app:
// navigations are network-first (so the auth proxy always runs and data is
// fresh), only immutable static assets are cached, and nothing user-specific
// is stored. Bump VERSION to force old caches out.
const VERSION = "lqk-v8"; // bumped 2026-09-17: push payloads are no longer azan-only
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
//
// /games is safe for the same reason and needs it more than any of them: the
// games are handed to a child in a classroom, which is exactly where the wifi
// is worst, and they hold no personal data at all — the letter shapes, the
// mascots and the sounds are the same for everyone and nothing is recorded.
const OFFLINE_ROUTES = [
  /^\/quran(\/|$)/,
  /^\/dzikir(\/|$)/,
  /^\/qibla(\/|$)/,
  /^\/games(\/|$)/,
];
const PRECACHE = [
  "/offline.html",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-icon.png",
  "/manifest.webmanifest",
  // The Huruf games' own assets. The geometry is what every game draws from,
  // so without it a cached game page would open to an empty box. These sit
  // under /huruf/ rather than /games/ for two reasons: /games/<name> is a
  // route, and proxy.js lets /huruf/ through the auth gate — precaching
  // happens at install time, and behind the gate an expired session would
  // cache the login page's HTML under the geometry's URL.
  "/huruf/geometry.json",
  "/huruf/forms.json",
  "/huruf/mascot-ustaz.png",
  "/huruf/mascot-ustazah.png",
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
  // Everything under /huruf/ is static game content — letter geometry, the
  // mascots and the letter sounds — and is cached the same way as a hashed
  // asset so a classroom tablet keeps working without a network.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/huruf/") ||
    PRECACHE.includes(url.pathname) ||
    /\.(png|svg|ico|webp|woff2?|ttf|mp3)$/.test(url.pathname);

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

// ---- Push notifications -------------------------------------------------
// Two senders share this handler:
//   • lib/azan/scheduler.js        — a push at each enabled prayer time
//   • lib/hours/notify-scheduler.js — shift reminders, missing clock-ins,
//                                     and shifts offered for cover
//
// Browsers require userVisibleOnly subscriptions, so every push shows a
// notification. The payload carries its own title, body, tag and url; the
// fallbacks below are only for a malformed push, and are deliberately generic
// rather than azan-specific — a shift notification that failed to parse must
// not appear on a teacher's lock screen reading "It's time to pray."
//
// `tag` is what stops a phone stacking three copies of the same nag: the
// senders build it from the shift or prayer id, so a repeat REPLACES rather
// than adds.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // non-JSON push — show a generic notice
  }
  const isAzan = !!data.prayer;
  const title = data.title || (isAzan ? "Prayer time" : "Little Quran Kids");
  const tag = data.tag || (isAzan ? `azan-${data.prayer}` : "lqk");
  const url = data.url || (isAzan ? "/solat" : "/dashboard");
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || (isAzan ? "It's time to pray." : "Open the portal for details."),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag,
      data: { url, prayer: data.prayer || null },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
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
