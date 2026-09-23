import { describe, expect, it } from "vitest";
import { findTrigger, parseCommand, tokenize, type ParseResult } from "../src/core/parser";

/** Narrowing : /art et /artv portent un article et un code, /citart non. */
function art(result: ParseResult) {
  if (!result.ok) throw new Error(`analyse échouée : ${result.error}`);
  if (result.command === "citart") throw new Error("commande /art ou /artv attendue");
  return result;
}

function citart(result: ParseResult) {
  if (!result.ok) throw new Error(`analyse échouée : ${result.error}`);
  if (result.command !== "citart") throw new Error("commande /citart attendue");
  return result;
}

describe("tokenize", () => {
  it("recolle un préfixe de division séparé de son numéro", () => {
    expect(tokenize("L. 622-1 ccom")).toEqual(["L622-1", "ccom"]);
    expect(tokenize("R 121-4 croute")).toEqual(["R121-4", "croute"]);
  });

  it("isole les virgules collées aux numéros", () => {
    expect(tokenize("111-1, 111-2 cpen")).toEqual(["111-1", ",", "111-2", "cpen"]);
  });
});

describe("parseCommand — /art", () => {
  it("analyse un article isolé", () => {
    const result = art(parseCommand("/art 111-1 cpen"));
    expect(result.articles).toEqual({ type: "list", numbers: ["111-1"] });
    expect(result.codeInput).toBe("cpen");
    expect(result.date).toBeUndefined();
  });

  it("accepte un code écrit en toutes lettres", () => {
    expect(art(parseCommand("/art 1353 code civil")).codeInput).toBe("code civil");
  });

  it("accepte le code avant l'article", () => {
    const result = art(parseCommand("/art cpen 111-1"));
    expect(result.codeInput).toBe("cpen");
    expect(result.articles).toEqual({ type: "list", numbers: ["111-1"] });
  });

  it("analyse une liste séparée par des virgules et par « et »", () => {
    expect(art(parseCommand("/art 111-1, 111-2 et 111-3 cpen")).articles).toEqual({
      type: "list",
      numbers: ["111-1", "111-2", "111-3"],
    });
  });

  it("dédoublonne les numéros répétés", () => {
    expect(art(parseCommand("/art 111-1, 111-1 cpen")).articles).toEqual({ type: "list", numbers: ["111-1"] });
  });

  it("analyse une plage délimitée par « à »", () => {
    expect(art(parseCommand("/art 111-1 à 111-5 cpen")).articles).toEqual({
      type: "range",
      from: "111-1",
      to: "111-5",
    });
  });

  it("ne traite JAMAIS le tiret comme un séparateur de plage", () => {
    // « 622-1-1 » est un numéro d'article valide, pas une plage de 622-1 à 1.
    expect(art(parseCommand("/art L622-1-1 ccom")).articles).toEqual({ type: "list", numbers: ["L622-1-1"] });
  });

  it("refuse une plage à trois bornes", () => {
    expect(parseCommand("/art 111-1 à 111-2 à 111-3 cpen").ok).toBe(false);
  });

  it("signale une commande sans code", () => {
    expect(parseCommand("/art 111-1").ok).toBe(false);
  });

  it("normalise les numéros à préfixe de division", () => {
    expect(art(parseCommand("/art l. 1132-1 ctrav")).articles).toEqual({ type: "list", numbers: ["L1132-1"] });
  });

  it("n'interprète pas une année comme une date", () => {
    // Sans /artv, « 2020 » reste un numéro d'article.
    const result = art(parseCommand("/art 2020 cciv"));
    expect(result.articles).toEqual({ type: "list", numbers: ["2020"] });
    expect(result.date).toBeUndefined();
  });
});

describe("parseCommand — /artv", () => {
  it("lit une année en fin de commande", () => {
    const result = art(parseCommand("/artv 1353 cciv 2020"));
    expect(result.date).toEqual({ type: "year", year: 2020 });
    expect(result.codeInput).toBe("cciv");
  });

  it("lit une date complète", () => {
    expect(art(parseCommand("/artv 1353 cciv 15/03/2020")).date).toEqual({ type: "date", iso: "2020-03-15" });
  });

  it("rejette une date impossible", () => {
    expect(parseCommand("/artv 1353 cciv 31/02/2020").ok).toBe(false);
  });

  it("exige une date", () => {
    const result = parseCommand("/artv 1353 cciv");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/annee ou une date/i);
  });
});

describe("parseCommand — /citart", () => {
  it("s'emploie seul, sans article ni code", () => {
    const result = citart(parseCommand("/citart"));
    expect(result.date).toBeUndefined();
  });

  it("tolère les espaces autour", () => {
    expect(citart(parseCommand("   /citart   ")).command).toBe("citart");
  });

  it("accepte une année", () => {
    expect(citart(parseCommand("/citart 2020")).date).toEqual({ type: "year", year: 2020 });
  });

  it("accepte une date complète", () => {
    expect(citart(parseCommand("/citart 15/03/2020")).date).toEqual({ type: "date", iso: "2020-03-15" });
  });

  it("refuse un argument qui n'est pas une date", () => {
    const result = parseCommand("/citart 111-1 cpen");
    expect(result.ok).toBe(false);
  });

  it("n'est pas confondu avec /art", () => {
    // L'alternance doit évaluer « citart » avant « art ».
    expect(citart(parseCommand("/citart")).command).toBe("citart");
    expect(art(parseCommand("/art 1 cciv")).command).toBe("art");
  });
});

describe("findTrigger", () => {
  it("repère une commande en fin de paragraphe", () => {
    expect(findTrigger("Selon le texte applicable, /art 111-1 cpen")?.raw).toBe("/art 111-1 cpen");
  });

  it("retient la dernière commande du paragraphe", () => {
    expect(findTrigger("/art 1 cciv puis /artv 1353 cciv 2020")?.raw).toBe("/artv 1353 cciv 2020");
  });

  it("repère /citart, y compris après une phrase introductive", () => {
    const trigger = findTrigger("L'article 121-5 du code pénal dispose que : /citart");
    expect(trigger?.raw).toBe("/citart");
  });

  it("ne trouve rien en l'absence de commande", () => {
    expect(findTrigger("Un paragraphe ordinaire.")).toBeNull();
  });
});
