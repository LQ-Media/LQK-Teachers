// Every piece of generated art in the portal, in one list.
//
// The rule this file exists to enforce (Karim, Aug 2026): **art is coloured by
// the real world, not by the theme.** Wood is wood, brass is brass, steel is
// steel, paper is paper. The old set was clay tinted to whatever the palette
// was that month — lavender clocks, a rose Kaaba — which dated instantly and
// made every screen feel like one colour. Materials don't date.
//
// Two hard constraints on top of that:
//   * Religious subjects keep their true colours. The Kaaba is black kiswah
//     with a gold band. The Green Dome of Masjid an-Nabawi is green. These are
//     never restyled to match a palette, at any size, for any reason.
//   * Everything ships on a real alpha channel. See scripts/art/matte.mjs for
//     why (short version: the models can't emit one, so we key it out).

/** The house style. Every prompt ends with this. */
export const STYLE = [
  "Soft 3D clay-render icon in the style of a friendly children's app:",
  "smooth matte plasticine surfaces, chunky rounded forms, no sharp edges,",
  "gentle top-left studio light with soft self-shadowing, slight depth of field.",
  "Centred, filling most of the square frame with a small even margin.",
  "CRITICAL: the subject sits on a completely flat, uniform, pure white #FFFFFF",
  "background — no checkerboard, no gradient, no vignette, no floor or ground",
  "plane, no cast shadow falling on the background, no props, no text, no",
  "watermark, no border.",
].join(" ");

/** Palette guidance reused by most prompts. */
const NATURAL =
  "Real-world materials and colours only — natural wood, aged brass, polished gold, brushed steel, terracotta, cream paper, leather. No pastel purple, no lavender, no lilac, no pink.";

/**
 * dir  — folder under public/
 * size — output square size in px
 * items[slug] — the subject description; STYLE is appended automatically.
 */
export const GROUPS = [
  {
    dir: "spot",
    size: 512,
    note: "Page-heading art, one per portal destination (see lib/spot.js).",
    items: {
      dashboard:
        "A cosy little house. Warm terracotta roof tiles, sandy plaster walls, a natural oak door and a small window. " +
        NATURAL,
      hafalan:
        "A clipboard holding a sheet of cream paper with a green tick, and a sharpened yellow-orange pencil resting on it. Natural wood clipboard back, brass clip. " +
        NATURAL,
      reading:
        "An open book lying flat, cream paper pages, rich brown leather cover and a red fabric ribbon bookmark. " +
        NATURAL,
      notebook:
        "A classic broadcast microphone on a small stand. Brushed steel mesh head, dark charcoal body, chrome ring. " +
        NATURAL,
      ilmu:
        "A neat stack of four hardback books with an unlit brass reading lamp beside them. Book covers in natural cloth colours — forest green, ochre, oxblood, navy. " +
        NATURAL,
      packs:
        "A tidy stack of cream paper worksheets tied with a loop of natural jute twine. " +
        NATURAL,
      kalimah:
        "A single five-pointed star ornament in polished warm gold, like a brass Christmas-tree star, with a soft sheen. " +
        NATURAL,
      dzikir:
        "A crescent moon with a small brass lantern hanging from it on a fine chain. Pale bone-white moon, aged brass lantern with warm amber glass. " +
        NATURAL,
      quran:
        "An open Quran resting on a carved wooden rehal (X-shaped book stand). Dark walnut stand, cream pages, deep green cloth binding with gold edging. " +
        NATURAL,
      qibla:
        "A pocket compass. Warm aged brass case, off-white enamel dial with a dark compass rose, polished steel needle with a red north tip. " +
        NATURAL,
      solat:
        "A rolled-up prayer mat standing on its end beside a small glass bottle of attar. Deep teal-green mat with a woven cream border, clear glass bottle with a gold cap. " +
        NATURAL,
      achievements:
        "A winner's trophy cup with two handles, floating alone in empty space. Polished golden brass cup on a dark walnut wood base. Absolutely nothing behind it — no shelf, no wall, no plinth, no textured surface. " +
        NATURAL,
      hours:
        "A twin-bell alarm clock. Cream enamel body, brushed steel bells and feet, white face with black hands. " +
        NATURAL,
      admin:
        "A single cog wheel with a small toggle switch resting against it. Brushed gunmetal steel cog, the toggle in warm brass. " +
        NATURAL,
      profile:
        "A lanyard ID badge card. Cream card face with a small photo panel and two grey text lines, brown leather strap and a brass clip. " +
        NATURAL,
      review:
        "A sheet of cream paper with a folded corner, a wax seal in deep red at the bottom, and a small green tick above it. " +
        NATURAL,
    },
  },
  {
    dir: "badge",
    size: 256,
    note: "Achievement group markers on /achievements (components/achievements/MeTab.js).",
    items: {
      hafalan:
        "An award medal on a ribbon. Polished gold medal disc embossed with a small open book, deep green fabric ribbon. " +
        NATURAL,
      reading:
        "An award medal on a ribbon. Warm bronze medal disc embossed with an open book, russet-brown fabric ribbon. " +
        NATURAL,
      recognition:
        "An award rosette. Polished silver centre disc with a pleated navy-blue fabric rosette and two ribbon tails. " +
        NATURAL,
      teaching:
        "An award medal on a ribbon. Polished gold medal disc embossed with a graduation cap, ochre-gold fabric ribbon. " +
        NATURAL,
    },
  },
  {
    dir: "prop",
    size: 384,
    note: "Decorative props floating on the dashboard hero and stat cards.",
    items: {
      cloud:
        "A single small fluffy cloud. Soft white with faint warm-grey shading underneath, like carved wool. " +
        NATURAL,
      crescent:
        "A thin waxing crescent moon, and nothing else. A slim curved sliver with sharp horns top and bottom — the inner curve bites a deep hollow out of the disc, so what is left is a narrow crescent. NOT a sphere, NOT a full circle, NOT a ball with a crescent drawn on it. Pale bone-white with a warm sandy shadow along the inner edge. " +
        NATURAL,
      lantern:
        "A hanging Ramadan lantern (fanoos) on a short chain, the chain running off the TOP of the frame. Aged brass frame with warm amber glass panels, unlit. " +
        NATURAL,
      stars:
        "A loose scatter of five small five-pointed stars at different sizes and angles. Polished warm gold, like little brass charms. " +
        NATURAL,
    },
  },
  {
    dir: "prayer",
    size: 256,
    note:
      "The five daily prayers, in the dashboard SolatWidget and the /solat " +
      "timetable. Each one is the sky at that hour, painted in real sky " +
      "colours rather than the page tint — the tile behind it supplies the tone.",
    items: {
      fajr:
        "Sunrise, as a free-floating object: a pale gold sun disc rising from behind a small rounded sandy dune, its top two-thirds clear of the dune, short soft rays around the rim. Nothing else — no rounded-rectangle frame, no card, no tile, no border, no sky panel behind it. " +
        NATURAL,
      dhuhr:
        "A midday sun at full height. Bright warm yellow-gold disc with short even rays, nothing else in frame. " +
        NATURAL,
      asr:
        "A sun partly behind a single fluffy white cloud, late-afternoon light. Warm amber sun, soft white cloud with grey underside. " +
        NATURAL,
      maghrib:
        "Sunset, as a free-floating object: a deep orange sun disc sinking behind a small rounded dune, only its top half showing, short soft rays around the rim. Nothing else — no rounded-rectangle frame, no card, no tile, no border, no sky panel behind it. " +
        NATURAL,
      isha:
        "A night sky: a slim bone-white crescent moon with two or three small gold stars beside it, on nothing else. " +
        NATURAL,
    },
  },
  {
    dir: "dzikir",
    size: 512,
    note: "Group tiles in the Wirid & Doa library (lib/dzikir/icons.js).",
    items: {
      wirid:
        "A tasbih (Muslim prayer-bead loop) laid in a soft coil, with a tassel. Beads of dark polished rosewood and warm amber, cream cotton tassel and cord. " +
        NATURAL,
      doa:
        "A pair of cupped open hands raised in supplication, side by side, palms up and empty. Warm natural skin tone, plain cream sleeve cuffs. Nothing held in the hands. " +
        NATURAL,
      maulid:
        "A single open rose bloom seen from above. Deep red-crimson petals with soft green sepals — a real rose colour, not pink pastel. " +
        NATURAL,
      "haji-dan-umrah":
        "The Kaaba in Makkah. Historically accurate colours ONLY: a cube draped in the black kiswah cloth, with the wide gold-embroidered band running around the upper third and the gold door on one face. Black and gold and nothing else. Treat this as a sacred subject: dignified, simple, no stylised recolouring.",
      spesial:
        "A thin crescent moon with a small five-pointed star tucked into its curve, and a brass Ramadan lantern hanging below on a short chain. Pale bone-white moon, warm gold star, aged brass lantern with amber glass. Arrange the group to fill the square generously. " +
        NATURAL,
      ziyarah:
        "The Green Dome of Masjid an-Nabawi in Madinah. Historically accurate colours ONLY: the dome is its true deep green, sitting on a pale sandstone drum with a small crescent finial on top. Treat this as a sacred subject: dignified, simple, no stylised recolouring.",
    },
  },
];

/**
 * Image-to-image restyles, not fresh generations.
 *
 * The LQK character art (the ustazah and the two children) is a consistent
 * cast Karim has built up across the whole brand, so it is NEVER regenerated
 * from a text prompt — a fresh render would come back with different faces.
 * Instead the existing file is sent back to the model with an instruction to
 * change only the props, which arrived tinted to the old lavender palette.
 *
 * These outputs also get their white ground keyed out, which lets the pages
 * drop the `mix-blend-mode: multiply` hack they were using to fake it.
 */
const KEEP_CAST =
  "This is an existing illustration. Keep the characters EXACTLY as they are — identical faces, expressions, poses, hands, proportions, hijabs, black and cream robes, and the small gold LQK chest logo. Do not redraw, restyle or reposition them. Change ONLY what is listed below, then place the result on a completely flat pure white #FFFFFF background with no gradient, no floor and no cast shadow on the background.";

export const EDITS = [
  {
    dir: "empty",
    size: 640,
    items: {
      achievements:
        "Recolour the trophy the children are holding to polished golden brass with a dark walnut wood base, and recolour every scattered confetti star from pastel lilac/blue to warm gold. " +
        KEEP_CAST,
      hours:
        "Recolour the large alarm clock from lavender to a real alarm clock: cream enamel body, brushed steel bells and feet, a white face with black hands and black numerals. " +
        KEEP_CAST,
      ilmu:
        "Recolour the lightbulb above the book from lavender to a real bulb — clear glass with a warm amber glowing filament and a brass screw base — and give the open book cream paper pages with a brown leather cover. " +
        KEEP_CAST,
      notebook:
        "Recolour the microphone from pastel tints to a real one: brushed steel mesh head and a dark charcoal handle. Recolour the sound-wave arcs beside it to a soft warm grey. " +
        KEEP_CAST,
      packs:
        "Recolour the stack of books being carried from pastel pink/lilac/mint to natural bookcloth colours — forest green, ochre, oxblood and navy — with cream page edges. " +
        KEEP_CAST,
      reading:
        "Recolour any pastel lilac or pink accessory to a natural colour (wood, brass, cream paper or natural cloth). Leave everything else alone. " +
        KEEP_CAST,
      tracker:
        "Recolour any pastel lilac or pink accessory to a natural colour (wood, brass, cream paper or natural cloth). Leave everything else alone. " +
        KEEP_CAST,
    },
  },
  {
    dir: ".",
    size: 1200,
    square: false,
    items: {
      "hero-dashboard":
        "Recolour the crescent moon from lavender to pale bone-white with a warm sandy shadow side, and recolour the scattered stars from pastel pink/blue/lilac to warm gold. " +
        KEEP_CAST,
    },
  },
];

/** Flatten the restyles to { dir, slug, size, square, prompt, source }. */
export function allEdits() {
  return EDITS.flatMap((g) =>
    Object.entries(g.items).map(([slug, prompt]) => ({
      dir: g.dir,
      slug,
      size: g.size,
      square: g.square !== false,
      prompt,
      source: g.dir === "." ? `${slug}.png` : `${g.dir}/${slug}.png`,
    }))
  );
}

/** Flatten to a list of { dir, slug, size, prompt }. */
export function allArt() {
  return GROUPS.flatMap((g) =>
    Object.entries(g.items).map(([slug, subject]) => ({
      dir: g.dir,
      slug,
      size: g.size,
      prompt: `${subject} ${STYLE}`,
    }))
  );
}
