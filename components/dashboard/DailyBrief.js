"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";

const SEEN_KEY = "lqk.dailybrief.seen"; // value: the SG date it was last shown

/** Today in Singapore, as YYYY-MM-DD — the school's day, not the device's. */
function sgToday() {
  const now = new Date();
  const sg = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  return `${sg.getFullYear()}-${String(sg.getMonth() + 1).padStart(2, "0")}-${String(sg.getDate()).padStart(2, "0")}`;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * The once-a-day welcome: your points, your star level, where you sit in your
 * branch and where your branch sits against the others.
 *
 * "Once a day" is decided on the device (localStorage keyed by the Singapore
 * date), which is why nothing is computed until we know the modal is due — the
 * scores are only fetched after that check passes. See app/api/daily-brief.
 *
 * It is dismissable and never blocks: a teacher opening the dashboard to log a
 * lesson between classes taps once and carries on.
 */
export default function DailyBrief() {
  const [data, setData] = useState(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const today = sgToday();
    try {
      if (localStorage.getItem(SEEN_KEY) === today) return;
    } catch {
      return; // storage blocked — never risk showing this on every load
    }

    (async () => {
      try {
        const res = await fetch("/api/daily-brief");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.show) return;
        // Marked as seen on ARRIVAL, not on dismissal: a teacher who navigates
        // away without tapping should not be shown it again at the next tap.
        try {
          localStorage.setItem(SEEN_KEY, today);
        } catch {}
        setData(json);
      } catch {
        // offline or the route errored — the dashboard is unaffected
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => setData(null), 160);
  }, []);

  useEffect(() => {
    if (!data) return;
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, close]);

  if (!data) return null;

  const b = data.branch;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center ${
        closing ? "opacity-0 transition-opacity duration-150" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Your daily summary"
    >
      <div className="absolute inset-0 bg-charcoal/40" onClick={close} />

      <div className="lqk-rise relative w-full max-w-[420px] overflow-hidden rounded-card bg-white shadow-[0_18px_48px_rgba(59,55,43,0.24)]">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-charcoal-soft transition-colors hover:bg-black/5"
        >
          <Icon name="x" size={16} />
        </button>

        {/* Header — the star level, which is the one number that only moves up */}
        <div className="bg-gradient-to-br from-gold-soft to-sand px-6 pb-5 pt-6 text-center">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#6E5320]">
            Assalamualaikum, {data.firstName}
          </p>
          <div className="mt-2 flex items-center justify-center gap-1.5">
            {Array.from({ length: 5 }, (_, i) => (
              <span
                key={i}
                className={i < Math.ceil(data.level.level / 2) ? "text-gold" : "text-[#6E5320]/20"}
              >
                <Icon name="star" size={18} />
              </span>
            ))}
          </div>
          <p className="mt-1.5 font-heading text-[15px] font-bold text-charcoal">
            Level {data.level.level}
            {data.level.nextAt ? (
              <span className="font-normal text-[#6E5320]">
                {" "}
                · {data.level.toNext.toLocaleString("en-SG")} to level {data.level.level + 1}
              </span>
            ) : (
              <span className="font-normal text-[#6E5320]"> · top level</span>
            )}
          </p>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="This month" value={data.points.monthLabel} note="points" />
            <Stat label="All time" value={data.points.allTimeLabel} note="points" />
          </div>

          {data.streak > 0 && (
            <p className="mt-3 rounded-control bg-paper px-3.5 py-2 text-center text-[13px] text-charcoal">
              🔥 {data.streak}-day reading streak — keep it going.
            </p>
          )}

          {b ? (
            <div className="mt-4 rounded-control border-[0.5px] border-line bg-paper px-4 py-3.5">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-charcoal-soft">
                {b.name}
              </p>
              {b.myPosition ? (
                <p className="mt-1 text-[13.5px] text-charcoal">
                  You&rsquo;re <strong className="font-semibold">{ordinal(b.myPosition)}</strong> of{" "}
                  {b.myOf} scoring teachers at your branch this month.
                </p>
              ) : (
                <p className="mt-1 text-[13.5px] text-charcoal">
                  No points logged at your branch yet this month — first one on the board.
                </p>
              )}
              {b.position ? (
                <p className="mt-1.5 text-[13px] text-charcoal-soft">
                  {b.name} is <strong className="font-semibold text-charcoal">{ordinal(b.position)}</strong>{" "}
                  of {b.of} branches, on {b.points.toLocaleString("en-SG")} points
                  {b.position > 1 && b.leader ? ` · ${b.leader} leads` : ""}.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-center text-[12.5px] text-charcoal-soft">
              No branch on your profile yet, so there&rsquo;s no branch standing to show.
            </p>
          )}

          <div className="mt-5 flex gap-2.5">
            <Link
              href="/achievements"
              onClick={close}
              className="flex-1 rounded-control border border-line bg-white py-2.5 text-center text-[13.5px] font-semibold text-charcoal transition-colors hover:bg-paper"
            >
              See details
            </Link>
            <button
              type="button"
              onClick={close}
              className="flex-1 rounded-control bg-ink py-2.5 text-[13.5px] font-semibold text-paper transition-colors hover:bg-ink-deep"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="rounded-control bg-paper px-3.5 py-3 text-center">
      <div className="font-heading text-[22px] font-bold leading-none text-charcoal">{value}</div>
      <div className="mt-1 text-[11px] text-charcoal-soft">
        {note} · {label}
      </div>
    </div>
  );
}
