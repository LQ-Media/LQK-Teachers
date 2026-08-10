import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { sgToday } from "@/lib/hours/rates";
import { verseForDate, positionForDate } from "@/lib/kalimah/verses";
import { fetchVerseWords } from "@/lib/kalimah/fetch";
import { streakFor } from "@/lib/kalimah/streak";
import { surahByNumber } from "@/lib/quran/surah-list";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import KalimahApp from "@/components/kalimah/KalimahApp";

export const metadata = { title: "Kalimah" };

export default async function KalimahPage() {
  const session = await requireSession();
  const db = getDb();

  const today = sgToday();
  const verseKey = verseForDate(today);
  const position = positionForDate(today);

  const result = await fetchVerseWords(verseKey);

  const doneToday = db
    .prepare("SELECT score, total FROM kalimah_progress WHERE teacher_id = ? AND date = ?")
    .get(session.userId, today);

  const daysDone = db
    .prepare("SELECT COUNT(*) AS c FROM kalimah_progress WHERE teacher_id = ?")
    .get(session.userId).c;

  const wordsSeen = db
    .prepare("SELECT COALESCE(SUM(words_seen), 0) AS w FROM kalimah_progress WHERE teacher_id = ?")
    .get(session.userId).w;

  const streak = streakFor(db, session.userId, today);
  const surahName = surahByNumber(Number(verseKey.split(":")[0]))?.name ?? "";

  return (
    <div className="px-4 py-6 sm:p-8 max-w-3xl">
      <div className="mb-6">
        <PageHeading
          route="/kalimah"
          icon="star"
          title="Kalimah"
          subtitle={`Five minutes of Quranic Arabic a day, word by word. Everyone at LQK studies the same ayah today — day ${position.day} of ${position.total}.`}
        />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat icon="flame" label="Day streak" value={streak} note={streak === 0 ? "Start today" : "Keep it going"} />
        <Stat icon="check" label="Days done" value={daysDone} note="All time" />
        <Stat icon="type" label="Words studied" value={wordsSeen} note="All time" />
      </div>

      {result.ok ? (
        <KalimahApp
          verse={result.verse}
          surahName={surahName}
          alreadyDone={doneToday ? { score: doneToday.score, total: doneToday.total } : null}
        />
      ) : (
        <div className="rounded-card border border-line bg-white px-5 py-10 text-center">
          <span className="mx-auto mb-3 block w-fit text-charcoal-soft">
            <Icon name="alert-triangle" size={22} />
          </span>
          <p className="text-[13px] text-charcoal-soft">
            {result.error} Today&apos;s ayah is {surahName} {verseKey.split(":")[1]} — try again in a moment.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, note }) {
  return (
    <div className="rounded-card border-[0.5px] border-line bg-gradient-to-br from-white to-[#FDF8EE] px-4 py-3.5">
      <div className="mb-1 flex items-center gap-1.5 text-charcoal-soft">
        <Icon name={icon} size={13} />
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p className="font-heading text-[22px] font-bold leading-none text-charcoal">{value}</p>
      <p className="mt-1 text-[11px] text-charcoal-soft">{note}</p>
    </div>
  );
}
