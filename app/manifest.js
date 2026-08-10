// Web App Manifest — drives the Android "Add to Home Screen" icon, name, and
// standalone launch. iOS uses app/apple-icon.png instead (auto-linked by Next).
// Icons are regenerated from brand/app-icon.png by scripts/generate-icons.mjs.

// Bump this whenever the icons change (and bump VERSION in public/sw.js too —
// the service worker precaches them cache-first).
//
// Android caches the icons of an installed PWA in the generated WebAPK and only
// re-fetches them when the manifest changes AND the icon URL is new — replacing
// the bytes behind the same path leaves the old icon on the home screen. The
// query string is what makes the update land, usually within a day.
//
// It does nothing for iOS: an icon added to an iPhone home screen is frozen at
// the moment it was added and cannot be updated by the site at all. Re-adding
// the shortcut is the only way.
const ICON_VERSION = "2026-08-10";

export default function manifest() {
  return {
    id: "/",
    name: "LQK Teachers Portal",
    short_name: "LQK Teachers",
    description: "Little Quran Kids — Teachers Portal",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "en",
    dir: "ltr",
    categories: ["education", "productivity"],
    // Both are the cream page colour, so the Android splash is a seamless
    // continuation of the app. The icon carries its own aubergine plate and is
    // deliberately not matched to this — it has to read as a distinct tile on a
    // home screen that may also hold the parents app.
    background_color: "#FBF6EC",
    theme_color: "#FBF6EC",
    icons: [
      { src: `/icon-192.png?v=${ICON_VERSION}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/icon-512.png?v=${ICON_VERSION}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/icon-maskable-512.png?v=${ICON_VERSION}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the home-screen icon → jump straight to a section.
    shortcuts: [
      { name: "Work hours", short_name: "Hours", url: "/hours", description: "Clock in and out" },
      { name: "Quran tracker", short_name: "Tracker", url: "/hafalan", description: "Log a lesson" },
    ],
  };
}
