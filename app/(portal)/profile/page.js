import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { avatarSrc } from "@/lib/avatar";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import ProfileForm from "@/components/ProfileForm";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { configuredProviders, PROVIDERS } from "@/lib/auth/oauth";
import { unlinkIdentity } from "@/lib/actions/auth";

export const metadata = { title: "My profile · LQK Teachers Portal" };

const ROLE_LABEL = { admin: "Admin", reviewer: "Reviewer", teacher: "Teacher" };

export default async function ProfilePage({ searchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const db = getDb();
  const profile = db
    .prepare("SELECT full_name, email, role, primary_location, position, photo FROM profiles WHERE id = ?")
    .get(session.userId);

  const locations = db
    .prepare("SELECT location FROM teacher_locations WHERE teacher_id = ? ORDER BY is_primary DESC, location")
    .all(session.userId)
    .map((r) => r.location);
  const branches = locations.length ? locations : profile.primary_location ? [profile.primary_location] : [];

  const initial = (profile.full_name || "?").trim().charAt(0).toUpperCase();
  const src = avatarSrc(session.userId, profile.photo);

  // Social sign-ins: what is offered here, and which of them this account
  // has linked. Password stays whatever happens.
  const providers = configuredProviders();
  const linked = new Map(
    db
      .prepare("SELECT provider, email, created_at FROM auth_identities WHERE profile_id = ?")
      .all(session.userId)
      .map((r) => [r.provider, r])
  );
  const notice =
    sp?.linked === "taken"
      ? { tone: "warn", text: "That account is already linked to another portal login." }
      : typeof sp?.linked === "string" && PROVIDERS[sp.linked]
        ? { tone: "ok", text: `${PROVIDERS[sp.linked].label} is now linked to your account.` }
        : typeof sp?.unlinked === "string" && PROVIDERS[sp.unlinked]
          ? { tone: "ok", text: `${PROVIDERS[sp.unlinked].label} has been unlinked.` }
          : null;

  return (
    <div className="px-4 py-6 sm:p-8 max-w-3xl">
      <div className="mb-6">
        <PageHeading
          route="/profile"
          icon="user"
          title="My profile"
          subtitle="Update your photo and password."
        />
      </div>

      {/* Account details (managed by an admin) */}
      <div className="mb-6 rounded-card border-[0.5px] border-line bg-white p-6">
        <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft mb-4">Account</div>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Detail label="Name" value={profile.full_name} icon="user" />
          <Detail label="Email" value={profile.email} icon="mail" />
          <Detail label="Role" value={ROLE_LABEL[profile.role] || profile.role} icon="shield" />
          <Detail label="Position" value={profile.position || "—"} icon="clipboard-check" />
          <Detail label="Branch" value={branches.length ? branches.join(", ") : "—"} icon="house" />
        </dl>
        <p className="mt-4 text-[12px] text-charcoal-soft">
          Name, role, and branch are managed by an admin. Ask them to update anything that looks wrong.
        </p>
      </div>

      <div className="mb-6">
        <ProfileForm currentSrc={src} initial={initial} />
      </div>

      <div className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft mb-3">Password</div>
        <ChangePasswordForm mustChange={false} />
      </div>

      {providers.length > 0 && (
        <div className="rounded-card border-[0.5px] border-line bg-white p-6">
          <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft mb-1">Sign-in methods</div>
          <p className="mb-4 text-[12px] text-charcoal-soft">
            Link a Google, Microsoft or Facebook account to sign in with one tap. Your password keeps working either way.
          </p>
          {notice && (
            <p
              className={`mb-4 rounded-control px-3 py-2 text-[12px] font-medium ${
                notice.tone === "warn" ? "bg-rust-soft text-rust" : "bg-gold-soft/50 text-charcoal"
              }`}
            >
              {notice.text}
            </p>
          )}
          <ul className="divide-y-[0.5px] divide-line">
            {providers.map((p) => {
              const row = linked.get(p.key);
              return (
                <li key={p.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <div className="text-[13px] font-semibold text-charcoal">{p.label}</div>
                    <div className="text-[11.5px] text-charcoal-soft">{row ? `Linked · ${row.email || "no email shared"}` : "Not linked"}</div>
                  </div>
                  {row ? (
                    <form action={unlinkIdentity}>
                      <input type="hidden" name="provider" value={p.key} />
                      <button type="submit" className="rounded-control border-[0.5px] border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-charcoal hover:bg-paper-deep">
                        Unlink
                      </button>
                    </form>
                  ) : (
                    <a
                      href={`/api/auth/${p.key}/start?mode=link`}
                      className="rounded-control bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-ink-deep"
                    >
                      Link {p.label}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, icon }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex-none text-ink">
        <Icon name={icon} size={17} strokeWidth={1.6} />
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-semibold text-charcoal-soft">{label}</dt>
        <dd className="text-[14px] text-charcoal break-words">{value}</dd>
      </div>
    </div>
  );
}
