/* Drives docs/shopify/lqk-attendee-fields.liquid in a real browser.

   Not part of `npm test` on purpose: this is theme code, it needs Playwright,
   and the portal's suite must stay dependency-free. Run it by hand after
   touching the snippet — the failure modes it covers are ones that look fine
   in the theme editor and silently drop attendee details at checkout.

     node docs/shopify/verify-attendee-fields.mjs        # needs playwright + chromium
*/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const SNIPPET = new URL("./lqk-attendee-fields.liquid", import.meta.url).pathname;

async function loadChromium() {
  const candidates = ["playwright", "playwright-core"];
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    candidates.push(path.join(globalRoot, "playwright", "index.mjs"));
  } catch {}
  for (const spec of candidates) {
    try {
      return (await import(spec)).chromium;
    } catch {}
  }
  console.error("Playwright not found. Install it first: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

/* The browser never sees Liquid — strip the tags the way the store would when
   the product handle matches. */
function renderedSnippet() {
  return fs
    .readFileSync(SNIPPET, "utf8")
    .replace(/{%-?\s*comment[\s\S]*?endcomment\s*-?%}/, "")
    .replace(/{%-?[\s\S]*?-?%}/g, "")
    .trim();
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lqk-af-"));
const write = (name, html) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, html);
  return "file://" + file;
};

const fails = [];
const ok = (name, cond, extra = "") => {
  console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  " + extra));
  if (!cond) fails.push(name);
};

const chromium = await loadChromium();
const browser = await chromium.launch();
const snippet = renderedSnippet();

/* ---- Theme A: Dawn-shaped. Snippet pasted OUTSIDE the form (a Custom Liquid
   block), form has an id, a quantity stepper the widget must NOT touch, and a
   section that re-renders on variant change. ---- */
{
  const url = write(
    "dawn.html",
    `<!doctype html><html><body>
<div id="shopify-section-main-product">
  <form id="product-form-main" action="/cart/add" method="post" enctype="multipart/form-data">
    <input type="hidden" name="id" value="4242">
    <quantity-input><button type="button" id="minus">-</button>
      <input type="number" name="quantity" value="1" min="1">
      <button type="button" id="plus">+</button></quantity-input>
    <div class="product-form__buttons"><button type="submit" name="add">Add to cart</button></div>
  </form>
</div>
<div id="custom-liquid-block">${snippet}</div>
<script>
  window.__submits = 0;
  document.getElementById('product-form-main').addEventListener('submit', (e) => { e.preventDefault(); window.__submits++; });
  const q = () => document.querySelector('input[name="quantity"]');
  document.getElementById('plus').onclick = () => { q().value = +q().value + 1; q().dispatchEvent(new Event('change', {bubbles:true})); };
  document.getElementById('minus').onclick = () => { q().value = Math.max(1, +q().value - 1); q().dispatchEvent(new Event('change', {bubbles:true})); };
<\/script></body></html>`,
  );

  const page = await browser.newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message));
  await page.goto(url);

  const names = () => page.$$eval(".lqk-af input", (els) => els.map((e) => e.name));
  const inForm = () => page.$eval("#product-form-main", (f) => !!f.querySelector("[data-lqk-attendee-fields]"));
  const fd = () => page.$eval("#product-form-main", (f) => [...new FormData(f).entries()]);
  const props = async () => (await fd()).filter(([k]) => k.startsWith("properties["));
  const qty = () => page.$eval('input[name="quantity"]', (i) => i.value);
  const addAttendee = () => page.click("[data-lqk-af-add]");
  const removeAttendee = () => page.click("[data-lqk-af-remove]");

  ok("moves itself into the product form", await inForm());
  ok(
    "one group on load",
    JSON.stringify(await names()) ===
      JSON.stringify([
        "properties[Main Attendee Name]",
        "properties[Main Attendee Email]",
        "properties[Main Attendee Phone]",
      ]),
    JSON.stringify(await names()),
  );
  ok("remove button hidden with one group", await page.$eval("[data-lqk-af-remove]", (b) => b.hidden));

  await addAttendee();
  await addAttendee();
  const n = await names();
  ok("add button -> three groups", n.length === 9, n.length + " inputs");
  ok(
    "extra groups named Attendee 2 / 3",
    n.includes("properties[Attendee 2 Name]") && n.includes("properties[Attendee 3 Phone]"),
    n.join(","),
  );
  ok(
    "legends read Main attendee / Attendee 2 / 3",
    JSON.stringify(await page.$$eval(".lqk-af__legend", (e) => e.map((x) => x.textContent))) ===
      JSON.stringify(["Main attendee", "Attendee 2", "Attendee 3"]),
  );

  // The whole point of the flat-fee design: attendees never touch the quantity.
  ok("quantity untouched by adding attendees", (await qty()) === "1", "qty=" + (await qty()));

  const vals = [
    ["Aisha Rahman", "aisha@example.com", "+6591234567"],
    ["Yusuf Rahman", "yusuf@example.com", "+6598765432"],
    ["Zaid Rahman", "zaid@example.com", "+6591112222"],
  ];
  const groups = await page.$$(".lqk-af__group");
  for (let i = 0; i < groups.length; i++) {
    const ins = await groups[i].$$("input");
    for (let j = 0; j < 3; j++) await ins[j].fill(vals[i][j]);
  }

  // The one that catches the form.id trap: fields visibly present, nothing submitted.
  ok("FormData carries all nine properties", (await props()).length === 9, JSON.stringify(await fd()));
  ok(
    "property values reach the cart intact",
    (await props()).some(([k, v]) => k === "properties[Attendee 2 Email]" && v === "yusuf@example.com"),
    JSON.stringify(await props()),
  );
  const entries = await fd();
  ok(
    "theme fields still submit, quantity still 1",
    entries.some(([k, v]) => k === "id" && v === "4242") &&
      entries.some(([k, v]) => k === "quantity" && v === "1"),
    JSON.stringify(entries),
  );

  await removeAttendee();
  await removeAttendee();
  ok("remove button -> back to one group", (await names()).length === 3);
  ok("remove button hides itself at one group", await page.$eval("[data-lqk-af-remove]", (b) => b.hidden));
  await addAttendee();
  await addAttendee();
  ok(
    "typed values survive remove + re-add",
    (await page.$$eval(".lqk-af input", (e) => e.map((x) => x.value))).join("|") === vals.flat().join("|"),
  );

  // The theme's own stepper must not grow or shrink the attendee list either.
  await page.click("#plus");
  await page.waitForTimeout(80);
  ok("quantity stepper does not change attendee groups", (await names()).length === 9);
  await page.click("#minus");

  await page.fill('input[name="properties[Attendee 3 Email]"]', "");
  await page.click('button[name="add"]');
  ok("blocked while a field is blank", (await page.evaluate(() => window.__submits)) === 0);
  await page.fill('input[name="properties[Attendee 3 Email]"]', "zaid@example.com");
  await page.click('button[name="add"]');
  ok("submits once complete", (await page.evaluate(() => window.__submits)) === 1);

  await page.fill('input[name="properties[Main Attendee Email]"]', "not-an-email");
  await page.click('button[name="add"]');
  ok("rejects a malformed email", (await page.evaluate(() => window.__submits)) === 1);
  await page.fill('input[name="properties[Main Attendee Email]"]', "aisha@example.com");

  // Flat fee, even against a bumped stepper: quantity is pinned to 1 on submit.
  await page.click("#plus");
  await page.click("#plus");
  ok("stepper bumped to 3 for the pin test", (await qty()) === "3", "qty=" + (await qty()));
  await page.click('button[name="add"]');
  ok("submit pins quantity back to 1", (await qty()) === "1", "qty=" + (await qty()));
  ok(
    "submitted FormData carries quantity 1",
    (await fd()).some(([k, v]) => k === "quantity" && v === "1"),
    JSON.stringify(await fd()),
  );

  // Variant change: the theme throws the whole section away and re-parses it.
  await page.evaluate(() => {
    const sec = document.getElementById("shopify-section-main-product");
    sec.innerHTML = sec.innerHTML;
    document.getElementById("product-form-main").addEventListener("submit", (e) => {
      e.preventDefault();
      window.__submits++;
    });
  });
  await page.waitForTimeout(300);
  ok("re-mounts after a section re-render", await inForm());
  ok("no stray duplicate container left behind", (await page.$$("[data-lqk-attendee-fields]")).length === 1);
  const after = await page.$$eval(".lqk-af input", (e) => e.map((x) => x.value));
  ok(
    "groups and values survive the re-render",
    after.length === 9 && after.join("|") === vals.flat().join("|"),
    after.join("|"),
  );
  ok("properties still serialise after a re-render", (await props()).length === 9, JSON.stringify(await fd()));

  // The button hides itself at the cap, so click only while it's visible.
  for (let i = 0; i < 30; i++) {
    if (await page.$eval("[data-lqk-af-add]", (b) => b.hidden)) break;
    await addAttendee();
  }
  ok("caps at 20 groups", (await names()).length === 60, (await names()).length / 3 + " groups");
  ok("add button hides itself at the cap", await page.$eval("[data-lqk-af-add]", (b) => b.hidden));
  await page.close();
}

/* ---- Theme B: snippet rendered INSIDE the form, form has no id, no quantity
   input at all, and the add-to-cart button is type="button" driven by the
   theme's own JS. ---- */
{
  const url = write(
    "custom.html",
    `<!doctype html><html><body>
<form action="/cart/add" method="post">
  <input type="hidden" name="id" value="777">
  ${snippet}
  <div class="product-form__buttons"><button type="button" name="add">Add to cart</button></div>
</form>
<script>
  window.__sent = 0;
  document.querySelector('[name="add"]').addEventListener('click', () => { window.__sent++; });
<\/script></body></html>`,
  );

  const page = await browser.newPage();
  page.on("pageerror", (e) => fails.push("pageerror: " + e.message));
  await page.goto(url);

  const inputs = () => page.$$eval(".lqk-af input", (e) => e.map((x) => ({ name: x.name, form: x.getAttribute("form") })));
  ok("works with no quantity input on the page", (await inputs()).length === 3, JSON.stringify(await inputs()));
  ok("no bogus form attribute when the form has no id", (await inputs()).every((i) => i.form === null), JSON.stringify(await inputs()));
  ok(
    "does not relocate when already inside the form",
    (await page.$eval("form", (f) => f.querySelectorAll("[data-lqk-attendee-fields]").length)) === 1,
  );

  await page.click("[data-lqk-af-add]");
  ok("add button works here too", (await inputs()).length === 6);

  await page.click('[name="add"]');
  ok('type="button" add-to-cart blocked while blank', (await page.evaluate(() => window.__sent)) === 0);

  const els = await page.$$(".lqk-af input");
  const v = ["Aisha", "aisha@example.com", "+6591234567", "Yusuf", "yusuf@example.com", "+6598765432"];
  for (let i = 0; i < els.length; i++) await els[i].fill(v[i]);
  await page.click('[name="add"]');
  ok('type="button" add-to-cart allowed once complete', (await page.evaluate(() => window.__sent)) === 1);
  ok(
    "serialises under a form with no id",
    (await page.$eval("form", (f) => [...new FormData(f).entries()])).filter(([k]) => k.startsWith("properties[")).length === 6,
  );
  await page.close();
}

/* ---- Cart guard (lqk-cart-flat-fee.liquid): a cart page AND a drawer, two
   lines — line 1 is the Maulid registration (bumped to qty 2 by a shopper),
   line 2 an ordinary product that must keep its stepper. The Cart AJAX API is
   stubbed; window.name survives the reload the guard triggers, so the
   /cart/change.js call is observable afterwards. ---- */
{
  const GUARD = new URL("./lqk-cart-flat-fee.liquid", import.meta.url).pathname;
  const guard = fs
    .readFileSync(GUARD, "utf8")
    .replace(/{%-?\s*comment[\s\S]*?endcomment\s*-?%}/, "")
    .trim();
  const line = (i) => `
    <div class="cart-item">
      <quantity-input><button type="button">-</button>
        <input type="number" name="updates[]" value="${i === 0 ? 2 : 5}">
        <button type="button">+</button></quantity-input>
    </div>`;
  const url = write(
    "cart.html",
    `<!doctype html><html><body>
<script>
  window.fetch = function (input, opts) {
    var url = String(input);
    if (url.indexOf('/cart/change.js') !== -1) {
      window.name = 'changed:' + (opts && opts.body);
      return Promise.resolve({ json: function () { return Promise.resolve({}); } });
    }
    if (url.indexOf('/cart.js') !== -1) {
      var fixed = window.name.indexOf('changed') === 0;
      return Promise.resolve({ json: function () { return Promise.resolve({
        items: [
          { quantity: fixed ? 1 : 2, properties: { 'Main Attendee Name': 'Aisha', 'Main Attendee Email': 'a@e.com' } },
          { quantity: 5, properties: {} },
        ],
      }); } });
    }
    return Promise.reject(new Error('unexpected fetch ' + url));
  };
<\/script>
<form action="/cart" id="cart-page">${line(0)}${line(1)}</form>
<div class="cart-drawer">${line(0)}${line(1)}</div>
${guard}
</body></html>`,
  );

  const page = await browser.newPage();
  page.on("pageerror", (e) => fails.push("guard pageerror: " + e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.name.indexOf("changed") === 0, null, { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("load");
  await page.waitForTimeout(400);

  const changed = await page.evaluate(() => window.name);
  ok(
    "bumped registration line reset to quantity 1 via /cart/change.js",
    changed.includes('"line":1') && changed.includes('"quantity":1'),
    changed,
  );
  const hidden = await page.$$eval("[data-lqk-flat-hidden]", (els) => els.length);
  ok("registration stepper hidden on the page AND in the drawer", hidden === 2, hidden + " hidden");
  const visible = await page.$$eval("quantity-input", (els) => els.filter((e) => e.style.display !== "none").length);
  ok("the other product keeps its stepper everywhere", visible === 2, visible + " visible");
  ok(
    'a static "1" stands in for each hidden stepper',
    (await page.$$eval("[data-lqk-flat-hidden]", (els) => els.every((e) => e.previousElementSibling?.textContent === "1"))),
  );
  await page.close();
}

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join("; ")}` : "\nall green");
process.exit(fails.length ? 1 : 0);
