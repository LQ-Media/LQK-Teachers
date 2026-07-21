/**
 * Bookmark service — same interface the framework-agnostic store expects
 * ({ available, get(), set(pos) }), backed by the portal's Server Actions.
 *
 * This is the direct analogue of the Shopify build's bookmark-service.js: the
 * store never knows whether writes go to a Shopify metafield or the portal's
 * SQLite table — only this thin adapter changes between the two apps.
 */

import { getQuranBookmark, setQuranBookmark } from "@/lib/actions/quran";

/**
 * @param {object} opts
 * @param {{chapterId:number, verseKey:string}|null} [opts.initialBookmark]
 *   Bookmark read server-side in the page and passed in, so first paint shows
 *   the "continue reading" banner without a client round-trip.
 */
export function createServerBookmarkService({ initialBookmark = null } = {}) {
  return {
    available: true,
    async get() {
      try {
        return await getQuranBookmark();
      } catch (err) {
        return initialBookmark; // best-effort read; keep the server-seeded value
      }
    },
    async set(pos) {
      await setQuranBookmark(pos);
    },
  };
}
