"use client";

// The roster: where MH and IT Heads set who is working when.
//
// Three jobs on one screen, in the order they actually get done:
//   1. Add shifts — one, or a term's worth, teaching or OT. One form, because
//      there used to be two and two recurrence engines is how the roster and
//      the generator end up disagreeing about what a fortnight contains.
//   2. Look at a month and fix what's wrong (cancel a class, a holiday).
//   3. Deal with the shifts nobody clocked in for — which is the weekly chase,
//      now answered by the teachers themselves.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import {
  cancelShift,
  cancelDate,
  shiftsForRange,
  missedShifts,
  resolveMissed,
  syncHolidays,
  attendanceExceptions,
  splitShift,
} from "@/lib/actions/shifts";
import { adjustClockIn } from "@/lib/actions/hours";
import { reliefBoard, withdrawOffer } from "@/lib/actions/relief";
import ShiftCalendar from "@/components/admin/ShiftCalendar";
import ShiftDetail from "@/components/admin/ShiftDetail";
import NewShiftModal from "@/components/admin/NewShiftModal";
import { rangeFor, todayAnchor } from "@/lib/hours/calendar";
import { formatHM, sgClock, sgDate, sgTime24, sgToday, addSgDays, isoFromSg } from "@/lib/hours/rates";

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

export default function ShiftsAdmin({ teachers, locations, initial, fullAdmin = true, managedBranches = null }) {
  const router = useRouter();
  const [view, setView] = useState("roster"); // roster | attendance | missed | relief
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [shifts, setShifts] = useState(initial.shifts);
  const [missed, setMissed] = useState(initial.missed);
  const [exceptions, setExceptions] = useState(initial.exceptions || []);
  const [relief, setRelief] = useState(initial.relief || { uncovered: [], open: [], taken: [] });
  const [notice, setNotice] = useState(null);
  const [modal, setModal] = useState(null); // "one" | "holiday"
  const [splitting, setSplitting] = useState(null);
  // The roster opens as a CALENDAR. A list answers "what is outstanding"; the
  // question an admin opens the roster to ask is "who is on at Tampines on the
  // 12th, and where are the holes", and only a grid answers that.
  const [mode, setMode] = useState("calendar"); // calendar | list
  const [anchor, setAnchor] = useState(todayAnchor());
  const [calView, setCalView] = useState("month");
  // Prefill for the Add-shift modal when it was opened from a calendar cell:
  // the reason somebody clicked THAT day is that date.
  const [oneDate, setOneDate] = useState(null);
  // A shift clicked in the calendar. Shows the facts and the two things that
  // already exist for a shift — cancel it, or split it for relief. Deliberately
  // not an editor: the list view edits, and a half-editor in two places is how
  // the two drift.
  const [detail, setDetail] = useState(null);
  // A centre admin only ever rosters at their own centres, so the pickers only
  // offer those. The server refuses the rest regardless — this just keeps the
  // form from inviting an error it will then reject.
  const myLocations = managedBranches ? locations.filter((l) => managedBranches.includes(l)) : locations;
  const [busy, startTransition] = useTransition();

  function reload(nextFrom = from, nextTo = to) {
    startTransition(async () => {
      const [r, m, x] = await Promise.all([
        shiftsForRange(nextFrom, nextTo),
        missedShifts(),
        attendanceExceptions(),
      ]);
      setFrom(r.from);
      setTo(r.to);
      setShifts(r.shifts);
      setMissed(m.missed);
      setExceptions(x.exceptions);
      router.refresh();
    });
  }

  /** Move the calendar, fetching the new grid's range. */
  function gotoAnchor(next, nextView = calView) {
    setAnchor(next);
    setCalView(nextView);
    const r = rangeFor(nextView, next);
    reload(r.from, r.to);
  }

  // Pulls MOM's public-holiday calendar. Needed at least once per deployment,
  // and again whenever MOM publishes another year.
  function doSyncHolidays() {
    startTransition(async () => {
      const r = await syncHolidays();
      if (r?.error) setNotice(r.error);
      else {
        const bits = [`${r.total} holidays checked`];
        if (r.added) bits.push(`${r.added} added`);
        if (r.renamed) bits.push(`${r.renamed} renamed`);
        if (r.stamped) bits.push(`${r.stamped} existing shift(s) updated`);
        setNotice(r.added || r.renamed || r.stamped ? bits.join(" · ") + "." : "Already up to date.");
        reload();
      }
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
          <Seg active={view === "attendance"} onClick={() => setView("attendance")}>
            Attendance{exceptions.length ? ` (${exceptions.length})` : ""}
          </Seg>
          <Seg active={view === "missed"} onClick={() => setView("missed")}>
            Missed clock-ins{missed.length ? ` (${missed.length})` : ""}
          </Seg>
          <Seg active={view === "relief"} onClick={() => setView("relief")}>
            {/* The count is UNCOVERED only. An open offer is somebody doing the
                right thing in good time; an uncovered one is a class about to
                have nobody in it, and only that deserves a number on a tab. */}
            Relief{relief.uncovered.length ? ` (${relief.uncovered.length})` : ""}
          </Seg>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* One button, because one form now makes every kind of shift —
              teaching or OT, once or every week. */}
          <Secondary onClick={() => setModal("one")} icon="plus">
            Add shift
          </Secondary>
          <Secondary onClick={() => setModal("holiday")} icon="x">
            Cancel a date
          </Secondary>
          <Secondary onClick={doSyncHolidays} icon="refresh">
            Sync holidays
          </Secondary>
        </div>
      </div>

      {view === "roster" ? (
        <>
          {/* Calendar or list. Both read the same shifts; they answer different
              questions, so neither replaces the other. */}
          <div className="mb-3 flex gap-1 rounded-control bg-paper-deep p-1 w-fit">
            <Seg active={mode === "calendar"} onClick={() => { setMode("calendar"); gotoAnchor(anchor, calView); }}>
              Calendar
            </Seg>
            <Seg active={mode === "list"} onClick={() => setMode("list")}>
              List
            </Seg>
          </div>

          {mode === "calendar" ? (
            <ShiftCalendar
              shifts={shifts}
              anchor={anchor}
              view={calView}
              loading={busy}
              locations={myLocations}
              teachers={teachers}
              onNavigate={(next) => gotoAnchor(next)}
              onView={(v) => gotoAnchor(anchor, v)}
              onCreate={(date) => {
                setOneDate(date);
                setModal("one");
              }}
              onOpen={(shift) => setDetail(shift)}
            />
          ) : (
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
                  teachers={teachers}
                  onSplit={(shift) => setSplitting(shift)}
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
          )}
        </>
      ) : view === "attendance" ? (
        <AttendanceList
          rows={exceptions}
          busy={busy}
          onAdjust={(sessionId, clockInIso, reason) =>
            startTransition(async () => {
              const r = await adjustClockIn(sessionId, clockInIso, reason);
              if (r?.error) setNotice(r.error);
              else {
                setNotice(`Clock-in moved. That shift now pays ${formatHM(r.minutes)}.`);
                reload();
              }
            })
          }
        />
      ) : view === "missed" ? (
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
      ) : (
        <ReliefList
          board={relief}
          busy={busy}
          onWithdraw={(id) =>
            startTransition(async () => {
              const r = await withdrawOffer(id);
              if (r?.error) setNotice(r.error);
              else {
                setNotice("Taken off the board — that shift stays with whoever holds it.");
                const next = await reliefBoard();
                if (!next?.error) setRelief(next);
                router.refresh();
              }
            })
          }
        />
      )}

      {splitting && (
        <SplitModal
          shift={splitting}
          teachers={teachers}
          busy={busy}
          onClose={() => setSplitting(null)}
          onSave={(at, first, second) => {
            startTransition(async () => {
              const r = await splitShift(splitting.id, at, first, second);
              if (r?.error) setNotice(r.error);
              else {
                setNotice(`Split at ${r.at}. Both halves are on the roster.`);
                setSplitting(null);
                reload();
              }
            });
          }}
        />
      )}

      {modal === "one" && (
        <NewShiftModal
          teachers={teachers}
          locations={myLocations}
          defaultDate={oneDate}
          onClose={() => {
            setModal(null);
            setOneDate(null);
          }}
          onSaved={(msg, clashes) => {
            setModal(null);
            setOneDate(null);
            // Anyone skipped is NAMED. A partial success that reads like a
            // clean one is how somebody ends up unrostered and nobody notices
            // until the morning of.
            setNotice(clashes?.length ? `${msg} ${clashes.join(" ")}` : msg);
            reload();
          }}
        />
      )}

      {detail && (
        <ShiftDetail
          shiftId={detail.id}
          teachers={teachers}
          locations={myLocations}
          onClose={() => setDetail(null)}
          onChanged={() => reload()}
        />
      )}
      {modal === "holiday" && (
        <CancelDateModal
          locations={myLocations}
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

function DayGroup({ date, shifts, busy, teachers, onCancel, onSplit }) {
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
            <div className="flex shrink-0 gap-2">
              {/* Only worth offering on a shift long enough to hold two classes.
                  A 90-minute shift is one class and splitting it is a mistake
                  waiting to be made. */}
              {s.minutes >= 180 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSplit(s)}
                  className="rounded-control border-[0.5px] border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-charcoal transition-colors hover:bg-paper-deep disabled:opacity-40"
                >
                  Split
                </button>
              )}
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
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The weekly chase, as a screen.
 *
 * Every shift where the clock-in did not go to plan: nobody tapped, or they
 * tapped 15 minutes or more late. Both cost the teacher money, so both show
 * what the shift now pays alongside what it was rostered for — an IT Head
 * should not have to work out the consequence in their head before deciding
 * whether to move it.
 *
 * Adjusting is the one sanctioned way pay changes after the fact, so the reason
 * is required rather than optional, and it is shown back on the row afterwards:
 * the next person to look at this shift should see the decision, not re-chase
 * it.
 */
function AttendanceList({ rows, busy, onAdjust }) {
  const [adjusting, setAdjusting] = useState(null);

  if (!rows.length) {
    return (
      <div className="rounded-card border-[0.5px] border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
        Nothing to chase — every shift in the last fortnight was clocked in on time.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
        {rows.map((s) => {
          const missing = s.attendance.state === "missing";
          const paid = missing ? 0 : Math.max(0, s.minutes - s.attendance.lateMinutes);
          return (
            <div key={s.id} className="border-b-[0.5px] border-line px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-charcoal">{s.teacherName}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        missing ? "bg-rust-soft text-rust" : "bg-gold-soft text-gold"
                      }`}
                    >
                      {missing ? "No clock-in" : `${s.attendance.lateMinutes} min late`}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-charcoal-soft">
                    {sgDate(s.startsAt)} · rostered {sgClock(s.startsAt)}–{sgClock(s.endsAt)}
                    {s.branch ? ` · ${s.branch}` : ""}
                  </div>
                  <div className="mt-1 text-[12px] text-charcoal-soft">
                    {s.clockInAt ? `Tapped ${sgClock(s.clockInAt)} · ` : ""}
                    pays {formatHM(paid)} of {formatHM(s.minutes)}
                  </div>
                  {s.adjustReason ? (
                    <div className="mt-1.5 rounded-control bg-paper-deep px-3 py-2 text-[12px] text-charcoal">
                      Adjusted: “{s.adjustReason}”
                    </div>
                  ) : s.note ? (
                    <div className="mt-1.5 rounded-control bg-paper-deep px-3 py-2 text-[12px] text-charcoal whitespace-pre-line">
                      {s.note}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {s.sessionId ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setAdjusting(s)}
                      className="rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[12px] font-semibold text-charcoal transition-colors hover:bg-paper-deep disabled:opacity-40"
                    >
                      Adjust clock-in
                    </button>
                  ) : (
                    <span className="max-w-[11rem] text-right text-[11px] text-charcoal-soft">
                      Nothing was clocked in — use Missed clock-ins to pay or void it.
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {adjusting && (
        <AdjustModal
          shift={adjusting}
          busy={busy}
          onClose={() => setAdjusting(null)}
          onSave={(iso, reason) => {
            onAdjust(adjusting.sessionId, iso, reason);
            setAdjusting(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Move a clock-in, with the reason that justifies it.
 *
 * The time is entered as SG wall clock on the shift's own date — an IT Head is
 * reading "she was actually here at 3", not an instant. It is converted here so
 * the action never has to guess a timezone.
 */
function AdjustModal({ shift, busy, onClose, onSave }) {
  const [time, setTime] = useState(sgTime24(shift.startsAt));
  const [reason, setReason] = useState("");
  const iso = isoFromSg(shift.date, time);
  const ready = !!iso && reason.trim().length >= 3;

  return (
    <Modal title="Adjust clock-in" onClose={onClose}>
      <div className="text-[12px] text-charcoal-soft">
        {shift.teacherName} · {sgDate(shift.startsAt)} · rostered {sgClock(shift.startsAt)}–{sgClock(shift.endsAt)}
      </div>
      {shift.clockInOriginalAt && (
        <div className="mt-1 text-[12px] text-charcoal-soft">
          Actually tapped at {sgClock(shift.clockInOriginalAt)}. That never changes — this only moves what pays.
        </div>
      )}

      <label className="mt-4 block text-[12px] font-semibold text-charcoal">Clock-in time</label>
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${field} mt-1.5`} />

      <label className="mt-3 block text-[12px] font-semibold text-charcoal">Reason</label>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Phone died, MH confirmed she was there from 3."
        className={`${field} mt-1.5`}
      />
      <p className="mt-1.5 text-[11px] text-charcoal-soft">
        Goes on the shift, so it shows in the payroll export.
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-control border-[0.5px] border-line bg-white px-4 py-2 text-[13px] font-semibold text-charcoal"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => onSave(iso, reason.trim())}
          className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

/**
 * Split a shift in two and hand each half to somebody.
 *
 * The case this exists for: a teacher's shift covers two classes, they give it
 * away whole, and two different reliefs take one each. The roster then needs to
 * be two rows, and no amount of reassigning one row achieves that.
 *
 * Defaults to the midpoint because that is usually where the class boundary is,
 * and leaves both halves with the original teacher until somebody is chosen —
 * splitting and reassigning are separate decisions and pretending otherwise
 * would silently move a shift nobody asked to move.
 */
function SplitModal({ shift, teachers, busy, onClose, onSave }) {
  const mid = new Date((Date.parse(shift.startsAt) + Date.parse(shift.endsAt)) / 2).toISOString();
  const [at, setAt] = useState(sgTime24(mid));
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");

  const cutIso = isoFromSg(shift.date, at);
  const inside =
    !!cutIso && Date.parse(cutIso) > Date.parse(shift.startsAt) && Date.parse(cutIso) < Date.parse(shift.endsAt);

  return (
    <Modal title="Split this shift" onClose={onClose}>
      <div className="text-[12px] text-charcoal-soft">
        {shift.teacherName} · {sgDate(shift.startsAt)} · {sgClock(shift.startsAt)}–{sgClock(shift.endsAt)}
      </div>

      <label className="mt-4 block text-[12px] font-semibold text-charcoal">Split at</label>
      <input type="time" value={at} onChange={(e) => setAt(e.target.value)} className={`${field} mt-1.5`} />
      {!inside && (
        <p className="mt-1.5 text-[11px] text-rust">The split has to fall inside the shift, not at either end.</p>
      )}

      <label className="mt-3 block text-[12px] font-semibold text-charcoal">
        First half {inside ? `(${sgClock(shift.startsAt)}–${at})` : ""}
      </label>
      <select value={first} onChange={(e) => setFirst(e.target.value)} className={`${field} mt-1.5`}>
        <option value="">Keep {shift.teacherName}</option>
        {teachers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.fullName}
          </option>
        ))}
      </select>

      <label className="mt-3 block text-[12px] font-semibold text-charcoal">
        Second half {inside ? `(${at}–${sgClock(shift.endsAt)})` : ""}
      </label>
      <select value={second} onChange={(e) => setSecond(e.target.value)} className={`${field} mt-1.5`}>
        <option value="">Keep {shift.teacherName}</option>
        {teachers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.fullName}
          </option>
        ))}
      </select>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-control border-[0.5px] border-line bg-white px-4 py-2 text-[13px] font-semibold text-charcoal"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!inside || busy}
          onClick={() => onSave(at, first, second)}
          className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper disabled:opacity-40"
        >
          Split
        </button>
      </div>
    </Modal>
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

// The relief board, for an IT Head.
//
// UNCOVERED LEADS, and that ordering is the whole point of the screen. An open
// offer is somebody doing the right thing in good time. An offer whose shift has
// already started and that nobody took is a class with no teacher in it right
// now — it needs a phone call, not a list position below thirty tidy rows.
function ReliefList({ board, busy, onWithdraw }) {
  const { uncovered = [], open = [], taken = [] } = board || {};

  if (!uncovered.length && !open.length && !taken.length) {
    return (
      <div className="rounded-card border-[0.5px] border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
        Nothing on the relief board.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {uncovered.length > 0 && (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-rust">
            Nobody took these ({uncovered.length})
          </h3>
          <p className="mb-2 text-[12px] text-charcoal-soft">
            Offered, never taken, and the shift has started. Whoever was originally rostered is still
            the one on the roster — reassign it or call them.
          </p>
          <div className="overflow-hidden rounded-card border-[0.5px] border-rust bg-white">
            {uncovered.map((o) => (
              <ReliefRow key={o.id} offer={o} busy={busy} onWithdraw={onWithdraw} urgent />
            ))}
          </div>
        </div>
      )}

      {open.length > 0 && (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-charcoal">On the board ({open.length})</h3>
          <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
            {open.map((o) => (
              <ReliefRow key={o.id} offer={o} busy={busy} onWithdraw={onWithdraw} />
            ))}
          </div>
        </div>
      )}

      {taken.length > 0 && (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-charcoal">Changed hands</h3>
          <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
            {taken.map((o) => (
              <div
                key={o.id}
                className="border-b-[0.5px] border-line px-4 py-3 text-[13px] last:border-0"
              >
                <div className="font-semibold text-charcoal">
                  {sgClock(o.startsAt)} – {sgClock(o.endsAt)} · {dayLabel(o.date)}
                </div>
                <div className="mt-0.5 text-[12px] text-charcoal-soft">
                  {o.offerFromName || "—"} → {o.takenByName || "—"}
                  {o.branch ? ` · ${o.branch}` : ""}
                  {/* Paid at the TAKER's rate, because teacher_id moved with the
                      shift. Worth saying out loud on the screen where somebody
                      is deciding whether to let a handover stand. */}
                  {" · paid at the new teacher’s rate"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReliefRow({ offer, busy, onWithdraw, urgent = false }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-charcoal">
          {sgClock(offer.startsAt)} – {sgClock(offer.endsAt)} · {dayLabel(offer.date)}
        </div>
        <div className="mt-0.5 text-[12px] text-charcoal-soft">
          from {offer.offerFromName || offer.teacherName || "—"}
          {offer.branch ? ` · ${offer.branch}` : ""}
          {offer.phName ? ` · ${offer.phName}` : ""}
        </div>
        {offer.offerReason && (
          <p className="mt-0.5 text-[12px] text-charcoal-soft">“{offer.offerReason}”</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onWithdraw(offer.id)}
        disabled={busy}
        className={`shrink-0 rounded-control border-[0.5px] px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-60 ${
          urgent
            ? "border-rust text-rust hover:bg-rust/5"
            : "border-line text-charcoal-soft hover:border-ink hover:text-charcoal"
        }`}
      >
        Take off board
      </button>
    </div>
  );
}
