"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { writeClassReport, resendClassReport, deleteClassReport, saveChildDetails } from "@/lib/actions/classes";
import { fmtDate, initials } from "@/components/tracker/util";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";

const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

export default function ClassesApp({ initial, today, viewedName }) {
  const router = useRouter();
  const { configured, classes, reports, error, scope } = initial;
  const readOnly = !scope.own;
  const [openClass, setOpenClass] = useState(classes[0]?.id || null);
  const [reporting, setReporting] = useState(null); // class id
  const [editingChild, setEditingChild] = useState(null); // child id
  const [toast, setToast] = useState("");

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }

  const title = readOnly ? `${viewedName || "Teacher"}'s classes` : "My classes";
  const subtitle = readOnly
    ? "Read-only view for assessment: the roster as the teacher keeps it, and their last reports to parents."
    : "The children in your classes, from the parents portal. Keep each child's level current and write the report parents read after every lesson.";

  return (
    <div className="px-4 py-6 sm:p-8 max-w-4xl">
      <div className="mb-6">
        <PageHeading icon="graduation-cap" title={title} subtitle={subtitle} />
      </div>

      {!configured && (
        <Notice tone="warn">
          The link to the parents portal is not set up on this server, so classes cannot be shown yet. An admin sets
          <code className="mx-1 rounded bg-paper-deep px-1">LQK_PARENTS_URL</code> and
          <code className="mx-1 rounded bg-paper-deep px-1">LQK_PARENTS_TOKEN</code> on Railway.
        </Notice>
      )}
      {configured && error && <Notice tone="warn">{error}</Notice>}
      {configured && !error && classes.length === 0 && (
        <Notice>
          {readOnly
            ? "The parents portal lists no class for this teacher."
            : "The parents portal has no class with you as the teacher. Ask the office to put your portal email on your classes (Admin → Classes on the parents portal)."}
        </Notice>
      )}

      {classes.length > 0 && (
        <div className="space-y-3">
          {classes.map((c) => {
            const open = openClass === c.id;
            const classReports = reports.filter((r) => r.classId === c.id);
            return (
              <section key={c.id} className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
                <button
                  type="button"
                  onClick={() => setOpenClass(open ? null : c.id)}
                  className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left hover:bg-paper-deep/40"
                >
                  <div className="min-w-0 flex-1">
                    <h2 className="font-heading text-[16px] font-bold text-charcoal">{c.name}</h2>
                    <p className="text-[12px] text-charcoal-soft">
                      {[c.centre, c.unit, c.room, c.when, c.programme].filter(Boolean).join(" · ")}
                      {c.year ? ` · ${c.year}` : ""}
                    </p>
                  </div>
                  <span className="rounded-pill bg-paper-deep px-2.5 py-1 text-[11px] font-bold text-charcoal-soft">
                    {c.children.length} {c.children.length === 1 ? "child" : "children"}
                  </span>
                  <Icon name={open ? "chevron-down" : "chevron-right"} size={16} />
                </button>

                {open && (
                  <div className="border-t-[0.5px] border-line">
                    {!readOnly && (
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-paper/60 px-5 py-3">
                        <p className="text-[12px] text-charcoal-soft">
                          {classReports.length
                            ? `Last report ${fmtDate(classReports[0].lessonDate)}.`
                            : "No report written for this class yet."}
                        </p>
                        <button
                          type="button"
                          onClick={() => setReporting(reporting === c.id ? null : c.id)}
                          className="flex items-center gap-2 rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep"
                        >
                          <Icon name="pencil" size={14} />
                          After-lesson report
                        </button>
                      </div>
                    )}

                    {reporting === c.id && !readOnly && (
                      <ReportForm
                        cls={c}
                        today={today}
                        onDone={(r) => {
                          setReporting(null);
                          flash(r.warning ? `Saved, but not sent yet: ${r.warning}` : `Sent to ${r.sent} ${r.sent === 1 ? "family" : "families"}.`);
                          router.refresh();
                        }}
                      />
                    )}

                    {c.children.length === 0 ? (
                      <p className="px-5 py-4 text-[13px] text-charcoal-soft">No confirmed children in this class yet.</p>
                    ) : (
                      <ul>
                        {c.children.map((k) => (
                          <li key={k.id} className="border-t-[0.5px] border-line px-5 py-3 first:border-0">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-sand text-[11px] font-bold text-ink">
                                {initials(k.fullName)}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-[13px] font-semibold text-charcoal">
                                  {k.fullName}
                                  {k.lqkNumber ? <span className="ml-2 text-[11px] font-normal text-charcoal-soft">#{k.lqkNumber}</span> : null}
                                </div>
                                <div className="text-[11.5px] text-charcoal-soft">
                                  {k.level ? <span className="text-charcoal">{k.level}</span> : <span className="italic">level not set</span>}
                                  {k.medicalNotes ? <span className="ml-2 rounded-pill bg-rust-soft px-1.5 py-0.5 text-[10px] font-bold text-rust">⚕ {k.medicalNotes}</span> : null}
                                </div>
                                {k.teacherNotes ? <p className="mt-1 text-[12px] text-charcoal-soft">{k.teacherNotes}</p> : null}
                              </div>
                              {!readOnly && (
                                <button
                                  type="button"
                                  onClick={() => setEditingChild(editingChild === k.id ? null : k.id)}
                                  className="rounded-control border-[0.5px] border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-charcoal hover:bg-paper-deep"
                                >
                                  {editingChild === k.id ? "Close" : "Edit"}
                                </button>
                              )}
                            </div>
                            {editingChild === k.id && !readOnly && (
                              <ChildForm
                                cls={c}
                                child={k}
                                onDone={() => {
                                  setEditingChild(null);
                                  flash(`${k.shortName || k.fullName} updated.`);
                                  router.refresh();
                                }}
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <ReportsList reports={reports} readOnly={readOnly} onChanged={() => router.refresh()} flash={flash} />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-pill bg-charcoal px-5 py-2.5 text-[14px] text-paper shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function Notice({ children, tone }) {
  return (
    <div
      className={`mb-4 rounded-card border-[0.5px] border-line px-4 py-3 text-[13px] ${
        tone === "warn" ? "bg-rust-soft text-[#8E3A24]" : "bg-white text-charcoal-soft"
      }`}
    >
      {children}
    </div>
  );
}

function ReportForm({ cls, today, onDone }) {
  const [lessonDate, setLessonDate] = useState(today);
  const [portion, setPortion] = useState("");
  const [went, setWent] = useState("");
  const [practise, setPractise] = useState("");
  const [lines, setLines] = useState({});
  const [showLines, setShowLines] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    setError("");
    startTransition(async () => {
      const perChild = cls.children.filter((k) => lines[k.id]?.trim()).map((k) => ({ childId: k.id, name: k.shortName || k.fullName, line: lines[k.id] }));
      const r = await writeClassReport({ classId: cls.id, lessonDate, portion, went, practise, perChild });
      if (r?.error) {
        setError(r.error);
        return;
      }
      onDone(r);
    });
  }

  return (
    <div className="border-t-[0.5px] border-line bg-paper/60 px-5 py-4">
      <p className="mb-3 text-[12px] text-charcoal-soft">
        Parents read this the same evening under &ldquo;{cls.children[0]?.shortName || "their child"}&rsquo;s week&rdquo;. Say what you covered, how the class went, and one thing to practise at home. Plain words, no jargon.
      </p>
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <input type="date" className={field} value={lessonDate} max={today} onChange={(e) => setLessonDate(e.target.value)} />
        <input className={field} placeholder="What was covered, e.g. Al-Fil 1–5, or Iqra' 2 p.14" value={portion} onChange={(e) => setPortion(e.target.value)} />
      </div>
      <textarea
        className={`${field} mt-3 min-h-[88px] resize-y`}
        placeholder="How the class went. What went well, what was tricky."
        value={went}
        onChange={(e) => setWent(e.target.value)}
      />
      <input className={`${field} mt-3`} placeholder="One thing to practise at home (optional)" value={practise} onChange={(e) => setPractise(e.target.value)} />

      {cls.children.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowLines((s) => !s)} className="text-[12px] font-semibold text-charcoal-soft underline-offset-2 hover:text-charcoal hover:underline">
            {showLines ? "Hide per-child lines" : "Add a line for a particular child"}
          </button>
          {showLines && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {cls.children.map((k) => (
                <label key={k.id} className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">{k.shortName || k.fullName}</span>
                  <input className={field} placeholder="Only their family sees this" value={lines[k.id] || ""} onChange={(e) => setLines((l) => ({ ...l, [k.id]: e.target.value }))} />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !went.trim()}
          className="rounded-control bg-ink px-5 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
        >
          {pending ? "Sending…" : `Send to ${cls.children.length} ${cls.children.length === 1 ? "family" : "families"}`}
        </button>
      </div>
    </div>
  );
}

function ChildForm({ cls, child, onDone }) {
  const [level, setLevel] = useState(child.level || "");
  const [notes, setNotes] = useState(child.teacherNotes || "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    setError("");
    startTransition(async () => {
      const r = await saveChildDetails({ classId: cls.id, childId: child.id, level, teacherNotes: notes });
      if (r?.error) {
        setError(r.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="mt-3 grid gap-2 rounded-control bg-paper px-3 py-3 sm:grid-cols-[1fr_2fr_auto]">
      <input className={field} placeholder="Level, e.g. Iqra' 2 · p.14" value={level} onChange={(e) => setLevel(e.target.value)} />
      <input className={field} placeholder="Your notes — never shown to parents" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button type="button" onClick={save} disabled={pending} className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
      {error && <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust sm:col-span-3">{error}</p>}
    </div>
  );
}

function ReportsList({ reports, readOnly, onChanged, flash }) {
  const [pending, startTransition] = useTransition();
  if (!reports.length) return null;

  function resend(r) {
    startTransition(async () => {
      const res = await resendClassReport(r.id);
      if (res?.error) flash(`Still not sent: ${res.error}`);
      else flash(`Sent to ${res.sent} ${res.sent === 1 ? "family" : "families"}.`);
      onChanged();
    });
  }
  function remove(r) {
    if (!confirm("Delete this unsent report?")) return;
    startTransition(async () => {
      const res = await deleteClassReport(r.id);
      if (res?.error) flash(res.error);
      onChanged();
    });
  }

  return (
    <section className="mt-8">
      <h2 className="mb-2.5 font-heading text-[15px] font-bold text-charcoal">
        {readOnly ? "Recent reports" : "Your recent reports"}
        <span className="ml-2 text-[12px] font-normal text-charcoal-soft">{reports.length}</span>
      </h2>
      <ul className="space-y-2">
        {reports.map((r) => (
          <li key={r.id} className="rounded-card border-[0.5px] border-line bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-charcoal">{fmtDate(r.lessonDate)}</span>
              <span className="text-[12px] text-charcoal-soft">
                {r.className}
                {r.portion ? ` · ${r.portion}` : ""}
              </span>
              {r.sentAt ? (
                <span className="ml-auto rounded-pill bg-gold-soft px-2 py-0.5 text-[11px] font-bold text-[#3E5438]">Sent</span>
              ) : (
                <span className="ml-auto flex items-center gap-2">
                  <span className="rounded-pill bg-rust-soft px-2 py-0.5 text-[11px] font-bold text-rust" title={r.sendError}>
                    Not sent
                  </span>
                  {!readOnly && (
                    <>
                      <button type="button" onClick={() => resend(r)} disabled={pending} className="text-[12px] font-semibold text-charcoal hover:underline">
                        Resend
                      </button>
                      <button type="button" onClick={() => remove(r)} disabled={pending} className="text-[12px] font-semibold text-charcoal-soft hover:text-rust">
                        Delete
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-charcoal">{r.went}</p>
            {r.practise && (
              <p className="mt-1 text-[12.5px] text-charcoal-soft">
                <span className="font-semibold text-charcoal">At home:</span> {r.practise}
              </p>
            )}
            {r.perChild.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-[12px] text-charcoal-soft">
                {r.perChild.map((p) => (
                  <li key={p.childId}>
                    <span className="font-semibold text-charcoal">{p.name}:</span> {p.line}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
