/**
 * LQK event invitations — family photo receiver.
 *
 * Deploy this as an Apps Script Web App so the Teachers portal can drop guest
 * family photos straight into Karim's Drive folder without a service account.
 *
 * ── SETUP ────────────────────────────────────────────────────────────────
 *  1. script.google.com → New project → paste this file → name it
 *     "LQK Event Photos".
 *  2. Project Settings → Script Properties → add:
 *        SHARED_TOKEN  = <a long random string you invent>
 *        FOLDER_ID     = 1XNsUAj_2WUPINoDeKj-WSPlDScEhNKbQ
 *
 *     FOLDER_ID here is only a FALLBACK. The portal sends the folder on every
 *     request from LQK_DRIVE_FOLDER_ID on Railway (already set to the id
 *     above), and body.folderId wins — so the live destination is changed on
 *     Railway, not here. Keep the two in step anyway so a manual `selfTest`
 *     writes where you expect.
 *
 *     The account you deploy as MUST have edit access to that folder. The
 *     script writes as you, not as the portal, so a folder owned by another
 *     Google account fails at createFile() with a permissions error.
 *  3. Deploy → New deployment → type "Web app"
 *        Execute as:     Me (media@littlequrankids.sg)
 *        Who has access: Anyone
 *     Copy the /exec URL.
 *  4. On Railway (LQK-Teachers service) set:
 *        LQK_DRIVE_URL   = <the /exec URL>
 *        LQK_DRIVE_TOKEN = <the same SHARED_TOKEN>
 *  5. Run `selfTest` once from the editor to trigger the OAuth consent screen
 *     and confirm a file lands in the folder. Delete the test file after.
 *
 * "Who has access: Anyone" is required — Railway is not a Google identity and
 * cannot carry a Google login. The SHARED_TOKEN is the actual authentication;
 * treat it like a password and rotate it if it leaks.
 *
 * NOTE: this script never calls setSharing(). Under this Workspace's policy
 * that call throws "Access denied: DriveApp" even on files we own, and guest
 * family photos should stay private in the folder regardless.
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: 'empty request' });
    }

    var body = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty('SHARED_TOKEN');

    if (!expected || body.token !== expected) {
      return json({ ok: false, error: 'unauthorised' });
    }
    if (!body.data || !body.filename) {
      return json({ ok: false, error: 'missing data or filename' });
    }

    var folderId = body.folderId || props.getProperty('FOLDER_ID');
    if (!folderId) return json({ ok: false, error: 'no folder configured' });

    var folder = DriveApp.getFolderById(folderId);

    // One subfolder per event keeps years of Maulid photos from piling into a
    // single directory. Created on demand; reused if it already exists.
    if (body.subfolder) {
      var existing = folder.getFoldersByName(body.subfolder);
      folder = existing.hasNext() ? existing.next() : folder.createFolder(body.subfolder);
    }

    var blob = Utilities.newBlob(
      Utilities.base64Decode(body.data),
      body.mime || 'image/jpeg',
      body.filename
    );

    var file = folder.createFile(blob);

    return json({ ok: true, fileId: file.getId(), url: file.getUrl() });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Health check — lets you confirm the deployment is reachable in a browser. */
function doGet() {
  return json({ ok: true, service: 'lqk-event-photos' });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** Run once from the editor to grant OAuth consent and prove the write works. */
function selfTest() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('FOLDER_ID');
  if (!folderId) throw new Error('Set FOLDER_ID in Script Properties first.');
  if (!props.getProperty('SHARED_TOKEN')) throw new Error('Set SHARED_TOKEN first.');

  var folder = DriveApp.getFolderById(folderId);
  var blob = Utilities.newBlob('lqk selftest', 'text/plain', 'lqk-selftest.txt');
  var file = folder.createFile(blob);
  Logger.log('Wrote %s — delete it once you have seen it.', file.getUrl());
}
