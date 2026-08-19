import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/* The volunteer's sign-in for a booth phone.

   Its own token, not a portal session: a volunteer holding a borrowed phone has
   no account, and an event's staff PIN must never mint something that could
   reach the portal. The payload says only which event and which booth — there
   is no user here, and nothing in it grants anything beyond the two event-day
   screens.

   SIGNED rather than a plain cookie holding an event id, which anyone could
   type into devtools to walk straight past the PIN.

   Sixteen hours: long enough that nobody re-types the PIN mid-event, short
   enough that a phone left in a drawer is not still staff kit next weekend. */

const COOKIE_NAME = "lqk_booth";
const TTL_HOURS = 16;

// Resolved lazily, exactly as lib/session.js does, so `next build` doesn't
// require the secret while a running production server still fails fast.
function getKey() {
  const secret = process.env.SESSION_SECRET;
  if (secret) return new TextEncoder().encode(secret);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set — refusing to sign booth sessions with an insecure key in production.");
  }
  return new TextEncoder().encode("dev-only-insecure-secret-change-me");
}

export async function createBoothSession({ eventId, boothId = null }) {
  const token = await new SignJWT({ eventId, boothId, kind: "booth" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_HOURS}h`)
    .sign(getKey());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_HOURS * 3600,
  });
}

export async function getBoothSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), { algorithms: ["HS256"] });
    // `kind` is checked so a portal session cookie pasted in here is rejected
    // rather than accidentally satisfying the booth gate.
    return payload?.kind === "booth" ? payload : null;
  } catch {
    return null;
  }
}

export async function clearBoothSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
