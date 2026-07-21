import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import Sidebar from "@/components/Sidebar";

export default async function PortalLayout({ children }) {
  const session = await requireSession();

  let pendingReviewCount = 0;
  if (session.role === "reviewer" || session.role === "admin") {
    const db = getDb();
    const row = db.prepare("SELECT COUNT(*) AS count FROM hafalan_entries WHERE status = 'pending'").get();
    pendingReviewCount = row.count;
  }

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar role={session.role} fullName={session.fullName} pendingReviewCount={pendingReviewCount} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
