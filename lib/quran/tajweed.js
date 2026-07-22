/**
 * Tajweed markup parser, framework-agnostic.
 *
 * Quran.com's `text_uthmani_tajweed` field returns the ayah with inline rule
 * spans, e.g.  بِسْمِ <tajweed class=ham_wasl>ٱ</tajweed>للَّهِ …  and an
 * ayah-end marker <span class=end>١</span>. We turn that into an ordered list
 * of tokens the UI can colour, and expose a legend of the rules we style.
 */

// Rule class → { label, color }. Colours chosen for legibility on the paper
// background while staying close to the conventional tajweed colour scheme.
export const TAJWEED_RULES = {
  ham_wasl: { label: "Hamzat al-Wasl (not pronounced)", color: "#9A8C77" },
  slnt: { label: "Silent", color: "#9A8C77" },
  laam_shamsiyah: { label: "Laam Shamsiyyah (silent)", color: "#9A8C77" },
  madda_normal: { label: "Natural prolongation (2 counts)", color: "#3B6FB0" },
  madda_permissible: { label: "Permissible prolongation (2–6)", color: "#2E8B70" },
  madda_necessary: { label: "Necessary prolongation (6)", color: "#B5573C" },
  madda_obligatory: { label: "Obligatory prolongation (4–5)", color: "#C0642A" },
  ghunnah: { label: "Ghunnah (nasalisation)", color: "#2E9E5B" },
  qalqalah: { label: "Qalqalah (echo)", color: "#8A5CC0" },
  ikhafa: { label: "Ikhfa", color: "#C99A35" },
  ikhafa_shafawi: { label: "Ikhfa Shafawi", color: "#C99A35" },
  idgham_ghunnah: { label: "Idgham with Ghunnah", color: "#2E9E5B" },
  idgham_wo_ghunnah: { label: "Idgham without Ghunnah", color: "#B86F3A" },
  idgham_shafawi: { label: "Idgham Shafawi", color: "#2E9E5B" },
  idgham_mutajanisayn: { label: "Idgham Mutajanisayn", color: "#B86F3A" },
  idgham_mutaqaribayn: { label: "Idgham Mutaqaribayn", color: "#B86F3A" },
  iqlab: { label: "Iqlab", color: "#3B6FB0" },
};

function prettify(cls) {
  return String(cls || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Look up a rule's colour + label, with a sensible fallback for unknown classes. */
export function tajweedRule(cls) {
  return TAJWEED_RULES[cls] || { label: prettify(cls), color: "#8A5CC0" };
}

const TAJWEED_TAG = /<tajweed\s+class=["']?([a-z_]+)["']?\s*>([\s\S]*?)<\/tajweed>/gi;

/** Strip any residual non-tajweed markup (e.g. the <span class=end> marker). */
function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "");
}

/**
 * Parse a `text_uthmani_tajweed` string into ordered tokens:
 *   { text, rule }  — rule is a class key when coloured, null for plain text.
 * The ayah-end marker glyph is dropped (the UI shows its own "Ayah N" badge).
 */
export function parseTajweed(html) {
  const src = String(html || "").replace(/<span\s+class=["']?end["']?\s*>[\s\S]*?<\/span>/gi, "");
  const tokens = [];
  let lastIndex = 0;
  let m;
  TAJWEED_TAG.lastIndex = 0;
  while ((m = TAJWEED_TAG.exec(src)) !== null) {
    if (m.index > lastIndex) {
      const plain = stripTags(src.slice(lastIndex, m.index));
      if (plain) tokens.push({ text: plain, rule: null });
    }
    const inner = stripTags(m[2]);
    if (inner) tokens.push({ text: inner, rule: m[1] });
    lastIndex = TAJWEED_TAG.lastIndex;
  }
  if (lastIndex < src.length) {
    const plain = stripTags(src.slice(lastIndex));
    if (plain) tokens.push({ text: plain, rule: null });
  }
  return tokens;
}

/** The subset of rules actually present in a set of tokens — for a compact legend. */
export function rulesPresent(tokenLists) {
  const seen = new Set();
  for (const tokens of tokenLists) {
    for (const t of tokens) if (t.rule) seen.add(t.rule);
  }
  return [...seen];
}
