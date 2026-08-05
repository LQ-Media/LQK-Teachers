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
    background_color: "#E47687", // rose — matches the app-icon artwork on the launch splash
    theme_color: "#5E3448", // deep plum — matches the app's UI chrome / status bar
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
