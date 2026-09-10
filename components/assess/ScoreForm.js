"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveDraft, submitAssessment, deleteAssessment } from "@/lib/actions/assess";
import { fmtDate, initials } from "@/components/tracker/util";
import Icon from "@/components/Icon";
import EvidencePanel from "./EvidencePanel";

const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

const DOMAIN_TONE = {
  A: "bg-sand",
  B: "bg-gold-soft",
  C: "bg-sage-soft",
  D: "bg-paper-deep",
};

/**
 * The scoring form. One screen, four domains, sixteen criteria, each with the
 * five descriptors inline so the assessor reads the bar while choosing.
 *
 * Saves itself a second after the last change (a phone in a classroom loses
 * signal), and again on submit. Read-only once submitted, or when an admin is
 * looking at someone else's draft.
 */
export default function ScoreForm({ initial, domains, levels, target, rubricVersion, today }) {
  const router = useRouter();
  const editable = initial.canEdit;
  const [scores, setScores] = useState(initial.scores);
  const [observedOn, setObservedOn] = useState(initial.observedOn);
  const [classLabel, setClassLabel] = useState(initial.classLabel);
  const [overallNote, setOverallNote] = useState(initial.overallNote);
  const [expanded, setExpanded] = useState(() => new Set());
  const [saveState, setSaveState] = useState({ status: "idle", at: null, error: "" });
  const [pending, startTransition] = useTransition();
  const dirty = useRef(false);
  const timer = useRef(null);

  const payload = () => ({ id: initial.id, scores, observedOn, classLabel, overallNote });

  // Debounced autosave. Runs only when something actually changed.
  useEffect(() => {
    if (!editable || !dirty.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaveState((s) => ({ ...s, status: "saving", error: "" }));
      saveDraft(payload()).then((r) => {
        if (r?.error) setSaveState({ status: "error", at: null, error: r.error });
        else setSaveState({ status: "saved", at: r.savedAt, error: "" });
      });
    }, 900);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, observedOn, classLabel, overallNote, editable]);

  function mark() {
    dirty.current = true;
  }
  function setLevel(key, level) {
    mark();
    setScores((s) => {
      const cur = s[key] || { level: null, note: "" };
      // Tapping the chosen level again clears it: "not observed" is a state.
      return { ...s, [key]: { ...cur, level: cur.level === level ? null : level } };
    });
  }
  function setNote(key, note) {
    mark();
    setScores((s) => ({ ...s, [key]: { ...(s[key] || { level: null }), note } }));
  }
  function toggleExpanded(key) {
    setExpanded((set) => {
      const next = new Set(set);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const scoredCount = Object.values(scores).filter((s) => s?.level).length;
  const total = domains.reduce((n, d) => n + d.criteria.length, 0);

  function submit() {
    if (
      !confirm(
        `Submit this assessment of ${initial.teacher.fullName}?\n\n${scoredCount} of ${total} criteria scored. ` +
          "Once submitted it cannot be edited. Only admins will see it."
      )
    )
      return;
    clearTimeout(timer.current);
    startTransition(async () => {
      const r = await submitAssessment(payload());
      if (r?.error) {
        setSaveState({ status: "error", at: null, error: r.error });
        return;
      }
      router.push("/assessments");
      router.refresh();
    });
  }

  function remove() {
    const what = initial.status === "submitted" ? "Delete this submitted assessment? This cannot be undone." : "Discard this draft?";
    if (!confirm(what)) return;
    startTransition(async () => {
      const r = await deleteAssessment(initial.id);
      if (r?.error) {
        alert(r.error);
        return;
      }
      router.push(initial.isAdmin && initial.status === "submitted" ? "/admin" : "/assessments");
      router.refresh();
    });
  }

  return (
    <div className="px-4 py-6 sm:p-8 max-w-4xl">
      <Link
        href="/assessments"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-charcoal-soft transition-colors hover:text-charcoal"
      >
        <Icon name="arrow-left" size={15} />
        Assessments
      </Link>

      {/* Header card: who, when, which class. */}
      <div className="rounded-card border-[0.5px] border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full bg-sand text-[14px] font-bold text-ink">
              {initial.teacher.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={initial.teacher.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                initials(initial.teacher.fullName)
              )}
            </span>
            <div>
              <h1 className="font-heading text-xl font-semibold leading-tight text-charcoal">{initial.teacher.fullName}</h1>
              <p className="text-[12px] text-charcoal-soft">
                {[initial.teacher.position, initial.teacher.branch].filter(Boolean).join(" · ") || "No branch set"} ·{" "}
                {initial.period}
                {initial.assessorName && !initial.isOwner ? ` · assessed by ${initial.assessorName}` : ""}
              </p>
            </div>
          </div>
          <StatusBadge status={initial.status} saveState={saveState} editable={editable} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Observed on</span>
            {editable ? (
              <input
                type="date"
                className={field}
                value={observedOn}
                max={today}
                onChange={(e) => {
                  mark();
                  setObservedOn(e.target.value);
                }}
              />
            ) : (
              <p className="text-[13px] text-charcoal">{fmtDate(observedOn)}</p>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Class observed</span>
            {editable ? (
              <input
                className={field}
                value={classLabel}
                placeholder="e.g. Woods Square · 4YO Sat 10:15"
                onChange={(e) => {
                  mark();
                  setClassLabel(e.target.value);
                }}
              />
            ) : (
              <p className="text-[13px] text-charcoal">{classLabel || "—"}</p>
            )}
          </label>
        </div>

        {initial.outdatedRubric && (
          <p className="mt-3 rounded-control bg-paper-deep px-3 py-2 text-[12px] text-charcoal">
            Scored against rubric version {initial.rubricVersion}; the current wording is version {rubricVersion}. The
            descriptors shown are today&rsquo;s.
          </p>
        )}
      </div>

      {/* Scale legend */}
      <div className="mt-4 grid gap-2 sm:grid-cols-5">
        {levels.map((l) => (
          <div key={l.level} className="rounded-control border-[0.5px] border-line bg-white px-3 py-2">
            <div className="flex items-center gap-2">
              <LevelDot level={l.level} target={target} />
              <span className="font-heading text-[13px] font-bold text-charcoal">{l.name}</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-charcoal-soft">{l.short}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-charcoal-soft">
        Level {target} is the bar for every tier. Score only what you saw or read on the day; leave the rest unscored.
        Tap a chosen level again to clear it.
      </p>

      {/* Domains */}
      {domains.map((d) => (
        <section key={d.key} className="mt-6 overflow-hidden rounded-card border-[0.5px] border-line bg-white">
          <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 ${DOMAIN_TONE[d.key]}`}>
            <h2 className="font-heading text-[15px] font-bold text-charcoal">
              <span className="mr-2 text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">{d.key}</span>
              {d.name}
            </h2>
            <p className="text-[11.5px] text-charcoal-soft">{d.evidence}</p>
          </div>

          {d.criteria.map((c) => {
            const s = scores[c.key] || { level: null, note: "" };
            const showAll = expanded.has(c.key);
            const current = s.level ? c.levels[s.level - 1] : null;
            return (
              <div key={c.key} className="border-t-[0.5px] border-line px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold tracking-wide text-charcoal-soft">
                      {c.key} · skill {c.skill}
                    </span>
                    <h3 className="font-heading text-[15px] font-bold leading-tight text-charcoal">{c.name}</h3>
                    <p className="mt-0.5 text-[12px] text-charcoal-soft">
                      {c.how}
                      {c.domain === "A" && (c.key === "A1" || c.key === "A2") && (
                        <>
                          {" "}
                          <Link href={`/classes?teacher=${initial.teacher.id}`} target="_blank" className="font-semibold text-ink underline-offset-2 hover:underline">
                            Open their classes
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(c.key)}
                    className="text-[12px] font-semibold text-charcoal-soft underline-offset-2 hover:text-charcoal hover:underline"
                  >
                    {showAll ? "Hide levels" : "All five levels"}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {levels.map((l) => {
                    const on = s.level === l.level;
                    return (
                      <button
                        key={l.level}
                        type="button"
                        disabled={!editable}
                        onClick={() => setLevel(c.key, l.level)}
                        aria-pressed={on}
                        title={l.name}
                        className={`flex items-center gap-1.5 rounded-pill border-[0.5px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-default ${
                          on
                            ? "border-ink bg-ink text-paper"
                            : "border-line bg-paper text-charcoal hover:bg-paper-deep disabled:hover:bg-paper"
                        } ${l.level === target && !on ? "ring-1 ring-gold/60" : ""}`}
                      >
                        <span className="font-heading text-[13px] font-bold">{l.level}</span>
                        <span className="hidden sm:inline">{l.name}</span>
                      </button>
                    );
                  })}
                </div>

                {showAll ? (
                  <ol className="mt-3 space-y-1.5">
                    {c.levels.map((text, i) => (
                      <li
                        key={i}
                        className={`flex gap-2.5 rounded-control px-3 py-2 text-[12.5px] leading-snug ${
                          s.level === i + 1 ? "bg-ink text-paper" : i + 1 === target ? "bg-sand/60 text-charcoal" : "bg-paper text-charcoal"
                        }`}
                      >
                        <span className="font-heading font-bold">{i + 1}</span>
                        <span>{text}</span>
                      </li>
                    ))}
                  </ol>
                ) : current ? (
                  <p className="mt-3 rounded-control bg-paper px-3 py-2 text-[12.5px] leading-snug text-charcoal">
                    <span className="font-heading font-bold">{s.level} </span>
                    {current}
                  </p>
                ) : (
                  <p className="mt-3 rounded-control bg-sand/60 px-3 py-2 text-[12.5px] leading-snug text-charcoal">
                    <span className="font-heading font-bold">{target} · the bar </span>
                    {c.levels[target - 1]}
                  </p>
                )}

                {editable ? (
                  <textarea
                    className={`${field} mt-3 min-h-[64px] resize-y`}
                    placeholder="What you saw, in a sentence or two (optional)"
                    value={s.note || ""}
                    onChange={(e) => setNote(c.key, e.target.value)}
                  />
                ) : s.note ? (
                  <p className="mt-3 rounded-control bg-paper-deep px-3 py-2 text-[12.5px] text-charcoal">{s.note}</p>
                ) : null}
              </div>
            );
          })}

          {d.kinds.length > 0 && (
            <EvidencePanel
              assessmentId={initial.id}
              domainKey={d.key}
              kinds={d.kinds}
              criteria={d.criteria}
              items={initial.evidence.filter((e) => d.criteria.some((c) => c.key === e.criterionKey) || (!e.criterionKey && d.key === "C"))}
              editable={editable}
              isAdmin={initial.isAdmin}
            />
          )}
        </section>
      ))}

      {/* Overall note + actions */}
      <div className="mt-6 rounded-card border-[0.5px] border-line bg-white p-5">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Overall note for admins</span>
          {editable ? (
            <textarea
              className={`${field} min-h-[96px] resize-y`}
              placeholder="The picture in a paragraph: strengths, the one thing to work on, anything the rubric could not capture."
              value={overallNote}
              onChange={(e) => {
                mark();
                setOverallNote(e.target.value);
              }}
            />
          ) : (
            <p className="whitespace-pre-wrap text-[13px] text-charcoal">{overallNote || "—"}</p>
          )}
        </label>

        {saveState.error && (
          <p className="mt-3 rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{saveState.error}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-charcoal-soft">
            {scoredCount} of {total} criteria scored
          </span>
          <div className="flex items-center gap-2">
            {(editable || initial.isAdmin) && (
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="rounded-control px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:text-rust"
              >
                {initial.status === "submitted" ? "Delete" : "Discard"}
              </button>
            )}
            {editable && (
              <button
                type="button"
                onClick={submit}
                disabled={pending || scoredCount === 0}
                className="rounded-control bg-ink px-5 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
              >
                {pending ? "Submitting…" : "Submit assessment"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, saveState, editable }) {
  if (status === "submitted") {
    return <span className="rounded-pill bg-gold-soft px-3 py-1 text-[11px] font-bold text-[#3E5438]">Submitted</span>;
  }
  if (!editable) return <span className="rounded-pill bg-paper-deep px-3 py-1 text-[11px] font-bold text-charcoal-soft">Draft · read only</span>;
  const text =
    saveState.status === "saving"
      ? "Saving…"
      : saveState.status === "saved"
        ? "Saved"
        : saveState.status === "error"
          ? "Not saved"
          : "Draft";
  const tone = saveState.status === "error" ? "bg-rust-soft text-rust" : "bg-sand text-ink";
  return <span className={`rounded-pill px-3 py-1 text-[11px] font-bold ${tone}`}>{text}</span>;
}

function LevelDot({ level, target }) {
  return (
    <span
      className={`inline-flex h-6 w-6 flex-none items-center justify-center rounded-control font-heading text-[12px] font-bold ${
        level === target ? "bg-ink text-paper" : "bg-paper-deep text-charcoal"
      }`}
    >
      {level}
    </span>
  );
}
