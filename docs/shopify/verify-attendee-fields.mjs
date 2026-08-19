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
   block), form has an id, quantity has +/- buttons, section re-renders. ---- */
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

  ok("moves itself into the product form", await inForm());
  ok(
    "one group at qty 1",
    JSON.stringify(await names()) ===
      JSON.stringify([
        "properties[Main Attendee Name]",
        "properties[Main Attendee Email]",
        "properties[Main Attendee Phone]",
      ]),
    JSON.stringify(await names()),
  );

  await page.click("#plus");
  await page.click("#plus");
  const n = await names();
  ok("qty 3 -> three groups", n.length === 9, n.length + " inputs");
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
    "theme fields still submit",
    entries.some(([k, v]) => k === "id" && v === "4242") && entries.some(([k]) => k === "quantity"),
  );

  await page.click("#minus");
  await page.click("#minus");
  ok("back to one group at qty 1", (await names()).length === 3);
  await page.click("#plus");
  await page.click("#plus");
  ok(
    "typed values survive a quantity dip",
    (await page.$$eval(".lqk-af input", (e) => e.map((x) => x.value))).join("|") === vals.flat().join("|"),
  );

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
  await page.fill('input[name="quantity"]', "3");
  await page.waitForTimeout(80);
  const after = await page.$$eval(".lqk-af input", (e) => e.map((x) => x.value));
  ok("values survive the re-render", after.length === 9 && after.join("|") === vals.flat().join("|"), after.join("|"));
  ok("properties still serialise after a re-render", (await props()).length === 9, JSON.stringify(await fd()));

  await page.fill('input[name="quantity"]', "999");
  await page.waitForTimeout(80);
  ok("caps at 20 groups", (await names()).length === 60, (await names()).length / 3 + " groups");
  await page.close();
}

/* ---- Theme B: snippet rendered INSIDE the form, form has no id, and the
   add-to-cart button is type="button" driven by the theme's own JS. ---- */
{
  const url = write(
    "custom.html",
    `<!doctype html><html><body>
<form action="/cart/add" method="post">
  <input type="hidden" name="id" value="777">
  <input type="number" name="quantity" value="2" min="1">
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
  ok("honours a quantity already above 1 on load", (await inputs()).length === 6, JSON.stringify(await inputs()));
  ok("no bogus form attribute when the form has no id", (await inputs()).every((i) => i.form === null), JSON.stringify(await inputs()));
  ok(
    "does not relocate when already inside the form",
    (await page.$eval("form", (f) => f.querySelectorAll("[data-lqk-attendee-fields]").length)) === 1,
  );

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

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join("; ")}` : "\nall green");
process.exit(fails.length ? 1 : 0);
