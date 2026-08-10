// Web App Manifest — drives the Android "Add to Home Screen" icon, name, and
// standalone launch. iOS uses app/apple-icon.png instead (auto-linked by Next).
// Icons are regenerated from the logo by scripts/generate-icons.mjs.
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
    // continuation of the app and the brand-orange mark sits on the same ground
    // it does in app/apple-icon.png and public/icon-maskable-512.png.
    background_color: "#FBF6EC",
    theme_color: "#FBF6EC",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the home-screen icon → jump straight to a section.
    shortcuts: [
      { name: "Work hours", short_name: "Hours", url: "/hours", description: "Clock in and out" },
      { name: "Quran tracker", short_name: "Tracker", url: "/hafalan", description: "Log a lesson" },
    ],
  };
}
