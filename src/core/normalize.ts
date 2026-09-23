/**
 * Normalisation des saisies.
 *
 * Deux normalisations distinctes, a ne jamais confondre :
 *  - normalizeCode    : agressive (supprime tirets et points) pour les abreviations de codes
 *  - normalizeArticle : conservatrice (garde les tirets) car ils font partie du numero
 */

const SUFFIXES = /(bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies)$/i;

/**
 * Supprime les diacritiques. `\p{Mn}` cible les marques combinatoires, qui sont
 * exactement ce que produit la decomposition NFD sur un texte accentue.
 */
export function stripAccents(input: string): string {
  return input.normalize("NFD").replace(/\p{Mn}/gu, "");
}

/**
 * Normalise une abreviation de code : minuscules, sans accents, sans points,
 * espaces, tirets, apostrophes ni virgules.
 *
 *   "C. civ."           -> "cciv"
 *   "Code de l'énergie" -> "codedelenergie"
 */
export function normalizeCode(input: string): string {
  return stripAccents(input.toLowerCase())
    .replace(/['’]/g, "")
    .replace(/[.\s\-_,]/g, "");
}

/**
 * Normalise un numero d'article en forme compacte.
 * Les tirets sont significatifs (L. 622-1-1) et sont donc conserves.
 *
 *   "L. 622-1"  -> "L622-1"
 *   "l 622 - 1" -> "L622-1"
 *   "111-1"     -> "111-1"
 */
export function normalizeArticle(input: string): string {
  const compact = stripAccents(input.trim())
    .replace(/\s*-\s*/g, "-")
    .replace(/[.\s]/g, "");
  return compact
    .replace(/^([lrda])/i, (m) => m.toUpperCase())
    .replace(SUFFIXES, (m) => m.toLowerCase());
}

/** Forme lisible d'un numero d'article : "L622-1" -> "L. 622-1". */
export function displayArticle(num: string): string {
  return num.replace(/^([LRDA])(\d)/, "$1. $2");
}

/**
 * Distance de Levenshtein bornee : renvoie `max + 1` des que le seuil est depasse,
 * ce qui evite de derouler la matrice complete pour des chaines eloignees.
 */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
      rowMin = Math.min(rowMin, current[j]!);
    }
    if (rowMin > max) return max + 1;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length]!;
}
