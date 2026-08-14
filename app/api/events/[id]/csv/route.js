import { getSession } from "@/lib/session";
import { getEvent, guestListCsv, attendeeListCsv } from "@/lib/events/queries";

/* Guest-list export.

   Uses getSession + a 403 rather than requireRole, which redirects — a redirect
   to /login from a download link gives the browser an HTML page named
   "guests.csv" instead of an honest error. */
export async function GET(request, { params }) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorised", { status: 401 });
  if (session.role !== "admin") return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const event = getEvent(id);
  if (!event) return new Response("Not found", { status: 404 });

  // ?view=people is the one-row-per-person sheet, for events that ask
  // per-attendee questions. Same auth, same export, different grain.
  const people = new URL(request.url).searchParams.get("view") === "people";

  // Leading BOM: without it Excel on Windows reads the file as latin-1 and
  // mangles every accented or Jawi name in the guest list.
  const csv = `﻿${people ? attendeeListCsv(id) : guestListCsv(id)}`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug}-${people ? "attendees" : "guest-list"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
