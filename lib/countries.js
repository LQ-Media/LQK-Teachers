// Shared country reference used by the prayer-times widget and the Qibla
// finder. Each entry carries:
//   • city / lat / lng — the reference point used when we don't have (or can't
//     get) the device's own GPS position.
//   • method / authority — the Aladhan calculation method id of that country's
//     OFFICIAL prayer-time authority, verified against api.aladhan.com/v1/methods.
//
// Singapore is first (home); the rest are alphabetical.

export const COUNTRIES = [
  { code: "SG", name: "Singapore", city: "Singapore", lat: 1.3521, lng: 103.8198, method: 11, authority: "MUIS" },
  { code: "MY", name: "Malaysia", city: "Kuala Lumpur", lat: 3.139, lng: 101.6869, method: 17, authority: "JAKIM" },
  { code: "ID", name: "Indonesia", city: "Jakarta", lat: -6.2088, lng: 106.8456, method: 20, authority: "Kemenag" },
  { code: "BN", name: "Brunei", city: "Bandar Seri Begawan", lat: 4.9031, lng: 114.9398, method: 17, authority: "JAKIM (regional)" },
  { code: "AU", name: "Australia", city: "Sydney", lat: -33.8688, lng: 151.2093, method: 3, authority: "Muslim World League" },
  { code: "BH", name: "Bahrain", city: "Manama", lat: 26.2285, lng: 50.586, method: 8, authority: "Gulf Region" },
  { code: "BD", name: "Bangladesh", city: "Dhaka", lat: 23.8103, lng: 90.4125, method: 1, authority: "Karachi" },
  { code: "CA", name: "Canada", city: "Toronto", lat: 43.6532, lng: -79.3832, method: 2, authority: "ISNA" },
  { code: "EG", name: "Egypt", city: "Cairo", lat: 30.0444, lng: 31.2357, method: 5, authority: "Egyptian General Authority" },
  { code: "FR", name: "France", city: "Paris", lat: 48.8566, lng: 2.3522, method: 12, authority: "UOIF" },
  { code: "IN", name: "India", city: "New Delhi", lat: 28.6139, lng: 77.209, method: 1, authority: "Karachi" },
  { code: "IR", name: "Iran", city: "Tehran", lat: 35.6892, lng: 51.389, method: 7, authority: "Univ. of Tehran" },
  { code: "JO", name: "Jordan", city: "Amman", lat: 31.9454, lng: 35.9284, method: 23, authority: "Ministry of Awqaf" },
  { code: "KW", name: "Kuwait", city: "Kuwait City", lat: 29.3759, lng: 47.9774, method: 9, authority: "Kuwait" },
  { code: "MA", name: "Morocco", city: "Casablanca", lat: 33.5731, lng: -7.5898, method: 21, authority: "Morocco" },
  { code: "OM", name: "Oman", city: "Muscat", lat: 23.588, lng: 58.3829, method: 8, authority: "Gulf Region" },
  { code: "PK", name: "Pakistan", city: "Karachi", lat: 24.8607, lng: 67.0011, method: 1, authority: "Karachi" },
  { code: "PH", name: "Philippines", city: "Manila", lat: 14.5995, lng: 120.9842, method: 3, authority: "Muslim World League" },
  { code: "QA", name: "Qatar", city: "Doha", lat: 25.2854, lng: 51.531, method: 10, authority: "Qatar" },
  { code: "SA", name: "Saudi Arabia", city: "Makkah", lat: 21.3891, lng: 39.8579, method: 4, authority: "Umm Al-Qura" },
  { code: "TH", name: "Thailand", city: "Bangkok", lat: 13.7563, lng: 100.5018, method: 3, authority: "Muslim World League" },
  { code: "TN", name: "Tunisia", city: "Tunis", lat: 36.8065, lng: 10.1815, method: 18, authority: "Tunisia" },
  { code: "TR", name: "Türkiye", city: "Istanbul", lat: 41.0082, lng: 28.9784, method: 13, authority: "Diyanet" },
  { code: "AE", name: "United Arab Emirates", city: "Dubai", lat: 25.2048, lng: 55.2708, method: 16, authority: "Dubai" },
  { code: "GB", name: "United Kingdom", city: "London", lat: 51.5074, lng: -0.1278, method: 3, authority: "Muslim World League" },
  { code: "US", name: "United States", city: "New York", lat: 40.7128, lng: -74.006, method: 2, authority: "ISNA" },
];

export const BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

/** Infer the country (and its authority) from an IANA timezone. */
export function countryForTimezone(tz) {
  const region = String(tz || "");
  if (region === "Asia/Singapore") return BY_CODE.SG;
  if (region === "Asia/Kuala_Lumpur" || region === "Asia/Kuching") return BY_CODE.MY;
  if (/^Asia\/(Jakarta|Pontianak|Makassar|Jayapura)$/.test(region)) return BY_CODE.ID;
  if (region === "Asia/Brunei") return BY_CODE.BN;
  if (region === "Asia/Bangkok") return BY_CODE.TH;
  if (region === "Asia/Manila") return BY_CODE.PH;
  if (region === "Asia/Riyadh") return BY_CODE.SA;
  if (region === "Asia/Dubai") return BY_CODE.AE;
  if (region === "Asia/Qatar") return BY_CODE.QA;
  if (region === "Asia/Kuwait") return BY_CODE.KW;
  if (region === "Asia/Bahrain") return BY_CODE.BH;
  if (region === "Asia/Muscat") return BY_CODE.OM;
  if (region === "Asia/Amman") return BY_CODE.JO;
  if (region === "Asia/Karachi") return BY_CODE.PK;
  if (region === "Asia/Kolkata" || region === "Asia/Calcutta") return BY_CODE.IN;
  if (region === "Asia/Dhaka") return BY_CODE.BD;
  if (region === "Asia/Tehran") return BY_CODE.IR;
  if (region === "Europe/Istanbul") return BY_CODE.TR;
  if (region === "Europe/London") return BY_CODE.GB;
  if (region === "Europe/Paris") return BY_CODE.FR;
  if (region === "Africa/Cairo") return BY_CODE.EG;
  if (region === "Africa/Casablanca") return BY_CODE.MA;
  if (region === "Africa/Tunis") return BY_CODE.TN;
  if (region.startsWith("America/")) return BY_CODE.US;
  if (region.startsWith("Australia/")) return BY_CODE.AU;
  // Unknown region — fall back to the org's home country.
  return BY_CODE.SG;
}
