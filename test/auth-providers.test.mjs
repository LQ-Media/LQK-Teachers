// Social sign-in: which providers a deploy offers, and — the part that actually
// guards the portal — when an id_token's email may be used to find an existing
// account.
//
// The second one is the whole security boundary. Sign-in never creates an
// account, so the only way in is to match an existing profile; if an email that
// a provider merely ASSERTS (rather than verifies) could do that matching, then
// anyone able to put karim@littlequrankids.sg on an account they control could
// sign in as Karim and approve their own payroll.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  enabledProviders,
  isRelayEmail,
  providerConfigured,
  providerLabel,
  trustedEmailFromClaims,
} from "../lib/auth/providers.js";

const GOOGLE = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };
const APPLE = {
  APPLE_CLIENT_ID: "sg.littlequrankids.teachers",
  APPLE_TEAM_ID: "TEAM123",
  APPLE_KEY_ID: "KEY123",
  APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----",
};
const MICROSOFT = { MICROSOFT_CLIENT_ID: "id", MICROSOFT_CLIENT_SECRET: "secret" };

describe("which providers are offered", () => {
  test("a provider with no credentials is off", () => {
    assert.equal(providerConfigured("google", {}), false);
    assert.deepEqual(enabledProviders({}), []);
  });

  test("a half-configured provider is off, not broken", () => {
    // The failure this prevents is the worst kind: a button that renders, is
    // tapped, and dies on the provider's own error page.
    assert.equal(providerConfigured("google", { GOOGLE_CLIENT_ID: "id" }), false);
    assert.equal(providerConfigured("apple", { ...APPLE, APPLE_KEY_ID: "" }), false);
  });

  test("credentials turn a provider on, one at a time", () => {
    assert.deepEqual(enabledProviders(GOOGLE), [{ id: "google", label: "Google" }]);
    assert.deepEqual(
      enabledProviders({ ...GOOGLE, ...APPLE, ...MICROSOFT }).map((p) => p.id),
      ["google", "apple", "microsoft"]
    );
  });

  test("an unknown provider id is never configured", () => {
    assert.equal(providerConfigured("facebook", { FACEBOOK_CLIENT_ID: "id" }), false);
  });

  test("labels are the names people recognise on a button", () => {
    assert.equal(providerLabel("microsoft"), "Microsoft");
    assert.equal(providerLabel("google"), "Google");
  });
});

describe("Google: an email is only trusted when Google says it verified it", () => {
  test("a verified address matches", () => {
    assert.equal(
      trustedEmailFromClaims("google", { sub: "1", email: "Aisyah@Lqk.SG", email_verified: true }, GOOGLE),
      "aisyah@lqk.sg"
    );
  });

  test("an unverified address matches nothing", () => {
    assert.equal(
      trustedEmailFromClaims("google", { sub: "1", email: "karim@lqk.sg", email_verified: false }, GOOGLE),
      ""
    );
  });

  test("a missing email_verified claim is not a pass", () => {
    assert.equal(trustedEmailFromClaims("google", { sub: "1", email: "karim@lqk.sg" }, GOOGLE), "");
  });
});

describe("Apple: relay addresses can never find an account", () => {
  test("a real verified address matches", () => {
    assert.equal(
      trustedEmailFromClaims("apple", { sub: "1", email: "aisyah@lqk.sg", email_verified: "true" }, APPLE),
      "aisyah@lqk.sg"
    );
  });

  test('"Hide My Email" gives a relay address, which is nobody\'s work email', () => {
    // Not a rejection of the person — they link Apple from their profile while
    // signed in instead, which proves the two accounts are the same human.
    assert.equal(isRelayEmail("abc123@privaterelay.appleid.com"), true);
    assert.equal(
      trustedEmailFromClaims(
        "apple",
        { sub: "1", email: "abc123@privaterelay.appleid.com", email_verified: "true" },
        APPLE
      ),
      ""
    );
  });

  test("Apple's string 'true' counts as verified, anything else does not", () => {
    assert.equal(trustedEmailFromClaims("apple", { sub: "1", email: "a@lqk.sg", email_verified: "true" }, APPLE), "a@lqk.sg");
    assert.equal(trustedEmailFromClaims("apple", { sub: "1", email: "a@lqk.sg", email_verified: "false" }, APPLE), "");
    assert.equal(trustedEmailFromClaims("apple", { sub: "1", email: "a@lqk.sg", email_verified: 1 }, APPLE), "");
  });
});

describe("Microsoft: only a pinned tenant's email is trustworthy", () => {
  test("the default multi-tenant setup trusts no email at all", () => {
    // With tenant=common the id_token can be signed by a directory the attacker
    // themselves created, so its email claim proves nothing (the "nOAuth"
    // pattern). Sign-in still works — but only after linking, which matches on
    // the subject rather than the email.
    assert.equal(
      trustedEmailFromClaims(
        "microsoft",
        { sub: "1", email: "karim@littlequrankids.sg" },
        { ...MICROSOFT, MICROSOFT_TENANT: "common" }
      ),
      ""
    );
    assert.equal(
      trustedEmailFromClaims("microsoft", { sub: "1", email: "karim@littlequrankids.sg" }, MICROSOFT),
      "",
      "an unset MICROSOFT_TENANT must behave as 'common', not as trusted"
    );
  });

  test("pinning the LQK directory makes the email usable", () => {
    const env = { ...MICROSOFT, MICROSOFT_TENANT: "6f1e0000-1111-2222-3333-444455556666" };
    assert.equal(
      trustedEmailFromClaims("microsoft", { sub: "1", email: "Karim@LittleQuranKids.sg" }, env),
      "karim@littlequrankids.sg"
    );
  });

  test("preferred_username stands in when the email claim isn't configured", () => {
    const env = { ...MICROSOFT, MICROSOFT_TENANT: "lqk.onmicrosoft.com" };
    assert.equal(
      trustedEmailFromClaims("microsoft", { sub: "1", preferred_username: "aisyah@lqk.sg" }, env),
      "aisyah@lqk.sg"
    );
  });

  test("no email anywhere in the token matches nothing", () => {
    const env = { ...MICROSOFT, MICROSOFT_TENANT: "lqk.onmicrosoft.com" };
    assert.equal(trustedEmailFromClaims("microsoft", { sub: "1" }, env), "");
  });
});

describe("malformed input never yields a match", () => {
  test("no claims, or an unknown provider", () => {
    assert.equal(trustedEmailFromClaims("google", null, GOOGLE), "");
    assert.equal(trustedEmailFromClaims("nope", { email: "a@b.c", email_verified: true }, GOOGLE), "");
  });
});
