"use client";

import { useState } from "react";
import { getRoster } from "@/lib/actions/tracker";
import { surahByNumber } from "@/lib/quran/surah-list";
import { titleCase, initials, fmtDate, sgTodayLabel, gradePillClass } from "./util";
import LogSheet from "./LogSheet";
import HistoryPanel from "./HistoryPanel";

export default function TrackerApp({ teacherName, allowedClasses, initialClass, initialRoster }) {
  const [cls, setCls] = useState(initialClass);
  const [roster, setRoster] = useState(initialRoster);
  const [loading, setLoading] = useState(false);
  const [logStudent, setLogStudent] = useState(null);
  const [historyStudent, setHistoryStudent] = useState(null);
  const [toast, setToast] = useState("");

  async function switchClass(c) {
    if (c === cls) return;
    setCls(c);
    setLoading(true);
    try {
      setRoster(await getRoster(c));
    } catch {
      setRoster([]);
    }
    setLoading(false);
  }

  async function refresh() {
    try {
      setRoster(await getRoster(cls));
    } catch {
      /* keep current roster */
    }
  }

  function onSaved(res) {
    refresh();
    setToast(`Lesson saved${res?.sabaq ? ` — ${res.sabaq}` : ""}`);
    setTimeout(() => setToast(""), 2600);
  }

  const loggedCount = roster.filter((s) => s.logged).length;
  const avgJuz = roster.length ? (roster.reduce((a, s) => a + Number(s.juz || 1), 0) / roster.length).toFixed(1) : "—";

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <div className="mb-5">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">Quran tracker</h1>
        <p className="text-[13px] text-charcoal-soft mt-1">
          Ahlan, {teacherName} · {titleCase(cls)} · {sgTodayLabel()}
        </p>
      </div>

      {/* Summary */}
      <div className="mb-5 grid grid-cols-2 gap-4 max-w-md">
        <Stat label="Logged today" value={`${loggedCount}/${roster.length}`} />
        <Stat label="Average juz" value={avgJuz} />
      </div>

      {/* Class switcher */}
      {allowedClasses.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {allowedClasses.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => switchClass(c)}
              className={`rounded-pill px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                c === cls ? "bg-ink text-paper" : "border-[0.5px] border-line bg-white text-charcoal-soft hover:bg-paper-deep"
              }`}
            >
              {titleCase(c)}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-[13px] text-charcoal-soft">Loading class…</div>
      ) : roster.length === 0 ? (
        <div className="rounded-card border-[0.5px] border-line bg-white p-8 text-center text-[13px] text-charcoal-soft">
          No students in <strong className="text-charcoal">{titleCase(cls)}</strong> yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {roster.map((s) => (
            <StudentCard
              key={s.id}
              student={s}
              onOpenHistory={() => setHistoryStudent(s)}
              onLog={() => setLogStudent(s)}
            />
          ))}
        </div>
      )}

      {logStudent && (
        <LogSheet
          key={logStudent.id}
          student={logStudent}
          teacherName={teacherName}
          className={titleCase(cls)}
          onClose={() => setLogStudent(null)}
          onSaved={onSaved}
        />
      )}
      {historyStudent && (
        <HistoryPanel
          key={historyStudent.id}
          student={historyStudent}
          onClose={() => setHistoryStudent(null)}
          onLogToday={(s) => {
            setHistoryStudent(null);
            setLogStudent(s);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-pill bg-charcoal px-5 py-2.5 text-[14px] text-paper shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-card border-[0.5px] border-line bg-white p-[14px]">
      <div className="text-[11px] font-semibold text-charcoal-soft">{label}</div>
      <div className="font-heading text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}

function StudentCard({ student, onOpenHistory, onLog }) {
  const lr = student.lastRead
    ? `${surahByNumber(student.lastRead.s)?.name} ${student.lastRead.f}${student.lastRead.t > student.lastRead.f ? "–" + student.lastRead.t : ""}`
    : "Not yet logged";

  return (
    <div className="rounded-card border-[0.5px] border-line bg-white p-4">
      <button type="button" onClick={onOpenHistory} className="flex w-full items-center gap-3 text-left">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-gold-soft text-[13px] font-bold text-charcoal">
          {initials(student.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-charcoal">{titleCase(student.name)}</span>
          <span className="block text-[12px] text-charcoal-soft">{student.position || `Juz ${student.juz}`}</span>
        </span>
        {student.lastGrade && (
          <span className="flex-none text-right">
            <span className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${gradePillClass(student.lastGrade)}`}>
              {student.lastGrade}
            </span>
            {student.lastDate && <span className="mt-0.5 block text-[10px] text-charcoal-soft">{fmtDate(student.lastDate)}</span>}
          </span>
        )}
      </button>

      {/* 30-juz progress spine */}
      <div className="mt-3 flex gap-[2px]">
        {Array.from({ length: 30 }, (_, i) => {
          const n = i + 1;
          const done = n < student.juz;
          const now = n === student.juz;
          return (
            <span
              key={n}
              className={`h-1.5 flex-1 rounded-full ${done ? "bg-ink" : now ? "bg-gold" : "bg-line"}`}
            />
          );
        })}
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[11.5px] text-charcoal-soft">Last read: {lr}</span>
        {student.logged ? (
          <button
            type="button"
            onClick={onLog}
            className="rounded-pill bg-sage-soft px-3 py-1 text-[11.5px] font-semibold text-sage"
          >
            ✓ Logged · Edit
          </button>
        ) : (
          <button
            type="button"
            onClick={onLog}
            className="rounded-pill bg-ink px-3 py-1 text-[11.5px] font-semibold text-paper hover:bg-ink-deep"
          >
            Log today’s lesson
          </button>
        )}
      </div>
    </div>
  );
}
