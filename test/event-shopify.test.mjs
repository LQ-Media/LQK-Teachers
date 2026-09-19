// The store-integration helpers (lib/events/shopify-core.js).
//
// Two boundaries matter: the checkout URL a guest is handed (it must never
// leak the full invite token — the token IS the credential and cart attributes
// end up on order emails), and the webhook verification (a forged POST must
// never mark a hamper paid).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  parseProductRef,
  pickVariant,
  chooseVariant,
  formatPrice,
  contributionCheckoutUrl,
  verifyShopifyHmac,
  orderInviteRef,
  orderAttendees,
  storeOrderRecord,
} from "../lib/events/shopify-core.js";

describe("parseProductRef", () => {
  test("full product URLs, with and without a pinned variant", () => {
    assert.deepEqual(
      parseProductRef("https://lqkstore.littlequrankids.sg/products/lqk-maulid-2026"),
      { handle: "lqk-maulid-2026", variantId: null }
    );
    assert.deepEqual(
      parseProductRef("https://lqkstore.littlequrankids.sg/products/lqk-sabeel-meals-sg?variant=49710350565695"),
      { handle: "lqk-sabeel-meals-sg", variantId: "49710350565695" }
    );
  });

  test("bare handles and paths work; junk does not", () => {
    assert.deepEqual(parseProductRef("kids-face-sejadah"), {
      handle: "kids-face-sejadah",
      variantId: null,
    });
    assert.deepEqual(parseProductRef("/products/lqk-uniform-2025"), {
      handle: "lqk-uniform-2025",
      variantId: null,
    });
    assert.equal(parseProductRef(""), null);
    assert.equal(parseProductRef("https://lqkstore.littlequrankids.sg/pages/about"), null);
  });
});

describe("pickVariant", () => {
  const product = {
    variants: [
      { id: 1, available: false },
      { id: 2, available: true },
      { id: 3, available: true },
    ],
  };
  test("honours the pinned variant, else first available, else first", () => {
    assert.equal(pickVariant(product, "3").id, 3);
    assert.equal(pickVariant(product, "999").id, 2);
    assert.equal(pickVariant(product, null).id, 2);
    assert.equal(pickVariant({ variants: [{ id: 9, available: false }] }, null).id, 9);
    assert.equal(pickVariant({ variants: [] }, null), null);
  });
});

/* LQK's contribution products are TIERED, and the family picks their tier on
   the invitation — so a variant id now arrives from the client. These are the
   two rules that keep that safe: the store decides what exists, and a variant
   the admin pinned outranks anything the guest sends. */
describe("chooseVariant", () => {
  const tiers = {
    variants: [
      { id: 30, available: true },   // $30, the default
      { id: 50, available: true },
      { id: 100, available: true },
    ],
  };

  test("an unpinned product follows the guest's choice", () => {
    assert.equal(chooseVariant(tiers, null, "100").id, 100);
    assert.equal(chooseVariant(tiers, null, "50").id, 50);
  });

  test("no choice, or a made-up one, falls back to the default", () => {
    assert.equal(chooseVariant(tiers, null, null).id, 30);
    assert.equal(chooseVariant(tiers, null, "999999").id, 30);
    assert.equal(chooseVariant(tiers, null, "'; DROP TABLE").id, 30);
  });

  test("a pinned variant is the event's decision — a guest cannot move off it", () => {
    assert.equal(chooseVariant(tiers, "50", "100").id, 50);
    assert.equal(chooseVariant(tiers, "50", null).id, 50);
  });

  test("a pin naming a variant the store no longer has degrades to the default", () => {
    // Otherwise deleting a tier in Shopify would freeze every guest on a dead
    // checkout link with no way to contribute at all.
    assert.equal(chooseVariant(tiers, "777", "100").id, 100);
  });

  test("a product with no variants has nothing to choose", () => {
    assert.equal(chooseVariant({ variants: [] }, null, "30"), null);
  });
});

test("formatPrice reads Shopify cents", () => {
  assert.equal(formatPrice(2500), "SGD 25.00");
  assert.equal(formatPrice("1000"), "SGD 10.00");
  assert.equal(formatPrice(undefined), "");
});

describe("contributionCheckoutUrl", () => {
  const url = contributionCheckoutUrl({
    variantId: "49710350532927",
    token: "abcdef0123456789abcdef0123456789",
    eventId: "evt-1",
  });

  test("goes to the store cart permalink with both attributes", () => {
    assert.match(url, /^https:\/\/lqkstore\.littlequrankids\.sg\/cart\/49710350532927:1\?/);
    assert.match(url, /attributes%5Binvite%5D=abcdef01/);
    assert.match(url, /attributes%5Bevent%5D=evt-1/);
  });

  test("never carries more than 8 chars of the token", () => {
    assert.ok(!url.includes("abcdef0123456789"), "full token leaked into the checkout URL");
  });
});

describe("verifyShopifyHmac", () => {
  const secret = "shhh";
  const body = '{"id":123}';
  const good = createHmac("sha256", secret).update(body).digest("base64");

  test("accepts the genuine signature and nothing else", () => {
    assert.ok(verifyShopifyHmac(body, good, secret));
    assert.ok(!verifyShopifyHmac(body, good, "wrong-secret"));
    assert.ok(!verifyShopifyHmac(`${body} `, good, secret));
    assert.ok(!verifyShopifyHmac(body, "AAAA", secret));
    assert.ok(!verifyShopifyHmac(body, "", secret));
    assert.ok(!verifyShopifyHmac(body, good, ""));
  });
});

describe("orderInviteRef", () => {
  test("reads the two attributes off note_attributes", () => {
    assert.deepEqual(
      orderInviteRef({
        note_attributes: [
          { name: "invite", value: "ABCDEF01" },
          { name: "event", value: "evt-1" },
        ],
      }),
      { tokenPrefix: "abcdef01", eventId: "evt-1" }
    );
  });

  test("rejects orders without a plausible prefix", () => {
    assert.equal(orderInviteRef({ note_attributes: [] }), null);
    assert.equal(
      orderInviteRef({ note_attributes: [{ name: "invite", value: "xyz" }, { name: "event", value: "e" }] }),
      null
    );
    assert.equal(orderInviteRef({}), null);
  });
});

/* The attendee form on ticketed product pages
   (docs/shopify/lqk-attendee-fields.liquid) submits per-place details as line
   item properties. What matters at this boundary: property ORDER is not
   trusted (the index in the name is), other apps' properties are ignored, and
   a blank group is dropped rather than shown as an empty seat. */
describe("orderAttendees", () => {
  const prop = (name, value) => ({ name, value });

  test("reads main + numbered groups off line item properties, by index not order", () => {
    const order = {
      line_items: [
        {
          properties: [
            prop("Attendee 2 Name", "Yusuf Rahman"),
            prop("Main Attendee Name", "Aisha Rahman"),
            prop("Main Attendee Email", "aisha@example.com"),
            prop("Attendee 2 Phone", "+6598765432"),
            prop("Main Attendee Phone", "+6591234567"),
            prop("Attendee 2 Email", "yusuf@example.com"),
          ],
        },
      ],
    };
    assert.deepEqual(orderAttendees(order), [
      { name: "Aisha Rahman", email: "aisha@example.com", phone: "+6591234567", main: true },
      { name: "Yusuf Rahman", email: "yusuf@example.com", phone: "+6598765432", main: false },
    ]);
  });

  test("ignores other apps' properties and drops all-blank groups", () => {
    const order = {
      line_items: [
        {
          properties: [
            prop("_gift_wrap", "yes"),
            prop("Main Attendee Name", "Aisha"),
            prop("Main Attendee Email", ""),
            prop("Main Attendee Phone", ""),
            prop("Attendee 2 Name", "  "),
            prop("Attendee 2 Email", ""),
            prop("Attendee 2 Phone", ""),
            prop("Attendee 999 Name", "index out of range"),
          ],
        },
      ],
    };
    assert.deepEqual(orderAttendees(order), [
      { name: "Aisha", email: "", phone: "", main: true },
    ]);
  });

  test("empty and malformed orders yield an empty list", () => {
    assert.deepEqual(orderAttendees({}), []);
    assert.deepEqual(orderAttendees({ line_items: [{ properties: null }] }), []);
    assert.deepEqual(orderAttendees(null), []);
  });
});

describe("storeOrderRecord", () => {
  test("snapshots the order fields the registrations page shows", () => {
    const attendees = [{ name: "Aisha", email: "a@example.com", phone: "+65", main: true }];
    const record = storeOrderRecord(
      {
        id: 987654321,
        order_number: 1024,
        currency: "SGD",
        current_total_price: "90.00",
        email: "aisha@example.com",
        customer: { first_name: "Aisha", last_name: "Rahman" },
        processed_at: "2026-08-19T12:00:00+08:00",
        line_items: [
          { title: "LQK Maulid 2026", variant_title: "Family", quantity: 3 },
        ],
      },
      attendees
    );
    assert.deepEqual(record, {
      orderId: "987654321",
      orderNumber: "1024",
      lineTitle: "LQK Maulid 2026 — Family",
      qty: 3,
      amount: "90.00",
      currency: "SGD",
      customerName: "Aisha Rahman",
      customerEmail: "aisha@example.com",
      paidAt: "2026-08-19T12:00:00+08:00",
      attendees,
    });
  });

  test('hides "Default Title" and survives a bare payload', () => {
    const record = storeOrderRecord(
      { id: 1, name: "#7", line_items: [{ title: "Ticket", variant_title: "Default Title", quantity: 1 }] },
      []
    );
    assert.equal(record.lineTitle, "Ticket");
    assert.equal(record.orderNumber, "7");
    const empty = storeOrderRecord({}, []);
    assert.equal(empty.orderId, "");
    assert.equal(empty.lineTitle, null);
    assert.equal(empty.qty, null);
  });
});
