"use client";

import { useEffect, useState, useTransition } from "react";
import Icon from "@/components/Icon";
import SearchSelect from "@/components/SearchSelect";
import { sgClock, formatHM, sgDate } from "@/lib/hours/rates";
import { shiftDetail, editShift, duplicateShift, cancelShift } from "@/lib/actions/shifts";
import { SHIFT_LOCATIONS } from "@/lib/hours/locations";

// Shift details, laid out the way Sling lays it out.
//
// Karim's screenshots are the spec: a labelled column of EMPLOYEE, DATE, TIME,
// LOCATION, POSITION, COWORKERS, with history and edit behind the header icons.
// The labels are on the left and the values on the right because that is what
// he is used to reading, and there is no reason to make him learn a new shape.
//
// Three panels, one at a time, as Sling does — details, history, edit. A single
// scrolling panel holding all three is how you end up reading history while
// trying to change a time.

const CANCEL_REASONS = [
  ["cancelled", "Class cancelled"],
  ["holiday", "Public holiday"],
  ["leave", "Teacher on leave"],
  ["error", "Rostered by mistake"],
];

/**
 * "Friday, Sep 04, 2026", exactly as Sling writes it.
 *
 * en-US rather than en-SG on purpose, and it is the only place in the portal
 * that uses it: en-SG renders "Friday, 04 Sept 2026" — day first and a
 * four-letter "Sept" — and the point of this panel is that it matches the
 * screen Karim already reads. The timezone is still Singapore.
 */
function longDate(date) {
  return new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-US", {
    timeZone: "Asia/Singapore",
    weekday: "long",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

/**
 * A stored HH:MM as "7:30 PM", for the history panel.
 *
 * History holds the raw `start_time`/`end_time` strings, which are 24-hour
 * because that is what the DB column is. Showing "From 09:30 to 22:00" makes
 * the reader do the conversion that every other line on this screen has
 * already done for them.
 */
function clockOf(v) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || "").trim());
  if (!m) return v; // a date, a name, a note — anything that is not a time
  const h = Number(m[1]);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

export default function ShiftDetail({ shiftId, teachers = [], locations = SHIFT_LOCATIONS, onClose, onChanged }) {
  const [panel, setPanel] = useState("details"); // details | history | edit
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const r = await shiftDetail(shiftId);
      if (r?.error) setError(r.error);
      else {
        setData(r);
        setError(null);
      }
    });
  }

  // In an effect, not during render: this is a fetch, and a fetch started while
  // rendering is a side effect React will either warn about or loop on.
  useEffect(() => {
    load();
    // shiftId is the only input; load is stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId]);

  const shift = data?.shift;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shift details"
        className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-card bg-white shadow-[0_12px_40px_rgba(74,51,64,0.25)]"
      >
        {/* Header, with Sling's icon row on the right. */}
        <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-ink text-ink">
              <Icon name="calendar" size={14} />
            </span>
            <h3 className="font-heading text-[16px] font-semibold text-charcoal">
              {panel === "history" ? "Shift history" : panel === "edit" ? "Edit shift" : "Shift details"}
            </h3>
          </div>
          <div className="flex items-center gap-1 text-charcoal-soft">
            {panel === "details" && shift && (
              <>
                <IconBtn label="Shift history" icon="refresh" onClick={() => setPanel("history")} />
                <IconBtn label="Duplicate to another date" icon="square" onClick={() => setPanel("duplicate")} />
              </>
            )}
            {panel !== "details" && (
              <IconBtn label="Back" icon="arrow-left" onClick={() => setPanel("details")} />
            )}
            <IconBtn label="Close" icon="x" onClick={onClose} />
          </div>
        </div>

        <div className="max-h-[calc(88vh-8rem)] overflow-y-auto">
          {error && (
            <div className="m-4 rounded-control border-[0.5px] border-rust bg-rust/5 px-3 py-2 text-[13px] text-charcoal">
              {error}
            </div>
          )}

          {!shift && !error && (
            <p className="px-5 py-8 text-center text-[13px] text-charcoal-soft">Loading…</p>
          )}

          {shift && panel === "details" && (
            <Details shift={shift} coworkers={data.coworkers} />
          )}
          {shift && panel === "history" && <History history={data.history} />}
          {shift && panel === "edit" && (
            <EditForm
              shift={shift}
              teachers={teachers}
              locations={locations}
              pending={pending}
              onCancelEdit={() => setPanel("details")}
              onSave={(form) =>
                startTransition(async () => {
                  const r = await editShift({ ...form, id: shift.id });
                  if (r?.error) setError(r.error);
                  else {
                    setError(null);
                    setPanel("details");
                    load();
                    onChanged?.();
                  }
                })
              }
            />
          )}
          {shift && panel === "duplicate" && (
            <Duplicate
              shift={shift}
              pending={pending}
              onBack={() => setPanel("details")}
              onCopy={(date) =>
                startTransition(async () => {
                  const r = await duplicateShift(shift.id, date);
                  if (r?.error) setError(r.error);
                  else {
                    setError(null);
                    setPanel("details");
                    onChanged?.();
                  }
                })
              }
            />
          )}
        </div>

        {/* Footer, as Sling has it: the destructive action tucked left, the
            primary one on the right. */}
        {shift && panel === "details" && (
          <div className="flex items-center justify-between gap-2 border-t-[0.5px] border-line bg-paper px-5 py-3">
            {shift.status === "cancelled" ? (
              <span className="text-[12px] font-semibold text-rust">
                Cancelled{shift.cancelReason ? ` — ${shift.cancelReason}` : ""}
              </span>
            ) : (
              <CancelMenu
                pending={pending}
                onCancel={(reason) =>
                  startTransition(async () => {
                    const r = await cancelShift(shift.id, reason);
                    if (r?.error) setError(r.error);
                    else {
                      onChanged?.();
                      onClose();
                    }
                  })
                }
              />
            )}
            <div className="flex gap-2">
              {shift.status !== "cancelled" && (
                <button
                  type="button"
                  onClick={() => setPanel("edit")}
                  className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep"
                >
                  Edit shift
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-control border-[0.5px] border-line px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:border-ink"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function IconBtn({ label, icon, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-control p-1.5 hover:bg-paper hover:text-charcoal"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

/** The labelled rows. Sling's order, because that is the order he reads. */
function Details({ shift, coworkers }) {
  const hours = formatHM(shift.minutes);
  return (
    <div className="divide-y-[0.5px] divide-line">
      <Row label="Employee" icon="user">
        <span className="font-semibold text-charcoal">{shift.teacherName || "—"}</span>
      </Row>
      <Row label="Date" icon="calendar">
        {longDate(shift.date)}
      </Row>
      <Row label="Time" icon="clock">
        {sgClock(shift.startsAt)} – {sgClock(shift.endsAt)} · {hours}{" "}
        <span className="text-charcoal-soft">(GMT+8)</span>
      </Row>
      <Row label="Location" icon="map-pin">
        {shift.branch || <span className="text-charcoal-soft">No centre set</span>}
      </Row>
      <Row label="Position" icon="clipboard-check">
        {shift.position || (shift.category === "ot" ? shift.otReason || "Ad-hoc / OT" : "Class teaching")}
      </Row>
      <Row label="Coworkers" icon="users">
        {coworkers.length === 0 ? (
          <span className="text-charcoal-soft">Nobody else is on then</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {coworkers.map((c) => (
              <span
                key={c.id}
                title={`${c.name}${c.position ? ` · ${c.position}` : ""}`}
                className="flex h-7 items-center gap-1.5 rounded-pill bg-paper-deep px-2 text-[11px] font-semibold text-charcoal"
              >
                {initials(c.name)}
              </span>
            ))}
          </div>
        )}
      </Row>
      {shift.phName && (
        <Row label="Holiday" icon="star">
          <span className="font-semibold text-sage">{shift.phName}</span> · pays the public-holiday rate
        </Row>
      )}
      {shift.category !== "ot" && (
        <Row label="Clock-in" icon="clock">
          {shift.clockInAt ? (
            sgClock(shift.clockInAt)
          ) : new Date(shift.endsAt) < new Date() ? (
            <span className="text-rust">
              None — this shift pays nothing until an IT Head adjusts it
            </span>
          ) : (
            <span className="text-charcoal-soft">Not yet</span>
          )}
        </Row>
      )}
      {shift.note && (
        <Row label="Notes" icon="pencil">
          {shift.note}
        </Row>
      )}
    </div>
  );
}

function Row({ label, icon, children }) {
  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <span className="w-[86px] shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-charcoal-soft">
        {label}
      </span>
      <span className="shrink-0 pt-0.5 text-charcoal-soft">
        <Icon name={icon} size={15} />
      </span>
      <div className="min-w-0 flex-1 text-[13px] text-charcoal">{children}</div>
    </div>
  );
}

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * Shift history, as Sling shows it: who, what changed, from what to what, when.
 *
 * A shift with no history is one created before this table existed, not one
 * nobody touched — and saying so is better than an empty panel that reads as
 * "nothing ever happened".
 */
function History({ history }) {
  if (!history.length) {
    return (
      <div className="px-5 py-8 text-center text-[13px] text-charcoal-soft">
        No history recorded for this shift.
        <br />
        <span className="text-[12px]">
          Changes are logged from 17 Sep 2026 — anything older than that was not recorded.
        </span>
      </div>
    );
  }
  return (
    <div className="divide-y-[0.5px] divide-line">
      {history.map((h) => (
        <div key={h.id} className="px-5 py-3.5">
          <div className="text-[13px] font-semibold text-ink">{h.actor}</div>
          <div className="mt-0.5 text-[13px] text-charcoal">{sentence(h)}</div>
          {h.from != null && h.to != null && (
            <div className="mt-0.5 text-[13px]">
              <span className="text-charcoal-soft">From </span>
              <span className="text-rust">{clockOf(h.from)}</span>
              <span className="text-charcoal-soft"> to </span>
              <span className="text-sage">{clockOf(h.to)}</span>
            </div>
          )}
          <div className="mt-1 text-[11px] text-charcoal-soft">
            {new Date(h.at).toLocaleString("en-SG", {
              timeZone: "Asia/Singapore",
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function sentence(h) {
  if (h.action === "created") return h.field === "copied from" ? "Copied the shift" : "Created the shift";
  if (h.action === "cancelled") return "Cancelled the shift";
  if (h.action === "reassigned") return "Moved the shift to somebody else";
  if (h.action === "split") return "Split the shift";
  return `Edited the ${h.field || "shift"}`;
}

/** Sling's Edit shift form, minus the repeat rules — see the note in the PR. */
function EditForm({ shift, teachers, locations, pending, onSave, onCancelEdit }) {
  const [form, setForm] = useState({
    teacherId: shift.teacherId,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    branch: shift.branch || "",
    note: shift.note || "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const field =
    "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink";

  return (
    <div className="space-y-3 px-5 py-4">
      <Labelled label="Date">
        <input type="date" className={field} value={form.date} onChange={set("date")} />
      </Labelled>
      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Start">
          <input type="time" className={field} value={form.startTime} onChange={set("startTime")} />
        </Labelled>
        <Labelled label="End">
          <input type="time" className={field} value={form.endTime} onChange={set("endTime")} />
        </Labelled>
      </div>
      <Labelled label="Location">
        <select className={field} value={form.branch} onChange={set("branch")}>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Labelled>
      {/* NOT wrapped in <Labelled>, and that is load-bearing.
          <Labelled> renders a real <label>, and a click anywhere inside a
          <label> is re-dispatched by the browser to its first labelable
          descendant — here, the SearchSelect's own trigger button. Picking an
          option therefore closed the panel and the forwarded click immediately
          toggled it back open, leaving the dropdown covering Save. A <label>
          only belongs around a single native control. */}
      <Field label="Employee">
        <SearchSelect
          label="Employee"
          placeholder="Pick a teacher"
          searchPlaceholder="Type a name"
          options={teachers.map((t) => ({ value: t.id, label: t.fullName || t.full_name }))}
          value={form.teacherId}
          onChange={(v) => setForm((f) => ({ ...f, teacherId: v || shift.teacherId }))}
        />
      </Field>
      <Labelled label="Notes">
        <input className={field} value={form.note} onChange={set("note")} placeholder="Add a note" />
      </Labelled>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancelEdit}
          className="rounded-control border-[0.5px] border-line px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:border-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onSave(form)}
          className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Duplicate({ shift, pending, onBack, onCopy }) {
  const [date, setDate] = useState(shift.date);
  return (
    <div className="space-y-3 px-5 py-4">
      <p className="text-[13px] text-charcoal-soft">
        Copies this shift — same teacher, {sgClock(shift.startsAt)}–{sgClock(shift.endsAt)}
        {shift.branch ? `, ${shift.branch}` : ""} — to another date.
      </p>
      <Labelled label="Copy to">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-control border-[0.5px] border-line bg-paper px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink"
        />
      </Labelled>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="rounded-control border-[0.5px] border-line px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:border-ink"
        >
          Back
        </button>
        <button
          type="button"
          disabled={pending || date === shift.date}
          onClick={() => onCopy(date)}
          className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-60"
        >
          {pending ? "Copying…" : "Copy the shift"}
        </button>
      </div>
      {date === shift.date && (
        <p className="text-[11px] text-charcoal-soft">Pick a different date — the teacher is already on this one.</p>
      )}
    </div>
  );
}

function CancelMenu({ pending, onCancel }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("cancelled");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-control border-[0.5px] border-line px-2.5 py-2 text-[13px] font-semibold text-charcoal-soft hover:border-rust hover:text-rust"
      >
        Cancel shift
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Why?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="rounded-control border-[0.5px] border-line bg-white px-2 py-1.5 text-[12px] text-charcoal"
      >
        {CANCEL_REASONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={() => onCancel(reason)}
        className="rounded-control bg-rust px-2.5 py-1.5 text-[12px] font-semibold text-paper disabled:opacity-60"
      >
        {pending ? "…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[12px] font-semibold text-charcoal-soft hover:text-charcoal"
      >
        Keep
      </button>
    </div>
  );
}

/** For a single native control, where <label> click-to-focus is a free win. */
function Labelled({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">{label}</span>
      {children}
    </label>
  );
}

/**
 * The same thing for a custom widget, as a <div>.
 *
 * A <label> forwards clicks to its first labelable descendant, which for a
 * composite widget means every click inside it also hits that widget's trigger.
 * See the note at the Employee field.
 */
function Field({ label, children }) {
  return (
    <div className="block">
      <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">{label}</span>
      {children}
    </div>
  );
}
