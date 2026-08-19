"use client";

import { useEffect, useState, useTransition } from "react";
import Icon from "@/components/Icon";
import { registerFamilyAction, searchInviteesAction } from "./actions";

/* The door form.

   Filled in standing up, one-handed, by someone holding a toddler, in a queue.
   Everything follows from that: big tap targets, one column, the fewest
   possible required fields, and no question a parent has to think about.

   Two steps when there is a guest list — find your name, then say who's with
   you — because doing both at once makes a tall form that reads as work. */

const field =
  "w-full rounded-control border border-line bg-white px-4 py-3.5 text-base text-ink outline-none focus:border-gold";
const label = "mb-1.5 block text-sm font-semibold text-ink";

/* Surnames go on the leaderboard as "The X Family", so a picked name is
   reduced to its most family-ish word. Three cases, in order:

   1. "Rahman, Fatimah" — a spreadsheet's Last, First. The surname is what
      comes BEFORE the comma, and taking the last word instead produces "The
      Fatimah Family", which is a given name.
   2. "Ahmad bin Ismail" — Malay and Arabic names carry bin/binte/ibn before
      the father's name, and the meaningful word is the one AFTER it.
   3. Otherwise the last word.

   A guess, and always editable — which is why it is allowed to be a guess. */
function guessSurname(fullName) {
  const text = String(fullName || "").trim();
  if (!text) return "";

  const comma = text.indexOf(",");
  if (comma > 0) return text.slice(0, comma).trim().split(/\s+/).pop();

  const parts = text.split(/\s+/).filter(Boolean);
  const marker = parts.findIndex((p) => /^(bin|binti|binte|bt|b\.|ibn)$/i.test(p));
  if (marker !== -1 && parts[marker + 1]) return parts[marker + 1];
  return parts[parts.length - 1];
}

function NamePicker({ slug, onPick, onSkip }) {
  const [query, setQuery] = useState("");
  // The last RESOLVED search, carrying the term it answered. Keeping the term
  // alongside the matches means a stale reply — hall wifi reorders them, so a
  // slow answer for "ah" can land after the fast one for "ahmad" — simply
  // doesn't match the current term and is ignored. No request counter needed,
  // and nothing is set synchronously inside the effect.
  const [resolved, setResolved] = useState({ term: "", matches: [] });

  const term = query.trim();

  useEffect(() => {
    const wanted = query.trim();
    if (wanted.length < 2) return undefined;
    let cancelled = false;
    // Debounced: a name is typed a letter at a time and every keystroke would
    // otherwise be a round trip on hall wifi.
    const timer = setTimeout(async () => {
      const found = await searchInviteesAction(slug, wanted);
      if (!cancelled) setResolved({ term: wanted, matches: found });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, slug]);

  const searching = term.length >= 2 && resolved.term !== term;
  const matches = resolved.term === term ? resolved.matches : [];

  const tooShort = term.length > 0 && term.length < 2;

  return (
    <div className="mt-8">
      <label className={label} htmlFor="guest-search">
        Find your name
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
      <p className="mt-1.5 text-xs text-charcoal-soft">
        Type the first two letters of your name.
      </p>

      <div aria-live="polite" className="mt-4">
        {tooShort ? null : searching ? (
          <p className="text-sm text-charcoal-soft">Looking…</p>
        ) : term.length >= 2 && matches.length === 0 ? (
          <p className="rounded-control bg-sand px-4 py-3 text-sm text-gold-hover">
            No match for “{term}”. Check the spelling, or tap below to register anyway.
          </p>
        ) : (
          <ul className="space-y-2">
            {matches.map((match) => (
              <li key={match.id}>
                <button
                  type="button"
                  onClick={() => onPick(match)}
                  className="flex w-full items-center gap-3 rounded-control border border-line bg-white px-4 py-4 text-left transition-transform duration-150 ease-out active:scale-[0.98]"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control bg-gold-soft text-ink">
                    <Icon name="user" size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-ink">{match.name}</span>
                    {match.note ? (
                      <span className="block truncate text-xs text-charcoal-soft">{match.note}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Never a dead end. A name spelled differently on the list, a cousin who
          came along, a family who registered late — all of them are standing at
          the door and all of them need a pass. */}
      <button
        type="button"
        onClick={onSkip}
        className="mt-6 w-full rounded-pill border border-line px-5 py-3.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.98]"
      >
        My name isn’t on the list
      </button>
    </div>
  );
}

export default function RegisterForm({ event, hasGuestList }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [step, setStep] = useState(hasGuestList ? "find" : "details");
  const [invitee, setInvitee] = useState(null);

  const [surname, setSurname] = useState("");
  const [nickname, setNickname] = useState("");
  const [parentName, setParentName] = useState("");
  const [phone, setPhone] = useState("");
  const [members, setMembers] = useState([{ name: "", kind: "child", className: "" }]);

  function pick(match) {
    setInvitee(match);
    setParentName(match.name);
    setSurname((prev) => prev || guessSurname(match.name));
    setStep("details");
  }

  const setMember = (index, patch) =>
    setMembers((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  function submit(e) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // A success REDIRECTS, so nothing comes back — only a failure returns.
      const res = await registerFamilyAction(event.slug, {
        inviteeId: invitee?.id || null,
        surname,
        nickname,
        parentName,
        phone,
        members,
      });
      if (res && !res.ok) {
        setError(res.error);
        // The name was taken while they were filling the form — send them back
        // to pick again rather than leaving a dead Submit button.
        if (/Pick your name again/.test(res.error)) {
          setInvitee(null);
          setStep("find");
        }
      }
    });
  }

  if (step === "find") {
    return <NamePicker slug={event.slug} onPick={pick} onSkip={() => setStep("details")} />;
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      {invitee ? (
        <div className="flex items-center gap-3 rounded-control bg-gold-soft px-4 py-3">
          <Icon name="check" size={18} className="flex-shrink-0 text-ink" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{invitee.name}</span>
            <span className="block text-xs text-charcoal-soft">Found you on the list</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setInvitee(null);
              setStep("find");
            }}
            className="flex-shrink-0 text-xs font-semibold text-gold underline"
          >
            Not you?
          </button>
        </div>
      ) : hasGuestList ? (
        <div className="flex items-center gap-3 rounded-control bg-sand px-4 py-3">
          <span className="min-w-0 flex-1 text-sm text-gold-hover">
            Registering as a walk-in.
          </span>
          <button
            type="button"
            onClick={() => setStep("find")}
            className="flex-shrink-0 text-xs font-semibold text-gold-hover underline"
          >
            Search the list
          </button>
        </div>
      ) : null}

      <div>
        <label className={label} htmlFor="surname">
          Family name
        </label>
        <input
          id="surname"
          required
          autoComplete="family-name"
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
          placeholder="Rahman"
          className={field}
        />
      </div>

      {!invitee ? (
        <div>
          <label className={label} htmlFor="parentName">
            Your name <span className="font-normal text-charcoal-soft">— optional</span>
          </label>
          <input
            id="parentName"
            autoComplete="name"
            value={parentName}
            onChange={(e) => setParentName(e.target.value)}
            className={field}
          />
        </div>
      ) : null}

      <div>
        <label className={label} htmlFor="nickname">
          Team name <span className="font-normal text-charcoal-soft">— optional</span>
        </label>
        <input
          id="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={surname ? `The ${surname} Family` : "The Rahman Family"}
          className={field}
        />
        {/* Said out loud because the board is in the room: a parent choosing a
            name should know exactly where it will appear. */}
        <p className="mt-1.5 text-xs text-charcoal-soft">
          This is what shows on the big screen in the hall. Nobody else’s name appears there.
        </p>
      </div>

      <div>
        <p className={label}>Who’s with you?</p>
        <div className="space-y-3">
          {members.map((member, index) => (
            /* Each person is one block, not one ROW: a name, a type, a class
               and a remove button do not fit across a 375px phone, and forcing
               them to made the row overflow the viewport. */
            <div key={index} className="rounded-control border border-line bg-white p-3">
              <input
                value={member.name}
                onChange={(e) => setMember(index, { name: e.target.value })}
                placeholder={`Person ${index + 1}`}
                aria-label={`Person ${index + 1} name`}
                className="w-full rounded-control border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none focus:border-gold"
              />
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
                      onClick={() => setMember(index, { kind })}
                      aria-pressed={member.kind === kind}
                      className={`rounded-[9px] px-3 py-2 text-sm font-semibold capitalize transition-colors duration-150 ${
                        member.kind === kind ? "bg-ink text-white" : "text-charcoal-soft"
                      }`}
                    >
                      {kind}
                    </button>
                  ))}
                </div>
                {event.classes?.length && member.kind === "child" ? (
                  <select
                    value={member.className}
                    onChange={(e) => setMember(index, { className: e.target.value })}
                    aria-label={`Person ${index + 1} class`}
                    className="min-w-0 flex-1 rounded-control border border-line bg-paper px-3 py-3 text-base text-ink outline-none focus:border-gold"
                  >
                    <option value="">Class — optional</option>
                    {event.classes.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="flex-1" />
                )}
                {members.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setMembers((prev) => prev.filter((_, i) => i !== index))}
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
        <button
          type="button"
          onClick={() => setMembers((prev) => [...prev, { name: "", kind: "child", className: "" }])}
          className="mt-3 rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          Add someone else
        </button>
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
        <p className="mt-1.5 text-xs text-charcoal-soft">
          Only so we can send your pass again if you lose your phone.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-control bg-rust-soft px-4 py-3 text-sm text-rust">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !surname.trim()}
        className="w-full rounded-pill bg-ink px-6 py-4 text-base font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? "Making your pass…" : "Get our pass"}
      </button>
    </form>
  );
}
