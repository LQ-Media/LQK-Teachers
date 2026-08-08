"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import { newEvent, deleteEvent, deleteContactList } from "@/lib/actions/events";
import ContactListImport from "./ContactListImport";
import { formatWhen } from "@/lib/events/format";

/**
 * Event invites — the index. Two things live here: the invites themselves, and
 * the reusable parent contact lists they draw from.
 */
export default function EventsApp({ events, lists, channels }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);

  async function onCreate(e) {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    setBusy(true);
    setError("");
    const event = await newEvent(clean);
    setBusy(false);
    if (event?.id) router.push(`/events/${event.id}`);
    else setError("Could not create that event.");
  }

  async function onDelete(id, name) {
    if (!window.confirm(`Delete "${name}"? Any RSVPs already collected go with it.`)) return;
    await deleteEvent(id);
    router.refresh();
  }

  async function onDeleteList(id, name, count) {
    if (!window.confirm(`Delete the list "${name}" (${count} parents)? Invites already sent are unaffected.`)) return;
    await deleteContactList(id);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-7 lg:px-8">
      <PageHeading
        icon="calendar"
        route="/events"
        tone="peach"
        title="Event invites"
        subtitle="Design an invitation, then send it to parents by email and WhatsApp."
      />

      <ChannelBanner channels={channels} />

      {/* ── Invites ─────────────────────────────────────────────────── */}
      <section className="mt-7">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold text-charcoal">Invitations</h2>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-pill bg-ink px-4 py-2 text-[13px] font-bold text-white transition hover:bg-ink-deep"
          >
            <Icon name="plus" size={15} />
            New invite
          </button>
        </div>

        {creating ? (
          <form onSubmit={onCreate} className="mt-3 rounded-card border border-line bg-white p-4">
            <label htmlFor="event-title" className="text-[12px] font-bold text-charcoal-soft">
              What&apos;s the event called?
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input
                id="event-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Graduation Day 2026"
                autoFocus
                className="min-w-0 flex-1 rounded-control border border-line bg-paper px-3 py-2.5 text-[14px] outline-none focus:border-gold"
              />
              <button
                type="submit"
                disabled={busy || !title.trim()}
                className="rounded-control bg-ink px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
            {error ? <p className="mt-2 text-[12px] text-rust">{error}</p> : null}
          </form>
        ) : null}

        {events.length === 0 ? (
          <p className="mt-4 rounded-card border border-dashed border-line bg-white/60 p-8 text-center text-[14px] text-charcoal-soft">
            No invitations yet. Create one and you&apos;ll be able to upload a logo, a background and your event details.
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {events.map((event) => (
              <li key={event.id} className="rounded-card border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/events/${event.id}`} className="font-heading text-[16px] font-semibold text-charcoal hover:text-gold">
                      {event.title}
                    </Link>
                    <p className="mt-0.5 text-[13px] text-charcoal-soft">
                      {formatWhen(event.startsAt, event.endsAt, event.language) || "No date set yet"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${
                          event.status === "sent" ? "bg-[#DCD3F0] text-[#4A3D63]" : "bg-paper-deep text-charcoal-soft"
                        }`}
                      >
                        {event.status === "sent" ? "Sent" : "Draft"}
                      </span>
                      {event.recipientCount > 0 ? (
                        <span className="text-[12px] text-charcoal-soft">
                          {event.recipientCount} parent{event.recipientCount === 1 ? "" : "s"}
                          {event.status === "sent" ? ` · ${event.yesCount} attending · ${event.noCount} can't` : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-2">
                    {event.status === "sent" ? (
                      <a
                        href={`/invite/${event.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-control border border-line px-3 py-1.5 text-[12px] font-bold text-charcoal-soft hover:bg-paper-deep"
                      >
                        View page
                      </a>
                    ) : null}
                    <Link
                      href={`/events/${event.id}`}
                      className="rounded-control bg-paper-deep px-3 py-1.5 text-[12px] font-bold text-charcoal hover:bg-line"
                    >
                      {event.status === "sent" ? "Responses" : "Edit"}
                    </Link>
                    <button
                      type="button"
                      onClick={() => onDelete(event.id, event.title)}
                      aria-label={`Delete ${event.title}`}
                      className="rounded-control p-1.5 text-charcoal-soft hover:bg-rust-soft hover:text-rust"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Parent lists ────────────────────────────────────────────── */}
      <section className="mt-9">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold text-charcoal">Parent lists</h2>
            <p className="mt-0.5 text-[13px] text-charcoal-soft">
              Upload a CSV once and reuse it for every event.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setImporting((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-white px-4 py-2 text-[13px] font-bold text-charcoal hover:bg-paper-deep"
          >
            <Icon name="plus" size={15} />
            Import CSV
          </button>
        </div>

        {importing ? (
          <ContactListImport
            onDone={() => {
              setImporting(false);
              router.refresh();
            }}
            onCancel={() => setImporting(false)}
          />
        ) : null}

        {lists.length === 0 ? (
          <p className="mt-4 rounded-card border border-dashed border-line bg-white/60 p-6 text-center text-[13px] text-charcoal-soft">
            No parent lists yet. Import a CSV with your parents&apos; names, emails and WhatsApp numbers.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {lists.map((list) => (
              <li key={list.id} className="flex items-center justify-between gap-3 rounded-card border border-line bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold text-charcoal">{list.name}</p>
                  <p className="text-[12px] text-charcoal-soft">
                    {list.count} parent{list.count === 1 ? "" : "s"}
                    {list.sourceName ? ` · from ${list.sourceName}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteList(list.id, list.name, list.count)}
                  aria-label={`Delete ${list.name}`}
                  className="flex-shrink-0 rounded-control p-1.5 text-charcoal-soft hover:bg-rust-soft hover:text-rust"
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// Says plainly which channels can actually send right now. Discovering that
// SMTP was never configured *after* pressing send is the worst time to find out.
function ChannelBanner({ channels }) {
  const missing = [];
  if (!channels.email) missing.push("Email (SMTP)");
  if (!channels.whatsapp) missing.push("WhatsApp (WATI)");
  if (!missing.length) return null;

  return (
    <div className="mt-5 rounded-card border border-[#F0D9A8] bg-[#FDF3E0] p-4">
      <p className="text-[13px] font-bold text-[#7A5A25]">
        {missing.join(" and ")} {missing.length > 1 ? "are" : "is"} not configured yet
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-[#7A5A25]">
        You can still design invites and preview them — sending on {missing.length > 1 ? "those channels" : "that channel"} will
        fail until the environment variables are set. See <code className="font-mono">docs/EVENTS.md</code> for what to add.
      </p>
    </div>
  );
}
