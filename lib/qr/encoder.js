/* A byte-mode QR encoder, written here rather than pulled in as a dependency.

   The portal needs to PRINT QR codes (a family's pass, the door poster) on the
   server, inside a React tree, with no canvas and no network round-trip. Every
   packaged encoder either ships a browser canvas API, a CommonJS build that
   fights Turbopack's externalisation, or 40× more code than the one thing
   wanted here. This produces a boolean matrix; `qrSvg` turns that into an
   inline <svg> with a single <path>, which prints crisply at any size and
   costs one DOM node.

   Scope is deliberately narrow: byte mode, error-correction level M, versions
   1–10 (up to 213 bytes). Every URL this app encodes is well under 80
   characters. Anything longer throws rather than silently truncating — a QR
   that encodes half a URL scans fine and goes nowhere.

   Level M (~15% recovery) over L: these get printed on paper, taped to a wall,
   and scanned in a hall under bad light by a phone held at an angle. */

// EC level M only. [ecCodewordsPerBlock, group1Blocks, group1Data, group2Blocks, group2Data]
const RS_BLOCKS_M = [
  null,
  [10, 1, 16, 0, 0], // 1
  [16, 1, 28, 0, 0], // 2
  [26, 1, 44, 0, 0], // 3
  [18, 2, 32, 0, 0], // 4
  [24, 2, 43, 0, 0], // 5
  [16, 4, 27, 0, 0], // 6
  [18, 4, 31, 0, 0], // 7
  [22, 2, 38, 2, 39], // 8
  [22, 3, 36, 2, 37], // 9
  [26, 4, 43, 1, 44], // 10
];

// Row/column centres of the alignment patterns, per version.
const ALIGNMENT = [
  null,
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const MAX_VERSION = 10;

/* ---- GF(256), the Reed-Solomon field ------------------------------------ */
// Primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D), as the QR spec fixes.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

// The generator polynomial for `degree` EC codewords: ∏ (x - 2^i).
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLength) {
  const gen = rsGenerator(ecLength);
  const remainder = new Uint8Array(ecLength);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[ecLength - 1] = 0;
    for (let i = 0; i < ecLength; i++) {
      remainder[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return remainder;
}

/* ---- BCH, for the format and version strips ----------------------------- */
function bch(value, poly, bits) {
  let result = value << bits;
  const polyBits = 32 - Math.clz32(poly);
  while (32 - Math.clz32(result) >= polyBits) {
    result ^= poly << (32 - Math.clz32(result) - polyBits);
  }
  return (value << bits) | result;
}

// 5 data bits (2 EC level + 3 mask) + 10 BCH, XOR'd with the spec's mask so an
// all-zero format never reads as a valid one.
function formatBits(mask) {
  return bch(0b00 /* level M */ * 8 + mask, 0x537, 10) ^ 0x5412;
}

// 6 version bits + 12 BCH. Only versions 7+ carry this strip.
function versionBits(version) {
  return bch(version, 0x1f25, 12);
}

/* ---- capacity ----------------------------------------------------------- */
function totalDataCodewords(version) {
  const [, g1, d1, g2, d2] = RS_BLOCKS_M[version];
  return g1 * d1 + g2 * d2;
}

// Byte mode: 4 mode bits + a character count that widens at version 10.
function charCountBits(version) {
  return version < 10 ? 8 : 16;
}

function capacityBytes(version) {
  const bits = totalDataCodewords(version) * 8 - 4 - charCountBits(version);
  return Math.floor(bits / 8);
}

function pickVersion(byteLength) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (byteLength <= capacityBytes(v)) return v;
  }
  return null;
}

/* ---- data encoding ------------------------------------------------------ */
function buildCodewords(bytes, version) {
  const capacity = totalDataCodewords(version);
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, charCountBits(version));
  for (const b of bytes) push(b, 8);

  // Terminator, then pad to a whole byte.
  const capacityBits = capacity * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(capacity);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data[i / 8] = byte;
  }
  // Pad bytes alternate 0xEC / 0x11 — again fixed by the spec, not arbitrary.
  for (let i = bits.length / 8; i < capacity; i++) {
    data[i] = i % 2 === bits.length / 8 % 2 ? 0xec : 0x11;
  }
  return data;
}

/* Split into RS blocks, encode each, then INTERLEAVE. The interleave is what
   makes a smudge survivable: consecutive modules on the symbol belong to
   different blocks, so physical damage is spread thin across all of them
   instead of destroying one block outright. */
function interleave(data, version) {
  const [ecLen, g1, d1, g2, d2] = RS_BLOCKS_M[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1; i++) {
    blocks.push(data.subarray(offset, offset + d1));
    offset += d1;
  }
  for (let i = 0; i < g2; i++) {
    blocks.push(data.subarray(offset, offset + d2));
    offset += d2;
  }
  const ecBlocks = blocks.map((b) => rsEncode(b, ecLen));

  const out = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

/* ---- matrix ------------------------------------------------------------- */
function placeFunctionPatterns(size, version) {
  // null = free for data; true/false = a fixed module already decided.
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));

  const setFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onRing = inRing && (r === 0 || r === 6 || c === 0 || c === 6);
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[rr][cc] = onRing || inCore;
      }
    }
  };
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  // Timing patterns: the alternating rulers the decoder measures the grid with.
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Alignment patterns, skipping the three that would sit on a finder.
  const centres = ALIGNMENT[version];
  for (const r of centres) {
    for (const c of centres) {
      const nearFinder =
        (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          matrix[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        }
      }
    }
  }

  // The dark module — one permanently black square the spec pins in place.
  matrix[size - 8][8] = true;

  // Reserve the format strips (filled in after masking).
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = false;
    if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = false;
  }

  return matrix;
}

function reserveVersionInfo(matrix, size, version) {
  if (version < 7) return;
  for (let i = 0; i < 18; i++) {
    const r = Math.floor(i / 3);
    const c = i % 3;
    matrix[size - 11 + c][r] = false;
    matrix[r][size - 11 + c] = false;
  }
}

/* Data walks UP and DOWN two-module-wide columns from the bottom-right,
   skipping the vertical timing column. `reserved` marks every module the
   function patterns own, so the walk only ever lands on free ones. */
function placeData(matrix, reserved, size, codewords) {
  let bitIndex = 0;
  const nextBit = () => {
    const byte = codewords[bitIndex >> 3];
    const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit === 1;
  };

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the timing column is not part of the walk
    for (let vert = 0; vert < size; vert++) {
      const row = upward ? size - 1 - vert : vert;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (reserved[row][col]) continue;
        matrix[row][col] = nextBit();
      }
    }
    upward = !upward;
  }
}

function maskAt(mask, row, col) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/* The spec's four penalty rules, scoring how hard a masked symbol is to read.
   Runs of five+, 2×2 blocks, finder-lookalike sequences, and a light/dark
   imbalance all cost points; the lowest total wins. */
function penalty(matrix, size) {
  let score = 0;

  const runScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < size; i++) {
      if (line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) total += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };

  const patternA = [true, false, true, true, true, false, true, false, false, false, false];
  const patternB = [false, false, false, false, true, false, true, true, true, false, true];
  const hasPattern = (line, at, pattern) => {
    for (let i = 0; i < 11; i++) if (line[at + i] !== pattern[i]) return false;
    return true;
  };

  let dark = 0;
  for (let r = 0; r < size; r++) {
    const row = matrix[r];
    const col = matrix.map((line) => line[r]);
    score += runScore(row) + runScore(col);
    for (let c = 0; c <= size - 11; c++) {
      if (hasPattern(row, c, patternA) || hasPattern(row, c, patternB)) score += 40;
      if (hasPattern(col, c, patternA) || hasPattern(col, c, patternB)) score += 40;
    }
    for (let c = 0; c < size; c++) if (row[c]) dark++;
  }

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) score += 3;
    }
  }

  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

function writeFormat(matrix, size, mask) {
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const bit = ((bits >> i) & 1) === 1;
    // Copy one: down the left edge and along the top, hopping the timing row.
    if (i < 6) matrix[i][8] = bit;
    else if (i < 8) matrix[i + 1][8] = bit;
    else matrix[size - 15 + i][8] = bit;
    // Copy two, so a damaged corner still yields the format.
    if (i < 8) matrix[8][size - 1 - i] = bit;
    else matrix[8][14 - i] = bit;
  }
}

function writeVersion(matrix, size, version) {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >> i) & 1) === 1;
    const r = Math.floor(i / 3);
    const c = i % 3;
    matrix[size - 11 + c][r] = bit;
    matrix[r][size - 11 + c] = bit;
  }
}

/**
 * Encode `text` as a QR symbol.
 * @returns {{ size: number, modules: boolean[][], version: number }}
 */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  const version = pickVersion(bytes.length);
  if (!version) {
    throw new Error(
      `qrMatrix: ${bytes.length} bytes exceeds the ${capacityBytes(MAX_VERSION)}-byte ceiling of this encoder`,
    );
  }

  const size = version * 4 + 17;
  const base = placeFunctionPatterns(size, version);
  reserveVersionInfo(base, size, version);
  // Snapshot of which modules are spoken for BEFORE any data lands.
  const reserved = base.map((row) => row.map((v) => v !== null));

  const codewords = interleave(buildCodewords(bytes, version), version);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = base.map((row) => row.slice());
    placeData(candidate, reserved, size, codewords);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && maskAt(mask, r, c)) candidate[r][c] = !candidate[r][c];
      }
    }
    writeFormat(candidate, size, mask);
    writeVersion(candidate, size, version);
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { score, modules: candidate };
  }

  return { size, version, modules: best.modules.map((row) => row.map(Boolean)) };
}

/**
 * The symbol as an inline SVG string: one <path> of 1×1 squares on a 4-module
 * quiet zone. Sized in CSS by the caller, so it stays sharp at poster scale.
 *
 * `title` becomes an accessible name — a QR is a link, and a screen reader
 * meeting a bare graphic has nothing to announce.
 */
export function qrSvg(text, { title = "QR code", className = "" } = {}) {
  const { size, modules } = qrMatrix(text);
  const quiet = 4;
  const extent = size + quiet * 2;

  let path = "";
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!modules[r][c]) {
        c++;
        continue;
      }
      // Merge each horizontal run into one rect — roughly a third the path data.
      let run = 1;
      while (c + run < size && modules[r][c + run]) run++;
      path += `M${c + quiet} ${r + quiet}h${run}v1h-${run}z`;
      c += run;
    }
  }

  return { viewBox: `0 0 ${extent} ${extent}`, path, title, className, size: extent };
}
