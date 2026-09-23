import { describe, expect, it } from "vitest";
import {
  covers,
  currentVersion,
  formatDateFr,
  formatPeriod,
  normalizeVersions,
  outOfRangeMessage,
  resolveAtDate,
  resolveInYear,
  toIsoDate,
  type ArticleVersion,
} from "../src/core/versions";

const versions: ArticleVersion[] = normalizeVersions([
  { id: "V1", dateDebut: "1994-03-01", dateFin: "2010-06-15" },
  { id: "V2", dateDebut: "2010-06-15", dateFin: "2020-03-15" },
  { id: "V3", dateDebut: "2020-03-15", dateFin: "2020-09-01" },
  { id: "V4", dateDebut: "2020-09-01", dateFin: "2999-01-01" },
]);

describe("toIsoDate", () => {
  it("accepte l'ISO, l'horodatage et le format francais", () => {
    expect(toIsoDate("2020-03-15")).toBe("2020-03-15");
    expect(toIsoDate("15/03/2020")).toBe("2020-03-15");
    expect(toIsoDate(Date.UTC(2020, 2, 15, 12))).toBe("2020-03-15");
    expect(toIsoDate(null)).toBeNull();
  });
});

describe("normalizeVersions", () => {
  it("ramene la date sentinelle de Legifrance a « toujours en vigueur »", () => {
    expect(versions[3]!.dateFin).toBeNull();
  });

  it("trie par date de debut croissante", () => {
    const shuffled = normalizeVersions([
      { id: "B", dateDebut: "2020-01-01" },
      { id: "A", dateDebut: "1994-01-01" },
    ]);
    expect(shuffled.map((v) => v.id)).toEqual(["A", "B"]);
  });
});

describe("covers", () => {
  it("traite l'intervalle comme ferme a gauche et ouvert a droite", () => {
    const v = versions[1]!;
    expect(covers(v, "2010-06-15")).toBe(true);
    expect(covers(v, "2020-03-14")).toBe(true);
    expect(covers(v, "2020-03-15")).toBe(false);
  });
});

describe("resolveAtDate", () => {
  it("retient la version applicable a une date precise", () => {
    const result = resolveAtDate(versions, "2020-05-01");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.version.id).toBe("V3");
  });

  it("signale une date anterieure a la creation de l'article", () => {
    const result = resolveAtDate(versions, "1990-01-01");
    expect(result.kind).toBe("outOfRange");
  });
});

describe("resolveInYear", () => {
  it("insere directement quand l'annee tombe dans une periode stable", () => {
    const result = resolveInYear(versions, 2015);
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.version.id).toBe("V2");
  });

  it("demande a choisir quand l'article a change dans l'annee", () => {
    const result = resolveInYear(versions, 2020);
    expect(result.kind).toBe("choice");
    if (result.kind !== "choice") return;
    expect(result.versions.map((v) => v.id)).toEqual(["V2", "V3", "V4"]);
    expect(result.year).toBe(2020);
  });

  it("signale une annee hors periode d'existence", () => {
    const result = resolveInYear(versions, 1980);
    expect(result.kind).toBe("outOfRange");
    if (result.kind !== "outOfRange") return;
    expect(outOfRangeMessage(result)).toMatch(/1er mars 1994/);
  });

  it("gere un article abroge : plus aucune version apres la fin", () => {
    const abrogated = normalizeVersions([{ id: "X", dateDebut: "2000-01-01", dateFin: "2019-01-01" }]);
    const result = resolveInYear(abrogated, 2022);
    expect(result.kind).toBe("outOfRange");
    if (result.kind !== "outOfRange") return;
    expect(outOfRangeMessage(result)).toMatch(/n'a existe que/i);
  });
});

describe("currentVersion", () => {
  it("renvoie la version ouverte", () => {
    expect(currentVersion(versions)?.id).toBe("V4");
  });

  it("renvoie null sur une liste vide", () => {
    expect(currentVersion([])).toBeNull();
  });
});

describe("formatage", () => {
  it("ecrit « 1er » pour le premier du mois", () => {
    expect(formatDateFr("2020-09-01")).toBe("1er septembre 2020");
    expect(formatDateFr("2020-03-15")).toBe("15 mars 2020");
  });

  it("affiche la veille comme dernier jour de vigueur", () => {
    expect(formatPeriod(versions[2]!)).toBe("en vigueur du 15 mars 2020 au 31 août 2020");
  });

  it("dit « depuis » pour une version toujours en vigueur", () => {
    expect(formatPeriod(versions[3]!)).toMatch(/^en vigueur depuis le 1er septembre 2020$/);
  });
});
