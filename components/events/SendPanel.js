"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { attachList, sendTestInvite, sendEventBatch, retryFailed, checkChannels } from "@/lib/actions/events";

const STATUS_STYLE = {
  sent: "bg-[#DCD3F0] text-[#4A3D63]",
  failed: "bg-[#FBE3E8] text-[#8E3D52]",
  pending: "bg-paper-deep text-charcoal-soft",
  skipped: "bg-paper-deep text-charcoal-soft/70",
};

function Pill({ status, title }) {
  return (
    <span title={title || undefined} className={`inline-flex rounded-pill px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[status] || STATUS_STYLE.pending}`}>
      {status}
    </span>
  );
}

/**
 * Everything between a finished design and a parent's phone: pick the list,
 * test it on yourself, send, then watch what happened.
 *
 * The send loop runs here in the browser, one batch per round trip, because a
 * 200-parent send at ~1s per parent outlives any request timeout. Each round
 * returns the refreshed recipient rows, so the table below is a live view of
 * the send rather than a guess at its progress.
 */
export default function SendPanel({ event, recipients, setRecipients, lists, channels, onBeforeSend }) {
  const [listId, setListId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [useEmail, setUseEmail] = useState(true);
  const [useWhatsapp, setUseWhatsapp] = useState(true);
  const [verify, setVerify] = useState(null);

  const stats = useMemo(() => {
    const s = {
      total: recipients.length,
      emailable: recipients.filter((r) => r.email).length,
      whatsappable: recipients.filter((r) => r.phone).length,
      emailSent: recipients.filter((r) => r.emailStatus === "sent").length,
      emailFailed: recipients.filter((r) => r.emailStatus === "failed").length,
      waSent: recipients.filter((r) => r.whatsappStatus === "sent").length,
      waFailed: recipients.filter((r) => r.whatsappStatus === "failed").length,
      yes: recipients.filter((r) => r.rsvp === "yes").length,
      no: recipients.filter((r) => r.rsvp === "no").length,
    };
    s.awaiting = s.total - s.yes - s.no;
    return s;
  }, [recipients]);

  async function onAttach() {
    if (!listId) return;
    setBusy("attach");
    setError("");
    const result = await attachList(event.id, listId);
    setBusy("");
    if (result?.error) setError(result.error);
    else setRecipients(result.recipients);
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

    const channelsToUse = { email: useEmail, whatsapp: useWhatsapp };
    let guard = 0;

    // Loop until the server says nothing is pending. The guard is a runaway
    // stop, not an expected exit: 400 rounds covers 3,200 parents.
    while (guard < 400) {
      guard += 1;
      const result = await sendEventBatch(event.id, channelsToUse);
      if (result?.error) {
        setError(result.error);
        break;
      }
      setRecipients(result.recipients);
      setProgress({ done: result.total - result.remaining, total: result.total });
      if (result.done) break;
    }

    setBusy("");
  }

  async function onRetry(channel) {
    setBusy(`retry-${channel}`);
    setError("");
    const result = await retryFailed(event.id, channel);
    setBusy("");
    if (result?.error) setError(result.error);
    else setRecipients(result.recipients);
  }

  const canSend = recipients.length > 0 && (useEmail || useWhatsapp);
  const sendLabel = busy === "send" ? "Sending…" : `Send to ${recipients.length} parent${recipients.length === 1 ? "" : "s"}`;

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
                disabled={!listId || busy === "attach"}
                className="rounded-control bg-paper-deep px-4 py-2.5 text-[13px] font-bold text-charcoal disabled:opacity-50"
              >
                {busy === "attach" ? "Attaching…" : "Use this list"}
              </button>
            </div>
          )}

          {recipients.length > 0 ? (
            <p className="mt-2 text-[12px] text-charcoal-soft">
              {stats.total} parents attached · {stats.emailable} with an email · {stats.whatsappable} with a WhatsApp number
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
              WhatsApp {channels.whatsapp ? <span className="text-charcoal-soft">— template “{channels.whatsappTemplate}”</span> : <span className="text-rust">— not configured</span>}
            </label>
          </div>
          <button type="button" onClick={onVerify} disabled={busy === "verify"} className="mt-2 text-[12px] text-gold underline disabled:opacity-50">
            {busy === "verify" ? "Checking…" : "Check the connection"}
          </button>
          {verify ? (
            <p className="mt-1 text-[12px] text-charcoal-soft">
              Email: {verify.email.configured ? (verify.email.ok ? "connected" : `error — ${verify.email.error}`) : "not configured"} · WhatsApp:{" "}
              {verify.whatsapp.configured ? `configured (${verify.whatsapp.template})` : "not configured"}
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
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend || busy === "send"}
            className="mt-1.5 w-full rounded-control bg-ink px-5 py-3 text-[14px] font-bold text-white transition hover:bg-ink-deep disabled:opacity-50"
          >
            {sendLabel}
          </button>
          {progress ? (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-pill bg-paper-deep">
                <div
                  className="h-full rounded-pill bg-gold transition-[width] duration-300"
                  style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-1 text-[12px] text-charcoal-soft">
                {progress.done} of {progress.total} done
              </p>
            </div>
          ) : null}
          {!recipients.length ? (
            <p className="mt-1.5 text-[12px] text-charcoal-soft">Attach a parent list above first.</p>
          ) : null}
        </div>

        {error ? <p className="text-[12px] text-rust">{error}</p> : null}

        {/* Results */}
        {recipients.length > 0 ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-bold text-charcoal-soft">Responses</p>
              <p className="text-[12px] text-charcoal-soft">
                {stats.yes} attending · {stats.no} can&apos;t · {stats.awaiting} no reply yet
              </p>
            </div>

            <div className="mt-1.5 flex flex-wrap gap-2 text-[12px] text-charcoal-soft">
              <span>
                Email {stats.emailSent}/{stats.emailable} sent
              </span>
              {stats.emailFailed ? (
                <button type="button" onClick={() => onRetry("email")} disabled={busy === "retry-email"} className="text-rust underline disabled:opacity-50">
                  {stats.emailFailed} failed — retry
                </button>
              ) : null}
              <span>·</span>
              <span>
                WhatsApp {stats.waSent}/{stats.whatsappable} sent
              </span>
              {stats.waFailed ? (
                <button type="button" onClick={() => onRetry("whatsapp")} disabled={busy === "retry-whatsapp"} className="text-rust underline disabled:opacity-50">
                  {stats.waFailed} failed — retry
                </button>
              ) : null}
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
                  {recipients.map((r) => (
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
              Hover a failed pill to see why. Responses update when you reload this page.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
