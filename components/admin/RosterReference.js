"use client";

import Icon from "@/components/Icon";
import { useMemo, useState } from "react";
import { LOCATIONS, SHIFT_LOCATIONS, GEOFENCE_RADIUS_M, locationForBranch, unfencedBranch } from "@/lib/hours/locations";

// Two of the reference tiles on Shift Roster: EMPLOYEES and LOCATIONS.
//
// POSITIONS used to live here too and was read-only. It is now editable and has
// its own screen — see components/admin/PositionsPanel.js. The argument for
// keeping it in code was that it decided pay, and that was overstated: pay
// comes from the tier on the person, so a position only decides teaching-vs-OT.
//
// BOTH OF THESE ARE STILL READ-ONLY, deliberately:
//
//   Employees  — the list of accounts lives on the Admin tab, where creating
//                and editing one belongs. Two places to edit a person is two
//                answers to what their position is.
//   Locations  — the list is code (lib/hours/locations.js): a centre's postal
//                code is what the geofence is built from. Adding one here
//                without resolving its coordinates would create a centre where
//                nobody can clock in.
//
// Each screen says where the editable version is, so a read-only table never
// reads as a broken one.

function Note({ children }) {
  return (
    <p className="mb-4 flex items-start gap-2.5 rounded-control border-[0.5px] border-line bg-paper px-3 py-2.5 text-[12px] text-charcoal-soft">
      <span className="mt-0.5 shrink-0 text-charcoal-soft">
        <Icon name="alert-triangle" size={14} />
      </span>
      <span>{children}</span>
    </p>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-card border-[0.5px] border-line bg-white p-5">
      <h3 className="mb-3 font-heading text-[15px] font-semibold text-charcoal">{title}</h3>
      {children}
    </div>
  );
}

const TH = "py-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft";
const TD = "py-2.5 pr-3 align-top text-[13px]";

// ---- Employees ---------------------------------------------------------

/**
 * Who can be rostered, with the two things you need while rostering: their job
 * title and their home centre.
 *
 * Searchable by both, because the roster question is rarely "where is Nurul
 * Hidayah" and often "who are the lead teachers at Tampines" — and with 71
 * accounts sharing first names, a plain alphabetical list does not answer it.
 */
export function EmployeesReference({ teachers, locations }) {
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return teachers.filter((t) => {
      if (branch && (t.primaryLocation || "") !== branch) return false;
      if (!words.length) return true;
      const hay = `${t.fullName || ""} ${t.position || ""} ${t.primaryLocation || ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [teachers, q, branch]);

  return (
    <>
      <Note>
        Read-only. Accounts are created and edited on the <strong className="font-semibold text-charcoal">Admin</strong>{" "}
        tab, under Login accounts — this is the same people, shown the way the roster needs them.
      </Note>

      <Card title={`Employees (${rows.length}${rows.length === teachers.length ? "" : ` of ${teachers.length}`})`}>
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a name, position or centre…"
            className="min-w-[16rem] flex-1 rounded-control border-[0.5px] border-line bg-paper px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink"
          />
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="rounded-control border-[0.5px] border-line bg-paper px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink"
          >
            <option value="">All centres</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-charcoal-soft">Nobody matches that.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem]">
              <thead>
                <tr className="border-b-[0.5px] border-line">
                  <th className={TH}>Name</th>
                  <th className={TH}>Position</th>
                  <th className={TH}>Home centre</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b-[0.5px] border-line last:border-0">
                    <td className={`${TD} font-semibold text-charcoal`}>{t.fullName}</td>
                    <td className={`${TD} text-charcoal-soft`}>{t.position || "—"}</td>
                    <td className={`${TD} text-charcoal-soft`}>{t.primaryLocation || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ---- Locations --------------------------------------------------------

/**
 * Where a shift can be, and whether clocking in there is checked against a
 * place.
 *
 * Reads the pure modules only — no coordinates, no database. That is why a
 * centre IT Head can open it: the actual coordinates and the fence switch are
 * full-admin-only and live under Settings.
 *
 * The distinction this table exists to make plain is UNFENCED BY DECLARATION
 * versus unresolved. HQ, Outside LQK and Online wave a teacher through on
 * purpose. A centre whose coordinates have not resolved does NOT — it refuses.
 */
export function LocationsReference({ fenceOn = null }) {
  return (
    <>
      <Note>
        Read-only. A centre&rsquo;s postal code is what the clock-in check is built from, so the list lives in{" "}
        <code className="text-[11px]">lib/hours/locations.js</code> — adding one here without resolving its
        coordinates would create a centre where nobody can clock in. Coordinates and the switch are under{" "}
        <strong className="font-semibold text-charcoal">Settings</strong>.
      </Note>

      <Card title={`Shift locations (${SHIFT_LOCATIONS.length})`}>
        <p className="mb-3 text-[12px] text-charcoal-soft">
          These are the choices on a shift.{" "}
          {fenceOn === null ? null : fenceOn ? (
            <>
              The clock-in location check is <strong className="font-semibold text-sage">ON</strong>: at a fenced
              centre a teacher must be within {GEOFENCE_RADIUS_M / 1000} km to clock in.
            </>
          ) : (
            <>
              The clock-in location check is <strong className="font-semibold text-charcoal">OFF</strong>: distances
              are recorded, nothing is refused.
            </>
          )}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem]">
            <thead>
              <tr className="border-b-[0.5px] border-line">
                <th className={TH}>On a shift</th>
                <th className={TH}>Clock-in checked?</th>
                <th className={TH}>Measured from</th>
              </tr>
            </thead>
            <tbody>
              {SHIFT_LOCATIONS.map((branch) => {
                const loc = locationForBranch(branch);
                const declaredUnfenced = unfencedBranch(branch);
                const centre = loc?.fenced ? loc : null;
                return (
                  <tr key={branch} className="border-b-[0.5px] border-line last:border-0">
                    <td className={`${TD} font-semibold text-charcoal`}>{branch}</td>
                    <td className={TD}>
                      {centre ? (
                        <span className="rounded-pill bg-sage/15 px-2 py-0.5 text-[11px] font-semibold text-charcoal">
                          Yes — within {GEOFENCE_RADIUS_M / 1000} km
                        </span>
                      ) : declaredUnfenced ? (
                        <span className="rounded-pill bg-paper-deep px-2 py-0.5 text-[11px] font-semibold text-charcoal-soft">
                          No — nowhere to check
                        </span>
                      ) : (
                        <span className="rounded-pill bg-rust/10 px-2 py-0.5 text-[11px] font-semibold text-rust">
                          Not set up
                        </span>
                      )}
                    </td>
                    <td className={`${TD} text-charcoal-soft`}>
                      {centre ? (
                        <>
                          <div>{centre.label}</div>
                          <div className="text-[11px]">
                            {centre.address}
                            {centre.postalCode ? ` · ${centre.postalCode}` : ""}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Sling's own eight places, kept visible because an import matches on
            these strings and somebody will one day wonder why there are three
            Woods Squares in Sling and one here. */}
        <details className="mt-4">
          <summary className="cursor-pointer text-[12px] font-semibold text-charcoal-soft hover:text-charcoal">
            Sling&rsquo;s {LOCATIONS.length} places, and how they map
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[30rem]">
              <thead>
                <tr className="border-b-[0.5px] border-line">
                  <th className={TH}>In Sling</th>
                  <th className={TH}>Here</th>
                  <th className={TH}>Postal code</th>
                </tr>
              </thead>
              <tbody>
                {LOCATIONS.map((l) => (
                  <tr key={l.key} className="border-b-[0.5px] border-line last:border-0">
                    <td className={`${TD} text-charcoal-soft`}>{l.slingName}</td>
                    <td className={`${TD} font-semibold text-charcoal`}>{l.label}</td>
                    <td className={`${TD} tabular-nums text-charcoal-soft`}>{l.postalCode || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-charcoal-soft">
              The three Woods Square rooms share one postal code, so they share one coordinate — at a{" "}
              {GEOFENCE_RADIUS_M / 1000} km radius they were never distinguishable anyway. A shift says “Woods
              Square”; Sling says which room.
            </p>
          </div>
        </details>
      </Card>
    </>
  );
}
