/**
 * Client de l'API Legifrance.
 *
 * Note d'implementation : la forme exacte des reponses de /search varie selon
 * le fond interroge et le niveau d'imbrication (results > sections > extracts).
 * Plutot que de figer un chemin d'acces qui casserait au premier changement,
 * l'extraction parcourt recursivement la reponse et collecte les objets portant
 * un identifiant LEGIARTI. C'est volontairement tolerant.
 */

import { apiBase, getAccessToken } from "./auth";
import { request, toError, type TransportConfig } from "./transport";
import {
  LegifranceError,
  type CodeListEntry,
  type Fond,
  type PisteCredentials,
  type RawArticle,
  type SearchHit,
  type SearchPayload,
} from "./types";

export interface ClientContext {
  credentials: PisteCredentials;
  transport: TransportConfig;
}

async function call<T>(ctx: ClientContext, path: string, body: unknown, method: "GET" | "POST" = "POST"): Promise<T> {
  const token = await getAccessToken(ctx.credentials, ctx.transport);
  const response = await request(
    `${apiBase(ctx.credentials)}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    },
    ctx.transport
  );

  if (!response.ok) throw await toError(response);

  const raw = await response.text();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new LegifranceError("Reponse illisible de l'API Legifrance.", "unknown");
  }
}

/**
 * Verifie identifiants, transport et acces effectif a l'API.
 * Utilise par le bouton « Tester la connexion ».
 *
 * L'API expose plusieurs routes de sante selon les versions, et une route
 * inconnue est renvoyee en 500 par la passerelle plutot qu'en 404. On essaie
 * donc successivement plusieurs points d'entree legers, et on ne considere
 * l'echec comme reel que si aucun ne repond.
 */
export async function ping(ctx: ClientContext): Promise<string> {
  const attempts: Array<{ label: string; run: () => Promise<unknown> }> = [
    // On teste sur un endpoint REEL, jamais sur /consult/ping ni /search/ping.
    //
    // Ces deux routes de sante repondent au controle prealable CORS avec
    // `access-control-allow-headers` et `access-control-allow-methods`, mais
    // SANS `access-control-allow-origin`. Ce seul en-tete manquant suffit a
    // faire rejeter la requete par le navigateur — alors que les endpoints
    // utiles, eux, renvoient un CORS complet depuis n'importe quelle origine.
    // Tester la sante sur /ping revenait donc a diagnostiquer une panne CORS
    // generale la ou seule la route de test etait en cause.
    { label: "/list/code", run: () => call(ctx, "/list/code", { pageSize: 1, pageNumber: 1 }) },
    {
      label: "/search",
      run: () =>
        call(ctx, "/search", {
          fond: "CODE_DATE",
          recherche: {
            champs: [
              {
                typeChamp: "NUM_ARTICLE",
                criteres: [{ typeRecherche: "EXACTE", valeur: "111-1", operateur: "ET" }],
                operateur: "ET",
              },
            ],
            filtres: [{ facette: "NOM_CODE", valeurs: ["Code pénal"] }],
            pageNumber: 1,
            pageSize: 1,
            operateur: "ET",
            sort: "PERTINENCE",
            typePagination: "ARTICLE",
          },
        }),
    },
  ];

  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      await attempt.run();
      return attempt.label;
    } catch (error) {
      const message = error instanceof LegifranceError ? error.message : String(error);
      // Un refus d'authentification ne sera pas resolu par un autre endpoint.
      if (error instanceof LegifranceError && (error.kind === "auth" || error.kind === "quota")) throw error;
      failures.push(`${attempt.label} : ${message}`);
    }
  }

  throw new LegifranceError(
    "Le jeton d'authentification a bien ete obtenu, mais aucun point d'entree de l'API ne repond.\n" +
      failures.join("\n"),
    "server"
  );
}

function toEpochMs(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getTime();
}

/** Parcourt une reponse et collecte tout ce qui ressemble a un article. */
function collectArticles(node: unknown, out: SearchHit[] = [], inherited: Partial<SearchHit> = {}): SearchHit[] {
  if (Array.isArray(node)) {
    for (const item of node) collectArticles(item, out, inherited);
    return out;
  }
  if (!node || typeof node !== "object") return out;

  const record = node as Record<string, unknown>;
  const context: Partial<SearchHit> = { ...inherited };

  if (typeof record["titre"] === "string" && String(record["titre"]).toLowerCase().startsWith("code ")) {
    context.nomCode = record["titre"] as string;
  }
  if (typeof record["id"] === "string" && (record["id"] as string).startsWith("LEGITEXT")) {
    context.legiTextId = record["id"] as string;
  }

  const id = record["id"];
  if (typeof id === "string" && id.startsWith("LEGIARTI")) {
    out.push({
      id,
      ...(typeof record["num"] === "string" ? { num: record["num"] } : {}),
      ...(typeof record["titre"] === "string" ? { titre: record["titre"] } : {}),
      ...(context.legiTextId ? { legiTextId: context.legiTextId } : {}),
      ...(context.nomCode ? { nomCode: context.nomCode } : {}),
      ...(typeof record["dateVersion"] === "string" ? { dateVersion: record["dateVersion"] } : {}),
      ...(typeof record["values"] === "string" ? { extrait: record["values"] } : {}),
    });
  }

  for (const value of Object.values(record)) collectArticles(value, out, context);
  return out;
}

/**
 * Recherche un article par numero dans un code designe par son NOM.
 * L'identifiant LEGITEXT n'est pas necessaire ici : la facette NOM_CODE suffit,
 * ce qui evite d'avoir a resoudre le code au prealable.
 */
export async function searchArticleInCode(
  ctx: ClientContext,
  num: string,
  codeName: string,
  dateIso?: string
): Promise<SearchHit[]> {
  const payload: SearchPayload = {
    fond: "CODE_DATE",
    recherche: {
      champs: [
        {
          typeChamp: "NUM_ARTICLE",
          criteres: [{ typeRecherche: "EXACTE", valeur: num, operateur: "ET" }],
          operateur: "ET",
        },
      ],
      filtres: [
        { facette: "NOM_CODE", valeurs: [codeName] },
        { facette: "DATE_VERSION", singleDate: toEpochMs(dateIso ?? new Date().toISOString().slice(0, 10)) },
      ],
      pageNumber: 1,
      pageSize: 20,
      operateur: "ET",
      sort: "PERTINENCE",
      typePagination: "ARTICLE",
    },
  };

  const response = await call<unknown>(ctx, "/search", payload);
  const hits = collectArticles(response);

  // L'API elargit parfois la recherche : on ne garde que le numero exact.
  const wanted = num.replace(/[.\s]/g, "").toLowerCase();
  const exact = hits.filter((h) => (h.num ?? "").replace(/[.\s]/g, "").toLowerCase() === wanted);
  return exact.length > 0 ? exact : hits;
}

/** Recherche d'un article dans les textes non codifies (lois, decrets, arretes). */
export async function searchArticleInLoda(
  ctx: ClientContext,
  num: string,
  textQuery: string,
  dateIso?: string
): Promise<SearchHit[]> {
  const payload: SearchPayload = {
    fond: "LODA_DATE",
    recherche: {
      champs: [
        {
          typeChamp: "NUM_ARTICLE",
          criteres: [{ typeRecherche: "EXACTE", valeur: num, operateur: "ET" }],
          operateur: "ET",
        },
        {
          typeChamp: "TITLE",
          criteres: [{ typeRecherche: "TOUS_LES_MOTS_DANS_UN_CHAMP", valeur: textQuery, operateur: "ET" }],
          operateur: "ET",
        },
      ],
      filtres: [
        { facette: "DATE_VERSION", singleDate: toEpochMs(dateIso ?? new Date().toISOString().slice(0, 10)) },
      ],
      pageNumber: 1,
      pageSize: 20,
      operateur: "ET",
      sort: "PERTINENCE",
      typePagination: "ARTICLE",
    },
  };

  const response = await call<unknown>(ctx, "/search", payload);
  return collectArticles(response);
}

/** Contenu complet d'un article, avec ses versions et ses liens. */
export async function getArticle(ctx: ClientContext, id: string): Promise<RawArticle> {
  const response = await call<{ article?: RawArticle } & RawArticle>(ctx, "/consult/getArticle", { id });
  const article = response.article ?? response;
  if (!article || !article.id) {
    throw new LegifranceError("Article introuvable.", "notFound");
  }
  return article;
}

/** Liste des codes indexes, avec leur identifiant LEGITEXT. */
export async function listCodes(ctx: ClientContext): Promise<CodeListEntry[]> {
  const response = await call<unknown>(ctx, "/list/code", { pageSize: 200, pageNumber: 1, states: ["VIGUEUR"] });
  const out: CodeListEntry[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const id = record["id"];
    const titre = record["titre"] ?? record["title"];
    if (typeof id === "string" && id.startsWith("LEGITEXT") && typeof titre === "string") {
      out.push({
        id,
        titre,
        ...(typeof record["etat"] === "string" ? { etat: record["etat"] } : {}),
      });
    }
    Object.values(record).forEach(walk);
  };

  walk(response);
  // Dedoublonne : l'arborescence peut repeter un meme code.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/**
 * Sommaire d'un code a une date donnee. Utilise pour resoudre les plages
 * d'articles : l'ordre du sommaire fait foi, la numerotation n'etant pas
 * arithmetique (bis, ter, articles intercalaires, articles abroges).
 */
export async function getCodeTableOfContents(
  ctx: ClientContext,
  textId: string,
  dateIso: string
): Promise<Array<{ id: string; num: string }>> {
  const response = await call<unknown>(ctx, "/consult/legiPart", { textId, date: dateIso });
  const articles: Array<{ id: string; num: string }> = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const id = record["id"];
    const num = record["num"];
    if (typeof id === "string" && id.startsWith("LEGIARTI") && typeof num === "string") {
      articles.push({ id, num });
    }
    Object.values(record).forEach(walk);
  };

  walk(response);
  const seen = new Set<string>();
  return articles.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

export type { Fond };
