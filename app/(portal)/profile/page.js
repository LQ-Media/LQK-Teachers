import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { avatarSrc } from "@/lib/avatar";
import Icon from "@/components/Icon";
import ProfileForm from "@/components/ProfileForm";
import ChangePasswordForm from "@/components/ChangePasswordForm";

export const metadata = { title: "My profile · LQK Teachers Portal" };

const ROLE_LABEL = { admin: "Admin", reviewer: "Reviewer", teacher: "Teacher" };

export default async function ProfilePage() {
  const session = await requireSession();
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

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">My profile</h1>
        <p className="text-[13px] text-charcoal-soft mt-1">Update your photo and password.</p>
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

      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft mb-3">Password</div>
        <ChangePasswordForm mustChange={false} />
      </div>
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
