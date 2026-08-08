// Invite styling vocabulary — shared by the builder (client), the live
// preview, the public invite page and the email renderer, so all four agree on
// what a saved design means.
//
// No "server-only" here on purpose: the builder is a Client Component and
// imports these lists to render its controls.

// Fonts are limited to web-safe stacks plus the two brand faces already loaded
// by app/layout.js. An invite email cannot rely on a webfont — Gmail and
// Outlook strip @font-face — so every choice names a real fallback that exists
// on the recipient's machine. `email` is what goes into the email's inline CSS.
export const FONTS = [
  { id: "baloo", label: "Baloo (brand display)", css: "var(--font-baloo), 'Trebuchet MS', sans-serif", email: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  { id: "nunito", label: "Nunito Sans (brand body)", css: "var(--font-nunito), 'Segoe UI', sans-serif", email: "'Segoe UI', Tahoma, sans-serif" },
  { id: "georgia", label: "Georgia (serif)", css: "Georgia, 'Times New Roman', serif", email: "Georgia, 'Times New Roman', serif" },
  { id: "helvetica", label: "Helvetica (clean sans)", css: "'Helvetica Neue', Helvetica, Arial, sans-serif", email: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: "courier", label: "Courier (typewriter)", css: "'Courier New', Courier, monospace", email: "'Courier New', Courier, monospace" },
];

export const ALIGNMENTS = ["left", "center", "right"];

// How hard the background image is dimmed behind the text. A photo background
// with no scrim is the single most common way an invite becomes unreadable, so
// the default is a real dim, not zero.
export const OVERLAY_MIN = 0;
export const OVERLAY_MAX = 85;

export const DEFAULT_DESIGN = {
  headingFont: "baloo",
  bodyFont: "nunito",
  align: "center",
  // Brand palette from app/globals.css — ink on cream, lavender accent.
  pageColor: "#FBF6EC",
  cardColor: "#FFFFFF",
  textColor: "#403548",
  mutedColor: "#7E7368",
  accentColor: "#8C7AA8",
  buttonTextColor: "#FFFFFF",
  overlay: 45,
  cornerRadius: 20,
  showLogo: true,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function hex(value, fallback) {
  return HEX.test(String(value || "")) ? String(value) : fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function fontId(value, fallback) {
  return FONTS.some((f) => f.id === value) ? value : fallback;
}

// Never trust a stored or submitted design blob: it reaches the public invite
// page and an email, both of which interpolate it into CSS.
export function normalizeDesign(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    headingFont: fontId(d.headingFont, DEFAULT_DESIGN.headingFont),
    bodyFont: fontId(d.bodyFont, DEFAULT_DESIGN.bodyFont),
    align: ALIGNMENTS.includes(d.align) ? d.align : DEFAULT_DESIGN.align,
    pageColor: hex(d.pageColor, DEFAULT_DESIGN.pageColor),
    cardColor: hex(d.cardColor, DEFAULT_DESIGN.cardColor),
    textColor: hex(d.textColor, DEFAULT_DESIGN.textColor),
    mutedColor: hex(d.mutedColor, DEFAULT_DESIGN.mutedColor),
    accentColor: hex(d.accentColor, DEFAULT_DESIGN.accentColor),
    buttonTextColor: hex(d.buttonTextColor, DEFAULT_DESIGN.buttonTextColor),
    overlay: clampInt(d.overlay, OVERLAY_MIN, OVERLAY_MAX, DEFAULT_DESIGN.overlay),
    cornerRadius: clampInt(d.cornerRadius, 0, 40, DEFAULT_DESIGN.cornerRadius),
    showLogo: d.showLogo !== false,
  };
}

export function parseDesign(json) {
  try {
    return normalizeDesign(JSON.parse(json || "{}"));
  } catch {
    return { ...DEFAULT_DESIGN };
  }
}

export function fontCss(id) {
  return (FONTS.find((f) => f.id === id) || FONTS[0]).css;
}

export function fontEmail(id) {
  return (FONTS.find((f) => f.id === id) || FONTS[0]).email;
}

// ── Wording ────────────────────────────────────────────────────────────────
// Fixed strings for the two supported invite languages. The Malay wording is a
// first pass written for review by a native speaker — see docs/EVENTS.md.
export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ms", label: "Bahasa Melayu" },
];

const STRINGS = {
  en: {
    youreInvited: "You're invited",
    when: "When",
    where: "Where",
    programme: "Programme",
    dressCode: "Dress code",
    whatToBring: "What to bring",
    gettingThere: "Getting there",
    parking: "Parking",
    directions: "Directions",
    openInMaps: "Open in Maps",
    willYouCome: "Will you be joining us?",
    yes: "Yes, I'll be there",
    no: "Sorry, I can't make it",
    thanksYes: "Wonderful — we'll see you there!",
    thanksNo: "Thank you for letting us know.",
    change: "Changed your mind?",
    responded: "Your response has been recorded.",
    viewInvite: "View the invitation",
    hostedBy: "Hosted by",
    dear: "Dear",
    linkExpired: "This invitation link isn't valid.",
    linkExpiredBody: "Please check the link in your email or WhatsApp message, or contact us.",
  },
  ms: {
    youreInvited: "Anda dijemput",
    when: "Bila",
    where: "Di mana",
    programme: "Atur cara",
    dressCode: "Kod pakaian",
    whatToBring: "Apa yang perlu dibawa",
    gettingThere: "Cara ke sana",
    parking: "Tempat letak kereta",
    directions: "Arah",
    openInMaps: "Buka dalam Peta",
    willYouCome: "Adakah anda akan hadir?",
    yes: "Ya, saya akan hadir",
    no: "Maaf, saya tidak dapat hadir",
    thanksYes: "Bagus — jumpa anda di sana!",
    thanksNo: "Terima kasih kerana memberitahu kami.",
    change: "Berubah fikiran?",
    responded: "Jawapan anda telah direkodkan.",
    viewInvite: "Lihat jemputan",
    hostedBy: "Dianjurkan oleh",
    dear: "Salam sejahtera",
    linkExpired: "Pautan jemputan ini tidak sah.",
    linkExpiredBody: "Sila semak pautan dalam e-mel atau mesej WhatsApp anda, atau hubungi kami.",
  },
};

export function t(language) {
  return STRINGS[language] || STRINGS.en;
}
