// Web App Manifest — drives the Android "Add to Home Screen" icon, name, and
// standalone launch. iOS uses app/apple-icon.png instead (auto-linked by Next).
// Icons are regenerated from the logo by scripts/generate-icons.mjs.
export default function manifest() {
  return {
    name: "LQK Teachers Portal",
    short_name: "LQK Teachers",
    description: "Little Quran Kids — Teachers Portal",
    start_url: "/",
    display: "standalone",
    background_color: "#B05828", // terracotta — matches the app-icon artwork on the launch splash
    theme_color: "#333A22", // olive — matches the app's UI chrome / status bar
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
