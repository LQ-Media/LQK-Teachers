"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import SearchSelect from "@/components/SearchSelect";
import {
  previewAdminScopes,
  applyAdminScopes,
  accessRoster,
  setAdminScope,
  accessLog,
} from "@/lib/actions/admin-scopes";

// Admin → Access. Who holds which tier of admin, and one button to set it.
//
// This replaces running a script over SSH. The shape is deliberately the same
// as the script's: LOOK FIRST, then apply. The preview is not a formality — it
// is the thing that shows a name matched nobody, or matched two people, before
// anybody's payroll access changes.
//
// Nothing here posts a list of people to the server. Apply recomputes the plan
// from the same list in the same module; a browser that could name its own ids
// would be a way to grant payroll access to anyone.

export default function AccessPanel({ initial }) {
  const router = useRouter();
  const [data, setData] = useState(initial || null);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  // Two halves of one screen. The LIST is the standing roster from the code —
  // useful for setting everybody at once. The PEOPLE table is per-person, which
  // is what Karim asked for so he can change one person without a deploy.
  // The clock-in location check briefly lived here as a fourth tab. It moved to
  // Shift Roster -> Settings the same day: it is a ROSTERING setting, not a
  // permissions one, and filing it under Access made the tab about two things.
  const [tab, setTab] = useState("people"); // people | list | log
  const [roster, setRoster] = useState(null);
  const [log, setLog] = useState(null);

  function loadRoster() {
    startTransition(async () => {
      const r = await accessRoster();
      if (r?.error) setNotice(r.error);
      else setRoster(r);
    });
  }

  function loadLog() {
    startTransition(async () => {
      const r = await accessLog();
      if (r?.error) setNotice(r.error);
      else setLog(r.entries);
    });
  }

  // Loaded on demand, in an effect rather than during render: a fetch started
  // while rendering is a side effect React will either warn about or loop on,
  // and these read every profile so they are not free enough to do eagerly.
  useEffect(() => {
    if (tab === "people" && !roster) loadRoster();
    if (tab === "log" && !log) loadLog();
    // loadRoster/loadLog are stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function refresh() {
    startTransition(async () => {
      const r = await previewAdminScopes();
      if (r?.error) setNotice(r.error);
      else setData(r);
    });
  }

  function apply() {
    startTransition(async () => {
      const r = await applyAdminScopes();
      if (r?.error) {
        setNotice(r.error);
        return;
      }
      setConfirming(false);
      setNotice(
        `Applied to ${r.applied} account${r.applied === 1 ? "" : "s"}.` +
          (r.skipped ? ` ${r.skipped} skipped — see below.` : "")
      );
      const next = await previewAdminScopes();
      if (!next?.error) setData(next);
      router.refresh();
    });
  }

  const plan = data?.plan || [];
  const problems = data?.problems || [];
  const current = data?.current || [];
  // The button counts the PLAN, not the rows that differ, because apply writes
  // every row in the plan — a centre IT Head's branches are rewritten wholesale
  // whether or not they changed. Counting "rows that differ" made the button
  // promise 9 and the result report 10, which just makes somebody wonder what
  // the tenth one was.
  const changed = plan.filter((p) => p.changes).length;

  return (
    <div>
      {notice && (
        <div className="mb-4 flex items-start gap-3 rounded-card border-[0.5px] border-gold bg-gold-soft/40 px-4 py-3 text-[13px] text-charcoal">
          <span className="mt-0.5 text-gold">
            <Icon name="users" size={16} />
          </span>
          <div className="flex-1">{notice}</div>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-charcoal-soft hover:text-charcoal">
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-control bg-paper-deep p-1 w-fit">
        {[
          ["people", "Who has access"],
          ["list", "Apply the standing list"],
          ["log", "History"],
        ].map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-[7px] px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              tab === k ? "bg-white text-charcoal shadow-sm" : "text-charcoal-soft hover:text-charcoal"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === "people" && (
        <PeopleAccess
          roster={roster}
          pending={pending}
          onSet={(id, scope, branches) =>
            startTransition(async () => {
              const r = await setAdminScope(id, scope, branches);
              if (r?.error) setNotice(r.error);
              else {
                setNotice(
                  `${r.name}: ${SCOPE_LABEL[r.was]} → ${SCOPE_LABEL[r.scope]}` +
                    (r.branches?.length ? ` (${r.branches.join(" + ")})` : "") +
                    "."
                );
                const next = await accessRoster();
                if (!next?.error) setRoster(next);
                setLog(null);
                router.refresh();
              }
            })
          }
        />
      )}

      {tab === "log" && <AccessLog entries={log} pending={pending} />}

      {tab === "list" && (
      <>
      <div className="mb-5 rounded-card border-[0.5px] border-line bg-white p-5">
        <h3 className="font-heading text-[15px] font-semibold text-charcoal">Admin access</h3>
        <p className="mt-1 text-[13px] text-charcoal-soft">
          <strong className="font-semibold text-charcoal">Full access</strong> sees payroll and every centre.{" "}
          <strong className="font-semibold text-charcoal">Centre access</strong> edits that centre&rsquo;s shifts,
          adjusts clock-ins, resolves missed shifts and works the relief board — and sees no payroll at all.
        </p>
        <p className="mt-2 text-[12px] text-charcoal-soft">
          The list of who gets what is kept in the code. This screen matches each name to an account and shows you
          what it found before anything changes.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="flex items-center gap-2 rounded-control border-[0.5px] border-line px-3 py-2 text-[13px] font-semibold text-charcoal hover:border-ink disabled:opacity-60"
          >
            <Icon name="refresh" size={14} />
            {pending ? "Checking…" : data ? "Check again" : "Check the list"}
          </button>
          {plan.length > 0 && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={pending}
              className="rounded-control bg-ink px-3 py-2 text-[13px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-60"
            >
              Apply to {plan.length} account{plan.length === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {confirming && (
          <div className="mt-4 rounded-control border-[0.5px] border-rust bg-rust/5 p-3">
            <p className="text-[13px] text-charcoal">
              This changes who can see payroll. {plan.length} account
              {plan.length === 1 ? "" : "s"} will be written
              {changed ? ` (${changed} differ${changed === 1 ? "s" : ""} from what is set now)` : ""}, and each
              centre IT Head&rsquo;s branches are replaced with the ones listed below.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={apply}
                disabled={pending}
                className="rounded-control bg-rust px-3 py-2 text-[13px] font-semibold text-paper hover:opacity-90 disabled:opacity-60"
              >
                {pending ? "Applying…" : "Yes, apply it"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-control border-[0.5px] border-line px-3 py-2 text-[13px] font-semibold text-charcoal-soft hover:border-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Problems lead. A name that matched nobody is the row that needs a human,
          and burying it under twelve rows that worked is how it gets missed. */}
      {problems.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-[13px] font-semibold text-rust">
            {problems.length} name{problems.length === 1 ? "" : "s"} could not be matched
          </h3>
          <p className="mb-2 text-[12px] text-charcoal-soft">
            These are skipped, not guessed at. Fix the account name (or create the account) and check again.
          </p>
          <div className="overflow-hidden rounded-card border-[0.5px] border-rust bg-white">
            {problems.map((p, i) => (
              <div key={i} className="border-b-[0.5px] border-line px-4 py-3 last:border-0">
                <div className="text-[13px] font-semibold text-charcoal">{p.query}</div>
                <div className="mt-0.5 text-[12px] text-charcoal-soft">{p.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-[13px] font-semibold text-charcoal">What the list says ({plan.length})</h3>
          <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
            {plan.map((row) => (
              <div key={row.id} className="flex items-start justify-between gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-charcoal">{row.name}</span>
                    <span
                      className={`rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        row.scope === "full" ? "bg-ink text-paper" : "bg-sand text-sage"
                      }`}
                    >
                      {row.scope === "full" ? "Full" : "Centre"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-charcoal-soft">
                    {row.email}
                    {row.branches.length ? ` · ${row.branches.join(" + ")}` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-[12px] text-charcoal-soft">was: {row.was}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-charcoal">Who has admin right now ({current.length})</h3>
        {current.length === 0 ? (
          <div className="rounded-card border-[0.5px] border-line bg-white px-4 py-6 text-center text-[13px] text-charcoal-soft">
            Press &ldquo;Check the list&rdquo; to load this.
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
            {current.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-charcoal">{a.name}</span>
                    <span
                      className={`rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        a.scope === "full" ? "bg-ink text-paper" : "bg-sand text-sage"
                      }`}
                    >
                      {a.scope === "full" ? "Full" : "Centre"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-charcoal-soft">
                    {a.email}
                    {a.branches.length ? ` · ${a.branches.join(" + ")}` : ""}
                    {/* A centre admin with no branches sees nothing at all. That is
                        the safe direction, but it is almost never what was meant. */}
                    {a.scope === "centre" && a.branches.length === 0 ? " · no centres assigned — sees nothing" : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

const SCOPE_LABEL = { full: "Full access", centre: "Centre access", none: "No admin" };

/**
 * Who has access, one row per person, with the three buttons Karim asked for.
 *
 * Searchable, because this is every account — 77 of them — and the question is
 * always about one person you already have in mind.
 *
 * Admins sort first so the screen opens on the rows that matter. A teacher with
 * no admin is the default state of almost everybody and belongs below.
 */
function PeopleAccess({ roster, pending, onSet }) {
  const [query, setQuery] = useState("");
  const [onlyAdmins, setOnlyAdmins] = useState(true);
  const [editing, setEditing] = useState(null); // { id, branches }

  if (!roster) {
    return (
      <div className="rounded-card border-[0.5px] border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
        Loading accounts…
      </div>
    );
  }

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const people = roster.people.filter((p) => {
    // "Admins only" is for BROWSING. The moment somebody types a name they are
    // looking for one person, and hiding them because they are not an admin yet
    // is exactly backwards — promoting a teacher is the main reason to search.
    if (onlyAdmins && !words.length && p.scope === "none") return false;
    if (!words.length) return true;
    const hay = `${p.name} ${p.email} ${p.position || ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });

  const counts = roster.people.reduce(
    (acc, p) => ({ ...acc, [p.scope]: (acc[p.scope] || 0) + 1 }),
    {}
  );

  return (
    <div>
      <div className="mb-3 rounded-card border-[0.5px] border-line bg-white p-4">
        <p className="text-[13px] text-charcoal-soft">
          <strong className="font-semibold text-charcoal">Full</strong> sees payroll and every centre.{" "}
          <strong className="font-semibold text-charcoal">Centre</strong> edits its own centres&rsquo; shifts,
          clock-ins and relief, and no payroll.{" "}
          <strong className="font-semibold text-charcoal">None</strong> is an ordinary teacher account.
        </p>
        <p className="mt-1.5 text-[12px] text-charcoal-soft">
          {counts.full || 0} full · {counts.centre || 0} centre · {counts.none || 0} no admin
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a name"
            aria-label="Search people"
            className="w-[220px] rounded-control border-[0.5px] border-line bg-paper px-2.5 py-2 text-[12px] text-charcoal outline-none focus:border-ink"
          />
          <label className="flex items-center gap-1.5 text-[12px] text-charcoal-soft">
            <input
              type="checkbox"
              checked={onlyAdmins}
              onChange={(e) => setOnlyAdmins(e.target.checked)}
              className="h-3.5 w-3.5 accent-[color:var(--ink,#4A3340)]"
            />
            Admins only
          </label>
          {onlyAdmins && !words.length && (
            <span className="text-[11px] text-charcoal-soft">— search to include teachers</span>
          )}
          <span className="text-[12px] text-charcoal-soft">
            {people.length} shown
          </span>
        </div>
      </div>

      {people.length === 0 ? (
        <div className="rounded-card border-[0.5px] border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
          {query ? `Nobody matches “${query}”.` : "Nobody to show."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
          {people.map((p) => {
            const open = editing?.id === p.id;
            return (
              <div key={p.id} className="border-b-[0.5px] border-line px-4 py-3 last:border-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-charcoal">{p.name}</div>
                    <div className="mt-0.5 text-[12px] text-charcoal-soft">
                      {p.email}
                      {p.position ? ` · ${p.position}` : ""}
                      {p.scope === "centre" &&
                        (p.branches.length
                          ? ` · ${p.branches.join(" + ")}`
                          : " · no centres — sees nothing")}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1 rounded-control bg-paper-deep p-1">
                    {[
                      ["full", "Full"],
                      ["centre", "Centre"],
                      ["none", "None"],
                    ].map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          // Centre needs branches, so it opens a picker rather
                          // than applying an empty set the server would refuse.
                          if (k === "centre") {
                            setEditing({ id: p.id, branches: p.branches.length ? p.branches : [] });
                            return;
                          }
                          setEditing(null);
                          onSet(p.id, k, []);
                        }}
                        className={`rounded-[7px] px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
                          p.scope === k
                            ? "bg-white text-charcoal shadow-sm"
                            : "text-charcoal-soft hover:text-charcoal"
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {open && (
                  <div className="mt-3 rounded-control bg-paper p-3">
                    <span className="mb-1.5 block text-[11px] font-semibold text-charcoal-soft">
                      Which centres?
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {roster.locations.map((loc) => {
                        const on = editing.branches.includes(loc);
                        return (
                          <button
                            key={loc}
                            type="button"
                            onClick={() =>
                              setEditing((e) => ({
                                ...e,
                                branches: on
                                  ? e.branches.filter((b) => b !== loc)
                                  : [...e.branches, loc],
                              }))
                            }
                            className={`rounded-pill border-[0.5px] px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                              on ? "border-ink bg-ink text-paper" : "border-line text-charcoal-soft hover:border-ink"
                            }`}
                          >
                            {loc}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        disabled={pending || !editing.branches.length}
                        onClick={() => {
                          onSet(p.id, "centre", editing.branches);
                          setEditing(null);
                        }}
                        className="rounded-control bg-ink px-3 py-2 text-[12px] font-semibold text-paper hover:bg-ink-deep disabled:opacity-50"
                      >
                        {pending ? "Saving…" : "Give centre access"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="rounded-control border-[0.5px] border-line px-3 py-2 text-[12px] font-semibold text-charcoal-soft hover:border-ink"
                      >
                        Cancel
                      </button>
                    </div>
                    {!editing.branches.length && (
                      <p className="mt-1.5 text-[11px] text-charcoal-soft">
                        Pick at least one — a centre admin with none assigned sees nothing.
                      </p>
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

/** Every access change, newest first. A permission change with no record is the
 *  one kind of change nobody can audit and everybody denies. */
function AccessLog({ entries, pending }) {
  if (!entries) {
    return (
      <div className="rounded-card border-[0.5px] border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
        {pending ? "Loading…" : "No history yet."}
      </div>
    );
  }
  if (!entries.length) {
    return (
      <div className="rounded-card border-[0.5px] border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
        Nobody&rsquo;s access has been changed from this screen yet.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
      {entries.map((e) => (
        <div key={e.id} className="border-b-[0.5px] border-line px-4 py-3 last:border-0">
          <div className="text-[13px] text-charcoal">
            <span className="font-semibold">{e.subject}</span>{" "}
            <span className="text-charcoal-soft">
              {SCOPE_LABEL[e.from] || e.from} → {SCOPE_LABEL[e.to] || e.to}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-charcoal-soft">
            by {e.by} · {new Date(e.at).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}
            {e.toBranches ? ` · ${e.toBranches}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
