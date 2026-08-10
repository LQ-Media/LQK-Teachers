"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { TOPICS, AGE_GROUPS } from "@/lib/notes/taxonomy";
import { shareNote, unshareNote } from "@/lib/actions/notes";

/**
 * Publish/withdraw a note to the Ilmu Bank. The copy here does real work: a
 * teacher needs to understand *before* they click that colleagues will see the
 * summary but not their transcript, and that the speaker gets credited.
 */
export default function ShareControl({ id, sharedAt, topic, ageGroup, canShare, needsSpeaker }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [chosenTopic, setChosenTopic] = useState(topic || "");
  const [chosenAge, setChosenAge] = useState(ageGroup || "all");

  async function onShare() {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("topic", chosenTopic);
    fd.set("age_group", chosenAge);
    const result = await shareNote(fd);
    setBusy(false);
    if (!result?.ok) {
      setError(result?.error || "Could not share that note.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function onWithdraw() {
    setBusy(true);
    await unshareNote(id);
    setBusy(false);
    router.refresh();
  }

  if (sharedAt) {
    return (
      <div className="mt-6 rounded-card border border-line bg-gold-soft/40 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-gold">
              <Icon name="share" size={16} />
            </span>
            <div>
              <p className="font-heading text-[14px] font-bold text-charcoal">In the Ilmu Bank</p>
              <p className="text-[12px] text-charcoal-soft">
                Colleagues can read the summary. Your transcript stays private.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onWithdraw}
            disabled={busy}
            className="rounded-control px-3 py-2 text-[13px] font-semibold text-charcoal-soft transition-colors hover:bg-white disabled:opacity-50"
          >
            {busy ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-card border border-line bg-white px-5 py-4">
      {error && (
        <div className="mb-3 flex items-start gap-2.5 rounded-control bg-rust-soft px-3.5 py-2.5 text-[13px] text-[#8E3A24]">
          <span className="mt-0.5 flex-shrink-0">
            <Icon name="alert-triangle" size={15} />
          </span>
          <p>{error}</p>
        </div>
      )}

      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-heading text-[14px] font-bold text-charcoal">Share with the team</p>
            <p className="text-[12px] text-charcoal-soft">
              {canShare
                ? "Publishes the summary to the Ilmu Bank. Your transcript is never shared."
                : "Summarise this note first — the Ilmu Bank shares summaries, not raw transcripts."}
            </p>
          </div>
          <button
            type="button"
            disabled={!canShare}
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-control bg-white px-4 py-2 text-[13px] font-semibold text-charcoal ring-1 ring-line transition-colors hover:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="share" size={15} />
            Share
          </button>
        </div>
      ) : (
        <div>
          <p className="mb-3 font-heading text-[14px] font-bold text-charcoal">Share to the Ilmu Bank</p>

          {needsSpeaker && (
            <p className="mb-3 rounded-control bg-rust-soft px-3.5 py-2.5 text-[13px] text-[#8E3A24]">
              This note came from someone else&apos;s talk. Add the speaker&apos;s name above before sharing
              it — their words should always be credited.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">
                Topic
              </span>
              <select
                value={chosenTopic}
                onChange={(e) => setChosenTopic(e.target.value)}
                className="w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
              >
                <option value="">Choose one…</option>
                {TOPICS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">
                Useful for
              </span>
              <select
                value={chosenAge}
                onChange={(e) => setChosenAge(e.target.value)}
                className="w-full rounded-control border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-gold"
              >
                {AGE_GROUPS.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onShare}
              disabled={busy || needsSpeaker}
              className="rounded-control bg-gold px-4 py-2 text-[13px] font-bold text-ink transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Sharing…" : "Publish to Ilmu Bank"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-control px-3 py-2 text-[13px] font-semibold text-charcoal-soft hover:bg-paper-deep"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
