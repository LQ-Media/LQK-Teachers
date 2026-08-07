import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { TOPICS, AGE_GROUPS, ageLabel } from "@/lib/notes/taxonomy";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import EmptyArt from "@/components/EmptyArt";

export const metadata = { title: "Ilmu Bank" };

/**
 * The centre's shared library. Everything here was contributed by a teacher
 * from their own Halaqah Notebook; only the summary is published, never the
 * contributor's raw transcript.
 *
 * Search is a plain LIKE across title/overview rather than FTS5 — at the scale
 * this will realistically reach (hundreds of notes, not millions) the query is
 * instant, and it keeps the schema free of a shadow table to maintain.
 */
export default async function IlmuPage({ searchParams }) {
  await requireSession();
  const sp = await searchParams;
  const db = getDb();

  const q = String(sp?.q || "").trim().slice(0, 100);
  const topic = TOPICS.includes(sp?.topic) ? sp.topic : "";
  const age = AGE_GROUPS.some((a) => a.key === sp?.age) ? sp.age : "";

  const where = ["n.shared_at IS NOT NULL"];
  const args = [];
  if (q) {
    where.push("(n.title LIKE ? OR n.summary LIKE ? OR n.speaker LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  if (topic) {
    where.push("n.topic = ?");
    args.push(topic);
  }
  if (age) {
    where.push("n.age_group = ?");
    args.push(age);
  }

  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.topic, n.age_group, n.speaker, n.venue, n.occurred_on,
              n.shared_at, n.summary, p.full_name AS contributor
       FROM notes n JOIN profiles p ON p.id = n.teacher_id
       WHERE ${where.join(" AND ")}
       ORDER BY n.shared_at DESC
       LIMIT 100`
    )
    .all(...args);

  const notes = rows.map((n) => ({
    id: n.id,
    title: n.title,
    topic: n.topic,
    ageGroup: n.age_group,
    speaker: n.speaker,
    contributor: n.contributor,
    occurredOn: n.occurred_on,
    overview: overviewOf(n.summary),
  }));

  const total = db.prepare("SELECT COUNT(*) AS c FROM notes WHERE shared_at IS NOT NULL").get().c;
  const filtering = Boolean(q || topic || age);

  return (
    <div className="px-4 py-6 sm:p-8 max-w-3xl">
      <div className="mb-6">
        <PageHeading
          route="/ilmu"
          icon="users"
          title="Ilmu Bank"
          subtitle={`What the rest of the team has been learning. ${total} note${total === 1 ? "" : "s"} shared so far — add yours from the Halaqah Notebook.`}
        />
      </div>

      {/* Filters are a plain GET form so results are linkable and survive a reload. */}
      <form method="GET" className="mb-6 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-charcoal-soft">
              <Icon name="search" size={16} />
            </span>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search titles, summaries, speakers…"
              className="w-full rounded-control border border-line bg-white py-2.5 pl-9 pr-3 text-[14px] outline-none focus:border-gold"
            />
          </div>
          <button
            type="submit"
            className="rounded-control bg-ink px-5 py-2.5 text-[13px] font-bold text-paper transition-opacity hover:opacity-90"
          >
            Search
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            name="topic"
            defaultValue={topic}
            className="rounded-control border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-gold"
          >
            <option value="">All topics</option>
            {TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            name="age"
            defaultValue={age}
            className="rounded-control border border-line bg-white px-3 py-2 text-[13px] outline-none focus:border-gold"
          >
            <option value="">Any age group</option>
            {AGE_GROUPS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
          {filtering && (
            <Link
              href="/ilmu"
              className="flex items-center rounded-control px-3 py-2 text-[13px] font-semibold text-charcoal-soft hover:bg-paper-deep"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      {notes.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-white/60">
          {/* A search that found nothing isn't an empty bank — keep the art for
              the genuinely-empty case so it doesn't read as a dead end. */}
          <EmptyArt art={filtering ? null : "ilmu"}>
            {filtering
              ? "Nothing matches that search yet."
              : "The bank is empty. Summarise a note in your Halaqah Notebook, then share it here."}
          </EmptyArt>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {notes.map((n) => (
            <li key={n.id}>
              <Link
                href={`/ilmu/${n.id}`}
                className="block rounded-card border border-line bg-white px-5 py-4 transition-colors hover:border-gold hover:bg-paper"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  {n.topic && (
                    <span className="rounded-pill bg-sand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
                      {n.topic}
                    </span>
                  )}
                  {n.ageGroup && n.ageGroup !== "all" && (
                    <span className="rounded-pill bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-soft">
                      {ageLabel(n.ageGroup)}
                    </span>
                  )}
                </div>
                <p className="font-heading text-[15px] font-bold leading-snug text-charcoal">{n.title}</p>
                {n.overview && (
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-charcoal-soft">
                    {n.overview}
                  </p>
                )}
                <p className="mt-2 text-[12px] text-charcoal-soft">
                  Shared by {n.contributor}
                  {n.speaker ? ` · from a talk by ${n.speaker}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function overviewOf(summaryJson) {
  if (!summaryJson) return "";
  try {
    return String(JSON.parse(summaryJson)?.overview || "");
  } catch {
    return "";
  }
}
