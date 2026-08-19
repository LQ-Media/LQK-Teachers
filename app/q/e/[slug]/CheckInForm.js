"use client";

import { useEffect, useState, useTransition } from "react";
import Icon from "@/components/Icon";
import { guessSurname } from "@/lib/qr/tokens";
import { checkInAction, searchExpectedAction } from "./actions";

/* The door form.

   Filled in standing up, one-handed, by someone holding a toddler, in a queue.
   Everything follows from that: big tap targets, one column, and the fewest
   questions that still produce a register.

   Two steps when there is a list — find the name, then say who else is here —
   because both at once makes a tall form that reads as work. */

const field =
  "w-full rounded-control border border-line bg-white px-4 py-3.5 text-base text-ink outline-none focus:border-gold";
const label = "mb-1.5 block text-sm font-semibold text-ink";

function NamePicker({ slug, onPick, onSkip, picked }) {
  const [query, setQuery] = useState("");
  /* The last RESOLVED search, carrying the term it answered. Keeping the term
     alongside the matches means a stale reply — hall wifi reorders them, so a
     slow answer for "ah" can land after the fast one for "ahmad" — simply
     doesn't match the current term and is ignored. No request counter needed,
     and nothing is set synchronously inside the effect. */
  const [resolved, setResolved] = useState({ term: "", matches: [] });
  const term = query.trim();

  useEffect(() => {
    const wanted = query.trim();
    if (wanted.length < 2) return undefined;
    let cancelled = false;
    // Debounced: a name is typed a letter at a time and every keystroke would
    // otherwise be a round trip on hall wifi.
    const timer = setTimeout(async () => {
      const found = await searchExpectedAction(slug, wanted);
      if (!cancelled) setResolved({ term: wanted, matches: found });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, slug]);

  const searching = term.length >= 2 && resolved.term !== term;
  const matches = (resolved.term === term ? resolved.matches : []).filter(
    (m) => !picked.some((p) => p.expectedId === m.id),
  );

  return (
    <div className="mt-8">
      <label className={label} htmlFor="guest-search">
        {picked.length ? "Anyone else on the list?" : "Find your child’s name"}
      </label>
      <input
        id="guest-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Start typing…"
        autoComplete="off"
        autoFocus
        className={field}
      />
      <p className="mt-1.5 text-xs text-charcoal-soft">Type the first two letters of the name.</p>

      <div aria-live="polite" className="mt-4">
        {term.length > 0 && term.length < 2 ? null : searching ? (
          <p className="text-sm text-charcoal-soft">Looking…</p>
        ) : term.length >= 2 && matches.length === 0 ? (
          <p className="rounded-control bg-sand px-4 py-3 text-sm text-gold-hover">
            No match for “{term}”. Check the spelling, or carry on and add them by hand.
          </p>
        ) : (
          <ul className="space-y-2">
            {matches.map((match) => (
              <li key={match.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(match);
                    setQuery("");
                    setResolved({ term: "", matches: [] });
                  }}
                  className="flex w-full items-center gap-3 rounded-control border border-line bg-white px-4 py-4 text-left transition-transform duration-150 ease-out active:scale-[0.98]"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control bg-gold-soft text-ink">
                    <Icon name="user" size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-ink">{match.name}</span>
                    {match.class_name ? (
                      <span className="block truncate text-xs text-charcoal-soft">{match.class_name}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Never a dead end. A name spelled differently on the list, a sibling who
          isn't enrolled, a family who signed up late — all of them are standing
          at the door and all of them need checking in. */}
      <button
        type="button"
        onClick={onSkip}
        className="mt-6 w-full rounded-pill border border-line px-5 py-3.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.98]"
      >
        {picked.length ? "That’s everyone from the list" : "Not on the list — add by hand"}
      </button>
    </div>
  );
}

export default function CheckInForm({ event, hasList }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [step, setStep] = useState(hasList ? "find" : "details");

  const [familyName, setFamilyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState({});
  const [people, setPeople] = useState([]);

  function pick(match) {
    setPeople((prev) => [
      ...prev,
      { expectedId: match.id, name: match.name, className: match.class_name || "", kind: "child" },
    ]);
    setFamilyName((prev) => prev || guessSurname(match.name));
  }

  const setPerson = (index, patch) =>
    setPeople((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  function goToDetails() {
    // Always leave with at least one row on screen: an empty list reads as a
    // broken form rather than as an invitation to type.
    setPeople((prev) => (prev.length ? prev : [{ expectedId: null, name: "", className: "", kind: "child" }]));
    setStep("details");
  }

  function submit(e) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // A success REDIRECTS, so nothing comes back — only a failure returns.
      const res = await checkInAction(event.slug, {
        familyName,
        contactName,
        phone,
        email,
        answers,
        people,
      });
      if (res && !res.ok) {
        setError(res.error);
        if (/pick the name again/i.test(res.error)) setStep("find");
      }
    });
  }

  if (step === "find") {
    return <NamePicker slug={event.slug} picked={people} onPick={pick} onSkip={goToDetails} />;
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <div>
        <p className={label}>Who’s here?</p>
        <div className="space-y-3">
          {people.map((person, index) => (
            /* Each person is one block, not one ROW: a name, a class, a type
               and a remove button do not fit across a 375px phone, and forcing
               them to made the row overflow the viewport. */
            <div key={index} className="rounded-control border border-line bg-white p-3">
              <div className="flex items-center gap-2">
                <input
                  value={person.name}
                  onChange={(e) => setPerson(index, { name: e.target.value })}
                  placeholder={`Person ${index + 1}`}
                  aria-label={`Person ${index + 1} name`}
                  className="min-w-0 flex-1 rounded-control border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none focus:border-gold"
                />
                {person.expectedId ? (
                  <span
                    title="On the list"
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-control bg-gold-soft text-ink"
                  >
                    <Icon name="check" size={16} />
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div
                  role="group"
                  aria-label={`Person ${index + 1} is an adult or a child`}
                  className="flex flex-shrink-0 rounded-control border border-line p-0.5"
                >
                  {["child", "adult"].map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setPerson(index, { kind })}
                      aria-pressed={person.kind === kind}
                      className={`rounded-[9px] px-3 py-2 text-sm font-semibold capitalize transition-colors duration-150 ${
                        person.kind === kind ? "bg-ink text-white" : "text-charcoal-soft"
                      }`}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
                <input
                  value={person.className}
                  onChange={(e) => setPerson(index, { className: e.target.value })}
                  placeholder="Class"
                  aria-label={`Person ${index + 1} class`}
                  className="min-w-0 flex-1 rounded-control border border-line bg-paper px-3 py-3 text-base text-ink outline-none focus:border-gold"
                />
                {people.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setPeople((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={`Remove person ${index + 1}`}
                    className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-control border border-line text-rust transition-transform duration-150 ease-out active:scale-[0.95]"
                  >
                    <Icon name="x" size={18} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setPeople((prev) => [...prev, { expectedId: null, name: "", className: "", kind: "child" }])
            }
            className="rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Add someone else
          </button>
          {hasList ? (
            <button
              type="button"
              onClick={() => setStep("find")}
              className="rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              Search the list
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <label className={label} htmlFor="familyName">
          Family name
        </label>
        <input
          id="familyName"
          required
          autoComplete="family-name"
          value={familyName}
          onChange={(e) => setFamilyName(e.target.value)}
          placeholder="Rahman"
          className={field}
        />
      </div>

      <div>
        <label className={label} htmlFor="contactName">
          Your name <span className="font-normal text-charcoal-soft">— optional</span>
        </label>
        <input
          id="contactName"
          autoComplete="name"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          className={field}
        />
      </div>

      <div>
        <label className={label} htmlFor="phone">
          Mobile <span className="font-normal text-charcoal-soft">— optional</span>
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="9123 4567"
          className={field}
        />
      </div>

      <div>
        <label className={label} htmlFor="email">
          Email <span className="font-normal text-charcoal-soft">— optional</span>
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={field}
        />
      </div>

      {event.fields.map((f) => (
        <div key={f.id}>
          <label className={label} htmlFor={`f-${f.id}`}>
            {f.label}
            {f.required ? null : <span className="font-normal text-charcoal-soft"> — optional</span>}
          </label>
          {f.type === "note" ? (
            <textarea
              id={`f-${f.id}`}
              rows={3}
              value={answers[f.id] || ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [f.id]: e.target.value }))}
              className={field}
            />
          ) : f.type === "choice" ? (
            <select
              id={`f-${f.id}`}
              value={answers[f.id] || ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [f.id]: e.target.value }))}
              className={field}
            >
              <option value="">Choose…</option>
              {f.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : f.type === "yesno" ? (
            <div role="group" aria-labelledby={`f-${f.id}`} className="flex gap-2">
              {["yes", "no"].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAnswers((prev) => ({ ...prev, [f.id]: value }))}
                  aria-pressed={answers[f.id] === value}
                  className={`flex-1 rounded-control border px-4 py-3 text-base font-semibold capitalize transition-colors duration-150 ${
                    answers[f.id] === value
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-white text-charcoal-soft"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          ) : (
            <input
              id={`f-${f.id}`}
              type={f.type === "tel" ? "tel" : f.type === "email" ? "email" : "text"}
              value={answers[f.id] || ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [f.id]: e.target.value }))}
              className={field}
            />
          )}
        </div>
      ))}

      {error ? (
        <p role="alert" className="rounded-control bg-rust-soft px-4 py-3 text-sm text-rust">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !familyName.trim() || !people.some((p) => p.name.trim())}
        className="w-full rounded-pill bg-ink px-6 py-4 text-base font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? "Checking you in…" : "Check us in"}
      </button>
    </form>
  );
}
