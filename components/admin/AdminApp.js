"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
  createStudent,
  updateStudent,
  deleteStudent,
} from "@/lib/actions/admin";
import { titleCase, initials } from "@/components/tracker/util";
import Icon from "@/components/Icon";

const ROLE_LABEL = { admin: "Admin", reviewer: "Reviewer", teacher: "Teacher" };
const ROLE_OPTIONS = ["teacher", "reviewer", "admin"];

const field =
  "w-full bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

export default function AdminApp({ users, staff, locations, classes }) {
  const [tab, setTab] = useState("users");
  const [userModal, setUserModal] = useState(null); // {mode, user?}
  const [staffModal, setStaffModal] = useState(null); // {mode, student?}
  const [creds, setCreds] = useState(null); // {email, tempPassword} banner

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal">Admin</h1>
          <p className="text-[13px] text-charcoal-soft mt-1">Manage login accounts and the tracked staff roster.</p>
        </div>
        <button
          type="button"
          onClick={() => (tab === "users" ? setUserModal({ mode: "new" }) : setStaffModal({ mode: "new" }))}
          className="flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep"
        >
          <Icon name={tab === "users" ? "user-plus" : "plus"} size={16} />
          {tab === "users" ? "Add user" : "Add staff"}
        </button>
      </div>

      {creds && <CredsBanner creds={creds} onClose={() => setCreds(null)} />}

      <div className="mb-5 flex gap-1 rounded-control bg-paper-deep p-1 w-fit">
        <Tab active={tab === "users"} onClick={() => setTab("users")} icon="users">
          Login accounts ({users.length})
        </Tab>
        <Tab active={tab === "staff"} onClick={() => setTab("staff")} icon="clipboard-check">
          Staff roster ({staff.length})
        </Tab>
      </div>

      {tab === "users" ? (
        <UsersTable users={users} onEdit={(u) => setUserModal({ mode: "edit", user: u })} onCreds={setCreds} />
      ) : (
        <StaffTable staff={staff} onEdit={(s) => setStaffModal({ mode: "edit", student: s })} />
      )}

      {userModal && (
        <UserModal
          modal={userModal}
          locations={locations}
          onClose={() => setUserModal(null)}
          onCreds={setCreds}
        />
      )}
      {staffModal && (
        <StaffModal modal={staffModal} classes={classes} onClose={() => setStaffModal(null)} />
      )}
    </div>
  );
}

// ---- Users -------------------------------------------------------------

function UsersTable({ users, onEdit, onCreds }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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
    if (!confirm(`Delete ${u.full_name}'s account? This removes their login, reading log, and bookmark. The tracked roster is not affected.`)) return;
    startTransition(async () => {
      const r = await deleteUser(u.id);
      if (r?.error) alert(r.error);
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b-[0.5px] border-line text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Branch</Th>
              <Th className="text-right pr-4">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b-[0.5px] border-line last:border-0 align-middle">
                <td className="py-3 pl-4 pr-3">
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
                    </div>
                  </div>
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
            {!users.length && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-[13px] text-charcoal-soft">
                  No accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
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
    position: u.position || "",
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
      primary_location: form.primary_location,
      branches: [...branches],
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

// ---- Staff roster ------------------------------------------------------

function StaffTable({ staff, onEdit }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove(s) {
    if (!confirm(`Remove ${titleCase(s.name)} from the roster? This also deletes their ${s.lessonCount} logged lesson(s).`)) return;
    startTransition(async () => {
      const r = await deleteStudent(s.id);
      if (r?.error) alert(r.error);
      router.refresh();
    });
  }

  // Group by class for readability.
  const groups = staff.reduce((m, s) => {
    (m[s.class] ||= []).push(s);
    return m;
  }, {});

  return (
    <div className="space-y-5">
      {Object.keys(groups).length === 0 && (
        <div className="rounded-card border-[0.5px] border-line bg-white p-6 text-center text-[13px] text-charcoal-soft">
          No staff on the roster yet.
        </div>
      )}
      {Object.entries(groups).map(([cls, members]) => (
        <div key={cls} className="overflow-hidden rounded-card border-[0.5px] border-line bg-white">
          <div className="flex items-center justify-between border-b-[0.5px] border-line px-4 py-2.5">
            <span className="text-[12px] font-bold uppercase tracking-wide text-charcoal">{titleCase(cls)}</span>
            <span className="text-[11px] text-charcoal-soft">{members.length} staff</span>
          </div>
          <ul>
            {members.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 border-b-[0.5px] border-line px-4 py-2.5 last:border-0">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-charcoal">{titleCase(s.name)}</div>
                  <div className="text-[11px] text-charcoal-soft">
                    Juz {s.juz}
                    {s.position ? ` · ${s.position}` : ""} · {s.lessonCount} lesson{s.lessonCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn label="Edit" icon="pencil" onClick={() => onEdit(s)} />
                  <IconBtn label="Remove" icon="trash" danger disabled={pending} onClick={() => remove(s)} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function StaffModal({ modal, classes, onClose }) {
  const router = useRouter();
  const editing = modal.mode === "edit";
  const s = modal.student || {};
  const [form, setForm] = useState({
    name: s.name || "",
    class: s.class || classes[0],
    juz: s.juz || 1,
    position: s.position || "",
  });
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const classChanged = editing && form.class !== s.class;

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function submit() {
    setError(null);
    const payload = { id: s.id, ...form };
    startTransition(async () => {
      const r = editing ? await updateStudent(payload) : await createStudent(payload);
      if (r?.error) {
        setError(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal title={editing ? "Edit staff member" : "New staff member"} onClose={onClose}>
      <div className="space-y-3.5">
        <Labelled label="Name">
          <input className={field} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Labelled>
        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Branch">
            <select className={field} value={form.class} onChange={(e) => set("class", e.target.value)}>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {titleCase(c)}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Current Juz">
            <input
              className={field}
              type="number"
              min="1"
              max="30"
              value={form.juz}
              onChange={(e) => set("juz", e.target.value)}
            />
          </Labelled>
        </div>
        <Labelled label="Position / note">
          <input
            className={field}
            value={form.position}
            placeholder="optional, e.g. Hifz"
            onChange={(e) => set("position", e.target.value)}
          />
        </Labelled>

        {classChanged && (
          <p className="rounded-control bg-gold-soft/40 px-3 py-2 text-[12px] text-charcoal">
            Their {s.lessonCount} past lesson{s.lessonCount === 1 ? "" : "s"} will move to {titleCase(form.class)} with them.
          </p>
        )}
        {error && <p className="rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>}
      </div>

      <ModalActions pending={pending} onClose={onClose} onSave={submit} saveLabel={editing ? "Save changes" : "Add staff"} />
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
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100%-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-white p-5 shadow-[0_12px_40px_rgba(58,48,38,0.25)]"
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
