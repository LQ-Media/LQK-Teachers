"use client";

import { useEffect, useState, useTransition } from "react";
import Icon from "@/components/Icon";
import { positionList, savePosition, setPositionArchived, movePosition } from "@/lib/actions/positions";
import { ROLE_COLOURS } from "@/lib/hours/calendar";
import { OT_ROLES } from "@/lib/hours/rates";

// Shift Roster → POSITIONS, editable.
//
// Karim, 17 Sep: "i need the positions page or it to be edittable for me if i
// need to edit or add." Sling's Positions screen is the reference — a list with
// a count beside each name, a per-row menu, and a colour on the detail.
//
// WHAT THIS SCREEN DOES NOT DO, and why:
//
//   No base wage. Sling has one; LQK does not pay that way. Pay comes from the
//   TIER on the person (teaching) and the OT team's rate (non-teaching), so a
//   wage here would be a second source of truth for pay, and two of those is
//   how they end up disagreeing. Karim chose to leave it out.
//
//   No delete, only archive. A position is the classification on months of
//   worked, approved, paid shifts. Removing the row would leave those shifts
//   pointing at nothing — the calendar would colour them as plain teaching and
//   the edit form would refuse to open them.
//
// The one thing worth a warning is a RENAME: the name is the value stored on
// every shift, so it rewrites them. The form says how many before you save.

const TH = "py-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft";
const TD = "py-2.5 pr-3 align-top text-[13px]";
const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink";

export default function PositionsPanel({ canEdit = false }) {
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // {position} | {position:null} for new
  const [pending, startTransition] = useTransition();

  // Does not clear `error`: every action below finishes by reloading, and
  // clearing here would wipe the message the action had just set.
  function load() {
    startTransition(async () => {
      const r = await positionList();
      if (r?.error) setError(r.error);
      else setData(r);
    });
  }

  useEffect(() => {
    load();
    // Once, on mount. `load` is stable for this component's lifetime.
  }, []);

  function archive(p, want) {
    setNotice(null);
    setError(null);
    if (want && p.upcoming > 0) {
      if (
        !confirm(
          `Archive “${p.key}”?\n\n${p.upcoming} upcoming shift${p.upcoming === 1 ? "" : "s"} still ` +
            `${p.upcoming === 1 ? "has" : "have"} this position. They keep it — archiving only hides it ` +
            "from the Add-shift dropdown."
        )
      )
        return;
    }
    startTransition(async () => {
      const r = await setPositionArchived(p.key, want);
      if (r?.error) {
        setError(r.error);
        return;
      }
      setNotice(
        want
          ? `“${r.name}” is archived — hidden from the Add-shift dropdown.` +
              (r.stillUpcoming ? ` ${r.stillUpcoming} upcoming shift(s) still carry it.` : "")
          : `“${r.name}” is back in the Add-shift dropdown.`
      );
      load();
    });
  }

  function move(p, direction) {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const r = await movePosition(p.key, direction);
      if (r?.error) setError(r.error);
      load();
    });
  }

  if (!data && !error) {
    return <p className="px-1 py-8 text-center text-[13px] text-charcoal-soft">Loading…</p>;
  }

  const positions = data?.positions || [];
  const groups = [...new Set(positions.map((p) => p.group))];

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-card border-[0.5px] border-rust bg-rust/5 px-4 py-3 text-[13px] text-charcoal">
          <div className="flex-1">{error}</div>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)} className="text-charcoal-soft hover:text-charcoal">
            <Icon name="x" size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-start gap-3 rounded-card border-[0.5px] border-sage bg-sage/5 px-4 py-3 text-[13px] text-charcoal">
          <div className="flex-1">{notice}</div>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-charcoal-soft hover:text-charcoal">
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[44rem] text-[12px] text-charcoal-soft">
          The position decides whether a shift pays as <strong className="font-semibold text-charcoal">teaching</strong>{" "}
          — at the teacher&rsquo;s own tier — or logs as{" "}
          <strong className="font-semibold text-charcoal">non-teaching OT</strong> under a team.{" "}
          {canEdit
            ? "Nothing here sets a rate: pay stays on the person's tier and the OT team's rate."
            : "Only a full admin can change this list."}
        </p>
        {canEdit && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditing({ position: null })}
            className="shrink-0 rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-50"
          >
            Add position
          </button>
        )}
      </div>

      {groups.map((group) => {
        const rows = positions.filter((p) => p.group === group);
        return (
          <div key={group} className="mb-4 rounded-card border-[0.5px] border-line bg-white p-5 last:mb-0">
            <h3 className="mb-3 font-heading text-[15px] font-semibold text-charcoal">
              {group} ({rows.filter((p) => !p.archivedAt).length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem]">
                <thead>
                  <tr className="border-b-[0.5px] border-line">
                    <th className={TH}>Position</th>
                    <th className={TH}>Logs as</th>
                    <th className={TH}>OT team</th>
                    <th className={TH}>On shifts</th>
                    {canEdit && <th className={`${TH} text-right`}>Options</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, i) => {
                    const c = ROLE_COLOURS[p.colour] || null;
                    const archived = !!p.archivedAt;
                    return (
                      <tr
                        key={p.key}
                        className={`border-b-[0.5px] border-line last:border-0 ${archived ? "opacity-55" : ""}`}
                      >
                        <td className={TD}>
                          <span className="flex items-center gap-2">
                            <span
                              className={`h-3.5 w-3.5 shrink-0 rounded-full ${c ? c.bg : "border-[1.5px] border-line"}`}
                              title={c ? c.label : "No colour set — derived from the name"}
                            />
                            <span className="font-semibold text-charcoal">{p.key}</span>
                            {archived && (
                              <span className="rounded-pill bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase text-charcoal-soft">
                                Archived
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={TD}>
                          <span
                            className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
                              p.category === "ot" ? "bg-paper-deep text-charcoal" : "bg-sage/15 text-charcoal"
                            }`}
                          >
                            {p.category === "ot" ? "Non-teaching (OT)" : "Teaching"}
                          </span>
                        </td>
                        <td className={`${TD} text-charcoal-soft`}>{p.otRole || "—"}</td>
                        <td className={`${TD} tabular-nums text-charcoal-soft`}>
                          {p.shifts || 0}
                          {p.upcoming ? (
                            <span className="text-charcoal"> · {p.upcoming} upcoming</span>
                          ) : null}
                        </td>
                        {canEdit && (
                          <td className="py-2 pr-1 align-top">
                            <div className="flex items-center justify-end gap-1">
                              <IconBtn
                                label="Move up"
                                icon="chevron-left"
                                rotate
                                disabled={pending || i === 0}
                                onClick={() => move(p, "up")}
                              />
                              <IconBtn
                                label="Move down"
                                icon="chevron-right"
                                rotate
                                disabled={pending || i === rows.length - 1}
                                onClick={() => move(p, "down")}
                              />
                              <IconBtn
                                label="Edit"
                                icon="pencil"
                                disabled={pending}
                                onClick={() => setEditing({ position: p })}
                              />
                              <IconBtn
                                label={archived ? "Bring back" : "Archive"}
                                icon={archived ? "refresh" : "x"}
                                disabled={pending}
                                onClick={() => archive(p, !archived)}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {editing && (
        <PositionModal
          position={editing.position}
          colours={data?.colours || []}
          maxName={data?.maxName || 40}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setError(null);
            setNotice(msg);
            load();
          }}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}

function IconBtn({ label, icon, onClick, disabled, rotate = false }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-control border-[0.5px] border-line p-1.5 text-charcoal-soft hover:border-ink hover:text-charcoal disabled:opacity-30"
    >
      <span className={rotate ? (icon === "chevron-left" ? "block rotate-90" : "block rotate-90") : undefined}>
        <Icon name={icon} size={14} />
      </span>
    </button>
  );
}

/**
 * Add or edit one position.
 *
 * The rename warning is the point of this form having a warning at all: the
 * name is stored on every shift, so changing it rewrites them, and the count is
 * shown BEFORE saving rather than reported afterwards.
 */
function PositionModal({ position, colours, maxName, onClose, onSaved, onError }) {
  const editing = !!position;
  const [form, setForm] = useState({
    name: position?.key || "",
    category: position?.category || "teaching",
    otRole: position?.otRole || "",
    group: position?.group || "Teaching",
    colour: position?.colour || "",
  });
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const renaming = editing && form.name.trim() && form.name.trim() !== position.key;
  const reclassifying =
    editing && (form.category !== position.category || (form.otRole || "") !== (position.otRole || ""));

  // Choosing OT moves it to the Non-teaching group and back, because that is
  // what the group means — leaving an OT position under "Teaching" in the
  // picker would be actively misleading.
  function setCategory(e) {
    const category = e.target.value;
    setForm((f) => ({
      ...f,
      category,
      group: category === "ot" ? "Non-teaching" : "Teaching",
      otRole: category === "ot" ? f.otRole : "",
    }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await savePosition({ ...form, originalName: position?.key || null });
      if (r?.error) {
        setError(r.error);
        return;
      }
      const bits = [r.created ? `“${r.name}” added.` : `“${r.name}” saved.`];
      if (r.renamedFrom) {
        bits.push(
          `Renamed from “${r.renamedFrom}” on ${r.renamedShifts} shift${r.renamedShifts === 1 ? "" : "s"}.`
        );
      }
      if (r.reclassified) {
        bits.push("Shifts already created keep how they were classified — only new ones use this.");
      }
      onSaved(bits.join(" "));
    });
  }

  const canSave = !!form.name.trim() && (form.category === "teaching" || form.category === "ot");

  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit position" : "Add position"}
        className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-card bg-white shadow-[0_12px_40px_rgba(74,51,64,0.25)]"
      >
        <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-line px-5 py-3.5">
          <h3 className="font-heading text-[16px] font-semibold text-charcoal">
            {editing ? "Edit position" : "Add position"}
          </h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-control p-1.5 text-charcoal-soft hover:bg-paper hover:text-charcoal"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="max-h-[calc(90vh-9rem)] space-y-4 overflow-y-auto p-5">
          {error && (
            <div className="rounded-control border-[0.5px] border-rust bg-rust/5 px-3 py-2 text-[13px] text-charcoal">
              {error}
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft">
              Position name
            </span>
            <input
              className={field}
              value={form.name}
              maxLength={maxName}
              onChange={set("name")}
              placeholder="e.g. Relief Teacher"
            />
          </label>

          {renaming && (
            <div className="rounded-control border-[0.5px] border-gold bg-gold-soft/40 px-3 py-2 text-[12px] text-charcoal">
              Renaming this also updates the{" "}
              <strong className="font-semibold">
                {position.shifts} shift{position.shifts === 1 ? "" : "s"}
              </strong>{" "}
              that carry “{position.key}”. The name is what each shift stores, so the two move together.
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft">
              Logs as
            </span>
            <select className={field} value={form.category} onChange={setCategory}>
              <option value="teaching">Teaching — paid at the teacher’s tier</option>
              <option value="ot">Non-teaching (OT)</option>
            </select>
          </label>

          {form.category === "ot" && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft">
                OT team
              </span>
              <select className={field} value={form.otRole} onChange={set("otRole")}>
                <option value="">No particular team — plain OT</option>
                {OT_ROLES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                    {r.rate === null ? " (tracked, unpaid)" : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-charcoal-soft">
                This is the team the payroll report groups the hours under. It does not set a rate.
              </p>
            </label>
          )}

          {reclassifying && (
            <div className="rounded-control border-[0.5px] border-gold bg-gold-soft/40 px-3 py-2 text-[12px] text-charcoal">
              Shifts already created keep how they were classified — changing this only affects new ones. Work that
              has been approved and paid is never re-priced by an edit here.
            </div>
          )}

          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft">
              Colour on the calendar
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, colour: "" }))}
                title="Derive it from the name, as before"
                className={`flex h-7 items-center rounded-control border-[0.5px] px-2 text-[11px] font-semibold ${
                  form.colour ? "border-line text-charcoal-soft" : "border-ink bg-ink/5 text-ink"
                }`}
              >
                Automatic
              </button>
              {colours.map((k) => {
                const c = ROLE_COLOURS[k];
                if (!c) return null;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => setForm((f) => ({ ...f, colour: k }))}
                    className={`h-7 w-7 rounded-full ${c.bg} ${
                      form.colour === k ? "ring-[2.5px] ring-ink ring-offset-1" : ""
                    }`}
                  />
                );
              })}
            </div>
          </div>
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
            {pending ? "Saving…" : editing ? "Save changes" : "Add position"}
          </button>
        </div>
      </div>
    </>
  );
}
