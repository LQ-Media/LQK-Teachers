"use client";

import { useState, useTransition } from "react";
import { submitRsvp } from "@/lib/actions/events";
import { t } from "@/lib/events/design";

/**
 * The two buttons a parent actually presses.
 *
 * No token means the invite was opened from a forwarded link rather than from
 * that parent's own email — we show the invite but not the RSVP, because there
 * is no row to record an answer against and a fake "thanks!" would be a lie.
 */
export default function RsvpPanel({ token, language, design, initialRsvp }) {
  const s = t(language);
  const [rsvp, setRsvp] = useState(initialRsvp || null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!token) return null;

  function answer(value) {
    setError("");
    startTransition(async () => {
      const result = await submitRsvp(token, value);
      if (result?.error) setError(result.error);
      else setRsvp(result.rsvp);
    });
  }

  const base = "rounded-full px-6 py-3 text-[15px] font-bold transition disabled:opacity-60";

  return (
    <div className="border-t px-8 py-7 text-center" style={{ borderColor: `${design.mutedColor}22` }}>
      <p className="text-[15px] font-bold" style={{ fontFamily: "inherit" }}>
        {s.willYouCome}
      </p>

      {rsvp ? (
        <div className="mt-4">
          <p className="text-[15px]" style={{ color: design.accentColor }}>
            {rsvp === "yes" ? s.thanksYes : s.thanksNo}
          </p>
          <p className="mt-1 text-[12px]" style={{ color: design.mutedColor }}>
            {s.responded}
          </p>
          <button
            type="button"
            onClick={() => answer(rsvp === "yes" ? "no" : "yes")}
            disabled={pending}
            className="mt-3 text-[13px] underline disabled:opacity-60"
            style={{ color: design.mutedColor }}
          >
            {s.change} {rsvp === "yes" ? s.no : s.yes}
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => answer("yes")}
            disabled={pending}
            className={base}
            style={{ background: design.accentColor, color: design.buttonTextColor }}
          >
            {s.yes}
          </button>
          <button
            type="button"
            onClick={() => answer("no")}
            disabled={pending}
            className={base}
            style={{ background: "transparent", color: design.mutedColor, boxShadow: `inset 0 0 0 1.5px ${design.mutedColor}55` }}
          >
            {s.no}
          </button>
        </div>
      )}

      {error ? (
        <p className="mt-3 text-[13px]" style={{ color: "#C05E72" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
