"use client";

// The roster: where MH and IT Heads set who is working when.
//
// Three jobs on one screen, in the order they actually get done:
//   1. Generate a term's worth of recurring shifts for a teacher.
//   2. Look at a fortnight and fix what's wrong (cancel a class, a holiday).
//   3. Deal with the shifts nobody clocked in for — which is the weekly chase,
//      now answered by the teachers themselves.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import {
  createShift,
  generateShifts,
  cancelShift,
  cancelDate,
  shiftsForRange,
  missedShifts,
  resolveMissed,
} from "@/lib/actions/shifts";
import { OT_REASONS, formatHM, sgClock, sgDate, sgToday, addSgDays } from "@/lib/hours/rates";

const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

/** "Mon 10 Aug" for a YYYY-MM-DD, read in Singapore. */
function dayLabel(date) {
  return new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const DAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 0, label: "Sun" },
];

export default function ShiftsAdmin({ teachers, locations, initial }) {
  const router = useRouter();
  const [view, setView] = useState("roster"); // roster | missed
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [shifts, setShifts] = useState(initial.shifts);
  const [missed, setMissed] = useState(initial.missed);
  const [notice, setNotice] = useState(null);
  const [modal, setModal] = useState(null); // "one" | "bulk" | "holiday"
  const [busy, startTransition] = useTransition();

  function reload(nextFrom = from, nextTo = to) {
    startTransition(async () => {
      const [r, m] = await Promise.all([shiftsForRange(nextFrom, nextTo), missedShifts()]);
      setFrom(r.from);
      setTo(r.to);
      setShifts(r.shifts);
      setMissed(m.missed);
      router.refresh();
    });
  }

  const byDate = shifts.reduce((acc, s) => {
    (acc[s.date] ||= []).push(s);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort();

  return (
    <div>
      {notice && (
        <div className="mb-4 flex items-start gap-3 rounded-card border-[0.5px] border-gold bg-gold-soft/40 px-4 py-3 text-[13px] text-charcoal">
          <span className="mt-0.5 text-gold">
            <Icon name="calendar" size={16} />
          </span>
          <div className="flex-1">{notice}</div>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-charcoal-soft hover:text-charcoal">
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-control bg-paper-deep p-1">
          <Seg active={view === "roster"} onClick={() => setView("roster")}>
            Roster
          </Seg>
          <Seg active={view === "missed"} onClick={() => setView("missed")}>
            Missed clock-ins{missed.length ? ` (${missed.length})` : ""}
          </Seg>
        </div>

        <div className="flex flex-wrap gap-2">
          <Secondary onClick={() => setModal("bulk")} icon="calendar">
            Generate roster
          </Secondary>
          <Secondary onClick={() => setModal("one")} icon="plus">
            Add shift
          </Secondary>
          <Secondary onClick={() => setModal("holiday")} icon="x">
            Cancel a date
          </Secondary>
        </div>
      </div>

      {view === "roster" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => reload(addSgDays(from, -14), addSgDays(to, -14))}
              disabled={busy}
              className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-line bg-white disabled:opacity-40"
              aria-label="Previous fortnight"
            >
              <Icon name="arrow-left" size={15} />
            </button>
            <span className="min-w-[13rem] text-center text-[13px] font-semibold text-charcoal">
              {dayLabel(from)} → {dayLabel(to)}
            </span>
            <button
              type="button"
              onClick={() => reload(addSgDays(from, 14), addSgDays(to, 14))}
              disabled={busy}
              className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-line bg-white disabled:opacity-40"
              aria-label="Next fortnight"
            >
              <span className="rotate-180">
                <Icon name="arrow-left" size={15} />
              </span>
            </button>
          </div>

          {dates.length === 0 ? (
            <div className="rounded-card border-[0.5px] border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
              No shifts rostered in this fortnight.
            </div>
          ) : (
            <div className="space-y-4">
              {dates.map((d) => (
                <DayGroup
                  key={d}
                  date={d}
                  shifts={byDate[d]}
                  busy={busy}
                  onCancel={(id, reason) =>
                    startTransition(async () => {
                      const r = await cancelShift(id, reason);
                      if (r?.error) setNotice(r.error);
                      else reload();
                    })
                  }
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <MissedList
          missed={missed}
          busy={busy}
          onResolve={(id, accept, note) =>
            startTransition(async () => {
              const r = await resolveMissed(id, accept, note);
              if (r?.error) setNotice(r.error);
              else {
                setNotice(accept ? "Approved — that shift will now be paid." : "Marked as not worked.");
                reload();
              }
            })
          }
        />
      )}

      {modal === "one" && (
        <OneOffModal
          teachers={teachers}
          locations={locations}
          onClose={() => setModal(null)}
          onSaved={(msg) => {
            setModal(null);
            setNotice(msg);
            reload();
          }}
        />
      )}
      {modal === "bulk" && (
        <BulkModal
          teachers={teachers}
          locations={locations}
          onClose={() => setModal(null)}
          onSaved={(msg) => {
            setModal(null);
            setNotice(msg);
            reload();
          }}
        />
      )}
      {modal === "holiday" && (
        <CancelDateModal
          locations={locations}
          onClose={() => setModal(null)}
          onSaved={(msg) => {
            setModal(null);
            setNotice(msg);
            reload();
          }}
        />
      )}
    </div>
  );
}

function DayGroup({ date, shifts, busy, onCancel }) {
  const ph = shifts.find((s) => s.phName)?.phName;
  return (
    <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
      <div className="flex items-center justify-between border-b-[0.5px] border-line bg-paper-deep/50 px-4 py-2">
        <span className="text-[12px] font-bold uppercase tracking-wider text-charcoal-soft">
          {dayLabel(date)}
        </span>
        {ph && (
          <span className="rounded-pill bg-sand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sage">
            {ph}
          </span>
        )}
      </div>
      {shifts.map((s) => (
        <div key={s.id} className="flex items-center gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-charcoal">{s.teacherName}</span>
              <span className="text-[12px] text-charcoal-soft">
                {sgClock(s.startsAt)}–{sgClock(s.endsAt)}
              </span>
              {s.status === "cancelled" && (
                <span className="rounded-pill bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-soft">
                  Cancelled{s.cancelReason ? ` · ${s.cancelReason}` : ""}
                </span>
              )}
              {s.sessionId && (
                <span className="rounded-pill bg-sage-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sage">
                  Worked
                </span>
              )}
              {s.unpaid && (
                <span className="rounded-pill bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-soft">
                  Unpaid
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[12px] text-charcoal-soft">
              {s.category === "ot" ? s.otReason || "Ad-hoc / OT" : "Class teaching"}
              {s.branch ? ` · ${s.branch}` : ""} · {formatHM(s.minutes)}
              {!s.payTier && s.category !== "ot" && !s.unpaid ? " · ⚠ no pay tier set" : ""}
            </div>
          </div>
          {s.status === "planned" && !s.sessionId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const reason = prompt("Cancel this shift. Reason?", "cancelled");
                if (reason === null) return;
                onCancel(s.id, reason);
              }}
              className="rounded-control border-[0.5px] border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-charcoal transition-colors hover:bg-rust-soft hover:text-rust disabled:opacity-40"
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function MissedList({ missed, busy, onResolve }) {
  if (!missed.length) {
    return (
      <div className="rounded-card border-[0.5px] border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
        Nothing outstanding — every past shift is accounted for.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
      {missed.map((s) => (
        <div key={s.id} className="border-b-[0.5px] border-line px-4 py-3 last:border-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-charcoal">{s.teacherName}</div>
              <div className="mt-0.5 text-[12px] text-charcoal-soft">
                {sgDate(s.startsAt)} · {sgClock(s.startsAt)}–{sgClock(s.endsAt)}
                {s.branch ? ` · ${s.branch}` : ""} · {formatHM(s.minutes)}
              </div>
              {s.missedReason ? (
                <div className="mt-1.5 rounded-control bg-paper-deep px-3 py-2 text-[12px] text-charcoal">
                  “{s.missedReason}”
                </div>
              ) : (
                <div className="mt-1.5 text-[12px] text-charcoal-soft">No explanation given yet.</div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onResolve(s.id, true, null)}
                className="rounded-control bg-ink px-3 py-2 text-[12px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-40"
              >
                Pay it
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!confirm("Mark this shift as not worked? It won't be paid.")) return;
                  onResolve(s.id, false, null);
                }}
                className="rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[12px] font-semibold text-charcoal transition-colors hover:bg-rust-soft hover:text-rust disabled:opacity-40"
              >
                Not worked
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Modals ------------------------------------------------------------

function OneOffModal({ teachers, locations, onClose, onSaved }) {
  const [form, setForm] = useState({
    teacherId: teachers[0]?.id || "",
    category: "ot",
    otReason: OT_REASONS[0],
    branch: locations[0] || "",
    date: sgToday(),
    startTime: "09:00",
    endTime: "11:00",
    note: "",
    unpaid: false,
  });
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function save() {
    startTransition(async () => {
      const r = await createShift(form);
      if (r?.error) setError(r.error);
      else onSaved(r.phName ? `Shift added. That date is ${r.phName} — it will pay the public-holiday rate.` : "Shift added.");
    });
  }

  return (
    <Modal title="Add a shift" onClose={onClose}>
      <p className="mb-3 text-[12px] text-charcoal-soft">
        Use this for OT once MH has approved it. The teacher doesn’t need to clock in for it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <L label="Teacher" full>
          <select className={field} value={form.teacherId} onChange={set("teacherId")}>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </select>
        </L>
        <L label="Type">
          <select className={field} value={form.category} onChange={set("category")}>
            <option value="ot">Ad-hoc / OT</option>
            <option value="teaching">Class teaching</option>
          </select>
        </L>
        {form.category === "ot" && (
          <L label="What for?">
            <select className={field} value={form.otReason} onChange={set("otReason")}>
              {OT_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </L>
        )}
        <L label="Branch">
          <select className={field} value={form.branch} onChange={set("branch")}>
            {locations.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </L>
        <L label="Date">
          <input type="date" className={field} value={form.date} onChange={set("date")} />
        </L>
        <L label="Start">
          <input type="time" className={field} value={form.startTime} onChange={set("startTime")} />
        </L>
        <L label="End">
          <input type="time" className={field} value={form.endTime} onChange={set("endTime")} />
        </L>
        <L label="Note (optional)" full>
          <input className={field} value={form.note} onChange={set("note")} />
        </L>
      </div>
      {error && <div className="mt-3 rounded-control bg-rust-soft px-3 py-2 text-[12px] text-rust">{error}</div>}
      <Actions pending={pending} onClose={onClose} onSave={save} label="Add shift" />
    </Modal>
  );
}

function BulkModal({ teachers, locations, onClose, onSaved }) {
  const [form, setForm] = useState({
    teacherId: teachers[0]?.id || "",
    branch: locations[0] || "",
    fromDate: sgToday(),
    toDate: addSgDays(sgToday(), 90),
    startTime: "16:00",
    endTime: "18:00",
    skipHolidays: true,
    unpaid: false,
  });
  const [weekdays, setWeekdays] = useState([1, 3]);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function toggle(n) {
    setWeekdays((w) => (w.includes(n) ? w.filter((x) => x !== n) : [...w, n]));
  }

  function save() {
    startTransition(async () => {
      const r = await generateShifts({ ...form, weekdays });
      if (r?.error) setError(r.error);
      else {
        const bits = [`${r.created} shift${r.created === 1 ? "" : "s"} created`];
        if (r.skipped?.length) bits.push(`${r.skipped.length} skipped (public holiday)`);
        if (r.duplicates) bits.push(`${r.duplicates} already existed`);
        onSaved(bits.join(" · ") + ".");
      }
    });
  }

  return (
    <Modal title="Generate a roster" onClose={onClose}>
      <p className="mb-3 text-[12px] text-charcoal-soft">
        Creates one shift per occurrence. Generate a term at a time rather than a whole year — a roster is easiest to
        fix before anyone has worked against it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <L label="Teacher" full>
          <select className={field} value={form.teacherId} onChange={set("teacherId")}>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </select>
        </L>
        <L label="Branch">
          <select className={field} value={form.branch} onChange={set("branch")}>
            {locations.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </L>
        <L label="From">
          <input type="date" className={field} value={form.fromDate} onChange={set("fromDate")} />
        </L>
        <L label="To">
          <input type="date" className={field} value={form.toDate} onChange={set("toDate")} />
        </L>
        <L label="Start">
          <input type="time" className={field} value={form.startTime} onChange={set("startTime")} />
        </L>
        <L label="End">
          <input type="time" className={field} value={form.endTime} onChange={set("endTime")} />
        </L>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Days of the week</span>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => (
              <button
                key={d.n}
                type="button"
                onClick={() => toggle(d.n)}
                className={`rounded-control px-3 py-2 text-[12px] font-semibold transition-colors ${
                  weekdays.includes(d.n)
                    ? "bg-ink text-paper"
                    : "border-[0.5px] border-line bg-white text-charcoal hover:bg-paper-deep"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-charcoal sm:col-span-2">
          <input
            type="checkbox"
            checked={form.skipHolidays}
            onChange={(e) => setForm((f) => ({ ...f, skipHolidays: e.target.checked }))}
          />
          Skip Singapore public holidays
        </label>
      </div>
      {error && <div className="mt-3 rounded-control bg-rust-soft px-3 py-2 text-[12px] text-rust">{error}</div>}
      <Actions pending={pending} onClose={onClose} onSave={save} label="Generate" />
    </Modal>
  );
}

function CancelDateModal({ locations, onClose, onSaved }) {
  const [date, setDate] = useState(sgToday());
  const [branch, setBranch] = useState("");
  const [reason, setReason] = useState("holiday");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const r = await cancelDate(date, branch, reason);
      if (r?.error) setError(r.error);
      else onSaved(`${r.cancelled} shift${r.cancelled === 1 ? "" : "s"} cancelled. They won’t count as missed.`);
    });
  }

  return (
    <Modal title="Cancel a date" onClose={onClose}>
      <p className="mb-3 text-[12px] text-charcoal-soft">
        Cancels every shift on that date so nobody is chased for missing them. Shifts are kept, not deleted.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <L label="Date">
          <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
        </L>
        <L label="Branch">
          <select className={field} value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All branches</option>
            {locations.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </L>
        <L label="Reason" full>
          <select className={field} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="holiday">Public holiday</option>
            <option value="cancelled">Class cancelled</option>
            <option value="leave">Teacher on leave</option>
            <option value="error">Roster error</option>
          </select>
        </L>
      </div>
      {error && <div className="mt-3 rounded-control bg-rust-soft px-3 py-2 text-[12px] text-rust">{error}</div>}
      <Actions pending={pending} onClose={onClose} onSave={save} label="Cancel shifts" />
    </Modal>
  );
}

// ---- Shared bits -------------------------------------------------------

function Seg({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-control px-3 py-1.5 text-[13px] font-semibold transition-colors ${
        active ? "bg-white text-ink shadow-sm" : "text-charcoal-soft hover:text-charcoal"
      }`}
    >
      {children}
    </button>
  );
}

function Secondary({ onClick, icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[12px] font-semibold text-charcoal transition-colors hover:bg-paper-deep"
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}

function L({ label, children, full }) {
  return (
    <label className={full ? "block sm:col-span-2" : "block"}>
      <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-white p-5 shadow-[0_12px_40px_rgba(74,51,64,0.25)]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-[17px] font-semibold text-charcoal">{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="text-charcoal-soft hover:text-charcoal">
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

function Actions({ pending, onClose, onSave, label }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-control border-[0.5px] border-line bg-white px-4 py-2.5 text-[13px] font-semibold text-charcoal transition-colors hover:bg-paper-deep"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="rounded-control bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
      >
        {pending ? "Saving…" : label}
      </button>
    </div>
  );
}
