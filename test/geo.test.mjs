// Location stamps on Ad-hoc / OT sessions.
//
// The stamp is deliberately optional and deliberately one-shot (see the header
// of lib/hours/geo.js and HANDOFF.md §4). These tests protect the validation
// rules and the stored shape; they do not hit the network by default.
//
// The live Nominatim round-trip is opt-in:  LQK_TEST_NETWORK=1 npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ACCURACY_M,
  GEO_ATTRIBUTION,
  parseFix,
  hasGeo,
  formatCoords,
  formatAccuracy,
  mapsUrl,
  geoLabelOf,
  labelFromAddress,
  reverseGeocode,
} from "../lib/hours/geo.js";

describe("parseFix", () => {
  test("keeps a good fix and rounds accuracy to whole metres", () => {
    assert.deepEqual(parseFix({ lat: 1.3521, lng: 103.8198, accuracy: 12.6 }), {
      lat: 1.3521,
      lng: 103.8198,
      accuracy: 13,
    });
  });

  test("accepts strings, since fixes round-trip through forms and JSON", () => {
    assert.deepEqual(parseFix({ lat: "1.3521", lng: "103.8198", accuracy: "20" }), {
      lat: 1.3521,
      lng: 103.8198,
      accuracy: 20,
    });
  });

  test("a fix without accuracy is still usable", () => {
    assert.deepEqual(parseFix({ lat: 1.3, lng: 103.8 }), { lat: 1.3, lng: 103.8, accuracy: null });
    // A nonsense accuracy is dropped, but the coordinates are kept.
    assert.deepEqual(parseFix({ lat: 1.3, lng: 103.8, accuracy: -5 }), { lat: 1.3, lng: 103.8, accuracy: null });
    assert.deepEqual(parseFix({ lat: 1.3, lng: 103.8, accuracy: "n/a" }), { lat: 1.3, lng: 103.8, accuracy: null });
  });

  test("rejects null island — 0,0 means 'no fix', not the Gulf of Guinea", () => {
    assert.equal(parseFix({ lat: 0, lng: 0 }), null);
    assert.equal(parseFix({ lat: "", lng: "" }), null, "empty strings coerce to 0,0");
  });

  test("rejects out-of-range coordinates", () => {
    assert.equal(parseFix({ lat: 91, lng: 103.8 }), null);
    assert.equal(parseFix({ lat: -91, lng: 103.8 }), null);
    assert.equal(parseFix({ lat: 1.3, lng: 181 }), null);
    assert.equal(parseFix({ lat: 1.3, lng: -181 }), null);
  });

  test("rejects a fix too vague to mean anything, at the stated ceiling", () => {
    assert.equal(MAX_ACCURACY_M, 5000);
    assert.notEqual(parseFix({ lat: 1.3, lng: 103.8, accuracy: MAX_ACCURACY_M }), null, "the ceiling itself is allowed");
    assert.equal(parseFix({ lat: 1.3, lng: 103.8, accuracy: MAX_ACCURACY_M + 1 }), null);
  });

  test("rejects missing and non-numeric input", () => {
    assert.equal(parseFix(null), null);
    assert.equal(parseFix(undefined), null);
    assert.equal(parseFix({}), null);
    assert.equal(parseFix({ lat: "abc", lng: "def" }), null);
    assert.equal(parseFix({ lat: Infinity, lng: 103.8 }), null);
    assert.equal(parseFix({ lat: NaN, lng: 103.8 }), null);
  });

  test("valid negative coordinates are not confused with invalid ones", () => {
    assert.deepEqual(parseFix({ lat: -33.8688, lng: 151.2093 }), { lat: -33.8688, lng: 151.2093, accuracy: null });
  });
});

describe("hasGeo", () => {
  test("true only for a shaped session carrying real coordinates", () => {
    assert.equal(hasGeo({ geo: { lat: 1.3, lng: 103.8 } }), true);
    assert.equal(hasGeo({ geo: null }), false);
    assert.equal(hasGeo({}), false);
    assert.equal(hasGeo(null), false);
    assert.equal(hasGeo(undefined), false);
    assert.equal(hasGeo({ geo: { lat: 1.3 } }), false);
  });
});

describe("display helpers", () => {
  test("coordinates show 5dp — about a metre, all a phone gives", () => {
    assert.equal(formatCoords(1.435971, 103.786012), "1.43597, 103.78601");
    assert.equal(formatCoords("1.3", "103.8"), "1.30000, 103.80000");
  });

  test("accuracy switches to km at 1000 m", () => {
    assert.equal(formatAccuracy(12), "±12 m");
    assert.equal(formatAccuracy(999), "±999 m");
    assert.equal(formatAccuracy(1000), "±1.0 km");
    assert.equal(formatAccuracy(4800), "±4.8 km");
    assert.equal(formatAccuracy(0), "±0 m");
  });

  test("an unknown accuracy renders as nothing at all", () => {
    assert.equal(formatAccuracy(null), "");
    assert.equal(formatAccuracy(undefined), "");
    assert.equal(formatAccuracy("n/a"), "");
  });

  test("the map link carries 6dp to the maps app", () => {
    assert.equal(
      mapsUrl(1.3521, 103.8198),
      "https://www.google.com/maps/search/?api=1&query=1.352100,103.819800"
    );
  });

  test("a stamp describes itself by label, falling back to coordinates", () => {
    // A failed lookup is not an error — the coordinates are the record.
    assert.equal(geoLabelOf({ lat: 1.3, lng: 103.8, label: "Jalan Kayu, Seletar" }), "Jalan Kayu, Seletar");
    assert.equal(geoLabelOf({ lat: 1.3, lng: 103.8, label: null }), "1.30000, 103.80000");
    assert.equal(geoLabelOf({ lat: 1.3, lng: 103.8 }), "1.30000, 103.80000");
    assert.equal(geoLabelOf(null), "");
  });

  test("the OpenStreetMap attribution string is intact", () => {
    // Licence condition, not decoration: it must render wherever labels do.
    assert.equal(GEO_ATTRIBUTION, "Places © OpenStreetMap contributors");
  });
});

describe("labelFromAddress", () => {
  test("builds a Singapore-shaped address from the parts", () => {
    assert.equal(
      labelFromAddress({ address: { road: "Jalan Kayu", suburb: "Seletar", postcode: "799456" } }),
      "Jalan Kayu, Seletar, 799456"
    );
  });

  test("prefers the address parts over a shopfront display_name", () => {
    // At building zoom Nominatim's display_name often leads with the nearest
    // shop, which answers the wrong question for "where did you work?".
    const label = labelFromAddress({
      display_name: "Charles & Keith, 2, Orchard Turn, Singapore, 238801",
      address: { building: "ION Orchard", road: "Orchard Turn", postcode: "238801" },
    });
    assert.equal(label, "ION Orchard, Orchard Turn, 238801");
  });

  test("does not repeat a part that appears twice", () => {
    assert.equal(labelFromAddress({ address: { building: "Blk 1", road: "Blk 1", suburb: "Yishun" } }), "Blk 1, Yishun");
  });

  test("falls back to the first three display_name segments", () => {
    assert.equal(labelFromAddress({ display_name: "A, B, C, D, E" }), "A, B, C");
  });

  test("returns an empty string rather than throwing on junk", () => {
    assert.equal(labelFromAddress({}), "");
    assert.equal(labelFromAddress(null), "");
    assert.equal(labelFromAddress(undefined), "");
    assert.equal(labelFromAddress({ address: {} }), "");
  });
});

describe("reverseGeocode (live Nominatim)", { skip: !process.env.LQK_TEST_NETWORK }, () => {
  test("resolves a real Singapore fix to a plausible label", async () => {
    const label = await reverseGeocode(1.3521, 103.8198);
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0, "expected a non-empty label");
  });

  test("a fix in open ocean resolves to null without throwing", async () => {
    assert.equal(await reverseGeocode(0.5, -140.5), null);
  });
});
