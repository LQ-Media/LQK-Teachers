"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
  deleteUsers,
  createInvite,
  deleteInvite,
} from "@/lib/actions/admin";
import { sendSignupReminders } from "@/lib/actions/signup";
import { STATE_LABEL, needsReminder, MAX_PER_SEND } from "@/lib/admin/signup";
import { titleCase, initials } from "@/components/tracker/util";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import ShiftRoster from "@/components/admin/ShiftRoster";
import AccessPanel from "@/components/admin/AccessPanel";
import { PAY_TIERS, TIER_BY_KEY } from "@/lib/hours/rates";

const ROLE_LABEL = { admin: "Admin", reviewer: "Reviewer", teacher: "Teacher" };
const ROLE_OPTIONS = ["teacher", "reviewer", "admin"];

const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

const checkbox = "h-4 w-4 flex-none accent-ink cursor-pointer disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Row selection for the bulk-delete bars. Selectable ids are passed in so
 * "select all" can never pick something that isn't allowed to be deleted (your
 * own account), and so a selection can't survive as a stale id after a refresh.
 */
function useSelection(selectableIds) {
  const [selected, setSelected] = useState(() => new Set());
  const valid = new Set(selectableIds.map(String));
  const chosen = [...selected].filter((id) => valid.has(id));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelected(chosen.length === valid.size ? new Set() : new Set(valid));
  }

  return {
    chosen,
    count: chosen.length,
    has: (id) => selected.has(String(id)),
    toggle,
    toggleAll,
    clear: () => setSelected(new Set()),
    allChosen: valid.size > 0 && chosen.length === valid.size,
    someChosen: chosen.length > 0 && chosen.length < valid.size,
  };
}

// Shown above a table once something is ticked.
function BulkBar({ count, noun, onDelete, onClear, pending }) {
  if (!count) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-card border-[0.5px] border-line bg-paper-deep px-4 py-2.5">
      <span className="text-[13px] font-semibold text-charcoal">
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="rounded-control px-3 py-1.5 text-[12px] font-semibold text-charcoal-soft transition-colors hover:text-charcoal"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-control bg-rust px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors hover:opacity-90 disabled:opacity-60"
        >
          <Icon name="trash" size={14} />
          {pending ? "Deleting…" : `Delete ${count} selected`}
        </button>
      </div>
    </div>
  );
}

/**
 * The Admin page: TWO areas, not seven tabs.
 *
 * Karim, 17 Sep: "i find the admin view very messy. i want the Sling functions
 * to be on its own with the other admin matters for this login accounts and
 * invited emails on its own tab."
 *
 * So:
 *   ADMIN         — accounts, invitations, and who holds admin access.
 *   SHIFT ROSTER  — everything that was Sling, behind Sling's own tile menu.
 *                   See components/admin/ShiftRoster.js.
 *
 * The page is full width. It used to be capped at max-w-5xl, which left a
 * calendar of 71 teachers squeezed into half a monitor with white space beside
 * it — Karim's second ask on the same day.
 */
export default function AdminApp({ users, invites = [], locations, shiftLocations = locations, initialHours, initialShifts, initialPayroll, fullAdmin = true, managedBranches = null, fenceOn = null, mailReady = false, positions = null }) {
  // A centre IT Head has no Admin area at all — no accounts, no invitations, no
  // access screen — so they open on the roster, which is their whole job here.
  const [area, setArea] = useState(fullAdmin ? "admin" : "roster");
  const [tab, setTab] = useState("users"); // within the Admin area
  const [userModal, setUserModal] = useState(null); // {mode, user?}
  const [inviteModal, setInviteModal] = useState(false);
  const [creds, setCreds] = useState(null); // {email, tempPassword} banner
  // Anyone who can hold a shift. Sorted by name so the pickers are scannable.
  // position and primary_location travel with the name: Sling's employee
  // picker shows both under each person, and with 77 staff sharing first names
  // ("NUR …", "SITI …", "NURUL …") the subtitle is often what tells you which
  // one you meant. It is also what the search matches on.
  const teacherOptions = [...users]
    .map((u) => ({
      id: u.id,
      fullName: u.full_name,
      position: u.position || "",
      primaryLocation: u.primary_location || "",
    }))
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  // Accounts nobody has signed in to, plus ones an admin has reset and the
  // person has not picked up. Counted here so the tab itself answers "who
  // hasn't signed up" without being opened.
  const unsigned = users.filter((u) => needsReminder(u.signup?.state)).length;

  // What is outstanding on the roster side, so the switch says so without
  // having to be opened. Missed clock-ins plus sessions awaiting approval —
  // both are somebody waiting on an admin.
  const rosterBadge =
    (initialShifts?.missed?.length || 0) +
    (initialShifts?.relief?.uncovered?.length || 0) +
    (fullAdmin ? initialHours?.pending?.length || 0 : 0);

  const ADD_LABEL = { users: "Add user", invites: "Invite email" };
  const ADD_ICON = { users: "user-plus", invites: "mail-plus" };

  function openAdd() {
    if (tab === "users") setUserModal({ mode: "new" });
    else if (tab === "invites") setInviteModal(true);
  }

  const inAdmin = area === "admin" && fullAdmin;

  return (
    <div className="px-4 py-6 sm:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <PageHeading
          route="/admin"
          icon="settings"
          title="Admin"
          subtitle={
            inAdmin
              ? "Accounts, invitations, and who holds admin access."
              : "Shifts, clock-ins and what they pay."
          }
        />
        {/* The Add button belongs to the Admin area's tables. Shift Roster has
            its own actions on the screens that need them — Add shift sits on
            the calendar, where the date you clicked is the date you meant. */}
        {inAdmin && (
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep"
          >
            <Icon name={ADD_ICON[tab]} size={16} />
            {ADD_LABEL[tab]}
          </button>
        )}
      </div>

      {creds && <CredsBanner creds={creds} onClose={() => setCreds(null)} />}

      {/* Two areas. A centre IT Head sees no switch at all, because there is
          only one side of it they can open. */}
      {fullAdmin && (
        <div className="mb-5 flex flex-wrap gap-1 rounded-control bg-paper-deep p-1 w-fit">
          <Tab active={area === "admin"} onClick={() => setArea("admin")} icon="users">
            Admin
          </Tab>
          <Tab active={area === "roster"} onClick={() => setArea("roster")} icon="calendar">
            Shift Roster{rosterBadge ? ` (${rosterBadge})` : ""}
          </Tab>
        </div>
      )}

      {inAdmin && (
        <div className="mb-5 flex flex-wrap gap-1 rounded-control bg-paper-deep p-1 w-fit">
          <Tab active={tab === "users"} onClick={() => setTab("users")} icon="users">
            Login accounts ({users.length})
            {unsigned ? <span className="ml-1 text-rust">· {unsigned} not signed up</span> : null}
          </Tab>
          <Tab active={tab === "invites"} onClick={() => setTab("invites")} icon="mail">
            Invited emails ({invites.length})
          </Tab>
          {/* Full admins only — this is the screen that hands out payroll access. */}
          <Tab active={tab === "access"} onClick={() => setTab("access")} icon="key">
            Access
          </Tab>
        </div>
      )}

      {inAdmin && tab === "users" && (
        <UsersTable
          users={users}
          mailReady={mailReady}
          onEdit={(u) => setUserModal({ mode: "edit", user: u })}
          onCreds={setCreds}
        />
      )}
      {inAdmin && tab === "invites" && <InvitesTable invites={invites} />}
      {inAdmin && tab === "access" && <AccessPanel />}

      {!inAdmin && (
        <ShiftRoster
          teachers={teacherOptions}
          locations={locations}
          shiftLocations={shiftLocations}
          initialShifts={initialShifts}
          initialHours={initialHours}
          initialPayroll={initialPayroll}
          fullAdmin={fullAdmin}
          managedBranches={managedBranches}
          fenceOn={fenceOn}
          positions={positions}
        />
      )}

      {userModal && (
        <UserModal
          modal={userModal}
          locations={locations}
          onClose={() => setUserModal(null)}
          onCreds={setCreds}
        />
      )}
      {inviteModal && <InviteModal locations={locations} onClose={() => setInviteModal(false)} />}
    </div>
  );
}

// ---- Users -------------------------------------------------------------

/**
 * The sign-up state, as a pill.
 *
 * Three states rather than a tick and a cross, because "reset and not picked
 * up" is a person locked out of an account they were using — a different and
 * more urgent thing than never having started. See lib/admin/signup.js.
 */
function SignupPill({ signup }) {
  const state = signup?.state || "active";
  const tone =
    state === "active"
      ? "bg-sage/15 text-charcoal"
      : state === "reset"
        ? "bg-gold-soft/60 text-charcoal"
        : "bg-rust/10 text-rust";
  return (
    <span className={`inline-block rounded-pill px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {STATE_LABEL[state]}
    </span>
  );
}

function shortDay(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function UsersTable({ users, mailReady = false, onEdit, onCreds }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // "everyone" | "outstanding" | "active"
  const [show, setShow] = useState("everyone");
  const [report, setReport] = useState(null);

  const shown = users.filter((u) => {
    if (show === "outstanding") return needsReminder(u.signup?.state);
    if (show === "active") return !needsReminder(u.signup?.state);
    return true;
  });
  const outstanding = users.filter((u) => needsReminder(u.signup?.state));
  // Selection is over the VISIBLE rows, so "select all" while filtered to the
  // outstanding picks exactly the people a reminder is for — which is the whole
  // reason the filter is there.
  const remindable = shown.filter((u) => needsReminder(u.signup?.state)).map((u) => u.id);

  // Your own account can never be deleted, so it is never selectable either.
  const sel = useSelection(shown.filter((u) => !u.isSelf).map((u) => u.id));

  function sendReminders(ids) {
    const names = users.filter((u) => ids.includes(u.id)).map((u) => u.full_name);
    if (!names.length) return;
    const preview = names.slice(0, 5).join(", ") + (names.length > 5 ? `, and ${names.length - 5} more` : "");
    if (
      !confirm(
        `Email a sign-up reminder to ${names.length} ${names.length === 1 ? "person" : "people"}?\n\n${preview}\n\n` +
          "This gives each of them a NEW temporary password and sends it to them. " +
          "Any password they already have stops working."
      )
    )
      return;
    setReport(null);
    startTransition(async () => {
      const r = await sendSignupReminders(ids);
      if (r?.error) {
        alert(r.error);
        return;
      }
      setReport(r);
      sel.clear();
      router.refresh();
    });
  }

  function removeSelected() {
    const names = users.filter((u) => sel.has(u.id)).map((u) => u.full_name);
    const preview = names.slice(0, 5).join(", ") + (names.length > 5 ? `, and ${names.length - 5} more` : "");
    if (
      !confirm(
        `Delete ${sel.count} account${sel.count === 1 ? "" : "s"}?\n\n${preview}\n\n` +
          "This removes their logins, everything logged under them (hours, hafalan, notes, certificates), " +
          "and their staff roster entries along with those lessons and juz progress. This cannot be undone."
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteUsers(sel.chosen);
      if (r?.error) alert(r.error);
      else if (r?.keptSelf) alert(`Deleted ${r.deleted}. Your own account was kept.`);
      sel.clear();
      router.refresh();
    });
  }

  function reset(u) {
    if (!confirm(`Reset ${u.full_name}'s password? They'll get a new temporary password and must set their own at next login.`)) return;
    startTransition(async () => {
      const r = await resetUserPassword(u.id);
      if (r?.error) alert(r.error);
      else if (r?.tempPassword) onCreds({ email: r.email, tempPassword: r.tempPassword });
      router.refresh();
    });
  }
  function remove(u) {
    if (
      !confirm(
        `Delete ${u.full_name}'s account?\n\n` +
          "This removes their login, everything logged under it (hours, hafalan, notes, certificates), " +
          "and their staff roster entry along with its lessons and juz progress. This cannot be undone."
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteUser(u.id);
      if (r?.error) alert(r.error);
      router.refresh();
    });
  }

  return (
    <>
    {/* Who has signed up, and the one button for the ones who haven't. */}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border-[0.5px] border-line bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-1 rounded-control bg-paper-deep p-1">
        {[
          ["everyone", `Everyone (${users.length})`],
          ["outstanding", `Not signed up (${outstanding.length})`],
          ["active", `Signed up (${users.length - outstanding.length})`],
        ].map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setShow(k); sel.clear(); }}
            className={`rounded-[7px] px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              show === k ? "bg-white text-charcoal shadow-sm" : "text-charcoal-soft hover:text-charcoal"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {outstanding.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {!mailReady && (
            <span className="text-[12px] text-rust">
              Email isn’t set up on this server, so reminders can’t be sent.
            </span>
          )}
          <button
            type="button"
            disabled={pending || !mailReady || !remindable.length}
            onClick={() => sendReminders(remindable.slice(0, MAX_PER_SEND))}
            title={`Sends at most ${MAX_PER_SEND} at a time`}
            className="rounded-control border-[0.5px] border-ink px-3 py-2 text-[12px] font-semibold text-ink hover:bg-ink/5 disabled:opacity-40"
          >
            Remind {Math.min(remindable.length, MAX_PER_SEND) || 0}
            {remindable.length > MAX_PER_SEND ? ` of ${remindable.length}` : ""}
          </button>
        </div>
      )}
    </div>

    {/* Per-person outcomes. A partial send has to be readable: the people it
        failed for have had their password changed and NOT been told, and this
        is the only place that still knows what it was. */}
    {report && (
      <div className="mb-4 rounded-card border-[0.5px] border-line bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[13px] font-semibold text-charcoal">
            {report.sent} sent{report.failed ? `, ${report.failed} failed` : ""}
            {report.held?.length ? ` · ${report.held.length} held back for the next batch` : ""}
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setReport(null)}
            className="text-charcoal-soft hover:text-charcoal"
          >
            <Icon name="x" size={15} />
          </button>
        </div>
        <ul className="mt-2 space-y-1">
          {report.results.map((r) => (
            <li key={r.id} className="text-[12px]">
              <strong className={`font-semibold ${r.ok ? "text-sage" : "text-rust"}`}>
                {r.ok ? "Sent" : "Failed"}
              </strong>{" "}
              <span className="text-charcoal">{r.name || r.id}</span>
              <span className="text-charcoal-soft">{r.email ? ` · ${r.email}` : ""}</span>
              {!r.ok && (
                <span className="text-charcoal-soft">
                  {" "}
                  — {r.error}
                  {r.tempPassword ? (
                    <>
                      . Their password is now{" "}
                      <code className="rounded bg-paper-deep px-1 py-0.5 font-semibold text-charcoal">
                        {r.tempPassword}
                      </code>{" "}
                      — pass it on by hand.
                    </>
                  ) : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    )}

    <BulkBar count={sel.count} noun="account" pending={pending} onClear={sel.clear} onDelete={removeSelected} />
    <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b-[0.5px] border-line text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">
              <th className="w-10 py-3 pl-4">
                <input
                  type="checkbox"
                  className={checkbox}
                  aria-label="Select all accounts"
                  checked={sel.allChosen}
                  ref={(el) => el && (el.indeterminate = sel.someChosen)}
                  onChange={sel.toggleAll}
                />
              </th>
              <Th>Name</Th>
              <Th>Signed up?</Th>
              <Th>Role</Th>
              <Th>Branch</Th>
              <Th className="text-right pr-4">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr
                key={u.id}
                className={`border-b-[0.5px] border-line last:border-0 align-middle ${sel.has(u.id) ? "bg-paper-deep" : ""}`}
              >
                <td className="w-10 py-3 pl-4">
                  <input
                    type="checkbox"
                    className={checkbox}
                    aria-label={`Select ${u.full_name}`}
                    disabled={u.isSelf}
                    title={u.isSelf ? "You can’t delete your own account" : undefined}
                    checked={sel.has(u.id)}
                    onChange={() => sel.toggle(u.id)}
                  />
                </td>
                <td className="py-3 pl-1 pr-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-sand text-[11px] font-bold text-ink">
                      {u.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatar} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initials(u.full_name)
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-charcoal">
                        {u.full_name} {u.isSelf && <span className="text-[11px] font-normal text-charcoal-soft">(you)</span>}
                      </div>
                      <div className="text-[12px] text-charcoal-soft">{u.email}</div>
                      {u.position && <div className="text-[11px] text-charcoal-soft">{u.position}</div>}
                      {TIER_BY_KEY[u.pay_tier] && (
                        <div className="text-[11px] font-medium text-sage">
                          {TIER_BY_KEY[u.pay_tier].short} · ${TIER_BY_KEY[u.pay_tier].rate}/hr
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <SignupPill signup={u.signup} />
                  {u.signup?.lastLoginAt ? (
                    <div className="mt-0.5 text-[11px] text-charcoal-soft">
                      Last in {shortDay(u.signup.lastLoginAt)}
                    </div>
                  ) : u.signup?.state === "active" ? (
                    // Honest about the gap: last_login_at only started being
                    // recorded on 17 Sep, so an older account holds its own
                    // password with no date to show for it.
                    <div className="mt-0.5 text-[11px] text-charcoal-soft">Before 17 Sep</div>
                  ) : null}
                  {u.signup?.reminderCount ? (
                    <div className="mt-0.5 text-[11px] text-charcoal-soft">
                      Reminded {u.signup.reminderCount}× · last {shortDay(u.signup.remindedAt)}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <RolePill role={u.role} />
                </td>
                <td className="px-3 py-3 text-[12px] text-charcoal-soft">
                  {u.branches.length ? u.branches.join(", ") : "—"}
                </td>
                <td className="py-3 pr-4">
                  <div className="flex items-center justify-end gap-1">
                    <IconBtn label="Edit" icon="pencil" onClick={() => onEdit(u)} />
                    {needsReminder(u.signup?.state) && (
                      <IconBtn
                        label="Email a sign-up reminder"
                        icon="mail"
                        disabled={pending || !mailReady}
                        onClick={() => sendReminders([u.id])}
                      />
                    )}
                    <IconBtn label="Reset password" icon="key" disabled={pending} onClick={() => reset(u)} />
                    <IconBtn
                      label="Delete"
                      icon="trash"
                      danger
                      disabled={pending || u.isSelf}
                      onClick={() => remove(u)}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-[13px] text-charcoal-soft">
                  {users.length
                    ? show === "outstanding"
                      ? "Everybody has signed up."
                      : "Nobody matches that."
                    : "No accounts yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </>
  );
}

function UserModal({ modal, locations, onClose, onCreds }) {
  const router = useRouter();
  const editing = modal.mode === "edit";
  const u = modal.user || {};
  const [form, setForm] = useState({
    full_name: u.full_name || "",
    email: u.email || "",
    role: u.role || "teacher",
    adminScope: u.admin_scope || "centre",
    managedBranches: u.managed_branches || [],
    position: u.position || "",
    pay_tier: u.pay_tier || "",
    primary_location: u.primary_location || "",
    branches: new Set(u.branches || []),
  });
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function toggleBranch(loc) {
    setForm((f) => {
      const next = new Set(f.branches);
      next.has(loc) ? next.delete(loc) : next.add(loc);
      return { ...f, branches: next };
    });
  }

  function submit() {
    setError(null);
    const branches = new Set(form.branches);
    if (form.primary_location) branches.add(form.primary_location);
    const payload = {
      id: u.id,
      full_name: form.full_name,
      email: form.email,
      role: form.role,
      position: form.position,
      pay_tier: form.pay_tier,
      primary_location: form.primary_location,
      branches: [...branches],
      adminScope: form.role === "admin" ? form.adminScope : null,
      // A full admin covers everything, so their branch list is always empty —
      // sending the stale chips would leave rows behind that mean nothing.
      managedBranches: form.role === "admin" && form.adminScope === "centre" ? form.managedBranches : [],
    };
    startTransition(async () => {
      const r = editing ? await updateUser(payload) : await createUser(payload);
      if (r?.error) {
        setError(r.error);
        return;
      }
      if (r?.tempPassword) onCreds({ email: r.email, tempPassword: r.tempPassword });
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal title={editing ? "Edit account" : "New account"} onClose={onClose}>
      <div className="space-y-3.5">
        <Labelled label="Full name">
          <input className={field} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
        </Labelled>
        <Labelled label="Email">
          <input className={field} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Labelled>
        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Role">
            <select className={field} value={form.role} onChange={(e) => set("role", e.target.value)}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Position">
            <input
              className={field}
              value={form.position}
              placeholder="e.g. Ustazah"
              onChange={(e) => set("position", e.target.value)}
            />
          </Labelled>
        </div>

        {form.role === "admin" && (
          <div className="rounded-control border-[0.5px] border-line bg-paper-deep/40 p-3">
            <Labelled label="Admin access">
              <select
                className={field}
                value={form.adminScope}
                onChange={(e) => set("adminScope", e.target.value)}
              >
                <option value="centre">Centre only — roster and attendance, no payroll</option>
                <option value="full">Full — everything, including payroll</option>
              </select>
            </Labelled>
            {form.adminScope === "centre" && (
              <div className="mt-3">
                <span className="mb-1.5 block text-[12px] font-semibold text-charcoal">Their centres</span>
                <div className="flex flex-wrap gap-2">
                  {locations.filter((l) => l !== "HQ").map((loc) => {
                    const on = form.managedBranches.includes(loc);
                    return (
                      <button
                        key={loc}
                        type="button"
                        onClick={() =>
                          set(
                            "managedBranches",
                            on
                              ? form.managedBranches.filter((b) => b !== loc)
                              : [...form.managedBranches, loc]
                          )
                        }
                        className={`rounded-pill px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                          on
                            ? "bg-ink text-paper"
                            : "border-[0.5px] border-line bg-white text-charcoal hover:bg-paper-deep"
                        }`}
                      >
                        {loc}
                      </button>
                    );
                  })}
                </div>
                {!form.managedBranches.length && (
                  <p className="mt-2 text-[11px] text-rust">
                    With no centres they will see an empty roster.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <Labelled label="Pay tier — sets their teaching rate for work hours">
          <select className={field} value={form.pay_tier} onChange={(e) => set("pay_tier", e.target.value)}>
            <option value="">Not set</option>
            {PAY_TIERS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} — ${t.rate}/hr
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Primary branch">
          <select
            className={field}
            value={form.primary_location}
            onChange={(e) => set("primary_location", e.target.value)}
          >
            <option value="">None (HQ / all branches)</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Also assigned to">
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-0.5">
            {locations.map((l) => {
              const isPrimary = l === form.primary_location;
              return (
                <label key={l} className={`flex items-center gap-2 text-[13px] ${isPrimary ? "opacity-50" : "text-charcoal"}`}>
                  <input
                    type="checkbox"
                    className="accent-ink"
                    disabled={isPrimary}
                    checked={isPrimary || form.branches.has(l)}
                    onChange={() => toggleBranch(l)}
                  />
                  {l}
                </label>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-charcoal-soft">
            Teachers see the tracker only for their assigned branches. Admins and reviewers see all branches.
          </p>
        </Labelled>

        {!editing && (
          <p className="rounded-control bg-gold-soft/40 px-3 py-2 text-[12px] text-charcoal">
            A temporary password will be generated and shown once. The teacher sets their own at first login.
          </p>
        )}
        {error && <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>}
      </div>

      <ModalActions pending={pending} onClose={onClose} onSave={submit} saveLabel={editing ? "Save changes" : "Create account"} />
    </Modal>
  );
}

// ---- Invited emails ----------------------------------------------------

// The allowlist for self-registration: only these addresses can create their
// own account at /login → Register, and they inherit the role/branch/tier set
// here. Nothing is emailed automatically — share the link with the teacher.
function InvitesTable({ invites }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove(i) {
    if (!confirm(`Remove the invite for ${i.email}? They won't be able to register until you add it again.`)) return;
    startTransition(async () => {
      const r = await deleteInvite(i.id);
      if (r?.error) alert(r.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="rounded-control bg-gold-soft/40 px-3.5 py-2.5 text-[12px] leading-relaxed text-charcoal">
        Add a teacher’s email here, then send them the portal link. They register with that email and set their own
        password — no temporary password to share. Emails not on this list can’t create an account.
      </p>

      <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
        {invites.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-charcoal-soft">
            No pending invites. Use “Invite email” to add one.
          </div>
        ) : (
          <ul>
            {invites.map((i) => {
              const tier = TIER_BY_KEY[i.pay_tier];
              return (
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-3 border-b-[0.5px] border-line px-4 py-3 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-charcoal">{i.email}</div>
                    <div className="text-[11px] text-charcoal-soft">
                      {i.full_name ? `${i.full_name} · ` : ""}
                      {ROLE_LABEL[i.role] || i.role}
                      {i.primary_location ? ` · ${i.primary_location}` : ""}
                      {tier ? ` · ${tier.short} $${tier.rate}/hr` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="rounded-pill bg-gold-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-sage">
                      Awaiting signup
                    </span>
                    <IconBtn label="Remove invite" icon="trash" danger disabled={pending} onClick={() => remove(i)} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function InviteModal({ locations, onClose }) {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    full_name: "",
    role: "teacher",
    position: "",
    pay_tier: "",
    primary_location: "",
    branches: new Set(),
  });
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function toggleBranch(loc) {
    setForm((f) => {
      const next = new Set(f.branches);
      next.has(loc) ? next.delete(loc) : next.add(loc);
      return { ...f, branches: next };
    });
  }

  function submit() {
    setError(null);
    const branches = new Set(form.branches);
    if (form.primary_location) branches.add(form.primary_location);
    startTransition(async () => {
      const r = await createInvite({ ...form, branches: [...branches] });
      if (r?.error) {
        setError(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal title="Invite an email" onClose={onClose}>
      <div className="space-y-3.5">
        <Labelled label="Email — they must register with exactly this address">
          <input
            className={field}
            type="email"
            value={form.email}
            placeholder="teacher@example.com"
            onChange={(e) => set("email", e.target.value)}
          />
        </Labelled>
        <Labelled label="Full name (optional — they can type their own)">
          <input className={field} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
        </Labelled>
        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Role">
            <select className={field} value={form.role} onChange={(e) => set("role", e.target.value)}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Position">
            <input
              className={field}
              value={form.position}
              placeholder="e.g. Ustazah"
              onChange={(e) => set("position", e.target.value)}
            />
          </Labelled>
        </div>
        <Labelled label="Pay tier — sets their teaching rate for work hours">
          <select className={field} value={form.pay_tier} onChange={(e) => set("pay_tier", e.target.value)}>
            <option value="">Not set</option>
            {PAY_TIERS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} — ${t.rate}/hr
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Primary branch">
          <select
            className={field}
            value={form.primary_location}
            onChange={(e) => set("primary_location", e.target.value)}
          >
            <option value="">None (HQ / all branches)</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Also assigned to">
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-0.5">
            {locations.map((l) => {
              const isPrimary = l === form.primary_location;
              return (
                <label
                  key={l}
                  className={`flex items-center gap-2 text-[13px] ${isPrimary ? "opacity-50" : "text-charcoal"}`}
                >
                  <input
                    type="checkbox"
                    className="accent-ink"
                    disabled={isPrimary}
                    checked={isPrimary || form.branches.has(l)}
                    onChange={() => toggleBranch(l)}
                  />
                  {l}
                </label>
              );
            })}
          </div>
        </Labelled>

        <p className="rounded-control bg-gold-soft/40 px-3 py-2 text-[12px] text-charcoal">
          Nothing is emailed automatically — send them the portal link yourself. They’ll pick their own password when
          they register.
        </p>
        {error && <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>}
      </div>

      <ModalActions pending={pending} onClose={onClose} onSave={submit} saveLabel="Add invite" />
    </Modal>
  );
}

// ---- Shared bits -------------------------------------------------------

function CredsBanner({ creds, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card border-[0.5px] border-gold bg-gold-soft/40 px-4 py-3">
      <span className="text-gold">
        <Icon name="key" size={18} />
      </span>
      <div className="flex-1 text-[13px] text-charcoal">
        Temporary password for <strong className="font-semibold">{creds.email}</strong>:{" "}
        <code className="rounded bg-white px-2 py-0.5 font-mono text-[13px] text-ink">{creds.tempPassword}</code>
        <div className="text-[11px] text-charcoal-soft mt-0.5">
          Share it privately. They’ll be asked to set their own password at first login. This won’t be shown again.
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(creds.tempPassword);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="rounded-control border-[0.5px] border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-charcoal hover:bg-paper-deep"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal-soft hover:bg-black/5"
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-white p-5 shadow-[0_12px_40px_rgba(74,51,64,0.25)]"
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
      <button
        type="button"
        onClick={onClose}
        className="rounded-control px-4 py-2 text-[13px] font-semibold text-charcoal-soft hover:text-charcoal"
      >
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

function Labelled({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-charcoal-soft">{label}</span>
      {children}
    </label>
  );
}

function Tab({ active, onClick, icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-control px-3.5 py-2 text-[13px] font-semibold transition-colors ${
        active ? "bg-white text-ink shadow-sm" : "text-charcoal-soft hover:text-charcoal"
      }`}
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}

function Th({ children, className = "" }) {
  return <th className={`px-3 py-2.5 pl-4 font-bold ${className}`}>{children}</th>;
}

function RolePill({ role }) {
  const tone =
    role === "admin"
      ? "bg-ink text-paper"
      : role === "reviewer"
        ? "bg-sage-soft text-sage"
        : "bg-paper-deep text-charcoal-soft";
  return <span className={`rounded-pill px-2.5 py-1 text-[11px] font-bold ${tone}`}>{ROLE_LABEL[role] || role}</span>;
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
