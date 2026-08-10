/**
 * Split a collection's passages into its sub-sections, then into pages.
 *
 * The extraction pipelines carry the sub-section name on every passage (`sub`)
 * rather than nesting them, so the grouping is a run-length pass over the
 * array. Runs, not a keyed map: a collection may return to the same heading
 * later on (Ratib does), and folding those together would silently reorder the
 * litany.
 *
 * Sub-sections are addressed by their INDEX in this list — the URLs under
 * /dzikir/[group]/[slug]/ are `0`, `1`, … — because the headings are free text
 * (Arabic, punctuation, empty for an opening passage) and are not unique.
 */
export function subsectionsOf(passages) {
  const out = [];
  for (const p of passages || []) {
    const sub = p.sub || "";
    if (!out.length || out[out.length - 1].sub !== sub) out.push({ sub, items: [] });
    out[out.length - 1].items.push(p);
  }
  return out.map((s) => ({ ...s, pages: pagesOf(s.items) }));
}

/**
 * Fold a sub-section's records into one page per readable passage.
 *
 * NU ships in-line headings ("Option I", "Intention for Hajj") as ordinary
 * records flagged `hdr`, with the text in the translation fields. Shown one
 * passage per screen those would each become a page holding nothing but a
 * title, so a heading is attached to the passage it introduces instead. A
 * trailing heading with nothing after it keeps its own page rather than
 * vanishing.
 */
export function pagesOf(items) {
  const pages = [];
  let heading = null;
  for (const p of items || []) {
    if (p.hdr) {
      heading = p;
      continue;
    }
    pages.push({ p, hdr: heading });
    heading = null;
  }
  if (heading) pages.push({ p: heading, hdr: null });
  return pages;
}

/** The label a sub-section shows when the source left its heading blank. */
export function subTitle(sub, index) {
  if (sub) return sub;
  return index === 0 ? "Opening" : "Continued";
}
