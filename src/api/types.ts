/**
 * Types de l'API Legifrance (plateforme PISTE).
 *
 * Les reponses sont typees de facon permissive : la documentation officielle
 * est un Swagger accessible apres inscription, et certains champs varient
 * selon le fond interroge. Chaque acces passe par un extracteur defensif
 * plutot que par un cast, pour qu'un champ manquant produise un message
 * clair et non une exception opaque.
 */

export type Fond = "CODE_DATE" | "CODE_ETAT" | "LODA_DATE" | "LODA_ETAT" | "JORF" | "ALL";

export interface PisteCredentials {
  clientId: string;
  clientSecret: string;
  /** Le bac a sable PISTE expose les memes routes sur un autre domaine. */
  sandbox: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/** Critere elementaire d'une recherche. */
export interface Critere {
  typeRecherche: "EXACTE" | "TOUS_LES_MOTS_DANS_UN_CHAMP" | "UN_DES_MOTS" | "AUCUN_DES_MOTS" | "EXPRESSION_EXACTE";
  valeur: string;
  operateur: "ET" | "OU";
}

export interface Champ {
  typeChamp: "NUM_ARTICLE" | "ARTICLE" | "TITLE" | "ALL" | "NUM";
  criteres: Critere[];
  operateur: "ET" | "OU";
}

export interface Filtre {
  facette: string;
  valeurs?: string[];
  singleDate?: number;
  dates?: { start: string; end: string };
}

export interface SearchPayload {
  fond: Fond;
  recherche: {
    champs: Champ[];
    filtres: Filtre[];
    pageNumber: number;
    pageSize: number;
    operateur: "ET" | "OU";
    sort: "PERTINENCE" | "DATE_ASC" | "DATE_DESC";
    typePagination: "ARTICLE" | "DEFAUT";
    secondSort?: string;
  };
}

/** Resultat de recherche, ramene aux champs dont l'extension a besoin. */
export interface SearchHit {
  id: string;
  titre?: string;
  num?: string;
  legiTextId?: string;
  nomCode?: string;
  dateVersion?: string;
  extrait?: string;
}

/** Article consolide renvoye par /consult/getArticle. */
export interface RawArticle {
  id: string;
  num?: string;
  texte?: string;
  texteHtml?: string;
  etat?: string;
  dateDebut?: string | number;
  dateFin?: string | number;
  cid?: string;
  /** Versions successives de l'article. */
  listArticle?: Array<{
    id: string;
    num?: string;
    dateDebut?: string | number;
    dateFin?: string | number;
    etat?: string;
  }>;
  /** Textes lies : citations, textes modificateurs, decrets d'application. */
  lienArt?: Array<{ id?: string; texte?: string; naturelien?: string; typelien?: string }>;
  context?: { titreTxt?: Array<{ titre?: string; id?: string }> };
}

/** Entree de la liste des codes (/list/code). */
export interface CodeListEntry {
  id: string;
  titre: string;
  etat?: string;
}

export class LegifranceError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "network" | "cors" | "quota" | "notFound" | "server" | "unknown",
    readonly status?: number
  ) {
    super(message);
    this.name = "LegifranceError";
  }
}
