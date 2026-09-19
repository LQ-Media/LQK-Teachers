/**
 * One big Arabic glyph, optically centred.
 *
 * WHY THIS IS NOT JUST A <span>
 *
 * Mirza reserves a lot of vertical room below the baseline for tashkeel, so a
 * letter set as HTML text lands high in its line box and leaves a visible gap
 * underneath — across a 2x2 grid of answer cards it reads as if the layout is
 * broken. Tightening `line-height` does not fix it, because the ink's position
 * inside the em box is a property of the font, not of the line box.
 *
 * Rendering the glyph as SVG text with `dominant-baseline="middle"` centres it
 * on the font's own middle baseline instead, which puts the ink where the eye
 * expects it. Compared side by side against a centre line, this is the only one
 * of the four obvious approaches that actually centres — the other three
 * (line-height 1, line-height 0.7, and `dominant-baseline="central"`) all sit
 * high by roughly a tenth of the glyph's height.
 *
 * `fill="currentColor"` keeps Tailwind text colours working on the caller.
 */
export default function Glyph({ children, size = 62, className = "" }) {
  return (
    <svg viewBox="0 0 100 100" className={`max-w-full ${className}`} aria-hidden="true">
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={size}
        fill="currentColor"
        className="font-mirza"
      >
        {children}
      </text>
    </svg>
  );
}
