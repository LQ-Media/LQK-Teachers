// Resolving Karim's list of names to accounts.
//
// This is the code that decides who can see payroll, so the tests that matter
// are the ones proving it REFUSES: a name matching nobody, a name matching two
// people, a branch that isn't real. Granting too much is silent; granting too
// little gets reported within the hour.
//
// Pure module, so no database needed — which is the point of having extracted
// it. The script and the Admin → Access panel both call exactly this.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FULL_ADMINS,
  CENTRE_ADMINS,
  fold,
  findByName,
  resolveScopePlan,
} from "../lib/admin/scopes.js";
import { LOCATIONS } from "../lib/locations.js";

const person = (id, full_name, role = "teacher", admin_scope = null) => ({
  id,
  full_name,
  email: `${id}@lqk.test`,
  role,
  admin_scope,
});

// Everyone on the list, plus decoys that share a first name.
function roster(extra = []) {
  return [
    person("karim", "Nur Abdul Karim"),
    person("suaidah", "Siti Suaidah"),
    person("iman", "Nurul Iman Fatimah"),
    person("malia", "Siti Malia"),
    person("zafirah", "ZAFIRAH BINTE ZANUDIN"),
    person("sabrina", "NUR SABRINA BINTE RAHIM"),
    person("khai", "KHAIRUNNISAA' BTE SHARIL"),
    person("zulaiha", "SITI ZULAIHA BINTE SAMSUKAMAR"),
    person("aisyah", "NUR AISYAH BINTE AHMAD DAHLAN"),
    person("mellisha", "MELLISHA BINTE ERWAN"),
    person("nadiah", "NADIAH BINTE MOHAMMAD SALAM"),
    // decoys
    person("sabrina2", "NUR SABRINA BTE OTHMAN"),
    person("aisyah2", "NUR AISYAH BINTE RAHMAT"),
    person("nadiah2", "NADIAH BINTE ISMAIL"),
    ...extra,
  ];
}

describe("the list itself", () => {
  test("four full admins and seven centre IT Heads", () => {
    assert.equal(FULL_ADMINS.length, 4);
    assert.equal(CENTRE_ADMINS.length, 7);
  });

  test("every centre on the list is a real branch", () => {
    // A typo here would silently give somebody access to nothing.
    for (const [name, branches] of CENTRE_ADMINS) {
      for (const b of branches) {
        assert.ok(LOCATIONS.includes(b), `${name}: ${b} is not a known branch`);
      }
    }
  });

  test("no name appears in both tiers", () => {
    const centre = new Set(CENTRE_ADMINS.map(([n]) => fold(n)));
    for (const n of FULL_ADMINS) assert.ok(!centre.has(fold(n)), `${n} is in both tiers`);
  });
});

describe("apostrophes", () => {
  const forms = ["'", "’", "‘", "ʼ", "´"];

  test("all five forms fold to the same thing", () => {
    const folded = new Set(forms.map((a) => fold(`KHAIRUNNISAA${a} BTE SHARIL`)));
    assert.equal(folded.size, 1);
  });

  test("every stored-vs-typed combination still finds exactly one person", () => {
    // The failure this prevents: a curly apostrophe in the roster and a straight
    // one in the portal, reported as NO MATCH, and an IT Head quietly left
    // without the access she was promised.
    for (const stored of forms) {
      const people = roster([person("khai2", `KHAIRUNNISAA${stored} BTE SHARIL`)]).filter(
        (p) => p.id !== "khai"
      );
      for (const typed of forms) {
        const hits = findByName(people, `KHAIRUNNISAA${typed} BTE SHARIL`);
        assert.equal(hits.length, 1, `stored ${JSON.stringify(stored)} / typed ${JSON.stringify(typed)}`);
      }
    }
  });

  test("case and extra whitespace do not matter", () => {
    assert.equal(findByName(roster(), "  siti   MALIA ").length, 1);
  });
});

describe("resolving the plan", () => {
  test("a complete roster resolves everybody, with no problems", () => {
    const { plan, problems } = resolveScopePlan(roster(), LOCATIONS);
    assert.equal(problems.length, 0, JSON.stringify(problems));
    assert.equal(plan.length, FULL_ADMINS.length + CENTRE_ADMINS.length);
  });

  test("each person gets the right tier and the right centres", () => {
    const { plan } = resolveScopePlan(roster(), LOCATIONS);
    const by = Object.fromEntries(plan.map((p) => [p.id, p]));
    assert.equal(by.karim.scope, "full");
    assert.deepEqual(by.karim.branches, []);
    assert.equal(by.khai.scope, "centre");
    assert.deepEqual(by.khai.branches, ["Tampines Blk 462", "Tampines Junction"]);
    assert.deepEqual(by.zafirah.branches, ["Woods Square"]);
  });

  test("a missing account is REPORTED, not guessed", () => {
    const people = roster().filter((p) => p.id !== "malia");
    const { plan, problems } = resolveScopePlan(people, LOCATIONS);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].kind, "no_match");
    assert.match(problems[0].query, /Siti Malia/);
    assert.ok(!plan.some((p) => p.name === "Siti Malia"));
  });

  test("two people with the same name are REPORTED, not picked between", () => {
    // The one that would actually hand payroll access to the wrong person.
    const people = roster([person("malia2", "Siti Malia")]);
    const { plan, problems } = resolveScopePlan(people, LOCATIONS);
    const amb = problems.find((p) => p.kind === "ambiguous");
    assert.ok(amb, JSON.stringify(problems));
    assert.match(amb.detail, /Matches 2/);
    assert.equal(plan.filter((p) => p.name === "Siti Malia").length, 0);
  });

  test("one bad name does not stop the others", () => {
    const people = roster().filter((p) => p.id !== "khai");
    const { plan, problems } = resolveScopePlan(people, LOCATIONS);
    assert.equal(problems.length, 1);
    assert.equal(plan.length, FULL_ADMINS.length + CENTRE_ADMINS.length - 1);
  });

  test("a branch that is not in LOCATIONS is refused", () => {
    const { problems } = resolveScopePlan(roster(), ["Woods Square"]);
    assert.ok(problems.some((p) => p.kind === "bad_branch"));
  });

  test("decoys never win", () => {
    const { plan } = resolveScopePlan(roster(), LOCATIONS);
    const ids = plan.map((p) => p.id);
    for (const decoy of ["sabrina2", "aisyah2", "nadiah2"]) {
      assert.ok(!ids.includes(decoy), `${decoy} was matched`);
    }
  });

  test("an empty roster produces problems and an empty plan, never a partial write", () => {
    const { plan, problems } = resolveScopePlan([], LOCATIONS);
    assert.equal(plan.length, 0);
    assert.equal(problems.length, FULL_ADMINS.length + CENTRE_ADMINS.length);
  });
});

describe("what the screen shows as 'was'", () => {
  test("a teacher being promoted reads as not an admin", () => {
    const { plan } = resolveScopePlan(roster(), LOCATIONS);
    assert.match(plan.find((p) => p.id === "karim").was, /not an admin/);
  });

  test("somebody who already holds it reads as their current tier", () => {
    const people = roster().map((p) =>
      p.id === "karim" ? { ...p, role: "admin", admin_scope: "full" } : p
    );
    const { plan } = resolveScopePlan(people, LOCATIONS);
    const row = plan.find((p) => p.id === "karim");
    assert.equal(row.was, "full access");
    assert.equal(row.changes, false, "an unchanged full admin should not count as a change");
  });

  test("a centre admin always counts as changing, because branches are rewritten", () => {
    const people = roster().map((p) =>
      p.id === "zafirah" ? { ...p, role: "admin", admin_scope: "centre" } : p
    );
    const { plan } = resolveScopePlan(people, LOCATIONS);
    assert.equal(plan.find((p) => p.id === "zafirah").changes, true);
  });
});
