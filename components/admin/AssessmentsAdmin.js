"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { assessmentsAdminData, logReview, deleteReview, deleteAssessment } from "@/lib/actions/assess";
import { CRITERIA, DOMAINS, LEVELS } from "@/lib/assess/rubric";
import { fmtDate, initials } from "@/components/tracker/util";
import Icon from "@/components/Icon";

const field =
  "bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

const DEADLINE = {
  done: { label: "On file", tone: "bg-gold-soft text-[#3E5438]" },
  open: { label: "None yet", tone: "bg-paper-deep text-charcoal-soft" },
  chase: { label: "Chase · due 30 Nov", tone: "bg-rust-soft text-rust" },
  missed: { label: "Missed", tone: "bg-rust text-paper" },
};

/**
 * Admin → Assessments. Three views for one year: the November tracker, every
 * teacher's results (S1 beside S2, each assessor listed), and the verbal
 * review log. The CSV button is the same data, one row per score.
 */
export default function AssessmentsAdmin({ initial }) {
  const router = useRouter();
  const [data, setData] = useState(initial.data);
  const [years] = useState(initial.years);
  const [view, setView] = useState("tracker");
  const [openId, setOpenId] = useState(null);
  const [busy, startTransition] = useTransition();

  function loadYear(y) {
    startTransition(async () => {
      setData(await assessmentsAdminData(y));
      setOpenId(null);
    });
  }
  function reload() {
    loadYear(data.year);
    router.refresh();
  }

  const { counts, teachers } = data;
  const chase = teachers.filter((t) => t.deadline === "chase" || t.deadline === "missed");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className={field} value={data.year} onChange={(e) => loadYear(Number(e.target.value))} disabled={busy}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <div className="flex gap-1 rounded-control bg-paper-deep p-1">
            {[
              ["tracker", "November tracker"],
              ["results", "Results"],
              ["reviews", "Verbal reviews"],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setView(k)}
                className={`rounded-control px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  view === k ? "bg-white text-ink shadow-sm" : "text-charcoal-soft hover:text-charcoal"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <a
          href={`/api/assessments/export?year=${data.year}`}
          className="flex items-center gap-2 rounded-control border-[0.5px] border-line bg-white px-3.5 py-2 text-[12.5px] font-semibold text-charcoal hover:bg-paper-deep"
        >
          <Icon name="download" size={14} />
          CSV {data.year}
        </a>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Teachers" value={counts.teachers} />
        <Stat label="At least one on file" value={counts.done} />
        <Stat label="To chase" value={counts.chase} tone={counts.chase ? "text-rust" : ""} />
        <Stat label="Submitted this year" value={counts.submitted} sub={counts.drafts ? `${counts.drafts} draft${counts.drafts === 1 ? "" : "s"} open` : ""} />
      </div>

      {view === "tracker" && (
        <Tracker teachers={teachers} chase={chase} today={data.today} year={data.year} assessors={data.assessors} />
      )}
      {view === "results" && (
        <Results teachers={teachers} target={data.target} openId={openId} setOpenId={setOpenId} onChanged={reload} busy={busy} />
      )}
      {view === "reviews" && <Reviews teachers={teachers} year={data.year} today={data.today} onChanged={reload} busy={busy} />}
    </div>
  );
}

function Stat({ label, value, sub, tone = "" }) {
  return (
    <div className="rounded-card border-[0.5px] border-line bg-white p-[14px]">
      <div className="text-[11px] font-semibold text-charcoal-soft">{label}</div>
      <div className={`mt-1 font-heading text-[22px] font-bold leading-none text-charcoal tabular-nums ${tone}`}>{value}</div>
      {sub ? <div className="mt-1 text-[11px] text-charcoal-soft">{sub}</div> : null}
    </div>
  );
}

function Person({ t }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-sand text-[11px] font-bold text-ink">
        {t.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          initials(t.fullName)
        )}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-charcoal">
          {t.fullName}
          {t.isAssessor && <span className="ml-1.5 rounded-pill bg-sand px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink">Assessor</span>}
        </div>
        <div className="text-[11px] text-charcoal-soft">{[t.position, t.branch].filter(Boolean).join(" · ") || "No branch"}</div>
      </div>
    </div>
  );
}

// ---- November tracker --------------------------------------------------

function Tracker({ teachers, chase, today, year, assessors }) {
  const month = Number(today.slice(5, 7));
  const thisYear = Number(today.slice(0, 4)) === year;
  const intro = !thisYear
    ? `Who was assessed in ${year}, and who was missed.`
    : month < 10
      ? "From 1 October anyone with nothing on file is listed here in red. Every teacher needs at least one submitted assessment by 30 November."
      : "Everyone below needs an assessment before 30 November. Pair them with an assessor at their branch, or any branch.";

  const list = thisYear && month < 10 ? teachers.filter((t) => t.deadline !== "done") : chase;

  return (
    <div>
      <p className="mb-3 text-[12.5px] text-charcoal-soft">{intro}</p>
      {list.length === 0 ? (
        <div className="rounded-card border-[0.5px] border-line bg-white p-8 text-center">
          <div className="mb-1 text-2xl text-sage">✓</div>
          <div className="text-[13px] font-semibold text-sage">Everyone has at least one assessment on file for {year}.</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
          {list.map((t) => {
            const d = DEADLINE[t.deadline];
            const nearby = assessors.filter((a) => a.id !== t.id && a.branch && a.branch === t.branch);
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0">
                <div className="min-w-[220px] flex-1">
                  <Person t={t} />
                </div>
                <div className="flex-1 text-[11.5px] text-charcoal-soft">
                  {nearby.length ? (
                    <>
                      Assessors at {t.branch}: <span className="text-charcoal">{nearby.map((a) => a.fullName).join(", ")}</span>
                    </>
                  ) : (
                    "No assessor at this branch — any assessor may take it."
                  )}
                </div>
                <span className={`rounded-pill px-2.5 py-1 text-[11px] font-bold ${d.tone}`}>{d.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Results -----------------------------------------------------------

function Results({ teachers, target, openId, setOpenId, onChanged, busy }) {
  const withResults = teachers.filter((t) => t.assessments.length > 0);
  if (!withResults.length) {
    return <div className="rounded-card border border-dashed border-line bg-white/60 px-4 py-6 text-[13px] text-charcoal-soft">No assessments this year yet.</div>;
  }
  return (
    <div className="space-y-2">
      {withResults.map((t) => {
        const open = openId === t.id;
        return (
          <div key={t.id} className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
            <button type="button" onClick={() => setOpenId(open ? null : t.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-paper-deep/40">
              <div className="min-w-[220px] flex-1">
                <Person t={t} />
              </div>
              <div className="flex items-center gap-2 text-[11.5px] text-charcoal-soft">
                <Pill>{t.s1Count} in S1</Pill>
                <Pill>{t.s2Count} in S2</Pill>
                {t.scoredCriteria ? (
                  <Pill tone={t.atBar === t.scoredCriteria ? "bg-gold-soft text-[#3E5438]" : "bg-sand text-ink"}>
                    {t.atBar}/{t.scoredCriteria} at bar (S2)
                  </Pill>
                ) : null}
                {t.review ? <Pill tone="bg-gold-soft text-[#3E5438]">Reviewed {fmtDate(t.review.reviewedOn)}</Pill> : null}
              </div>
              <Icon name={open ? "chevron-down" : "chevron-right"} size={16} />
            </button>
            {open && <TeacherDetail t={t} target={target} onChanged={onChanged} busy={busy} />}
          </div>
        );
      })}
    </div>
  );
}

function Pill({ children, tone = "bg-paper-deep text-charcoal-soft" }) {
  return <span className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${tone}`}>{children}</span>;
}

function TeacherDetail({ t, target, onChanged, busy }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  function remove(a) {
    if (!confirm(`Delete ${a.assessorName || "this"} assessment of ${t.fullName} (${fmtDate(a.observedOn)})? This cannot be undone.`)) return;
    startTransition(async () => {
      const r = await deleteAssessment(a.id);
      if (r?.error) alert(r.error);
      onChanged();
      router.refresh();
    });
  }
  return (
    <div className="border-t-[0.5px] border-line">
      {/* The observations */}
      <div className="px-4 py-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">Observations</div>
        <ul className="space-y-1.5">
          {t.assessments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-[12.5px] text-charcoal">
              <Link href={`/assessments/${a.id}`} className="font-semibold hover:underline">
                {fmtDate(a.observedOn)}
              </Link>
              <span className="text-charcoal-soft">
                S{a.semester} · by {a.assessorName || "—"}
                {a.classLabel ? ` · ${a.classLabel}` : ""}
              </span>
              <Pill tone={a.status === "submitted" ? "bg-gold-soft text-[#3E5438]" : "bg-sand text-ink"}>{a.status}</Pill>
              <button type="button" onClick={() => remove(a)} disabled={busy} className="ml-auto text-[11px] font-semibold text-charcoal-soft hover:text-rust">
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* The matrix */}
      <div className="overflow-x-auto border-t-[0.5px] border-line">
        <table className="w-full min-w-[640px] text-left text-[12.5px]">
          <thead>
            <tr className="border-b-[0.5px] border-line text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">
              <th className="px-4 py-2.5">Criterion</th>
              <th className="px-3 py-2.5">Semester 1 · progress</th>
              <th className="px-3 py-2.5">Semester 2 · final</th>
            </tr>
          </thead>
          <tbody>
            {DOMAINS.map((d) => (
              <DomainRows key={d.key} d={d} view={t.view} target={target} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Overall notes */}
      {t.assessments.some((a) => a.overallNote) && (
        <div className="border-t-[0.5px] border-line px-4 py-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">Assessor notes</div>
          <ul className="space-y-2">
            {t.assessments
              .filter((a) => a.overallNote)
              .map((a) => (
                <li key={a.id} className="rounded-control bg-paper-deep px-3 py-2 text-[12.5px] text-charcoal">
                  <span className="font-semibold">
                    {a.assessorName || "—"} · S{a.semester} · {fmtDate(a.observedOn)}:
                  </span>{" "}
                  <span className="whitespace-pre-wrap">{a.overallNote}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DomainRows({ d, view, target }) {
  const rows = CRITERIA.filter((c) => c.domain === d.key);
  return (
    <>
      <tr className="bg-paper-deep/60">
        <td colSpan={3} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">
          {d.key} · {d.name}
        </td>
      </tr>
      {rows.map((c) => {
        const v = view[c.key] || { s1: [], s2: [] };
        return (
          <tr key={c.key} className="border-b-[0.5px] border-line last:border-0">
            <td className="px-4 py-2">
              <span className="mr-2 text-[11px] font-bold text-charcoal-soft">{c.key}</span>
              {c.name}
            </td>
            <td className="px-3 py-2">
              <Levels scores={v.s1} target={target} />
            </td>
            <td className="px-3 py-2">
              <Levels scores={v.s2} target={target} />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function Levels({ scores, target }) {
  if (!scores.length) return <span className="text-charcoal-soft">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {scores.map((s, i) => (
        <span
          key={i}
          title={`${LEVELS[s.level - 1]?.name || s.level} · ${s.assessor}`}
          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-control px-1.5 font-heading text-[12px] font-bold ${
            s.level >= target ? "bg-gold-soft text-[#3E5438]" : "bg-rust-soft text-rust"
          }`}
        >
          {s.level}
        </span>
      ))}
    </span>
  );
}

// ---- Verbal reviews ----------------------------------------------------

function Reviews({ teachers, year, today, onChanged, busy }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(null); // teacherId
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");

  function open(t) {
    setEditing(t.id);
    setDate(t.review?.reviewedOn || today);
    setNote(t.review?.note || "");
  }
  function save(t) {
    startTransition(async () => {
      const r = await logReview({ teacherId: t.id, year, reviewedOn: date, note });
      if (r?.error) {
        alert(r.error);
        return;
      }
      setEditing(null);
      onChanged();
      router.refresh();
    });
  }
  function clear(t) {
    if (!confirm(`Remove the logged review for ${t.fullName}?`)) return;
    startTransition(async () => {
      await deleteReview({ teacherId: t.id, year });
      onChanged();
      router.refresh();
    });
  }

  const list = teachers.filter((t) => t.submittedCount > 0 || t.review);
  return (
    <div>
      <p className="mb-3 text-[12.5px] text-charcoal-soft">
        Results are never shown to the teacher in the portal. When you have talked the year through with them in person, log it here — that closes {year} for them.
      </p>
      {list.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-white/60 px-4 py-6 text-[13px] text-charcoal-soft">Nobody has a result to review yet.</div>
      ) : (
        <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
          {list.map((t) => (
            <div key={t.id} className="border-b-[0.5px] border-line px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[220px] flex-1">
                  <Person t={t} />
                </div>
                {t.review ? (
                  <span className="text-[12px] text-charcoal-soft">
                    Reviewed {fmtDate(t.review.reviewedOn)}
                    {t.review.reviewerName ? ` by ${t.review.reviewerName}` : ""}
                  </span>
                ) : (
                  <span className="text-[12px] text-charcoal-soft">{t.submittedCount} assessment{t.submittedCount === 1 ? "" : "s"} · not yet discussed</span>
                )}
                <button type="button" onClick={() => (editing === t.id ? setEditing(null) : open(t))} className="rounded-control border-[0.5px] border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-charcoal hover:bg-paper-deep">
                  {t.review ? "Edit" : "Log review"}
                </button>
                {t.review && (
                  <button type="button" onClick={() => clear(t)} disabled={busy} className="text-[12px] font-semibold text-charcoal-soft hover:text-rust">
                    Remove
                  </button>
                )}
              </div>
              {t.review?.note && editing !== t.id && (
                <p className="mt-2 whitespace-pre-wrap rounded-control bg-paper-deep px-3 py-2 text-[12.5px] text-charcoal">{t.review.note}</p>
              )}
              {editing === t.id && (
                <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto]">
                  <input type="date" className={field} value={date} max={today} onChange={(e) => setDate(e.target.value)} />
                  <textarea className={`${field} min-h-[72px]`} placeholder="What was discussed, what was agreed" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button type="button" onClick={() => save(t)} disabled={busy} className="self-start rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-60">
                    Save
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
