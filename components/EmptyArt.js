/**
 * Illustrated empty state — an LQK character over the copy that would
 * otherwise sit alone on a blank card.
 *
 * The art carries a real alpha channel, so it composites over any surface —
 * white card, cream page, tinted fill, photo. It used to be a white-ground
 * render faked with `mix-blend-mode: multiply`, which only vanished against a
 * near-white background and darkened the character on anything else; the
 * matte is now baked into the PNG by scripts/art/matte.mjs. Don't reintroduce
 * a blend mode here.
 *
 * `art` is a slug under /public/empty. Omit it and this degrades to plain
 * centred copy, which is what the pages did before.
 *
 * `size` is a HEIGHT, not a box. Keying the white ground out also trimmed each
 * render down to its own subject, so a lone standing figure is now much
 * narrower than a pair of children — pinning both axes would stretch one and
 * squash the other.
 */
export default function EmptyArt({ art, size = 168, children }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-8 text-center">
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/empty/${art}.png`}
          alt=""
          height={size}
          style={{ height: size, width: "auto", maxWidth: "100%" }}
          className="select-none"
        />
      ) : null}
      <p className="max-w-[42ch] text-[13px] leading-relaxed text-charcoal-soft">{children}</p>
    </div>
  );
}
