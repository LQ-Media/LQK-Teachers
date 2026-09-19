"use client";

// The payroll report: what Nurul used to build by exporting Sling, pasting into
// a sheet and adding it up by hand.
//
// It is organised by PAYROLL PERIOD, not calendar month, because that is what
// LQK actually pays on — August covers 27 July to 23 August. Showing months
// here would disagree with the payslip by a few days' shifts every time.
//
// The columns are the ones already in the "Teachers hours for payroll" sheet,
// in the same order, so a period can be diffed line-for-line against one done
// the old way before anybody trusts it.

import { useState, useTransition } from "react";
import Icon from "@/components/Icon";
import { payrollReport } from "@/lib/actions/payroll";
import { formatDuration } from "@/lib/hours/report";
import { periodRangeLabel, PAYROLL_PERIODS } from "@/lib/hours/periods";
import { formatHM, sgClock, sgDate } from "@/lib/hours/rates";

export default function PayrollReport({ initial }) {
  const [data, setData] = useState(initial);
  const [expanded, setExpanded] = useState(() => new Set());
  const [busy, startTransition] = useTransition();

  function load(key) {
    startTransition(async () => {
      const next = await payrollReport(key);
      setData(next);
      setExpanded(new Set());
    });
  }

  if (data?.error) {
    return (
      <div className="rounded-card border-[0.5px] border-gold bg-gold-soft/40 px-4 py-4 text-[13px] text-charcoal">
        {data.error}
      </div>
    );
  }

  const { period, blocks, totals, pastCutOff, countedTo } = data;
  const partial = countedTo < period.to;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            value={period.key}
            onChange={(e) => load(e.target.value)}
            disabled={busy}
            className="rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[13px] font-semibold text-charcoal"
          >
            {PAYROLL_PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} — {periodRangeLabel(p)}
              </option>
            ))}
          </select>
          {pastCutOff ? (
            <span className="rounded-pill bg-sand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sage">
              Cut-off passed
            </span>
          ) : null}
        </div>

        <a
          href={`/api/hours/report?period=${period.key}`}
          className="flex items-center gap-1.5 rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[12px] font-semibold text-charcoal transition-colors hover:bg-paper-deep"
        >
          <Icon name="download" size={15} /> Export CSV
        </a>
      </div>

      {partial && (
        <div className="mb-4 rounded-card border-[0.5px] border-gold bg-gold-soft/40 px-4 py-3 text-[13px] text-charcoal">
          This period runs to {sgDate(`${period.to}T12:00:00+08:00`)}. Only shifts up to {countedTo} have
          finished, so these totals will still grow.
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Teaching hours" value={totals.teachingHours} />
        <Stat label="OT hours" value={totals.otHours} />
        <Stat label="Tracked, unpaid" value={totals.trackedHours} muted />
        <Stat label="To chase" value={totals.flagged} warn={totals.flagged > 0} />
      </div>

      {!blocks.length ? (
        <div className="rounded-card border-[0.5px] border-line bg-white p-6 text-center text-[13px] text-charcoal-soft">
          No finished shifts in {period.label}.
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
          {blocks.map((b) => {
            const open = expanded.has(b.teacherId);
            return (
              <div key={b.teacherId} className="border-b-[0.5px] border-line last:border-0">
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(expanded);
                    if (open) next.delete(b.teacherId);
                    else next.add(b.teacherId);
                    setExpanded(next);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-deep/40"
                >
                  <span className={`text-charcoal-soft transition-transform ${open ? "rotate-90" : ""}`}>
                    <Icon name="arrow-left" size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-charcoal">{b.employee}</span>
                    <span className="mt-0.5 block text-[12px] text-charcoal-soft">
                      {b.rows.length} shift{b.rows.length === 1 ? "" : "s"}
                      {b.flaggedCount ? ` · ${b.flaggedCount} to chase` : ""}
                      {b.trackedHours ? ` · ${b.trackedHours}h tracked, unpaid` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[13px] font-semibold tabular-nums text-charcoal">
                      {b.teachingHours}h teaching
                    </span>
                    <span className="mt-0.5 block text-[12px] tabular-nums text-charcoal-soft">
                      {b.otHours}h OT
                    </span>
                  </span>
                </button>

                {open && (
                  <div className="overflow-x-auto border-t-[0.5px] border-line bg-paper-deep/20">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">
                          <th className="px-3 py-2 pl-11">Date</th>
                          <th className="px-3 py-2">Position</th>
                          <th className="px-3 py-2">Rostered</th>
                          <th className="px-3 py-2">Clock in</th>
                          <th className="px-3 py-2 text-right">Pays</th>
                          <th className="px-3 py-2 text-right">Rostered</th>
                          <th className="px-3 py-2 pr-4 text-right">Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.rows.map((r) => (
                          <tr key={r.shiftId} className="border-t-[0.5px] border-line/60 text-[12px] text-charcoal">
                            <td className="px-3 py-2 pl-11 whitespace-nowrap">{r.date}</td>
                            <td className="px-3 py-2">
                              {r.position}
                              {r.trackedOnly && (
                                <span className="ml-1.5 rounded-pill bg-sand px-1.5 py-0.5 text-[10px] font-bold uppercase text-sage">
                                  unpaid
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-charcoal-soft">
                              {r.schStart}–{r.schEnd}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {r.clockIn || <span className="text-rust">—</span>}
                              {r.attendance === "late" && (
                                <span className="ml-1.5 text-[11px] text-gold">{r.lateMinutes}m late</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatDuration(r.payableMinutes)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-charcoal-soft">
                              {formatDuration(r.scheduledMinutes)}
                            </td>
                            <td className="px-3 py-2 pr-4 text-right tabular-nums">
                              {r.differenceMinutes ? (
                                <span className="text-rust">{formatDuration(r.differenceMinutes)}</span>
                              ) : (
                                <span className="text-charcoal-soft">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {b.rows.some((r) => r.note) && (
                      <div className="border-t-[0.5px] border-line/60 px-4 py-2.5 pl-11">
                        {b.rows
                          .filter((r) => r.note)
                          .map((r) => (
                            <div key={r.shiftId} className="text-[12px] text-charcoal-soft">
                              <span className="font-semibold text-charcoal">{r.date}:</span>{" "}
                              <span className="whitespace-pre-line">{r.note}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, muted, warn }) {
  return (
    <div
      className={`rounded-card border-[0.5px] px-4 py-3 ${
        warn ? "border-gold bg-gold-soft/40" : "border-line bg-white"
      }`}
    >
      <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">{label}</div>
      <div
        className={`mt-1 font-heading text-2xl font-bold tabular-nums ${
          muted ? "text-charcoal-soft" : "text-charcoal"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
