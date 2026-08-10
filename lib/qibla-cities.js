// City reference points for the Qibla finder's offline fallback.
//
// The prayer-times widget only ever needs one point per country (a calculation
// method is national), so lib/countries.js carries a single capital. The Qibla
// is a bearing, and a bearing moves with longitude — Kuching and Kuala Lumpur
// are 15° apart in Qibla despite sharing a country and a prayer-time method.
// Hence a separate list, kept here so lib/countries.js stays the one source of
// truth for prayer times.
//
// Bundled rather than fetched: the whole point is that a teacher standing in a
// hotel room with no signal can still pick where they are. It is a few KB.
//
// Coverage is deepest for the countries LQK teachers are actually in
// (Singapore, Malaysia, Indonesia, Saudi Arabia) and thinner elsewhere, where
// the entry is a starting point rather than a full gazetteer. A country with
// no entry here falls back to its lib/countries.js capital.
export const CITIES = {
  SG: [
    { name: "Singapore (city)", lat: 1.3521, lng: 103.8198 },
    { name: "Woodlands", lat: 1.4382, lng: 103.789 },
    { name: "Tampines", lat: 1.3496, lng: 103.9568 },
    { name: "Jurong East", lat: 1.3329, lng: 103.7436 },
    { name: "Changi", lat: 1.3644, lng: 103.9915 },
  ],
  MY: [
    { name: "Kuala Lumpur", lat: 3.139, lng: 101.6869 },
    { name: "Shah Alam", lat: 3.0733, lng: 101.5185 },
    { name: "Johor Bahru", lat: 1.4927, lng: 103.7414 },
    { name: "George Town (Penang)", lat: 5.4141, lng: 100.3288 },
    { name: "Ipoh", lat: 4.5975, lng: 101.0901 },
    { name: "Melaka", lat: 2.1896, lng: 102.2501 },
    { name: "Kuantan", lat: 3.8077, lng: 103.326 },
    { name: "Kota Bharu", lat: 6.1254, lng: 102.2381 },
    { name: "Kuching", lat: 1.5535, lng: 110.3593 },
    { name: "Kota Kinabalu", lat: 5.9804, lng: 116.0735 },
  ],
  ID: [
    { name: "Jakarta", lat: -6.2088, lng: 106.8456 },
    { name: "Bandung", lat: -6.9175, lng: 107.6191 },
    { name: "Semarang", lat: -6.9932, lng: 110.4203 },
    { name: "Yogyakarta", lat: -7.7956, lng: 110.3695 },
    { name: "Surabaya", lat: -7.2575, lng: 112.7521 },
    { name: "Denpasar", lat: -8.6705, lng: 115.2126 },
    { name: "Medan", lat: 3.5952, lng: 98.6722 },
    { name: "Banda Aceh", lat: 5.5483, lng: 95.3238 },
    { name: "Pontianak", lat: -0.0263, lng: 109.3425 },
    { name: "Makassar", lat: -5.1477, lng: 119.4327 },
  ],
  SA: [
    { name: "Makkah", lat: 21.3891, lng: 39.8579 },
    { name: "Madinah", lat: 24.5247, lng: 39.5692 },
    { name: "Jeddah", lat: 21.4858, lng: 39.1925 },
    { name: "Riyadh", lat: 24.7136, lng: 46.6753 },
    { name: "Taif", lat: 21.2854, lng: 40.4183 },
    { name: "Dammam", lat: 26.4207, lng: 50.0888 },
  ],
  BN: [
    { name: "Bandar Seri Begawan", lat: 4.9031, lng: 114.9398 },
    { name: "Kuala Belait", lat: 4.5824, lng: 114.1919 },
  ],
  AU: [
    { name: "Sydney", lat: -33.8688, lng: 151.2093 },
    { name: "Melbourne", lat: -37.8136, lng: 144.9631 },
    { name: "Brisbane", lat: -27.4698, lng: 153.0251 },
    { name: "Perth", lat: -31.9523, lng: 115.8613 },
  ],
  AE: [
    { name: "Dubai", lat: 25.2048, lng: 55.2708 },
    { name: "Abu Dhabi", lat: 24.4539, lng: 54.3773 },
  ],
  EG: [
    { name: "Cairo", lat: 30.0444, lng: 31.2357 },
    { name: "Alexandria", lat: 31.2001, lng: 29.9187 },
  ],
  IN: [
    { name: "New Delhi", lat: 28.6139, lng: 77.209 },
    { name: "Mumbai", lat: 19.076, lng: 72.8777 },
    { name: "Hyderabad", lat: 17.385, lng: 78.4867 },
    { name: "Chennai", lat: 13.0827, lng: 80.2707 },
  ],
  PK: [
    { name: "Karachi", lat: 24.8607, lng: 67.0011 },
    { name: "Lahore", lat: 31.5204, lng: 74.3587 },
    { name: "Islamabad", lat: 33.6844, lng: 73.0479 },
  ],
  BD: [
    { name: "Dhaka", lat: 23.8103, lng: 90.4125 },
    { name: "Chattogram", lat: 22.3569, lng: 91.7832 },
  ],
  TH: [
    { name: "Bangkok", lat: 13.7563, lng: 100.5018 },
    { name: "Hat Yai", lat: 7.0086, lng: 100.4747 },
  ],
  PH: [
    { name: "Manila", lat: 14.5995, lng: 120.9842 },
    { name: "Cotabato City", lat: 7.2047, lng: 124.2456 },
  ],
  TR: [
    { name: "Istanbul", lat: 41.0082, lng: 28.9784 },
    { name: "Ankara", lat: 39.9334, lng: 32.8597 },
  ],
  GB: [
    { name: "London", lat: 51.5074, lng: -0.1278 },
    { name: "Birmingham", lat: 52.4862, lng: -1.8904 },
    { name: "Manchester", lat: 53.4808, lng: -2.2426 },
  ],
  US: [
    { name: "New York", lat: 40.7128, lng: -74.006 },
    { name: "Chicago", lat: 41.8781, lng: -87.6298 },
    { name: "Houston", lat: 29.7604, lng: -95.3698 },
    { name: "Los Angeles", lat: 34.0522, lng: -118.2437 },
  ],
};

/**
 * The selectable places in a country: its own city list, or the single
 * reference point from lib/countries.js when we have no list for it.
 */
export function citiesFor(country) {
  if (!country) return [];
  const list = CITIES[country.code];
  if (list?.length) return list;
  return [{ name: country.city, lat: country.lat, lng: country.lng }];
}
