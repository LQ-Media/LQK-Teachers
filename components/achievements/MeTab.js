"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadCertificate, deleteCertificate } from "@/lib/actions/achievements";
import { BADGE_GROUPS, formatPoints, MAX_LEVEL } from "@/lib/achievements/points";
import { monthLabel } from "@/lib/hours/rates";
import { fmtDate, titleCase } from "@/components/tracker/util";
import Icon from "@/components/Icon";
import { Avatar, Card, Empty, field, Pill, Points, ProgressBar, SectionTitle, StarRow, StatTile } from "./ui";

export default function MeTab({ me, season, myCerts, certTypes, myHonours, myNominations }) {
  if (!me) {
    return <Empty>We couldn’t find your account’s scores. Ask an admin to check your profile.</Empty>;
  }

  const s = me.stats;
  const earned = me.badges.filter((b) => b.earned);
  const locked = me.badges.filter((b) => !b.earned);

  return (
    <div className="space-y-8">
      {/* Level card */}
      <div className="rounded-card bg-gradient-to-br from-sand to-[#F7E9D2] p-6 shadow-[0_8px_24px_rgba(59,55,43,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar src={me.avatar} name={me.name} size={52} />
            <div>
              <div className="font-heading text-[19px] font-bold text-charcoal">{titleCase(me.name)}</div>
              <div className="text-[12px] text-charcoal-soft">
                {me.branch ? titleCase(me.branch) : "No branch set"}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-heading text-[28px] font-bold leading-none text-ink">
              {formatPoints(me.allTime)}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft">
              points all time
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="font-heading text-[14px] font-bold text-charcoal">Level {me.level.level}</span>
              <StarRow level={me.level.level} />
            </div>
            <span className="text-[12px] text-charcoal-soft">
              {me.level.nextAt
                ? `${formatPoints(me.level.toNext)} pts to Level ${me.level.level + 1}`
                : `Level ${MAX_LEVEL} — the top`}
            </span>
          </div>
          <ProgressBar value={me.level.progress} className="bg-white/60" />
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon="flame"
          label="Reading streak"
          value={s.currentStreak ? `${s.currentStreak} day${s.currentStreak === 1 ? "" : "s"}` : "—"}
          note={s.longestStreak ? `Best: ${s.longestStreak} days` : "Open the Quran reader to start"}
        />
        <StatTile
          icon="trending-up"
          label="This season"
          value={formatPoints(me.month)}
          note={monthLabel(season)}
        />
        <StatTile
          icon="book-open"
          label="Surahs complete"
          value={String(s.surahsCompleted)}
          note={s.juzCompleted ? `${s.juzCompleted} juz complete` : "From your lesson records"}
        />
        <StatTile
          icon="clipboard-check"
          label="Lessons logged"
          value={String(s.lessonsLogged)}
          note="For your colleagues"
        />
      </div>

      {/* Standing — private to you, so nobody is shown below a colleague */}
      {(me.standing.org || me.standing.branch) && (
        <Card className="bg-paper">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-charcoal-soft">
              Your standing
            </span>
            {me.standing.branch && (
              <span className="text-[13px] text-charcoal">
                {titleCase(me.branch)}:{" "}
                <strong className="font-semibold">
                  #{me.standing.branch.position} of {me.standing.branch.of}
                </strong>
              </span>
            )}
            {me.standing.org && (
              <span className="text-[13px] text-charcoal">
                Everyone:{" "}
                <strong className="font-semibold">top {me.standing.org.topPercent}%</strong>
              </span>
            )}
            <span className="text-[11px] text-charcoal-soft">Only you can see this.</span>
          </div>
        </Card>
      )}

      {/* Point breakdown */}
      <div>
        <SectionTitle note={`Season: ${monthLabel(season)}`}>Where your points come from</SectionTitle>
        <Card>
          <ul className="space-y-2.5">
            {[
              ["Reading", "flame", me.byCategory.reading, me.monthByCategory.reading],
              ["Hafalan", "book-open", me.byCategory.hafalan, me.monthByCategory.hafalan],
              ["Teaching", "clipboard-check", me.byCategory.teaching, me.monthByCategory.teaching],
              ["Recognition", "award", me.byCategory.recognition, me.monthByCategory.recognition],
            ].map(([label, icon, allTime, month]) => (
              <li key={label} className="flex items-center gap-3">
                <span className="text-charcoal-soft">
                  <Icon name={icon} size={16} />
                </span>
                <span className="w-24 text-[13px] text-charcoal">{label}</span>
                <ProgressBar value={me.allTime ? allTime / me.allTime : 0} className="flex-1" />
                <span className="w-28 text-right text-[12px] text-charcoal-soft">
                  <Points n={allTime} className="text-charcoal" />
                  {month ? <span className="text-sage"> +{formatPoints(month)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t-[0.5px] border-line pt-3 text-[11px] text-charcoal-soft">
            The bold figure is all time; the number after it is what you’ve added this season. Work
            hours never count toward points.
          </p>
        </Card>
      </div>

      {/* Badges */}
      <div>
        <SectionTitle note={`${earned.length} of ${me.badges.length} earned`}>Badges</SectionTitle>
        <div className="space-y-5">
          {BADGE_GROUPS.map((group) => {
            const inGroup = me.badges.filter((b) => b.group === group);
            if (!inGroup.length) return null;
            return (
              <div key={group}>
                <div className="mb-2 flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/badge/${group.toLowerCase()}.png`}
                    alt=""
                    aria-hidden="true"
                    width={28}
                    height={28}
                    className="h-7 w-7 flex-shrink-0 rounded-[8px] object-cover"
                  />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-charcoal-soft">
                    {group}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {inGroup.map((b) => (
                    <BadgeTile key={b.key} badge={b} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {locked.length > 0 && (
          <p className="mt-3 text-[11px] text-charcoal-soft">
            Faded badges show what earns them — nothing is hidden.
          </p>
        )}
      </div>

      {/* Recognition */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle>Honours</SectionTitle>
          {myHonours.length === 0 ? (
            <Empty>No honours yet.</Empty>
          ) : (
            <div className="space-y-2.5">
              {myHonours.map((h) => (
                <Card key={h.id} className="flex items-start gap-3 p-4">
                  <span className="mt-0.5 text-gold">
                    <Icon name={h.kind === "monthly" ? "trophy" : "award"} size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-charcoal">{h.title}</span>
                      {h.kind === "monthly" && h.month && <Pill tone="gold">{monthLabel(h.month)}</Pill>}
                    </div>
                    {h.reason && <p className="mt-0.5 text-[12px] text-charcoal-soft">{h.reason}</p>}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {myNominations.length > 0 && (
            <div className="mt-5">
              <SectionTitle note={`${myNominations.length} confirmed`}>What colleagues said</SectionTitle>
              <div className="space-y-2.5">
                {myNominations.map((n) => (
                  <Card key={n.id} className="p-4">
                    <p className="text-[13px] italic text-charcoal">“{n.reason}”</p>
                    <p className="mt-1.5 text-[11px] text-charcoal-soft">
                      — {titleCase(n.from)}
                      {n.month ? `, ${monthLabel(n.month)}` : ""}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        <CertificatesPanel myCerts={myCerts} certTypes={certTypes} />
      </div>
    </div>
  );
}

function BadgeTile({ badge }) {
  const earned = badge.earned;
  return (
    <div
      className={`flex items-start gap-3 rounded-card border-[0.5px] p-4 transition-colors ${
        earned ? "border-gold/40 bg-gold-soft/25" : "border-line bg-white/50"
      }`}
    >
      <span
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
          earned ? "bg-gold text-white" : "bg-paper-deep text-charcoal-soft/60"
        }`}
      >
        <Icon name={earned ? badge.icon : "lock"} size={17} />
      </span>
      <div className="min-w-0">
        <div className={`text-[13px] font-semibold ${earned ? "text-charcoal" : "text-charcoal-soft"}`}>
          {badge.name}
        </div>
        <div className="text-[11px] leading-snug text-charcoal-soft">{badge.criterion}</div>
      </div>
    </div>
  );
}

function CertificatesPanel({ myCerts, certTypes }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [pending, start] = useTransition();
  const [removing, startRemove] = useTransition();
  const activeTypes = certTypes.filter((t) => t.active);

  // Submitted through a transition rather than useActionState so success can
  // close the form directly, with no state-syncing effect.
  function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setError(null);
    start(async () => {
      const r = await uploadCertificate(null, data);
      if (r?.error) {
        setError(r.error);
        return;
      }
      form.reset();
      setOpen(false);
      router.refresh();
    });
  }

  function remove(cert) {
    if (!confirm(`Remove your "${cert.name}" submission?`)) return;
    startRemove(async () => {
      const r = await deleteCertificate(cert.id);
      if (r?.error) alert(r.error);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-[15px] font-bold text-charcoal">Certificates</h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-gold hover:text-gold-hover"
        >
          <Icon name={open ? "x" : "upload"} size={14} />
          {open ? "Cancel" : "Add one"}
        </button>
      </div>

      {open && (
        <Card className="mb-3">
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-charcoal">Which certificate?</span>
              <select name="cert_type_id" className={field} required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {activeTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-charcoal">Issued by</span>
                <input name="issuer" className={field} placeholder="optional" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-charcoal">Date issued</span>
                <input name="issued_on" type="date" className={field} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-charcoal">Photo or scan</span>
              <input
                name="image"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
                className="w-full text-[12px] text-charcoal-soft file:mr-3 file:rounded-control file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-paper"
              />
              <span className="mt-1 block text-[11px] text-charcoal-soft">
                Only you and an admin can open this file. Up to 8 MB.
              </span>
            </label>
            {error && (
              <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
            >
              {pending ? "Uploading…" : "Submit for approval"}
            </button>
          </form>
        </Card>
      )}

      {myCerts.length === 0 ? (
        <Empty>No certificates yet. Add one and an admin will verify it.</Empty>
      ) : (
        <div className="space-y-2.5">
          {myCerts.map((c) => (
            <Card key={c.id} className="flex items-start gap-3 p-4">
              <span
                className={`mt-0.5 ${
                  c.status === "approved" ? "text-sage" : c.status === "rejected" ? "text-rust" : "text-charcoal-soft"
                }`}
              >
                <Icon name={c.status === "approved" ? "check" : c.status === "rejected" ? "x" : "clock"} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-charcoal">{c.name}</span>
                  {c.status === "approved" && <Pill tone="good">Verified</Pill>}
                  {c.status === "pending" && <Pill>Awaiting review</Pill>}
                  {c.status === "rejected" && <Pill tone="bad">Not accepted</Pill>}
                </div>
                <div className="mt-0.5 text-[11px] text-charcoal-soft">
                  {[c.issuer, c.issuedOn ? fmtDate(c.issuedOn) : ""].filter(Boolean).join(" · ") || "No issuer noted"}
                </div>
                {c.reviewerNote && (
                  <p className="mt-1 text-[11px] text-charcoal-soft">Admin note: {c.reviewerNote}</p>
                )}
                <div className="mt-1.5 flex items-center gap-3">
                  <a
                    href={`/api/cert/${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-semibold text-gold hover:text-gold-hover"
                  >
                    View {c.isPdf ? "PDF" : "image"}
                  </a>
                  {c.status !== "approved" && (
                    <button
                      type="button"
                      disabled={removing}
                      onClick={() => remove(c)}
                      className="text-[11px] font-semibold text-charcoal-soft hover:text-rust disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
