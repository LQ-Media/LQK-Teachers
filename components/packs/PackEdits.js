"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposePackEdit, decidePackEdit } from "@/lib/actions/packs";
import { fmtDate } from "@/components/tracker/util";
import Icon from "@/components/Icon";

const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

// Mirrors PACK_EDIT_SECTIONS in lib/actions/packs.js (a "use server" file
// cannot export a plain object to the client).
const SECTIONS = [
  ["objective", "By the end (objective)"],
  ["hook", "Opening"],
  ["activity", "One step in the run of the lesson"],
  ["parentNote", "Note home to parents"],
  ["note", "Add a note from teachers"],
];
const SECTION_LABEL = Object.fromEntries(SECTIONS);

/**
 * Propose a change to a pack (any teacher), and decide on proposals
 * (reviewers). Approving applies the wording; the proposal itself stays as
 * the record behind assessment criterion A4.
 */
export default function PackEdits({ packId, canReview, activities, edits }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState("activity");
  const [activityIndex, setActivityIndex] = useState(0);
  const [proposed, setProposed] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const pendingEdits = edits.filter((e) => e.status === "pending");
  const decided = edits.filter((e) => e.status !== "pending");

  function submit() {
    setError("");
    startTransition(async () => {
      const r = await proposePackEdit({ packId, section, activityIndex, proposed, reason });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setProposed("");
      setReason("");
      router.refresh();
    });
  }

  function decide(e, decision) {
    const note = decision === "declined" ? prompt("Tell the teacher why (optional):", "") : "";
    if (note === null) return;
    startTransition(async () => {
      const r = await decidePackEdit({ id: e.id, decision, note });
      if (!r.ok) alert(r.error);
      router.refresh();
    });
  }

  return (
    <section className="mt-8 rounded-card border-[0.5px] border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-[15px] font-bold text-charcoal">Suggest a change</h2>
          <p className="mt-0.5 text-[12px] text-charcoal-soft">
            Taught this and found a step that did not land? Propose the change with what happened. A reviewer applies it for every branch.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep"
        >
          <Icon name="pencil" size={14} />
          {open ? "Close" : "Propose a change"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Which part</span>
              <select className={field} value={section} onChange={(e) => setSection(e.target.value)}>
                {SECTIONS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {section === "activity" && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Which step</span>
                <select className={field} value={activityIndex} onChange={(e) => setActivityIndex(Number(e.target.value))}>
                  {activities.map((name, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">
              {section === "note" ? "Your note" : "The new wording"}
            </span>
            <textarea className={`${field} min-h-[88px] resize-y`} value={proposed} onChange={(e) => setProposed(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Why — what happened in class</span>
            <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. the 4-year-olds lost interest after two minutes of the drill" />
          </label>
          {error && <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>}
          <div className="flex justify-end">
            <button type="button" onClick={submit} disabled={pending} className="rounded-control bg-ink px-5 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-60">
              {pending ? "Sending…" : "Send to reviewers"}
            </button>
          </div>
        </div>
      )}

      {pendingEdits.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">
            {canReview ? "Awaiting your decision" : "Your proposals, awaiting review"}
          </h3>
          <ul className="space-y-2">
            {pendingEdits.map((e) => (
              <Proposal key={e.id} e={e} activities={activities} canReview={canReview} onDecide={decide} pending={pending} />
            ))}
          </ul>
        </div>
      )}
      {decided.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">Decided</h3>
          <ul className="space-y-2">
            {decided.map((e) => (
              <Proposal key={e.id} e={e} activities={activities} canReview={false} pending={pending} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Proposal({ e, activities, canReview, onDecide, pending }) {
  const where = e.section === "activity" ? `Step ${e.activityIndex + 1}: ${activities[e.activityIndex] || ""}` : SECTION_LABEL[e.section] || e.section;
  const tone = e.status === "approved" ? "bg-gold-soft text-[#3E5438]" : e.status === "declined" ? "bg-rust-soft text-rust" : "bg-sand text-ink";
  return (
    <li className="rounded-control bg-paper px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-charcoal-soft">
        <span className="font-semibold text-charcoal">{where}</span>
        <span>· {e.proposerName || "a teacher"}{e.mine ? " (you)" : ""} · {fmtDate(e.createdAt)}</span>
        <span className={`ml-auto rounded-pill px-2 py-0.5 text-[11px] font-bold ${tone}`}>{e.status}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-charcoal">{e.proposed}</p>
      <p className="mt-1.5 text-[12px] text-charcoal-soft">
        <span className="font-semibold text-charcoal">Why:</span> {e.reason}
      </p>
      {e.status !== "pending" && (
        <p className="mt-1.5 text-[12px] text-charcoal-soft">
          {e.status === "approved" ? "Applied" : "Declined"} by {e.deciderName || "a reviewer"}
          {e.decidedAt ? ` on ${fmtDate(e.decidedAt)}` : ""}
          {e.decisionNote ? ` — ${e.decisionNote}` : ""}
        </p>
      )}
      {canReview && e.status === "pending" && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => onDecide(e, "approved")} disabled={pending} className="rounded-control bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-60">
            Approve and apply
          </button>
          <button type="button" onClick={() => onDecide(e, "declined")} disabled={pending} className="rounded-control border-[0.5px] border-line bg-white px-4 py-1.5 text-[12px] font-semibold text-charcoal hover:bg-paper-deep disabled:opacity-60">
            Decline
          </button>
        </div>
      )}
    </li>
  );
}
