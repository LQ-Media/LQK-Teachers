import { getBoothSession } from "@/lib/qr/booth-session";
import { getQrEvent, listOpenQrEvents } from "@/lib/qr/queries";
import BoothStation from "./BoothStation";

/* The volunteer's phone. Three states, resolved on the server so a reload never
   lands somewhere half-signed-in: choose an event → enter the PIN → pick a
   booth → scan all day. */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Booth scanner",
  robots: { index: false, follow: false },
};

export default async function BoothPage() {
  const session = await getBoothSession();
  const event = session ? getQrEvent(session.eventId) : null;

  // A session whose event was closed or deleted since sign-in is treated as no
  // session — otherwise the phone sits on a scanner that can never award.
  const live = event && event.status === "open" ? event : null;

  return (
    <BoothStation
      events={live ? [] : listOpenQrEvents()}
      event={
        live
          ? {
              id: live.id,
              title: live.title,
              booths: live.booths.map((b) => ({ id: b.id, name: b.name, letter: b.letter })),
            }
          : null
      }
      boothId={live ? session.boothId || null : null}
    />
  );
}
