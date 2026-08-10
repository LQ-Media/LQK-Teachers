"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createEventAction } from "./actions";

/* Create is deliberately four fields. Everything else — venue address, dress
   code, deadline, theme — is edited on the event's own page, where there is
   room to explain it. Asking for fifteen fields before an event exists is how
   people abandon the form. */
export default function NewEventForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", hostName: "", startsAt: "", venueName: "" });

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await createEventAction(form);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/events/${res.id}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 rounded-pill bg-ink px-5 py-3 text-sm font-semibold text-white transition-[transform,background-color] duration-150 ease-out hover:bg-ink-deep active:scale-[0.97]"
      >
        New event
      </button>
    );
  }

  const field = "w-full rounded-control border border-line bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-gold";
  const label = "mb-1.5 block text-sm font-semibold text-ink";

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-card border border-line bg-white p-5 sm:p-6">
      <h2 className="font-heading text-lg text-ink">New event</h2>
      <p className="mb-4 mt-0.5 text-sm text-charcoal-soft">
        You can fill in the rest — venue, deadline, design — on the next screen.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="title">
            Event title
          </label>
          <input
            id="title"
            className={field}
            value={form.title}
            onChange={set("title")}
            placeholder="Maulid 2026"
            required
            autoFocus
          />
        </div>
        <div>
          <label className={label} htmlFor="hostName">
            Hosted by
          </label>
          <input id="hostName" className={field} value={form.hostName} onChange={set("hostName")} placeholder="Little Quran Kids" />
        </div>
        <div>
          <label className={label} htmlFor="startsAt">
            Starts
          </label>
          {/* datetime-local has no timezone; the value is read as Singapore
              wall time throughout, which is what a local event means. */}
          <input id="startsAt" type="datetime-local" className={field} value={form.startsAt} onChange={set("startsAt")} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="venueName">
            Venue
          </label>
          <input id="venueName" className={field} value={form.venueName} onChange={set("venueName")} placeholder="Woods Square" />
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-rust">{error}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-pill bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-[transform,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create event"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-charcoal-soft transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
