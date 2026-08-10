/* Decorative headers drawn as inline SVG rather than generated images.

   Three reasons this isn't an <img>: it inherits `currentColor` so it repaints
   with any generated accent for free, it costs no request on a guest's mobile
   data, and it stays crisp at any width. The AI theme step picks WHICH ornament
   by name (see ORNAMENTS in lib/events/theme.js) — it never supplies markup,
   so a generation can't inject SVG into a guest's page.

   All are aria-hidden: they carry no meaning, and announcing "image" before the
   invitation text would put noise between a screen-reader user and the event. */

export default function Ornament({ kind = "geometric", className = "" }) {
  if (kind === "none") return null;

  const common = {
    className: `inv-ornament ${className}`,
    viewBox: "0 0 400 74",
    preserveAspectRatio: "xMidYMid slice",
    "aria-hidden": "true",
    focusable: "false",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1",
  };

  switch (kind) {
    case "geometric":
      return (
        <svg {...common}>
          {[0, 50, 100, 150, 200, 250, 300, 350].map((x) => (
            <g key={x} transform={`translate(${x} 0)`}>
              <path d="M25 6 L44 20 L44 46 L25 60 L6 46 L6 20 Z" />
              <path d="M25 18 L34 25 L34 41 L25 48 L16 41 L16 25 Z" />
              <path d="M0 33 L6 33 M44 33 L50 33" />
            </g>
          ))}
        </svg>
      );

    case "arabesque":
      return (
        <svg {...common}>
          {[0, 100, 200, 300].map((x) => (
            <g key={x} transform={`translate(${x} 0)`}>
              <path d="M0 40 C20 40 20 14 40 14 C60 14 60 40 80 40 C90 40 96 34 100 28" />
              <path d="M0 40 C20 40 20 66 40 66 C60 66 60 40 80 40" />
              <circle cx="40" cy="14" r="3" fill="currentColor" stroke="none" />
              <circle cx="40" cy="66" r="2" fill="currentColor" stroke="none" />
            </g>
          ))}
        </svg>
      );

    case "botanical":
      return (
        <svg {...common}>
          <path d="M0 46 H400" strokeOpacity="0.4" />
          {[30, 110, 190, 270, 350].map((x) => (
            <g key={x} transform={`translate(${x} 0)`}>
              <path d="M0 46 C0 30 8 22 16 18 C14 30 8 38 0 46" />
              <path d="M0 46 C0 30 -8 22 -16 18 C-14 30 -8 38 0 46" />
              <path d="M0 46 V26" />
            </g>
          ))}
        </svg>
      );

    case "artdeco":
      return (
        <svg {...common}>
          <path d="M0 20 H400 M0 54 H400" strokeOpacity="0.5" />
          {[0, 40, 80, 120, 160, 200, 240, 280, 320, 360].map((x) => (
            <path key={x} d={`M${x + 20} 20 L${x + 34} 37 L${x + 20} 54 L${x + 6} 37 Z`} />
          ))}
        </svg>
      );

    case "handdrawn":
      return (
        <svg {...common} strokeLinecap="round">
          <path d="M4 38 C60 26 120 48 180 36 C240 24 300 46 396 34" strokeOpacity="0.7" />
          <path d="M4 46 C70 36 130 56 190 44 C250 32 310 54 396 42" strokeOpacity="0.4" />
        </svg>
      );

    case "corner-flourish":
      return (
        <svg {...common} viewBox="0 0 400 74" preserveAspectRatio="xMidYMid meet">
          <path d="M8 66 C8 30 30 8 66 8" />
          <path d="M18 66 C18 38 38 18 66 18" strokeOpacity="0.5" />
          <path d="M392 66 C392 30 370 8 334 8" />
          <path d="M382 66 C382 38 362 18 334 18" strokeOpacity="0.5" />
          <circle cx="200" cy="26" r="3" fill="currentColor" stroke="none" />
          <path d="M150 26 H188 M212 26 H250" strokeOpacity="0.5" />
        </svg>
      );

    default:
      return null;
  }
}
