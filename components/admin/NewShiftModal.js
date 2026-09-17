"use client";

import { useState, useTransition } from "react";
import Icon from "@/components/Icon";
import SearchSelect from "@/components/SearchSelect";
import { createShifts } from "@/lib/actions/shifts";
import { sgToday, sgWeekday } from "@/lib/hours/rates";
import { SHIFT_POSITIONS, REPEAT_OPTIONS, needsUntil, positionFromProfile } from "@/lib/hours/positions";
import { endOfSgWeek } from "@/lib/hours/calendar";

// New shift, laid out as Sling lays it out.
//
// One form for teaching AND non-teaching work, which is what Karim asked for:
// POSITION decides which, so there is no second dropdown asking the same
// question. Picking "Events Team" makes an OT shift; picking "Lead Teacher"
// makes a teaching one.
//
// This also replaces Generate roster, which is why REPEAT is here and has to
// carry its weight. The days and the end date only appear once a repeat is
// chosen — an empty recurrence panel sitting above a one-off shift is noise on
// the form somebody fills in twenty times a week.
//
// EMPLOYEE is deliberately plural. Rostering the same class for three teachers
// was the main thing the bulk generator was used for, and losing it to gain a
// nicer form would be a bad trade.

const DAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 0, label: "Sun" },
];

const field =
  "w-full bg-white border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink";

export default function NewShiftModal({ teachers, locations, defaultDate, positions, onClose, onSaved }) {
  // The live list from the Positions screen, or the code list when it has not
  // been threaded through (and as the floor if the table is somehow empty) —
  // a Position dropdown with nothing in it cannot create a shift at all.
  const posList = positions?.length ? positions : SHIFT_POSITIONS;
  const groups = [...new Set(posList.map((p) => p.group))];
  const startDate = defaultDate || sgToday();
  const [form, setForm] = useState({
    date: startDate,
    startTime: "07:30",
    endTime: "12:45",
    repeat: "never",
    weekdays: [sgWeekday(startDate)],
    repeatUntil: "",
    branch: locations[0] || "",
    position: "",
    teacherIds: [],
    note: "",
    // Explicitly true rather than left undefined: the checkbox below renders
    // from `!== false`, so an undefined default would show ticked while the
    // server read it as off and rostered straight through Hari Raya.
    skipHolidays: true,
    published: true,
  });
  // Has the admin chosen the repeat days by hand? Until they have, the days
  // follow the date.
  const [daysTouched, setDaysTouched] = useState(false);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const repeating = form.repeat !== "never";
  const wantsUntil = needsUntil(form.repeat);

  // Picking the date moves the repeat day with it, until the admin says
  // otherwise. "Every week" on a Tuesday plainly means Tuesdays, and leaving
  // the day behind on whatever the form opened with is how a Tuesday class
  // ends up rostered on Mondays.
  function pickDate(e) {
    const date = e.target.value;
    setForm((f) => ({
      ...f,
      date,
      weekdays: daysTouched || !date ? f.weekdays : [sgWeekday(date)],
    }));
  }

  // One teacher and no position yet: guess it from their job title. Only a
  // prefill — the admin still sees it and can change it, and a title nobody
  // recognises leaves the field empty rather than guessing at teaching.
  function pickTeachers(ids) {
    setForm((f) => {
      const next = { ...f, teacherIds: ids };
      if (!f.position && ids.length === 1) {
        const t = teachers.find((x) => x.id === ids[0]);
        const guess = positionFromProfile(t?.position);
        if (guess) next.position = guess;
      }
      return next;
    });
  }

  function toggleDay(n) {
    setDaysTouched(true);
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(n) ? f.weekdays.filter((d) => d !== n) : [...f.weekdays, n],
    }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await createShifts(form);
      if (r?.error) {
        setError(r.error);
        return;
      }
      // Partial success is real and must be said out loud: nineteen teachers
      // rostered and one clashing is a success with a caveat, not a failure,
      // and silently dropping the one is how somebody ends up unrostered.
      const bits = [
        `${r.created} shift${r.created === 1 ? "" : "s"} added for ${r.teachers} ${
          r.teachers === 1 ? "person" : "people"
        }`,
      ];
      if (!r.published) {
        bits.push(r.created === 1 ? "as a draft — publish it when you’re ready" : "as drafts — publish them when you’re ready");
      }
      if (r.skipped?.length) bits.push(`${r.skipped.length} skipped as public holidays`);
      onSaved(`${bits.join(", ")}.`, r.clashes || []);
    });
  }

  const canSave =
    form.teacherIds.length > 0 &&
    form.position &&
    form.date &&
    form.startTime &&
    form.endTime &&
    (!wantsUntil || form.repeatUntil) &&
    (!repeating || form.weekdays.length > 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New shift"
        className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-card bg-white shadow-[0_12px_40px_rgba(74,51,64,0.25)]"
      >
        <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-ink text-ink">
              <Icon name="calendar" size={14} />
            </span>
            <h3 className="font-heading text-[16px] font-semibold text-charcoal">New shift</h3>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-control p-1.5 text-charcoal-soft hover:bg-paper hover:text-charcoal"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="max-h-[calc(90vh-9rem)] overflow-y-auto">
          {error && (
            <div className="m-4 rounded-control border-[0.5px] border-rust bg-rust/5 px-3 py-2 text-[13px] text-charcoal">
              {error}
            </div>
          )}
          <Row label="Date" icon="calendar">
            <input type="date" className={field} value={form.date} onChange={pickDate} />
          </Row>

          <Row label="Time" icon="clock">
            <div className="flex items-center gap-2">
              <input type="time" aria-label="Start" className={field} value={form.startTime} onChange={set("startTime")} />
              <span className="text-[12px] text-charcoal-soft">to</span>
              <input type="time" aria-label="End" className={field} value={form.endTime} onChange={set("endTime")} />
            </div>
          </Row>

          <Row label="Repeat" icon="refresh" tinted>
            <select className={field} value={form.repeat} onChange={set("repeat")}>
              {REPEAT_OPTIONS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>

            {repeating && (
              <div className="mt-2.5 space-y-2.5">
                <div>
                  <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Repeat on</span>
                  <div className="flex flex-wrap gap-1">
                    {DAYS.map((d) => {
                      const on = form.weekdays.includes(d.n);
                      return (
                        <button
                          key={d.n}
                          type="button"
                          onClick={() => toggleDay(d.n)}
                          className={`rounded-control border-[0.5px] px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
                            on ? "border-ink bg-ink text-paper" : "border-line text-charcoal-soft hover:border-ink"
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                  {form.weekdays.length === 0 && (
                    <p className="mt-1 text-[11px] text-rust">Pick at least one day.</p>
                  )}
                </div>

                {wantsUntil ? (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Ends</span>
                    <input
                      type="date"
                      className={field}
                      value={form.repeatUntil}
                      min={form.date}
                      onChange={set("repeatUntil")}
                    />
                  </label>
                ) : (
                  <p className="text-[11px] text-charcoal-soft">
                    {form.date
                      ? `Runs to the end of this week — ${endOfSgWeek(form.date)}.`
                      : "Runs to the end of the shift’s own week."}
                  </p>
                )}

                <label className="flex items-center gap-2 text-[12px] text-charcoal">
                  <input
                    type="checkbox"
                    checked={form.skipHolidays !== false}
                    onChange={(e) => setForm((f) => ({ ...f, skipHolidays: e.target.checked }))}
                    className="h-3.5 w-3.5"
                  />
                  Skip public holidays
                </label>
              </div>
            )}
          </Row>

          <Row label="Location" icon="map-pin">
            <select className={field} value={form.branch} onChange={set("branch")}>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Position" icon="clipboard-check">
            <select className={field} value={form.position} onChange={set("position")}>
              <option value="">Add position</option>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {posList.filter((p) => p.group === g).map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.key}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {/* Saying it out loud, because the position is the only thing that
                decides it and a surprise on the payroll report is expensive. */}
            {form.position && (
              <p className="mt-1 text-[11px] text-charcoal-soft">
                {posList.find((p) => p.key === form.position)?.category === "ot"
                  ? "Logged as non-teaching (OT)."
                  : "Logged as a teaching shift."}
              </p>
            )}
          </Row>

          {/* NOT inside a <label>: a click anywhere in a label is re-dispatched
              to its first labelable descendant, which for a composite widget is
              that widget's own trigger. See components/admin/ShiftDetail.js. */}
          <Row label="Employee" icon="users">
            <SearchSelect
              label="Employees"
              multiple
              placeholder="Add employee(s)"
              searchPlaceholder="Type a name"
              options={teachers.map((t) => ({
                value: t.id,
                label: t.fullName || t.full_name,
                // Sling's subtitle: the job and the home centre. Searchable
                // too, so "lead tampines" narrows to the right four people.
                hint: [t.position, t.primaryLocation].filter(Boolean).join(" · ") || undefined,
              }))}
              value={form.teacherIds}
              onChange={pickTeachers}
            />
            {form.teacherIds.length > 1 && (
              <p className="mt-1 text-[11px] text-charcoal-soft">
                Each of the {form.teacherIds.length} gets their own shift. Anyone who already has one then is
                skipped and named.
              </p>
            )}
          </Row>

          <Row label="Notes" icon="pencil">
            <input className={field} value={form.note} onChange={set("note")} placeholder="Add a note" />
          </Row>

          <Row label="Publish" icon="share">
            <button
              type="button"
              role="switch"
              aria-checked={form.published}
              onClick={() => setForm((f) => ({ ...f, published: !f.published }))}
              className={`relative h-6 w-11 rounded-pill transition-colors ${
                form.published ? "bg-ink" : "bg-line"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                  form.published ? "left-[1.375rem]" : "left-0.5"
                }`}
              />
            </button>
            <p className="mt-1 text-[11px] text-charcoal-soft">
              {form.published
                ? "Teachers can see it and will get a reminder."
                : "Saved as a draft — teachers can’t see it and no reminder is sent."}
            </p>
          </Row>
        </div>

        <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-line bg-paper px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-control border-[0.5px] border-line px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:border-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending || !canSave}
            onClick={save}
            className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}

function Row({ label, icon, children, tinted = false }) {
  return (
    <div className={`flex items-start gap-3 border-b-[0.5px] border-line px-5 py-3 ${tinted ? "bg-paper/60" : ""}`}>
      <span className="w-[74px] shrink-0 pt-2 text-[10px] font-semibold uppercase tracking-wide text-charcoal-soft">
        {label}
      </span>
      <span className="shrink-0 pt-2 text-charcoal-soft">
        <Icon name={icon} size={15} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
