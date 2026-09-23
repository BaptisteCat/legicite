/**
 * Authentification OAuth2 aupres de PISTE (flux client_credentials).
 *
 * Le secret n'est jamais ecrit en dur : il est saisi par l'utilisateur dans les
 * reglages et conserve dans le stockage de l'add-in, sur son poste. Le code de
 * l'extension etant integralement lisible cote client, tout secret embarque
 * serait public.
 */

import { request, type TransportConfig } from "./transport";
import { LegifranceError, type PisteCredentials, type TokenResponse } from "./types";

const TOKEN_URL = {
  production: "https://oauth.piste.gouv.fr/api/oauth/token",
  sandbox: "https://sandbox-oauth.piste.gouv.fr/api/oauth/token",
} as const;

export const API_BASE = {
  production: "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app",
  sandbox: "https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app",
} as const;

export function apiBase(credentials: PisteCredentials): string {
  return credentials.sandbox ? API_BASE.sandbox : API_BASE.production;
}

interface CachedToken {
  token: string;
  expiresAt: number;
  fingerprint: string;
}

let cached: CachedToken | null = null;

/** Empreinte non reversible des identifiants, pour invalider le jeton s'ils changent. */
function fingerprint(credentials: PisteCredentials): string {
  return `${credentials.clientId}|${credentials.sandbox ? "s" : "p"}|${credentials.clientSecret.length}`;
}

export function clearToken(): void {
  cached = null;
}

/**
 * Jeton d'acces, renouvele automatiquement. La marge de 60 secondes evite
 * qu'un jeton expire entre l'obtention et l'appel.
 */
export async function getAccessToken(
  credentials: PisteCredentials,
  transport: TransportConfig
): Promise<string> {
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new LegifranceError(
      "Identifiants PISTE non renseignes. Ouvrez les reglages de l'extension pour les saisir.",
      "auth"
    );
  }

  const print = fingerprint(credentials);
  if (cached && cached.fingerprint === print && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const url = credentials.sandbox ? TOKEN_URL.sandbox : TOKEN_URL.production;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: "openid",
  }).toString();

  const response = await request(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    },
    transport
  );

  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      throw new LegifranceError(
        "PISTE a refuse les identifiants a l'authentification. Verifiez le client ID et le " +
          "secret, et que la case « bac a sable » correspond bien a l'application utilisee " +
          "(les identifiants sandbox et production sont distincts).",
        "auth",
        response.status
      );
    }
    throw new LegifranceError(`Echec de l'authentification PISTE (${response.status}).`, "auth", response.status);
  }

  const data = (await response.json()) as TokenResponse;
  if (!data.access_token) {
    throw new LegifranceError("Reponse d'authentification inattendue : aucun jeton renvoye.", "auth");
  }

  cached = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    fingerprint: print,
  };
  return cached.token;
}
