/* The invitation design spec.

   Karim asked for full AI generation: upload a sample image, get a complete
   original design back. This module is what makes that safe to send to 200
   guests. The model does NOT emit HTML or CSS — it emits one of these objects,
   and the renderer owns the box model. That means a bad generation can produce
   an *ugly* invite but never a *broken* one: no overflow on a 375px phone, no
   unreadable contrast, no layout that collapses when `dir` flips to rtl.

   Everything here is clamped or enumerated. `sanitizeTheme` is the only door —
   anything from Gemini, from an import, or from a hand-edited DB row goes
   through it, and it always returns a renderable theme. It never throws and
   never returns null, because the fallback path for a guest opening an invite
   cannot be an error page.

   Client-safe: no db, no server-only. The preview in the admin studio and the
   live guest page render through the exact same function, so what Karim
   approves is pixel-identical to what guests receive. */

/* ---- enumerations the renderer knows how to draw ------------------------ */

export const LAYOUTS = [
  "centered-classic", // stacked, centred, generous vertical rhythm
  "framed-panel", // content inside an ornamental border
  "photo-hero", // full-bleed image top, content below
  "side-band", // vertical decorative band beside the content
  "arch-window", // content inside an arch/mihrab silhouette
  "minimal-rule", // type-only, thin rules, lots of air
];

export const ORNAMENTS = [
  "none",
  "geometric", // islamic tessellation
  "arabesque", // flowing vegetal
  "botanical", // leaves/florals
  "artdeco",
  "handdrawn",
  "corner-flourish",
];

export const FONT_PAIRS = {
  // key: [heading stack, body stack] — all web-safe or already loaded by the app
  "classic-serif": ['"Amiri", Georgia, serif', 'Georgia, "Times New Roman", serif'],
  "modern-sans": ['"Baloo 2", system-ui, sans-serif', '"Nunito", system-ui, sans-serif'],
  "elegant-mix": ['"Amiri", Georgia, serif', '"Nunito", system-ui, sans-serif'],
  "soft-round": ['"Baloo 2", system-ui, sans-serif', '"Nunito", system-ui, sans-serif'],
};

export const MOTIONS = ["none", "fade", "rise", "reveal"];

/* The house theme. Also the fallback for any invalid generation, so it has to
   be genuinely good on its own — never a grey debug placeholder. */
export const DEFAULT_THEME = {
  layout: "centered-classic",
  palette: {
    bg: "#FBF6EC",
    surface: "#FFFFFF",
    ink: "#3B372B",
    muted: "#776E5D",
    accent: "#96681A",
    line: "#E8DDC5",
  },
  fontPair: "elegant-mix",
  scale: 1,
  radius: 20,
  ornament: "geometric",
  ornamentOpacity: 0.12,
  bgImage: null, // Drive/base64 URL of generated art, or null
  bgImageOpacity: 0.18,
  motion: "rise",
};

/* ---- validation --------------------------------------------------------- */

const HEX = /^#[0-9a-fA-F]{6}$/;

function hex(value, fallback) {
  return typeof value === "string" && HEX.test(value) ? value.toUpperCase() : fallback;
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/* Relative luminance per WCAG 2.1 — used to guarantee body text is legible on
   the surface the model chose. A generated palette that looks lovely in the
   admin preview can still be cream-on-cream; this is the check that catches it. */
function luminance(hexColor) {
  const c = hexColor.slice(1);
  const rgb = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* Darkens or lightens `ink` until it clears `min` against `surface`. Chosen
   over rejecting the palette outright because the model usually gets the hue
   right and only the value wrong — nudging keeps the intended character. */
function enforceContrast(ink, surface, min) {
  if (contrastRatio(ink, surface) >= min) return ink;
  const goDark = luminance(surface) > 0.4;
  let [r, g, b] = [ink.slice(1, 3), ink.slice(3, 5), ink.slice(5, 7)].map((h) => parseInt(h, 16));
  for (let step = 0; step < 20; step += 1) {
    r = goDark ? Math.max(0, r - 12) : Math.min(255, r + 12);
    g = goDark ? Math.max(0, g - 12) : Math.min(255, g + 12);
    b = goDark ? Math.max(0, b - 12) : Math.min(255, b + 12);
    const next = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    if (contrastRatio(next, surface) >= min) return next;
  }
  return goDark ? "#1A1814" : "#FFFFFF";
}

/* The single door. Always returns a complete, renderable, accessible theme. */
export function sanitizeTheme(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_THEME };
    }
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_THEME };

  const p = raw.palette && typeof raw.palette === "object" ? raw.palette : {};
  const surface = hex(p.surface, DEFAULT_THEME.palette.surface);
  const bg = hex(p.bg, DEFAULT_THEME.palette.bg);

  // 7:1 for body text, 4.5:1 for the accent (used on larger/interactive type).
  const ink = enforceContrast(hex(p.ink, DEFAULT_THEME.palette.ink), surface, 7);
  const muted = enforceContrast(hex(p.muted, DEFAULT_THEME.palette.muted), surface, 4.5);
  const accent = enforceContrast(hex(p.accent, DEFAULT_THEME.palette.accent), surface, 4.5);

  return {
    layout: pick(raw.layout, LAYOUTS, DEFAULT_THEME.layout),
    palette: {
      bg,
      surface,
      ink,
      muted,
      accent,
      line: hex(p.line, DEFAULT_THEME.palette.line),
    },
    fontPair: pick(raw.fontPair, Object.keys(FONT_PAIRS), DEFAULT_THEME.fontPair),
    scale: clamp(raw.scale, 0.85, 1.25, DEFAULT_THEME.scale),
    radius: clamp(raw.radius, 0, 32, DEFAULT_THEME.radius),
    ornament: pick(raw.ornament, ORNAMENTS, DEFAULT_THEME.ornament),
    ornamentOpacity: clamp(raw.ornamentOpacity, 0, 0.4, DEFAULT_THEME.ornamentOpacity),
    // Only same-origin paths and data: URIs — a model-supplied absolute URL
    // would let generated content phone out from every guest's browser.
    bgImage:
      typeof raw.bgImage === "string" &&
      (raw.bgImage.startsWith("/") || raw.bgImage.startsWith("data:image/"))
        ? raw.bgImage
        : null,
    bgImageOpacity: clamp(raw.bgImageOpacity, 0, 0.6, DEFAULT_THEME.bgImageOpacity),
    motion: pick(raw.motion, MOTIONS, DEFAULT_THEME.motion),
  };
}

/* CSS custom properties for the renderer. Kept here so the admin preview and
   the guest page cannot drift apart. */
export function themeVars(theme) {
  const t = sanitizeTheme(theme);
  const [heading, body] = FONT_PAIRS[t.fontPair] || FONT_PAIRS[DEFAULT_THEME.fontPair];
  return {
    "--inv-bg": t.palette.bg,
    "--inv-surface": t.palette.surface,
    "--inv-ink": t.palette.ink,
    "--inv-muted": t.palette.muted,
    "--inv-accent": t.palette.accent,
    "--inv-line": t.palette.line,
    "--inv-radius": `${t.radius}px`,
    "--inv-scale": String(t.scale),
    "--inv-font-heading": heading,
    "--inv-font-body": body,
    "--inv-ornament-opacity": String(t.ornamentOpacity),
    "--inv-bg-image-opacity": String(t.bgImageOpacity),
  };
}
