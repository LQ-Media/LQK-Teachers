"use client";

import { useEffect, useState } from "react";

/**
 * Loads public/huruf/geometry.json once per page.
 *
 * Fetched rather than imported so the 90 KB of path data stays out of the
 * JavaScript bundle — it is static, cacheable, and precached by the service
 * worker, so after the first visit it costs nothing and works with no network.
 * A module import would put it in the route's JS payload on every load.
 *
 * Module-level cache, not a context: several games mount and unmount within a
 * session and none of them should re-fetch.
 */

let cache = null;
let inflight = null;

function loadGeometry() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/huruf/geometry.json", { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`geometry ${r.status}`);
        return r.json();
      })
      .then((data) => {
        cache = data;
        inflight = null;
        return data;
      })
      .catch((err) => {
        inflight = null;
        throw err;
      });
  }
  return inflight;
}

/** `{ data, error }` — `data` is null until loaded. */
export function useGeometry() {
  const [state, setState] = useState(() => ({ data: cache, error: null }));

  useEffect(() => {
    if (state.data) return undefined;
    let live = true;
    loadGeometry().then(
      (data) => live && setState({ data, error: null }),
      (error) => live && setState({ data: null, error }),
    );
    return () => {
      live = false;
    };
  }, [state.data]);

  return state;
}

/** One letter's geometry, or null while loading. */
export function letterGeometry(geometry, letterId) {
  const letter = geometry?.letters?.[letterId];
  return letter ? { ...letter, viewBox: geometry.viewBox } : null;
}
