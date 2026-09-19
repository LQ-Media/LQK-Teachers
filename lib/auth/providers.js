/* Social sign-in providers.

   Deliberately hand-rolled OpenID Connect rather than NextAuth/Auth.js: the
   portal already has its own session (a signed JWT cookie carrying role,
   branch and the must-change-password gate — see lib/session.js), and every
   page and server action reads it through lib/dal.js. Bolting on a second
   session system would mean two sources of truth for "who is this and what may
   they do", on a portal that pays people. What is actually needed here is the
   authorization-code flow, and `jose` (already a dependency, used for the
   session cookie) does the hard part — verifying the provider's id_token.

   Nothing in this file touches the network, the database or `server-only`, so
   it can be unit-tested directly. The flow itself lives in lib/auth/oauth.js.

   A provider is OFF unless its credentials are set. That is what lets Google
   ship first and Apple follow when the developer account exists — no code
   change, no flag, just environment variables. The login page renders the
   buttons from enabledProviders(), so an unconfigured provider is not offered
   rather than offered and then failing at the consent screen. */

/* Apple hands back a relay address (…@privaterelay.appleid.com) whenever the
   person chose "Hide My Email". It is a real, deliverable address, but it is
   NOT the work email on their profile, so it can never be used to find their
   account. Those teachers link Apple from Profile → Connected accounts while
   already signed in, which is what the linking flow is for. */
const APPLE_RELAY_DOMAIN = "@privaterelay.appleid.com";

/* Microsoft tenants that mean "anyone, from any directory". With one of these
   the id_token can come from a directory the attacker themselves controls, in
   which case the email claim on it proves nothing about who they are (this is
   the "nOAuth" account-takeover pattern). Pinning MICROSOFT_TENANT to the LQK
   directory is what makes the email trustworthy enough to match an existing
   profile by. */
const MULTI_TENANT = new Set(["common", "organizations", "consumers"]);

function isTrue(value) {
  // Apple sends email_verified as the STRING "true" on some responses and a
  // boolean on others. Both mean verified; anything else does not.
  return value === true || value === "true";
}

export const PROVIDERS = {
  google: {
    id: "google",
    label: "Google",
    // Covers both personal Gmail and Google Workspace — same endpoint.
    authorizeUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: () => "https://oauth2.googleapis.com/token",
    jwksUrl: () => "https://www.googleapis.com/oauth2/v3/certs",
    issuers: () => ["https://accounts.google.com", "accounts.google.com"],
    scope: "openid email profile",
    usePkce: true,
    responseMode: null,
    envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    emailFromClaims: (claims) => claims.email,
    // Google states plainly whether it has verified the address, so this is the
    // whole test.
    emailIsTrusted: (claims) => !!claims.email && isTrue(claims.email_verified),
    nameFromClaims: (claims) => claims.name || "",
  },

  microsoft: {
    id: "microsoft",
    label: "Microsoft",
    authorizeUrl: (env) =>
      `https://login.microsoftonline.com/${msTenant(env)}/oauth2/v2.0/authorize`,
    tokenUrl: (env) => `https://login.microsoftonline.com/${msTenant(env)}/oauth2/v2.0/token`,
    jwksUrl: (env) => `https://login.microsoftonline.com/${msTenant(env)}/discovery/v2.0/keys`,
    // A multi-tenant issuer embeds the signer's own tenant id, so the exact
    // string isn't known ahead of time — verified by shape in oauth.js instead.
    issuers: (env) =>
      MULTI_TENANT.has(msTenant(env))
        ? null
        : [`https://login.microsoftonline.com/${msTenant(env)}/v2.0`],
    scope: "openid email profile",
    usePkce: true,
    responseMode: null,
    envKeys: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    clientId: (env) => env.MICROSOFT_CLIENT_ID,
    // `email` is an optional claim that may not be configured on the app
    // registration; preferred_username is the reliable fallback for a
    // work/school account.
    emailFromClaims: (claims) => claims.email || claims.preferred_username || "",
    emailIsTrusted: (claims, env) => {
      if (!PROVIDERS.microsoft.emailFromClaims(claims)) return false;
      // See MULTI_TENANT above: outside a pinned directory the email claim is
      // attacker-controllable, so it may not be used to find an account. Sign-in
      // still works for anyone who linked Microsoft from their profile — that
      // path matches on the subject, which is not forgeable.
      return !MULTI_TENANT.has(msTenant(env));
    },
    nameFromClaims: (claims) => claims.name || "",
  },

  apple: {
    id: "apple",
    label: "Apple",
    authorizeUrl: () => "https://appleid.apple.com/auth/authorize",
    tokenUrl: () => "https://appleid.apple.com/auth/token",
    jwksUrl: () => "https://appleid.apple.com/auth/keys",
    issuers: () => ["https://appleid.apple.com"],
    scope: "name email",
    // Apple's web flow is documented around state + nonce, and its token
    // endpoint has never required a code_verifier. Sending one buys nothing and
    // risks a rejection, so this provider relies on the signed state cookie and
    // the nonce baked into the id_token.
    usePkce: false,
    // Requesting any scope makes Apple POST the result back as a form instead
    // of redirecting with a query string — hence the POST handler on the
    // callback route. A form POST from appleid.apple.com is cross-site, so the
    // state cookie has to be SameSite=None to survive it (see lib/auth/oauth.js).
    responseMode: "form_post",
    envKeys: ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
    clientId: (env) => env.APPLE_CLIENT_ID,
    emailFromClaims: (claims) => claims.email || "",
    emailIsTrusted: (claims) =>
      !!claims.email &&
      isTrue(claims.email_verified) &&
      !String(claims.email).toLowerCase().endsWith(APPLE_RELAY_DOMAIN),
    // Apple sends the name once, at first consent, in the form body — never in
    // the id_token. The portal already has the teacher's name on their profile,
    // so nothing depends on it.
    nameFromClaims: () => "",
  },
};

function msTenant(env) {
  return String(env.MICROSOFT_TENANT || "common").trim() || "common";
}

/** True when every credential this provider needs is present. */
export function providerConfigured(id, env = process.env) {
  const provider = PROVIDERS[id];
  if (!provider) return false;
  return provider.envKeys.every((key) => !!String(env[key] || "").trim());
}

/** The providers a deploy can actually offer, in the order they're shown. */
export function enabledProviders(env = process.env) {
  return ["google", "apple", "microsoft"]
    .filter((id) => providerConfigured(id, env))
    .map((id) => ({ id, label: PROVIDERS[id].label }));
}

export function isRelayEmail(email) {
  return String(email || "").toLowerCase().endsWith(APPLE_RELAY_DOMAIN);
}

/**
 * The email an id_token may be matched against an existing profile with, or ""
 * when there isn't one that can be trusted.
 *
 * Everything about linking a social account to a portal account hangs off this.
 * An unverified — or merely asserted — email must never find an account, or
 * anyone able to put "karim@littlequrankids.sg" on a provider account they own
 * could sign in as Karim.
 */
export function trustedEmailFromClaims(id, claims, env = process.env) {
  const provider = PROVIDERS[id];
  if (!provider || !claims) return "";
  if (!provider.emailIsTrusted(claims, env)) return "";
  return String(provider.emailFromClaims(claims) || "").trim().toLowerCase();
}

export function providerLabel(id) {
  return PROVIDERS[id]?.label || id;
}
