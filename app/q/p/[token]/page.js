import { notFound } from "next/navigation";
import { getRegistrationByToken, attendanceFor, getPhoto } from "@/lib/qr/queries";
import { partyName, formatToken } from "@/lib/qr/tokens";
import QrCode from "@/components/qr/QrCode";
import Pass from "./Pass";

/* A family's pass.

   Per-request, never cached: it shows THIS family's people and their photo, and
   a cached copy would show one family another's. */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { token } = await params;
  const found = getRegistrationByToken(token);
  return {
    title: found ? `Our pass — ${found.event.title}` : "Pass",
    robots: { index: false, follow: false },
  };
}

export default async function PassPage({ params }) {
  const { token } = await params;
  const found = getRegistrationByToken(token);
  if (!found) notFound();

  const { registration, event } = found;
  const photo = getPhoto(registration.id);
  const baseUrl = (process.env.LQK_PUBLIC_BASE_URL || "https://teachers.littlequrankids.sg").replace(/\/+$/, "");

  return (
    <Pass
      token={registration.token}
      code={formatToken(registration.token)}
      name={partyName(registration)}
      eventTitle={event.title}
      venue={event.venue_name}
      people={attendanceFor(registration.id)}
      photoEnabled={Boolean(event.photo_enabled)}
      photoBlurb={event.photo_blurb}
      consentText={event.photo_consent_text}
      hasPhoto={photo?.status === "ready"}
      /* The pass QR encodes a FULL URL, not a bare code: a parent who scans
         their own pass with the phone camera then lands somewhere useful
         instead of seeing eight meaningless characters. */
      qr={
        <QrCode
          value={`${baseUrl}/q/p/${registration.token}`}
          size={180}
          title="Your family pass"
        />
      }
    />
  );
}
