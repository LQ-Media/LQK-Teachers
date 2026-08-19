import { qrSvg } from "@/lib/qr/encoder";

/**
 * A QR symbol as inline SVG — no canvas, no image request, no client JS.
 *
 * Inline rather than an <img src="/api/qr?…">: these appear on a family's pass
 * (which must paint before the phone leaves the counter) and on a printed
 * poster (where a broken image request means a blank wall). A vector also
 * prints at whatever size the paper is.
 *
 * `size` is a CSS length, not a module count. The symbol is always drawn on the
 * spec's 4-module quiet zone; without it a scanner cannot find the corners, and
 * "it works on my phone but not theirs" is exactly how that failure presents.
 */
export default function QrCode({ value, size = 200, title = "QR code", className = "" }) {
  const { viewBox, path } = qrSvg(value, { title });
  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title}
      // Squares must land on whole pixels or a small symbol goes soft and the
      // decoder's contrast test starts failing at the edges.
      shapeRendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="#FFFFFF" />
      {/* Ink rather than pure black: it reads as part of the brand and still
          clears the ~40% contrast a decoder needs by a wide margin. */}
      <path d={path} fill="#3B372B" />
    </svg>
  );
}
