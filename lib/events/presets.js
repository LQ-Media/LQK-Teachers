/* Pickable-but-typeable presets for the event editor.

   These are SUGGESTIONS, never a closed list. Every one of them lands in a plain
   TEXT column and the admin can type anything instead — a preset that can't be
   overridden is a preset that will be wrong for the one majlis that matters.

   Dress code is grouped Islamic/Nusantara first because that is what LQK
   actually runs; the general attire group exists for school and corporate
   bookings. The strings are the guest-facing English copy verbatim — whatever
   is stored here is what appears on the invitation card, so they read as an
   instruction to a family, not as a category name. */
export const DRESS_CODE_GROUPS = [
  {
    label: "Islamic & Nusantara",
    options: [
      "Baju Melayu & Baju Kurung",
      "Baju Kurung / Kebaya",
      "Baju Melayu with sampin & songkok",
      "Batik",
      "Baju koko & sarong",
      "Jubah / Thobe",
      "Abaya",
      "Jubah & serban",
      "Telekung / prayer attire provided",
      "Modest dress — arms and legs covered",
      "White attire",
      "Green attire — in the spirit of the Maulid",
      "Pastel tones — we will be taking a family photograph",
      "Traditional dress of your heritage",
      "Kurta / Punjabi",
      "Raya best",
    ],
  },
  {
    label: "General attire",
    options: [
      "Smart casual",
      "Formal",
      "Business attire",
      "Casual — come as you are",
      "Comfortable clothes — seating is on the floor",
      "Sunday best",
      "Sports attire",
      "Children in school uniform",
      "All white",
      "No dress code",
    ],
  },
];

export const DRESS_CODE_OPTIONS = DRESS_CODE_GROUPS.flatMap((g) => g.options);

/* Karim asked for "tens, up to 1000". Small numbers matter more than large ones
   — most invitations are a single family — so 1–9 are listed individually
   before the tens begin, and anything at all can still be typed. */
export const MAX_PARTY_SIZE_LIMIT = 5000;

export const PARTY_SIZE_GROUPS = [
  {
    label: "A family",
    options: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  },
  {
    label: "Tens",
    options: Array.from({ length: 100 }, (_, i) => String((i + 1) * 10)),
  },
];

export function clampPartySize(value, fallback = 10) {
  const n = Math.round(Number(String(value ?? "").replace(/[^\d]/g, "")));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(MAX_PARTY_SIZE_LIMIT, n);
}
