"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateEventAction, importGuestsAction, sendInvitesAction } from "../actions";

const TABS = [
  ["details", "Details"],
  ["guests", "Guests"],
  ["send", "Send"],
  ["replies", "Replies"],
];

const field =
  "w-full rounded-control border border-line bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-gold";
const label = "mb-1.5 block text-sm font-semibold text-ink";
const card = "mt-6 rounded-card border border-line bg-white p-5 sm:p-6";
const btn =
  "rounded-pill bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-[transform,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-60";
const btnQuiet =
  "rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60";

/* Warns before a send rather than after. The two things that silently ruin a
   send are an unconfigured channel and a draft event, and both are invisible
   until the batch comes back empty. */
function Notice({ tone = "warn", children }) {
  const tones = {
    warn: "bg-sand text-sage",
    bad: "bg-rust-soft text-rust",
    good: "bg-gold-soft text-ink",
  };
  return <p className={`rounded-control px-3 py-2 text-sm ${tones[tone]}`}>{children}</p>;
}

export default function EventDetail({ event, guests, stats, baseUrl, capabilities }) {
  const router = useRouter();
  const [tab, setTab] = useState("details");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const [form, setForm] = useState({
    title: event.title || "",
    host_name: event.host_name || "",
    starts_at: (event.starts_at || "").slice(0, 16),
    venue_name: event.venue_name || "",
    venue_address: event.venue_address || "",
    dress_code: event.dress_code || "",
    rsvp_deadline: (event.rsvp_deadline || "").slice(0, 10),
    support_url: event.support_url || "",
    max_party_size: event.max_party_size || 10,
    ask_photo: !!event.ask_photo,
    ask_dietary: !!event.ask_dietary,
    status: event.status,
  });

  const [importText, setImportText] = useState("");
  const [channels, setChannels] = useState(["email"]);

  function set(key) {
    return (e) =>
      setForm((f) => ({
        ...f,
        [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
      }));
  }

  async function save() {
    setBusy(true);
    setFlash(null);
    await updateEventAction(event.id, form);
    setBusy(false);
    setFlash({ tone: "good", text: "Saved." });
    router.refresh();
  }

  async function doImport() {
    setBusy(true);
    setFlash(null);
    const res = await importGuestsAction(event.id, importText);
    setBusy(false);
    if (!res.ok) {
      setFlash({ tone: "bad", text: res.error });
      return;
    }
    setImportText("");
    setFlash({
      tone: res.problems?.length ? "warn" : "good",
      text: `Added ${res.added} guest${res.added === 1 ? "" : "s"}.`,
      list: res.problems,
    });
    router.refresh();
  }

  async function doSend(mode) {
    setBusy(true);
    setFlash(null);
    const res = await sendInvitesAction(event.id, { mode, channels });
    setBusy(false);
    if (!res.ok) {
      setFlash({ tone: "bad", text: res.error });
      return;
    }
    const failures = (res.results || [])
      .filter((r) => (r.email && r.email !== "sent") || (r.whatsapp && r.whatsapp !== "sent"))
      .map((r) => `${r.guest}: ${[r.email, r.whatsapp].filter((v) => v && v !== "sent").join(" · ")}`);
    setFlash({
      tone: failures.length ? "warn" : "good",
      text: res.note || `Sent to ${res.sent} guest${res.sent === 1 ? "" : "s"}.`,
      list: failures,
    });
    router.refresh();
  }

  const pending = guests.filter((g) => !g.attending);
  const unsent = guests.filter((g) => !g.sent_email_at && !g.sent_wa_at);

  return (
    <>
      <div className="mt-8 flex flex-wrap gap-1 border-b border-line">
        {TABS.map(([key, labelText]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === key ? "border-gold text-ink" : "border-transparent text-charcoal-soft hover:text-ink"
            }`}
          >
            {labelText}
          </button>
        ))}
      </div>

      {flash ? (
        <div className="mt-4 grid gap-2">
          <Notice tone={flash.tone}>{flash.text}</Notice>
          {flash.list?.length ? (
            <ul className="rounded-control border border-line bg-paper px-4 py-3 text-sm text-charcoal-soft">
              {flash.list.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ---- details ---- */}
      {tab === "details" ? (
        <section className={card}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label} htmlFor="f-title">Title</label>
              <input id="f-title" className={field} value={form.title} onChange={set("title")} />
            </div>
            <div>
              <label className={label} htmlFor="f-host">Hosted by</label>
              <input id="f-host" className={field} value={form.host_name} onChange={set("host_name")} />
            </div>
            <div>
              <label className={label} htmlFor="f-start">Starts</label>
              <input id="f-start" type="datetime-local" className={field} value={form.starts_at} onChange={set("starts_at")} />
            </div>
            <div>
              <label className={label} htmlFor="f-venue">Venue</label>
              <input id="f-venue" className={field} value={form.venue_name} onChange={set("venue_name")} />
            </div>
            <div>
              <label className={label} htmlFor="f-deadline">RSVP deadline</label>
              <input id="f-deadline" type="date" className={field} value={form.rsvp_deadline} onChange={set("rsvp_deadline")} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="f-address">Address</label>
              <input id="f-address" className={field} value={form.venue_address} onChange={set("venue_address")} />
            </div>
            <div>
              <label className={label} htmlFor="f-dress">Dress code</label>
              <input id="f-dress" className={field} value={form.dress_code} onChange={set("dress_code")} />
            </div>
            <div>
              <label className={label} htmlFor="f-party">Max party size</label>
              <input id="f-party" type="number" min="1" max="20" className={field} value={form.max_party_size} onChange={set("max_party_size")} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="f-support">Support link (Shopify)</label>
              <input id="f-support" className={field} value={form.support_url} onChange={set("support_url")} />
            </div>
            <div>
              <label className={label} htmlFor="f-status">Status</label>
              <select id="f-status" className={field} value={form.status} onChange={set("status")}>
                <option value="draft">Draft — links show &ldquo;not valid&rdquo;</option>
                <option value="live">Live — guests can reply</option>
                <option value="closed">Closed — no more replies</option>
              </select>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.ask_photo} onChange={set("ask_photo")} className="size-4 accent-gold" />
              Ask guests for a family photo
              {!capabilities.drive ? (
                <span className="text-xs text-rust">(Drive not configured — uploads will fail)</span>
              ) : null}
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.ask_dietary} onChange={set("ask_dietary")} className="size-4 accent-gold" />
              Ask for dietary requirements
            </label>
          </div>

          <button type="button" onClick={save} disabled={busy} className={`${btn} mt-5`}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </section>
      ) : null}

      {/* ---- guests ---- */}
      {tab === "guests" ? (
        <>
          <section className={card}>
            <h2 className="font-heading text-lg text-ink">Import guests</h2>
            <p className="mb-3 mt-0.5 text-sm text-charcoal-soft">
              Paste rows from Sheets or a CSV. Columns, in order:{" "}
              <code className="rounded bg-paper-deep px-1 text-xs">
                name, email, phone, family name, language (en/ms/ar), party size
              </code>
              . Only the name is required.
            </p>
            <textarea
              className={`${field} min-h-32 font-mono text-sm`}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"Ahmad Family,ahmad@example.com,+6591234567,Ahmad,ms,4\nSiti Rahman,siti@example.com,,Rahman,en,2"}
            />
            <button type="button" onClick={doImport} disabled={busy || !importText.trim()} className={`${btn} mt-4`}>
              {busy ? "Importing…" : "Import guests"}
            </button>
          </section>

          <section className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-heading text-lg text-ink">{guests.length} guests</h2>
              <a href={`/api/events/${event.id}/csv`} className="text-sm text-gold hover:underline">
                Download catering CSV
              </a>
            </div>
            {guests.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-charcoal-soft">
                      <th className="pb-2 pe-3 font-semibold">Guest</th>
                      <th className="pb-2 pe-3 font-semibold">Contact</th>
                      <th className="pb-2 pe-3 font-semibold">Sent</th>
                      <th className="pb-2 font-semibold">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guests.map((g) => (
                      <tr key={g.id} className="border-b border-line/60">
                        <td className="py-2.5 pe-3">
                          <span className="text-ink">{g.name}</span>
                          <span className="ms-2 text-xs uppercase text-charcoal-soft">{g.lang}</span>
                        </td>
                        <td className="py-2.5 pe-3 text-charcoal-soft">
                          {g.email || <span className="text-rust">no email</span>}
                          {g.phone ? <div className="text-xs">{g.phone}</div> : null}
                        </td>
                        <td className="py-2.5 pe-3 text-charcoal-soft">
                          {g.sent_email_at || g.sent_wa_at ? "✓" : "—"}
                          {g.opened_at ? <div className="text-xs">opened</div> : null}
                        </td>
                        <td className="py-2.5">
                          <CopyLink url={`${baseUrl}/i/${g.token}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-charcoal-soft">No guests imported yet.</p>
            )}
          </section>
        </>
      ) : null}

      {/* ---- send ---- */}
      {tab === "send" ? (
        <section className={card}>
          <h2 className="font-heading text-lg text-ink">Send invitations</h2>

          <div className="mt-4 grid gap-2">
            {event.status === "draft" ? (
              <Notice tone="bad">
                This event is a draft — guest links show &ldquo;not valid&rdquo;. Set it to Live on the
                Details tab before sending.
              </Notice>
            ) : null}
            {!capabilities.mail ? <Notice tone="bad">RESEND_API_KEY is not set — email can&rsquo;t send.</Notice> : null}
            {!capabilities.whatsapp ? (
              <Notice>
                Wati isn&rsquo;t configured yet. Set WATI_API_URL, WATI_ACCESS_TOKEN and
                WATI_TEMPLATE_NAME to enable WhatsApp.
              </Notice>
            ) : null}
            {capabilities.mail ? (
              <Notice>
                Resend&rsquo;s free tier allows 100 emails a day across all LQK apps. This event has{" "}
                {unsent.length} guest{unsent.length === 1 ? "" : "s"} not yet sent.
              </Notice>
            ) : null}
          </div>

          <fieldset className="mt-5">
            <legend className={label}>Channels</legend>
            <div className="flex flex-wrap gap-4">
              {[
                ["email", "Email", capabilities.mail],
                ["whatsapp", "WhatsApp", capabilities.whatsapp],
              ].map(([key, text, enabled]) => (
                <label key={key} className={`flex items-center gap-2 text-sm ${enabled ? "text-ink" : "text-charcoal-soft"}`}>
                  <input
                    type="checkbox"
                    className="size-4 accent-gold"
                    disabled={!enabled}
                    checked={channels.includes(key)}
                    onChange={(e) =>
                      setChannels((c) => (e.target.checked ? [...c, key] : c.filter((v) => v !== key)))
                    }
                  />
                  {text}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => doSend("invite")}
              disabled={busy || !channels.length || event.status === "draft"}
              className={btn}
            >
              {busy ? "Sending…" : `Send to ${unsent.length} new guest${unsent.length === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={() => doSend("remind")}
              disabled={busy || !channels.length || event.status === "draft"}
              className={btnQuiet}
            >
              Remind non-responders
            </button>
          </div>
          <p className="mt-3 text-xs text-charcoal-soft">
            Reminders only go to guests who were sent an invite, haven&rsquo;t replied, and
            haven&rsquo;t been nudged in the last 72 hours. {pending.length} guest
            {pending.length === 1 ? " has" : "s have"} not replied.
          </p>
        </section>
      ) : null}

      {/* ---- replies ---- */}
      {tab === "replies" ? (
        <section className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-lg text-ink">
              {stats.yes} yes · {stats.maybe} maybe · {stats.no} no
            </h2>
            <a href={`/api/events/${event.id}/csv`} className="text-sm text-gold hover:underline">
              Download catering CSV
            </a>
          </div>

          {stats.replied === 0 ? (
            <p className="mt-3 text-sm text-charcoal-soft">No replies yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-charcoal-soft">
                    <th className="pb-2 pe-3 font-semibold">Guest</th>
                    <th className="pb-2 pe-3 font-semibold">Reply</th>
                    <th className="pb-2 pe-3 font-semibold">Party</th>
                    <th className="pb-2 pe-3 font-semibold">Dietary</th>
                    <th className="pb-2 font-semibold">Photo</th>
                  </tr>
                </thead>
                <tbody>
                  {guests
                    .filter((g) => g.attending)
                    .map((g) => (
                      <tr key={g.id} className="border-b border-line/60">
                        <td className="py-2.5 pe-3 text-ink">{g.name}</td>
                        <td className="py-2.5 pe-3">
                          <span
                            className={
                              g.attending === "yes"
                                ? "text-ink"
                                : g.attending === "no"
                                  ? "text-charcoal-soft"
                                  : "text-sage"
                            }
                          >
                            {g.attending}
                          </span>
                        </td>
                        <td className="py-2.5 pe-3 tabular-nums text-charcoal-soft">
                          {g.attending === "yes" ? g.adults + g.children : "—"}
                        </td>
                        <td className="py-2.5 pe-3 text-charcoal-soft">{g.dietary || "—"}</td>
                        <td className="py-2.5 text-charcoal-soft">{g.photo_drive_id ? "✓" : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}

function CopyLink({ url }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard blocked (insecure context) — the link is still visible on hover */
        }
      }}
      title={url}
      className="rounded-pill border border-line px-3 py-1 text-xs text-charcoal-soft transition-transform duration-150 ease-out active:scale-[0.95] hover:border-gold hover:text-ink"
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
