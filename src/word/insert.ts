/**
 * Insertion des blocs dans le document.
 *
 * Deux principes :
 *
 *  - La structure est reproduite fidelement : un paragraphe Word par alinea,
 *    un vrai tableau par tableau, une vraie liste par liste.
 *  - La mise en forme n'est appliquee que si le style de citation la demande
 *    explicitement. Un champ absent de ParagraphFormat signifie « ne pas
 *    toucher » : la citation suit alors le style du document d'accueil.
 *
 * Performance : chaque `context.sync()` est un aller-retour avec Word et coute
 * plusieurs dizaines de millisecondes. On charge donc tout ce dont on a besoin
 * en une seule fois, et on ne synchronise qu'aux points ou c'est indispensable.
 */

import type { Block, Inline, ParagraphFormat } from "../core/blocks";

/**
 * Applique la casse d'un run de facon ABSOLUE.
 *
 * Word fait heriter au texte insere la mise en forme du point d'insertion. Se
 * contenter d'activer les attributs demandes laissait donc passer ceux de
 * l'environnement : une citation posee a la suite d'une phrase en gras
 * ressortait en gras, par-dessus les reglages.
 *
 * Chaque attribut est donc ecrit explicitement, y compris a `false`. Le gras et
 * l'italique etant des cases a cocher dans les reglages, leur valeur est celle
 * voulue par l'utilisateur, jamais celle du voisinage. Les attributs NON
 * configurables (couleur, surlignage, police) restent herites : c'est ce qui
 * permet a la citation de suivre la charte du document.
 */
function applyRunStyle(range: Word.Range, run: Inline): void {
  range.font.bold = run.bold === true;
  range.font.italic = run.italic === true;
  range.font.underline = run.underline ? Word.UnderlineType.single : Word.UnderlineType.none;
  range.font.superscript = run.superscript === true;
}

/** Ecrit les runs dans un paragraphe deja cree, en stylant chaque segment. */
function writeRuns(paragraph: Word.Paragraph, runs: Inline[]): void {
  for (const run of runs) {
    if (!run.text) continue;
    const range = paragraph.insertText(run.text, Word.InsertLocation.end);
    applyRunStyle(range, run);
  }
}

function applyParagraphFormat(paragraph: Word.Paragraph, format?: ParagraphFormat): void {
  if (!format) return;

  // Repli complet : utile quand la citation suit un titre ou un paragraphe
  // fortement mis en forme, dont elle heriterait couleur, corps et espacements.
  if (format.resetStyle) {
    try {
      paragraph.styleBuiltIn = Word.BuiltInStyleName.normal;
      // Word accepte null pour retirer le surlignage, ce que ses typages
      // n'expriment pas : ils declarent la propriete en `string`.
      (paragraph.font as unknown as { highlightColor: string | null }).highlightColor = null;
    } catch {
      /* style indisponible : la mise en forme des runs reste appliquee */
    }
  }

  if (format.leftIndentPt !== undefined) paragraph.leftIndent = format.leftIndentPt;
  if (format.firstLineIndentPt !== undefined) paragraph.firstLineIndent = format.firstLineIndentPt;
  if (format.spaceBeforePt !== undefined) paragraph.spaceBefore = format.spaceBeforePt;
  if (format.spaceAfterPt !== undefined) paragraph.spaceAfter = format.spaceAfterPt;
  if (format.lineSpacing !== undefined) paragraph.lineSpacing = format.lineSpacing;
  if (format.alignment === "justified") paragraph.alignment = Word.Alignment.justified;
  if (format.alignment === "left") paragraph.alignment = Word.Alignment.left;
  if (format.fontSizePt !== undefined) paragraph.font.size = format.fontSizePt;
  if (format.fontName !== undefined) paragraph.font.name = format.fontName;
}

/**
 * Insere une suite de blocs apres `anchor`, et renvoie le dernier paragraphe
 * insere pour permettre le chainage. Aucune synchronisation n'est faite ici :
 * l'appelant decide quand payer l'aller-retour.
 */
function insertBlocksAfter(context: Word.RequestContext, anchor: Word.Paragraph, blocks: Block[]): Word.Paragraph {
  let cursor = anchor;

  for (const block of blocks) {
    switch (block.type) {
      case "paragraph": {
        const paragraph = cursor.insertParagraph("", Word.InsertLocation.after);
        writeRuns(paragraph, block.runs);
        applyParagraphFormat(paragraph, block.format);
        cursor = paragraph;
        break;
      }

      case "list": {
        let first: Word.Paragraph | null = null;
        for (const item of block.items) {
          const paragraph = cursor.insertParagraph("", Word.InsertLocation.after);
          writeRuns(paragraph, item);
          cursor = paragraph;
          if (!first) first = paragraph;
        }
        if (first) {
          try {
            const list = first.startNewList();
            if (block.ordered) list.setLevelNumbering(0, Word.ListNumbering.arabic);
            else list.setLevelBullet(0, Word.ListBullet.solid);
          } catch {
            /* liste non appliquee, contenu preserve */
          }
        }
        break;
      }

      case "table": {
        if (block.rows.length === 0) break;
        const columns = Math.max(...block.rows.map((row) => row.length));
        const values = block.rows.map((row) => {
          const filled = row.slice();
          while (filled.length < columns) filled.push("");
          return filled;
        });
        const holder = cursor.insertParagraph("", Word.InsertLocation.after);
        const table = holder.insertTable(values.length, columns, Word.InsertLocation.after, values);
        table.headerRowCount = block.hasHeader ? 1 : 0;
        table.styleBuiltIn = Word.BuiltInStyleName.gridTable1Light;
        holder.delete();
        // On repart d'un paragraphe place APRES le tableau. Reprendre a la fin
        // du corps du document expedierait la suite de l'article a la fin du
        // fichier, loin de la citation.
        cursor = table.insertParagraph("", Word.InsertLocation.after);
        break;
      }
    }
  }

  return cursor;
}

/** Ajoute une note de bas de page, avec repli si l'API n'est pas disponible. */
function addFootnote(cursor: Word.Paragraph, footnote: string): boolean {
  try {
    // insertFootnote exige WordApi 1.5.
    cursor.getRange(Word.RangeLocation.end).insertFootnote(footnote);
    return true;
  } catch {
    const fallback = cursor.insertParagraph(footnote, Word.InsertLocation.after);
    fallback.font.italic = true;
    fallback.font.size = 9;
    return false;
  }
}

export interface InsertOptions {
  footnote?: string;
}

export interface InsertReport {
  ok: boolean;
  footnoteInserted: boolean;
  warning?: string;
}

/**
 * Insere une citation au point d'insertion courant.
 * Deux synchronisations seulement : une pour lire le paragraphe d'ancrage,
 * une pour valider l'ensemble des ecritures.
 */
export async function insertCitation(blocks: Block[], options: InsertOptions = {}): Promise<InsertReport> {
  if (blocks.length === 0) return { ok: false, footnoteInserted: false, warning: "Rien à insérer." };

  let footnoteInserted = false;
  let warning: string | undefined;

  await Word.run(async (context) => {
    const paragraphs = context.document.getSelection().paragraphs;
    // Le texte est charge avec les items : une seule synchronisation suffit.
    paragraphs.load("items/text");
    await context.sync();

    const anchor = paragraphs.items[paragraphs.items.length - 1];
    if (!anchor) {
      warning = "Impossible de déterminer le point d'insertion.";
      return;
    }

    // Le premier bloc prend la place du paragraphe courant s'il est vide, pour
    // ne pas laisser une ligne blanche avant la citation.
    let remaining = blocks;
    const firstBlock = blocks[0];
    if (anchor.text.trim() === "" && firstBlock && firstBlock.type === "paragraph") {
      writeRuns(anchor, firstBlock.runs);
      applyParagraphFormat(anchor, firstBlock.format);
      remaining = blocks.slice(1);
    }

    const cursor = insertBlocksAfter(context, anchor, remaining);
    if (options.footnote) footnoteInserted = addFootnote(cursor, options.footnote);

    await context.sync();
  });

  if (options.footnote && !footnoteInserted) {
    warning =
      "Les notes de bas de page ne sont pas disponibles dans cette version de Word : " +
      "la référence a été insérée en fin de citation.";
  }

  return { ok: true, footnoteInserted, ...(warning ? { warning } : {}) };
}

/**
 * Remplace le texte de la commande par la citation, pour le declenchement
 * `/art` tape dans le document.
 *
 * On ne parcourt pas tout le document : apres validation par Entree, le point
 * d'insertion se trouve dans le paragraphe SUIVANT celui de la commande. On
 * remonte donc d'un paragraphe depuis la selection, ce qui est en temps
 * constant, au lieu de charger les milliers de paragraphes d'un dossier.
 */
export async function replaceTriggerAndInsert(
  paragraphId: string,
  triggerText: string,
  blocks: Block[],
  options: InsertOptions = {}
): Promise<InsertReport> {
  let report: InsertReport = { ok: false, footnoteInserted: false };

  await Word.run(async (context) => {
    const selectionParagraph = context.document.getSelection().paragraphs.getFirst();
    const previous = selectionParagraph.getPreviousOrNullObject();
    previous.load("text,uniqueLocalId,isNullObject");
    await context.sync();

    let target: Word.Paragraph | null = null;

    if (!previous.isNullObject && previous.uniqueLocalId === paragraphId) {
      target = previous;
    } else {
      // L'utilisateur a bouge entre la frappe et la reponse de l'API : on
      // retombe sur une recherche dans le document, plus couteuse mais sure.
      const found = context.document.body.paragraphs;
      found.load("items/uniqueLocalId,items/text");
      await context.sync();
      target = found.items.find((p) => p.uniqueLocalId === paragraphId) ?? null;
    }

    if (!target) {
      report = { ok: false, footnoteInserted: false, warning: "Paragraphe de la commande introuvable." };
      return;
    }

    // On efface la commande en reecrivant le paragraphe : plus rapide et plus
    // sur qu'une recherche de texte, et cela evite un aller-retour de plus.
    const cleaned = target.text.replace(triggerText, "").trim();
    target.clear();

    let cursor: Word.Paragraph = target;
    let remaining = blocks;
    const firstBlock = blocks[0];

    if (cleaned.length > 0) {
      // Du texte precedait la commande : on le conserve et on insere apres.
      target.insertText(cleaned, Word.InsertLocation.start);
    } else if (firstBlock && firstBlock.type === "paragraph") {
      writeRuns(target, firstBlock.runs);
      applyParagraphFormat(target, firstBlock.format);
      remaining = blocks.slice(1);
    }

    cursor = insertBlocksAfter(context, cursor, remaining);
    const footnoteInserted = options.footnote ? addFootnote(cursor, options.footnote) : false;

    await context.sync();
    report = { ok: true, footnoteInserted };
  });

  return report;
}
