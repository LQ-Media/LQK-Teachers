import { getSession } from "@/lib/session";
import { saveSubscription, deleteSubscription, saveAzanSettings } from "@/lib/azan/store";

// POST { subscription, tz?, country? } — register this device for azan pushes.
// The tz/country ride along so the server-side scheduler computes prayer
// times for the same place the user sees in the widget.
export async function POST(request) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (!saveSubscription(session.userId, body?.subscription)) {
    return Response.json({ error: "Invalid subscription." }, { status: 400 });
  }
  const patch = {};
  if (typeof body?.tz === "string") patch.tz = body.tz;
  if (typeof body?.country === "string") patch.country = body.country;
  if (Object.keys(patch).length) saveAzanSettings(session.userId, patch);

  return Response.json({ ok: true });
}

// DELETE { endpoint } — unregister this device.
export async function DELETE(request) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (typeof body?.endpoint !== "string") return new Response("Bad request", { status: 400 });

  deleteSubscription(session.userId, body.endpoint);
  return Response.json({ ok: true });
}
