/**
 * Detection des references d'articles dans du texte redige.
 *
 * Sert deux fonctions du cahier des charges :
 *   - le volet de consultation, sur une selection (§8)
 *   - la verification du document, sur l'ensemble du texte (§9)
 *
 * Elle travaille sur le texte VISIBLE, sans marqueur ni metadonnee : elle
 * reconnait donc aussi bien les references redigees a la main que celles
 * inserees par l'extension.
 *
 * Deux tournures sont couvertes :
 *   1. "l'article 1353 du Code civil"        (code apres le numero)
 *   2. "C. civ., art. 1353"                  (code avant le numero)
 */

import { resolveCode, type CodeResolution, type CustomAbbreviations } from "./abbreviations";
import { normalizeArticle } from "./normalize";

export interface DetectedReference {
  /** Texte exact repere dans le document. */
  raw: string;
  start: number;
  end: number;
  /** Numeros normalises ("L622-1"). Plusieurs si "articles 1353 et 1354". */
  numbers: string[];
  /** Designation du code telle qu'ecrite dans le texte. */
  codeInput: string;
  resolution: CodeResolution;
}

/** Un ou plusieurs numeros enchaines par des virgules ou "et". */
const NUM = String.raw`[LRDA]?\.?\s?\d+(?:-\d+)*(?:\s?(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))?`;
const NUM_LIST = String.raw`${NUM}(?:\s*(?:,|et)\s*${NUM})*`;

/** "article 1353", "art. L. 622-1", "articles 1353 et 1354" */
const FORWARD_RE = new RegExp(String.raw`\bart(?:icle)?s?\.?\s*(${NUM_LIST})`, "gi");

/** Amorces qui relient le numero au code : "du", "de la", "de l'", "des". */
const LINKER_RE = /^\s*(?:du|de\s+la|de\s+l['’]|des|,)\s*/i;

/** Nombre maximal de mots testes comme designation de code apres le numero. */
const MAX_CODE_WORDS = 7;

function splitNumbers(list: string): string[] {
  return list
    .split(/\s*(?:,|\bet\b)\s*/i)
    .map((n) => normalizeArticle(n))
    .filter((n) => n.length > 0);
}

/**
 * Tente de lire une designation de code a partir de `text`, en essayant des
 * fenetres de mots decroissantes. La plus longue qui se resout gagne : cela
 * evite qu'un "code" isole l'emporte sur "code de commerce".
 */
function readCodeAfter(
  text: string,
  custom: CustomAbbreviations
): { codeInput: string; resolution: CodeResolution; length: number } | null {
  const linker = LINKER_RE.exec(text);
  const offset = linker ? linker[0].length : 0;
  const after = text.slice(offset);

  const words = after.split(/\s+/).filter(Boolean).slice(0, MAX_CODE_WORDS);
  for (let n = words.length; n >= 1; n--) {
    const candidate = words.slice(0, n).join(" ").replace(/[.,;:)]+$/, "");
    if (!candidate) continue;
    const resolution = resolveCode(candidate, custom);
    if (resolution.kind === "resolved" || resolution.kind === "ambiguous") {
      const idx = after.indexOf(candidate);
      return { codeInput: candidate, resolution, length: offset + (idx >= 0 ? idx : 0) + candidate.length };
    }
  }
  return null;
}

/**
 * Cherche une designation de code AVANT le numero, dans la tournure
 * "C. civ., art. 1353". On remonte au plus MAX_CODE_WORDS mots.
 */
function readCodeBefore(
  text: string,
  custom: CustomAbbreviations
): { codeInput: string; resolution: CodeResolution; start: number } | null {
  const trimmed = text.replace(/[\s,;:(]+$/, "");
  const words = trimmed.split(/\s+/).filter(Boolean);
  for (let n = 1; n <= Math.min(MAX_CODE_WORDS, words.length); n++) {
    const candidate = words.slice(words.length - n).join(" ");
    const resolution = resolveCode(candidate, custom);
    if (resolution.kind === "resolved") {
      const start = trimmed.lastIndexOf(candidate);
      return { codeInput: candidate, resolution, start: start >= 0 ? start : text.length };
    }
  }
  return null;
}

/**
 * Repere toutes les references d'un texte. Les references dont le code reste
 * introuvable sont conservees avec `resolution.kind === "unknown"` : la
 * verification du document doit pouvoir les signaler comme non resolues.
 */
export function detectReferences(text: string, custom: CustomAbbreviations = {}): DetectedReference[] {
  const found: DetectedReference[] = [];
  FORWARD_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FORWARD_RE.exec(text)) !== null) {
    const numbers = splitNumbers(match[1]!);
    if (numbers.length === 0) continue;

    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    const after = readCodeAfter(text.slice(matchEnd, matchEnd + 120), custom);
    if (after) {
      found.push({
        raw: text.slice(matchStart, matchEnd + after.length),
        start: matchStart,
        end: matchEnd + after.length,
        numbers,
        codeInput: after.codeInput,
        resolution: after.resolution,
      });
      continue;
    }

    const before = readCodeBefore(text.slice(Math.max(0, matchStart - 80), matchStart), custom);
    if (before) {
      const absoluteStart = Math.max(0, matchStart - 80) + before.start;
      found.push({
        raw: text.slice(absoluteStart, matchEnd),
        start: absoluteStart,
        end: matchEnd,
        numbers,
        codeInput: before.codeInput,
        resolution: before.resolution,
      });
      continue;
    }

    found.push({
      raw: match[0],
      start: matchStart,
      end: matchEnd,
      numbers,
      codeInput: "",
      resolution: { kind: "unknown", input: "", suggestions: [] },
    });
  }

  return dedupe(found);
}

/**
 * Supprime les references imbriquees ou dupliquees, en gardant la plus longue
 * a position egale.
 */
function dedupe(refs: DetectedReference[]): DetectedReference[] {
  const sorted = refs.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const out: DetectedReference[] = [];
  for (const ref of sorted) {
    const previous = out[out.length - 1];
    if (previous && ref.start < previous.end) continue;
    out.push(ref);
  }
  return out;
}

export interface IntroducedReferences {
  /** References trouvees dans le paragraphe retenu. */
  references: DetectedReference[];
  /** Distance en paragraphes : 0 = le paragraphe immediatement precedent. */
  distance: number;
  /** Texte du paragraphe retenu, pour pouvoir l'afficher a l'utilisateur. */
  source: string;
}

/**
 * Cherche l'article annonce par la phrase introductive, pour la commande
 * `/citart`.
 *
 * `paragraphs` est ordonne du plus proche au plus lointain. On s'arrete au
 * PREMIER paragraphe contenant une reference, meme si son code n'est pas
 * resolu : remonter plus loin reviendrait a citer un article que l'utilisateur
 * n'a pas introduit, ce qui serait pire qu'un message d'erreur.
 *
 *   « L'article 121-5 du code pénal dispose que : »  ->  121-5, code penal
 */
export function findIntroducedReferences(
  paragraphs: string[],
  custom: CustomAbbreviations = {}
): IntroducedReferences | null {
  for (let distance = 0; distance < paragraphs.length; distance++) {
    const text = paragraphs[distance] ?? "";
    if (text.trim().length === 0) continue;

    const references = detectReferences(text, custom);
    if (references.length > 0) return { references, distance, source: text.trim() };
  }
  return null;
}

/**
 * Variante pour le clic droit : sur une selection, on veut au moins une
 * reference meme si l'utilisateur n'a selectionne que "1353 du Code civil"
 * sans le mot "article".
 */
export function detectInSelection(selection: string, custom: CustomAbbreviations = {}): DetectedReference[] {
  const direct = detectReferences(selection, custom);
  if (direct.length > 0) return direct;

  const bare = new RegExp(String.raw`^\s*(${NUM_LIST})\s*(.*)$`, "i").exec(selection);
  if (!bare) return [];
  const numbers = splitNumbers(bare[1]!);
  if (numbers.length === 0) return [];

  const after = readCodeAfter(bare[2] ?? "", custom);
  if (!after) return [];

  return [
    {
      raw: selection.trim(),
      start: 0,
      end: selection.length,
      numbers,
      codeInput: after.codeInput,
      resolution: after.resolution,
    },
  ];
}
