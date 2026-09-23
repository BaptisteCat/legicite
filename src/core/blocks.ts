/**
 * Modele de contenu intermediaire entre le HTML renvoye par Legifrance et
 * l'insertion dans Word.
 *
 * On ne passe pas directement du HTML a Word : le format pivot permet de
 * tester la conversion sans Word, et d'appliquer les modeles de citation
 * (bloc / inline / note / brut) sur une structure deja propre.
 */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  superscript?: boolean;
}

export type ParagraphRole = "heading" | "meta" | "quote" | "body";

/**
 * Mise en forme de paragraphe, en POINTS — l'unite de l'API Word.
 * Un champ absent signifie « ne pas toucher » : le paragraphe conserve alors
 * le style du document d'accueil, ce qui est le comportement souhaite par
 * defaut pour une citation.
 */
export interface ParagraphFormat {
  /**
   * Repart du style Normal du document et efface couleur et surlignage herites.
   * A reserver aux cas ou la citation suit un titre ou un paragraphe fortement
   * mis en forme.
   */
  resetStyle?: boolean;
  leftIndentPt?: number;
  firstLineIndentPt?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
  alignment?: "left" | "justified";
  fontSizePt?: number;
  fontName?: string;
  lineSpacing?: number;
}

export interface ParagraphBlock {
  type: "paragraph";
  role: ParagraphRole;
  runs: Inline[];
  /** Niveau d'indentation, pour les alineas imbriques. */
  indent?: number;
  format?: ParagraphFormat;
}

export interface ListBlock {
  type: "list";
  ordered: boolean;
  items: Inline[][];
}

/**
 * Les cellules sont du texte simple : l'API Word insere un tableau a partir
 * d'un `string[][]`, la mise en forme intra-cellule n'est pas transmissible
 * a l'insertion et serait a reappliquer cellule par cellule.
 */
export interface TableBlock {
  type: "table";
  hasHeader: boolean;
  rows: string[][];
}

export type Block = ParagraphBlock | ListBlock | TableBlock;

export function text(value: string, style: Omit<Inline, "text"> = {}): Inline {
  return { text: value, ...style };
}

export function paragraph(
  runs: Inline[] | string,
  role: ParagraphRole = "body",
  format?: ParagraphFormat
): ParagraphBlock {
  const list = typeof runs === "string" ? [text(runs)] : runs;
  return { type: "paragraph", role, runs: list, ...(format ? { format } : {}) };
}

/** Texte brut d'un bloc, utilise pour les seuils de longueur et les apercus. */
export function blockToPlainText(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return block.runs.map((r) => r.text).join("");
    case "list":
      return block.items.map((item) => item.map((r) => r.text).join("")).join("\n");
    case "table":
      return block.rows.map((row) => row.join("\t")).join("\n");
  }
}

export function blocksToPlainText(blocks: Block[]): string {
  return blocks.map(blockToPlainText).join("\n");
}

export function countCharacters(blocks: Block[]): number {
  return blocksToPlainText(blocks).length;
}

/**
 * Ne conserve que les `n` premiers alineas (paragraphes de corps), en
 * signalant la coupure. Sert a l'option "premiers alineas" proposee sur les
 * articles longs.
 */
export function firstAlineas(blocks: Block[], n: number): Block[] {
  const out: Block[] = [];
  let seen = 0;
  for (const block of blocks) {
    if (block.type === "paragraph" && block.role === "body") {
      if (seen >= n) break;
      seen++;
    }
    out.push(block);
  }
  if (out.length < blocks.length) out.push(paragraph("[…]", "body"));
  return out;
}
