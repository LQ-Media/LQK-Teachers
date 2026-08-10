import { getSession } from "@/lib/session";
import { getEvent, cateringCsv } from "@/lib/events/queries";

/* Catering export.

   Uses getSession + a 403 rather than requireRole, which redirects — a redirect
   to /login from a download link gives the browser an HTML page named
   "guests.csv" instead of an honest error. */
export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorised", { status: 401 });
  if (session.role !== "admin") return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const event = getEvent(id);
  if (!event) return new Response("Not found", { status: 404 });

  // Leading BOM: without it Excel on Windows reads the file as latin-1 and
  // mangles every accented or Jawi name in the guest list.
  const csv = `﻿${cateringCsv(id)}`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug}-catering.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
