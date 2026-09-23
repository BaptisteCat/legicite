/**
 * Resolution temporelle des versions d'un article.
 *
 * Parcours specifie au cahier des charges (§7) :
 *   - annee tombant dans une periode stable  -> insertion directe
 *   - annee couvrant plusieurs versions      -> choix dans le volet
 *   - article inexistant a la date demandee  -> message, aucune insertion
 */

export interface ArticleVersion {
  id: string;
  num?: string;
  /** Debut de vigueur, ISO yyyy-mm-dd. */
  dateDebut: string;
  /** Fin de vigueur, ISO yyyy-mm-dd, ou null si toujours en vigueur. */
  dateFin: string | null;
  etat?: string;
}

export type VersionResolution =
  | { kind: "single"; version: ArticleVersion }
  | { kind: "choice"; versions: ArticleVersion[]; year: number }
  | { kind: "outOfRange"; existedFrom: string | null; existedTo: string | null };

/**
 * Legifrance represente "pas de fin" par une date sentinelle tres lointaine
 * (2999-01-01, parfois 2222-...). On la ramene a null pour ne pas afficher
 * "jusqu'au 1er janvier 2999" a l'utilisateur.
 */
const OPEN_ENDED_YEAR = 2100;

/** Accepte une date ISO, un horodatage en millisecondes, ou null. */
export function toIsoDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (fr) return `${fr[3]}-${fr[2]!.padStart(2, "0")}-${fr[1]!.padStart(2, "0")}`;
  if (/^\d+$/.test(trimmed)) return toIsoDate(Number(trimmed));
  return null;
}

function isOpenEnded(iso: string | null): boolean {
  return iso === null || Number(iso.slice(0, 4)) >= OPEN_ENDED_YEAR;
}

/** Trie par date de debut croissante et neutralise les dates sentinelles. */
export function normalizeVersions(
  raw: Array<{ id: string; num?: string; dateDebut: string | number; dateFin?: string | number | null; etat?: string }>
): ArticleVersion[] {
  return raw
    .map((v) => {
      const debut = toIsoDate(v.dateDebut);
      const fin = toIsoDate(v.dateFin ?? null);
      return {
        id: v.id,
        ...(v.num ? { num: v.num } : {}),
        dateDebut: debut ?? "0001-01-01",
        dateFin: isOpenEnded(fin) ? null : fin,
        ...(v.etat ? { etat: v.etat } : {}),
      };
    })
    .sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));
}

/** Une version couvre-t-elle la date donnee ? Intervalle ferme a gauche, ouvert a droite. */
export function covers(version: ArticleVersion, iso: string): boolean {
  if (iso < version.dateDebut) return false;
  if (version.dateFin === null) return true;
  return iso < version.dateFin;
}

function existenceBounds(versions: ArticleVersion[]): { from: string | null; to: string | null } {
  if (versions.length === 0) return { from: null, to: null };
  const last = versions[versions.length - 1]!;
  return { from: versions[0]!.dateDebut, to: last.dateFin };
}

/** Version applicable a une date precise. */
export function resolveAtDate(versions: ArticleVersion[], iso: string): VersionResolution {
  const hit = versions.find((v) => covers(v, iso));
  if (hit) return { kind: "single", version: hit };
  const bounds = existenceBounds(versions);
  return { kind: "outOfRange", existedFrom: bounds.from, existedTo: bounds.to };
}

/**
 * Version applicable sur une annee entiere.
 * Une seule version couvrant l'annee -> insertion directe.
 * Plusieurs -> choix, car l'annee ne suffit pas a trancher.
 */
export function resolveInYear(versions: ArticleVersion[], year: number): VersionResolution {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const overlapping = versions.filter((v) => {
    const afterStart = v.dateFin === null || v.dateFin > start;
    const beforeEnd = v.dateDebut <= end;
    return afterStart && beforeEnd;
  });

  if (overlapping.length === 0) {
    const bounds = existenceBounds(versions);
    return { kind: "outOfRange", existedFrom: bounds.from, existedTo: bounds.to };
  }
  if (overlapping.length === 1) return { kind: "single", version: overlapping[0]! };
  return { kind: "choice", versions: overlapping, year };
}

/** Version en vigueur aujourd'hui, ou la plus recente a defaut. */
export function currentVersion(versions: ArticleVersion[]): ArticleVersion | null {
  if (versions.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  return versions.find((v) => covers(v, today)) ?? versions[versions.length - 1] ?? null;
}

const FR_DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** "2020-03-15" -> "15 mars 2020" ; le premier du mois donne "1er". */
export function formatDateFr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  const text = FR_DATE.format(d);
  return d.getUTCDate() === 1 ? text.replace(/^1 /, "1er ") : text;
}

/** Libelle de periode : "du 1er janvier au 14 mars 2020" ou "depuis le 15 mars 2020". */
export function formatPeriod(version: ArticleVersion): string {
  const debut = formatDateFr(version.dateDebut);
  if (version.dateFin === null) return `en vigueur depuis le ${debut}`;
  // La date de fin stockee est le premier jour de non-vigueur : on affiche la veille.
  const veille = new Date(version.dateFin + "T12:00:00Z");
  veille.setUTCDate(veille.getUTCDate() - 1);
  return `en vigueur du ${debut} au ${formatDateFr(veille.toISOString().slice(0, 10))}`;
}

/** Message affiche quand l'article n'existait pas a la date demandee. */
export function outOfRangeMessage(res: Extract<VersionResolution, { kind: "outOfRange" }>): string {
  if (!res.existedFrom) return "Aucune version connue de cet article.";
  if (res.existedTo === null) return `Cet article n'existe que depuis le ${formatDateFr(res.existedFrom)}.`;
  const veille = new Date(res.existedTo + "T12:00:00Z");
  veille.setUTCDate(veille.getUTCDate() - 1);
  return `Cet article n'a existe que du ${formatDateFr(res.existedFrom)} au ${formatDateFr(veille.toISOString().slice(0, 10))}.`;
}
