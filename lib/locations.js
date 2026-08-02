// The four branches. Kept in their own module rather than in lib/db.js so the
// public register form — a client component — can import the list without
// pulling node:sqlite into the browser bundle (same reason lib/countries.js
// exists). lib/db.js re-exports it, so server imports are unchanged.
export const LOCATIONS = [
  "Woods Square",
  "Primz Bizhub",
  "Tampines Blk 462",
  "Tampines Junction",
];
