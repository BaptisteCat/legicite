/**
 * Generation des icones PNG du manifeste (16, 32, 80 px).
 *
 * Encodeur PNG minimal ecrit a la main : zlib est dans la bibliotheque standard
 * de Node, le reste tient en une centaine de lignes, et cela evite d'ajouter
 * une dependance de build pour trois images.
 *
 *   node tools/generate-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

/* ---------- encodeur PNG ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** `pixels` : Uint8Array RGBA de taille width * height * 4. */
function encodePng(width, height, pixels) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filtre "None"
    pixels.copy
      ? pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4)
      : Buffer.from(pixels.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- dessin ---------- */

const ACCENT = [28, 78, 128];
const PAPER = [255, 255, 255];

/**
 * Un carre arrondi bleu, portant trois lignes blanches evoquant un texte et un
 * liseré plus clair sur la premiere : une page de code, lisible a 16 px.
 */
function draw(size) {
  const pixels = Buffer.alloc(size * size * 4, 0);
  const radius = Math.max(2, Math.round(size * 0.18));

  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  };

  const insideRounded = (x, y) => {
    const nx = x < radius ? radius - x : x >= size - radius ? x - (size - radius - 1) : 0;
    const ny = y < radius ? radius - y : y >= size - radius ? y - (size - radius - 1) : 0;
    return nx * nx + ny * ny <= radius * radius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (insideRounded(x, y)) set(x, y, ACCENT);
    }
  }

  // Trois lignes de "texte", la premiere plus courte pour figurer un titre.
  const margin = Math.round(size * 0.22);
  const thickness = Math.max(1, Math.round(size * 0.09));
  const gap = Math.max(1, Math.round(size * 0.13));
  const widths = [0.38, 0.56, 0.56];

  let y = margin;
  for (const ratio of widths) {
    const lineWidth = Math.round((size - margin * 2) * (ratio / 0.56));
    for (let dy = 0; dy < thickness; dy++) {
      for (let dx = 0; dx < lineWidth; dx++) set(margin + dx, y + dy, PAPER);
    }
    y += thickness + gap;
  }

  return encodePng(size, size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 80]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, draw(size));
  console.log(`ecrit ${file}`);
}
