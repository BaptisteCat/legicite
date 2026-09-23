/**
 * Reglages de l'extension.
 *
 * Stockage dans localStorage : les abreviations personnelles sont LOCALES a
 * chaque poste (choix arrete au cahier des charges §10), et Word n'expose pas
 * de stockage itinerant pour les add-ins de document.
 *
 * Avertissement assume : localStorage n'est pas chiffre. Le secret PISTE y est
 * lisible par tout programme ayant acces au profil Windows de l'utilisateur.
 * C'est le meilleur niveau atteignable pour un add-in web ; l'interface le
 * signale explicitement.
 */

import { DEFAULT_STYLE, mergeStyle, presetById, type CitationStyle, type PresetId } from "../core/citation-style";
import { DEFAULT_PROXY_URL, type TransportMode } from "../api/transport";

export interface Settings {
  piste: {
    clientId: string;
    clientSecret: string;
    sandbox: boolean;
  };
  transport: {
    mode: TransportMode;
    proxyUrl: string;
  };
  /** Composition des citations : chaque element est parametrable. */
  citation: CitationStyle;
  /**
   * Commande /citart : cite l'article annonce par la phrase introductive qui
   * precede, au lieu de le renseigner a nouveau.
   */
  citart: {
    /**
     * Masque l'intitule : la phrase introductive nomme deja l'article, le
     * repeter serait redondant.
     */
    hideHeading: boolean;
    /** Nombre de paragraphes remontes a la recherche de la reference. */
    lookback: number;
    /** Si la phrase vise plusieurs articles, les citer tous ou seulement le premier. */
    citeAll: boolean;
  };
  /** Seuil d'avertissement pour les articles longs, en caracteres. */
  longArticleThreshold: number;
  /** Declenchement de /art a la frappe dans le document. */
  triggerInDocument: boolean;
  /**
   * Prechargement de l'article pendant la frappe, avant validation.
   * Rend l'insertion quasi instantanee au prix de quelques appels
   * supplementaires sur des commandes finalement abandonnees.
   */
  prefetch: boolean;
  /** Abreviations de saisie personnelles : saisie normalisee -> slug de code. */
  customAbbreviations: Record<string, string>;
  /** Abreviations d'affichage redefinies : slug -> texte affiche. */
  displayOverrides: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  piste: { clientId: "", clientSecret: "", sandbox: false },
  transport: { mode: "auto", proxyUrl: DEFAULT_PROXY_URL },
  citation: DEFAULT_STYLE,
  citart: { hideHeading: true, lookback: 3, citeAll: true },
  longArticleThreshold: 2000,
  triggerInDocument: true,
  prefetch: true,
  customAbbreviations: {},
  displayOverrides: {},
};

const KEY = "legiword:settings";

let current: Settings | null = null;
const listeners = new Set<(settings: Settings) => void>();

/**
 * Le relais a d'abord tourne sur un second port (http://localhost:7357) avant
 * d'etre monte sur la meme origine que le volet. On efface l'ancienne valeur
 * pour ne pas laisser un reglage enregistre pointer vers un port desormais mort.
 */
const OBSOLETE_PROXY_URLS = new Set(["http://localhost:7357", "http://127.0.0.1:7357"]);

/**
 * Les reglages ont d'abord porte un simple identifiant de modele (`template`)
 * avant de devenir un style compose. On convertit l'ancien reglage en la
 * preselection correspondante, pour ne pas reinitialiser les preferences.
 */
function migrateCitation(stored: Partial<Settings> & { template?: PresetId }): CitationStyle {
  if (stored.citation) return mergeStyle(stored.citation);
  if (stored.template) return presetById(stored.template).style;
  return DEFAULT_STYLE;
}

function merge(stored: Partial<Settings> & { template?: PresetId }): Settings {
  const transport = { ...DEFAULT_SETTINGS.transport, ...(stored.transport ?? {}) };
  if (OBSOLETE_PROXY_URLS.has(transport.proxyUrl)) transport.proxyUrl = DEFAULT_SETTINGS.transport.proxyUrl;

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    citation: migrateCitation(stored),
    citart: { ...DEFAULT_SETTINGS.citart, ...(stored.citart ?? {}) },
    piste: { ...DEFAULT_SETTINGS.piste, ...(stored.piste ?? {}) },
    transport,
    customAbbreviations: { ...(stored.customAbbreviations ?? {}) },
    displayOverrides: { ...(stored.displayOverrides ?? {}) },
  };
}

export function loadSettings(): Settings {
  if (current) return current;
  try {
    const raw = localStorage.getItem(KEY);
    current = raw ? merge(JSON.parse(raw) as Partial<Settings>) : { ...DEFAULT_SETTINGS };
  } catch {
    current = { ...DEFAULT_SETTINGS };
  }
  return current;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = merge({ ...loadSettings(), ...patch });
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible : les reglages restent valables pour la session */
  }
  listeners.forEach((listener) => listener(next));
  return next;
}

export function onSettingsChange(listener: (settings: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isConfigured(settings: Settings = loadSettings()): boolean {
  return settings.piste.clientId.trim() !== "" && settings.piste.clientSecret.trim() !== "";
}

/** Export des abreviations personnelles, pour transmission a un collegue. */
export function exportAbbreviations(settings: Settings = loadSettings()): string {
  return JSON.stringify(
    {
      format: "legiword-abreviations",
      version: 1,
      customAbbreviations: settings.customAbbreviations,
      displayOverrides: settings.displayOverrides,
    },
    null,
    2
  );
}

export interface ImportResult {
  ok: boolean;
  added: number;
  error?: string;
}

export function importAbbreviations(json: string): ImportResult {
  try {
    const parsed = JSON.parse(json) as {
      format?: string;
      customAbbreviations?: Record<string, string>;
      displayOverrides?: Record<string, string>;
    };
    if (parsed.format !== "legiword-abreviations") {
      return { ok: false, added: 0, error: "Ce fichier n'est pas un export d'abreviations LegiWord." };
    }
    const settings = loadSettings();
    const custom = { ...settings.customAbbreviations, ...(parsed.customAbbreviations ?? {}) };
    const display = { ...settings.displayOverrides, ...(parsed.displayOverrides ?? {}) };
    const added =
      Object.keys(custom).length - Object.keys(settings.customAbbreviations).length +
      Object.keys(display).length - Object.keys(settings.displayOverrides).length;
    saveSettings({ customAbbreviations: custom, displayOverrides: display });
    return { ok: true, added };
  } catch {
    return { ok: false, added: 0, error: "Fichier illisible." };
  }
}
