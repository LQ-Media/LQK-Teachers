import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { avatarSrc } from "@/lib/avatar";
import { isPdf } from "@/lib/certs";
import { sgMonthNow } from "@/lib/hours/rates";
import { achievementsData, adminScoreboard } from "@/lib/achievements/score";
import AchievementsApp from "@/components/achievements/AchievementsApp";

export const metadata = { title: "Achievements · LQK Teachers Portal" };

// node:sqlite rows have a null prototype; everything handed to the client
// component below is mapped into a plain object first or Next throws.
export default async function AchievementsPage({ searchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const db = getDb();
  const isAdmin = session.role === "admin";
  const season = /^\d{4}-\d{2}$/.test(String(sp?.month || "")) ? String(sp.month) : sgMonthNow();

  const data = achievementsData(session, season);

  // Photos are resolved server-side into a src the browser can use (local
  // uploads go through the session-gated /api/avatar route).
  const withAvatar = (r) => ({ ...r, avatar: avatarSrc(r.id, r.photo), photo: undefined });

  const myCerts = db
    .prepare(
      `SELECT c.id, c.cert_name, c.issuer, c.issued_on, c.status, c.reviewer_note, c.created_at, c.image_path
       FROM certifications c WHERE c.teacher_id = ? ORDER BY c.created_at DESC`
    )
    .all(session.userId)
    .map((c) => ({
      id: c.id,
      name: c.cert_name,
      issuer: c.issuer || "",
      issuedOn: c.issued_on || "",
      status: c.status,
      reviewerNote: c.reviewer_note || "",
      createdAt: c.created_at,
      isPdf: isPdf(c.image_path),
    }));

  const certTypes = db
    .prepare("SELECT id, name, description, active FROM cert_types ORDER BY name")
    .all()
    .map((t) => ({ id: t.id, name: t.name, description: t.description || "", active: !!t.active }));

  const myHonours = db
    .prepare(
      "SELECT id, kind, title, reason, month, created_at FROM honours WHERE teacher_id = ? ORDER BY created_at DESC"
    )
    .all(session.userId)
    .map((h) => ({
      id: h.id,
      kind: h.kind,
      title: h.title,
      reason: h.reason || "",
      month: h.month || "",
      createdAt: h.created_at,
    }));

  // Confirmed nominations only — a teacher never sees one that was declined.
  const myNominations = db
    .prepare(
      `SELECT n.id, n.reason, n.month, p.full_name
       FROM nominations n JOIN profiles p ON p.id = n.nominator_id
       WHERE n.nominee_id = ? AND n.status = 'confirmed' ORDER BY n.created_at DESC`
    )
    .all(session.userId)
    .map((n) => ({ id: n.id, reason: n.reason, month: n.month, from: n.full_name }));

  const iNominatedThisMonth = !!db
    .prepare("SELECT 1 FROM nominations WHERE nominator_id = ? AND month = ?")
    .get(session.userId, sgMonthNow());

  // Colleague list for the nomination picker (names only).
  const colleagues = db
    .prepare("SELECT id, full_name, primary_location FROM profiles WHERE id != ? ORDER BY full_name")
    .all(session.userId)
    .map((p) => ({ id: p.id, name: p.full_name, branch: p.primary_location || "" }));

  let admin = null;
  if (isAdmin) {
    const pendingCerts = db
      .prepare(
        `SELECT c.id, c.cert_name, c.issuer, c.issued_on, c.created_at, c.image_path, p.full_name, p.id AS teacher_id
         FROM certifications c JOIN profiles p ON p.id = c.teacher_id
         WHERE c.status = 'pending' ORDER BY c.created_at`
      )
      .all()
      .map((c) => ({
        id: c.id,
        name: c.cert_name,
        issuer: c.issuer || "",
        issuedOn: c.issued_on || "",
        createdAt: c.created_at,
        teacher: c.full_name,
        teacherId: c.teacher_id,
        isPdf: isPdf(c.image_path),
      }));

    const pendingNominations = db
      .prepare(
        `SELECT n.id, n.reason, n.month, nominee.full_name AS nominee, nominator.full_name AS nominator
         FROM nominations n
         JOIN profiles nominee ON nominee.id = n.nominee_id
         JOIN profiles nominator ON nominator.id = n.nominator_id
         WHERE n.status = 'pending' ORDER BY n.created_at`
      )
      .all()
      .map((n) => ({
        id: n.id,
        reason: n.reason,
        month: n.month,
        nominee: n.nominee,
        nominator: n.nominator,
      }));

    // Roster rows and their linked account — the link that makes personal
    // hafalan scoring possible at all.
    const roster = db
      .prepare(
        `SELECT s.id, s.name, s.class, s.juz, s.profile_id, p.full_name AS linked_name
         FROM students s LEFT JOIN profiles p ON p.id = s.profile_id
         ORDER BY s.class, s.name`
      )
      .all()
      .map((s) => ({
        id: s.id,
        name: s.name,
        class: s.class,
        juz: s.juz,
        profileId: s.profile_id || "",
        linkedName: s.linked_name || "",
      }));

    const accounts = db
      .prepare("SELECT id, full_name, email FROM profiles ORDER BY full_name")
      .all()
      .map((p) => ({ id: p.id, name: p.full_name, email: p.email }));

    const allHonours = db
      .prepare(
        `SELECT h.id, h.kind, h.title, h.month, h.created_at, p.full_name
         FROM honours h JOIN profiles p ON p.id = h.teacher_id
         ORDER BY h.created_at DESC LIMIT 30`
      )
      .all()
      .map((h) => ({
        id: h.id,
        kind: h.kind,
        title: h.title,
        month: h.month || "",
        name: h.full_name,
        createdAt: h.created_at,
      }));

    admin = {
      scoreboard: adminScoreboard(season),
      pendingCerts,
      pendingNominations,
      roster,
      accounts,
      allHonours,
      unlinkedCount: roster.filter((r) => !r.profileId).length,
    };
  }

  return (
    <AchievementsApp
      season={season}
      me={data.me ? withAvatar(data.me) : null}
      podium={{
        org: data.podium.org.map(withAvatar),
        branch: data.podium.branch.map(withAvatar),
        allTime: data.podium.allTime.map(withAvatar),
      }}
      branches={data.branches}
      myBranch={data.myBranch}
      monthlyTitle={
        data.monthlyTitle
          ? { ...data.monthlyTitle, avatar: avatarSrc(data.monthlyTitle.teacherId, data.monthlyTitle.photo), photo: undefined }
          : null
      }
      recentHonours={data.recentHonours.map((h) => ({
        ...h,
        avatar: avatarSrc(h.teacherId, h.photo),
        photo: undefined,
      }))}
      myCerts={myCerts}
      certTypes={certTypes}
      myHonours={myHonours}
      myNominations={myNominations}
      iNominatedThisMonth={iNominatedThisMonth}
      colleagues={colleagues}
      isAdmin={isAdmin}
      admin={admin}
    />
  );
}
