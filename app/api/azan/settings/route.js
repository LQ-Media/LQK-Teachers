import { getSession } from "@/lib/session";
import { getAzanSettings, saveAzanSettings, listCustomSounds, countSubscriptions } from "@/lib/azan/store";
import { getVapidKeys } from "@/lib/azan/push";

// GET: everything the azan UI needs in one round trip.
// PUT: partial settings update ({muted} alone is valid — the dashboard bell uses it).
export async function GET() {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  return Response.json({
    settings: getAzanSettings(session.userId),
    customSounds: listCustomSounds(session.userId).map(({ id, label }) => ({ id, label })),
    vapidPublicKey: getVapidKeys().publicKey,
    subscriptionCount: countSubscriptions(session.userId),
  });
}

export async function PUT(request) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const settings = saveAzanSettings(session.userId, body || {});
  return Response.json({ settings });
}
