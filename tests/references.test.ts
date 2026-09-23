import { describe, expect, it } from "vitest";
import { detectInSelection, detectReferences, findIntroducedReferences } from "../src/core/references";

describe("detectReferences", () => {
  it("repere la tournure « l'article X du Code Y »", () => {
    const found = detectReferences("Selon l'article 1353 du Code civil, la preuve incombe au demandeur.");
    expect(found).toHaveLength(1);
    expect(found[0]!.numbers).toEqual(["1353"]);
    expect(found[0]!.resolution.kind).toBe("resolved");
    if (found[0]!.resolution.kind !== "resolved") return;
    expect(found[0]!.resolution.code.slug).toBe("cciv");
  });

  it("repere la tournure inverse « C. civ., art. X »", () => {
    const found = detectReferences("La solution est acquise (C. civ., art. 1353).");
    expect(found).toHaveLength(1);
    expect(found[0]!.numbers).toEqual(["1353"]);
    if (found[0]!.resolution.kind !== "resolved") throw new Error("code non resolu");
    expect(found[0]!.resolution.code.slug).toBe("cciv");
  });

  it("repere plusieurs numeros dans une meme reference", () => {
    const found = detectReferences("Les articles 1353 et 1354 du Code civil sont applicables.");
    expect(found).toHaveLength(1);
    expect(found[0]!.numbers).toEqual(["1353", "1354"]);
  });

  it("gere les numeros a prefixe de division", () => {
    const found = detectReferences("Voir l'article L. 1132-1 du code du travail.");
    expect(found).toHaveLength(1);
    expect(found[0]!.numbers).toEqual(["L1132-1"]);
    if (found[0]!.resolution.kind !== "resolved") throw new Error("code non resolu");
    expect(found[0]!.resolution.code.slug).toBe("ctrav");
  });

  it("repere plusieurs references dans un meme paragraphe", () => {
    const found = detectReferences(
      "L'article 1353 du Code civil pose le principe ; l'article 9 du code de procédure civile le complète."
    );
    expect(found).toHaveLength(2);
    expect(found[0]!.numbers).toEqual(["1353"]);
    expect(found[1]!.numbers).toEqual(["9"]);
  });

  it("conserve une reference dont le code reste introuvable", () => {
    // La verification du document doit pouvoir signaler ces cas.
    const found = detectReferences("Voir l'article 12 du code de la marmelade.");
    expect(found).toHaveLength(1);
    expect(found[0]!.resolution.kind).toBe("unknown");
  });

  it("ne detecte rien dans un texte sans reference", () => {
    expect(detectReferences("Le contrat a été signé le 3 mars.")).toHaveLength(0);
  });

  it("preserve les positions dans le texte", () => {
    const text = "Selon l'article 1353 du Code civil, la preuve incombe.";
    const found = detectReferences(text);
    const ref = found[0]!;
    expect(text.slice(ref.start, ref.end)).toBe(ref.raw);
    expect(ref.raw).toContain("1353");
    expect(ref.raw).toContain("Code civil");
  });
});

describe("findIntroducedReferences — la commande /citart", () => {
  it("reconnaît la phrase introductive classique", () => {
    const found = findIntroducedReferences(["L'article 121-5 du code pénal dispose que :"]);
    expect(found).not.toBeNull();
    expect(found!.references[0]!.numbers).toEqual(["121-5"]);
    expect(found!.distance).toBe(0);
    if (found!.references[0]!.resolution.kind !== "resolved") throw new Error("code non résolu");
    expect(found!.references[0]!.resolution.code.slug).toBe("cpen");
  });

  it("s'accommode de formulations variées", () => {
    const phrases = [
      "Aux termes de l'article 1353 du Code civil :",
      "Il résulte de l'article 1353 du code civil que",
      "L'article 1353 du Code civil énonce :",
      "Selon les dispositions de l'article 1353 du Code civil,",
      "Rappelons ici l'article 1353 du Code civil, ainsi rédigé :",
    ];
    for (const phrase of phrases) {
      const found = findIntroducedReferences([phrase]);
      expect(found, `échec sur « ${phrase} »`).not.toBeNull();
      expect(found!.references[0]!.numbers).toEqual(["1353"]);
    }
  });

  it("remonte les paragraphes jusqu'à trouver une référence", () => {
    const found = findIntroducedReferences([
      "",
      "   ",
      "L'article 700 du code de procédure civile dispose que :",
      "Un paragraphe plus ancien citant l'article 1353 du Code civil.",
    ]);
    expect(found!.distance).toBe(2);
    expect(found!.references[0]!.numbers).toEqual(["700"]);
  });

  it("s'arrête au premier paragraphe porteur, sans aller chercher plus loin", () => {
    // Remonter au-delà reviendrait à citer un article que l'auteur n'a pas annoncé.
    const found = findIntroducedReferences([
      "L'article 12 du code de la marmelade dispose que :",
      "L'article 1353 du Code civil est pourtant clair.",
    ]);
    expect(found!.distance).toBe(0);
    expect(found!.references[0]!.resolution.kind).toBe("unknown");
  });

  it("retient tous les articles d'une même phrase", () => {
    const found = findIntroducedReferences(["Les articles 1353 et 1354 du Code civil disposent que :"]);
    expect(found!.references[0]!.numbers).toEqual(["1353", "1354"]);
  });

  it("reconnaît la forme abrégée", () => {
    const found = findIntroducedReferences(["Aux termes de C. civ., art. 1353 :"]);
    expect(found).not.toBeNull();
    expect(found!.references[0]!.numbers).toEqual(["1353"]);
  });

  it("renvoie null quand rien n'est annoncé", () => {
    expect(findIntroducedReferences(["Le contrat a été signé le 3 mars.", ""])).toBeNull();
  });

  it("renvoie null sur une liste vide", () => {
    expect(findIntroducedReferences([])).toBeNull();
  });

  it("expose le texte source, pour pouvoir le montrer à l'utilisateur", () => {
    const found = findIntroducedReferences(["  L'article 121-5 du code pénal dispose que :  "]);
    expect(found!.source).toBe("L'article 121-5 du code pénal dispose que :");
  });
});

describe("detectInSelection", () => {
  it("accepte une selection sans le mot « article »", () => {
    const found = detectInSelection("1353 du Code civil");
    expect(found).toHaveLength(1);
    expect(found[0]!.numbers).toEqual(["1353"]);
  });

  it("fonctionne sur une selection complete", () => {
    const found = detectInSelection("l'article 1353 du Code civil");
    expect(found).toHaveLength(1);
  });

  it("ne renvoie rien si le code est absent", () => {
    expect(detectInSelection("1353")).toHaveLength(0);
  });
});
