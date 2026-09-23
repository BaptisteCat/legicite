/**
 * Grammaire des commandes.
 *
 *   /art   <articles> <code>
 *   /artv  <articles> <code> <date>
 *
 * <articles> : "111-1" | "111-1, 111-2, 111-3" | "111-1 à 111-5"
 * <date>     : "2020" | "15/03/2020"
 *
 * Le tiret ne peut JAMAIS servir de separateur de plage : les numeros d'articles
 * en contiennent deja (L. 622-1-1). Seul le mot "à" delimite une plage.
 *
 * Le decoupage articles / code ne devine pas la position du code : il reconnait
 * les articles a leur forme et considere le reste comme etant le code. C'est
 * nettement plus robuste que d'essayer des suffixes de longueur croissante,
 * et cela fonctionne meme quand le code est inconnu de la table.
 */

import { normalizeArticle } from "./normalize";

export type ArticleSpec =
  | { type: "list"; numbers: string[] }
  | { type: "range"; from: string; to: string };

export type DateSpec = { type: "year"; year: number } | { type: "date"; iso: string };

export type ParseResult =
  | { ok: true; command: "art" | "artv"; articles: ArticleSpec; codeInput: string; date?: DateSpec }
  /**
   * `/citart` ne porte pas de reference : l'article a citer est celui qui vient
   * d'etre annonce dans le texte precedent. Une date reste acceptee, pour citer
   * l'article introduit dans sa version d'alors.
   */
  | { ok: true; command: "citart"; date?: DateSpec }
  | { ok: false; error: string; hint?: string };

/** Un numero d'article, prefixe de division optionnel et suffixe latin optionnel. */
const ARTICLE_RE =
  /^[LRDA]?\d+(?:-\d+)*(?:-?(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))?$/i;

/** Prefixe de division isole : "L.", "R", "D." */
const LONE_PREFIX_RE = /^[LRDA]\.?$/i;

const SEPARATORS = new Set([",", "et", "à", "a"]);
const RANGE_WORDS = new Set(["à", "a"]);

// `citart` d'abord : l'alternance est evaluee de gauche a droite et « art »
// ne doit pas emporter le morceau sur une commande plus longue.
const COMMAND_RE = /^\s*\/(citart|artv|art)\b\s*(.*)$/i;

export function isArticleToken(token: string): boolean {
  return ARTICLE_RE.test(token.replace(/\./g, ""));
}

/**
 * Decoupe la saisie en jetons, en isolant les virgules et en recollant les
 * prefixes de division separes de leur numero ("L." + "622-1" -> "L622-1").
 */
export function tokenize(input: string): string[] {
  const rough = input
    .replace(/,/g, " , ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const merged: string[] = [];
  for (let i = 0; i < rough.length; i++) {
    const token = rough[i]!;
    const next = rough[i + 1];
    if (LONE_PREFIX_RE.test(token) && next && ARTICLE_RE.test(next.replace(/\./g, ""))) {
      merged.push(normalizeArticle(token + next));
      i++;
    } else {
      merged.push(token);
    }
  }
  return merged;
}

function parseDate(token: string): DateSpec | null {
  const full = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(token);
  if (full) {
    const [, d, m, y] = full;
    const day = Number(d), month = Number(m), year = Number(y);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    // Rejette les dates impossibles du type 31/02.
    const probe = new Date(iso + "T00:00:00Z");
    if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;
    return { type: "date", iso };
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
  if (iso) return { type: "date", iso: token };

  const year = /^(\d{4})$/.exec(token);
  if (year) {
    const y = Number(year[1]);
    if (y >= 1789 && y <= 2200) return { type: "year", year: y };
  }
  return null;
}

export function parseCommand(raw: string): ParseResult {
  const m = COMMAND_RE.exec(raw);
  if (!m) return { ok: false, error: "Commande non reconnue.", hint: "Utilisez /art ou /artv." };

  const command = m[1]!.toLowerCase() as "art" | "artv" | "citart";
  const rest = (m[2] ?? "").trim();

  // `/citart` s'emploie seul : l'article est celui annonce juste avant.
  if (command === "citart") {
    if (!rest) return { ok: true, command };
    const date = parseDate(rest);
    if (!date) {
      return {
        ok: false,
        error: "/citart s'utilise seul, ou suivi d'une année ou d'une date.",
        hint: "Exemples : /citart · /citart 2020 · /citart 15/03/2020",
      };
    }
    return { ok: true, command, date };
  }

  if (!rest) {
    return {
      ok: false,
      error: "Il manque l'article et le code.",
      hint: command === "art" ? "Exemple : /art 111-1 cpen" : "Exemple : /artv 111-1 cpen 2020",
    };
  }

  let tokens = tokenize(rest);

  // La date, uniquement pour /artv, est le dernier jeton.
  let date: DateSpec | undefined;
  if (command === "artv") {
    const last = tokens[tokens.length - 1];
    const parsed = last ? parseDate(last) : null;
    if (!parsed) {
      return {
        ok: false,
        error: "La commande /artv attend une annee ou une date en fin de ligne.",
        hint: "Exemples : /artv 1353 cciv 2020 ou /artv 1353 cciv 15/03/2020",
      };
    }
    date = parsed;
    tokens = tokens.slice(0, -1);
  }

  // Position du premier jeton ressemblant a un article : tolere "cpen 111-1"
  // aussi bien que "111-1 cpen".
  const firstArticle = tokens.findIndex(isArticleToken);
  if (firstArticle === -1) {
    return {
      ok: false,
      error: "Aucun numero d'article reconnu.",
      hint: "Exemple : /art 111-1 cpen",
    };
  }

  let cursor = firstArticle;
  const consumed: string[] = [];
  while (cursor < tokens.length) {
    const token = tokens[cursor]!;
    if (isArticleToken(token) || SEPARATORS.has(token.toLowerCase())) {
      consumed.push(token);
      cursor++;
    } else {
      break;
    }
  }
  // Un separateur en fin de sequence appartient a la saisie d'articles, pas au code.
  while (consumed.length && SEPARATORS.has(consumed[consumed.length - 1]!.toLowerCase())) {
    consumed.pop();
    cursor--;
  }

  const codeInput = [...tokens.slice(0, firstArticle), ...tokens.slice(cursor)].join(" ").trim();
  if (!codeInput) {
    return {
      ok: false,
      error: "Il manque le code.",
      hint: "Exemple : /art 111-1 cpen",
    };
  }

  const isRange = consumed.some((t) => RANGE_WORDS.has(t.toLowerCase()));
  const numbers = consumed.filter((t) => !SEPARATORS.has(t.toLowerCase())).map(normalizeArticle);

  if (numbers.length === 0) {
    return { ok: false, error: "Aucun numero d'article reconnu.", hint: "Exemple : /art 111-1 cpen" };
  }

  if (isRange) {
    if (numbers.length !== 2) {
      return {
        ok: false,
        error: "Une plage attend exactement deux numeros.",
        hint: "Exemple : /art 111-1 à 111-5 cpen",
      };
    }
    return { ok: true, command, articles: { type: "range", from: numbers[0]!, to: numbers[1]! }, codeInput, ...(date ? { date } : {}) };
  }

  // Deduplique en conservant l'ordre de saisie.
  const unique = numbers.filter((n, i) => numbers.indexOf(n) === i);
  return { ok: true, command, articles: { type: "list", numbers: unique }, codeInput, ...(date ? { date } : {}) };
}

/**
 * Repere une commande complete dans le texte d'un paragraphe, pour le
 * declenchement a la frappe. On ne retient que la DERNIERE occurrence : si
 * l'utilisateur a deja du texte au-dessus, seule la commande en cours compte.
 */
export function findTrigger(paragraphText: string): { raw: string; start: number; end: number } | null {
  // On repere d'abord les DEBUTS de commande. Capturer directement jusqu'a la
  // fin de ligne ferait englober par la premiere occurrence toutes les
  // suivantes, et "la derniere commande" deviendrait la premiere.
  const starts: number[] = [];
  const re = /\/(?:citart|artv|art)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(paragraphText)) !== null) starts.push(match.index);

  const start = starts[starts.length - 1];
  if (start === undefined) return null;

  const rest = paragraphText.slice(start);
  const newline = rest.indexOf("\n");
  const raw = (newline === -1 ? rest : rest.slice(0, newline)).trimEnd();
  return { raw, start, end: start + raw.length };
}
