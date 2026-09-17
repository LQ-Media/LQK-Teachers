"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { previewAdminScopes, applyAdminScopes } from "@/lib/actions/admin-scopes";

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
    </div>
  );
}
