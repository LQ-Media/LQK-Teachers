import { getGuestByToken } from "@/lib/events/queries";
import { buildInviteIcs } from "@/lib/events/ics";

/* Downloadable calendar entry for a guest's invitation. The UID is derived
   from the token PREFIX, not the token — an .ics file gets shared around
   family group chats, and the full token is the guest's credential. */

export async function GET(_request, { params }) {
  const { token } = await params;
  const found = getGuestByToken(token);
  if (!found || found.event.status === "draft") {
    return new Response("Not found", { status: 404 });
  }

  const ics = buildInviteIcs({
    event: found.event,
    uid: `${found.guest.token.slice(0, 8)}-${found.event.slug}@littlequrankids.sg`,
  });
  if (!ics) return new Response("This event has no date yet", { status: 404 });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${found.event.slug}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
