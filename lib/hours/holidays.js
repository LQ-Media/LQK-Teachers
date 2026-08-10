// Singapore public holidays.
//
// Imported from MOM's official dataset on data.gov.sg and stored in the
// `public_holidays` table, rather than fetched when needed: payroll must not
// depend on a third party being reachable, and a holiday that silently failed
// to load would quietly underpay someone. scripts/sync-public-holidays.mjs
// refreshes it — re-runnable, dry-run by default.
//
// Pure helpers here; the fetch is at the bottom and is only ever called from
// the sync script.

/** MOM's consolidated public-holiday dataset (2020 onwards). */
export const DATASET_CONSOLIDATED = "d_8ef23381f9417e4d4254ee8b4dcdb176";

const API = "https://data.gov.sg/api/action/datastore_search";

/** Normalise one dataset record to {date, name}, or null if unusable. */
export function toHoliday(record) {
  const date = String(record?.date || "").trim();
  const name = String(record?.holiday || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) return null;
  // The dataset uses a typographic apostrophe in "New Year's Day"; normalise so
  // a name compares equal however it was entered elsewhere.
  return { date, name: name.replace(/’/g, "'") };
}

/** Map of YYYY-MM-DD → holiday name, from rows shaped like the DB table. */
export function holidayMap(rows) {
  return new Map((rows || []).map((r) => [r.date, r.name]));
}

/**
 * Fetch holidays from data.gov.sg. Returns an array of {date, name}, sorted.
 * Throws on failure — unlike the geocoder, a silent miss here would be a
 * payroll error, so the caller (a human running a script) should see it.
 */
export async function fetchHolidays(resourceId = DATASET_CONSOLIDATED, limit = 500) {
  const url = `${API}?resource_id=${encodeURIComponent(resourceId)}&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`data.gov.sg returned ${res.status}`);
  const body = await res.json();
  if (!body?.success) throw new Error("data.gov.sg reported failure");
  const rows = (body.result?.records || []).map(toHoliday).filter(Boolean);
  if (!rows.length) throw new Error("no holiday records returned");
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
