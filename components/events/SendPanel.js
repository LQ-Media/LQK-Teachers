"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import {
  attachList,
  sendTestInvite,
  startSend,
  sendProgress,
  refreshRecipients,
  retryFailed,
  checkChannels,
} from "@/lib/actions/events";
import { LANGUAGES } from "@/lib/events/design";

const STATUS_STYLE = {
  sent: "bg-[#DCD3F0] text-[#4A3D63]",
  failed: "bg-[#FBE3E8] text-[#8E3D52]",
  pending: "bg-paper-deep text-charcoal-soft",
  skipped: "bg-paper-deep text-charcoal-soft/70",
};

// A thousand rows in the DOM is a scroll container nobody reads. Show a window
// of them and let the filter do the finding.
const TABLE_LIMIT = 250;

function Pill({ status, title }) {
  return (
    <span
      title={title || undefined}
      className={`inline-flex rounded-pill px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[status] || STATUS_STYLE.pending}`}
    >
      {status}
    </span>
  );
}

function minutesFor(count, delayMs) {
  const minutes = Math.round((count * (delayMs || 900)) / 60000);
  if (minutes < 1) return "under a minute";
  return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Everything between a finished design and a parent's phone: pick the list,
 * test it on yourself, send, then watch what happened.
 *
 * The send itself runs on the server (lib/events/job.js). This panel starts it
 * and polls aggregate counts — so closing the tab no longer stops a send
 * half-way, which at 1,000 parents is a fifteen-minute window in which that
 * would otherwise be very easy to do.
 */
export default function SendPanel({ event, recipients, setRecipients, counts, initialJob, lists, channels, onBeforeSend }) {
  const [listId, setListId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [useEmail, setUseEmail] = useState(true);
  const [useWhatsapp, setUseWhatsapp] = useState(true);
  const [verify, setVerify] = useState(null);
  const [stats, setStats] = useState(counts);
  const [job, setJob] = useState(initialJob || { running: false });
  const [filter, setFilter] = useState("all");

  const pollRef = useRef(null);

  const pullRecipients = useCallback(async () => {
    const result = await refreshRecipients(event.id);
    if (result?.recipients) {
      setRecipients(result.recipients);
      setStats(result.counts);
    }
  }, [event.id, setRecipients]);

  // Poll only while a send is in flight, and stop the moment it ends.
  useEffect(() => {
    if (!job.running) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return undefined;
    }

    pollRef.current = setInterval(async () => {
      const result = await sendProgress(event.id);
      if (!result) return;
      setStats(result.counts);
      if (!result.job?.running) {
        setJob(result.job || { running: false });
        await pullRecipients();
      }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [job.running, event.id, pullRecipients]);

  const emailRemaining = useEmail ? stats.emailPending : 0;
  const waRemaining = useWhatsapp ? stats.waPending : 0;
  const remaining = emailRemaining + waRemaining;

  const filtered = useMemo(() => {
    switch (filter) {
      case "yes":
        return recipients.filter((r) => r.rsvp === "yes");
      case "no":
        return recipients.filter((r) => r.rsvp === "no");
      case "awaiting":
        return recipients.filter((r) => !r.rsvp);
      case "failed":
        return recipients.filter((r) => r.emailStatus === "failed" || r.whatsappStatus === "failed");
      default:
        return recipients;
    }
  }, [recipients, filter]);

  async function onAttach() {
    if (!listId) return;
    setBusy("attach");
    setError("");
    const result = await attachList(event.id, listId);
    setBusy("");
    if (result?.error) setError(result.error);
    else {
      setRecipients(result.recipients);
      await pullRecipients();
    }
  }

  async function onVerify() {
    setBusy("verify");
    setVerify(null);
    const result = await checkChannels();
    setBusy("");
    setVerify(result);
  }

  async function onTest() {
    setBusy("test");
    setError("");
    setTestResult(null);
    await onBeforeSend?.(); // make sure the draft on screen is the draft we send
    const result = await sendTestInvite(event.id, { email: testEmail, phone: testPhone });
    setBusy("");
    if (result?.error) setError(result.error);
    else setTestResult(result.result);
  }

  async function onSend() {
    setError("");
    setBusy("send");
    await onBeforeSend?.();
    const result = await startSend(event.id, { email: useEmail, whatsapp: useWhatsapp });
    setBusy("");
    if (result?.error) {
      setError(result.error);
      return;
    }
    setJob(result.job || { running: true });
    if (result.counts) setStats(result.counts);
  }

  async function onRetry(channel) {
    setBusy(`retry-${channel}`);
    setError("");
    const result = await retryFailed(event.id, channel);
    setBusy("");
    if (result?.error) setError(result.error);
    else {
      if (result.counts) setStats(result.counts);
      if (result.job) setJob(result.job);
    }
  }

  const canSend = stats.total > 0 && (useEmail || useWhatsapp) && !job.running;
  const sendLabel = job.running
    ? "Sending…"
    : remaining && remaining < stats.total
      ? `Send to the remaining ${remaining}`
      : `Send to ${stats.total} parent${stats.total === 1 ? "" : "s"}`;

  const done = stats.total ? stats.emailSent + stats.emailFailed + stats.waSent + stats.waFailed : 0;
  const totalDeliveries =
    (useEmail ? stats.emailable : 0) + (useWhatsapp ? stats.whatsappable : 0) || 1;

  const languageLabel = LANGUAGES.find((l) => l.id === event.language)?.label || event.language;
  const hasOwnTemplate = (channels.whatsappTemplateLanguages || []).includes(event.language);

  return (
    <section className="rounded-card border border-line bg-white">
      <div className="border-b border-line px-4 py-3.5">
        <h2 className="font-heading text-[15px] font-semibold text-charcoal">Send</h2>
      </div>

      <div className="space-y-5 px-4 py-4">
        {/* 1 — who */}
        <div>
          <p className="text-[12px] font-bold text-charcoal-soft">1 · Who&apos;s invited</p>
          {lists.length === 0 ? (
            <p className="mt-1.5 text-[13px] text-charcoal-soft">
              No parent lists yet — import a CSV from the{" "}
              <Link href="/events" className="text-gold underline">
                invites page
              </Link>{" "}
              first.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-2">
              <select
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                aria-label="Parent list"
                className="min-w-0 flex-1 rounded-control border border-line bg-paper px-3 py-2.5 text-[14px] outline-none focus:border-gold"
              >
                <option value="">Choose a parent list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.count})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onAttach}
                disabled={!listId || busy === "attach" || job.running}
                className="rounded-control bg-paper-deep px-4 py-2.5 text-[13px] font-bold text-charcoal disabled:opacity-50"
              >
                {busy === "attach" ? "Attaching…" : "Use this list"}
              </button>
            </div>
          )}

          {stats.total > 0 ? (
            <p className="mt-2 text-[12px] text-charcoal-soft">
              {stats.total} parents attached · {stats.emailable} with an email · {stats.whatsappable} with a WhatsApp
              number
            </p>
          ) : null}
        </div>

        {/* 2 — channels */}
        <div>
          <p className="text-[12px] font-bold text-charcoal-soft">2 · How to send</p>
          <div className="mt-1.5 space-y-1.5">
            <label className="flex items-center gap-2 text-[13px] text-charcoal">
              <input type="checkbox" checked={useEmail} onChange={(e) => setUseEmail(e.target.checked)} className="accent-gold" />
              Email {channels.email ? "" : <span className="text-rust">— not configured</span>}
            </label>
            <label className="flex items-center gap-2 text-[13px] text-charcoal">
              <input type="checkbox" checked={useWhatsapp} onChange={(e) => setUseWhatsapp(e.target.checked)} className="accent-gold" />
              WhatsApp{" "}
              {channels.whatsapp ? (
                <span className="text-charcoal-soft">— template “{channels.whatsappTemplate}”</span>
              ) : (
                <span className="text-rust">— not configured</span>
              )}
            </label>
          </div>

          {/* A WhatsApp template's wording is fixed at approval time, so a
              non-English invite silently arrives in English unless that
              language has its own approved template. Say so before the send,
              not after a thousand messages. */}
          {channels.whatsapp && useWhatsapp && event.language !== "en" && !hasOwnTemplate ? (
            <p className="mt-2 rounded-control bg-[#FDF3E0] px-3 py-2 text-[12px] leading-relaxed text-[#7A5A25]">
              This invite is in <strong>{languageLabel}</strong>, but no WhatsApp template is configured for it — the
              WhatsApp message will arrive in whatever language “{channels.whatsappTemplate}” was approved in. The email
              and the invite page will still be in {languageLabel}. See <code className="font-mono">docs/EVENTS.md</code>.
            </p>
          ) : null}

          <button type="button" onClick={onVerify} disabled={busy === "verify"} className="mt-2 text-[12px] text-gold underline disabled:opacity-50">
            {busy === "verify" ? "Checking…" : "Check the connection"}
          </button>
          {verify ? (
            <p className="mt-1 text-[12px] text-charcoal-soft">
              Email: {verify.email.configured ? (verify.email.ok ? "connected" : `error — ${verify.email.error}`) : "not configured"} ·
              WhatsApp: {verify.whatsapp.configured ? `configured (${verify.whatsapp.template})` : "not configured"}
            </p>
          ) : null}
        </div>

        {/* 3 — test */}
        <div className="rounded-control bg-paper-deep p-3">
          <p className="text-[12px] font-bold text-charcoal">3 · Test it on yourself first</p>
          <p className="mt-0.5 text-[11px] text-charcoal-soft">
            There is no unsend. Send yourself a real one and read it on your phone before it goes to parents.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="your@email.com"
              aria-label="Test email address"
              className="min-w-0 flex-1 rounded-control border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-gold"
            />
            <input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="6591234567"
              aria-label="Test WhatsApp number"
              className="min-w-0 flex-1 rounded-control border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-gold"
            />
            <button
              type="button"
              onClick={onTest}
              disabled={busy === "test" || (!testEmail && !testPhone)}
              className="rounded-control bg-ink px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {busy === "test" ? "Sending…" : "Send test"}
            </button>
          </div>
          {testResult ? (
            <div className="mt-2 space-y-0.5">
              {testResult.email ? (
                <p className={`text-[12px] ${testResult.email.ok ? "text-charcoal" : "text-rust"}`}>
                  Email: {testResult.email.ok ? "sent" : testResult.email.error}
                </p>
              ) : null}
              {testResult.whatsapp ? (
                <p className={`text-[12px] ${testResult.whatsapp.ok ? "text-charcoal" : "text-rust"}`}>
                  WhatsApp: {testResult.whatsapp.ok ? "sent" : testResult.whatsapp.error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 4 — send */}
        <div>
          <p className="text-[12px] font-bold text-charcoal-soft">4 · Send the invitations</p>

          <LargeListNotice total={stats.total} channels={channels} useEmail={useEmail} useWhatsapp={useWhatsapp} />

          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="mt-2 w-full rounded-control bg-ink px-5 py-3 text-[14px] font-bold text-white transition hover:bg-ink-deep disabled:opacity-50"
          >
            {sendLabel}
          </button>

          {job.running ? (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-pill bg-paper-deep">
                <div
                  className="h-full rounded-pill bg-gold transition-[width] duration-500"
                  style={{ width: `${Math.min(100, Math.round((done / totalDeliveries) * 100))}%` }}
                />
              </div>
              <p className="mt-1 text-[12px] text-charcoal-soft">
                {done} of {totalDeliveries} messages sent — this runs on the server, so you can close this page and come
                back.
              </p>
            </div>
          ) : null}

          {job.error ? <p className="mt-1.5 text-[12px] text-rust">The send stopped: {job.error}</p> : null}

          {!stats.total ? <p className="mt-1.5 text-[12px] text-charcoal-soft">Attach a parent list above first.</p> : null}
        </div>

        {error ? <p className="text-[12px] text-rust">{error}</p> : null}

        {/* Results */}
        {stats.total > 0 ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-bold text-charcoal-soft">Responses</p>
              <p className="text-[12px] text-charcoal-soft">
                {stats.yes} attending · {stats.no} can&apos;t · {stats.awaiting} no reply yet
              </p>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-charcoal-soft">
              <span>
                Email {stats.emailSent}/{stats.emailable} sent
              </span>
              {stats.emailFailed ? (
                <button
                  type="button"
                  onClick={() => onRetry("email")}
                  disabled={busy === "retry-email" || job.running}
                  className="text-rust underline disabled:opacity-50"
                >
                  {stats.emailFailed} failed — retry
                </button>
              ) : null}
              <span>·</span>
              <span>
                WhatsApp {stats.waSent}/{stats.whatsappable} sent
              </span>
              {stats.waFailed ? (
                <button
                  type="button"
                  onClick={() => onRetry("whatsapp")}
                  disabled={busy === "retry-whatsapp" || job.running}
                  className="text-rust underline disabled:opacity-50"
                >
                  {stats.waFailed} failed — retry
                </button>
              ) : null}
              <button type="button" onClick={pullRecipients} className="ml-auto text-gold underline">
                Refresh
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                ["all", `All (${stats.total})`],
                ["yes", `Attending (${stats.yes})`],
                ["no", `Can't (${stats.no})`],
                ["awaiting", `No reply (${stats.awaiting})`],
                ["failed", `Failed (${stats.emailFailed + stats.waFailed})`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={`rounded-pill px-2.5 py-1 text-[11px] font-bold transition ${
                    filter === key ? "bg-ink text-white" : "bg-paper-deep text-charcoal-soft hover:bg-line"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-2.5 max-h-[420px] overflow-auto rounded-control border border-line">
              <table className="w-full min-w-[520px] text-left text-[12px]">
                <thead className="sticky top-0 bg-paper-deep">
                  <tr>
                    <th className="px-3 py-2 font-bold text-charcoal-soft">Parent</th>
                    <th className="px-3 py-2 font-bold text-charcoal-soft">Email</th>
                    <th className="px-3 py-2 font-bold text-charcoal-soft">WhatsApp</th>
                    <th className="px-3 py-2 font-bold text-charcoal-soft">RSVP</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, TABLE_LIMIT).map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <div className="font-bold text-charcoal">{r.name || r.email || r.phone}</div>
                        <div className="text-charcoal-soft">
                          {r.childName ? `${r.childName} · ` : ""}
                          {r.email || "no email"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Pill status={r.emailStatus} title={r.emailError} />
                      </td>
                      <td className="px-3 py-2">
                        <Pill status={r.whatsappStatus} title={r.whatsappError} />
                      </td>
                      <td className="px-3 py-2">
                        {r.rsvp === "yes" ? (
                          <span className="font-bold text-[#4A3D63]">Attending</span>
                        ) : r.rsvp === "no" ? (
                          <span className="text-charcoal-soft">Can&apos;t make it</span>
                        ) : (
                          <span className="text-charcoal-soft/60">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-1.5 text-[11px] text-charcoal-soft">
              {filtered.length > TABLE_LIMIT
                ? `Showing the first ${TABLE_LIMIT} of ${filtered.length} — narrow it with the filters above. `
                : ""}
              Hover a failed pill to see why.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * What a big send actually costs, said before the button is pressed.
 *
 * Both providers have limits that a 1,000-parent list runs straight into, and
 * neither fails loudly in a way the operator would connect to the cause —
 * Gmail starts deferring, and WhatsApp simply stops delivering past the tier
 * cap. Better to say it here than to explain it afterwards.
 */
function LargeListNotice({ total, channels, useEmail, useWhatsapp }) {
  if (total < 200) return null;

  const minutes = minutesFor(total, channels.sendDelayMs);
  const overGmail = useEmail && total > 1900;

  return (
    <div className="mt-2 rounded-control bg-[#FDF3E0] px-3 py-2.5 text-[12px] leading-relaxed text-[#7A5A25]">
      <p className="font-bold">Sending to {total} parents will take {minutes}.</p>
      <ul className="mt-1 list-disc space-y-1 ps-4">
        <li>It runs on the server — you can close this page and come back to it.</li>
        {useEmail ? (
          <li>
            Google Workspace allows roughly 2,000 recipients a day.
            {overGmail ? " This list is over that — split it across two days." : " This list fits, but only just if you send anything else today."}
          </li>
        ) : null}
        {useWhatsapp ? (
          <li>
            WhatsApp caps how many <em>new</em> people a business number may message in 24 hours — commonly 250 or 1,000
            until Meta raises your tier. Above your tier the remainder fail rather than queue; retry them tomorrow.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
