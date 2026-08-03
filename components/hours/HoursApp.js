"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import { clockIn, clockOut, addPastSession, editSession, deleteSession } from "@/lib/actions/hours";
import {
  OT_REASONS,
  OT_RATE,
  rateFor,
  payCents,
  formatHM,
  formatMoney,
  sgClock,
  sgDate,
  sgTime24,
  sgToday,
} from "@/lib/hours/rates";

const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

export default function HoursApp({ firstName, payTier, tierRate, monthName, branchOptions, running, sessions, totals }) {
  const router = useRouter();
  const [modal, setModal] = useState(null); // {mode, session?}
  const [notice, setNotice] = useState(null);

  // Approved uses the snapshotted rate; pending is estimated at the current rate.
  function rateOf(s) {
    if (s.status === "approved" && s.rateCents != null) return s.rateCents / 100;
    return rateFor(s.category, payTier);
  }
  function payOf(s) {
    const r = rateOf(s);
    return r == null ? null : payCents(s.minutes, r);
  }

  const estCents = totals.approvedCents + totals.pendingCents;

  return (
    <div className="p-6 sm:p-8 max-w-3xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <PageHeading
          icon="clock"
          title="Work hours"
          subtitle={`Clock in when you start, clock out when you’re done. ${monthName}.`}
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

      <ClockCard
        running={running}
        branchOptions={branchOptions}
        tierRate={tierRate}
        onNotice={setNotice}
        onEditRunning={(s) => setModal({ mode: "edit", session: s })}
      />

      {/* This month's sessions */}
      <div className="mt-7 mb-3 flex items-center justify-between">
        <h2 className="font-heading text-[15px] font-semibold text-charcoal">This month</h2>
        <button
          type="button"
          onClick={() => setModal({ mode: "add" })}
          className="flex items-center gap-1.5 rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[12px] font-semibold text-charcoal transition-colors hover:bg-paper-deep"
        >
          <Icon name="plus" size={15} />
          Add past session
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-card border-[0.5px] border-line bg-white p-8 text-center text-[13px] text-charcoal-soft">
          No sessions logged this month yet.
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

// ---- Clock in / out card ----------------------------------------------

function ClockCard({ running, branchOptions, tierRate, onNotice, onEditRunning }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState("teaching");
  const [otReason, setOtReason] = useState(OT_REASONS[0]);
  const [branch, setBranch] = useState(branchOptions[0] || "");
  const [note, setNote] = useState("");

  function doClockIn() {
    startTransition(async () => {
      const r = await clockIn({ category, otReason, branch, note });
      if (r?.error) onNotice(r.error);
      else {
        setNote("");
        router.refresh();
      }
    });
  }
  function doClockOut() {
    startTransition(async () => {
      const r = await clockOut();
      if (r?.error) onNotice(r.error);
      else {
        if (r?.long) onNotice("Clocked out. That session ran long — open it below to fix the end time if you forgot to clock out.");
        router.refresh();
      }
    });
  }

  if (running) {
    return <RunningCard running={running} pending={pending} onClockOut={doClockOut} onEdit={() => onEditRunning(running)} />;
  }

  const rateHint =
    category === "ot"
      ? `Paid at $${OT_RATE}/hr`
      : tierRate != null
        ? `Paid at your rate: $${tierRate}/hr`
        : "Ask an admin to set your pay tier";

  return (
    <div className="rounded-card border-[0.5px] border-line bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">Start a session</span>
        <span className="text-[11px] text-charcoal-soft">{rateHint}</span>
      </div>

      <Segmented
        value={category}
        onChange={setCategory}
        options={[
          { value: "teaching", label: "Class teaching" },
          { value: "ot", label: "Ad-hoc / OT" },
        ]}
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {category === "ot" && (
          <Labelled label="What for?">
            <select className={field} value={otReason} onChange={(e) => setOtReason(e.target.value)}>
              {OT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Labelled>
        )}
        <Labelled label="Branch">
          <select className={field} value={branch} onChange={(e) => setBranch(e.target.value)}>
            {branchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Note (optional)" full={category !== "ot"}>
          <input className={field} value={note} placeholder="e.g. covering for Ustazah Nur" onChange={(e) => setNote(e.target.value)} />
        </Labelled>
      </div>

      <button
        type="button"
        onClick={doClockIn}
        disabled={pending}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-control bg-ink px-5 py-3 text-[14px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60 sm:w-auto"
      >
        <Icon name="play" size={16} filled />
        {pending ? "Starting…" : "Clock in"}
      </button>
    </div>
  );
}

function RunningCard({ running, pending, onClockOut, onEdit }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsedMs = Math.max(0, now - Date.parse(running.startedAt));
  const catLabel = running.category === "ot" ? running.otReason || "Ad-hoc / OT" : "Class teaching";
  const longRunning = elapsedMs > 12 * 60 * 60 * 1000;

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
          <div className="mt-1.5 font-heading text-4xl font-bold tabular-nums text-charcoal">{formatElapsed(elapsedMs)}</div>
          <div className="mt-1 text-[12px] text-charcoal-soft">
            {catLabel}
            {running.branch ? ` · ${running.branch}` : ""} · since {sgClock(running.startedAt)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClockOut}
          disabled={pending}
          className="flex items-center gap-2 rounded-control bg-ink px-5 py-3 text-[14px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
        >
          <Icon name="square" size={15} filled />
          {pending ? "Saving…" : "Clock out"}
        </button>
      </div>
      {longRunning && (
        <p className="mt-3 rounded-control bg-white/70 px-3 py-2 text-[12px] text-charcoal">
          This has been running over 12 hours. If you forgot to clock out, clock out now and then{" "}
          <button type="button" onClick={onEdit} className="font-semibold text-sage underline">
            fix the end time
          </button>
          .
        </p>
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
  const editable = s.status === "pending";

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
          {s.long && (
            <span className="rounded-pill bg-rust-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rust" title="Over 12h or crosses midnight — check the times">
              Check times
            </span>
          )}
        </div>
        <div className="mt-1 text-[12px] text-charcoal-soft">
          {sgDate(s.startedAt)} · {sgClock(s.startedAt)}–{sgClock(s.endedAt)}
          {s.branch ? ` · ${s.branch}` : ""}
        </div>
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
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-white p-5 shadow-[0_12px_40px_rgba(58,48,38,0.25)]"
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
