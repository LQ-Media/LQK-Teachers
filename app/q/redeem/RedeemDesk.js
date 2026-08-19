"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { lookupFamilyAction, claimTierAction } from "./actions";

/* The prize counter.

   Deliberately look-up-then-confirm rather than scan-and-give: a prize is
   handed over by a person, and that person needs a second to read the name and
   the tier before anything is marked as given. */

const field =
  "w-full rounded-control border border-line bg-white px-4 py-3.5 text-base text-ink outline-none focus:border-gold";
const btn =
  "rounded-pill bg-ink px-6 py-3.5 text-base font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-50";

export default function RedeemDesk({ eventTitle }) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [family, setFamily] = useState(null);
  const [error, setError] = useState(null);
  const [given, setGiven] = useState(null);

  const lookup = (value) =>
    startTransition(async () => {
      setError(null);
      setGiven(null);
      const res = await lookupFamilyAction(value);
      if (res.ok) setFamily(res);
      else {
        setFamily(null);
        setError(res.error);
      }
    });

  const claim = (tierIndex) =>
    startTransition(async () => {
      setError(null);
      const res = await claimTierAction(family.familyToken, tierIndex);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setGiven({ label: res.label, already: res.already });
      setFamily((prev) => ({ ...prev, tiers: res.tiers }));
    });

  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-5 py-8">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal">Prize counter</h1>
          <p className="text-xs text-charcoal-soft">{eventTitle}</p>
        </div>
        <Link href="/q/booth" className="text-sm text-gold hover:underline">
          Scanner
        </Link>
      </header>

      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(code);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="PASS CODE"
          aria-label="Pass code"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className={`${field} text-center font-heading tracking-[0.25em]`}
        />
        <button type="submit" disabled={pending || !code.trim()} className={btn}>
          Find
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-4 rounded-control bg-rust-soft px-4 py-3 text-sm text-rust">
          {error}
        </p>
      ) : null}

      {given ? (
        <div className="mt-4 rounded-card bg-sand p-5 text-center">
          <p className="font-heading text-xl font-semibold text-ink">
            {given.already ? "Already given" : "Give them:"}
          </p>
          <p className="mt-1 text-lg font-semibold text-ink">{given.label}</p>
          {given.already ? (
            <p className="mt-1 text-sm text-charcoal-soft">
              This one has been handed over already.
            </p>
          ) : null}
        </div>
      ) : null}

      {family ? (
        <section className="mt-6 rounded-card border border-line bg-white p-5">
          <p className="font-heading text-xl font-semibold text-charcoal">{family.name}</p>
          <p className="mt-0.5 text-sm text-charcoal-soft">
            {family.collected} of {family.total} letters
          </p>

          <ul className="mt-4 space-y-2.5">
            {family.tiers.map((tier) => (
              <li
                key={tier.index}
                className="flex items-center gap-3 border-b border-line pb-2.5 last:border-b-0 last:pb-0"
              >
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
                      ? "Given"
                      : tier.earned
                        ? "Ready"
                        : `Needs ${tier.at} booths — ${tier.remaining} to go`}
                  </span>
                </span>
                {/* Shown only when earned and unclaimed. The server re-checks
                    both anyway; this just keeps a tired volunteer from being
                    offered a button they must not press. */}
                {tier.earned && !tier.given ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => claim(tier.index)}
                    className="flex-shrink-0 rounded-pill bg-ink px-4 py-2 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-50"
                  >
                    Give
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => {
              setFamily(null);
              setGiven(null);
              setCode("");
            }}
            className="mt-5 w-full rounded-pill border border-line px-5 py-3 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Next family
          </button>
        </section>
      ) : null}
    </main>
  );
}
