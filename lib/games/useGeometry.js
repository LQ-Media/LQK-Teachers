"use client";

import { useEffect, useState } from "react";

/**
 * Loads the generated letter geometry once per page.
 *
 * Two files, because the games need different halves of it:
 *   /huruf/geometry.json  the 28 isolated letters   (~100 KB)
 *   /huruf/forms.json     their 84 positional forms (~270 KB)
 *
 * Fetched rather than imported so the path data stays out of the JavaScript
 * bundle — it is static, cacheable and precached by the service worker, so
 * after the first visit it costs nothing and works with no network. A module
 * import would put it in the route's JS payload on every load, and would put
 * the positional forms there for the three games that never look at them.
 *
 * Module-level cache, not a context: several games mount and unmount within a
 * session and none of them should re-fetch.
 */

const cache = new Map();    // url → data
const inflight = new Map(); // url → Promise

function load(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (!inflight.has(url)) {
    inflight.set(
      url,
      fetch(url, { cache: "force-cache" })
        .then((r) => {
          if (!r.ok) throw new Error(`${url} ${r.status}`);
          return r.json();
        })
        .then((data) => {
          cache.set(url, data);
          inflight.delete(url);
          return data;
        })
        .catch((err) => {
          inflight.delete(url);
          throw err;
        }),
    );
  }
  return inflight.get(url);
}

/** `{ data, error }` — `data` is null until loaded. */
function useJson(url) {
  const [state, setState] = useState(() => ({ data: cache.get(url) ?? null, error: null }));

  useEffect(() => {
    if (state.data) return undefined;
    let live = true;
    load(url).then(
      (data) => live && setState({ data, error: null }),
      (error) => live && setState({ data: null, error }),
    );
    return () => {
      live = false;
    };
  }, [url, state.data]);

  return state;
}

export function useGeometry() {
  return useJson("/huruf/geometry.json");
}

export function useForms() {
  return useJson("/huruf/forms.json");
}

/** One letter's isolated geometry, or null while loading. */
export function letterGeometry(geometry, letterId) {
  const letter = geometry?.letters?.[letterId];
  return letter ? { ...letter, viewBox: geometry.viewBox } : null;
}

/** One letter's geometry in one position ("init" | "medi" | "fina"). */
export function formGeometry(forms, letterId, form) {
  const shape = forms?.forms?.[letterId]?.[form];
  return shape ? { ...shape, viewBox: forms.viewBox } : null;
}
