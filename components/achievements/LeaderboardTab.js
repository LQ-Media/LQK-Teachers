"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { nominateColleague } from "@/lib/actions/achievements";
import { formatPoints } from "@/lib/achievements/points";
import { monthLabel } from "@/lib/hours/rates";
import { titleCase } from "@/components/tracker/util";
import Icon from "@/components/Icon";
import { Avatar, Card, Empty, field, Pill, ProgressBar, SectionTitle, StarRow } from "./ui";
import EmptyArt from "@/components/EmptyArt";

/**
 * The two social views. Only a Top 5 is ever listed, and each row shows a score
 * with no ordinal beyond the top three — so being absent from the podium says
 * nothing about where you placed. Hours and pay never appear here.
 */
export default function LeaderboardTab({
  scope,
  season,
  me,
  rows = [],
  allTime = [],
  branches = [],
  myBranch,
  monthlyTitle,
  recentHonours = [],
  colleagues = [],
  iNominatedThisMonth,
}) {
  const isOrg = scope === "org";
  const heading = isOrg ? "Everyone" : myBranch ? titleCase(myBranch) : "Your branch";

  return (
    <div className="space-y-8">
      {isOrg && monthlyTitle && (
        <div className="rounded-card bg-gradient-to-br from-gold-soft to-[#EEE9F7] p-6">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gold text-white">
              <Icon name="trophy" size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#4A3D63]">
                {monthlyTitle.title} · {monthLabel(season)}
              </div>
              <div className="font-heading text-[19px] font-bold text-charcoal">
                {titleCase(monthlyTitle.name)}
              </div>
              {monthlyTitle.reason && (
                <p className="mt-0.5 text-[12px] text-charcoal-soft">{monthlyTitle.reason}</p>
              )}
            </div>
            <Avatar src={monthlyTitle.avatar} name={monthlyTitle.name} size={48} />
          </div>
        </div>
      )}

      <div>
        <SectionTitle note={monthLabel(season)}>{heading} · Top 5 this season</SectionTitle>
        {rows.length === 0 ? (
          <EmptyArt art="achievements">
            No points scored {isOrg ? "yet" : "in this branch yet"} this season. Reading in the Quran
            reader is the quickest way onto the board.
          </EmptyArt>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r, i) => (
              <PodiumRow key={r.id} row={r} place={i + 1} isMe={me?.id === r.id} />
            ))}
          </div>
        )}
        {me && (
          <p className="mt-3 text-[11px] text-charcoal-soft">
            Only the top five are shown. Your own position is on the <strong>Me</strong> tab and
            visible to nobody else.
          </p>
        )}
      </div>

      {/* Branch vs branch — teams compete, individuals are not ranked here. */}
      {branches.length > 1 && (
        <div>
          <SectionTitle note="Branch totals">Branch vs branch</SectionTitle>
          <Card>
            <ul className="space-y-3">
              {branches.map((b) => {
                const top = branches[0]?.month || 1;
                return (
                  <li key={b.branch} className="flex items-center gap-3">
                    <span
                      className={`w-40 truncate text-[13px] ${
                        b.branch === myBranch ? "font-semibold text-charcoal" : "text-charcoal-soft"
                      }`}
                    >
                      {titleCase(b.branch)}
                    </span>
                    <ProgressBar value={top ? b.month / top : 0} className="flex-1" />
                    <span className="w-24 text-right text-[12px] text-charcoal-soft">
                      {formatPoints(b.month)} pts
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 border-t-[0.5px] border-line pt-3 text-[11px] text-charcoal-soft">
              Totals, not averages — a bigger branch has more people scoring.
            </p>
          </Card>
        </div>
      )}

      {isOrg && (
        <>
          <div>
            <SectionTitle note="All time">Hall of fame</SectionTitle>
            {allTime.length === 0 ? (
              <Empty>Nothing here yet.</Empty>
            ) : (
              <Card className="p-0">
                <ul>
                  {allTime.map((r, i) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0"
                    >
                      <span className="w-5 text-[12px] font-bold text-charcoal-soft">{i + 1}</span>
                      <Avatar src={r.avatar} name={r.name} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-charcoal">
                          {titleCase(r.name)}
                        </div>
                        <div className="text-[11px] text-charcoal-soft">
                          {r.branch ? titleCase(r.branch) : "—"}
                        </div>
                      </div>
                      <StarRow level={r.level.level} size={11} />
                      <span className="w-20 text-right font-heading text-[14px] font-bold text-charcoal">
                        {formatPoints(r.allTime)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <SectionTitle>Recent recognition</SectionTitle>
              {recentHonours.length === 0 ? (
                <Empty>No honours awarded yet.</Empty>
              ) : (
                <div className="space-y-2.5">
                  {recentHonours.map((h) => (
                    <Card key={h.id} className="flex items-start gap-3 p-4">
                      <Avatar src={h.avatar} name={h.name} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-charcoal">
                            {titleCase(h.name)}
                          </span>
                          <Pill tone="gold">{h.title}</Pill>
                        </div>
                        {h.reason && <p className="mt-0.5 text-[12px] text-charcoal-soft">{h.reason}</p>}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <NominatePanel colleagues={colleagues} already={iNominatedThisMonth} season={season} />
          </div>
        </>
      )}
    </div>
  );
}

function PodiumRow({ row, place, isMe }) {
  const medal = place === 1 ? "bg-gold-soft text-ink" : place === 2 ? "bg-sand text-ink" : place === 3 ? "bg-sage-soft text-sage" : "bg-paper-deep text-charcoal-soft";
  return (
    <Card
      className={`flex items-center gap-3 p-4 ${isMe ? "border-gold/50 bg-gold-soft/20" : ""}`}
    >
      <span
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full font-heading text-[14px] font-bold ${medal}`}
      >
        {place}
      </span>
      <Avatar src={row.avatar} name={row.name} size={38} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-charcoal">{titleCase(row.name)}</span>
          {isMe && <Pill tone="gold">You</Pill>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-charcoal-soft">
          {row.branch && <span>{titleCase(row.branch)}</span>}
          {row.currentStreak > 0 && (
            <span className="flex items-center gap-1">
              <Icon name="flame" size={11} /> {row.currentStreak}-day streak
            </span>
          )}
          {row.juzCompleted > 0 && <span>{row.juzCompleted} juz</span>}
        </div>
      </div>
      <div className="text-right">
        <div className="font-heading text-[17px] font-bold text-charcoal">{formatPoints(row.month)}</div>
        <StarRow level={row.level.level} size={10} />
      </div>
    </Card>
  );
}

function NominatePanel({ colleagues, already, season }) {
  const router = useRouter();
  const [nomineeId, setNomineeId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await nominateColleague({ nomineeId, reason });
      if (r?.error) {
        setError(r.error);
        return;
      }
      setDone(true);
      setNomineeId("");
      setReason("");
      router.refresh();
    });
  }

  if (already || done) {
    return (
      <div>
        <SectionTitle>Nominate a colleague</SectionTitle>
        <Card className="flex items-start gap-3">
          <span className="mt-0.5 text-sage">
            <Icon name="check" size={18} />
          </span>
          <p className="text-[13px] text-charcoal">
            You’ve nominated someone for {monthLabel(season)}. An admin will review it — thank you.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle note="Once a month">Nominate a colleague</SectionTitle>
      <Card>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-charcoal">Who deserves it?</span>
            <select className={field} value={nomineeId} onChange={(e) => setNomineeId(e.target.value)}>
              <option value="">Choose a colleague…</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>
                  {titleCase(c.name)}
                  {c.branch ? ` — ${titleCase(c.branch)}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-charcoal">Why?</span>
            <textarea
              className={`${field} min-h-[76px] resize-y`}
              value={reason}
              maxLength={300}
              placeholder="What did they do? A sentence is plenty."
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && (
            <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-charcoal-soft">Your name is shown with it.</p>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !nomineeId || reason.trim().length < 10}
              className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-50"
            >
              {pending ? "Sending…" : "Nominate"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
