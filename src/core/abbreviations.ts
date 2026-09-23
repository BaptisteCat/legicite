/**
 * Resolveur d'abreviations de codes.
 *
 * Regle directrice du projet : JAMAIS d'insertion silencieuse d'un texte non confirme.
 * Le resolveur ne renvoie donc "resolved" que sur une correspondance certaine ; tout
 * le reste remonte a l'interface sous forme de choix ou de suggestions.
 *
 * Ordre de priorite :
 *   1. abreviations personnelles de l'utilisateur (ecrasement libre, cf. cahier des charges)
 *   2. collisions connues -> ambigu, jamais resolu automatiquement
 *   3. alias par defaut (exact)
 *   4. codes abroges rediriges (avec avertissement)
 *   5. correspondance approchee -> suggestions, sans insertion
 */

import { editDistance, normalizeCode } from "./normalize";
import table from "../data/abreviations-codes.json";

export interface CodeEntry {
  slug: string;
  nom: string;
  abrevAffichage: string;
  alias: string[];
}

export type CodeResolution =
  | { kind: "resolved"; code: CodeEntry; warning?: string }
  | { kind: "ambiguous"; candidates: CodeEntry[]; reason: "collision" | "approx" }
  | { kind: "unknown"; input: string; suggestions: CodeEntry[] };

/** Abreviations definies par l'utilisateur : saisie normalisee -> slug de code. */
export type CustomAbbreviations = Record<string, string>;

const CODES: CodeEntry[] = (table.codes as CodeEntry[]).slice();
const AMBIGUOUS: Record<string, string[]> = table.ambigus.entrees as Record<string, string[]>;
const REDIRECTS = table.abrogesRediriges.entrees as Record<string, { vers: string; message: string }>;

const BY_SLUG = new Map<string, CodeEntry>(CODES.map((c) => [c.slug, c]));

/**
 * Index alias -> code. Le nom complet de chaque code est indexe automatiquement :
 * inutile de lister "codedelorganisationjudiciaire" a la main dans le JSON.
 */
const BY_ALIAS = new Map<string, CodeEntry>();
for (const code of CODES) {
  for (const alias of [...code.alias, code.nom, code.abrevAffichage]) {
    const key = normalizeCode(alias);
    if (key && !BY_ALIAS.has(key)) BY_ALIAS.set(key, code);
  }
}
// Les collisions connues sont retirees de l'index direct : elles doivent toujours
// passer par la liste de choix, meme si l'une des valeurs y figurait par ailleurs.
for (const key of Object.keys(AMBIGUOUS)) BY_ALIAS.delete(normalizeCode(key));

export function allCodes(): CodeEntry[] {
  return CODES.slice();
}

export function codeBySlug(slug: string): CodeEntry | undefined {
  return BY_SLUG.get(slug);
}

export function resolveCode(input: string, custom: CustomAbbreviations = {}): CodeResolution {
  const key = normalizeCode(input);
  if (!key) return { kind: "unknown", input, suggestions: [] };

  // 1. Abreviations personnelles : prioritaires, ecrasement autorise sans restriction.
  const customSlug = custom[key];
  if (customSlug) {
    const code = BY_SLUG.get(customSlug);
    if (code) return { kind: "resolved", code };
  }

  // 2. Collisions connues (cc, cp, cpce, cs, ce, cca).
  const collision = AMBIGUOUS[key];
  if (collision) {
    const candidates = collision.map((s) => BY_SLUG.get(s)).filter((c): c is CodeEntry => !!c);
    return { kind: "ambiguous", candidates, reason: "collision" };
  }

  // 3. Alias exact.
  const exact = BY_ALIAS.get(key);
  if (exact) return { kind: "resolved", code: exact };

  // 4. Code abroge dont l'abreviation reste en usage.
  const redirect = REDIRECTS[key];
  if (redirect) {
    const code = BY_SLUG.get(redirect.vers);
    if (code) return { kind: "resolved", code, warning: redirect.message };
  }

  // 5. Correspondance approchee. Le seuil suit la longueur de la saisie :
  //    une faute sur "cciv" est plausible, trois sur "cc" ne le sont pas.
  const max = key.length <= 4 ? 1 : key.length <= 8 ? 2 : 3;
  const scored: Array<{ code: CodeEntry; d: number }> = [];
  for (const [alias, code] of BY_ALIAS) {
    const d = editDistance(key, alias, max);
    if (d <= max) {
      const seen = scored.find((s) => s.code.slug === code.slug);
      if (!seen) scored.push({ code, d });
      else if (d < seen.d) seen.d = d;
    }
  }
  scored.sort((a, b) => a.d - b.d || a.code.nom.localeCompare(b.code.nom));

  // Meme unique, une correspondance approchee n'est jamais inseree d'office :
  // elle est proposee, l'utilisateur confirme.
  return { kind: "unknown", input, suggestions: scored.slice(0, 6).map((s) => s.code) };
}

/** Liste des saisies qui declenchent obligatoirement une desambiguisation. */
export function knownCollisions(): string[] {
  return Object.keys(AMBIGUOUS);
}
