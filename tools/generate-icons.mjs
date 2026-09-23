/**
 * Logo et icônes de LégiWord.
 *
 * Monogramme L + W sur le dégradé de marque : les deux lettres sont posées en
 * diagonale, légèrement superposées, le L un peu plus haut que le W.
 *
 * Deux principes :
 *
 *  - Les lettres viennent des VRAIES courbes de la police du thème (Playfair
 *    Display SemiBold Italic, celle du wordmark), extraites du woff2 du kit et
 *    converties en tracés. Le SVG ne dépend donc d'aucune police installée.
 *  - Les couleurs sont lues dans juritel-design.css. Le logo suit la charte
 *    tout seul : retoucher la palette du kit et relancer ce script suffit.
 *
 *   node tools/generate-icons.mjs
 *
 * Produit assets/logo.svg (source de vérité) et les PNG du manifeste.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// fontkit v2 est un module ESM à exports nommés : pas d'export par défaut.
import { openSync as openFont } from "fontkit";
import sharp from "sharp";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(PROJECT_DIR, "assets");
const FONT = join(PROJECT_DIR, "src", "fonts", "playfair-display-italic-latin.woff2");
const DESIGN = join(PROJECT_DIR, "src", "juritel-design.css");

/* ---------- Composition ----------
   Valeurs exprimées dans une boîte de 100 × 100, ajustées à l'œil. */

/** Hauteur de capitale des lettres. */
const CAP = 34;
/** Chevauchement horizontal, en part de la largeur du L. */
const OVERLAP = 0.32;
/** Décalage vertical du W sous le L, en part de la hauteur de capitale. */
const DROP = 0.4;
/** Marge autour du monogramme, en part du côté. */
const MARGIN = 0.15;
/** Rayon des coins, en part du côté — dans l'esprit de --jt-r-xl. */
const RADIUS = 0.22;

/** Tailles émises. Le manifeste utilise 16, 32 et 80 ; 64 et 128 servent aux
    catalogues et aux futures pages publiques. */
const SIZES = [16, 32, 64, 80, 128];

/* ---------- Couleurs, lues dans le kit ---------- */

function token(css, name) {
  const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css);
  if (!match) throw new Error(`Jeton --${name} introuvable dans juritel-design.css`);
  return match[1].trim();
}

const css = readFileSync(DESIGN, "utf8");
const GRAD_A = token(css, "jt-grad-a");
const GRAD_B = token(css, "jt-grad-b");
const INK = token(css, "jt-cta-ink"); // encre posée sur le dégradé

/* ---------- Lettres ---------- */

const font = openFont(FONT);

/** Tracé d'un caractère, en unités de police, ligne de base en y = 0. */
function glyphPath(char) {
  const run = font.layout(char);
  const glyph = run.glyphs[0];
  if (!glyph) throw new Error(`Glyphe « ${char} » absent de la police`);
  return glyph.path;
}

const rawL = glyphPath("L");
const rawW = glyphPath("W");

// Hauteur de capitale mesurée sur le L lui-même : plus fiable que les
// métriques déclarées, qui incluent parfois des débordements.
const capUnits = rawL.bbox.maxY;
const scale = CAP / capUnits;

// scale(s, -s) retourne l'axe vertical : le SVG compte les y vers le bas,
// la police vers le haut.
const pathL = rawL.scale(scale, -scale);
const widthL = pathL.bbox.maxX - pathL.bbox.minX;

const pathW = rawW.scale(scale, -scale).translate(widthL * (1 - OVERLAP), CAP * DROP);

/** Boîte englobante du monogramme entier. */
function union(a, b) {
  return {
    minX: Math.min(a.bbox.minX, b.bbox.minX),
    minY: Math.min(a.bbox.minY, b.bbox.minY),
    maxX: Math.max(a.bbox.maxX, b.bbox.maxX),
    maxY: Math.max(a.bbox.maxY, b.bbox.maxY),
  };
}

const box = union(pathL, pathW);
const monoW = box.maxX - box.minX;
const monoH = box.maxY - box.minY;

// Ajustement dans la boîte, marge comprise, en conservant les proportions.
const inner = 100 * (1 - 2 * MARGIN);
const fit = Math.min(inner / monoW, inner / monoH);
const offsetX = (100 - monoW * fit) / 2 - box.minX * fit;
const offsetY = (100 - monoH * fit) / 2 - box.minY * fit;

/* ---------- SVG ---------- */

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <title>LégiWord</title>
  <defs>
    <!-- Dégradé de marque, 135° : du coin haut-gauche au coin bas-droit,
         dans l'axe de la diagonale que suivent les deux lettres. -->
    <linearGradient id="marque" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GRAD_A}"/>
      <stop offset="1" stop-color="${GRAD_B}"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="${(RADIUS * 100).toFixed(1)}" ry="${(RADIUS * 100).toFixed(1)}" fill="url(#marque)"/>
  <g transform="translate(${offsetX.toFixed(3)} ${offsetY.toFixed(3)}) scale(${fit.toFixed(5)})" fill="${INK}">
    <path d="${pathL.toSVG()}"/>
    <path d="${pathW.toSVG()}"/>
  </g>
</svg>
`;

mkdirSync(ASSETS, { recursive: true });
writeFileSync(join(ASSETS, "logo.svg"), svg, "utf8");
console.log(`écrit ${join(ASSETS, "logo.svg")}`);

/* ---------- PNG ---------- */

const buffer = Buffer.from(svg, "utf8");
await Promise.all(
  SIZES.map(async (size) => {
    const file = join(ASSETS, `icon-${size}.png`);
    await sharp(buffer, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
    console.log(`écrit ${file}`);
  })
);

console.log(`\nDégradé ${GRAD_A} → ${GRAD_B}, lettres ${INK}, police ${font.familyName} ${font.subfamilyName}.`);
