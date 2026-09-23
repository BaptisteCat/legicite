/**
 * Acces au contenu du document : selection courante et parcours des paragraphes.
 */

export interface ParagraphInfo {
  id: string;
  text: string;
  index: number;
}

/** Texte actuellement selectionne, chaine vide si simple point d'insertion. */
export async function getSelectedText(): Promise<string> {
  let value = "";
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load("text");
    await context.sync();
    value = selection.text ?? "";
  });
  return value.trim();
}

/** Tous les paragraphes du document, dans l'ordre. */
export async function getParagraphs(): Promise<ParagraphInfo[]> {
  const out: ParagraphInfo[] = [];
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items/text,items/uniqueLocalId");
    await context.sync();
    paragraphs.items.forEach((p, index) => {
      out.push({ id: p.uniqueLocalId, text: p.text, index });
    });
  });
  return out;
}

/** Texte integral du document, paragraphes separes par des sauts de ligne. */
export async function getDocumentText(): Promise<string> {
  const paragraphs = await getParagraphs();
  return paragraphs.map((p) => p.text).join("\n");
}

/**
 * Lit les paragraphes qui precedent le point d'insertion, du plus proche au
 * plus lointain.
 *
 * Les proxys sont chaines puis charges en une seule synchronisation : lire
 * cinq paragraphes coute donc un seul aller-retour avec Word, et non cinq.
 * On evite surtout de parcourir tout le document, dont le cout croit avec la
 * taille du dossier.
 */
export async function readParagraphsBeforeSelection(count: number): Promise<ParagraphInfo[]> {
  const out: ParagraphInfo[] = [];

  await Word.run(async (context) => {
    let current: Word.Paragraph = context.document.getSelection().paragraphs.getFirst();
    const proxies: Word.Paragraph[] = [];

    for (let i = 0; i < count; i++) {
      current = current.getPreviousOrNullObject();
      current.load("text,uniqueLocalId,isNullObject");
      proxies.push(current);
    }

    await context.sync();

    proxies.forEach((paragraph, index) => {
      if (paragraph.isNullObject) return;
      out.push({ id: paragraph.uniqueLocalId, text: paragraph.text, index });
    });
  });

  return out;
}

/** Amene un paragraphe a l'ecran et le selectionne. */
export async function selectParagraph(id: string): Promise<boolean> {
  let found = false;
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items/uniqueLocalId");
    await context.sync();
    const target = paragraphs.items.find((p) => p.uniqueLocalId === id);
    if (!target) return;
    target.select();
    found = true;
    await context.sync();
  });
  return found;
}

/** Selectionne la premiere occurrence d'un texte dans le document. */
export async function selectText(needle: string): Promise<boolean> {
  let found = false;
  await Word.run(async (context) => {
    const results = context.document.body.search(needle, { matchCase: false });
    results.load("items");
    await context.sync();
    const first = results.items[0];
    if (!first) return;
    first.select();
    found = true;
    await context.sync();
  });
  return found;
}
