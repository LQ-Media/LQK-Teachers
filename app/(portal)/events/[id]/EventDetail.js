"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { declineReasonLabel } from "@/lib/events/i18n";
import { answerText, parseAnswers, MAX_BODY_TEXT } from "@/lib/events/fields";
import { DRESS_CODE_GROUPS, PARTY_SIZE_GROUPS, clampPartySize } from "@/lib/events/presets";
import Combobox from "@/components/events/Combobox";
import FieldBuilder from "@/components/events/FieldBuilder";
import { updateEventAction, importGuestsAction, sendInvitesAction } from "../actions";

const TABS = [
  ["details", "Details"],
  ["questions", "Questions"],
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
const btnHoney =
  "rounded-pill bg-sand px-5 py-2.5 text-sm font-semibold text-gold-hover transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60";

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

/* The reply column is a tinted pill, never raw lowercase DB text. "Hamper
   unpaid" only exists as a state when the event carries a contribution. */
function ReplyPill({ guest, hasContribution }) {
  if (guest.attending === "yes") {
    if (hasContribution && guest.contribution_status !== "paid") {
      return (
        <span className="rounded-pill bg-sand px-2.5 py-0.5 text-xs font-semibold text-gold-hover">
          Hamper unpaid
        </span>
      );
    }
    return (
      <span className="rounded-pill bg-gold-soft px-2.5 py-0.5 text-xs font-semibold text-[#4E6B3F]">
        Coming
      </span>
    );
  }
  return (
    <span className="rounded-pill bg-rust-soft px-2.5 py-0.5 text-xs font-semibold text-rust">
      Can&rsquo;t come
    </span>
  );
}

export default function EventDetail({
  event,
  guests,
  stats,
  reminderCount,
  baseUrl,
  initialTab,
  capabilities,
}) {
  const router = useRouter();
  const validTab = TABS.some(([key]) => key === initialTab) ? initialTab : "details";
  const [tab, setTabState] = useState(validTab);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  /* Tabs are deep-linkable: ?tab=replies survives a refresh and can be pasted
     into WhatsApp. replaceState rather than router.replace — switching tabs is
     UI state, and a server round-trip per click would refetch the whole page. */
  function setTab(key) {
    setTabState(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(null, "", url);
  }

  const [form, setForm] = useState({
    title: event.title || "",
    host_name: event.host_name || "",
    body_text: event.body_text || "",
    starts_at: (event.starts_at || "").slice(0, 16),
    venue_name: event.venue_name || "",
    venue_address: event.venue_address || "",
    venue_map_url: event.venue_map_url || "",
    dress_code: event.dress_code || "",
    rsvp_deadline: (event.rsvp_deadline || "").slice(0, 10),
    registration_url: event.registration_url || "",
    support_url: event.support_url || "",
    ask_contribution: !!event.ask_contribution,
    max_party_size: String(event.max_party_size || 10),
    ask_photo: !!event.ask_photo,
    status: event.status,
  });

  const [customFields, setCustomFields] = useState(event.customFields || []);
  const [importText, setImportText] = useState("");
  const [channels, setChannels] = useState(["email"]);

  function set(key) {
    return (e) =>
      setForm((f) => ({
        ...f,
        [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
      }));
  }

  function setValue(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setFlash(null);
    let res;
    try {
      res = await updateEventAction(event.id, {
        ...form,
        max_party_size: clampPartySize(form.max_party_size, event.max_party_size || 10),
        customFields,
      });
    } catch {
      res = null;
    }
    setBusy(false);
    // "Saved." only when it actually saved — a green toast over a failed write
    // is how an event quietly keeps its old deadline.
    if (!res?.ok) {
      setFlash({ tone: "bad", text: res?.error || "That didn't save — please try again." });
      return;
    }
    setFlash({ tone: "good", text: "Saved." });
    router.refresh();
  }

  async function doImport() {
    setBusy(true);
    setFlash(null);
    let res;
    try {
      res = await importGuestsAction(event.id, importText);
    } catch {
      res = null;
    }
    setBusy(false);
    if (!res?.ok) {
      setFlash({ tone: "bad", text: res?.error || "The import failed — please try again." });
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
    let res;
    try {
      res = await sendInvitesAction(event.id, { mode, channels });
    } catch {
      res = null;
    }
    setBusy(false);
    if (!res?.ok) {
      setFlash({ tone: "bad", text: res?.error || "The send failed — please try again." });
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

  const unsent = guests.filter((g) => !g.sent_email_at && !g.sent_wa_at);
  const replied = guests.filter((g) => g.attending === "yes" || g.attending === "no");
  const hasContribution = !!event.ask_contribution;
  // Read from the SAVED event, not the unsaved builder state — the Replies tab
  // must describe the questions guests actually answered.
  const savedFields = event.customFields || [];
  const savedPerPerson = savedFields.filter((f) => f.scope === "attendee");

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
              tab === key ? "border-gold text-gold" : "border-transparent text-charcoal-soft hover:text-ink"
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
            <div className="sm:col-span-2">
              <label className={label} htmlFor="f-body">
                Invitation message <span className="font-normal text-charcoal-soft">— optional</span>
              </label>
              <textarea
                id="f-body"
                className={`${field} min-h-32 leading-relaxed`}
                value={form.body_text}
                onChange={set("body_text")}
                maxLength={MAX_BODY_TEXT}
                placeholder={
                  "Assalamu'alaikum warahmatullah.\n\n" +
                  "It would be our honour to have your family join us for an evening of " +
                  "selawat and remembrance, followed by dinner together.\n\n" +
                  "Jazakumullahu khayran."
                }
              />
              <p className="mt-1.5 text-xs text-charcoal-soft">
                Your own words, shown on the invitation and in the invitation email.
                Leave a blank line between paragraphs. {form.body_text.length}/{MAX_BODY_TEXT}
              </p>
            </div>
            <div>
              <label className={label} htmlFor="f-venue">Venue</label>
              <input id="f-venue" className={field} value={form.venue_name} onChange={set("venue_name")} />
            </div>
            <div>
              <label className={label} htmlFor="f-deadline">Reply deadline</label>
              <input id="f-deadline" type="date" className={field} value={form.rsvp_deadline} onChange={set("rsvp_deadline")} />
            </div>
            <div className="sm:col-span-2">
              <MapField
                address={form.venue_address}
                mapUrl={form.venue_map_url}
                venueName={form.venue_name}
                onAddress={(v) => setValue("venue_address", v)}
                onMapUrl={(v) => setValue("venue_map_url", v)}
              />
            </div>
            <div>
              <label className={label} htmlFor="f-dress">
                Dress code <span className="font-normal text-charcoal-soft">— optional</span>
              </label>
              <Combobox
                id="f-dress"
                value={form.dress_code}
                onChange={(v) => setValue("dress_code", v)}
                groups={DRESS_CODE_GROUPS}
                placeholder="Pick one, or type your own"
                ariaLabel="Dress code"
              />
              <p className="mt-1.5 text-xs text-charcoal-soft">
                Leave it empty and the invitation simply won&rsquo;t mention attire.
              </p>
            </div>
            <div>
              <label className={label} htmlFor="f-party">Max party size</label>
              <Combobox
                id="f-party"
                value={form.max_party_size}
                onChange={(v) => setValue("max_party_size", v.replace(/[^\d]/g, ""))}
                groups={PARTY_SIZE_GROUPS}
                placeholder="10"
                inputMode="numeric"
                ariaLabel="Max party size"
              />
              <p className="mt-1.5 text-xs text-charcoal-soft">
                The most people one invitation may bring. Type any number up to 5000.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="f-register">
                Registration link <span className="font-normal text-charcoal-soft">— optional</span>
              </label>
              <input
                id="f-register"
                className={field}
                value={form.registration_url}
                onChange={set("registration_url")}
                placeholder="https://forms.gle/… or any link you want to share"
              />
              <p className="mt-1.5 text-xs text-charcoal-soft">
                A link anyone can open and sign up through — a form, a ticket page, a
                WhatsApp group. It appears as a button on every invitation and in the
                invitation email. Unlike the personal invite links, this one is safe to
                share in a group chat.
              </p>
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
          </div>

          {/* ---- contribution ---- */}
          <div className="mt-6 rounded-control border border-line bg-paper p-4">
            <label className="flex items-start gap-2.5 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={form.ask_contribution}
                onChange={set("ask_contribution")}
                className="mt-0.5 size-4 accent-gold"
              />
              <span>
                Ask attending families to contribute
                <span className="mt-0.5 block text-xs font-normal text-charcoal-soft">
                  Off for a free event. On, every attending family buys the product below
                  through the store before their reply counts as complete.
                </span>
              </span>
            </label>

            {form.ask_contribution ? (
              <div className="mt-4">
                <label className={label} htmlFor="f-support">Contribution product</label>
                <input
                  id="f-support"
                  className={field}
                  value={form.support_url}
                  onChange={set("support_url")}
                  placeholder="https://lqkstore.littlequrankids.sg/products/…"
                />
                <p className="mt-1.5 text-xs text-charcoal-soft">
                  Paste any product link from the LQK store (add ?variant=… to pin a variant).
                  Payment confirmation needs the store&rsquo;s &ldquo;Order payment&rdquo;
                  webhook pointed at this portal — see app/api/events/shopify/route.js.
                </p>
                {!form.support_url.trim() ? (
                  <div className="mt-2">
                    <Notice tone="bad">
                      The switch is on but there&rsquo;s no product link — guests will see no
                      contribution at all until you paste one.
                    </Notice>
                  </div>
                ) : null}
                {/* The single most expensive misconfiguration in this feature:
                    without the webhook, a family pays and can NEVER finish
                    their reply, and nothing anywhere says why. */}
                {!capabilities.shopifyWebhook ? (
                  <div className="mt-2">
                    <Notice tone="bad">
                      <strong>Payments can&rsquo;t be confirmed yet.</strong> The store&rsquo;s
                      &ldquo;Order payment&rdquo; webhook isn&rsquo;t connected, so families who
                      pay will be stuck on &ldquo;waiting for the store&rdquo; and can&rsquo;t
                      complete their reply. In the store admin go to Settings → Notifications →
                      Webhooks, create an <em>Order payment</em> webhook (JSON) pointing at{" "}
                      <code className="rounded bg-white/60 px-1">
                        {baseUrl}/api/events/shopify
                      </code>
                      , then put its signing secret into{" "}
                      <code className="rounded bg-white/60 px-1">SHOPIFY_EVENTS_WEBHOOK_SECRET</code>{" "}
                      on Railway.
                    </Notice>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <button type="button" onClick={save} disabled={busy} className={`${btn} mt-5`}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </section>
      ) : null}

      {/* ---- questions ---- */}
      {tab === "questions" ? (
        <section className={card}>
          <h2 className="font-heading text-lg text-ink">What guests are asked</h2>
          <p className="mb-4 mt-0.5 text-sm text-charcoal-soft">
            Every invitation already asks whether the family is coming, how many adults and
            children, and leaves room for a message. Add your own questions here — asked
            once of the family, or repeated for every person in their party.
          </p>

          <FieldBuilder
            fields={customFields}
            onChange={setCustomFields}
            drivePlaceholder={
              capabilities.drive ? null : "Drive isn't configured — uploads will fail until it is."
            }
          />

          <button type="button" onClick={save} disabled={busy} className={`${btn} mt-5`}>
            {busy ? "Saving…" : "Save questions"}
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
                Download guest list (CSV)
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
              disabled={busy || !channels.length || event.status === "draft" || !unsent.length}
              className={btn}
            >
              {busy
                ? "Sending…"
                : unsent.length
                  ? `Send to ${unsent.length} new guest${unsent.length === 1 ? "" : "s"}`
                  : "Everyone has been sent an invite"}
            </button>
            <button
              type="button"
              onClick={() => doSend("remind")}
              disabled={busy || !channels.length || event.status === "draft" || !reminderCount}
              className={btnQuiet}
            >
              {reminderCount
                ? `Remind the ${reminderCount} who haven't replied`
                : "Nobody is due a reminder"}
            </button>
          </div>
          <p className="mt-3 text-xs text-charcoal-soft">
            Reminders only go to guests who were sent an invite, haven&rsquo;t replied, and
            haven&rsquo;t been nudged in the last 72 hours.
          </p>
        </section>
      ) : null}

      {/* ---- replies ---- */}
      {tab === "replies" ? (
        <section className={card}>
          {/* Totals strip: the numbers a caterer or treasurer actually asks for. */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              [stats.adults, "adults attending"],
              [stats.children, "children attending"],
              [stats.pending, "families not replied"],
            ].map(([value, text]) => (
              <div key={text} className="rounded-control bg-paper px-4 py-3.5">
                <p className="text-2xl font-extrabold tabular-nums text-ink">{value}</p>
                <p className="text-[13px] text-charcoal-soft">{text}</p>
              </div>
            ))}
            {hasContribution ? (
              <div className={`rounded-control px-4 py-3.5 ${stats.hampersUnpaid ? "bg-rust-soft" : "bg-paper"}`}>
                <p className={`text-2xl font-extrabold tabular-nums ${stats.hampersUnpaid ? "text-rust" : "text-ink"}`}>
                  {stats.hampersUnpaid}
                </p>
                <p className={`text-[13px] ${stats.hampersUnpaid ? "text-[#7A4630]" : "text-charcoal-soft"}`}>
                  hampers unpaid
                </p>
              </div>
            ) : null}
          </div>

          {replied.length === 0 ? (
            <p className="mt-5 text-sm text-charcoal-soft">No replies yet.</p>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-charcoal-soft">
                    <th className="w-[28%] pb-2 pe-3 font-bold">Family</th>
                    <th className="w-[20%] pb-2 pe-3 font-bold">Reply</th>
                    <th className="w-[16%] pb-2 pe-3 font-bold">Party</th>
                    <th className="pb-2 font-bold">Reason / message</th>
                  </tr>
                </thead>
                <tbody>
                  {replied.map((g) => {
                    const reasonBits = [
                      g.attending === "no" && g.decline_reason
                        ? g.decline_reason === "other" && g.decline_reason_note
                          ? g.decline_reason_note
                          : declineReasonLabel("en", g.decline_reason)
                        : null,
                      g.message ? `‘${g.message}’` : null,
                    ].filter(Boolean);
                    return (
                      <tr key={g.id} className="border-b border-line/40">
                        <td className="py-2.5 pe-3 text-ink">{g.name}</td>
                        <td className="py-2.5 pe-3">
                          <ReplyPill guest={g} hasContribution={hasContribution} />
                        </td>
                        <td className="py-2.5 pe-3 tabular-nums text-charcoal-soft">
                          {g.attending === "yes" ? g.adults + g.children : "—"}
                        </td>
                        <td className="py-2.5 text-charcoal-soft">
                          {reasonBits.length ? reasonBits.join(" · ") : "—"}
                          <Answers guest={g} fields={savedFields} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <a href={`/api/events/${event.id}/csv`} className={btnHoney}>
              Download guest list (CSV)
            </a>
            {savedPerPerson.length ? (
              <a href={`/api/events/${event.id}/csv?view=people`} className={btnQuiet}>
                Download one row per person
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => doSend("remind")}
              disabled={busy || event.status === "draft" || !reminderCount}
              className={btnQuiet}
            >
              {reminderCount
                ? `Remind the ${reminderCount} who haven't replied`
                : "Nobody is due a reminder"}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}

/* Custom answers under a reply. Family answers read inline; per-person answers
   collapse behind a count, because an event asking three questions of eight
   people would otherwise bury the reason and the message this column exists
   for. Fields deleted after a guest replied simply stop being listed — the
   answer stays in the row and in the CSV. */
function Answers({ guest, fields }) {
  const [open, setOpen] = useState(false);
  if (!fields.length) return null;

  const custom = parseAnswers(guest.custom_json, {});
  const attendees = parseAnswers(guest.attendees_json, []);
  const family = fields
    .filter((f) => f.scope === "family")
    .map((f) => [f.label, answerText(f, custom[f.id])])
    .filter(([, value]) => value);
  const perPerson = fields.filter((f) => f.scope === "attendee");
  const filled = attendees.filter((entry) => perPerson.some((f) => answerText(f, entry?.[f.id])));

  if (!family.length && !filled.length) return null;

  return (
    <div className="mt-1.5 grid gap-1 text-xs">
      {family.map(([labelText, value]) => (
        <span key={labelText}>
          <span className="text-charcoal-soft">{labelText}:</span>{" "}
          <span className="text-ink">
            <bdi>{value}</bdi>
          </span>
        </span>
      ))}

      {filled.length ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="justify-self-start rounded-pill border border-line px-2.5 py-0.5 font-semibold text-charcoal-soft transition-transform duration-150 ease-out active:scale-95 hover:text-ink"
          >
            {open ? "Hide" : `${filled.length} ${filled.length === 1 ? "person" : "people"}`}
          </button>
          {open ? (
            <ol className="grid gap-1.5 ps-4">
              {filled.map((entry, i) => (
                // Index keys are correct here: this list is positional — entry
                // i IS "person i of the party" and has no other identity.
                <li key={i} className="list-decimal">
                  {perPerson
                    .map((f) => [f.label, answerText(f, entry?.[f.id])])
                    .filter(([, value]) => value)
                    .map(([labelText, value]) => (
                      <span key={labelText} className="me-2">
                        <span className="text-charcoal-soft">{labelText}:</span>{" "}
                        <span className="text-ink">
                          <bdi>{value}</bdi>
                        </span>
                      </span>
                    ))}
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* The address, and the map pin it resolves to.

   Typing an address and hoping Google finds it is how guests end up at the
   wrong Woodlands block. So the address is what the invitation PRINTS, and the
   map link is what "Get directions" OPENS — two separate things, and the link
   wins when both exist.

   No Places API here by choice: this needs no key, no billing and no quota. The
   button opens a Maps search for whatever address is typed; Karim finds the
   real place, copies the URL from the address bar (or Share → Copy link), and
   pastes it back. One extra step, and the pin is then exactly right forever. */
function mapLinkState(url) {
  const text = String(url || "").trim();
  if (!text) return "empty";
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return "bad";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "bad";
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const ok =
    host === "maps.app.goo.gl" ||
    host === "goo.gl" ||
    host === "maps.google.com" ||
    host === "google.com" ||
    host.endsWith(".google.com") ||
    /^google\.[a-z.]+$/.test(host) ||
    host === "what3words.com";
  return ok ? "good" : "foreign";
}

function MapField({ address, mapUrl, venueName, onAddress, onMapUrl }) {
  const state = mapLinkState(mapUrl);
  const search = [venueName, address].filter(Boolean).join(", ").trim();
  const searchUrl = search
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(search)}`
    : "https://www.google.com/maps";

  return (
    <>
      <label className={label} htmlFor="f-address">Address</label>
      <input
        id="f-address"
        className={field}
        value={address}
        onChange={(e) => onAddress(e.target.value)}
        placeholder="12 Woodlands Square, #06-77, Singapore 737715"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a
          href={searchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-pill border border-line px-3.5 py-1.5 text-xs font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          Find it on Google Maps ↗
        </a>
        <span className="text-xs text-charcoal-soft">
          then copy the link from the address bar and paste it below
        </span>
      </div>

      <label className={`${label} mt-3`} htmlFor="f-maplink">
        Map link <span className="font-normal text-charcoal-soft">— optional, but it pins the exact spot</span>
      </label>
      <input
        id="f-maplink"
        className={field}
        value={mapUrl}
        onChange={(e) => onMapUrl(e.target.value)}
        placeholder="https://maps.app.goo.gl/…"
      />
      {state === "good" ? (
        <p className="mt-1.5 text-xs text-[#4E6B3F]">
          ✓ &ldquo;Get directions&rdquo; will open this exact pin.
        </p>
      ) : state === "bad" ? (
        <p className="mt-1.5 text-xs text-rust">
          That isn&rsquo;t a link — it needs to start with https://
        </p>
      ) : state === "foreign" ? (
        <p className="mt-1.5 text-xs text-rust">
          That isn&rsquo;t a Google Maps link. Guests will still be sent there, so check it
          goes where you mean.
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-charcoal-soft">
          Empty is fine — guests get a Maps search for the address above, which is usually
          right but can land on the wrong block for a unit number.
        </p>
      )}
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
