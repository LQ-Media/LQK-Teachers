"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";

/* The family's pass — the screen they carry around the hall.

   Two pieces of state, held in two different places on purpose:

   • WHICH booths are collected is the server's, polled.
   • WHICH tiles have been flipped open is the PHONE'S, in localStorage.

   The reveal must feel instant and must never cost a round trip on hall wifi,
   and it is not information anyone else needs — nobody is auditing whether a
   child opened their tile. Keeping it local also means the flip survives the
   poll: a refresh in the middle of the animation doesn't re-seal it. */

const POLL_MS = 6000;

function seenKey(token) {
  return `lqk-pass-seen-${token}`;
}

/* localStorage read through useSyncExternalStore rather than an effect.

   The obvious version — read it in a useEffect and setState — renders every
   tile sealed for one frame and then flips the already-opened ones, so a
   family who reloads watches their letters re-seal and re-open. It is also
   the pattern React now warns about (a synchronous setState in an effect
   cascades a second render).

   useSyncExternalStore is built for exactly this: the server snapshot is null,
   so SSR and hydration agree on "nothing revealed yet", and the real value
   lands in the same commit rather than a frame later. */
const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  // `storage` fires when ANOTHER tab writes — two parents on one pass, or the
  // same parent with the pass open twice, stay in step.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readSeen(token) {
  try {
    return localStorage.getItem(seenKey(token));
  } catch {
    // Private mode, or storage disabled. Every tile simply starts sealed
    // again — losing the flip is survivable, crashing the pass is not.
    return null;
  }
}

function parseSeen(raw) {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    // Hand-edited or half-written storage. Start sealed rather than throw.
    return [];
  }
}

function writeSeen(token, ids) {
  try {
    localStorage.setItem(seenKey(token), JSON.stringify(ids));
  } catch {
    /* see above */
  }
  listeners.forEach((listener) => listener());
}

export default function Passport({ name, code, token, eventTitle, passport, childCount, qr }) {
  const router = useRouter();

  const raw = useSyncExternalStore(
    subscribe,
    () => readSeen(token),
    () => null, // the server has no idea what this phone has opened
  );
  const revealed = useMemo(() => new Set(parseSeen(raw)), [raw]);

  /* Merges against what is IN storage right now, not against the `revealed`
     captured by this render. A child taps three waiting tiles as fast as they
     can find them; all three land before React re-renders, and appending to a
     shared snapshot meant the last tap overwrote the other two — two letters
     silently re-sealed. localStorage is the source of truth here, so read it. */
  const reveal = useCallback(
    (id) => {
      const current = new Set(parseSeen(readSeen(token)));
      if (current.has(id)) return;
      current.add(id);
      writeSeen(token, [...current]);
    },
    [token],
  );

  /* Poll while the tab is VISIBLE, so a letter lights up while the family is
     still standing at the booth — the whole point is that they see it happen.
     Skipping hidden tabs matters: a pass left open in a background tab all day
     would otherwise hit the server 600 times an hour, times every phone in the
     hall. */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    // Refresh the moment they come back to the tab, rather than up to 6s later.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  const { stops, collected, total, complete, tiers } = passport;
  const pending = useMemo(
    () => stops.filter((s) => s.collected && !revealed.has(s.id)).length,
    [stops, revealed],
  );
  const ready = tiers.filter((t) => t.earned && !t.given);
  const nextTier = tiers.find((t) => !t.earned);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-5 py-8">
      <header className="text-center">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">{name}</h1>
        <p className="mt-0.5 text-sm text-charcoal-soft">
          {eventTitle}
          {childCount ? ` · ${childCount} child${childCount === 1 ? "" : "ren"}` : ""}
        </p>
      </header>

      <section className="mt-6 rounded-card border border-line bg-white p-6 text-center">
        <div className="mx-auto w-fit">{qr}</div>
        <p className="mt-3 font-heading text-2xl font-semibold tracking-[0.2em] text-ink">{code}</p>
        {/* The code is printed under the QR for the moment a camera won't
            focus, a lens is scratched, or the light is wrong — a volunteer
            types it instead and the queue keeps moving. */}
        <p className="mt-1 text-xs text-charcoal-soft">
          Show this at every booth. If the camera won’t read it, read the code out.
        </p>
      </section>

      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-lg font-semibold text-charcoal">Your letters</h2>
          <p aria-live="polite" className="text-sm tabular-nums text-charcoal-soft">
            {collected} of {total}
          </p>
        </div>

        {pending > 0 ? (
          <p className="mt-2 rounded-control bg-sand px-3 py-2 text-sm font-semibold text-gold-hover">
            {pending === 1 ? "A new letter is waiting — tap it to open." : `${pending} new letters are waiting — tap to open.`}
          </p>
        ) : null}

        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {stops.map((stop, index) => {
            const isOpen = revealed.has(stop.id);
            const waiting = stop.collected && !isOpen;
            const Tag = waiting ? "button" : "div";
            return (
              <li key={stop.id}>
                <Tag
                  {...(waiting
                    ? {
                        type: "button",
                        onClick: () => reveal(stop.id),
                        "aria-label": `Open your letter from ${stop.name}`,
                      }
                    : {})}
                  data-revealed={stop.collected && isOpen ? "true" : "false"}
                  className={`lqk-tile block aspect-square w-full ${waiting ? "lqk-seal-waiting" : ""} ${
                    waiting ? "cursor-pointer" : ""
                  }`}
                >
                  <span className="lqk-tile-inner block h-full w-full">
                    {/* Front: sealed, or simply not collected yet. */}
                    <span
                      className={`lqk-tile-face lqk-tile-face-front rounded-card border ${
                        stop.collected
                          ? "border-gold bg-sand text-gold-hover"
                          : "border-line border-dashed bg-white text-charcoal-soft"
                      }`}
                    >
                      {stop.collected ? (
                        <Icon name="gem" size={26} />
                      ) : (
                        <span className="font-heading text-2xl">·</span>
                      )}
                    </span>
                    {/* Back: the letter, and nothing else. The booth's name is
                        already the caption under the tile — repeating it inside
                        shrank the one thing the reveal exists to show. */}
                    <span className="lqk-tile-face lqk-tile-face-back rounded-card border border-gold bg-gold-soft text-ink">
                      <span className="font-heading text-4xl font-semibold leading-none">
                        {stop.letter}
                      </span>
                    </span>
                  </span>
                </Tag>
                <p className="mt-1.5 truncate text-center text-[11px] text-charcoal-soft">
                  {stop.name}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="sr-only">The word so far</h2>
        <div className="flex flex-wrap justify-center gap-2">
          {stops.map((stop) => {
            const shown = stop.collected && revealed.has(stop.id);
            return (
              <span
                key={stop.id}
                className={`flex h-12 w-10 items-center justify-center rounded-control font-heading text-2xl font-semibold ${
                  shown
                    ? "lqk-letter-land bg-ink text-white"
                    : "border border-dashed border-line bg-white text-line"
                }`}
              >
                {shown ? stop.letter : "?"}
              </span>
            );
          })}
        </div>
        {complete ? (
          <p className="mt-4 text-center font-heading text-lg font-semibold text-charcoal">
            You’ve collected them all! 🎉
          </p>
        ) : null}
      </section>

      {tiers.length ? (
        <section className="mt-8 rounded-card border border-line bg-white p-5">
          <h2 className="font-heading text-lg font-semibold text-charcoal">Prizes</h2>
          <ul className="mt-3 space-y-2.5">
            {tiers.map((tier) => (
              <li key={tier.index} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-control ${
                    tier.given
                      ? "bg-gold-soft text-ink"
                      : tier.earned
                        ? "bg-sand text-gold-hover"
                        : "bg-paper-deep text-charcoal-soft"
                  }`}
                >
                  <Icon name={tier.given ? "check" : tier.earned ? "gem" : "lock"} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{tier.label}</span>
                  <span className="block text-xs text-charcoal-soft">
                    {tier.given
                      ? "Collected"
                      : tier.earned
                        ? "Ready — collect it at the prize counter"
                        : `${tier.remaining} more booth${tier.remaining === 1 ? "" : "s"}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {ready.length ? (
            <p className="mt-4 rounded-control bg-sand px-3 py-2 text-sm font-semibold text-gold-hover">
              Take this pass to the prize counter.
            </p>
          ) : nextTier ? (
            <p className="mt-4 text-sm text-charcoal-soft">
              {nextTier.remaining} more booth{nextTier.remaining === 1 ? "" : "s"} to unlock{" "}
              {nextTier.label}.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
