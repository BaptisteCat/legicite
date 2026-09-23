/**
 * Composition d'une citation a partir d'un style parametrable.
 *
 * Chaque element — intitule, mention de version, guillemets, reference courte,
 * mention de source — est active et mis en forme independamment. Les
 * preselections (bloc, inline, note, brut) ne sont que des jeux de valeurs de
 * ce meme modele.
 *
 * L'abreviation d'AFFICHAGE du code (« C. pen. ») est utilisee ici, distincte
 * de l'abreviation de SAISIE (« cpen »).
 */

import type { CodeEntry } from "./abbreviations";
import { paragraph, text, type Block, type Inline, type ParagraphFormat } from "./blocks";
import { cmToPt, type CitationStyle } from "./citation-style";
import { displayArticle } from "./normalize";
import { formatDateFr, type ArticleVersion } from "./versions";

/** Espace insecable, exigee par la typographie francaise a l'interieur des guillemets. */
const NBSP = " ";

const QUOTES = {
  francais: { open: "«" + NBSP, close: NBSP + "»" },
  anglais: { open: "“", close: "”" },
  aucun: { open: "", close: "" },
} as const;

export interface ArticleData {
  /** Identifiant LEGIARTI de la version citee. */
  id: string;
  /** Numero normalise, « L622-1 ». */
  num: string;
  code: CodeEntry;
  /** Contenu de l'article, deja converti en blocs. */
  blocks: Block[];
  version: ArticleVersion;
}

export interface CitationOptions {
  style: CitationStyle;
  /** Date a laquelle la version a ete recuperee. */
  extractedAt?: string;
}

export interface CitationRender {
  blocks: Block[];
  /** Texte de la note de bas de page, si le style en produit une. */
  footnote?: string;
}

const SHORT_MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juill.", "août", "sept.", "oct.", "nov.", "déc."];

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${SHORT_MONTHS[Number(m) - 1] ?? m} ${y}`;
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/** « Article 111-1 du code pénal » */
export function longReference(data: ArticleData): string {
  return `Article ${displayArticle(data.num)} du ${lowerFirst(data.code.nom)}`;
}

/** « C. pén., art. 111-1 » */
export function shortReference(data: ArticleData): string {
  return `${data.code.abrevAffichage}, art.${NBSP}${displayArticle(data.num)}`;
}

function versionMention(version: ArticleVersion, complete: boolean): string {
  const date = formatDateFr(version.dateDebut);
  if (!complete) return date;
  return version.dateFin === null
    ? `version en vigueur depuis le ${date}`
    : `version en vigueur au ${date}`;
}

/** Traduit la mise en page du style en format de paragraphe, en points. */
function layoutFormat(style: CitationStyle): ParagraphFormat {
  const { layout } = style;
  const format: ParagraphFormat = {};

  if (layout.resetStyle) format.resetStyle = true;
  if (layout.indent) format.leftIndentPt = cmToPt(layout.indentCm);
  if (layout.firstLineIndent) format.firstLineIndentPt = cmToPt(layout.firstLineIndentCm);
  if (layout.spaceBeforeCm > 0) format.spaceBeforePt = cmToPt(layout.spaceBeforeCm);
  if (layout.spaceAfterCm > 0) format.spaceAfterPt = cmToPt(layout.spaceAfterCm);
  if (layout.alignment === "justifie") format.alignment = "justified";
  if (layout.alignment === "gauche") format.alignment = "left";
  if (layout.fontSizePt !== null) format.fontSizePt = layout.fontSizePt;
  if (layout.fontName !== null) format.fontName = layout.fontName;
  if (layout.lineSpacing !== null) format.lineSpacing = layout.lineSpacing;

  return format;
}

function styleRuns(runs: Inline[], italic: boolean, bold: boolean): Inline[] {
  if (!italic && !bold) return runs;
  return runs.map((run) => ({
    ...run,
    ...(italic ? { italic: true } : {}),
    ...(bold ? { bold: true } : {}),
  }));
}

/** Indices des paragraphes de corps, seuls concernes par les guillemets. */
function bodyIndexes(blocks: Block[]): number[] {
  return blocks
    .map((block, i) => (block.type === "paragraph" && block.role === "body" ? i : -1))
    .filter((i) => i >= 0);
}

function applyTextStyle(blocks: Block[], style: CitationStyle, format: ParagraphFormat): Block[] {
  const quotes = QUOTES[style.text.quotes];
  const indexes = bodyIndexes(blocks);
  const first = indexes[0];
  const last = indexes[indexes.length - 1];

  return blocks.map((block, i) => {
    if (block.type !== "paragraph") return block;

    let runs = styleRuns(block.runs, style.text.italic, style.text.bold);

    if (quotes.open && block.role === "body") {
      // Les guillemets prennent la casse du texte : cocher « texte en italique »
      // doit produire une citation entierement en italique, guillemets compris.
      const mark = {
        ...(style.text.italic ? { italic: true } : {}),
        ...(style.text.bold ? { bold: true } : {}),
      };
      const opensHere = i === first || style.text.quoteEachAlinea;
      if (opensHere) runs = [text(quotes.open, mark), ...runs];
      if (i === last) runs = [...runs, text(quotes.close, mark)];
    }

    return { ...block, runs, format: { ...format, ...(block.format ?? {}) } };
  });
}

function appendToLastParagraph(blocks: Block[], addition: Inline[]): Block[] {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block && block.type === "paragraph") {
      const copy = blocks.slice();
      copy[i] = { ...block, runs: [...block.runs, ...addition] };
      return copy;
    }
  }
  return blocks;
}

function sourceText(options: CitationOptions): string {
  return options.style.reference.withExtractionDate && options.extractedAt
    ? `source Légifrance, consulté le ${formatDateShort(options.extractedAt)}`
    : "source Légifrance";
}

export function renderCitation(data: ArticleData, options: CitationOptions): CitationRender {
  const style = options.style;
  const format = layoutFormat(style);

  const headingText = style.heading.form === "long" ? longReference(data) : shortReference(data);
  const headingStyle = {
    ...(style.heading.bold ? { bold: true } : {}),
    ...(style.heading.italic ? { italic: true } : {}),
    ...(style.heading.underline ? { underline: true } : {}),
  };

  const versionText = versionMention(data.version, style.version.complete);
  const versionDisplay = style.version.parentheses ? `(${versionText})` : versionText;

  let blocks = applyTextStyle(data.blocks, style, format);

  /* --- Intitule --- */
  if (style.heading.include) {
    if (style.heading.ownParagraph) {
      blocks = [paragraph([text(headingText, headingStyle)], "heading", format), ...blocks];
    } else {
      const firstBody = blocks.findIndex((b) => b.type === "paragraph");
      if (firstBody >= 0) {
        const block = blocks[firstBody] as Extract<Block, { type: "paragraph" }>;
        blocks = blocks.slice();
        blocks[firstBody] = {
          ...block,
          runs: [text(headingText, headingStyle), text(" : "), ...block.runs],
        };
      }
    }
  }

  /* --- Mention de version --- */
  if (style.version.include && style.version.placement === "sousIntitule") {
    const versionParagraph = paragraph(
      [text(versionDisplay, style.version.italic ? { italic: true } : {})],
      "meta",
      format
    );
    // Juste apres l'intitule s'il existe, en tete sinon.
    const at = style.heading.include && style.heading.ownParagraph ? 1 : 0;
    blocks = [...blocks.slice(0, at), versionParagraph, ...blocks.slice(at)];
  }

  /* --- Reference courte accolee au texte --- */
  if (style.reference.inlineAfterText) {
    blocks = appendToLastParagraph(blocks, [text(` (${shortReference(data)})`)]);
  }

  /* --- Mention de version en fin de texte --- */
  if (style.version.include && style.version.placement === "finTexte") {
    blocks = appendToLastParagraph(blocks, [
      text(` ${versionDisplay}`, style.version.italic ? { italic: true } : {}),
    ]);
  }

  /* --- Mention de source dans le corps --- */
  if (style.reference.source === "corps") {
    const label = `Source : ${sourceText(options).replace(/^source /, "")}.`;
    blocks = [...blocks, paragraph([text(label.charAt(0).toUpperCase() + label.slice(1), { italic: true })], "meta", format)];
  }

  /* --- Note de bas de page --- */
  const footnoteParts: string[] = [];
  if (style.reference.source === "note" || style.version.placement === "note") {
    footnoteParts.push(shortReference(data));
    if (style.version.include && style.version.placement === "note") footnoteParts.push(versionText);
    if (style.reference.source === "note") footnoteParts.push(sourceText(options));
  }

  return {
    blocks,
    ...(footnoteParts.length > 0 ? { footnote: footnoteParts.join(", ") + "." } : {}),
  };
}

/**
 * Rendu d'une citation groupee.
 * L'intitule peut etre force pour chaque article : sans lui, une suite de
 * citations devient illisible.
 */
export function renderGroup(items: ArticleData[], options: CitationOptions): CitationRender[] {
  const multiple = items.length > 1;
  const style = options.style;

  const effective: CitationStyle =
    multiple && style.group.forceHeadingWhenMultiple && !style.heading.include
      ? { ...style, heading: { ...style.heading, include: true, ownParagraph: true } }
      : style;

  return items.map((item, index) => {
    const rendered = renderCitation(item, { ...options, style: effective });
    const isLast = index === items.length - 1;

    if (multiple && style.group.blankLineBetween && !isLast) {
      return { ...rendered, blocks: [...rendered.blocks, paragraph([], "body")] };
    }
    return rendered;
  });
}
