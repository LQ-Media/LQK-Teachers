# LQK Teachers Portal — production image for a persistent Node host
# (Railway / Render / Fly). Uses Next.js standalone output. The SQLite
# database lives on a mounted volume at /data (LQK_DATA_DIR), so bookmarks
# and hafalan entries survive restarts and redeploys.

# node:sqlite is built into the Node binary and needs Node >= 22.5; the app is
# developed on Node 26, so pin the major to match.
FROM node:26-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# SESSION_SECRET is read lazily at request time, not during build, so the
# build does not need it.
RUN npm run build

FROM node:26-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Point the DB at the mounted volume (see the volume config on your host).
ENV LQK_DATA_DIR=/data

# Standalone output: minimal server + only the traced deps.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# The admin bootstrap script is not part of the traced server bundle; copy the
# pieces it needs so `node scripts/create-admin.mjs` can run in the container.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib/hash.js ./lib/hash.js
COPY --from=builder /app/lib/db.js ./lib/db.js

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "server.js"]
