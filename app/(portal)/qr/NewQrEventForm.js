"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createQrEventAction } from "./actions";

/* Create is deliberately three fields. Booths, the word, the PIN and the guest
   list are all edited on the event's own page, where there is room to explain
   them. Asking for fifteen fields before the thing exists is how people
   abandon the form. */
export default function NewQrEventForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", venueName: "", startsAt: "" });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await createQrEventAction(form);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/qr/${res.id}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 rounded-pill bg-ink px-5 py-3 text-sm font-semibold text-white transition-[transform,background-color] duration-150 ease-out hover:bg-ink-deep active:scale-[0.97]"
      >
        New registration
      </button>
    );
  }

  const field =
    "w-full rounded-control border border-line bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-gold";
  const label = "mb-1.5 block text-sm font-semibold text-ink";

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-card border border-line bg-white p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="title">
            What is it called?
          </label>
          <input
            id="title"
            required
            autoFocus
            value={form.title}
            onChange={set("title")}
            placeholder="Open House 2026"
            className={field}
          />
        </div>
        <div>
          <label className={label} htmlFor="venueName">
            Where
          </label>
          <input
            id="venueName"
            value={form.venueName}
            onChange={set("venueName")}
            placeholder="Woods Square"
            className={field}
          />
        </div>
        <div>
          <label className={label} htmlFor="startsAt">
            When
          </label>
          <input id="startsAt" type="date" value={form.startsAt} onChange={set("startsAt")} className={field} />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-control bg-rust-soft px-3 py-2 text-sm text-rust">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !form.title.trim()}
          className="rounded-pill bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
