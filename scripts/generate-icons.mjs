// Regenerates every app icon and favicon for the TEACHERS portal from ONE source
// of truth: brand/app-icon.png — the reading-ustazah plate Karim supplied
// (Aug 2026).
//
// To change the icon, replace that one file and run:
//
//   npm run icons
//
// …then commit the regenerated files. Nothing here is generated at build time:
// the icons are committed artifacts, so a deploy can never fail on image
// processing, and a reviewer can see exactly what shipped.
//
// This SUPERSEDES the earlier rule that every icon had to be rendered from
// brand/lqk-logo.svg. That rule existed to stop stand-in artwork drifting in;
// it is retired because Karim commissioned a purpose-built plate per site, and
// because a parent and a teacher may both have an LQK icon on the same phone —
// four copies of the same monogram would be unusable on a home screen. The SVG
// stays in brand/ as the wordmark for in-app use.
//
// Outputs:
//   app/apple-icon.png           → iOS "Add to Home Screen" (180×180)
//   app/favicon.ico              → browser tab (16/32/48)
//   public/icon-192.png          → Android manifest icon, purpose "any"
//   public/icon-512.png          → Android manifest icon, purpose "any"
//   public/icon-maskable-512.png → Android adaptive icon, purpose "maskable"
//
// Needs `sharp`, which this repo gets for free as one of Next's own optional
// dependencies rather than declaring it — deliberately, so the lockfile the
// Docker build runs `npm ci` against stays untouched. If the import ever fails,
// run the script with `npx --yes sharp-cli`-style isolation or add sharp as a
// devDependency and re-lock; nothing in the build depends on it, because the
// icons are committed.
//
// After changing these, bump ICON_VERSION in app/manifest.js and VERSION in
// public/sw.js — Android only re-fetches an installed icon when its URL
// changes, and the service worker precaches the icons cache-first.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIconSet } from "./lib/app-icon.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => path.join(ROOT, ...s);

await buildIconSet({
  src: p("brand/app-icon.png"),
  // The artwork is already an app-icon plate, so it is cropped just past its own
  // rounded corners and run edge to edge — iOS and Android then apply their own
  // mask to a solid square instead of rounding an already-rounded tile.
  mode: "bleed",
  out: {
    apple: p("app/apple-icon.png"),
    icon192: p("public/icon-192.png"),
    icon512: p("public/icon-512.png"),
    maskable: p("public/icon-maskable-512.png"),
    favicon: p("app/favicon.ico"),
  },
});
console.log("done");
