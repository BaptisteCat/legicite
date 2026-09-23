import { describe, expect, it } from "vitest";
import { codeBySlug } from "../src/core/abbreviations";
import { blocksToPlainText } from "../src/core/blocks";
import { longReference, renderCitation, renderGroup, shortReference, type ArticleData } from "../src/core/citation";
import { cloneStyle, cmToPt, DEFAULT_STYLE, matchingPreset, presetById, type CitationStyle } from "../src/core/citation-style";
import { htmlToBlocks } from "../src/core/html-to-blocks";
import { normalizeVersions } from "../src/core/versions";

const code = codeBySlug("cpen")!;
const version = normalizeVersions([{ id: "LEGIARTI0001", dateDebut: "1994-03-01", dateFin: null }])[0]!;

const article: ArticleData = {
  id: "LEGIARTI0001",
  num: "111-1",
  code,
  blocks: htmlToBlocks(
    "<p>Les infractions pénales sont classées, suivant leur gravité, en crimes, délits et contraventions.</p>" +
      "<p>Cette classification commande la juridiction compétente.</p>"
  ),
  version,
};

const EXTRACTED = "2026-09-08";

function render(patch: (style: CitationStyle) => void = () => undefined) {
  const style = cloneStyle(DEFAULT_STYLE);
  patch(style);
  return renderCitation(article, { style, extractedAt: EXTRACTED });
}

function plain(patch: (style: CitationStyle) => void = () => undefined): string {
  return blocksToPlainText(render(patch).blocks);
}

describe("références", () => {
  it("compose la référence longue", () => {
    expect(longReference(article)).toBe("Article 111-1 du code pénal");
  });

  it("compose la référence courte avec l'abréviation d'AFFICHAGE", () => {
    // « cpen » est l'abréviation de saisie ; « C. pén. » celle d'affichage.
    expect(shortReference(article)).toContain("C. pén.");
    expect(shortReference(article)).toContain("111-1");
  });

  it("affiche un numéro à préfixe de division avec son point", () => {
    expect(longReference({ ...article, num: "L622-1" })).toContain("L. 622-1");
  });
});

describe("intitulé", () => {
  it("est présent par défaut, sur sa propre ligne", () => {
    expect(plain()).toMatch(/^Article 111-1 du code pénal\n/);
  });

  it("peut être retiré", () => {
    expect(plain((s) => (s.heading.include = false))).not.toContain("Article 111-1 du code pénal");
  });

  it("peut prendre la forme courte", () => {
    const text = plain((s) => (s.heading.form = "court"));
    expect(text).toContain("C. pén., art.");
    expect(text).not.toContain("Article 111-1 du code pénal");
  });

  it("peut précéder le texte sur la même ligne", () => {
    const text = plain((s) => (s.heading.ownParagraph = false));
    expect(text).toMatch(/Article 111-1 du code pénal : «/);
  });

  it("porte les attributs de casse demandés", () => {
    const blocks = render((s) => {
      s.heading.bold = false;
      s.heading.italic = true;
      s.heading.underline = true;
    }).blocks;
    const heading = blocks.find((b) => b.type === "paragraph" && b.role === "heading");
    if (!heading || heading.type !== "paragraph") throw new Error("intitulé attendu");
    expect(heading.runs[0]?.italic).toBe(true);
    expect(heading.runs[0]?.underline).toBe(true);
    expect(heading.runs[0]?.bold).toBeUndefined();
  });
});

describe("mention de version", () => {
  it("apparaît sous l'intitulé, entre parenthèses", () => {
    expect(plain()).toContain("(version en vigueur depuis le 1er mars 1994)");
  });

  it("peut se réduire à la date", () => {
    const text = plain((s) => (s.version.complete = false));
    expect(text).toContain("(1er mars 1994)");
    expect(text).not.toContain("version en vigueur");
  });

  it("peut se passer de parenthèses", () => {
    expect(plain((s) => (s.version.parentheses = false))).toContain("version en vigueur depuis le 1er mars 1994");
  });

  it("peut être reportée à la suite du texte", () => {
    // Elle se colle au dernier alinéa cité ; la mention de source, si elle est
    // active, vient encore après sur sa propre ligne.
    const result = render((s) => (s.version.placement = "finTexte"));
    const body = result.blocks.filter((b) => b.type === "paragraph" && b.role === "body");
    const lastBody = body[body.length - 1];
    if (!lastBody || lastBody.type !== "paragraph") throw new Error("alinéa attendu");
    expect(lastBody.runs.map((r) => r.text).join("")).toContain("version en vigueur");
    expect(blocksToPlainText(result.blocks).split("\n")[0]).toBe("Article 111-1 du code pénal");
  });

  it("peut partir en note de bas de page", () => {
    const result = render((s) => (s.version.placement = "note"));
    expect(blocksToPlainText(result.blocks)).not.toContain("version en vigueur");
    expect(result.footnote).toContain("version en vigueur");
  });

  it("peut être retirée", () => {
    expect(plain((s) => (s.version.include = false))).not.toContain("version en vigueur");
  });
});

describe("texte de l'article", () => {
  it("est entouré de guillemets français par défaut", () => {
    const text = plain();
    expect(text).toContain("«");
    expect(text).toContain("»");
  });

  it("accepte les guillemets anglais", () => {
    const text = plain((s) => (s.text.quotes = "anglais"));
    expect(text).toContain("“");
    expect(text).not.toContain("«");
  });

  it("peut se passer de guillemets", () => {
    const text = plain((s) => (s.text.quotes = "aucun"));
    expect(text).not.toContain("«");
    expect(text).not.toContain("»");
  });

  it("n'ouvre les guillemets qu'une fois par défaut", () => {
    expect((plain().match(/«/g) ?? []).length).toBe(1);
  });

  it("répète le guillemet ouvrant à chaque alinéa si demandé", () => {
    const text = plain((s) => (s.text.quoteEachAlinea = true));
    expect((text.match(/«/g) ?? []).length).toBe(2);
    expect((text.match(/»/g) ?? []).length).toBe(1);
  });

  it("applique l'italique à tous les alinéas", () => {
    const blocks = render((s) => (s.text.italic = true)).blocks;
    const body = blocks.filter((b) => b.type === "paragraph" && b.role === "body");
    expect(body.length).toBeGreaterThan(0);
    for (const block of body) {
      if (block.type !== "paragraph") continue;
      expect(block.runs.every((r) => r.italic || r.text.trim() === "")).toBe(true);
    }
  });
});

describe("mise en forme", () => {
  it("n'impose aucun retrait par défaut", () => {
    const blocks = render().blocks;
    const first = blocks[0];
    if (!first || first.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(first.format?.leftIndentPt).toBeUndefined();
  });

  it("applique le retrait du bloc en points", () => {
    const blocks = render((s) => {
      s.layout.indent = true;
      s.layout.indentCm = 2;
    }).blocks;
    const first = blocks[0];
    if (!first || first.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(first.format?.leftIndentPt).toBeCloseTo(cmToPt(2), 1);
  });

  it("ne demande pas de réinitialisation de style par défaut", () => {
    const first = render().blocks[0];
    if (!first || first.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(first.format?.resetStyle).toBeUndefined();
  });

  it("propage la réinitialisation du style quand elle est demandée", () => {
    const blocks = render((s) => (s.layout.resetStyle = true)).blocks;
    for (const block of blocks) {
      if (block.type !== "paragraph") continue;
      expect(block.format?.resetStyle).toBe(true);
    }
  });

  it("n'active jamais le gras quand le réglage le refuse", () => {
    // Le texte inséré ne doit pas hériter du gras de la phrase qui le précède :
    // aucun run du corps ne porte l'attribut, la couche Word l'écrira à false.
    const blocks = render((s) => {
      s.text.italic = true;
      s.text.bold = false;
    }).blocks;
    const body = blocks.filter((b) => b.type === "paragraph" && b.role === "body");
    for (const block of body) {
      if (block.type !== "paragraph") continue;
      expect(block.runs.some((r) => r.bold)).toBe(false);
      expect(block.runs.every((r) => r.italic)).toBe(true);
    }
  });

  it("applique l'alignement et la police demandés", () => {
    const blocks = render((s) => {
      s.layout.alignment = "justifie";
      s.layout.fontSizePt = 10;
      s.layout.fontName = "Garamond";
    }).blocks;
    const first = blocks[0];
    if (!first || first.type !== "paragraph") throw new Error("paragraphe attendu");
    expect(first.format?.alignment).toBe("justified");
    expect(first.format?.fontSizePt).toBe(10);
    expect(first.format?.fontName).toBe("Garamond");
  });
});

describe("référence et source", () => {
  it("peut accoler la référence courte au texte", () => {
    expect(plain((s) => (s.reference.inlineAfterText = true))).toMatch(/» \(C\. pén\., art\./);
  });

  it("mentionne la source dans le corps avec la date de consultation", () => {
    expect(plain()).toMatch(/Source : Légifrance, consulté le 8 sept\. 2026\./);
  });

  it("peut omettre la date de consultation", () => {
    const text = plain((s) => (s.reference.withExtractionDate = false));
    expect(text).toContain("Source : Légifrance.");
    expect(text).not.toContain("consulté le");
  });

  it("peut reporter la source en note", () => {
    const result = render((s) => (s.reference.source = "note"));
    expect(blocksToPlainText(result.blocks)).not.toContain("Source :");
    expect(result.footnote).toContain("source Légifrance");
  });

  it("peut supprimer toute mention de source", () => {
    const result = render((s) => (s.reference.source = "aucune"));
    expect(blocksToPlainText(result.blocks)).not.toContain("Légifrance");
    expect(result.footnote).toBeUndefined();
  });
});

describe("présélections", () => {
  it("le style par défaut correspond à la présélection Bloc", () => {
    expect(matchingPreset(DEFAULT_STYLE)).toBe("bloc");
  });

  it("Inline place la référence après le texte, sans intitulé", () => {
    const result = renderCitation(article, { style: presetById("inline").style, extractedAt: EXTRACTED });
    const text = blocksToPlainText(result.blocks);
    expect(text).not.toContain("Article 111-1 du code pénal");
    expect(text).toMatch(/» \(C\. pén\., art\./);
  });

  it("Note sort la référence du corps", () => {
    const result = renderCitation(article, { style: presetById("note").style, extractedAt: EXTRACTED });
    expect(result.footnote).toBeDefined();
    expect(result.footnote).toContain("C. pén.");
    expect(blocksToPlainText(result.blocks)).not.toContain("Source :");
  });

  it("Brut ne laisse que le texte", () => {
    const result = renderCitation(article, { style: presetById("brut").style, extractedAt: EXTRACTED });
    const text = blocksToPlainText(result.blocks);
    expect(text.startsWith("Les infractions")).toBe(true);
    expect(text).not.toContain("«");
    expect(text).not.toContain("C. pén.");
    expect(result.footnote).toBeUndefined();
  });

  it("chaque présélection est reconnue par matchingPreset", () => {
    for (const id of ["bloc", "inline", "note", "brut"] as const) {
      expect(matchingPreset(presetById(id).style)).toBe(id);
    }
  });
});

describe("citation groupée", () => {
  const second: ArticleData = { ...article, num: "111-2", blocks: htmlToBlocks("<p>Deuxième article.</p>") };

  it("force l'intitulé sur chaque article même si le style le désactive", () => {
    const style = cloneStyle(presetById("inline").style);
    const rendered = renderGroup([article, second], { style, extractedAt: EXTRACTED });
    expect(rendered).toHaveLength(2);
    expect(blocksToPlainText(rendered[1]!.blocks)).toContain("Article 111-2 du code pénal");
  });

  it("respecte le choix de ne pas rappeler l'intitulé", () => {
    const style = cloneStyle(presetById("inline").style);
    style.group.forceHeadingWhenMultiple = false;
    const rendered = renderGroup([article, second], { style, extractedAt: EXTRACTED });
    expect(blocksToPlainText(rendered[1]!.blocks)).not.toContain("Article 111-2 du code pénal");
  });

  it("ajoute une ligne vide entre les articles, sauf après le dernier", () => {
    const style = cloneStyle(DEFAULT_STYLE);
    style.group.blankLineBetween = true;
    const rendered = renderGroup([article, second], { style, extractedAt: EXTRACTED });
    const lastOfFirst = rendered[0]!.blocks[rendered[0]!.blocks.length - 1]!;
    const lastOfSecond = rendered[1]!.blocks[rendered[1]!.blocks.length - 1]!;
    expect(lastOfFirst.type === "paragraph" && lastOfFirst.runs.length === 0).toBe(true);
    expect(lastOfSecond.type === "paragraph" && lastOfSecond.runs.length === 0).toBe(false);
  });

  it("laisse un article seul inchangé", () => {
    const single = renderGroup([article], { style: DEFAULT_STYLE, extractedAt: EXTRACTED });
    expect(blocksToPlainText(single[0]!.blocks)).toBe(plain());
  });
});
