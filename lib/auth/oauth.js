/**
 * Social sign-in: Google, Microsoft and Facebook. Password sign-in stays.
 *
 * No provider library. Google and Microsoft are OpenID Connect, and `jose`
 * (already here for the session cookie) verifies their ID tokens against
 * the published keys. Facebook is plain OAuth 2: exchange the code, then ask
 * the Graph API who this is. All three use the authorisation-code flow with
 * a random `state`; the OIDC two also use PKCE and a `nonce`.
 *
 * What an identity is allowed to do is decided in the callback route, not
 * here: this file only talks to providers. Two rules it never bends:
 *   - the provider's stable user id (`sub` / Facebook `id`) is the identity,
 *     never the email, which a person can change at the provider;
 *   - an identity links to an existing account only on an exact, lower-cased
 *     email match, and never sets a role.
 *
 * Nothing here imports next/*, so the pure parts are testable.
 */

import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

export const PROVIDERS = {
  google: {
    key: "google",
    label: "Google",
    kind: "oidc",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    scope: "openid email profile",
    env: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
  },
  microsoft: {
    key: "microsoft",
    label: "Microsoft",
    kind: "oidc",
    // {tenant} is MICROSOFT_TENANT: "common" (any Microsoft account), or the
    // LQK tenant id to admit work accounts only.
    authorize: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
    jwks: "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys",
    // With the "common" endpoint the issuer carries the user's own tenant id,
    // so it is checked by shape rather than by string equality.
    issuerPattern: /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/,
    scope: "openid email profile",
    env: { id: "MICROSOFT_CLIENT_ID", secret: "MICROSOFT_CLIENT_SECRET" },
  },
  facebook: {
    key: "facebook",
    label: "Facebook",
    kind: "oauth2",
    authorize: "https://www.facebook.com/v19.0/dialog/oauth",
    token: "https://graph.facebook.com/v19.0/oauth/access_token",
    profile: "https://graph.facebook.com/v19.0/me?fields=id,name,email",
    scope: "email public_profile",
    env: { id: "FACEBOOK_APP_ID", secret: "FACEBOOK_APP_SECRET" },
  },
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS);

export function isProvider(key) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, String(key));
}

function credentials(provider, env = process.env) {
  const p = PROVIDERS[provider];
  const id = String(env[p.env.id] || "").trim();
  const secret = String(env[p.env.secret] || "").trim();
  return id && secret ? { id, secret } : null;
}

/** Providers with a client id AND secret set — what the login page shows. */
export function configuredProviders(env = process.env) {
  return PROVIDER_KEYS.filter((k) => credentials(k, env)).map((k) => ({ key: k, label: PROVIDERS[k].label }));
}

export function providerConfigured(provider, env = process.env) {
  return isProvider(provider) && !!credentials(provider, env);
}

function tenant(env = process.env) {
  const t = String(env.MICROSOFT_TENANT || "").trim();
  return /^[A-Za-z0-9.-]+$/.test(t) ? t : "common";
}

function endpoint(provider, which, env = process.env) {
  return PROVIDERS[provider][which].replace("{tenant}", tenant(env));
}

// ---- PKCE / state --------------------------------------------------------

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/** S256 code challenge for a verifier, per RFC 7636. */
export function pkceChallenge(verifier) {
  return createHash("sha256").update(String(verifier)).digest("base64url");
}

/**
 * Where the provider sends the person back. LQK_APP_ORIGIN wins; otherwise
 * the forwarded host, because behind Railway's proxy the request reports an
 * internal host and the provider would refuse a redirect it has never seen.
 */
export function appOrigin(headers, env = process.env) {
  const fixed = String(env.LQK_APP_ORIGIN || "").trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const proto = headers.get("x-forwarded-proto") || "https";
  const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

export function redirectUri(provider, origin) {
  return `${origin}/api/auth/${provider}/callback`;
}

/**
 * Build the provider's authorisation URL plus the secrets to keep in a
 * short-lived cookie until the callback (state, nonce, PKCE verifier).
 */
export function beginAuth(provider, { origin, env = process.env } = {}) {
  const p = PROVIDERS[provider];
  const cred = credentials(provider, env);
  if (!cred) throw new Error(`${p.label} sign-in is not configured.`);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  const url = new URL(endpoint(provider, "authorize", env));
  url.searchParams.set("client_id", cred.id);
  url.searchParams.set("redirect_uri", redirectUri(provider, origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", p.scope);
  url.searchParams.set("state", state);
  if (p.kind === "oidc") {
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", pkceChallenge(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    // Always ask which account: staff often have a personal and a work one.
    url.searchParams.set("prompt", "select_account");
  }
  return { url: url.toString(), state, nonce, verifier };
}

// ---- token exchange and identity -----------------------------------------

async function postForm(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  if (!res.ok) throw new Error(body?.error_description || body?.error?.message || body?.error || `token endpoint answered ${res.status}`);
  return body;
}

const jwksCache = new Map();
function jwksFor(provider, env) {
  const url = endpoint(provider, "jwks", env);
  if (!jwksCache.has(url)) jwksCache.set(url, createRemoteJWKSet(new URL(url)));
  return jwksCache.get(url);
}

/**
 * Turn the callback's `code` into who this is:
 *   { subject, email, emailVerified, name }
 * Throws with a message safe to show on the login page.
 */
export async function completeAuth(provider, { code, origin, verifier, nonce, env = process.env }) {
  const p = PROVIDERS[provider];
  const cred = credentials(provider, env);
  if (!cred) throw new Error(`${p.label} sign-in is not configured.`);
  const params = {
    client_id: cred.id,
    client_secret: cred.secret,
    code,
    redirect_uri: redirectUri(provider, origin),
    grant_type: "authorization_code",
  };
  if (p.kind === "oidc") params.code_verifier = verifier;

  const tokens = await postForm(endpoint(provider, "token", env), params);

  if (p.kind === "oidc") {
    if (!tokens.id_token) throw new Error(`${p.label} returned no identity token.`);
    const { payload } = await jwtVerify(tokens.id_token, jwksFor(provider, env), {
      audience: cred.id,
      ...(p.issuer ? { issuer: p.issuer } : {}),
      clockTolerance: 60,
    });
    if (p.issuerPattern && !p.issuerPattern.test(String(payload.iss || ""))) throw new Error(`${p.label} issuer was not recognised.`);
    if (!payload.nonce || payload.nonce !== nonce) throw new Error("The sign-in did not match this browser. Please try again.");
    return identityFromClaims(provider, payload);
  }

  // Facebook: the access token buys a profile lookup.
  if (!tokens.access_token) throw new Error("Facebook returned no access token.");
  const res = await fetch(`${p.profile}&access_token=${encodeURIComponent(tokens.access_token)}`, {
    signal: AbortSignal.timeout(12000),
  });
  const me = await res.json().catch(() => ({}));
  if (!res.ok || !me?.id) throw new Error("Facebook did not say who you are.");
  return identityFromClaims(provider, { sub: me.id, email: me.email, email_verified: !!me.email, name: me.name });
}

/** Normalise the claims we keep. Email is lower-cased; missing is null. */
export function identityFromClaims(provider, claims) {
  const subject = String(claims?.sub || "").trim();
  if (!subject) throw new Error("The provider returned no user id.");
  const emailRaw = String(claims?.email || claims?.preferred_username || "").trim().toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
  // Microsoft does not always send email_verified; a work account's email is
  // taken as verified, and Google's flag is honoured when present.
  const emailVerified = claims?.email_verified === undefined ? !!email : !!claims.email_verified;
  return {
    provider,
    subject,
    email,
    emailVerified,
    name: String(claims?.name || "").trim().slice(0, 120),
  };
}
