# LQK Teachers Portal

Next.js (App Router) portal for Little Quran Kids teachers — hafalan logging,
reading logs, hafalan review, and the Quran reader at `/quran`. Auth is a JWT
session cookie; data is stored in SQLite via Node's built-in `node:sqlite`.

## Local development

```bash
npm install
cp .env.example .env.local   # then set SESSION_SECRET (any value for dev)
npm run dev                  # http://localhost:3000
```

The dev database (`data/lqk.db`) is created and seeded on first run with demo
accounts (all password `password123`): `admin@lqk.test`, `reviewer@lqk.test`,
`teacher@lqk.test`. **Demo seeding is skipped when `NODE_ENV=production`.**

## Deploying to teachers.littlequrankids.sg

This app writes to a local SQLite file, so it needs a **persistent Node host
with a mounted disk** (Railway, Render, or Fly) — not a serverless platform
like Vercel, where the filesystem is ephemeral and writes would be lost. It
ships a `Dockerfile` (Next.js standalone output) for exactly this.

> Steps 1–2 and 5 require your own accounts/credentials — a host account and
> access to the DNS for `littlequrankids.sg`. They can't be automated from the
> repo.

### 1. Push the repo

The project has no git remote yet. Create a private repo (GitHub/GitLab) and:

```bash
git add -A
git commit -m "Quran reader + production deploy setup"
git remote add origin <your-repo-url>
git push -u origin main
```

### 2. Create the service on a persistent host

Using **Railway** as the concrete example (Render/Fly are equivalent):

- New Project → Deploy from your repo. Railway detects the `Dockerfile`.
- **Add a Volume** and mount it at **`/data`** (this is where `lqk.db` lives;
  the image sets `LQK_DATA_DIR=/data`). Without a volume, bookmarks and
  hafalan entries reset on every redeploy.
- Set environment variables:
  - `SESSION_SECRET` — generate with:
    ```bash
    node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
    ```
    The server refuses to sign sessions in production without this.
  - `NODE_ENV=production` (the Dockerfile sets this, but set it in the host too
    to be safe — it also disables demo-account seeding).
  - `LQK_DATA_DIR=/data` (matches the volume mount; already set in the image).

### 3. Create the first admin

Production starts with an **empty** user table (no demo accounts). After the
first deploy is live, run the bootstrap script once inside the running
container (Railway: the service shell; Fly: `fly ssh console`):

```bash
node scripts/create-admin.mjs --email you@littlequrankids.sg --name "Your Name" --password "a-strong-password"
```

It creates (or promotes) an admin using the same DB on the volume. You can then
add teachers/reviewers through the app.

### 4. Verify

Open the host's temporary URL, log in as the admin, and check `/quran` loads,
a bookmark survives a full reload, and a hafalan entry persists across a
redeploy (proves the volume is wired correctly).

### 5. Point the domain

`teachers.littlequrankids.sg` currently resolves to Shopify
(`23.227.38.70`). In your DNS manager for `littlequrankids.sg`:

- Remove/replace the existing `teachers` record (confirm nothing you need is
  served there today).
- Add the record your host gives you — typically a `CNAME` from `teachers` to
  the host's target domain (Railway/Render provide one; Fly uses an `A`/`AAAA`
  pair). Add the custom domain in the host's dashboard so it issues TLS.
- Wait for propagation, then confirm `https://teachers.littlequrankids.sg`
  serves the portal with a valid certificate.

## Notes

- `next.config.mjs` uses `output: "standalone"`. The build warns that the whole
  project is traced — that's because `lib/db.js` resolves the SQLite path with
  `process.cwd()`; it's harmless (larger image only).
- Running `scripts/create-admin.mjs` prints a `MODULE_TYPELESS_PACKAGE_JSON`
  reparse warning — cosmetic; the script still runs correctly.
