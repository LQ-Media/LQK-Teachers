import "server-only";
import webpush from "web-push";
import { getDb } from "@/lib/db";
import { deleteSubscriptionByEndpoint } from "./store";

// VAPID keys identify this server to the browsers' push services. They are
// generated once and persisted in the kv table (on the mounted volume), so
// existing subscriptions survive redeploys with zero env configuration.
const VAPID_KEY = "azan_vapid_keys";
const VAPID_SUBJECT = "mailto:karim@littlequrankids.sg";

let vapid = null;
let configured = false;

export function getVapidKeys() {
  if (vapid) return vapid;
  const db = getDb();
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(VAPID_KEY);
  if (row) {
    vapid = JSON.parse(row.value);
  } else {
    vapid = webpush.generateVAPIDKeys();
    db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").run(VAPID_KEY, JSON.stringify(vapid));
  }
  return vapid;
}

function ensureConfigured() {
  if (configured) return;
  const keys = getVapidKeys();
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  configured = true;
}

/**
 * Send a push message to one stored subscription row ({endpoint, p256dh, auth}).
 * Expired/revoked subscriptions (404/410) are pruned from the DB silently.
 */
export async function sendPush(sub, payload) {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 120, urgency: "high" }
    );
    return true;
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      deleteSubscriptionByEndpoint(sub.endpoint);
    } else {
      console.error("[azan] push failed:", err?.statusCode || err?.message || err);
    }
    return false;
  }
}
