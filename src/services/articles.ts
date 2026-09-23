/**
 * Orchestration : de la commande analysee a l'article pret a inserer.
 *
 * C'est ici que se joue la regle centrale du projet : aucune insertion
 * silencieuse. Chaque situation incertaine remonte a l'interface sous une
 * forme explicite (choix de version, choix de code, hors periode) plutot que
 * d'etre tranchee par defaut.
 */

import { codeBySlug, type CodeEntry } from "../core/abbreviations";
import { articleTextToBlocks } from "../core/html-to-blocks";
import { normalizeArticle } from "../core/normalize";
import type { ArticleData } from "../core/citation";
import type { ArticleSpec, DateSpec } from "../core/parser";
import {
  currentVersion,
  normalizeVersions,
  outOfRangeMessage,
  resolveAtDate,
  resolveInYear,
  toIsoDate,
  type ArticleVersion,
} from "../core/versions";
import { TTL, withCache } from "../api/cache";
import {
  getArticle,
  getCodeTableOfContents,
  listCodes,
  searchArticleInCode,
  type ClientContext,
} from "../api/legifrance";
import { LegifranceError, type SearchHit } from "../api/types";
import type { Settings } from "../settings/store";

export type LookupOutcome =
  | { kind: "article"; data: ArticleData; storedAt: Date; fromCache: boolean }
  | { kind: "versionChoice"; num: string; code: CodeEntry; versions: ArticleVersion[]; year: number }
  | { kind: "outOfRange"; num: string; code: CodeEntry; message: string }
  | { kind: "notFound"; num: string; code: CodeEntry };

/** Nombre maximal d'articles resolus par une plage, garde-fou contre les quotas. */
export const MAX_RANGE_SIZE = 30;

function contextOf(settings: Settings): ClientContext {
  return { credentials: settings.piste, transport: settings.transport };
}

/** Applique les abreviations d'affichage redefinies par l'utilisateur. */
function withDisplayOverride(code: CodeEntry, settings: Settings): CodeEntry {
  const override = settings.displayOverrides[code.slug];
  return override ? { ...code, abrevAffichage: override } : code;
}

function versionsOf(raw: {
  id: string;
  num?: string;
  dateDebut?: string | number;
  dateFin?: string | number;
  etat?: string;
  listArticle?: Array<{ id: string; num?: string; dateDebut?: string | number; dateFin?: string | number; etat?: string }>;
}): ArticleVersion[] {
  const list = raw.listArticle && raw.listArticle.length > 0 ? raw.listArticle : [raw];
  return normalizeVersions(
    list.map((v) => ({
      id: v.id,
      ...(v.num ? { num: v.num } : {}),
      dateDebut: v.dateDebut ?? "",
      dateFin: v.dateFin ?? null,
      ...(v.etat ? { etat: v.etat } : {}),
    }))
  );
}

function blocksOf(raw: { texteHtml?: string; texte?: string }) {
  const source = raw.texteHtml && raw.texteHtml.trim() ? raw.texteHtml : raw.texte ?? "";
  return articleTextToBlocks(source);
}

/**
 * Recherche puis consultation d'un article unique.
 * `date` absente = derniere version en vigueur.
 */
export async function lookupArticle(
  settings: Settings,
  num: string,
  code: CodeEntry,
  date?: DateSpec
): Promise<LookupOutcome> {
  const ctx = contextOf(settings);
  const displayCode = withDisplayOverride(code, settings);
  const normalized = normalizeArticle(num);

  // Pour une annee, on interroge au 1er juillet : une date en milieu d'annee
  // maximise les chances de tomber sur une version couvrant l'annee, et la
  // liste complete des versions est de toute facon renvoyee ensuite.
  const searchDate =
    date?.type === "date" ? date.iso : date?.type === "year" ? `${date.year}-07-01` : undefined;

  const cacheKey = `search:${code.slug}:${normalized}:${searchDate ?? "now"}`;
  let hits: SearchHit[];
  try {
    const cached = await withCache<SearchHit[]>(cacheKey, TTL.search, () =>
      searchArticleInCode(ctx, normalized, code.nom, searchDate)
    );
    hits = cached.value;
  } catch (error) {
    if (error instanceof LegifranceError && error.kind === "notFound") {
      return { kind: "notFound", num: normalized, code: displayCode };
    }
    throw error;
  }

  if (hits.length === 0) return { kind: "notFound", num: normalized, code: displayCode };

  const article = await withCache(`article:${hits[0]!.id}`, TTL.article, () => getArticle(ctx, hits[0]!.id));
  const versions = versionsOf(article.value);

  let chosen: ArticleVersion | null;
  if (!date) {
    chosen = currentVersion(versions);
  } else if (date.type === "date") {
    const resolution = resolveAtDate(versions, date.iso);
    if (resolution.kind === "outOfRange") {
      return { kind: "outOfRange", num: normalized, code: displayCode, message: outOfRangeMessage(resolution) };
    }
    chosen = resolution.kind === "single" ? resolution.version : null;
  } else {
    const resolution = resolveInYear(versions, date.year);
    if (resolution.kind === "outOfRange") {
      return { kind: "outOfRange", num: normalized, code: displayCode, message: outOfRangeMessage(resolution) };
    }
    if (resolution.kind === "choice") {
      return {
        kind: "versionChoice",
        num: normalized,
        code: displayCode,
        versions: resolution.versions,
        year: resolution.year,
      };
    }
    chosen = resolution.version;
  }

  if (!chosen) return { kind: "notFound", num: normalized, code: displayCode };

  return buildArticleData(settings, chosen, normalized, displayCode, article.value, article.storedAt, article.fromCache);
}

/** Charge une version precise, une fois le choix tranche par l'utilisateur. */
export async function loadVersion(
  settings: Settings,
  version: ArticleVersion,
  num: string,
  code: CodeEntry
): Promise<ArticleData> {
  const ctx = contextOf(settings);
  const article = await withCache(`article:${version.id}`, TTL.article, () => getArticle(ctx, version.id));
  const outcome = await buildArticleData(
    settings,
    version,
    num,
    withDisplayOverride(code, settings),
    article.value,
    article.storedAt,
    article.fromCache
  );
  return outcome.data;
}

async function buildArticleData(
  settings: Settings,
  version: ArticleVersion,
  num: string,
  code: CodeEntry,
  fetched: { id: string; texteHtml?: string; texte?: string },
  storedAt: Date,
  fromCache: boolean
): Promise<Extract<LookupOutcome, { kind: "article" }>> {
  let source = fetched;
  let at = storedAt;
  let cached = fromCache;

  // La version retenue peut differer de celle renvoyee par la recherche :
  // il faut alors recharger le texte correspondant.
  if (version.id !== fetched.id) {
    const ctx = contextOf(settings);
    const reloaded = await withCache(`article:${version.id}`, TTL.article, () => getArticle(ctx, version.id));
    source = reloaded.value;
    at = reloaded.storedAt;
    cached = reloaded.fromCache;
  }

  return {
    kind: "article",
    storedAt: at,
    fromCache: cached,
    data: {
      id: version.id,
      num: version.num ? normalizeArticle(version.num) : num,
      code,
      blocks: blocksOf(source),
      version,
    },
  };
}

/**
 * Resout plusieurs articles en parallele, avec une limite de concurrence.
 *
 * La resolution sequentielle multipliait la latence par le nombre d'articles :
 * chaque article coute deux allers-retours reseau, une liste de cinq articles
 * prenait donc dix allers-retours en file. La limite evite de declencher une
 * rafale sur les quotas PISTE.
 */
export async function lookupMany(
  settings: Settings,
  numbers: string[],
  code: CodeEntry,
  date?: DateSpec,
  concurrency = 4
): Promise<LookupOutcome[]> {
  const results = new Array<LookupOutcome>(numbers.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= numbers.length) return;
      results[index] = await lookupArticle(settings, numbers[index]!, code, date);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, numbers.length) }, worker));
  return results;
}

/**
 * Rechauffe le cache sans rien inserer, pendant que l'utilisateur finit de
 * taper sa commande. Les erreurs sont volontairement ignorees : un
 * prechargement qui echoue ne doit jamais se manifester a l'ecran, la
 * resolution reelle rejouera l'appel et signalera le probleme a ce moment-la.
 */
export async function prefetchArticles(
  settings: Settings,
  numbers: string[],
  code: CodeEntry,
  date?: DateSpec
): Promise<void> {
  try {
    await lookupMany(settings, numbers.slice(0, 5), code, date, 2);
  } catch {
    /* silencieux par conception */
  }
}

/** Identifiant LEGITEXT d'un code, resolu depuis l'API et mis en cache. */
export async function codeTextId(settings: Settings, code: CodeEntry): Promise<string | null> {
  const ctx = contextOf(settings);
  const codes = await withCache("codes:list", TTL.codeList, () => listCodes(ctx));
  const wanted = code.nom.toLowerCase();
  const exact = codes.value.find((c) => c.titre.toLowerCase() === wanted);
  if (exact) return exact.id;
  const loose = codes.value.find((c) => c.titre.toLowerCase().startsWith(wanted.slice(0, 20)));
  return loose ? loose.id : null;
}

export interface RangeResult {
  numbers: string[];
  truncated: boolean;
}

/**
 * Developpe une plage d'articles.
 *
 * L'ordre du SOMMAIRE du code fait foi : la numerotation n'est pas
 * arithmetique (L. 622-1-1 s'intercale entre L. 622-1 et L. 622-2, il existe
 * des bis et des ter, et des articles abroges disparaissent de la serie).
 * Incrementer un nombre produirait des references fantaisistes.
 */
export async function expandRange(
  settings: Settings,
  code: CodeEntry,
  from: string,
  to: string,
  dateIso?: string
): Promise<RangeResult> {
  const textId = await codeTextId(settings, code);
  if (!textId) {
    throw new LegifranceError(
      `Impossible d'identifier « ${code.nom} » dans la liste des codes Legifrance.`,
      "notFound"
    );
  }

  const ctx = contextOf(settings);
  const date = dateIso ?? new Date().toISOString().slice(0, 10);
  const toc = await withCache(`toc:${textId}:${date}`, TTL.sommaire, () =>
    getCodeTableOfContents(ctx, textId, date)
  );

  const normalized = toc.value.map((a) => ({ ...a, key: normalizeArticle(a.num) }));
  const start = normalized.findIndex((a) => a.key === normalizeArticle(from));
  const end = normalized.findIndex((a) => a.key === normalizeArticle(to));

  if (start === -1) throw new LegifranceError(`Article ${from} introuvable dans ${code.nom}.`, "notFound");
  if (end === -1) throw new LegifranceError(`Article ${to} introuvable dans ${code.nom}.`, "notFound");
  if (end < start) throw new LegifranceError("La plage est inversee : le second article precede le premier.", "unknown");

  const slice = normalized.slice(start, end + 1);
  const truncated = slice.length > MAX_RANGE_SIZE;
  return {
    numbers: slice.slice(0, MAX_RANGE_SIZE).map((a) => a.key),
    truncated,
  };
}

/** Resout la liste de numeros correspondant a une specification d'articles. */
export async function resolveArticleNumbers(
  settings: Settings,
  spec: ArticleSpec,
  code: CodeEntry,
  date?: DateSpec
): Promise<RangeResult> {
  if (spec.type === "list") return { numbers: spec.numbers, truncated: false };
  const iso = date?.type === "date" ? date.iso : date?.type === "year" ? `${date.year}-07-01` : undefined;
  return expandRange(settings, code, spec.from, spec.to, iso);
}

export { codeBySlug };
export type { ArticleData, ArticleVersion, CodeEntry };
export { toIsoDate };
