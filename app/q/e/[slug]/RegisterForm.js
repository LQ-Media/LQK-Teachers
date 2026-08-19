"use client";

import { useState, useTransition } from "react";
import Icon from "@/components/Icon";
import { registerFamilyAction } from "./actions";

/* The door form.

   Filled in standing up, one-handed, by someone holding a toddler, in a queue.
   Everything follows from that: 56px tap targets, one column, the fewest
   possible required fields (a family name is the ONLY one), and no field a
   parent has to think about. */

const field =
  "w-full rounded-control border border-line bg-white px-4 py-3.5 text-base text-ink outline-none focus:border-gold";
const label = "mb-1.5 block text-sm font-semibold text-ink";

export default function RegisterForm({ event }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [surname, setSurname] = useState("");
  const [nickname, setNickname] = useState("");
  const [parentName, setParentName] = useState("");
  const [phone, setPhone] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState([{ name: "", className: "" }]);

  function submit(e) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // A success REDIRECTS, so nothing comes back — only a failure returns.
      const res = await registerFamilyAction(event.slug, {
        surname,
        nickname,
        parentName,
        phone,
        adults,
        children,
      });
      if (res && !res.ok) setError(res.error);
    });
  }

  const setChild = (index, patch) => {
    setChildren((prev) => prev.map((child, i) => (i === index ? { ...child, ...patch } : child)));
  };

  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
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
          This is what shows on the big screen in the hall. Children’s names never appear there.
        </p>
      </div>

      <div>
        <p className={label}>Who’s here?</p>
        <div className="flex items-center gap-3 rounded-control border border-line bg-white px-4 py-3">
          <span className="flex-1 text-base text-ink">Grown-ups</span>
          <button
            type="button"
            onClick={() => setAdults(Math.max(1, adults - 1))}
            aria-label="One fewer grown-up"
            className="flex h-11 w-11 items-center justify-center rounded-control bg-paper-deep text-ink transition-transform duration-150 ease-out active:scale-[0.95] disabled:opacity-40"
            disabled={adults <= 1}
          >
            <Icon name="minus" size={18} />
          </button>
          <span aria-live="polite" className="w-8 text-center text-lg font-semibold tabular-nums text-ink">
            {adults}
          </span>
          <button
            type="button"
            onClick={() => setAdults(Math.min(20, adults + 1))}
            aria-label="One more grown-up"
            className="flex h-11 w-11 items-center justify-center rounded-control bg-paper-deep text-ink transition-transform duration-150 ease-out active:scale-[0.95]"
          >
            <Icon name="plus" size={18} />
          </button>
        </div>
      </div>

      <div>
        <p className={label}>Children</p>
        <div className="space-y-3">
          {children.map((child, index) => (
            /* Each child is one block, not one ROW: a name field, a class
               select and a remove button do not fit across a 375px phone, and
               forcing them to made the row overflow the viewport. Name on its
               own line, class and remove beneath it. */
            <div key={index} className="rounded-control border border-line bg-white p-3">
              <input
                value={child.name}
                onChange={(e) => setChild(index, { name: e.target.value })}
                placeholder={`Child ${index + 1}`}
                aria-label={`Child ${index + 1} name`}
                className="w-full rounded-control border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none focus:border-gold"
              />
              {event.classes?.length || children.length > 1 ? (
                <div className="mt-2 flex items-center gap-2">
                  {event.classes?.length ? (
                    <select
                      value={child.className}
                      onChange={(e) => setChild(index, { className: e.target.value })}
                      aria-label={`Child ${index + 1} class`}
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
                  {children.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setChildren((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={`Remove child ${index + 1}`}
                      className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-control border border-line text-rust transition-transform duration-150 ease-out active:scale-[0.95]"
                    >
                      <Icon name="x" size={18} />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setChildren((prev) => [...prev, { name: "", className: "" }])}
          className="mt-3 rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          Add another child
        </button>
      </div>

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
