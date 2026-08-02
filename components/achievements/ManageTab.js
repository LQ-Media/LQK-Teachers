"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  reviewCertificate,
  reviewNomination,
  awardHonour,
  deleteHonour,
  createCertType,
  setCertTypeActive,
  linkRosterToAccount,
} from "@/lib/actions/achievements";
import { formatPoints } from "@/lib/achievements/points";
import { monthLabel } from "@/lib/hours/rates";
import { fmtDate, titleCase } from "@/components/tracker/util";
import Icon from "@/components/Icon";
import { Card, Empty, field, Pill, SectionTitle } from "./ui";

const SECTIONS = [
  { key: "review", label: "To review", icon: "alert-triangle" },
  { key: "honours", label: "Honours", icon: "trophy" },
  { key: "scores", label: "Full scoreboard", icon: "trending-up" },
  { key: "links", label: "Account links", icon: "users" },
  { key: "types", label: "Certificate types", icon: "key" },
];

export default function ManageTab({ season, admin, certTypes }) {
  const [section, setSection] = useState("review");
  const toReview = admin.pendingCerts.length + admin.pendingNominations.length;

  return (
    <div className="space-y-5">
      {admin.unlinkedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border-[0.5px] border-gold bg-gold-soft/40 px-4 py-3">
          <span className="text-gold">
            <Icon name="alert-triangle" size={18} />
          </span>
          <p className="flex-1 text-[13px] text-charcoal">
            <strong className="font-semibold">{admin.unlinkedCount}</strong> roster{" "}
            {admin.unlinkedCount === 1 ? "row is" : "rows are"} not linked to a login account, so
            their own lessons earn them no hafalan points.
          </p>
          <button
            type="button"
            onClick={() => setSection("links")}
            className="rounded-control bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-deep"
          >
            Fix links
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={`flex items-center gap-1.5 rounded-pill border-[0.5px] px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              section === s.key
                ? "border-ink bg-ink text-paper"
                : "border-line bg-white text-charcoal-soft hover:text-charcoal"
            }`}
          >
            <Icon name={s.icon} size={13} />
            {s.label}
            {s.key === "review" && toReview ? ` (${toReview})` : ""}
          </button>
        ))}
      </div>

      {section === "review" && <ReviewSection admin={admin} />}
      {section === "honours" && <HonoursSection admin={admin} season={season} />}
      {section === "scores" && <ScoreboardSection admin={admin} season={season} />}
      {section === "links" && <LinksSection admin={admin} />}
      {section === "types" && <CertTypesSection certTypes={certTypes} />}
    </div>
  );
}

function ReviewSection({ admin }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState({});

  function decideCert(id, decision) {
    start(async () => {
      const r = await reviewCertificate({ id, decision, note: note[id] || "" });
      if (r?.error) alert(r.error);
      router.refresh();
    });
  }
  function decideNom(id, decision) {
    start(async () => {
      const r = await reviewNomination({ id, decision });
      if (r?.error) alert(r.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-7">
      <div>
        <SectionTitle note={`${admin.pendingCerts.length} waiting`}>Certificates</SectionTitle>
        {admin.pendingCerts.length === 0 ? (
          <Empty>Nothing waiting for review.</Empty>
        ) : (
          <div className="space-y-3">
            {admin.pendingCerts.map((c) => (
              <Card key={c.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-charcoal">{titleCase(c.teacher)}</div>
                    <div className="text-[13px] text-charcoal">{c.name}</div>
                    <div className="mt-0.5 text-[11px] text-charcoal-soft">
                      {[c.issuer, c.issuedOn ? fmtDate(c.issuedOn) : ""].filter(Boolean).join(" · ") ||
                        "No issuer noted"}
                    </div>
                  </div>
                  <a
                    href={`/api/cert/${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 rounded-control border-[0.5px] border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-charcoal hover:bg-paper-deep"
                  >
                    <Icon name={c.isPdf ? "download" : "image"} size={14} />
                    Open {c.isPdf ? "PDF" : "image"}
                  </a>
                </div>
                <input
                  className={`${field} mt-3`}
                  placeholder="Note back to them (optional)"
                  value={note[c.id] || ""}
                  onChange={(e) => setNote((n) => ({ ...n, [c.id]: e.target.value }))}
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decideCert(c.id, "approved")}
                    className="rounded-control bg-ink px-3.5 py-2 text-[12px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-60"
                  >
                    Approve · verified badge
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decideCert(c.id, "rejected")}
                    className="rounded-control border-[0.5px] border-line bg-white px-3.5 py-2 text-[12px] font-semibold text-charcoal-soft hover:text-rust disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionTitle note={`${admin.pendingNominations.length} waiting`}>Peer nominations</SectionTitle>
        {admin.pendingNominations.length === 0 ? (
          <Empty>No nominations waiting.</Empty>
        ) : (
          <div className="space-y-3">
            {admin.pendingNominations.map((n) => (
              <Card key={n.id}>
                <div className="text-[13px] text-charcoal">
                  <strong className="font-semibold">{titleCase(n.nominator)}</strong> nominated{" "}
                  <strong className="font-semibold">{titleCase(n.nominee)}</strong>
                  {n.month ? <span className="text-charcoal-soft"> · {monthLabel(n.month)}</span> : null}
                </div>
                <p className="mt-1.5 text-[13px] italic text-charcoal-soft">“{n.reason}”</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decideNom(n.id, "confirmed")}
                    className="rounded-control bg-ink px-3.5 py-2 text-[12px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-60"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => decideNom(n.id, "declined")}
                    className="rounded-control border-[0.5px] border-line bg-white px-3.5 py-2 text-[12px] font-semibold text-charcoal-soft hover:text-rust disabled:opacity-60"
                  >
                    Decline
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HonoursSection({ admin, season }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    teacherId: "",
    kind: "monthly",
    title: "Teacher of the Month",
    reason: "",
    month: season,
  });
  const [error, setError] = useState(null);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function submit() {
    setError(null);
    start(async () => {
      const r = await awardHonour(form);
      if (r?.error) {
        setError(r.error);
        return;
      }
      setForm((f) => ({ ...f, teacherId: "", reason: "" }));
      router.refresh();
    });
  }
  function remove(id) {
    if (!confirm("Remove this honour? Their points for it go too.")) return;
    start(async () => {
      await deleteHonour(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-7">
      <div>
        <SectionTitle>Award an honour</SectionTitle>
        <Card>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-charcoal">Type</span>
                <select className={field} value={form.kind} onChange={(e) => set("kind", e.target.value)}>
                  <option value="monthly">Monthly title (one holder per month)</option>
                  <option value="oneoff">One-off award (any time)</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-charcoal">Who</span>
                <select
                  className={field}
                  value={form.teacherId}
                  onChange={(e) => set("teacherId", e.target.value)}
                >
                  <option value="">Choose…</option>
                  {admin.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {titleCase(a.name)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-charcoal">Title</span>
                <input className={field} value={form.title} onChange={(e) => set("title", e.target.value)} />
              </label>
              {form.kind === "monthly" && (
                <label className="block">
                  <span className="mb-1 block text-[12px] font-semibold text-charcoal">Month</span>
                  <input
                    className={field}
                    type="month"
                    value={form.month}
                    onChange={(e) => set("month", e.target.value)}
                  />
                </label>
              )}
            </div>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-charcoal">Reason</span>
              <textarea
                className={`${field} min-h-[64px] resize-y`}
                value={form.reason}
                maxLength={300}
                placeholder="Shown to everyone alongside the award."
                onChange={(e) => set("reason", e.target.value)}
              />
            </label>
            {form.kind === "monthly" && (
              <p className="rounded-control bg-gold-soft/40 px-3 py-2 text-[12px] text-charcoal">
                Awarding this replaces whoever currently holds the monthly title for{" "}
                {form.month ? monthLabel(form.month) : "that month"}.
              </p>
            )}
            {error && (
              <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>
            )}
            <button
              type="button"
              disabled={pending || !form.teacherId}
              onClick={submit}
              className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-50"
            >
              {pending ? "Awarding…" : "Award"}
            </button>
          </div>
        </Card>
      </div>

      <div>
        <SectionTitle note={`${admin.allHonours.length} most recent`}>Awarded so far</SectionTitle>
        {admin.allHonours.length === 0 ? (
          <Empty>No honours awarded yet.</Empty>
        ) : (
          <Card className="p-0">
            <ul>
              {admin.allHonours.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center gap-3 border-b-[0.5px] border-line px-4 py-2.5 last:border-0"
                >
                  <span className="text-gold">
                    <Icon name={h.kind === "monthly" ? "trophy" : "award"} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-charcoal">
                      {titleCase(h.name)}
                    </div>
                    <div className="text-[11px] text-charcoal-soft">
                      {h.title}
                      {h.month ? ` · ${monthLabel(h.month)}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(h.id)}
                    className="text-charcoal-soft hover:text-rust disabled:opacity-50"
                    title="Remove"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function ScoreboardSection({ admin, season }) {
  return (
    <div>
      <SectionTitle note={monthLabel(season)}>
        Everyone, ranked — admin only
      </SectionTitle>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b-[0.5px] border-line text-[11px] uppercase tracking-wide text-charcoal-soft">
              <th className="px-4 py-2.5 font-semibold">#</th>
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Branch</th>
              <th className="px-4 py-2.5 text-right font-semibold">Season</th>
              <th className="px-4 py-2.5 text-right font-semibold">All time</th>
              <th className="px-4 py-2.5 text-right font-semibold">Lvl</th>
              <th className="px-4 py-2.5 text-right font-semibold">Streak</th>
              <th className="px-4 py-2.5 text-right font-semibold">Read days</th>
              <th className="px-4 py-2.5 text-right font-semibold">Logged</th>
              <th className="px-4 py-2.5 text-right font-semibold">Surahs</th>
            </tr>
          </thead>
          <tbody>
            {admin.scoreboard.map((r, i) => (
              <tr key={r.id} className="border-b-[0.5px] border-line text-[13px] last:border-0">
                <td className="px-4 py-2.5 text-charcoal-soft">{i + 1}</td>
                <td className="px-4 py-2.5 font-semibold text-charcoal">{titleCase(r.name)}</td>
                <td className="px-4 py-2.5 text-charcoal-soft">{r.branch ? titleCase(r.branch) : "—"}</td>
                <td className="px-4 py-2.5 text-right text-charcoal">{formatPoints(r.month)}</td>
                <td className="px-4 py-2.5 text-right text-charcoal-soft">{formatPoints(r.allTime)}</td>
                <td className="px-4 py-2.5 text-right text-charcoal-soft">{r.level}</td>
                <td className="px-4 py-2.5 text-right text-charcoal-soft">{r.currentStreak}</td>
                <td className="px-4 py-2.5 text-right text-charcoal-soft">{r.readingDays}</td>
                <td className="px-4 py-2.5 text-right text-charcoal-soft">{r.lessonsLogged}</td>
                <td className="px-4 py-2.5 text-right text-charcoal-soft">{r.surahsCompleted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-[11px] text-charcoal-soft">
        Work hours and pay are deliberately absent — they live on Work hours so a score can never be
        read back as earnings.
      </p>
    </div>
  );
}

function LinksSection({ admin }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState(null);

  function link(studentId, profileId) {
    setError(null);
    start(async () => {
      const r = await linkRosterToAccount({ studentId, profileId });
      if (r?.error) setError(r.error);
      router.refresh();
    });
  }

  const groups = admin.roster.reduce((m, s) => {
    (m[s.class] ||= []).push(s);
    return m;
  }, {});

  return (
    <div>
      <SectionTitle note={`${admin.unlinkedCount} unlinked`}>Roster ↔ account links</SectionTitle>
      <p className="mb-3 text-[12px] text-charcoal-soft">
        The monitored roster and the login accounts came from different places, so they have to be
        matched up. Without a link, a staff member’s own lessons can’t be credited to their
        Achievements page. Their teaching points are unaffected.
      </p>
      {error && (
        <p className="mb-3 rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>
      )}
      <div className="space-y-4">
        {Object.entries(groups).map(([cls, members]) => (
          <Card key={cls} className="p-0">
            <div className="border-b-[0.5px] border-line px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide text-charcoal">
              {titleCase(cls)}
            </div>
            <ul>
              {members.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 border-b-[0.5px] border-line px-4 py-2.5 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-charcoal">{titleCase(s.name)}</div>
                    <div className="text-[11px] text-charcoal-soft">Juz {s.juz}</div>
                  </div>
                  {!s.profileId && <Pill tone="bad">Unlinked</Pill>}
                  <select
                    disabled={pending}
                    className={`${field} w-auto min-w-[220px]`}
                    value={s.profileId}
                    onChange={(e) => link(s.id, e.target.value)}
                  >
                    <option value="">— no account —</option>
                    {admin.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {titleCase(a.name)} ({a.email})
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CertTypesSection({ certTypes }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ name: "", description: "" });
  const [error, setError] = useState(null);

  function add() {
    setError(null);
    start(async () => {
      const r = await createCertType(form);
      if (r?.error) {
        setError(r.error);
        return;
      }
      setForm({ name: "", description: "" });
      router.refresh();
    });
  }
  function toggle(t) {
    start(async () => {
      await setCertTypeActive({ id: t.id, active: !t.active });
      router.refresh();
    });
  }

  return (
    <div className="space-y-7">
      <div>
        <SectionTitle>Add a recognised certificate</SectionTitle>
        <Card>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-charcoal">Name</span>
                <input
                  className={field}
                  value={form.name}
                  placeholder="e.g. Tajweed Level 3"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-charcoal">Description</span>
                <input
                  className={field}
                  value={form.description}
                  placeholder="optional"
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
            </div>
            {error && (
              <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>
            )}
            <button
              type="button"
              disabled={pending || !form.name.trim()}
              onClick={add}
              className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </Card>
      </div>

      <div>
        <SectionTitle note={`${certTypes.filter((t) => t.active).length} active`}>
          Catalogue
        </SectionTitle>
        <Card className="p-0">
          <ul>
            {certTypes.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 border-b-[0.5px] border-line px-4 py-2.5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-charcoal">{t.name}</div>
                  {t.description && <div className="text-[11px] text-charcoal-soft">{t.description}</div>}
                </div>
                {!t.active && <Pill>Hidden</Pill>}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => toggle(t)}
                  className="text-[12px] font-semibold text-charcoal-soft hover:text-charcoal disabled:opacity-50"
                >
                  {t.active ? "Hide" : "Show"}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <p className="mt-3 text-[11px] text-charcoal-soft">
          Hiding a type keeps existing certificates intact — it just stops new uploads choosing it.
        </p>
      </div>
    </div>
  );
}
