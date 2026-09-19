// Resolve each centre's postal code to a coordinate, for the clock-in geofence.
//
//   node scripts/sync-location-coords.mjs             # resolve what's missing
//   node scripts/sync-location-coords.mjs --force     # re-resolve everything
//   node scripts/sync-location-coords.mjs --enable    # resolve, then TURN THE FENCE ON
//   node scripts/sync-location-coords.mjs --disable   # turn the fence off
//   node scripts/sync-location-coords.mjs --status    # show what's stored
//
// Same shape as scripts/sync-public-holidays.mjs: an official source (OneMap,
// the Singapore Land Authority's own service) is consulted occasionally and the
// answer is written to the database. Nothing at clock-in time ever calls out.
//
// THIS SCRIPT IS NO LONGER THE ONLY WAY. Everything below is also on the
// screen, at Admin -> Access -> Clock-in location: resolve the coordinates,
// read the distances real taps have recorded, and throw the switch. The script
// stays because it is the right tool during a deploy and it works without a
// browser, but nothing about the fence REQUIRES a terminal any more — least of
// all turning it off in a hurry when it is wrongly refusing somebody at 7:25 in
// the morning. See lib/actions/geofence.js.
//
// Both paths write the same two things (location_coords and the
// geofence_enabled key) through the same guard, so they cannot disagree. Only
// the screen records WHO threw the switch, in geofence_log — a script run has
// no session to attribute it to.
//
// THE FENCE IS OFF UNTIL --enable IS PASSED, and --enable refuses while any
// centre is unresolved. Combined with "no clock-in means no pay", a fence
// switched on before its coordinates existed would refuse every clock-in at
// every centre on the first morning. Turning it on is a deliberate act taken
// after reading the distances below, not a side effect of deploying.

process.env.NODE_ENV ||= "production";

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const enable = args.has("--enable");
const disable = args.has("--disable");
const statusOnly = args.has("--status");

const { getDb } = await import("../lib/db.js");
const { LOCATIONS } = await import("../lib/hours/locations.js");

// The geocode module is "server-only" and imports through the "@/" alias, so
// its logic is inlined here rather than imported. Kept deliberately small and
// identical in behaviour — the postal-code confirmation and the Singapore
// bounds check are the two parts that must not drift.
const ONEMAP = "https://www.onemap.gov.sg/api/common/elastic/search";
const db = getDb();

function stored() {
  return Object.fromEntries(
    db.prepare("SELECT key, lat, lng, resolved_from, source, resolved_at FROM location_coords").all().map((r) => [r.key, r])
  );
}

async function geocode(code) {
  if (!/^\d{6}$/.test(String(code || "").trim())) return null;
  try {
    const res = await fetch(`${ONEMAP}?searchVal=${code}&returnGeom=Y&getAddrDetails=Y&pageNum=1`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : [];
    // OneMap's search is fuzzy. Confirm the postal code came back exactly,
    // otherwise a near-miss could put a fence around the wrong building.
    const hit = results.find((r) => String(r.POSTAL || "").trim() === String(code));
    if (!hit) return { error: `no exact match among ${results.length} result(s)` };
    const lat = Number(hit.LATITUDE);
    const lng = Number(hit.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "no coordinates in result" };
    if (lat < 1.15 || lat > 1.5 || lng < 103.55 || lng > 104.1) {
      return { error: `outside Singapore (${lat}, ${lng})` };
    }
    return { lat, lng, address: hit.ADDRESS || null };
  } catch (err) {
    return { error: err?.name === "TimeoutError" ? "timed out" : err?.message || String(err) };
  }
}

function showStatus() {
  const have = stored();
  console.log("Centre                 Coordinates                 Resolved");
  console.log("─".repeat(74));
  for (const loc of LOCATIONS) {
    if (!loc.fenced) continue;
    const c = have[loc.key];
    console.log(
      `${loc.label.padEnd(22)} ` +
        (c
          ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`.padEnd(27) + `${c.resolved_at?.slice(0, 10)} (${c.source})`
          : "— not resolved —".padEnd(27) + "clock-ins here would be REFUSED")
    );
  }
  const row = db.prepare("SELECT value FROM kv WHERE key = 'geofence_enabled'").get();
  const on = row?.value === "1";
  console.log("─".repeat(74));
  console.log(`Geofence: ${on ? "ON — clock-ins are checked" : "OFF — verdicts recorded, nothing refused"}`);
}

if (statusOnly) {
  showStatus();
  process.exit(0);
}

if (disable) {
  db.prepare(
    "INSERT INTO kv (key, value) VALUES ('geofence_enabled', '0') ON CONFLICT(key) DO UPDATE SET value = '0'"
  ).run();
  console.log("Geofence OFF. Verdicts are still recorded; nothing is refused.");
  process.exit(0);
}

const have = stored();
let failed = 0;

for (const loc of LOCATIONS) {
  if (!loc.fenced) continue;
  if (have[loc.key] && !force) {
    console.log(`SKIP      ${loc.label} — already resolved (--force to redo)`);
    continue;
  }
  const hit = await geocode(loc.postalCode);
  if (!hit || hit.error) {
    failed++;
    console.log(`FAILED    ${loc.label} (${loc.postalCode}) — ${hit?.error || "no result"}`);
    continue;
  }
  db.prepare(
    `INSERT INTO location_coords (key, lat, lng, resolved_from, source, resolved_at)
     VALUES (?, ?, ?, ?, 'onemap', ?)
     ON CONFLICT(key) DO UPDATE SET lat = excluded.lat, lng = excluded.lng,
       resolved_from = excluded.resolved_from, source = excluded.source, resolved_at = excluded.resolved_at`
  ).run(loc.key, hit.lat, hit.lng, loc.postalCode, new Date().toISOString());
  console.log(`RESOLVED  ${loc.label} -> ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}  ${hit.address || ""}`);
}

console.log("");
showStatus();

if (enable) {
  const missing = LOCATIONS.filter((l) => l.fenced && !stored()[l.key]);
  if (missing.length) {
    console.log("");
    console.log(`NOT ENABLED — ${missing.length} centre(s) still unresolved: ${missing.map((m) => m.label).join(", ")}`);
    console.log("Switching the fence on now would refuse every clock-in at those centres.");
    process.exit(1);
  }
  db.prepare(
    "INSERT INTO kv (key, value) VALUES ('geofence_enabled', '1') ON CONFLICT(key) DO UPDATE SET value = '1'"
  ).run();
  console.log("");
  console.log("Geofence ON. Clock-ins more than 1 km from their centre will now be refused.");
}

process.exit(failed ? 1 : 0);
