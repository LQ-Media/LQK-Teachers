import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { avatarSrc } from "@/lib/avatar";
import Sidebar from "@/components/Sidebar";
import InstallPrompt from "@/components/pwa/InstallPrompt";

export default async function PortalLayout({ children }) {
  const session = await requireSession();
  const db = getDb();

  let pendingReviewCount = 0;
  if (session.role === "reviewer" || session.role === "admin") {
    const row = db.prepare("SELECT COUNT(*) AS count FROM hafalan_entries WHERE status = 'pending'").get();
    pendingReviewCount = row.count;
  }

  const me = db.prepare("SELECT photo FROM profiles WHERE id = ?").get(session.userId);
  const avatar = avatarSrc(session.userId, me?.photo);

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar
        role={session.role}
        fullName={session.fullName}
        avatar={avatar}
        pendingReviewCount={pendingReviewCount}
      />
      <main className="flex-1 min-w-0">{children}</main>
      <InstallPrompt />
    </div>
  );
}
