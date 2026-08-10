"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import EmptyArt from "@/components/EmptyArt";
import LocationTag, { LocationLine } from "@/components/hours/LocationTag";
import { clockIn, clockOut, addPastSession, editSession, deleteSession, setSessionLocation } from "@/lib/actions/hours";
import { explainMissed } from "@/lib/actions/shifts";
import {
  OT_REASONS,
  OT_RATE,
  PH_MULTIPLIER,
  rateFor,
  sessionPayCents,
  formatHM,
  formatMoney,
  sgClock,
  sgDate,
  sgTime24,
  sgToday,
} from "@/lib/hours/rates";
import { MISSED_REASONS } from "@/lib/hours/shifts";

const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

export default function HoursApp({
  firstName,
  payTier,
  tierRate,
  monthName,
  branchOptions,
  running,
  onShift,
  nextShift,
  upcoming,
  missed,
  awaiting,
  sessions,
  totals,
}) {
  const router = useRouter();
  const [modal, setModal] = useState(null); // {mode, session?}
  const [notice, setNotice] = useState(null);

  // Approved uses the snapshotted rate and holiday multiplier; pending is
  // estimated at today's.
  function rateOf(s) {
    if (s.status === "approved" && s.rateCents != null) return s.rateCents / 100;
    return rateFor(s.category, payTier);
  }
  function payOf(s) {
    const r = rateOf(s);
    if (r == null) return null;
    const mult = s.status === "approved" ? s.phMultiplier : s.phName ? PH_MULTIPLIER : null;
    return sessionPayCents(s.minutes, r, mult);
  }

  const estCents = totals.approvedCents + totals.pendingCents;

  return (
    <div className="px-4 py-6 sm:p-8 max-w-3xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <PageHeading
          route="/hours"
          icon="clock"
          title="Work hours"
          subtitle={`Clock in when you arrive — your shifts are already set. ${monthName}.`}
        />
      </div>

      {notice && (
        <div className="mb-5 flex items-start gap-3 rounded-card border-[0.5px] border-gold bg-gold-soft/40 px-4 py-3 text-[13px] text-charcoal">
          <span className="mt-0.5 text-gold">
            <Icon name="clock" size={16} />
          </span>
          <div className="flex-1">{notice}</div>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-charcoal-soft hover:text-charcoal">
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      {/* Month totals */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Teaching" value={formatHM(totals.teachingMinutes)} />
        <Stat label="Ad-hoc / OT" value={formatHM(totals.otMinutes)} />
        <Stat
          label="Est. pay this month"
          value={tierRate == null && totals.teachingMinutes > 0 ? "—" : formatMoney(estCents)}
          hint={
            tierRate == null && totals.teachingMinutes > 0
              ? "Pay tier not set"
              : totals.pendingCents > 0
                ? `${formatMoney(totals.approvedCents)} approved`
                : "all approved"
          }
        />
      </div>

      <ShiftCard
        running={running}
        onShift={onShift}
        nextShift={nextShift}
        branchOptions={branchOptions}
        tierRate={tierRate}
        onNotice={setNotice}
      />

      {/* Shifts nobody clocked in for. Answering here is what replaces the
          weekly chase from the IT Heads. */}
      {missed.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 font-heading text-[15px] font-semibold text-charcoal">
            You didn’t clock in {missed.length > 1 ? `(${missed.length})` : ""}
          </h2>
          <div className="overflow-hidden rounded-card border-[0.5px] border-rust bg-white">
            {missed.map((s) => (
              <MissedRow key={s.id} shift={s} onNotice={setNotice} />
            ))}
          </div>
        </div>
      )}

      {awaiting.length > 0 && (
        <div className="mt-6 rounded-card border-[0.5px] border-line bg-white px-4 py-3">
          <p className="text-[13px] text-charcoal-soft">
            {awaiting.length === 1 ? "1 explanation is" : `${awaiting.length} explanations are`} with an admin to
            review.
          </p>
        </div>
      )}

      {/* The roster ahead — the main thing a teacher wants from this page. */}
      {upcoming.length > 0 && (
        <div className="mt-7">
          <h2 className="mb-3 font-heading text-[15px] font-semibold text-charcoal">Your next shifts</h2>
          <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
            {upcoming.map((s) => (
              <UpcomingRow key={s.id} shift={s} />
            ))}
          </div>
        </div>
      )}

      {/* This month's sessions */}
      <div className="mt-7 mb-3">
        <h2 className="font-heading text-[15px] font-semibold text-charcoal">This month</h2>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-card border-[0.5px] border-line bg-white">
          <EmptyArt art="hours">No sessions logged this month yet.</EmptyArt>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              s={s}
              pay={payOf(s)}
              onEdit={() => setModal({ mode: "edit", session: s })}
              onDeleted={() => router.refresh()}
            />
          ))}
        </div>
      )}

      {modal && (
        <SessionModal
          modal={modal}
          branchOptions={branchOptions}
          tierRate={tierRate}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---- Shift card --------------------------------------------------------

// One tap is the whole teacher-facing action. There is no clock out: teachers
// forget, and an open session leaves nobody knowing when they finished. Pay is
// the rostered shift, so the end time is already known the moment they arrive.

function ShiftCard({ running, onShift, nextShift, branchOptions, tierRate, onNotice }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [branch, setBranch] = useState(branchOptions[0] || "");
  const [note, setNote] = useState("");
  const [geo, setGeo] = useState(null);

  function doClockIn() {
    startTransition(async () => {
      const r = await clockIn({ branch, note, geo });
      if (r?.error) onNotice(r.error);
      else {
        setNote("");
        setGeo(null);
        if (r?.unscheduled) {
          onNotice(
            "Clocked in, but you have no shift rostered right now. An admin will see this and set your end time."
          );
        } else if (r?.shifts > 1) {
          onNotice(`Clocked in for all ${r.shifts} of your back-to-back shifts.`);
        }
        router.refresh();
      }
    });
  }

  // An unscheduled session is the only thing left genuinely running — nobody
  // knows when it ends, so the teacher can close it themselves.
  if (running) return <OpenCard running={running} pending={pending} onNotice={onNotice} />;

  if (onShift) return <OnShiftCard session={onShift} />;

  const start = nextShift && sgClock(nextShift.startsAt);
  const end = nextShift && sgClock(nextShift.endsAt);
  const isToday = nextShift && nextShift.date === sgToday();

  return (
    <div className="rounded-card border-[0.5px] border-line bg-white p-5">
      {nextShift ? (
        <div className="mb-4">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft">
            {isToday ? "Your next shift today" : "Your next shift"}
          </span>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-heading text-[22px] font-bold text-charcoal">
              {start} – {end}
            </span>
            {nextShift.phName && (
              <span className="rounded-pill bg-sand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sage">
                {nextShift.phName}
              </span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-charcoal-soft">
            {!isToday && `${sgDate(nextShift.startsAt)} · `}
            {nextShift.category === "ot" ? nextShift.otReason || "Ad-hoc / OT" : "Class teaching"}
            {nextShift.branch ? ` · ${nextShift.branch}` : ""} · {formatHM(nextShift.minutes)}
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft">No shift rostered</span>
          <p className="mt-1 text-[13px] text-charcoal-soft">
            You can still clock in — an admin will set the end time.
          </p>
        </div>
      )}

      {/* Only an unrostered tap needs to say where it is; a shift knows already. */}
      {!nextShift && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Labelled label="Branch">
            <select className={field} value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branchOptions.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Note (optional)">
            <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What are you doing?" />
          </Labelled>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Where are you?</span>
            <LocationTag value={geo} onChange={setGeo} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-charcoal-soft">
          {nextShift?.category === "ot"
            ? `Paid at $${OT_RATE}/hr`
            : tierRate != null
              ? `Paid at your rate: $${tierRate}/hr`
              : "Ask an admin to set your pay tier"}
          {nextShift?.phName ? ` · public holiday, ×${PH_MULTIPLIER}` : ""}
        </span>
        <button
          type="button"
          onClick={doClockIn}
          disabled={pending}
          className="flex items-center gap-2 rounded-control bg-ink px-5 py-3 text-[14px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
        >
          <Icon name="play" size={15} filled />
          {pending ? "Saving…" : "Clock in"}
        </button>
      </div>
    </div>
  );
}

// Mid-shift. Counts DOWN to the rostered end, because that end is already
// decided — there is nothing to stop, and no clock-out to forget.
function OnShiftCard({ session }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const leftMs = Math.max(0, Date.parse(session.endedAt) - now);
  const catLabel = session.category === "ot" ? session.otReason || "Ad-hoc / OT" : "Class teaching";

  return (
    <div className="rounded-card border-[0.5px] border-gold bg-gold-soft/30 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-sage">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
            </span>
            Clocked in
          </div>
          <div className="mt-1.5 font-heading text-4xl font-bold tabular-nums text-charcoal">
            {formatElapsed(leftMs)}
          </div>
          <div className="mt-1 text-[12px] text-charcoal-soft">
            left of {catLabel}
            {session.branch ? ` · ${session.branch}` : ""} · ends {sgClock(session.endedAt)}
          </div>
          {session.phName && (
            <div className="mt-2 inline-block rounded-pill bg-sand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sage">
              {session.phName} · ×{PH_MULTIPLIER}
            </div>
          )}
        </div>
        <div className="text-right text-[12px] text-charcoal-soft">
          <div>Clocked in {sgClock(session.clockInAt)}</div>
          <div className="mt-1">Nothing else to do — you’re all set.</div>
        </div>
      </div>
    </div>
  );
}

// An unscheduled tap: no roster to say when it ends, so the system never
// guesses. The teacher can close it, or an admin sets the end time.
function OpenCard({ running, pending, onNotice }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function doClose() {
    startTransition(async () => {
      const r = await clockOut();
      if (r?.error) onNotice(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-card border-[0.5px] border-gold bg-gold-soft/30 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[12px] font-semibold text-sage">Clocked in · no shift rostered</div>
          <div className="mt-1.5 font-heading text-4xl font-bold tabular-nums text-charcoal">
            {formatElapsed(Math.max(0, now - Date.parse(running.startedAt)))}
          </div>
          <div className="mt-1 text-[12px] text-charcoal-soft">
            {running.branch ? `${running.branch} · ` : ""}since {sgClock(running.startedAt)}
          </div>
        </div>
        <button
          type="button"
          onClick={doClose}
          disabled={pending || busy}
          className="flex items-center gap-2 rounded-control bg-ink px-5 py-3 text-[14px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
        >
          <Icon name="square" size={15} filled />
          {busy ? "Saving…" : "Clock out"}
        </button>
      </div>
      <div className="mt-3 rounded-control bg-white/70 p-3">
        <span className="mb-1.5 block text-[11px] font-semibold text-charcoal-soft">Location</span>
        <LocationTag
          value={running.geo}
          compact
          onChange={async (geo) => {
            const r = await setSessionLocation(running.id, geo);
            if (!r?.error) router.refresh();
            return r;
          }}
        />
      </div>
    </div>
  );
}

// ---- Roster rows -------------------------------------------------------

function UpcomingRow({ shift }) {
  const today = shift.date === sgToday();
  return (
    <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-charcoal">
            {sgClock(shift.startsAt)} – {sgClock(shift.endsAt)}
          </span>
          {shift.phName && (
            <span className="rounded-pill bg-sand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sage">
              {shift.phName}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-charcoal-soft">
          {today ? "Today" : sgDate(shift.startsAt)}
          {shift.branch ? ` · ${shift.branch}` : ""}
          {shift.category === "ot" ? ` · ${shift.otReason || "Ad-hoc / OT"}` : ""}
        </div>
      </div>
      <span className="shrink-0 text-[12px] text-charcoal-soft">{formatHM(shift.minutes)}</span>
    </div>
  );
}

// A past shift with no clock-in. Answering here is what the IT Heads used to
// have to ask for by hand every week.
function MissedRow({ shift, onNotice }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(MISSED_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const r = await explainMissed(shift.id, reason, detail);
      if (r?.error) onNotice(r.error);
      else {
        setOpen(false);
        onNotice("Thanks — that’s been sent to your IT Head.");
        router.refresh();
      }
    });
  }

  return (
    <div className="border-b-[0.5px] border-line px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-charcoal">
            {sgDate(shift.startsAt)} · {sgClock(shift.startsAt)} – {sgClock(shift.endsAt)}
          </div>
          <div className="mt-0.5 text-[12px] text-charcoal-soft">
            {shift.branch ? `${shift.branch} · ` : ""}
            {formatHM(shift.minutes)} · no clock-in recorded
          </div>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[12px] font-semibold text-charcoal transition-colors hover:bg-paper-deep"
          >
            Give a reason
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Labelled label="What happened?">
            <select className={field} value={reason} onChange={(e) => setReason(e.target.value)}>
              {MISSED_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Labelled>
          <Labelled label={reason === "Other" ? "Tell us more" : "Anything to add? (optional)"}>
            <input className={field} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </Labelled>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-control bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send to IT Head"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-control border-[0.5px] border-line bg-white px-4 py-2.5 text-[13px] font-semibold text-charcoal transition-colors hover:bg-paper-deep"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Session list ------------------------------------------------------

const STATUS_TONE = {
  approved: "bg-sage-soft text-sage",
  pending: "bg-gold-soft text-sage",
  rejected: "bg-rust-soft text-rust",
};

function SessionRow({ s, pay, onEdit, onDeleted }) {
  const [pending, startTransition] = useTransition();
  // A rostered shift isn't the teacher's to change — its times are the roster's,
  // and editing category or hours here would be editing their own pay.
  const editable = s.status === "pending" && !s.shiftId;

  function remove() {
    if (!confirm("Delete this session?")) return;
    startTransition(async () => {
      const r = await deleteSession(s.id);
      if (r?.error) alert(r.error);
      else onDeleted();
    });
  }

  const catLabel = s.category === "ot" ? s.otReason || "Ad-hoc / OT" : "Class teaching";

  return (
    <div className="flex items-center gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-semibold text-charcoal">{formatHM(s.minutes)}</span>
          <span
            className={`rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              s.category === "ot" ? "bg-paper-deep text-charcoal-soft" : "bg-sand/60 text-ink"
            }`}
          >
            {catLabel}
          </span>
          {s.phName && (
            <span className="rounded-pill bg-sand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sage" title={`Public holiday — paid at ×${PH_MULTIPLIER}`}>
              {s.phName}
            </span>
          )}
          {s.source === "unscheduled" && (
            <span className="rounded-pill bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-soft" title="No shift was rostered for this">
              Unscheduled
            </span>
          )}
          {s.long && (
            <span className="rounded-pill bg-rust-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rust" title="Over 12h or crosses midnight — check the times">
              Check times
            </span>
          )}
        </div>
        <div className="mt-1 text-[12px] text-charcoal-soft">
          {sgDate(s.startedAt)} · {sgClock(s.startedAt)}–{sgClock(s.endedAt)}
          {s.branch ? ` · ${s.branch}` : ""}
          {/* The rostered window is what pays; this is when they actually
              arrived. The two differing is normal. */}
          {s.clockInAt && s.shiftId ? ` · clocked in ${sgClock(s.clockInAt)}` : ""}
        </div>
        {s.geo && <LocationLine geo={s.geo} className="mt-1" />}
        {s.status === "rejected" && s.reviewerNote && (
          <div className="mt-1 text-[11px] text-rust">Rejected: {s.reviewerNote}</div>
        )}
      </div>

      <div className="text-right">
        <div className="text-[13px] font-semibold text-charcoal">{pay == null ? "—" : formatMoney(pay)}</div>
        <span className={`mt-0.5 inline-block rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_TONE[s.status]}`}>
          {s.status}
        </span>
      </div>

      {editable && (
        <div className="flex items-center gap-1">
          <IconBtn label="Edit" icon="pencil" onClick={onEdit} />
          <IconBtn label="Delete" icon="trash" danger disabled={pending} onClick={remove} />
        </div>
      )}
    </div>
  );
}

// ---- Add / edit modal --------------------------------------------------

function SessionModal({ modal, branchOptions, tierRate, onClose, onSaved }) {
  const editing = modal.mode === "edit";
  const s = modal.session || {};
  const [form, setForm] = useState({
    date: s.startedAt ? sgDate(s.startedAt) : sgToday(),
    start: s.startedAt ? sgTime24(s.startedAt) : "",
    end: s.endedAt ? sgTime24(s.endedAt) : "",
    category: s.category || "teaching",
    otReason: s.otReason || OT_REASONS[0],
    branch: s.branch || branchOptions[0] || "",
    note: s.note || "",
  });
  const [geo, setGeo] = useState(s.geo || null);
  // An untouched stamp is left exactly as it was saved; only a deliberate
  // re-take or removal is sent, so opening the modal can't rewrite a location.
  const [geoTouched, setGeoTouched] = useState(false);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Live preview of duration + pay.
  const preview = previewPay(form, tierRate);

  function submit() {
    setError(null);
    const payload = { id: s.id, ...form };
    if (geoTouched) {
      if (geo) payload.geo = geo;
      else payload.clearGeo = true;
    }
    startTransition(async () => {
      const r = editing ? await editSession(payload) : await addPastSession(payload);
      if (r?.error) setError(r.error);
      else onSaved();
    });
  }

  return (
    <Modal title={editing ? "Edit session" : "Add past session"} onClose={onClose}>
      <div className="space-y-3.5">
        <Segmented
          value={form.category}
          onChange={(v) => set("category", v)}
          options={[
            { value: "teaching", label: "Class teaching" },
            { value: "ot", label: "Ad-hoc / OT" },
          ]}
        />
        <Labelled label="Date">
          <input type="date" className={field} value={form.date} onChange={(e) => set("date", e.target.value)} />
        </Labelled>
        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Start">
            <input type="time" className={field} value={form.start} onChange={(e) => set("start", e.target.value)} />
          </Labelled>
          <Labelled label="End">
            <input type="time" className={field} value={form.end} onChange={(e) => set("end", e.target.value)} />
          </Labelled>
        </div>
        {form.category === "ot" && (
          <Labelled label="What for?">
            <select className={field} value={form.otReason} onChange={(e) => set("otReason", e.target.value)}>
              {OT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Labelled>
        )}
        <Labelled label="Branch">
          <select className={field} value={form.branch} onChange={(e) => set("branch", e.target.value)}>
            {branchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Note (optional)">
          <input className={field} value={form.note} onChange={(e) => set("note", e.target.value)} />
        </Labelled>

        {/* Shown for OT, and for anything already tagged — so switching the type
            can never strand a stamp somewhere the teacher can't reach it. */}
        {(form.category === "ot" || geo) && (
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">Location</span>
            <LocationTag
              value={geo}
              onChange={(g) => {
                setGeo(g);
                setGeoTouched(true);
              }}
            />
            {!geo && (
              <p className="mt-1 text-[11px] text-charcoal-soft">
                Tagging here records where you are <em>now</em>, not where you were during the session.
              </p>
            )}
          </div>
        )}

        {preview && (
          <p className="rounded-control bg-paper-deep px-3 py-2 text-[12px] text-charcoal">
            {formatHM(preview.minutes)}
            {preview.cents != null ? ` · about ${formatMoney(preview.cents)}` : ""}
          </p>
        )}
        {error && <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>}
      </div>
      <ModalActions pending={pending} onClose={onClose} onSave={submit} saveLabel={editing ? "Save changes" : "Add session"} />
    </Modal>
  );
}

function previewPay(form, tierRate) {
  if (!/^\d{2}:\d{2}$/.test(form.start) || !/^\d{2}:\d{2}$/.test(form.end)) return null;
  const [sh, sm] = form.start.split(":").map(Number);
  const [eh, em] = form.end.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) return null;
  const rate = form.category === "ot" ? OT_RATE : tierRate;
  return { minutes, cents: rate == null ? null : payCents(minutes, rate) };
}

// ---- Shared bits -------------------------------------------------------

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-card border-[0.5px] border-line bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft">{label}</div>
      <div className="mt-0.5 font-heading text-xl font-bold text-charcoal">{value}</div>
      {hint && <div className="text-[11px] text-charcoal-soft">{hint}</div>}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="flex gap-1 rounded-control bg-paper-deep p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-control px-3 py-2 text-[13px] font-semibold transition-colors ${
            value === o.value ? "bg-white text-ink shadow-sm" : "text-charcoal-soft hover:text-charcoal"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Labelled({ label, children, full }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">{label}</span>
      {children}
    </label>
  );
}

function IconBtn({ label, icon, onClick, disabled, danger }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-line bg-white transition-colors disabled:opacity-40 ${
        danger ? "text-charcoal-soft hover:bg-rust-soft hover:text-rust" : "text-charcoal-soft hover:bg-paper-deep hover:text-charcoal"
      }`}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-white p-5 shadow-[0_12px_40px_rgba(74,51,64,0.25)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-[17px] font-semibold text-charcoal">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal-soft hover:bg-paper-deep"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-0.5">{children}</div>
      </div>
    </>
  );
}

function ModalActions({ pending, onClose, onSave, saveLabel }) {
  return (
    <div className="mt-5 flex items-center justify-end gap-2">
      <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:text-charcoal">
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="rounded-control bg-ink px-5 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
      >
        {pending ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
