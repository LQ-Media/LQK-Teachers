import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from "jose";
import { baseUrl } from "@/lib/mail";
import { PROVIDERS, providerConfigured } from "./providers";

/* The OpenID Connect authorization-code flow, by hand. Read the header comment
   in ./providers.js first — it explains why this isn't NextAuth.

   Two round trips:
     1. start()    — stash a nonce (and a PKCE verifier) in a signed, short-lived
                     cookie, then send the browser to the provider.
     2. complete() — check what came back against that cookie, swap the code for
                     an id_token, and verify the id_token's signature against the
                     provider's published keys.

   Everything the callback trusts about who signed in comes out of step 2's
   verified id_token. The query string the browser arrives with is only ever a
   lookup key — never a claim about identity. */

const STATE_COOKIE = "lqk_oauth";
// A consent screen that sits open for longer than this was abandoned. Short
// enough to keep a stolen state cookie useless, long enough for someone who has
// to fetch their phone for a 2FA code.
const STATE_TTL_SECONDS = 15 * 60;

function stateKey() {
  const secret = process.env.SESSION_SECRET;
  if (secret) return new TextEncoder().encode(secret);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set — refusing to sign OAuth state in production.");
  }
  return new TextEncoder().encode("dev-only-insecure-secret-change-me");
}

export function redirectUriFor(providerId) {
  return `${baseUrl()}/api/auth/${providerId}/callback`;
}

/* JWKS sets are cached per provider for the life of the process. jose refreshes
   them on its own when it meets an unknown key id, so a provider rotating its
   signing key does not need a redeploy — but re-creating the set on every
   sign-in would refetch the keys every time. */
const jwksCache = new Map();
function jwksFor(provider) {
  const url = provider.jwksUrl(process.env);
  if (!jwksCache.has(url)) jwksCache.set(url, createRemoteJWKSet(new URL(url)));
  return jwksCache.get(url);
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

/**
 * Apple is the one provider with no client secret to paste: you sign one
 * yourself, as a short-lived ES256 JWT, using the .p8 key downloaded from the
 * developer portal. Apple allows up to six months; five minutes is plenty,
 * since it is minted per request and used once.
 */
async function appleClientSecret() {
  const teamId = String(process.env.APPLE_TEAM_ID || "").trim();
  const keyId = String(process.env.APPLE_KEY_ID || "").trim();
  const clientId = String(process.env.APPLE_CLIENT_ID || "").trim();
  // A .p8 is multi-line PEM. Hosting dashboards mangle real newlines, so the
  // documented way to set it is with literal "\n" — unescaped here.
  const pem = String(process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (!teamId || !keyId || !clientId || !pem) {
    throw new Error("Apple sign-in is not fully configured.");
  }
  const key = await importPKCS8(pem, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("https://appleid.apple.com")
    .setSubject(clientId)
    .sign(key);
}

async function clientSecretFor(provider) {
  if (provider.id === "apple") return appleClientSecret();
  const key = provider.id === "google" ? "GOOGLE_CLIENT_SECRET" : "MICROSOFT_CLIENT_SECRET";
  return String(process.env[key] || "").trim();
}

/**
 * Step 1. Returns the URL to send the browser to, having written the matching
 * state cookie.
 *
 * `mode` is "signin" (match an existing account) or "link" (attach to the
 * profile already signed in). It rides in the signed cookie rather than the URL
 * so the callback cannot be talked into linking by an attacker-crafted link.
 */
export async function startAuth(providerId, { mode = "signin", profileId = null } = {}) {
  const provider = PROVIDERS[providerId];
  if (!provider || !providerConfigured(providerId)) {
    throw new Error(`${providerId} sign-in is not configured.`);
  }

  const state = base64url(randomBytes(32));
  const nonce = base64url(randomBytes(32));
  const verifier = provider.usePkce ? base64url(randomBytes(32)) : null;

  const token = await new SignJWT({
    p: providerId,
    s: state,
    n: nonce,
    v: verifier,
    m: mode,
    // Pinned at start: a "link" callback attaches the identity to THIS profile,
    // not to whoever the session happens to be when the callback lands.
    u: profileId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .setJti(randomUUID())
    .sign(stateKey());

  const jar = await cookies();
  jar.set(STATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Apple POSTs the result back from appleid.apple.com, which is a cross-site
    // request — a Lax cookie is not sent on it and the flow would die with
    // "state mismatch". None requires Secure, so Apple sign-in only works over
    // HTTPS; that is Apple's own requirement for a return URL anyway.
    sameSite: provider.responseMode === "form_post" ? "none" : "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });

  const params = new URLSearchParams({
    client_id: provider.clientId(process.env),
    redirect_uri: redirectUriFor(providerId),
    response_type: "code",
    scope: provider.scope,
    state,
    nonce,
  });
  if (provider.responseMode) params.set("response_mode", provider.responseMode);
  if (verifier) {
    params.set("code_challenge", base64url(createHash("sha256").update(verifier).digest()));
    params.set("code_challenge_method", "S256");
  }
  // Google only returns a refresh token with prompt=consent, and this portal
  // wants none — it reads the identity once, at sign-in, and never calls a
  // Google API afterwards. select_account is asked for so a shared staffroom
  // browser doesn't silently sign in as whoever used it last.
  if (providerId === "google") params.set("prompt", "select_account");

  return `${provider.authorizeUrl(process.env)}?${params.toString()}`;
}

export async function clearAuthState() {
  const jar = await cookies();
  jar.delete(STATE_COOKIE);
}

async function readState(providerId, state) {
  const jar = await cookies();
  const token = jar.get(STATE_COOKIE)?.value;
  if (!token) return null;
  let payload;
  try {
    ({ payload } = await jwtVerify(token, stateKey(), { algorithms: ["HS256"] }));
  } catch {
    return null;
  }
  if (payload.p !== providerId) return null;
  // The whole point of `state`: it proves the browser that comes back is the
  // one that left, which is what stops a login-CSRF (an attacker walking a
  // victim's browser through a flow for the attacker's own account).
  if (!state || payload.s !== state) return null;
  return payload;
}

async function exchangeCode(provider, { code, verifier }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUriFor(provider.id),
    client_id: provider.clientId(process.env),
    client_secret: await clientSecretFor(provider),
  });
  if (verifier) body.set("code_verifier", verifier);

  const res = await fetch(provider.tokenUrl(process.env), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id_token) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`;
    throw new Error(`Token exchange failed: ${detail}`);
  }
  return json.id_token;
}

async function verifyIdToken(provider, idToken, nonce) {
  const issuers = provider.issuers(process.env);
  const { payload } = await jwtVerify(idToken, jwksFor(provider), {
    audience: provider.clientId(process.env),
    ...(issuers ? { issuer: issuers } : {}),
  });

  // Multi-tenant Microsoft: the issuer carries the signer's own tenant id, so
  // it can't be listed up front. Shape is still checked — an id_token from
  // anywhere but Entra is rejected — but note that the email on one of these is
  // NOT trusted for matching an account (see providers.js).
  if (!issuers && !/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/i.test(String(payload.iss || ""))) {
    throw new Error("Unexpected token issuer.");
  }

  // Binds the id_token to THIS browser's flow. Without it a token harvested
  // elsewhere could be replayed into someone else's callback.
  if (payload.nonce !== nonce) throw new Error("Nonce mismatch.");
  if (!payload.sub) throw new Error("Token carried no subject.");
  return payload;
}

/**
 * Step 2. Verifies what came back and returns
 * `{ mode, profileId, claims }` — or throws, which the callback turns into a
 * friendly message on the login page.
 */
export async function completeAuth(providerId, { code, state }) {
  const provider = PROVIDERS[providerId];
  if (!provider || !providerConfigured(providerId)) {
    throw new Error(`${providerId} sign-in is not configured.`);
  }
  const saved = await readState(providerId, state);
  if (!saved) throw new Error("That sign-in link expired — please try again.");
  if (!code) throw new Error("No authorization code was returned.");

  const idToken = await exchangeCode(provider, { code, verifier: saved.v || null });
  const claims = await verifyIdToken(provider, idToken, saved.n);

  return { mode: saved.m === "link" ? "link" : "signin", profileId: saved.u || null, claims };
}
