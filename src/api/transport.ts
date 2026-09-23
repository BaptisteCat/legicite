/**
 * Couche de transport.
 *
 * Un add-in Word s'execute dans un navigateur (WebView2 sous Windows) et reste
 * donc soumis a la politique CORS. Si api.piste.gouv.fr ne renvoie pas
 * d'en-tete Access-Control-Allow-Origin, l'appel direct depuis le volet echoue,
 * quels que soient les identifiants.
 *
 * On ne peut pas le savoir sans compte PISTE : le transport essaie donc
 * l'appel direct, et bascule automatiquement sur un relais LOCAL (lance sur le
 * poste de l'utilisateur, cf. tools/legiword-proxy.mjs) si le navigateur bloque
 * la requete. Le choix "aucun serveur a heberger" reste ainsi tenable.
 *
 * Un echec CORS est indiscernable d'une panne reseau depuis le code appelant :
 * `fetch` rejette avec un TypeError sans detail, par conception. C'est pourquoi
 * la bascule est declenchee par ce symptome et non par un code d'erreur.
 */

import { LegifranceError } from "./types";

export type TransportMode = "auto" | "direct" | "proxy";

export interface TransportConfig {
  mode: TransportMode;
  /** Relais local, par defaut http://localhost:7357 */
  proxyUrl: string;
}

/**
 * Vide = meme origine que le volet. Le relais est servi par le meme serveur,
 * sous /relay : il n'y a donc ni CORS, ni contenu mixte, ni second port a
 * demarrer. Une valeur non vide permet de designer un relais externe.
 */
export const DEFAULT_PROXY_URL = "";

/** Mode effectivement retenu pour la session, une fois la bascule tranchee. */
let resolvedMode: "direct" | "proxy" | null = null;

export function resetTransportMode(): void {
  resolvedMode = null;
}

export function currentTransportMode(): "direct" | "proxy" | null {
  return resolvedMode;
}

function proxied(proxyUrl: string, target: string): string {
  return `${proxyUrl.replace(/\/$/, "")}/relay?url=${encodeURIComponent(target)}`;
}

interface RequestOptions {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

async function attempt(url: string, options: RequestOptions): Promise<Response> {
  try {
    return await fetch(url, {
      method: options.method,
      headers: options.headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
    });
  } catch (error) {
    // fetch ne rejette que sur erreur reseau ou blocage CORS.
    throw new LegifranceError(
      error instanceof Error ? error.message : "Requete bloquee",
      "cors"
    );
  }
}

/**
 * Effectue la requete en choisissant le transport. La bascule direct -> relais
 * n'est tentee qu'une fois par session : au-dela, le mode retenu est reutilise.
 */
export async function request(
  targetUrl: string,
  options: RequestOptions,
  config: TransportConfig
): Promise<Response> {
  const useProxy = (mode: "direct" | "proxy") =>
    mode === "proxy" ? proxied(config.proxyUrl, targetUrl) : targetUrl;

  if (config.mode !== "auto") {
    resolvedMode = config.mode;
    return attempt(useProxy(config.mode), options);
  }

  if (resolvedMode) return attempt(useProxy(resolvedMode), options);

  try {
    const response = await attempt(targetUrl, options);
    resolvedMode = "direct";
    return response;
  } catch (error) {
    if (!(error instanceof LegifranceError) || error.kind !== "cors") throw error;
    try {
      const response = await attempt(proxied(config.proxyUrl, targetUrl), options);
      resolvedMode = "proxy";
      return response;
    } catch {
      throw new LegifranceError(
        "Impossible de joindre l'API Legifrance : la requete n'a pas abouti. " +
          "Verifiez votre connexion. L'API accepte normalement les appels directs " +
          "depuis le navigateur, aucun relais n'est necessaire.",
        "cors"
      );
    }
  }
}

/** Traduit un statut HTTP en erreur exploitable par l'interface. */
export async function toError(response: Response): Promise<LegifranceError> {
  const status = response.status;
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 400);
  } catch {
    /* corps illisible */
  }

  if (status === 401 || status === 403) {
    // Le 403 vient le plus souvent du consentement aux CGU, etape distincte de
    // l'abonnement a l'API et facile a manquer : on la cite en premier.
    return new LegifranceError(
      status === 403
        ? "Acces refuse par PISTE. Trois causes possibles, dans l'ordre de frequence : " +
          "1) les CGU de l'API n'ont pas ete acceptees (PISTE > API > Consentement CGU API) ; " +
          "2) l'application n'est pas abonnee a l'API Legifrance ; " +
          "3) le client ID ou le secret est errone."
        : "Identifiants PISTE refuses. Verifiez le client ID et le secret dans les reglages.",
      "auth",
      status
    );
  }
  if (status === 404) return new LegifranceError("Ressource introuvable.", "notFound", status);
  if (status === 429) {
    return new LegifranceError(
      "Quota PISTE depasse. Les quotas sont consultables sur piste.gouv.fr, onglet Applications.",
      "quota",
      status
    );
  }
  if (status >= 500) {
    // On expose le corps renvoye : une passerelle repond souvent 500 pour une
    // route inexistante ou un payload mal forme, et le message le dit.
    return new LegifranceError(
      `L'API Legifrance a repondu ${status}${detail ? ` : ${detail}` : " sans detail"}`,
      "server",
      status
    );
  }
  return new LegifranceError(`Erreur ${status}${detail ? ` : ${detail}` : ""}`, "unknown", status);
}
