#!/usr/bin/env python3
"""Derive traceable letter geometry for the Huruf games from the Mirza font.

This is an OFFLINE AUTHORING TOOL. It is not part of `next build`, it is not
imported by any page, and the portal never runs Python. It is committed because
its output — public/huruf/geometry.json — is generated data that someone
will eventually need to regenerate (a different font, a corrected stroke, a new
letter), and a generated file whose generator was thrown away is a file nobody
dares touch.

    pip install fonttools numpy scipy scikit-image
    python3 scripts/huruf-geometry.py

WHY GENERATE RATHER THAN HAND-DRAW

A tracing game needs two different geometries of the same letter:

  1. The OUTLINE — the real calligraphic shape, swelling and tapering, which is
     what the child sees at rest and what the letter blooms into on completion.
     This has to be the same shape as the printed flashcards or the child is
     learning two alphabets.
  2. The CENTRELINE — a single even-width path running down the middle of that
     shape, which is what the finger follows. A calligraphic outline is a poor
     thing to trace: a 4-year-old cannot tell where the middle of a stroke that
     is 8px at one end and 60px at the other is meant to be.

Hand-drawing 28 centrelines in SVG coordinates produces 28 letters that are each
slightly wrong in a different way. Instead both come from Mirza-Regular.ttf, the
font on the flashcards: the outline straight from the glyph, and the centreline
as the morphological skeleton (medial axis) of that same glyph, so it is exactly
the middle by construction.

HOW

For each letter's isolated form:

  glyph outline → normalise into a 1000x1000 box → rasterise (scanline, nonzero
  winding, matching how a font renderer fills) → split into connected components
  → the big ones are body strokes, the small ones are dots → skeletonise each
  body → walk the skeleton as a graph, split it at junctions into branches,
  prune the spurs skeletonisation leaves at stroke ends → order the branches
  right-to-left, the direction Arabic is written → simplify and smooth.

The junction handling is what gives correct multi-stroke letters for free: ط is
a body plus an upright, ك a body plus its inner mark, and each falls out of the
branch decomposition as its own stroke in writing order rather than needing to
be special-cased.
"""

import json
import math
import pathlib
import sys

import numpy as np
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont
from scipy import ndimage
from skimage.morphology import skeletonize

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = ROOT / "brand" / "fonts" / "Mirza-Regular.ttf"
OUT = ROOT / "public" / "huruf" / "geometry.json"

# The 28 huruf in the order of the LQK flashcard deck, keyed by the same ids
# lib/games/huruf.js uses. Only the isolated form is traced; the positional
# forms are shown as reference type, not traced, so they need no geometry.
LETTERS = [
    ("alif", "ا"), ("ba", "ب"), ("ta", "ت"), ("tsa", "ث"), ("jim", "ج"),
    ("ha", "ح"), ("kho", "خ"), ("dal", "د"), ("dzal", "ذ"), ("ro", "ر"),
    ("zay", "ز"), ("sin", "س"), ("syin", "ش"), ("shod", "ص"), ("dhod", "ض"),
    ("tho", "ط"), ("zho", "ظ"), ("ain", "ع"), ("ghoin", "غ"), ("fa", "ف"),
    ("qof", "ق"), ("kaf", "ك"), ("lam", "ل"), ("mim", "م"), ("nun", "ن"),
    ("hha", "ه"), ("wau", "و"), ("ya", "ي"),
]

# WHICH END DOES A CHILD START FROM
#
# Geometry gives the path; it cannot give the writing direction, because that is
# a fact about how Arabic is taught, not about the shape. The default is the
# right-hand end, Arabic being written right to left. These are the letters that
# genuinely start at the other end: the ج family and the ‘ain family all begin
# at the top-left of the head stroke and finish at the bottom-right tail.
#
# This table and UPRIGHT_LAST below are the only hand-authored facts in this
# file. If an ustazah says a letter starts at the wrong end, it is one word here
# and a re-run — no geometry to redraw.
REVERSE_FIRST_STROKE = {"jim", "ha", "kho", "ain", "ghoin"}

# ط and ظ are one connected shape, so the skeleton comes out as a single path
# that runs down the upright and on around the bowl. They are not written that
# way: the bowl is drawn first and the upright added last, the same order as
# dotting a letter after its body.
UPRIGHT_LAST = {"tho", "zho"}

BOX = 1000        # viewBox the portal renders these in
MARGIN = 60       # keeps the glow halo inside the box
RASTER = 512      # skeletonisation resolution; 512 resolves Mirza's thin joins

# A component this much smaller than the letter's body is a mark — a dot or
# kaf's inner stroke — not part of the body. Measured across all 28 letters in
# Mirza the gap is unambiguous: every body is 1.00 and every mark 0.16 or less.
MARK_AREA_RATIO = 0.30
# Among marks, a dot is a blob and kaf's inner stroke is a line. Dots fill half
# their bounding box (0.50-0.56 measured); kaf's mark fills a third (0.32).
DOT_FILL_RATIO = 0.42
# A dot cluster is one connected blob in this font — ت's pair rasterises as a
# single 124x69 component. Width this many times the height means more than one
# dot, and the blob is split evenly across its width.
DOT_SPLIT_ASPECT = 1.6
# Skeletonisation frays the end of a wide stroke into short spurs. Anything
# under this fraction of the component's main path is that fraying, not a
# stroke a child should be asked to trace.
SPUR_RATIO = 0.22


# ---------------------------------------------------------------- glyph outline

def flatten_quad(p0, p1, p2, steps=8):
    """Quadratic bezier → points. TrueType curves are all quadratic."""
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return out


def flatten_cubic(p0, p1, p2, p3, steps=10):
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        ))
    return out


def glyph_contours(font, char):
    """Flattened contours of a character's glyph, in font units, y up.

    Flattened rather than kept as curves because everything downstream — the
    bounding box, the rasteriser, the emitted path — wants points, and one
    flattening at 12-16 steps per segment is already finer than the 512px
    raster can resolve.
    """
    cmap = font.getBestCmap()
    if ord(char) not in cmap:
        raise SystemExit(f"{char!r} is not in {FONT.name}")
    # Decomposing, because most dotted letters are composites in Mirza: ب is
    # the beh body plus a referenced dot glyph, and a plain RecordingPen would
    # hand back two addComponent calls and no outline at all.
    glyphs = font.getGlyphSet()
    pen = DecomposingRecordingPen(glyphs)
    glyphs[cmap[ord(char)]].draw(pen)

    contours, cur, start = [], [], None
    for op, args in pen.value:
        if op == "moveTo":
            if cur:
                contours.append(cur)
            start = args[0]
            cur = [start]
        elif op == "lineTo":
            cur.append(args[0])
        elif op == "qCurveTo":
            # Last point is on-curve (or None for an all-off-curve contour).
            pts = list(args)
            on = pts.pop()
            if on is None:
                # Implied on-curve points: midpoints of consecutive off-curves.
                on = ((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2)
            prev = cur[-1]
            # Consecutive off-curve points imply on-curve midpoints between them.
            for i, ctrl in enumerate(pts):
                nxt = on if i == len(pts) - 1 else (
                    (ctrl[0] + pts[i + 1][0]) / 2, (ctrl[1] + pts[i + 1][1]) / 2)
                cur.extend(flatten_quad(prev, ctrl, nxt))
                prev = nxt
        elif op == "curveTo":
            prev = cur[-1]
            pts = list(args)
            while len(pts) >= 3:
                c1, c2, end = pts[:3]
                cur.extend(flatten_cubic(prev, c1, c2, end))
                prev = end
                pts = pts[3:]
        elif op == "closePath":
            if cur:
                contours.append(cur)
                cur = []
    if cur:
        contours.append(cur)
    return [c for c in contours if len(c) >= 3]


def normalise(contours):
    """Fit contours into the BOX, y flipped for SVG, aspect preserved."""
    xs = [p[0] for c in contours for p in c]
    ys = [p[1] for c in contours for p in c]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    span = BOX - 2 * MARGIN
    scale = span / max(w, h)
    # Centre the glyph in the box so every letter shares one coordinate frame —
    # the trace layer and the bloom layer must land on top of each other.
    ox = MARGIN + (span - w * scale) / 2
    oy = MARGIN + (span - h * scale) / 2
    return [[(ox + (x - min(xs)) * scale,
              BOX - (oy + (y - min(ys)) * scale)) for x, y in c] for c in contours]


def path_of(contours, precision=0):
    out = []
    for c in contours:
        out.append(f"M{c[0][0]:.{precision}f} {c[0][1]:.{precision}f}")
        out += [f"L{x:.{precision}f} {y:.{precision}f}" for x, y in c[1:]]
        out.append("Z")
    return "".join(out)


# ------------------------------------------------------------------ rasterising

def rasterise(contours, size=RASTER):
    """Fill contours into a boolean mask using the nonzero winding rule.

    Nonzero rather than even-odd because that is what a font renderer uses, and
    the difference is visible: ه and م have counters that even-odd would punch
    out correctly but ص's overlapping construction it would not.
    """
    s = size / BOX
    edges = []
    for c in contours:
        pts = [(x * s, y * s) for x, y in c]
        for i in range(len(pts)):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % len(pts)]
            if y1 != y2:
                edges.append((x1, y1, x2, y2))

    mask = np.zeros((size, size), dtype=bool)
    for row in range(size):
        y = row + 0.5
        hits = []
        for x1, y1, x2, y2 in edges:
            if (y1 <= y < y2) or (y2 <= y < y1):
                t = (y - y1) / (y2 - y1)
                hits.append((x1 + t * (x2 - x1), 1 if y2 > y1 else -1))
        if not hits:
            continue
        hits.sort()
        wind = 0
        for i, (x, d) in enumerate(hits[:-1]):
            wind += d
            if wind != 0:
                a = max(0, int(math.ceil(x - 0.5)))
                b = min(size - 1, int(math.floor(hits[i + 1][0] - 0.5)))
                if b >= a:
                    mask[row, a:b + 1] = True
    return mask


# -------------------------------------------------------------- skeleton → path

NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def skeleton_branches(skel):
    """Split a skeleton into branches at its junctions.

    Returns a list of pixel chains. A chain runs endpoint→junction,
    junction→junction or endpoint→endpoint; a skeleton that is a pure loop (ه,
    و — letters with a closed counter) has neither, and is cut at its rightmost
    pixel so there is somewhere to start tracing.
    """
    pix = {(r, c) for r, c in zip(*np.nonzero(skel))}
    if not pix:
        return []

    def nbrs(p):
        return [(p[0] + dr, p[1] + dc) for dr, dc in NEIGHBOURS
                if (p[0] + dr, p[1] + dc) in pix]

    deg = {p: len(nbrs(p)) for p in pix}
    nodes = {p for p in pix if deg[p] != 2}

    if not nodes:  # pure loop: cut it open at the rightmost pixel
        nodes = {max(pix, key=lambda p: (p[1], -p[0]))}

    branches, seen = [], set()
    for node in nodes:
        for first in nbrs(node):
            if (node, first) in seen:
                continue
            chain, prev, cur = [node, first], node, first
            seen.add((node, first))
            while cur not in nodes:
                nxt = [p for p in nbrs(cur) if p != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                chain.append(cur)
            seen.add((cur, chain[-2]))
            if len(chain) > 1:
                branches.append(chain)
    return branches


def chain_length(chain):
    return sum(math.dist(chain[i], chain[i + 1]) for i in range(len(chain) - 1))


def longest_through_path(branches):
    """The longest single path through the branch graph — the letter's main stroke.

    A letter like ط skeletonises into three branches meeting at one junction.
    The main stroke is not any one branch but the longest way through them, so
    the child traces the body in one continuous motion and the upright is left
    over as a second stroke.
    """
    if not branches:
        return None, []
    adj = {}
    for i, b in enumerate(branches):
        adj.setdefault(b[0], []).append((i, False))
        adj.setdefault(b[-1], []).append((i, True))

    best, best_len = None, -1.0
    for start in adj:
        # Longest simple path from this node, depth-first. Branch graphs here
        # have at most a handful of edges, so exhaustive is free.
        stack = [(start, frozenset(), [], 0.0)]
        while stack:
            node, used, seq, dist = stack.pop()
            if dist > best_len:
                best, best_len = list(seq), dist
            for idx, reverse in adj[node]:
                if idx in used:
                    continue
                b = branches[idx]
                stack.append((
                    b[0] if reverse else b[-1],
                    used | {idx},
                    seq + [(idx, reverse)],
                    dist + chain_length(b),
                ))

    pixels = []
    for idx, reverse in best:
        chain = branches[idx][::-1] if reverse else branches[idx]
        pixels += chain[1:] if pixels else chain
    return pixels, [i for i, _ in best]


def rdp(points, epsilon):
    """Ramer-Douglas-Peucker. A skeleton is one pixel per step; unsimplified it
    would emit 400-point paths whose stroke length is dominated by staircase
    noise, which makes the trace progress meter jitter."""
    if len(points) < 3:
        return list(points)
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    norm = math.hypot(dx, dy)
    worst, wi = -1.0, 0
    for i in range(1, len(points) - 1):
        p = points[i]
        d = (abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / norm) if norm else math.dist(p, a)
        if d > worst:
            worst, wi = d, i
    if worst <= epsilon:
        return [a, b]
    return rdp(points[:wi + 1], epsilon)[:-1] + rdp(points[wi:], epsilon)


def smooth_path(points, precision=1):
    """Points → SVG path, Catmull-Rom converted to cubic beziers.

    Straight line segments between simplified points would read as a polygon;
    children are tracing curves, and the guide has to look like one.
    """
    if len(points) < 2:
        return ""
    if len(points) == 2:
        (x0, y0), (x1, y1) = points
        return f"M{x0:.{precision}f} {y0:.{precision}f}L{x1:.{precision}f} {y1:.{precision}f}"

    d = [f"M{points[0][0]:.{precision}f} {points[0][1]:.{precision}f}"]
    for i in range(len(points) - 1):
        p0 = points[i - 1] if i > 0 else points[0]
        p1, p2 = points[i], points[i + 1]
        p3 = points[i + 2] if i + 2 < len(points) else points[-1]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(
            f"C{c1[0]:.{precision}f} {c1[1]:.{precision}f}"
            f" {c2[0]:.{precision}f} {c2[1]:.{precision}f}"
            f" {p2[0]:.{precision}f} {p2[1]:.{precision}f}")
    return "".join(d)


# ------------------------------------------------------------------- per letter

def is_upright(chain):
    """A tall, narrow, top-reaching branch — ط's and ظ's standing stroke."""
    rows = [p[0] for p in chain]
    cols = [p[1] for p in chain]
    height = max(rows) - min(rows)
    width = max(cols) - min(cols)
    return height > 2.5 * max(width, 1) and height > 0.3 * RASTER


def strokes_of_component(mask, upright_last=False):
    """Ordered trace strokes for one connected blob of ink."""
    skel = skeletonize(mask)
    branches = skeleton_branches(skel)
    if not branches:
        return []

    uprights = []
    if upright_last:
        # Pull the standing stroke out before the main path is computed, so the
        # longest-path search cannot run through it and swallow it.
        uprights = [b for b in branches if is_upright(b)]
        rest = [b for b in branches if b not in uprights]
        if uprights and rest:
            branches = rest
        else:
            uprights = []

    main, used = longest_through_path(branches)
    if not main:
        return []
    main_len = chain_length(main)

    # Branches left over after the main path are real extra strokes (ط's
    # upright) if they are substantial, and skeletonisation fraying if not.
    extras = [b for i, b in enumerate(branches)
              if i not in used and chain_length(b) > SPUR_RATIO * main_len]

    out = []
    for chain in [main] + extras + uprights:
        # Arabic is written right to left, so a stroke starts at its right end.
        if chain[-1][1] > chain[0][1]:
            chain = chain[::-1]
        # An upright is written downwards, whichever side of the letter it is on.
        if chain in uprights and chain[-1][0] < chain[0][0]:
            chain = chain[::-1]
        out.append(chain)
    return out


def to_box(pixels):
    """Raster (row, col) → viewBox (x, y)."""
    s = BOX / RASTER
    return [((c + 0.5) * s, (r + 0.5) * s) for r, c in pixels]


def split_dots(comp):
    """One dot-cluster component → one entry per dot.

    ت's two dots and ق's two dots each rasterise as a single wide blob, and a
    game that highlights "the dots" one at a time needs them separately.
    """
    rows, cols = np.nonzero(comp)
    bw = cols.max() - cols.min() + 1
    bh = rows.max() - rows.min() + 1
    n = max(1, round(bw / bh)) if bh else 1
    s = BOX / RASTER
    out = []
    for i in range(n):
        lo = cols.min() + i * bw / n
        hi = cols.min() + (i + 1) * bw / n
        sel = (cols >= lo) & (cols < hi) if i < n - 1 else (cols >= lo)
        if not sel.any():
            continue
        area = int(sel.sum())
        out.append({
            "cx": round(float(cols[sel].mean() + 0.5) * s, 1),
            "cy": round(float(rows[sel].mean() + 0.5) * s, 1),
            "r": round(float(math.sqrt(area / math.pi)) * s, 1),
        })
    return out


def build(font, key, char):
    contours = normalise(glyph_contours(font, char))
    mask = rasterise(contours)
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=int))

    comps = []
    for label in range(1, count + 1):
        comp = labels == label
        comps.append((int(comp.sum()), comp))
    largest = max(a for a, _ in comps)

    bodies, dots = [], []
    for area, comp in comps:
        if area >= largest * MARK_AREA_RATIO:
            bodies.append((comp, float(np.nonzero(comp)[1].max())))
            continue
        rows, cols = np.nonzero(comp)
        bw = cols.max() - cols.min() + 1
        bh = rows.max() - rows.min() + 1
        if area / (bw * bh) >= DOT_FILL_RATIO:
            dots += split_dots(comp)
        else:
            # A mark that is a line rather than a blob — kaf's inner stroke.
            # It is traced, but after the body, so it goes on the end.
            bodies.append((comp, -math.inf))

    # Right-most body first: that is the one a right-to-left hand reaches first.
    bodies.sort(key=lambda t: -t[1])

    paths = []
    for comp, _ in bodies:
        for chain in strokes_of_component(comp, upright_last=key in UPRIGHT_LAST):
            pts = rdp(to_box(chain), epsilon=3.0)
            if len(pts) >= 2:
                paths.append(pts)

    if paths and key in REVERSE_FIRST_STROKE:
        paths[0] = paths[0][::-1]

    # `d` is what the browser draws; `points` is the same stroke as a polyline,
    # which is what the tracing maths projects a finger onto (lib/games/trace.js).
    # Both are emitted so the runtime never has to measure an SVG path with
    # getPointAtLength: no DOM read, no effect, and the hit-testing geometry is
    # plain data that can be unit-tested.
    strokes = [{
        "d": smooth_path(pts),
        "points": [[round(x, 1), round(y, 1)] for x, y in pts],
        "start": [round(pts[0][0], 1), round(pts[0][1], 1)],
        "end": [round(pts[-1][0], 1), round(pts[-1][1], 1)],
    } for pts in paths]

    # Dots are placed right to left too, and after the body — you write the
    # letter, then you dot it.
    dots.sort(key=lambda d: -d["cx"])

    return {
        "char": char,
        "outline": path_of(contours),
        "strokes": strokes,
        "dots": dots,
    }


def main():
    if not FONT.exists():
        sys.exit(f"missing {FONT} — see brand/fonts/OFL.txt for the source")
    font = TTFont(FONT)
    letters = {}
    for key, char in LETTERS:
        letters[key] = build(font, key, char)
        g = letters[key]
        print(f"  {key:6s} {char}  strokes={len(g['strokes'])} dots={len(g['dots'])}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "note": "Generated by scripts/huruf-geometry.py from Mirza-Regular.ttf. Do not edit by hand.",
        "viewBox": f"0 0 {BOX} {BOX}",
        "letters": letters,
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"\n{OUT.relative_to(ROOT)}  {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
