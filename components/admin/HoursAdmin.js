"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { LocationLine } from "@/components/hours/LocationTag";
import { approveSession, rejectSession, hoursAdminData } from "@/lib/actions/hours";
import {
  TIER_BY_KEY,
  PH_MULTIPLIER,
  rateFor,
  sessionPayCents,
  formatHM,
  formatMoney,
  monthLabel,
  shiftMonth,
  sgDate,
  sgClock,
} from "@/lib/hours/rates";

export default function HoursAdmin({ initial }) {
  const router = useRouter();
  const [month, setMonth] = useState(initial.month);
  const [pending, setPending] = useState(initial.pending);
  const [summary, setSummary] = useState(initial.summary);
  const [busy, startTransition] = useTransition();

  function reload(nextMonth = month) {
    startTransition(async () => {
      const data = await hoursAdminData(nextMonth);
      setMonth(data.month);
      setPending(data.pending);
      setSummary(data.summary);
      router.refresh();
    });
  }

  function approve(s) {
    startTransition(async () => {
      const r = await approveSession(s.id);
      if (r?.error) alert(r.error);
      reload();
    });
  }
  /**
   * Approve everything straightforward in one go.
   *
   * Under the roster this queue fills with a clock-in per shift — roughly 385 a
   * week across the staff — and approving them one at a time is not a job
   * anybody will keep doing. "Clean" means rostered, on a normal day, with a
   * pay tier set; anything an admin should actually look at (unscheduled taps,
   * OT, accepted missed shifts, public holidays, odd-looking times) is left in
   * the queue.
   */
  function approveClean() {
    const clean = pending.filter(
      (s) =>
        s.shiftId &&
        s.source === "clock_in" &&
        !s.phName &&
        !s.long &&
        rateFor(s.category, s.payTier) != null
    );
    if (!clean.length) return;
    if (!confirm(`Approve ${clean.length} rostered shift${clean.length === 1 ? "" : "s"}? Anything needing a look stays in the queue.`)) return;
    startTransition(async () => {
      const errors = [];
      for (const s of clean) {
        const r = await approveSession(s.id);
        if (r?.error) errors.push(`${s.teacherName}: ${r.error}`);
      }
      if (errors.length) alert(`${errors.length} couldn't be approved:\n\n${errors.slice(0, 5).join("\n")}`);
      reload();
    });
  }

  function reject(s) {
    const note = prompt(`Reject ${s.teacherName}'s ${formatHM(s.minutes)} session? Add a reason (optional):`, "");
    if (note === null) return; // cancelled
    startTransition(async () => {
      const r = await rejectSession(s.id, note);
      if (r?.error) alert(r.error);
      reload();
    });
  }

  // How many the bulk button would take, so it can name the number.
  const cleanCount = pending.filter(
    (s) => s.shiftId && s.source === "clock_in" && !s.phName && !s.long && rateFor(s.category, s.payTier) != null
  ).length;

  const totalApproved = summary.reduce((a, t) => a + t.approvedCents, 0);
  const totalPending = summary.reduce((a, t) => a + t.pendingCents, 0);

  return (
    <div className="space-y-7">
      {/* Pending approvals */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-[15px] font-semibold text-charcoal">
            Pending approval {pending.length ? `(${pending.length})` : ""}
          </h2>
          {cleanCount > 0 && (
            <button
              type="button"
              onClick={approveClean}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[12px] font-semibold text-charcoal transition-colors hover:bg-paper-deep disabled:opacity-40"
            >
              <Icon name="check" size={15} />
              Approve {cleanCount} rostered
            </button>
          )}
        </div>
        {pending.length === 0 ? (
          <div className="rounded-card border-[0.5px] border-line bg-white p-6 text-center text-[13px] text-charcoal-soft">
            Nothing waiting — all caught up.
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
            {pending.map((s) => {
              const rate = rateFor(s.category, s.payTier);
              // Nothing is snapshotted until approval, so a public-holiday row
              // is estimated at today's multiplier.
              const est = rate == null ? null : sessionPayCents(s.minutes, rate, s.phName ? PH_MULTIPLIER : null);
              const noTier = s.category === "teaching" && rate == null;
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13px] font-semibold text-charcoal">{s.teacherName}</span>
                      <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.category === "ot" ? "bg-paper-deep text-charcoal-soft" : "bg-sand/60 text-ink"}`}>
                        {s.category === "ot" ? s.otReason || "Ad-hoc / OT" : "Class teaching"}
                      </span>
                      {s.phName && (
                        <span className="rounded-pill bg-sand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sage" title={`Public holiday — pays x${PH_MULTIPLIER}`}>
                          {s.phName} ×{PH_MULTIPLIER}
                        </span>
                      )}
                      {s.source === "unscheduled" && (
                        <span className="rounded-pill bg-rust-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rust" title="No shift was rostered — check the end time before approving">
                          Unscheduled
                        </span>
                      )}
                      {s.source === "missed_accepted" && (
                        <span className="rounded-pill bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-soft">
                          Missed — accepted
                        </span>
                      )}
                      {s.long && (
                        <span className="rounded-pill bg-rust-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rust" title="Over 12h or crosses midnight">
                          Check times
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[12px] text-charcoal-soft">
                      {sgDate(s.startedAt)} · {sgClock(s.startedAt)}–{sgClock(s.endedAt)}
                      {s.branch ? ` · ${s.branch}` : ""}
                      {/* The times above are the ROSTERED window, which is what
                          pays. This is when they actually arrived. */}
                      {s.clockInAt && s.shiftId ? ` · clocked in ${sgClock(s.clockInAt)}` : ""}
                    </div>
                    {/* Where the teacher tagged themselves, if they did — a
                        sanity check on OT before it's paid. */}
                    {s.geo && <LocationLine geo={s.geo} className="mt-1" />}
                    {noTier && <div className="mt-1 text-[11px] text-rust">Set this teacher’s pay tier before approving.</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-semibold text-charcoal">{formatHM(s.minutes)}</div>
                    <div className="text-[11px] text-charcoal-soft">{est == null ? "—" : formatMoney(est)}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => approve(s)}
                      disabled={busy || noTier}
                      className="flex items-center gap-1.5 rounded-control bg-ink px-3 py-2 text-[12px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-40"
                    >
                      <Icon name="check" size={14} /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => reject(s)}
                      disabled={busy}
                      className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-line bg-white text-charcoal-soft transition-colors hover:bg-rust-soft hover:text-rust disabled:opacity-40"
                      aria-label="Reject"
                      title="Reject"
                    >
                      <Icon name="x" size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Monthly payroll */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => reload(shiftMonth(month, -1))} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-line bg-white text-charcoal-soft hover:bg-paper-deep disabled:opacity-40" aria-label="Previous month">
              <Icon name="arrow-left" size={15} />
            </button>
            <span className="min-w-[9rem] text-center font-heading text-[15px] font-semibold text-charcoal">{monthLabel(month)}</span>
            <button type="button" onClick={() => reload(shiftMonth(month, 1))} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-line bg-white text-charcoal-soft hover:bg-paper-deep disabled:opacity-40 rotate-180" aria-label="Next month">
              <Icon name="arrow-left" size={15} />
            </button>
          </div>
          <a
            href={`/api/hours/export?month=${month}`}
            className="flex items-center gap-1.5 rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[12px] font-semibold text-charcoal transition-colors hover:bg-paper-deep"
          >
            <Icon name="download" size={15} /> Export CSV
          </a>
        </div>

        {summary.length === 0 ? (
          <div className="rounded-card border-[0.5px] border-line bg-white p-6 text-center text-[13px] text-charcoal-soft">
            No hours logged for {monthLabel(month)}.
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b-[0.5px] border-line text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">
                    <th className="px-3 py-2.5 pl-4">Teacher</th>
                    <th className="px-3 py-2.5 text-right">Teaching</th>
                    <th className="px-3 py-2.5 text-right">OT</th>
                    <th className="px-3 py-2.5 text-right">Approved</th>
                    <th className="px-3 py-2.5 text-right">Pending</th>
                    <th className="px-3 py-2.5 pr-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((t) => {
                    const tier = TIER_BY_KEY[t.payTier];
                    const noTier = t.teachingMinutes > 0 && !tier;
                    return (
                      <tr key={t.teacherId} className="border-b-[0.5px] border-line last:border-0 align-middle">
                        <td className="py-3 pl-4 pr-3">
                          <div className="text-[13px] font-semibold text-charcoal">{t.teacherName}</div>
                          <div className={`text-[11px] ${noTier ? "text-rust" : "text-charcoal-soft"}`}>
                            {tier ? tier.short : noTier ? "No pay tier set" : "OT only"}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-[13px] text-charcoal">{formatHM(t.teachingMinutes)}</td>
                        <td className="px-3 py-3 text-right text-[13px] text-charcoal">{formatHM(t.otMinutes)}</td>
                        <td className="px-3 py-3 text-right text-[13px] text-charcoal">{formatMoney(t.approvedCents)}</td>
                        <td className="px-3 py-3 text-right text-[13px] text-charcoal-soft">
                          {t.pendingCents ? formatMoney(t.pendingCents) : "—"}
                          {t.pendingCount ? <span className="ml-1 text-[10px]">({t.pendingCount})</span> : null}
                        </td>
                        <td className="px-3 py-3 pr-4 text-right text-[13px] font-bold text-charcoal">
                          {formatMoney(t.approvedCents + t.pendingCents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-paper-deep/50 text-[13px] font-bold text-charcoal">
                    <td className="py-3 pl-4 pr-3">Total</td>
                    <td className="px-3 py-3" />
                    <td className="px-3 py-3" />
                    <td className="px-3 py-3 text-right">{formatMoney(totalApproved)}</td>
                    <td className="px-3 py-3 text-right text-charcoal-soft">{totalPending ? formatMoney(totalPending) : "—"}</td>
                    <td className="px-3 py-3 pr-4 text-right">{formatMoney(totalApproved + totalPending)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="border-t-[0.5px] border-line px-4 py-2.5 text-[11px] text-charcoal-soft">
              Approved uses each teacher’s locked-in rate. Pending is an estimate at their current rate and isn’t final until approved.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
