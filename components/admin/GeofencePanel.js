"use client";

import { useEffect, useState, useTransition } from "react";
import Icon from "@/components/Icon";
import { geofenceStatus, resolveLocationCoords, setFenceEnabled } from "@/lib/actions/geofence";
import { metresLabel, reasonLabel } from "@/lib/hours/fence-report";

// Admin → Access → Clock-in location.
//
// Karim, 17 Sep: the coordinate sync needed a terminal on the production box,
// and he has not got one. So it is a button.
//
// The screen is built around the ONE decision it exists for — should the fence
// be on? — and it deliberately refuses to make that look easy. With the fence
// on, a teacher more than a kilometre from their centre cannot clock in, and no
// clock-in means no pay, so the switch sits UNDER the evidence rather than at
// the top where it would get pressed first.
//
// Reading order, top to bottom:
//   1. What the fence is doing right now.
//   2. Whether every centre has a coordinate, and the button that fixes it.
//   3. What real taps have actually recorded — the thing worth reading.
//   4. The switch.
//   5. Who threw it last.

const STATE_TONE = {
  blocked: { border: "border-rust", bg: "bg-rust/5", icon: "x", tint: "text-rust" },
  review: { border: "border-gold", bg: "bg-gold-soft/40", icon: "map-pin", tint: "text-gold" },
  no_data: { border: "border-line", bg: "bg-paper", icon: "map-pin", tint: "text-charcoal-soft" },
  ready: { border: "border-sage", bg: "bg-sage/5", icon: "check", tint: "text-sage" },
};

function when(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function day(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function GeofencePanel() {
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  // Re-read the status. Deliberately does NOT clear `error`: every action
  // below finishes by calling load(), so clearing here wiped the message the
  // action had just set — the OneMap-unreachable banner appeared and vanished
  // in the same tick. Errors are cleared when the next action STARTS instead,
  // and by the banner's own dismiss.
  function load() {
    startTransition(async () => {
      const r = await geofenceStatus();
      if (r?.error) setError(r.error);
      else setData(r);
    });
  }

  // In an effect, not during render: this is a fetch, and a fetch started while
  // rendering is a side effect React will either warn about or loop on.
  useEffect(() => {
    load();
    // Once, on mount. `load` is stable for this component's lifetime.
  }, []);

  function resolve(force) {
    setNotice(null);
    setError(null);
    setReport(null);
    startTransition(async () => {
      const r = await resolveLocationCoords(force);
      if (r?.error) {
        setError(r.error);
        return;
      }
      setReport(r.report);

      // Every centre failing with a reachability error is one problem, not six.
      // Listing it six times as if each postal code were wrong is how somebody
      // starts editing addresses that were fine.
      const failures = r.report.filter((x) => x.status === "failed");
      if (failures.length && failures.every((x) => x.unreachable)) {
        setError(
          "Couldn’t reach OneMap from the server, so nothing was looked up. The postal codes are fine — " +
            "this is the network. Try again in a minute."
        );
        load();
        return;
      }

      // Otherwise said as a count rather than a tick, because "3 resolved,
      // 1 failed" is the outcome that matters and a tick would hide the 1.
      const bits = [];
      if (r.resolved) bits.push(`${r.resolved} resolved`);
      if (r.already) bits.push(`${r.already} already had coordinates`);
      if (r.failed) bits.push(`${r.failed} failed — see below`);
      setNotice(bits.length ? `${bits.join(", ")}.` : "Nothing to do.");
      load();
    });
  }

  function toggle(on) {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const r = await setFenceEnabled(on);
      if (r?.error) {
        setError(r.error);
        return;
      }
      setConfirming(false);
      setNotice(
        r.enabled
          ? "The location check is ON. A clock-in more than 1 km from its centre will now be refused."
          : "The location check is OFF. Distances are still recorded; nothing is refused."
      );
      load();
    });
  }

  if (!data && !error) {
    return <p className="px-1 py-8 text-center text-[13px] text-charcoal-soft">Loading…</p>;
  }

  const s = data?.summary;
  const readiness = data?.readiness;
  const tone = STATE_TONE[readiness?.state] || STATE_TONE.no_data;

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

      {/* 1. What it is doing right now. */}
      <div className="mb-5 rounded-card border-[0.5px] border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-heading text-[15px] font-semibold text-charcoal">Clock-in location check</h3>
            <p className="mt-1 max-w-[46rem] text-[13px] text-charcoal-soft">
              When this is on, a teacher has to be within{" "}
              <strong className="font-semibold text-charcoal">
                {data?.radiusM ? `${data.radiusM / 1000} km` : "1 km"}
              </strong>{" "}
              of the centre their shift is at to clock in — the same setting Sling uses. It is measured against the{" "}
              <em>shift&rsquo;s</em> centre, not the teacher&rsquo;s home centre, because teachers are rostered across
              centres.
            </p>
          </div>
          <span
            className={`shrink-0 rounded-pill px-3 py-1.5 text-[12px] font-bold ${
              data?.enabled ? "bg-sage text-white" : "bg-paper-deep text-charcoal-soft"
            }`}
          >
            {data?.enabled ? "ON" : "OFF"}
          </span>
        </div>

        {!data?.enabled && (
          <p className="mt-3 rounded-control border-[0.5px] border-line bg-paper px-3 py-2 text-[12px] text-charcoal-soft">
            While it is off, every clock-in still works out how far away the teacher was and records it. Nothing is
            refused. That is what fills the table below, and it is why the switch is at the bottom of this screen
            rather than the top.
          </p>
        )}
      </div>

      {/* 2. The centres and the button. */}
      <div className="mb-5 rounded-card border-[0.5px] border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="font-heading text-[14px] font-semibold text-charcoal">Centre coordinates</h4>
            <p className="mt-1 max-w-[42rem] text-[12px] text-charcoal-soft">
              Each centre&rsquo;s postal code is looked up once against{" "}
              <strong className="font-semibold text-charcoal">OneMap</strong>, the Singapore Land Authority&rsquo;s own
              service, and the answer is stored. Nothing is looked up when a teacher taps clock in.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => resolve(false)}
              className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-50"
            >
              {pending ? "Looking up…" : "Resolve coordinates"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => resolve(true)}
              title="Look every centre up again — for when a centre has moved"
              className="rounded-control border-[0.5px] border-line px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:border-ink disabled:opacity-50"
            >
              Re-do all
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-[13px]">
            <thead>
              <tr className="border-b-[0.5px] border-line text-left text-[11px] uppercase tracking-wide text-charcoal-soft">
                <th className="py-2 pr-3 font-semibold">Centre</th>
                <th className="py-2 pr-3 font-semibold">Postal code</th>
                <th className="py-2 pr-3 font-semibold">Coordinates</th>
                <th className="py-2 font-semibold">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {(data?.centres || []).map((c) => (
                <tr key={c.key} className="border-b-[0.5px] border-line last:border-0 align-top">
                  <td className="py-2.5 pr-3">
                    <div className="font-semibold text-charcoal">{c.label}</div>
                    {c.address && <div className="text-[11px] text-charcoal-soft">{c.address}</div>}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums text-charcoal-soft">{c.postalCode || "—"}</td>
                  <td className="py-2.5 pr-3">
                    {c.lat != null ? (
                      <span className="tabular-nums text-charcoal">
                        {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                      </span>
                    ) : (
                      <span className="font-semibold text-rust">Not resolved</span>
                    )}
                  </td>
                  <td className="py-2.5 text-[12px] text-charcoal-soft">
                    {c.lat != null ? (
                      <>
                        {day(c.resolvedAt)}
                        {c.source ? ` · ${c.source}` : ""}
                      </>
                    ) : (
                      <span className="text-rust">Clock-ins here would be refused</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {report && (
          <ul className="mt-3 space-y-1 rounded-control border-[0.5px] border-line bg-paper px-3 py-2 text-[12px]">
            {report.map((r) => (
              <li key={r.key} className="text-charcoal-soft">
                <strong
                  className={`font-semibold ${
                    r.status === "failed" ? "text-rust" : r.status === "resolved" ? "text-sage" : "text-charcoal"
                  }`}
                >
                  {r.status === "failed" ? "Failed" : r.status === "resolved" ? "Resolved" : "Already had one"}
                </strong>{" "}
                — {r.label}
                {r.status === "resolved" ? ` → ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}` : ""}
                {/* The REASON, not a generic failure. "Couldn't reach OneMap"
                    means try again; "no exact match" means go and check the
                    address. Telling somebody the second when it was the first
                    sends them off to change a postal code that was right. */}
                {r.status === "failed" ? ` (${r.postalCode}) — ${r.reason || "no result"}` : ""}
              </li>
            ))}
          </ul>
        )}

        {(data?.unfenced || []).length > 0 && (
          <p className="mt-3 text-[12px] text-charcoal-soft">
            Never checked, on purpose:{" "}
            <strong className="font-semibold text-charcoal">
              {data.unfenced.map((u) => u.label).join(", ")}
            </strong>
            , and HQ. A clock-in is still required at all of them — there is just nowhere to check it against.
          </p>
        )}
      </div>

      {/* 3. The evidence. */}
      <div className="mb-5 rounded-card border-[0.5px] border-line bg-white p-5">
        <h4 className="font-heading text-[14px] font-semibold text-charcoal">What real clock-ins have recorded</h4>
        <p className="mt-1 max-w-[42rem] text-[12px] text-charcoal-soft">
          Every clock-in works out its distance and stores the verdict, whether or not the check is on. This is what
          would have happened if it had been.
          {s?.window?.from ? ` Covering ${day(s.window.from)} to ${day(s.window.to)}.` : ""}
        </p>

        <div className={`mt-4 flex items-start gap-3 rounded-control border-[0.5px] px-3 py-2.5 ${tone.border} ${tone.bg}`}>
          <span className={`mt-0.5 shrink-0 ${tone.tint}`}>
            <Icon name={tone.icon} size={16} />
          </span>
          <p className="text-[13px] text-charcoal">{readiness?.message}</p>
        </div>

        {s?.fenced > 0 && (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(s.byReason).map(([reason, n]) => (
                <span
                  key={reason}
                  className="rounded-control border-[0.5px] border-line bg-paper px-2.5 py-1.5 text-[12px] text-charcoal"
                >
                  <strong className="font-semibold">{n}</strong> · {reasonLabel(reason)}
                </span>
              ))}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[38rem] text-[13px]">
                <thead>
                  <tr className="border-b-[0.5px] border-line text-left text-[11px] uppercase tracking-wide text-charcoal-soft">
                    <th className="py-2 pr-3 font-semibold">Where the shift was</th>
                    <th className="py-2 pr-3 font-semibold">Clock-ins</th>
                    <th className="py-2 pr-3 font-semibold">Would be refused</th>
                    <th className="py-2 pr-3 font-semibold">No location</th>
                    <th className="py-2 font-semibold">Furthest accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {s.perCentre.map((c) => (
                    <tr key={c.branch} className="border-b-[0.5px] border-line last:border-0">
                      <td className="py-2.5 pr-3 font-semibold text-charcoal">{c.branch}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-charcoal-soft">{c.taps}</td>
                      <td className="py-2.5 pr-3 tabular-nums">
                        {c.blocked ? (
                          <span className="font-semibold text-rust">
                            {c.blocked}
                            {c.worstM != null ? ` (up to ${metresLabel(c.worstM)})` : ""}
                          </span>
                        ) : (
                          <span className="text-charcoal-soft">0</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-charcoal-soft">{c.noFix}</td>
                      <td className="py-2.5 tabular-nums text-charcoal-soft">{metresLabel(c.maxInsideM)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {s.blocking.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[12px] font-semibold text-charcoal">
                  The {s.blocking.length} that would have been turned away
                </p>
                <div className="overflow-hidden rounded-control border-[0.5px] border-line">
                  {s.blocking.slice(0, 25).map((b, i) => (
                    <div
                      key={`${b.at}-${i}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b-[0.5px] border-line px-3 py-2 text-[12px] last:border-0"
                    >
                      <span className="font-semibold text-charcoal">{b.teacher}</span>
                      <span className="text-charcoal-soft">
                        {b.branch || "No location"} · {reasonLabel(b.reason)}
                        {b.metres != null ? ` · ${metresLabel(b.metres)} away` : ""}
                      </span>
                      <span className="text-charcoal-soft">{when(b.at)}</span>
                    </div>
                  ))}
                </div>
                {s.blocking.length > 25 && (
                  <p className="mt-1 text-[11px] text-charcoal-soft">
                    Showing the 25 furthest of {s.blocking.length}.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 4. The switch. */}
      <div className="mb-5 rounded-card border-[0.5px] border-line bg-white p-5">
        <h4 className="font-heading text-[14px] font-semibold text-charcoal">
          {data?.enabled ? "Turn the check off" : "Turn the check on"}
        </h4>

        {data?.enabled ? (
          <>
            <p className="mt-1 max-w-[42rem] text-[13px] text-charcoal-soft">
              Turning it off takes effect immediately and never needs a reason. If somebody is standing at the centre
              unable to start their shift, this is the button.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => toggle(false)}
              className="mt-3 rounded-control border-[0.5px] border-rust px-4 py-2 text-[13px] font-semibold text-rust hover:bg-rust/5 disabled:opacity-50"
            >
              Turn the location check off
            </button>
          </>
        ) : !readiness?.canEnable ? (
          <p className="mt-1 max-w-[42rem] text-[13px] text-charcoal-soft">
            Not yet — resolve the coordinates above first. {readiness?.message}
          </p>
        ) : !confirming ? (
          <>
            <p className="mt-1 max-w-[42rem] text-[13px] text-charcoal-soft">
              Read the table above first. Once this is on, a clock-in that fails the check is refused, and a teacher who
              cannot clock in is a teacher who is not paid for that shift.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(true)}
              className="mt-3 rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-50"
            >
              Turn the location check on…
            </button>
          </>
        ) : (
          <div className="mt-3 rounded-control border-[0.5px] border-gold bg-gold-soft/40 px-3 py-3">
            <p className="text-[13px] text-charcoal">
              {readiness.state === "review"
                ? `${s.blocked} recorded clock-in${s.blocked === 1 ? "" : "s"} would have been refused. Turn it on anyway?`
                : readiness.state === "no_data"
                  ? "Nothing has been recorded at a centre yet, so this has not been checked against a real tap. Turn it on anyway?"
                  : "Nothing recorded would have been refused. Turn it on?"}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(true)}
                className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-50"
              >
                {pending ? "Turning on…" : "Yes, turn it on"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-control border-[0.5px] border-line px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:border-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. Who threw it last. */}
      {(data?.log || []).length > 0 && (
        <div className="rounded-card border-[0.5px] border-line bg-white p-5">
          <h4 className="font-heading text-[14px] font-semibold text-charcoal">Switch history</h4>
          <div className="mt-3 overflow-hidden rounded-control border-[0.5px] border-line">
            {data.log.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b-[0.5px] border-line px-3 py-2 text-[12px] last:border-0"
              >
                <span className="text-charcoal">
                  <strong className={`font-semibold ${e.enabled ? "text-sage" : "text-charcoal-soft"}`}>
                    Turned {e.enabled ? "ON" : "OFF"}
                  </strong>{" "}
                  by {e.by}
                </span>
                <span className="text-charcoal-soft">{when(e.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
