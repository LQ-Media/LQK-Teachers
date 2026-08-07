/**
 * Illustrated empty state — an LQK character over the copy that would
 * otherwise sit alone on a blank card.
 *
 * The art is rendered on a flat white ground rather than cut out with an
 * alpha channel (Gemini won't hold a clean matte around hair and fabric), so
 * every one of these is composited with `mix-blend-mode: multiply`: white
 * drops straight out against both the white cards and the cream page, and the
 * contact shadow underneath survives instead of being clipped away. Keep the
 * surface behind it light — on a mid-tone fill multiply would darken the
 * character too.
 *
 * `art` is a slug under /public/empty. Omit it and this degrades to plain
 * centred copy, which is what the pages did before.
 */
export default function EmptyArt({ art, size = 168, children }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-8 text-center">
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/empty/${art}.png`}
          alt=""
          width={size}
          height={size}
          style={{ width: size, height: size, mixBlendMode: "multiply" }}
          className="select-none"
        />
      ) : null}
      <p className="max-w-[42ch] text-[13px] leading-relaxed text-charcoal-soft">{children}</p>
    </div>
  );
}
