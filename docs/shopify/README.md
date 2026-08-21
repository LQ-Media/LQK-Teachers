# Attendee details on the LQK store product page

`lqk-attendee-fields.liquid` adds per-place attendee capture to
[LQK Maulid 2026](https://lqkstore.littlequrankids.sg/products/lqk-maulid-2026):

- **Number of attendees** — a dropdown (1–20) controlling only how many
  detail blocks show; it has nothing to do with the cart quantity or the price
- **Main attendee** — Name, Email, Phone (always shown)
- **Attendee 2, 3, …** — Name, Email, Phone, one block per attendee selected

The attendee list is deliberately **not** tied to the quantity stepper: the
product's price ($30 / $50 / $100 / $300 tier) is one contribution fee for the
whole registration, so quantity stays at 1 however many people attend — extra
attendees never multiply the price. The snippet never reads or writes the
quantity input.

The values travel as Shopify **line item properties**, so they land on the cart,
the checkout, the order in admin, the packing slip and the confirmation email
with no app, no Admin API and no extra cost. Property names on the order read:

```
Main Attendee Name / Main Attendee Email / Main Attendee Phone
Attendee 2 Name    / Attendee 2 Email    / Attendee 2 Phone
Attendee 3 Name    / …
```

This file lives in the portal repo because the portal is what reads LQK store
orders (`lib/events/shopify-core.js`); it *runs* in the lqkstore theme, which is
deployed separately with the Shopify CLI.

## Install — option A, no code push (fastest)

1. Shopify admin → **Online Store → Themes → Customize**.
2. Top bar: switch the page selector to **Products → LQK Maulid 2026** (or the
   product template it uses).
3. In the **Product information** section, **Add block → Custom Liquid**.
4. Paste the whole contents of `lqk-attendee-fields.liquid` into the block.
5. Drag the block to sit just above the Add-to-cart button, then **Save**.

The fields move themselves into the product form on load, so the block does not
have to be adjacent to the buy button for the details to submit.

## Install — option B, theme code

1. Copy the file into the theme as `snippets/lqk-attendee-fields.liquid`.
2. Render it inside the product form in `sections/main-product.liquid`, just
   before the buy-buttons block:
   ```liquid
   {% render 'lqk-attendee-fields' %}
   ```
3. `shopify theme push` as usual.

## Making the flat fee stick — the cart guard

The product form pins quantity to 1 at add-to-cart (and at "Buy it now"), but
the cart page and drawer draw their own − / + stepper, and a bumped line
multiplies the fee: 2 × $30 for one registration. `lqk-cart-flat-fee.liquid`
closes that hole. For any cart line carrying attendee details it hides the
stepper (a static "1" replaces it) and, if a line somehow reached quantity 2+
(an old cart, a direct link), resets it to 1 via the Cart AJAX API. Other
products in the same cart keep their steppers.

Install it where it runs on **every** page, because the drawer opens
everywhere: theme editor → **Footer → Add block → Custom Liquid** → paste the
whole file → Save. (Or paste before `</body>` in `layout/theme.liquid` and
push.)

## Scoping and options

Everything adjustable sits at the top of the file:

- `lqk_af_handles` — comma-separated product handles the form appears on.
  Defaults to `lqk-maulid-2026`; on any other product the snippet renders
  nothing at all.
- `MAX_GROUPS` (default 20) — the dropdown's highest option.
- `REQUIRED` (default `true`) — set `false` to let a shopper check out with
  blanks. While `true`, add-to-cart is blocked until every visible field is
  filled and the email addresses are well-formed.

## Verify after installing

```bash
node docs/shopify/verify-attendee-fields.mjs   # needs playwright + chromium
```

It drives the snippet in a headless browser against two theme shapes and
asserts what actually reaches `FormData` — including that the quantity input is
never touched, and the two failure modes that look perfectly fine in the theme
editor:

- **`form.id` is not the form's id on a Shopify product form.** Every one of
  them contains `<input name="id">`, and the form's named-element getter shadows
  the property, so `form.id` returns that input. Writing it into a `form=""`
  attribute detaches every attendee field from the form: the shopper fills them
  in, and *nothing* arrives on the order.
- **`data-` flags survive a section re-render.** A variant change re-parses the
  section's HTML, flags and all, so identity-based guards are the only ones that
  still work afterwards.

Then in the store itself: pick 3 in the attendees dropdown, confirm all three
blocks appear under the line item in the cart drawer at quantity 1, and place a
test order to see them on the order in admin.

## Known limits, worth deciding on

- **Both files need installing** for the flat fee to hold end to end: the
  product form pins quantity at checkout time, the cart guard covers the cart
  page and drawer. With only the form installed, a shopper can still bump the
  line in the cart.
- **If a different attendee form is already installed in the theme** (one that
  adds a ticket per attendee), remove it first — two forms would double the
  fields on the order, and a per-ticket form re-introduces the multiplication
  this pair exists to prevent.
- **Invitation links bypass the product page entirely.** The portal sends guests
  to a cart permalink (`contributionCheckoutUrl` in `lib/events/shopify-core.js`,
  `/cart/<variant>:<qty>?attributes[...]`), which skips the product page — so a
  guest arriving from an invitation never sees this form. If Maulid places are
  sold through invitations, point that link at the product page instead, or
  capture attendees in the portal.
- **The portal shows these registrations.** The orders/paid webhook records any
  paid order carrying attendee properties (`orderAttendees` in
  `lib/events/shopify-core.js`) into the `store_orders` table; they appear under
  **Events → Store registrations** with a one-row-per-person CSV export. The
  same webhook + `SHOPIFY_EVENTS_WEBHOOK_SECRET` wiring that confirms
  invitation contributions is all it needs.
- Adding the same product twice with different details creates two line items,
  each with its own set of properties. That is Shopify's behaviour and is fine.
