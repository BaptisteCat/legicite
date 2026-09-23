import { describe, expect, it } from "vitest";
import { allCodes, knownCollisions, resolveCode } from "../src/core/abbreviations";
import { normalizeArticle, normalizeCode } from "../src/core/normalize";

describe("normalizeCode", () => {
  it("efface accents, points, espaces et apostrophes", () => {
    expect(normalizeCode("C. civ.")).toBe("cciv");
    expect(normalizeCode("Code de l'énergie")).toBe("codedelenergie");
    expect(normalizeCode("  CPP  ")).toBe("cpp");
  });
});

describe("normalizeArticle", () => {
  it("conserve les tirets, qui font partie du numero", () => {
    expect(normalizeArticle("L. 622-1-1")).toBe("L622-1-1");
    expect(normalizeArticle("111-1")).toBe("111-1");
  });

  it("met le prefixe de division en majuscule", () => {
    expect(normalizeArticle("l1132-1")).toBe("L1132-1");
  });
});

describe("resolveCode", () => {
  it("resout les quatre abreviations de reference", () => {
    for (const [input, slug] of [
      ["cciv", "cciv"],
      ["cpen", "cpen"],
      ["cpc", "cpc"],
      ["cpp", "cpp"],
    ] as const) {
      const result = resolveCode(input);
      expect(result.kind).toBe("resolved");
      if (result.kind !== "resolved") continue;
      expect(result.code.slug).toBe(slug);
    }
  });

  it("accepte les variantes d'ecriture d'un meme code", () => {
    for (const input of ["cciv", "C. civ.", "c civ", "CIV", "code civil", "Code civil"]) {
      const result = resolveCode(input);
      expect(result.kind, `échec sur « ${input} »`).toBe("resolved");
      if (result.kind !== "resolved") continue;
      expect(result.code.slug).toBe("cciv");
    }
  });

  it("indexe automatiquement le nom complet de chaque code", () => {
    const result = resolveCode("code de l'organisation judiciaire");
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.code.slug).toBe("coj");
  });

  it("ne resout jamais automatiquement une collision connue", () => {
    for (const collision of knownCollisions()) {
      const result = resolveCode(collision);
      expect(result.kind, `« ${collision} » ne doit pas être résolu`).toBe("ambiguous");
    }
  });

  it("distingue les deux codes que l'usage abrege tous deux en CPCE", () => {
    const ambiguous = resolveCode("cpce");
    expect(ambiguous.kind).toBe("ambiguous");
    if (ambiguous.kind !== "ambiguous") return;
    expect(ambiguous.candidates.map((c) => c.slug).sort()).toEqual(["cpcex", "cpost"]);

    expect(resolveCode("cpcex").kind).toBe("resolved");
    expect(resolveCode("cpost").kind).toBe("resolved");
  });

  it("redirige une abreviation de code abroge en avertissant", () => {
    const result = resolveCode("cmp");
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.code.slug).toBe("ccp");
    expect(result.warning).toMatch(/abrog/i);
  });

  it("propose sans inserer quand la saisie est mal orthographiee", () => {
    const result = resolveCode("cciiv");
    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") return;
    expect(result.suggestions.map((c) => c.slug)).toContain("cciv");
  });

  it("ne suggere rien pour une saisie sans rapport", () => {
    const result = resolveCode("zzzzzzzzzz");
    expect(result.kind).toBe("unknown");
    if (result.kind !== "unknown") return;
    expect(result.suggestions).toHaveLength(0);
  });

  it("donne la priorite aux abreviations personnelles, ecrasement compris", () => {
    const result = resolveCode("cpc", { cpc: "cpcex" });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.code.slug).toBe("cpcex");
  });

  it("permet a une abreviation personnelle de trancher une collision connue", () => {
    const result = resolveCode("cc", { cc: "cciv" });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.code.slug).toBe("cciv");
  });
});

describe("table des codes", () => {
  it("ne contient ni slug ni abreviation d'affichage en double", () => {
    const codes = allCodes();
    const slugs = codes.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("renseigne un nom et une abreviation d'affichage pour chaque code", () => {
    for (const code of allCodes()) {
      expect(code.nom.length, code.slug).toBeGreaterThan(3);
      expect(code.abrevAffichage.length, code.slug).toBeGreaterThan(1);
      expect(code.alias.length, code.slug).toBeGreaterThan(0);
    }
  });
});
