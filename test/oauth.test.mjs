// Social sign-in: the pure parts of lib/auth/oauth.js. The provider round
// trip itself needs live credentials and is exercised in the browser.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  PROVIDER_KEYS,
  isProvider,
  configuredProviders,
  providerConfigured,
  pkceChallenge,
  beginAuth,
  appOrigin,
  redirectUri,
  identityFromClaims,
} from "../lib/auth/oauth.js";

const ENV = {
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret",
  MICROSOFT_CLIENT_ID: "m-id",
  MICROSOFT_CLIENT_SECRET: "m-secret",
  MICROSOFT_TENANT: "common",
};

describe("which providers are offered", () => {
  test("only those with BOTH id and secret", () => {
    assert.deepEqual(
      configuredProviders(ENV).map((p) => p.key),
      ["google", "microsoft"]
    );
    assert.equal(providerConfigured("facebook", ENV), false);
    assert.equal(providerConfigured("facebook", { ...ENV, FACEBOOK_APP_ID: "f" }), false, "id alone is not enough");
    assert.equal(providerConfigured("facebook", { ...ENV, FACEBOOK_APP_ID: "f", FACEBOOK_APP_SECRET: "s" }), true);
  });
  test("unknown providers are refused, prototype keys included", () => {
    assert.deepEqual(PROVIDER_KEYS, ["google", "microsoft", "facebook"]);
    assert.equal(isProvider("apple"), false);
    assert.equal(isProvider("constructor"), false);
  });
});

describe("the authorisation request", () => {
  test("PKCE challenge is base64url(sha256(verifier))", () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    assert.equal(pkceChallenge(v), createHash("sha256").update(v).digest("base64url"));
  });

  test("Google: code flow with PKCE, nonce, state, and our redirect", () => {
    const origin = "https://teachers.littlequrankids.sg";
    const { url, state, nonce, verifier } = beginAuth("google", { origin, env: ENV });
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(u.searchParams.get("client_id"), "g-id");
    assert.equal(u.searchParams.get("redirect_uri"), `${origin}/api/auth/google/callback`);
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.equal(u.searchParams.get("state"), state);
    assert.equal(u.searchParams.get("nonce"), nonce);
    assert.equal(u.searchParams.get("code_challenge"), pkceChallenge(verifier));
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.ok(u.searchParams.get("scope").includes("email"));
    assert.ok(state.length >= 32 && nonce.length >= 32 && verifier.length >= 43);
  });

  test("Microsoft uses the tenant from the environment", () => {
    const { url } = beginAuth("microsoft", { origin: "https://x.test", env: { ...ENV, MICROSOFT_TENANT: "abc-tenant" } });
    assert.ok(url.startsWith("https://login.microsoftonline.com/abc-tenant/oauth2/v2.0/authorize?"));
    const bad = beginAuth("microsoft", { origin: "https://x.test", env: { ...ENV, MICROSOFT_TENANT: "../evil" } });
    assert.ok(bad.url.startsWith("https://login.microsoftonline.com/common/"), "a malformed tenant falls back to common");
  });

  test("an unconfigured provider cannot start", () => {
    assert.throws(() => beginAuth("facebook", { origin: "https://x.test", env: ENV }), /not configured/);
  });

  test("two starts never share a state", () => {
    const a = beginAuth("google", { origin: "https://x.test", env: ENV });
    const b = beginAuth("google", { origin: "https://x.test", env: ENV });
    assert.notEqual(a.state, b.state);
  });
});

describe("the origin the provider sends people back to", () => {
  const headers = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });
  test("LQK_APP_ORIGIN wins and loses its trailing slash", () => {
    assert.equal(appOrigin(headers({ host: "internal:8080" }), { LQK_APP_ORIGIN: "https://teachers.littlequrankids.sg/" }), "https://teachers.littlequrankids.sg");
  });
  test("otherwise the forwarded host and scheme", () => {
    assert.equal(
      appOrigin(headers({ "x-forwarded-proto": "https", "x-forwarded-host": "teachers.littlequrankids.sg", host: "internal:8080" }), {}),
      "https://teachers.littlequrankids.sg"
    );
    assert.equal(redirectUri("facebook", "https://a.test"), "https://a.test/api/auth/facebook/callback");
  });
});

describe("what we keep from the provider", () => {
  test("the subject is the identity; the email is lower-cased or null", () => {
    const id = identityFromClaims("google", { sub: "123", email: "Siti@LQK.sg", email_verified: true, name: "Siti" });
    assert.deepEqual(id, { provider: "google", subject: "123", email: "siti@lqk.sg", emailVerified: true, name: "Siti" });
    assert.equal(identityFromClaims("facebook", { sub: "9", email: "not-an-email" }).email, null);
    assert.throws(() => identityFromClaims("google", { email: "a@b.c" }), /no user id/);
  });
  test("Microsoft without email_verified: a present email counts as verified, preferred_username is a fallback", () => {
    const id = identityFromClaims("microsoft", { sub: "m1", preferred_username: "Ali@lqk.sg" });
    assert.equal(id.email, "ali@lqk.sg");
    assert.equal(id.emailVerified, true);
    assert.equal(identityFromClaims("google", { sub: "g1", email: "x@y.z", email_verified: false }).emailVerified, false);
  });
});
