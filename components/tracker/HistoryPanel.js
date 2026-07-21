"use client";

import { useEffect, useState } from "react";
import { getHistory } from "@/lib/actions/tracker";
import { surahByNumber } from "@/lib/quran/surah-list";
import { titleCase, fmtDate, gradePillClass } from "./util";

export default function HistoryPanel({ student, onClose, onLogToday }) {
  // This component is mounted with key={student.id}, so it remounts per
  // student and these initial states are the fresh loading state each time.
  const [lessons, setLessons] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    getHistory(student.id)
      .then((rows) => alive && setLessons(rows))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [student.id]);

  const surahsCovered = lessons
    ? [...new Set(lessons.filter((l) => l.surah).map((l) => l.surah))].map((n) => surahByNumber(n)?.name).filter(Boolean)
    : [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-paper shadow-2xl">
        <div className="flex items-start gap-3 border-b-[0.5px] border-line p-5">
          <div>
            <h2 className="font-heading text-lg font-semibold text-charcoal">{titleCase(student.name)}</h2>
            <p className="text-[12px] text-charcoal-soft">
              {(student.position || "") + (student.position ? " · " : "")}
              {student.class}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-charcoal-soft hover:bg-paper-deep"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {lessons === null && !error && <div className="py-10 text-center text-[13px] text-charcoal-soft">Loading history…</div>}
          {error && <div className="py-10 text-center text-[13px] text-rust">Couldn’t load history.</div>}

          {lessons && (
            <>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">Surahs covered</div>
              {surahsCovered.length ? (
                <div className="mb-5 flex flex-wrap gap-1.5">
                  {surahsCovered.map((n) => (
                    <span key={n} className="rounded-pill bg-paper-deep px-2.5 py-1 text-[12px] text-charcoal">
                      {n}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mb-5 text-[13px] text-charcoal-soft">None logged yet</div>
              )}

              <div className="mb-2 flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">Lesson history</div>
                <button
                  type="button"
                  onClick={() => onLogToday(student)}
                  className="rounded-pill bg-ink px-3 py-1 text-[11.5px] font-semibold text-paper hover:bg-ink-deep"
                >
                  + Log today
                </button>
              </div>

              {lessons.length === 0 && <div className="py-2 text-[13px] text-charcoal-soft">No lessons logged yet.</div>}
              <ul className="space-y-2.5">
                {lessons.map((l, i) => (
                  <li key={i} className="rounded-card border-[0.5px] border-line bg-white p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-charcoal-soft">{fmtDate(l.date)}</span>
                      {l.grade && (
                        <span className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${gradePillClass(l.grade)}`}>
                          {l.grade}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[14px] font-medium text-charcoal">{l.sabaq || "—"}</div>
                    {l.note && <div className="mt-1 text-[12.5px] text-charcoal-soft">{l.note}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}
