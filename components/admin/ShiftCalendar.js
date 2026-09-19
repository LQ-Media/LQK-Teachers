"use client";

import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import SearchSelect from "@/components/SearchSelect";
import { sgClock, formatHM, sgToday } from "@/lib/hours/rates";
import {
  DAY_LABELS,
  ROLE_COLOURS,
  byDate,
  legendFor,
  monthBounds,
  monthGrid,
  roleOf,
  step,
  weekGrid,
} from "@/lib/hours/calendar";

// The roster as a calendar, the way Sling shows it.
//
// The list view answers "what is outstanding". This answers the question an
// admin actually opens the roster to ask: is anybody at Tampines on the 12th,
// and where are the holes. A list of 373 rows cannot answer that; a grid can,
// at a glance, which is why Sling's schedule is a grid and why colour by
// position is not decoration.
//
// Dense by design. Sling's cells hold a dozen shifts and scroll, and so do
// these — hiding shifts behind "+8 more" would put the hole you are looking for
// exactly where you cannot see it.

const MONTH_LABEL = { month: "long", year: "numeric" };

function monthName(anchor) {
  return new Date(`${anchor.slice(0, 7)}-15T12:00:00+08:00`).toLocaleDateString("en-SG", {
    timeZone: "Asia/Singapore",
    ...MONTH_LABEL,
  });
}

function dayNum(date) {
  return Number(date.slice(8, 10));
}

export default function ShiftCalendar({
  shifts,
  anchor,
  view,
  loading,
  locations = [],
  teachers = [],
  onNavigate,
  onView,
  onCreate,
  onOpen,
}) {
  const [branch, setBranch] = useState("");
  // MULTI-select, and searchable: 77 names share so many first words that a
  // plain <select> is a scroll hunt even when you know who you want.
  const [teacherIds, setTeacherIds] = useState([]);
  const [category, setCategory] = useState("");
  const today = sgToday();

  // Filtered client-side: the whole grid's shifts are already loaded, so
  // filtering is instant and does not cost a round trip per keystroke.
  const visible = useMemo(() => {
    return (shifts || []).filter((s) => {
      if (branch && s.branch !== branch) return false;
      if (teacherIds.length && !teacherIds.includes(s.teacherId)) return false;
      if (category && s.category !== category) return false;
      return true;
    });
  }, [shifts, branch, teacherIds, category]);

  const cells = useMemo(() => byDate(visible), [visible]);
  const legend = useMemo(() => legendFor(visible), [visible]);

  // The stat strip, from what is on screen — so it answers a question about
  // the month being looked at rather than about the database.
  const stats = useMemo(() => {
    const planned = visible.filter((s) => s.status !== "cancelled");
    const minutes = planned.reduce((n, s) => n + (s.minutes || 0), 0);
    const missing = planned.filter(
      (s) => s.category !== "ot" && !s.clockInAt && new Date(s.endsAt) < new Date()
    ).length;
    return {
      shifts: planned.length,
      minutes,
      cancelled: visible.length - planned.length,
      missing,
    };
  }, [visible]);

  const weeks = view === "week" ? [weekGrid(anchor).map((d) => ({ date: d, inMonth: true }))] : monthGrid(anchor.slice(0, 7));

  const rangeLabel =
    view === "week"
      ? (() => {
          const d = weekGrid(anchor);
          return `${dayNum(d[0])} – ${dayNum(d[6])} ${monthName(d[6])}`;
        })()
      : monthName(anchor);

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-control border-[0.5px] border-line">
            <button
              type="button"
              aria-label="Previous"
              onClick={() => onNavigate(step(view, anchor, -1))}
              className="px-2.5 py-2 text-charcoal-soft hover:text-charcoal"
            >
              <Icon name="chevron-left" size={15} />
            </button>
            <button
              type="button"
              onClick={() => onNavigate(today)}
              className="border-x-[0.5px] border-line px-3 py-2 text-[12px] font-semibold text-charcoal hover:bg-paper"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => onNavigate(step(view, anchor, 1))}
              className="px-2.5 py-2 text-charcoal-soft hover:text-charcoal"
            >
              <Icon name="chevron-right" size={15} />
            </button>
          </div>
          <h2 className="font-heading text-[17px] font-bold text-charcoal">{rangeLabel}</h2>
          {loading && <span className="text-[12px] text-charcoal-soft">Loading…</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-control bg-paper-deep p-1">
            {["month", "week"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onView(v)}
                className={`rounded-[7px] px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors ${
                  view === v ? "bg-white text-charcoal shadow-sm" : "text-charcoal-soft hover:text-charcoal"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <select
            aria-label="Centre"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="rounded-control border-[0.5px] border-line bg-paper px-2.5 py-2 text-[12px] text-charcoal"
          >
            <option value="">All centres</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <SearchSelect
            label="Teacher"
            className="w-[190px]"
            multiple
            placeholder="All teachers"
            searchPlaceholder="Type a name"
            options={teachers.map((t) => ({ value: t.id, label: t.fullName || t.full_name }))}
            value={teacherIds}
            onChange={setTeacherIds}
          />
          <select
            aria-label="Type"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-control border-[0.5px] border-line bg-paper px-2.5 py-2 text-[12px] text-charcoal"
          >
            <option value="">Teaching &amp; OT</option>
            <option value="teaching">Teaching only</option>
            <option value="ot">OT only</option>
          </select>
        </div>
      </div>

      {/* Stats, mirroring Sling's strip. Scheduled hours leads because it is the
          number that turns into money. */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Scheduled hours" value={formatHM(stats.minutes)} />
        <Stat label="Shifts" value={stats.shifts} />
        <Stat label="Cancelled" value={stats.cancelled} muted={!stats.cancelled} />
        <Stat label="No clock-in" value={stats.missing} alert={stats.missing > 0} />
      </div>

      {legend.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {legend.map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[11px] text-charcoal-soft">
              <span className={`h-2.5 w-2.5 rounded-[3px] ${ROLE_COLOURS[k].bg}`} />
              {ROLE_COLOURS[k].label}
            </span>
          ))}
        </div>
      )}

      {/* The grid. Horizontally scrollable below tablet: seven readable columns
          do not fit on a phone, and squeezing them makes every block unreadable
          rather than making one column hard to reach. */}
      <div className="overflow-x-auto rounded-card border-[0.5px] border-line bg-white">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-7 border-b-[0.5px] border-line bg-paper">
            {DAY_LABELS.map((d) => (
              <div key={d} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft">
                {d}
              </div>
            ))}
          </div>

          {weeks.map((row, i) => (
            <div key={i} className="grid grid-cols-7 border-b-[0.5px] border-line last:border-0">
              {row.map((cell) => {
                const list = cells[cell.date] || [];
                const isToday = cell.date === today;
                return (
                  <div
                    key={cell.date}
                    className={`min-h-[132px] border-r-[0.5px] border-line last:border-0 ${
                      cell.inMonth ? "" : "bg-paper/60"
                    }`}
                  >
                    <div className="flex items-center justify-between px-2 pt-1.5">
                      <span
                        className={`text-[11px] font-semibold ${
                          isToday
                            ? "flex h-5 w-5 items-center justify-center rounded-full bg-ink text-paper"
                            : cell.inMonth
                              ? "text-charcoal"
                              : "text-charcoal-soft/60"
                        }`}
                      >
                        {dayNum(cell.date)}
                      </span>
                      {/* Add on this day. Prefilled with the date, because the
                          reason somebody clicked THIS cell is that date. */}
                      <button
                        type="button"
                        aria-label={`Add a shift on ${cell.date}`}
                        onClick={() => onCreate?.(cell.date)}
                        className="rounded-[5px] px-1 text-charcoal-soft/50 hover:bg-paper hover:text-charcoal"
                      >
                        <Icon name="plus" size={13} />
                      </button>
                    </div>

                    <div className="max-h-[220px] space-y-1 overflow-y-auto px-1.5 pb-1.5 pt-1">
                      {list.map((s) => (
                        <ShiftBlock key={s.id} shift={s} onOpen={onOpen} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {visible.length === 0 && !loading && (
        <p className="mt-3 text-center text-[13px] text-charcoal-soft">
          No shifts {branch || teacherIds.length || category ? "match those filters" : "rostered"} in {rangeLabel}.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, alert = false, muted = false }) {
  return (
    <div className={`rounded-card border-[0.5px] px-3 py-2 ${alert ? "border-rust bg-rust/5" : "border-line bg-white"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-charcoal-soft">{label}</div>
      <div className={`mt-0.5 font-heading text-[18px] font-bold ${alert ? "text-rust" : muted ? "text-charcoal-soft" : "text-charcoal"}`}>
        {value}
      </div>
    </div>
  );
}

/**
 * One shift. Reads top-down as time → who → where, which is the order somebody
 * scanning a column needs: the time narrows it, the name confirms it, the
 * centre is the detail you check last.
 *
 * A missing clock-in on a finished shift gets a marker, because that is the one
 * thing on this screen that needs somebody to do something.
 */
function ShiftBlock({ shift, onOpen }) {
  const role = roleOf(shift);
  const c = ROLE_COLOURS[role];
  const cancelled = shift.status === "cancelled";
  // A draft is on the roster but NOT on the teacher's phone, so it has to look
  // different here or the grid quietly lies about who has been told.
  const draft = shift.published === false;
  const needsClockIn =
    !cancelled && shift.category !== "ot" && !shift.clockInAt && new Date(shift.endsAt) < new Date();

  return (
    <button
      type="button"
      onClick={() => onOpen?.(shift)}
      title={`${sgClock(shift.startsAt)}–${sgClock(shift.endsAt)} · ${shift.teacherName || ""}${
        shift.branch ? ` · ${shift.branch}` : ""
      }${shift.position || shift.teacherPosition ? ` · ${shift.position || shift.teacherPosition}` : ""}${
        cancelled ? " · CANCELLED" : ""
      }${draft ? " · DRAFT — not published" : ""}`}
      className={`block w-full rounded-[5px] px-1.5 py-1 text-left transition-opacity hover:opacity-85 ${c.bg} ${c.text} ${
        cancelled ? "line-through opacity-60" : ""
      } ${draft ? "opacity-70 ring-[1.5px] ring-inset ring-white/70" : ""}`}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold leading-tight">
        <span className="truncate">
          {sgClock(shift.startsAt)} – {sgClock(shift.endsAt)}
        </span>
        {needsClockIn && (
          <span title="No clock-in" className="shrink-0 rounded-full bg-white/90 px-1 text-[9px] font-bold text-rust">
            !
          </span>
        )}
        {shift.phName && (
          <span title={shift.phName} className="shrink-0 rounded-full bg-white/90 px-1 text-[9px] font-bold text-sage">
            PH
          </span>
        )}
        {draft && (
          <span
            title="Draft — teachers can’t see this yet"
            className="shrink-0 rounded-full bg-white/90 px-1 text-[9px] font-bold text-charcoal"
          >
            DRAFT
          </span>
        )}
      </div>
      <div className="truncate text-[10px] leading-tight opacity-95">{shift.teacherName || "—"}</div>
      {shift.branch && <div className="truncate text-[9px] leading-tight opacity-80">{shift.branch}</div>}
    </button>
  );
}
