import "server-only";

/* Family-photo upload to Google Drive, via an Apps Script web app.

   Why a web app and not the Drive REST API: the REST route needs a service
   account, a GCP project, domain-wide delegation and a key file on Railway —
   and a service account gets its OWN 15GB Drive, so files land somewhere Karim
   can't see unless the folder is explicitly shared to it. The Apps Script runs
   as Karim, writes straight into his folder, and authenticates with a shared
   token. Same pattern already in use at lib/tracker/sheet.js.

   ⚠️ Known Workspace constraint (learned the hard way on Camel Caravan):
   DriveApp.setSharing(ANYONE_WITH_LINK) throws "Access denied: DriveApp" under
   this Workspace's policy even for files Karim owns. The script therefore never
   attempts to share — photos stay private in the folder, which is what we want
   for guests' family photos anyway. Do not add sharing back.

   Deploy: see scripts/drive-upload.gs, then set LQK_DRIVE_URL + LQK_DRIVE_TOKEN. */

export function driveConfigured() {
  return !!(process.env.LQK_DRIVE_URL && process.env.LQK_DRIVE_TOKEN);
}

/* Filenames carry the family name FIRST so Karim's downstream image-prompt
   batch can read the family from the filename alone, with no DB lookup. The
   token fragment keeps two "Tan Family" uploads from colliding. */
export function photoFilename({ familyName, guestName, token, mime }) {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const safe = (s) =>
    String(s || "")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40) || "Guest";
  const family = safe(familyName || guestName);
  const stamp = new Date().toISOString().slice(0, 10);
  return `${family}__${String(token).slice(0, 8)}__${stamp}.${ext}`;
}

export async function uploadPhoto({ base64, mime, filename, eventSlug }) {
  if (!driveConfigured()) return { ok: false, skipped: true, error: "Drive is not configured" };
  try {
    const res = await fetch(process.env.LQK_DRIVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: process.env.LQK_DRIVE_TOKEN,
        folderId: process.env.LQK_DRIVE_FOLDER_ID || null,
        subfolder: eventSlug || null,
        filename,
        mime: mime || "image/jpeg",
        data: base64,
      }),
    });
    // Apps Script answers 200 + HTML on an unhandled error, so parse defensively.
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: `Drive proxy returned non-JSON (${res.status})` };
    }
    if (!res.ok || !body?.ok) {
      return { ok: false, error: body?.error || `Drive proxy returned ${res.status}` };
    }
    return { ok: true, fileId: body.fileId, url: body.url || null };
  } catch (err) {
    return { ok: false, error: err?.message || "network error" };
  }
}
