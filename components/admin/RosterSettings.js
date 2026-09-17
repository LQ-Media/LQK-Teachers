"use client";

import { useEffect, useState, useTransition } from "react";
import Icon from "@/components/Icon";
import GeofencePanel from "@/components/admin/GeofencePanel";
import { syncHolidays, publicHolidays } from "@/lib/actions/shifts";

// Shift Roster → SETTINGS. The two things that govern the roster without being
// part of any one shift: the public-holiday list and the clock-in location
// check.
//
// Both moved here on 17 Sep. "Sync holidays" used to be a button in the roster
// toolbar beside Add shift, which put a once-a-year action next to one used
// twenty times a week; the fence used to be a fourth tab under Access, which
// filed a rostering setting under permissions. Sling keeps both under Settings
// and it is right.
//
// The holiday list is shown, not just the button. A sync button with no list
// beside it gives nobody a way to tell a successful import from one that
// quietly fetched nothing.

function dayLabel(date) {
  return new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function RosterSettings() {
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const r = await publicHolidays();
      if (r?.error) setError(r.error);
      else setData(r);
    });
  }

  useEffect(() => {
    load();
    // Once, on mount. `load` is stable for this component's lifetime.
  }, []);

  function sync() {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const r = await syncHolidays();
      if (r?.error) {
        setError(r.error);
        return;
      }
      const bits = [`${r.total} holidays checked`];
      if (r.added) bits.push(`${r.added} added`);
      if (r.renamed) bits.push(`${r.renamed} renamed`);
      if (r.stamped) bits.push(`${r.stamped} existing shift(s) updated`);
      setNotice(r.added || r.renamed || r.stamped ? `${bits.join(" · ")}.` : "Already up to date.");
      load();
    });
  }

  const byYear = (data?.years || []).map((y) => ({
    year: y,
    rows: (data?.holidays || []).filter((h) => h.date.startsWith(String(y))),
  }));

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-card border-[0.5px] border-rust bg-rust/5 px-4 py-3 text-[13px] text-charcoal">
          <div className="flex-1">{error}</div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setError(null)}
            className="text-charcoal-soft hover:text-charcoal"
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-start gap-3 rounded-card border-[0.5px] border-sage bg-sage/5 px-4 py-3 text-[13px] text-charcoal">
          <div className="flex-1">{notice}</div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
            className="text-charcoal-soft hover:text-charcoal"
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      <div className="mb-5 rounded-card border-[0.5px] border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-[15px] font-semibold text-charcoal">Public holidays</h3>
            <p className="mt-1 max-w-[42rem] text-[13px] text-charcoal-soft">
              Imported from MOM&rsquo;s official dataset on data.gov.sg. A shift on one of these dates is stamped and
              pays the public-holiday rate, and the New shift form can skip them when it repeats. Run this when MOM
              publishes a new year — it is safe to run twice.
            </p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={sync}
            className="shrink-0 rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-50"
          >
            {pending ? "Syncing…" : "Sync holidays"}
          </button>
        </div>

        {!data ? (
          <p className="mt-4 text-[13px] text-charcoal-soft">Loading…</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {byYear.map(({ year, rows }) => (
              <div key={year} className="overflow-hidden rounded-control border-[0.5px] border-line">
                <div className="flex items-center justify-between border-b-[0.5px] border-line bg-paper px-3 py-2">
                  <span className="text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">{year}</span>
                  <span className="text-[12px] font-semibold text-charcoal">
                    {rows.length} {rows.length === 1 ? "holiday" : "holidays"}
                  </span>
                </div>
                {rows.length === 0 ? (
                  <p className="px-3 py-3 text-[12px] text-charcoal-soft">
                    Nothing imported for {year} yet. MOM usually publishes the next year around April.
                  </p>
                ) : (
                  rows.map((h) => (
                    <div
                      key={h.date}
                      className="flex items-baseline justify-between gap-3 border-b-[0.5px] border-line px-3 py-1.5 text-[12px] last:border-0"
                    >
                      <span className="font-semibold text-charcoal">{h.name}</span>
                      <span className="shrink-0 text-charcoal-soft">{dayLabel(h.date)}</span>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The fence. Its own panel, because it carries its own evidence table
          and its own switch, and it was built to be read top to bottom. */}
      <GeofencePanel />
    </div>
  );
}
