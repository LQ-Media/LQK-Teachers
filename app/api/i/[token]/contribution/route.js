import { getGuestByToken } from "@/lib/events/queries";

/* Contribution status for the guest's own invitation, polled by the reply form
   while a checkout is pending so the page flips to "Paid" without a reload.
   The token in the path is the credential, same as the page itself. Returns
   the minimum the UI needs — no order ids, no amounts. */

export async function GET(_request, { params }) {
  const { token } = await params;
  const found = getGuestByToken(token);
  if (!found) return Response.json({ error: "not found" }, { status: 404 });

  const { rsvp } = found;
  return Response.json(
    {
      status: rsvp?.contribution_status || "none",
      title: rsvp?.contribution_title || null,
      qty: rsvp?.contribution_qty || null,
      paidAt: rsvp?.contribution_paid_at || null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
