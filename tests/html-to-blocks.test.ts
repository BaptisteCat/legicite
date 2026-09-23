import { describe, expect, it } from "vitest";
import { blocksToPlainText, countCharacters, firstAlineas } from "../src/core/blocks";
import { articleTextToBlocks, decodeEntities, htmlToBlocks } from "../src/core/html-to-blocks";

describe("decodeEntities", () => {
  it("decode les entites nommees et numeriques", () => {
    expect(decodeEntities("l&#39;article &laquo;&nbsp;X&nbsp;&raquo;")).toBe("l'article « X »");
    expect(decodeEntities("p&eacute;nal &amp; civil")).toBe("pénal & civil");
    expect(decodeEntities("&#x2019;")).toBe("’");
  });

  it("laisse intacte une sequence inconnue", () => {
    expect(decodeEntities("&pasunentite;")).toBe("&pasunentite;");
  });
});

describe("htmlToBlocks", () => {
  it("produit un alinea par paragraphe", () => {
    const blocks = htmlToBlocks("<p>Premier alinéa.</p><p>Deuxième alinéa.</p>");
    expect(blocks).toHaveLength(2);
    expect(blocksToPlainText(blocks)).toBe("Premier alinéa.\nDeuxième alinéa.");
  });

  it("traite <br> comme une rupture d'alinea", () => {
    const blocks = htmlToBlocks("Premier.<br/>Deuxième.");
    expect(blocks).toHaveLength(2);
  });

  it("conserve le gras et l'italique", () => {
    const blocks = htmlToBlocks("<p>Un texte <b>gras</b> et <i>italique</i>.</p>");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    if (block.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(block.runs.find((r) => r.text === "gras")?.bold).toBe(true);
    expect(block.runs.find((r) => r.text === "italique")?.italic).toBe(true);
  });

  it("reproduit les listes", () => {
    const blocks = htmlToBlocks("<ul><li>Premier</li><li>Second</li></ul>");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    if (block.type !== "list") throw new Error("liste attendue");
    expect(block.ordered).toBe(false);
    expect(block.items).toHaveLength(2);
  });

  it("distingue les listes ordonnees", () => {
    const blocks = htmlToBlocks("<ol><li>Un</li></ol>");
    const block = blocks[0]!;
    if (block.type !== "list") throw new Error("liste attendue");
    expect(block.ordered).toBe(true);
  });

  it("reproduit les tableaux, en-tete comprise", () => {
    const blocks = htmlToBlocks(
      "<table><tr><th>Tranche</th><th>Taux</th></tr><tr><td>0 à 100</td><td>5 %</td></tr></table>"
    );
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    if (block.type !== "table") throw new Error("tableau attendu");
    expect(block.hasHeader).toBe(true);
    expect(block.rows).toEqual([
      ["Tranche", "Taux"],
      ["0 à 100", "5 %"],
    ]);
  });

  it("ignore le contenu des balises script et style", () => {
    const blocks = htmlToBlocks("<p>Visible</p><script>alert(1)</script><style>p{color:red}</style>");
    expect(blocksToPlainText(blocks)).toBe("Visible");
  });

  it("normalise les espaces sans perdre les mots", () => {
    const blocks = htmlToBlocks("<p>Un   texte\n  espace</p>");
    expect(blocksToPlainText(blocks)).toBe("Un texte espace");
  });

  it("renvoie une liste vide sur une entree vide", () => {
    expect(htmlToBlocks("")).toEqual([]);
    expect(htmlToBlocks("   ")).toEqual([]);
  });

  it("supporte un balisage mal ferme", () => {
    const blocks = htmlToBlocks("<p>Un <b>gras jamais ferme");
    expect(blocksToPlainText(blocks)).toBe("Un gras jamais ferme");
  });
});

describe("articleTextToBlocks", () => {
  it("traite un texte brut ligne par ligne", () => {
    const blocks = articleTextToBlocks("Premier alinéa.\n\nSecond alinéa.");
    expect(blocks).toHaveLength(2);
  });

  it("bascule sur l'analyse HTML si du balisage est present", () => {
    const blocks = articleTextToBlocks("<p>Alinéa</p>");
    expect(blocks).toHaveLength(1);
  });
});

describe("firstAlineas", () => {
  it("tronque et signale la coupure", () => {
    const blocks = htmlToBlocks("<p>Un</p><p>Deux</p><p>Trois</p><p>Quatre</p>");
    const truncated = firstAlineas(blocks, 2);
    expect(blocksToPlainText(truncated)).toBe("Un\nDeux\n[…]");
  });

  it("ne touche a rien si le contenu est deja court", () => {
    const blocks = htmlToBlocks("<p>Un</p>");
    expect(firstAlineas(blocks, 3)).toHaveLength(1);
  });
});

describe("countCharacters", () => {
  it("mesure le texte visible", () => {
    expect(countCharacters(htmlToBlocks("<p>abc</p><p>de</p>"))).toBe(6); // "abc\nde"
  });
});
