import { requireRole } from "@/lib/dal";
import { getDb } from "@/lib/db";
import ReviewCard from "@/components/ReviewCard";

export default async function ReviewPage() {
  await requireRole(["reviewer", "admin"]);

  const db = getDb();
  const entries = db
    .prepare(`
      SELECT hafalan_entries.*, profiles.full_name, profiles.primary_location
      FROM hafalan_entries
      JOIN profiles ON profiles.id = hafalan_entries.teacher_id
      WHERE hafalan_entries.status = 'pending'
      ORDER BY hafalan_entries.created_at ASC
    `)
    .all();

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">Hafalan review</h1>
        <p className="text-[13px] text-charcoal-soft mt-1">
          All pending submissions across all four locations.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="bg-white border-[0.5px] border-line rounded-card p-10 text-center">
          <div className="text-2xl mb-2 text-sage">✓</div>
          <div className="text-[13px] font-semibold text-sage">
            All caught up — no pending reviews right now.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map((entry) => (
            <ReviewCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
