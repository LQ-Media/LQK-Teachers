"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startAssessment, deleteAssessment } from "@/lib/actions/assess";
import { initials, fmtDate } from "@/components/tracker/util";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";

const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

/**
 * An assessor's home: open a new observation, carry on with a draft, see what
 * they have submitted. Nothing here is visible to the teacher being assessed;
 * the page itself 404s for anyone without the flag (see requireAssessor).
 */
export default function AssessmentsHome({ teachers, mine, today, period, isAdmin }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [observedOn, setObservedOn] = useState(today);
  const [classLabel, setClassLabel] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const drafts = mine.filter((a) => a.status === "draft");
  const submitted = mine.filter((a) => a.status === "submitted");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teachers.slice(0, 8);
    return teachers
      .filter((t) => t.fullName.toLowerCase().includes(q) || t.branch.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, teachers]);
  const chosen = teachers.find((t) => t.id === teacherId) || null;

  function start() {
    setError("");
    startTransition(async () => {
      const r = await startAssessment({ teacherId, observedOn, classLabel });
      if (r?.error) {
        setError(r.error);
        return;
      }
      router.push(`/assessments/${r.id}`);
    });
  }

  function discard(a) {
    if (!confirm(`Discard the draft for ${a.teacherName}? Scores and notes will be lost.`)) return;
    startTransition(async () => {
      const r = await deleteAssessment(a.id);
      if (r?.error) alert(r.error);
      router.refresh();
    });
  }

  return (
    <div className="px-4 py-6 sm:p-8 max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <PageHeading
          icon="award"
          title="Assessments"
          subtitle={`${period.label} · observe a colleague, score the rubric, attach what you saw. Results go to admins only.`}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep"
        >
          <Icon name="plus" size={16} />
          New assessment
        </button>
      </div>

      {open && (
        <div className="mb-6 rounded-card border-[0.5px] border-line bg-white p-5">
          <h2 className="font-heading text-[16px] font-bold text-charcoal">Who did you observe?</h2>
          <p className="mt-0.5 text-[12px] text-charcoal-soft">
            Any teacher at any branch. You cannot assess yourself, or anyone who assessed you this semester.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="relative">
              <input
                className={field}
                placeholder="Search by name or branch…"
                value={chosen ? chosen.fullName : query}
                onChange={(e) => {
                  setTeacherId("");
                  setQuery(e.target.value);
                }}
                onFocus={() => chosen && setTeacherId("")}
                autoComplete="off"
              />
              {!chosen && (query || matches.length) ? (
                <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-card border-[0.5px] border-line bg-white py-1 shadow-lg">
                  {matches.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setTeacherId(t.id);
                          setQuery("");
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper-deep"
                      >
                        <Avatar src={t.avatar} name={t.fullName} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-charcoal">{t.fullName}</span>
                          <span className="block text-[11px] text-charcoal-soft">
                            {[t.position, t.branch].filter(Boolean).join(" · ") || "No branch set"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {!matches.length && <li className="px-3 py-2 text-[12px] text-charcoal-soft">No one matches.</li>}
                </ul>
              ) : null}
            </div>
            <input type="date" className={field} value={observedOn} max={today} onChange={(e) => setObservedOn(e.target.value)} />
          </div>
          <input
            className={`${field} mt-3`}
            placeholder="Class observed, e.g. Woods Square · 4YO Sat 10:15 (optional)"
            value={classLabel}
            onChange={(e) => setClassLabel(e.target.value)}
          />
          {error && <p className="mt-3 rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-control px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:text-charcoal">
              Cancel
            </button>
            <button
              type="button"
              onClick={start}
              disabled={pending || !teacherId}
              className="rounded-control bg-ink px-5 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
            >
              {pending ? "Opening…" : "Open the rubric"}
            </button>
          </div>
        </div>
      )}

      <Section title="In progress" count={drafts.length} empty="No drafts. Start one when you sit in on a lesson.">
        {drafts.map((a) => (
          <Row key={a.id} a={a} onDiscard={() => discard(a)} pending={pending} />
        ))}
      </Section>

      <Section title="Submitted" count={submitted.length} empty="Nothing submitted yet this year or last.">
        {submitted.map((a) => (
          <Row key={a.id} a={a} />
        ))}
      </Section>

      {isAdmin && (
        <p className="mt-6 text-[12px] text-charcoal-soft">
          Everyone&rsquo;s results, the November tracker and the CSV are under{" "}
          <Link href="/admin" className="font-semibold text-ink underline-offset-2 hover:underline">
            Admin → Assessments
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function Section({ title, count, empty, children }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2.5 font-heading text-[15px] font-bold text-charcoal">
        {title}
        {count ? <span className="ml-2 text-[12px] font-normal text-charcoal-soft">{count}</span> : null}
      </h2>
      {count ? (
        <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">{children}</div>
      ) : (
        <div className="rounded-card border border-dashed border-line bg-white/60 px-4 py-5 text-[13px] text-charcoal-soft">{empty}</div>
      )}
    </section>
  );
}

function Row({ a, onDiscard, pending }) {
  const done = a.status === "submitted";
  return (
    <div className="flex items-center gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <Link href={`/assessments/${a.id}`} className="block text-[13px] font-semibold text-charcoal hover:underline">
          {a.teacherName}
        </Link>
        <div className="text-[11.5px] text-charcoal-soft">
          {a.period} · observed {fmtDate(a.observedOn)}
          {a.classLabel ? ` · ${a.classLabel}` : ""}
          {a.teacherBranch ? ` · ${a.teacherBranch}` : ""}
        </div>
      </div>
      <span
        className={`rounded-pill px-2.5 py-1 text-[11px] font-bold ${
          done ? "bg-gold-soft text-[#3E5438]" : "bg-sand text-ink"
        }`}
      >
        {done ? "Submitted" : `${a.scored}/${a.total} scored`}
      </span>
      {!done && (
        <button
          type="button"
          aria-label="Discard draft"
          title="Discard draft"
          disabled={pending}
          onClick={onDiscard}
          className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-line bg-white text-charcoal-soft transition-colors hover:bg-rust-soft hover:text-rust disabled:opacity-40"
        >
          <Icon name="trash" size={14} />
        </button>
      )}
    </div>
  );
}

function Avatar({ src, name }) {
  return (
    <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-sand text-[11px] font-bold text-ink">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
