// The sign-up reminder email.
//
// Kept apart from the action that sends it so the wording can be read, changed
// and tested without a database or a network. What goes in this email is a
// CREDENTIAL, so it is worth being able to see the whole thing on one screen.
//
// Karim chose this shape on 17 Sep over building an activation-link flow: it
// works today, and it is the only way somebody with an admin-created account
// can get in, because the portal has no forgotten-password page yet.
//
// Two rules the copy follows and should keep following:
//
//   1. It says the password is temporary and will be replaced on first sign-in.
//      A credential in an inbox is a risk; one that stops working the moment it
//      is used is a much smaller one, and saying so is what makes somebody use
//      it promptly rather than filing the email.
//   2. It never says why they are being chased. "You haven't signed up yet" in
//      an email a manager triggered reads as a telling-off; "your account is
//      ready" reads as help. The screen is where the chasing is visible.

const SIGN_IN_URL = process.env.LQK_PORTAL_URL || "https://teachers.littlequrankids.sg";

/** The first name, for a greeting. Falls back to the whole name, then nothing. */
export function firstName(fullName) {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  // The imported names are mostly "NURUL HIDAYAH BINTE MOHD ARIS" in caps, so
  // the first word alone would shout. Title-cased, and only the first word,
  // because "Binte Mohd Aris" is not a surname to greet somebody by.
  const one = parts[0];
  return one.charAt(0).toUpperCase() + one.slice(1).toLowerCase();
}

export function reminderSubject() {
  return "Your Little Quran Kids portal account";
}

export function reminderText({ fullName, email, tempPassword, url = SIGN_IN_URL }) {
  const hi = firstName(fullName);
  return [
    hi ? `Assalamualaikum ${hi},` : "Assalamualaikum,",
    "",
    "Your account on the Little Quran Kids Teachers Portal is ready, but it hasn’t been used yet.",
    "",
    `  Sign in at   ${url}`,
    `  Email        ${email}`,
    `  Password     ${tempPassword}`,
    "",
    "That password is temporary — you’ll be asked to choose your own as soon as you sign in.",
    "",
    "The portal is where you’ll see your roster and clock in for your shifts, so it’s worth setting up before your next class.",
    "",
    "If you weren’t expecting this, or anything looks wrong, reply to this email and we’ll sort it out.",
    "",
    "— Little Quran Kids",
  ].join("\n");
}

export function reminderHtml({ fullName, email, tempPassword, url = SIGN_IN_URL }) {
  const hi = firstName(fullName);
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // Inline styles and a table, because that is what email clients render. No
  // web fonts, no external images: Outlook and Gmail both strip or block them,
  // and an email whose only content is a blocked image is an empty email.
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F7F3EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#4A3340;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E6DED6;border-radius:12px;">
    <tr><td style="padding:24px 24px 8px;">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
        ${hi ? `Assalamualaikum ${esc(hi)},` : "Assalamualaikum,"}
      </p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
        Your account on the <strong>Little Quran Kids Teachers Portal</strong> is ready, but it hasn’t been used yet.
      </p>
    </td></tr>
    <tr><td style="padding:0 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F7F3EE;border:1px solid #E6DED6;border-radius:8px;">
        <tr><td style="padding:14px 16px;font-size:14px;line-height:1.7;">
          <div><span style="color:#8A7A82;display:inline-block;width:88px;">Sign in at</span>
            <a href="${esc(url)}" style="color:#7A5C6B;font-weight:600;text-decoration:underline;">${esc(url)}</a></div>
          <div><span style="color:#8A7A82;display:inline-block;width:88px;">Email</span>
            <strong>${esc(email)}</strong></div>
          <div><span style="color:#8A7A82;display:inline-block;width:88px;">Password</span>
            <strong style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;">${esc(tempPassword)}</strong></div>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 24px 24px;">
      <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#6B5A63;">
        That password is <strong>temporary</strong> — you’ll be asked to choose your own as soon as you sign in.
      </p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#6B5A63;">
        The portal is where you’ll see your roster and clock in for your shifts, so it’s worth setting up before your next class.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.55;color:#8A7A82;">
        If you weren’t expecting this, or anything looks wrong, just reply to this email.
      </p>
      <p style="margin:18px 0 0;font-size:13px;color:#8A7A82;">— Little Quran Kids</p>
    </td></tr>
  </table>
</body></html>`;
}
