import { getSession } from "@/lib/session";
import { achievementsData } from "@/lib/achievements/score";
import { formatPoints } from "@/lib/achievements/points";

/**
 * The once-a-day summary shown when a teacher opens the dashboard.
 *
 * Fetched rather than server-rendered into the dashboard on purpose:
 * `achievementsData` recomputes every teacher's score from their whole history,
 * and the brief is shown at most once per teacher per day. Paying for that on
 * every dashboard load — including the dozen a teacher does between lessons —
 * to render something they will see once would be the wrong trade. The client
 * decides "is this the first open today?" from localStorage and only then calls
 * here.
 *
 * Only the caller's own numbers plus branch TOTALS leave this route; the
 * position inside a branch is a rank, never a list of colleagues' scores.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  const data = achievementsData(session);
  const me = data.me;
  if (!me) {
    // No scored activity yet (a brand-new account). Nothing to summarise —
    // better silence than a modal full of zeros on someone's first morning.
    return Response.json({ show: false });
  }

  const branches = data.branches || [];
  const branchIndex = branches.findIndex((b) => b.branch === data.myBranch);

  return Response.json({
    show: true,
    season: data.season,
    firstName: (session.fullName || "").split(" ")[0] || "there",
    points: {
      month: me.month,
      monthLabel: formatPoints(me.month),
      allTime: me.allTime,
      allTimeLabel: formatPoints(me.allTime),
    },
    level: me.level, // { level, name, … } from levelFor()
    streak: me.stats?.currentStreak ?? 0,
    branch: data.myBranch
      ? {
          name: data.myBranch,
          // Where I sit among my own branch's scored teachers.
          myPosition: me.standing?.branch?.position ?? null,
          myOf: me.standing?.branch?.of ?? null,
          // Where my branch sits against the other branches.
          position: branchIndex >= 0 ? branchIndex + 1 : null,
          of: branches.length,
          points: branchIndex >= 0 ? branches[branchIndex].month : 0,
          people: branchIndex >= 0 ? branches[branchIndex].people : 0,
          leader: branches[0]?.branch || null,
        }
      : null,
  });
}
