import { notFound } from "next/navigation";
import { getFamilyByToken, passportFor, familyMembers } from "@/lib/qr/queries";
import { displayName, formatToken } from "@/lib/qr/passport";
import QrCode from "@/components/qr/QrCode";
import Passport from "./Passport";

/* A family's pass.

   Per-request, never cached: it shows THIS family's progress, and a cached copy
   would show one family another's letters. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { token } = await params;
  const found = getFamilyByToken(token);
  return {
    title: found ? `Our pass — ${found.event.title}` : "Pass",
    robots: { index: false, follow: false },
  };
}

export default async function PassPage({ params }) {
  const { token } = await params;
  const found = getFamilyByToken(token);
  if (!found) notFound();

  const { family, event } = found;
  const passport = passportFor(event, family);
  const baseUrl = (process.env.LQK_PUBLIC_BASE_URL || "https://teachers.littlequrankids.sg").replace(/\/+$/, "");

  return (
    <Passport
      name={displayName(family)}
      code={formatToken(family.token)}
      /* The RAW token keys the reveal state in localStorage. Keying it on the
         printed form would tie a family's opened tiles to a display detail —
         change the grouping and every pass in the hall silently re-seals. */
      token={family.token}
      eventTitle={event.title}
      passport={passport}
      memberCount={familyMembers(family.id).length}
      /* The pass QR encodes a FULL URL, not a bare code: a parent who scans
         their own pass with the phone camera then lands somewhere useful
         instead of seeing eight meaningless characters. The booth scanner
         pulls the token back out of the path. */
      qr={
        <QrCode
          value={`${baseUrl}/q/p/${family.token}`}
          size={200}
          title="Show this at each booth"
        />
      }
    />
  );
}
