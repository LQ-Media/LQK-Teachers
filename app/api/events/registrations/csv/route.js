import { getSession } from "@/lib/session";
import { storeAttendeeCsv } from "@/lib/events/queries";

/* Attendee-list export for store registrations — one row per person, the sheet
   the registration desk works from. Same getSession-not-requireRole reasoning
   as the guest-list export: a redirect to /login from a download link hands
   the browser an HTML page named like a CSV. */
export async function GET() {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorised", { status: 401 });
  if (session.role !== "admin") return new Response("Forbidden", { status: 403 });

  // Leading BOM: without it Excel on Windows reads the file as latin-1 and
  // mangles every accented or Jawi name.
  const csv = `﻿${storeAttendeeCsv()}`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="store-registrations.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
