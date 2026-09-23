/**
 * Conversion du HTML renvoye par l'API Legifrance vers le format pivot.
 *
 * Volontairement sans DOMParser : la conversion doit se comporter de facon
 * identique dans Word et dans les tests, et rester verifiable ligne a ligne.
 * Le HTML de Legifrance est simple et regulier (p, br, table, ul/ol, b, i, sup),
 * un analyseur tolerant suffit largement.
 */

import { paragraph, text, type Block, type Inline, type TableBlock } from "./blocks";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  agrave: "à", acirc: "â", auml: "ä",
  ugrave: "ù", ucirc: "û", uuml: "ü",
  icirc: "î", iuml: "ï", ocirc: "ô", ouml: "ö",
  ccedil: "ç", oelig: "œ", aelig: "æ",
  laquo: "«", raquo: "»", deg: "°", euro: "€",
  hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", middot: "·", times: "×", frac12: "½",
  sup1: "¹", sup2: "²", sup3: "³",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

type Token =
  | { kind: "open"; name: string; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; value: string };

const TAG_RE = /<\/?\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;

  while ((match = TAG_RE.exec(html)) !== null) {
    if (match.index > cursor) {
      tokens.push({ kind: "text", value: html.slice(cursor, match.index) });
    }
    const name = match[1]!.toLowerCase();
    if (match[0].startsWith("</")) {
      tokens.push({ kind: "close", name });
    } else {
      tokens.push({ kind: "open", name, selfClosing: match[2] === "/" || name === "br" || name === "hr" });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < html.length) tokens.push({ kind: "text", value: html.slice(cursor) });
  return tokens;
}

const BLOCK_TAGS = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const SKIP_TAGS = new Set(["script", "style", "head"]);

interface Style {
  bold: number;
  italic: number;
  underline: number;
  superscript: number;
}

function styleOf(s: Style): Omit<Inline, "text"> {
  return {
    ...(s.bold > 0 ? { bold: true } : {}),
    ...(s.italic > 0 ? { italic: true } : {}),
    ...(s.underline > 0 ? { underline: true } : {}),
    ...(s.superscript > 0 ? { superscript: true } : {}),
  };
}

/** Espaces normalises : les retours a la ligne du HTML source ne sont pas signifiants. */
function collapse(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").replace(/ {2,}/g, " ");
}

function trimRuns(runs: Inline[]): Inline[] {
  const out = runs.filter((r) => r.text.length > 0);
  if (out.length === 0) return out;
  out[0] = { ...out[0]!, text: out[0]!.text.replace(/^[  ]+/, "") };
  const lastIndex = out.length - 1;
  out[lastIndex] = { ...out[lastIndex]!, text: out[lastIndex]!.text.replace(/[  ]+$/, "") };
  return out.filter((r) => r.text.length > 0);
}

/**
 * Convertit le HTML d'un article en blocs.
 * Chaque `<p>`, chaque `<br>` et chaque `<li>` ouvre un nouvel alinea.
 */
export function htmlToBlocks(html: string): Block[] {
  if (!html || !html.trim()) return [];

  const tokens = tokenize(html);
  const blocks: Block[] = [];

  let runs: Inline[] = [];
  const style: Style = { bold: 0, italic: 0, underline: 0, superscript: 0 };
  let heading = false;
  let skipDepth = 0;

  // Listes
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  // Tableaux
  let table: { rows: string[][]; hasHeader: boolean } | null = null;
  let row: string[] | null = null;

  const flushParagraph = () => {
    const clean = trimRuns(runs);
    runs = [];
    if (clean.length === 0) return;

    if (row) {
      row.push(clean.map((r) => r.text).join(""));
      return;
    }
    if (list) {
      list.items.push(clean);
      return;
    }
    blocks.push(paragraph(clean, heading ? "heading" : "body"));
  };

  const flushList = () => {
    if (list && list.items.length > 0) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  const flushTable = () => {
    if (table && table.rows.length > 0) {
      const block: TableBlock = { type: "table", hasHeader: table.hasHeader, rows: table.rows };
      blocks.push(block);
    }
    table = null;
    row = null;
  };

  for (const token of tokens) {
    if (token.kind === "text") {
      if (skipDepth > 0) continue;
      const value = decodeEntities(collapse(token.value));
      if (value) runs.push(text(value, styleOf(style)));
      continue;
    }

    const name = token.name;

    if (SKIP_TAGS.has(name)) {
      skipDepth += token.kind === "open" ? 1 : -1;
      if (skipDepth < 0) skipDepth = 0;
      continue;
    }
    if (skipDepth > 0) continue;

    if (token.kind === "open") {
      switch (name) {
        case "br":
          flushParagraph();
          break;
        case "b": case "strong": style.bold++; break;
        case "i": case "em": style.italic++; break;
        case "u": style.underline++; break;
        case "sup": style.superscript++; break;
        case "ul": case "ol":
          flushParagraph();
          flushList();
          list = { ordered: name === "ol", items: [] };
          break;
        case "table":
          flushParagraph();
          flushList();
          table = { rows: [], hasHeader: false };
          break;
        case "tr":
          flushParagraph();
          row = [];
          break;
        case "th":
          if (table) table.hasHeader = true;
          flushParagraph();
          break;
        case "td":
          flushParagraph();
          break;
        default:
          if (BLOCK_TAGS.has(name)) {
            flushParagraph();
            if (HEADING_TAGS.has(name)) heading = true;
          }
      }
      continue;
    }

    // token.kind === "close"
    switch (name) {
      case "b": case "strong": style.bold = Math.max(0, style.bold - 1); break;
      case "i": case "em": style.italic = Math.max(0, style.italic - 1); break;
      case "u": style.underline = Math.max(0, style.underline - 1); break;
      case "sup": style.superscript = Math.max(0, style.superscript - 1); break;
      case "th": case "td":
        flushParagraph();
        if (row && runs.length === 0 && row.length === 0) row.push("");
        break;
      case "tr":
        flushParagraph();
        if (table && row) table.rows.push(row);
        row = null;
        break;
      case "table":
        flushParagraph();
        flushTable();
        break;
      case "ul": case "ol":
        flushParagraph();
        flushList();
        break;
      default:
        if (BLOCK_TAGS.has(name)) {
          flushParagraph();
          if (HEADING_TAGS.has(name)) heading = false;
        }
    }
  }

  flushParagraph();
  flushList();
  flushTable();

  return blocks;
}

/**
 * Le texte d'un article peut arriver sans balise (texte brut avec sauts de
 * ligne). On produit alors un alinea par ligne non vide.
 */
export function articleTextToBlocks(raw: string): Block[] {
  if (!raw) return [];
  if (/<[a-z]/i.test(raw)) return htmlToBlocks(raw);
  return raw
    .split(/\r?\n/)
    .map((line) => decodeEntities(line).trim())
    .filter((line) => line.length > 0)
    .map((line) => paragraph(line, "body"));
}
