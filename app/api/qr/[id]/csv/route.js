import { getSession } from "@/lib/session";
import { getQrEvent, listAttendance } from "@/lib/qr/queries";
import { parseAnswers } from "@/lib/qr/fields";

/* The attendance register as a CSV.

   One row per PERSON, not per family: "who was in the room, and what class are
   they in" is the question this feature exists to answer, and a spreadsheet of
   families with a headcount column cannot answer it. */
function cell(value) {
  const text = String(value ?? "");
  // Quote anything a spreadsheet would otherwise split or interpret. The
  // leading-character guard stops Excel treating a name like "=Ahmad" as a
  // formula.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(_request, ctx) {
  const session = await getSession();
  if (session?.role !== "admin") return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const event = getQrEvent(id);
  if (!event) return new Response("Not found", { status: 404 });

  const rows = listAttendance(id);
  const header = [
    "Name", "Class", "Adult or child", "On the list", "Family", "Others in party", "Contact", "Phone", "Email",
    ...event.fields.map((f) => f.label),
  ];

  const lines = [header.map(cell).join(",")];
  for (const row of rows) {
    const answers = parseAnswers(row.answers_json);
    lines.push(
      [
        row.name,
        row.class_name || "",
        row.kind,
        row.expected_id ? "yes" : "walk-in",
        row.family_name,
        // Party-level, so it repeats on each of the party's rows exactly as
        // the contact and phone columns do. Summing this column would
        // double-count; it belongs to the family, not to the person.
        row.extra_pax || 0,
        row.contact_name || "",
        row.phone || "",
        row.email || "",
        ...event.fields.map((f) => answers[f.id] || ""),
      ]
        .map(cell)
        .join(","),
    );
  }

  const fileName = `${event.slug}-attendance.csv`;
  return new Response(`﻿${lines.join("\r\n")}`, {
    headers: {
      // The BOM is for Excel: without it a name with an accent opens as mojibake.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
