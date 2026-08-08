# Event invites (`/events`)

Admin-only. Design an invitation, then send it to parents by email and
WhatsApp. Parents land on a public page at `/invite/<slug>` and answer
**Attending** / **Can't make it**; responses appear live in the portal.

Nothing here needs a parent to have a login.

## How it fits together

```
/events                    list of invites + reusable parent lists (admin)
/events/<id>               the builder: details, images, design, send
/invite/<slug>?r=<token>   what the parent opens (public, no login)
/api/events/asset/<file>   uploaded logos and backgrounds (public)
```

- **Uploads** (`logo`, `background`) go to `LQK_DATA_DIR/uploads/events/`,
  beside the avatars and cert scans. They are served publicly because they are
  embedded in emails sitting in parents' inboxes — a session check would render
  every invite as a broken image. Filenames are random UUIDs.
- **Recipients are snapshotted** onto the event when you attach a list. Editing
  or deleting the list afterwards never rewrites a sent invite's record.
- **Each recipient gets a 32-character random token.** That token is the whole
  authorisation story for an RSVP: it identifies the parent so they don't have
  to type anything, and it is why a forwarded link (no token) shows the invite
  but no RSVP buttons.
- **Sending runs in batches from the browser**, eight parents at a time with a
  pause between each. A 200-parent send would otherwise outlive the request
  timeout. Each recipient row records its own outcome, so re-running only picks
  up whoever is still pending — a retry never double-sends.

## Setup

Both channels are off until their environment variables are set. The builder
still works without them — you can design and preview invites; only sending
fails, and the page says so before you press anything.

### 1. Public origin

```
APP_URL=https://teachers.littlequrankids.sg
```

This is what goes into invite links and into the image URLs inside emails. If
it is wrong, parents get dead links and broken images.

### 2. Email — Google Workspace SMTP

```
SMTP_USER=events@littlequrankids.sg
SMTP_PASSWORD=<16-character app password>
```

`SMTP_PASSWORD` must be an **app password**, not the account password:

1. Turn on 2-Step Verification for the sending account.
2. Generate one at <https://myaccount.google.com/apppasswords>.

Optional: `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (default `465`),
`SMTP_FROM`, `SMTP_FROM_NAME`, `SMTP_REPLY_TO`.

Gmail rewrites the From address to the authenticated account unless the address
is a verified alias under "Send mail as", so `SMTP_FROM` only takes effect if
you have set that up.

**Sending limits.** Google Workspace caps at roughly **2,000 recipients per
day** (a free gmail.com account: 500). Invites go out one message per parent —
never one big BCC — because each carries a personal greeting and its own RSVP
link, and a 300-address BCC is a spam-filter magnet. A parent list larger than
the cap needs splitting across two days.

### 3. WhatsApp — WATI

```
WATI_API_ENDPOINT=https://live-mt-server.wati.io/<tenant-id>
WATI_ACCESS_TOKEN=<token from the WATI dashboard>
WATI_TEMPLATE_NAME=lqk_event_invite
```

Endpoint and token both come from the **API Docs** page inside your WATI
dashboard.

#### You must create the template first

WhatsApp does not carry HTML, and a business may not send free-form text to a
parent outside a 24-hour reply window. An unprompted invite is therefore a
**template message**: wording registered in WATI and approved by Meta, with
numbered placeholders the portal fills in. This cannot be automated from the
app — an unapproved template name is rejected, and free-form blasting gets the
business number banned.

In WATI → **Broadcast → Templates → Add Template**, create a template named
`lqk_event_invite` in the **Marketing** or **Utility** category with this body:

```
Assalamualaikum {{1}},

You're invited to {{2}}.

🗓 {{3}}
📍 {{4}}

Please let us know if you can make it:
{{5}}

— Little Quran Kids
```

The placeholders must be in exactly this order, because that is the order
`lib/events/send.js` sends them in:

| Placeholder | Value                                    |
| ----------- | ---------------------------------------- |
| `{{1}}`     | Parent name (falls back to "there")      |
| `{{2}}`     | Event title                              |
| `{{3}}`     | Date and time, e.g. `12 Sept 2026, 10:00 am` |
| `{{4}}`     | Venue name                               |
| `{{5}}`     | The parent's personal invite link        |

If you change the wording, keep the five placeholders and their order, or
change `whatsappParameters()` to match. Reordering them silently reshuffles
every parent's message.

Meta approval usually takes minutes to a few hours. Until it is approved,
sending returns an error per parent, visible in the responses table.

**Opt-in.** WhatsApp requires recorded consent before messaging someone.
Parents who have not opted in will fail with an error from WATI rather than
being delivered to.

### 4. Optional

```
EVENT_SEND_DELAY_MS=900   # pause between parents; lower only if both providers are happy
```

## Using it

1. **Import your parents.** `/events` → *Import CSV*. Any export works — the
   importer looks for name, email, phone and child columns and shows you what
   it found *before* saving, so a mis-detected column is caught early. Bare
   8-digit Singapore mobiles get `+65` added. A parent repeated once per child
   collapses to a single invite. Rows with no usable email *or* phone are
   reported as skipped rather than dropped silently.
2. **Create the invite** and fill in the details. Everything autosaves; the
   preview on the right is the actual page parents will open, not a mock-up.
3. **Upload a logo and background.** If the background photo makes the title
   hard to read, raise *Background dimming* in the Design section.
4. **Test it on yourself.** Put your own email and WhatsApp number in step 3 of
   the Send panel and press *Send test*. Read it on your phone. There is no
   unsend.
5. **Send.** The button names the exact number of parents it will reach. A
   progress bar tracks the batches; failures are listed per parent with the
   reason, and can be retried per channel without touching anyone else.

## Language

Each event has a language toggle (English / Bahasa Melayu) that changes the
fixed wording — "You're invited", "Will you be joining us?", the RSVP buttons.
Your own event text is used exactly as you type it.

> **The Malay strings in `lib/events/design.js` are a first pass and have not
> been reviewed by a native speaker.** Please read them before the first Malay
> invite goes out; they are all in the `ms` block of the `STRINGS` object.

## Testing

```sh
node scripts/smoke-events.mjs                    # pure modules
BASE=http://localhost:3000 node scripts/smoke-events.mjs   # also the live public page
```

The second form needs `LQK_DATA_DIR` pointing at the running server's data
directory, because it writes a throwaway event straight into the database.
