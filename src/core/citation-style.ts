/**
 * Composition d'une citation.
 *
 * Les quatre modeles figes d'origine (bloc / inline / note / brut) sont
 * devenus des PRESELECTIONS : elles ne font que remplir cette structure, dont
 * chaque element reste ensuite modifiable independamment. C'est ce qui permet
 * de coller a un style maison plutot qu'a un gabarit impose.
 *
 * Unites : les retraits et espacements sont exprimes en CENTIMETRES, l'unite
 * dans laquelle on raisonne en redaction. La conversion en points, unite de
 * l'API Word, est faite au moment de composer les blocs.
 */

export type HeadingForm = "long" | "court";
export type QuoteStyle = "francais" | "anglais" | "aucun";
export type VersionPlacement = "sousIntitule" | "finTexte" | "note";
export type SourcePlacement = "corps" | "note" | "aucune";
export type Alignment = "herite" | "justifie" | "gauche";
export type Inherit<T> = T | null;

export interface CitationStyle {
  /* --- Intitule : « Article 111-1 du code penal » --- */
  heading: {
    include: boolean;
    form: HeadingForm;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    /** Sur sa propre ligne, ou en tete du premier alinea. */
    ownParagraph: boolean;
  };

  /* --- Mention de version --- */
  version: {
    include: boolean;
    placement: VersionPlacement;
    /** « version en vigueur au 7 septembre 2026 » ou seulement la date. */
    complete: boolean;
    italic: boolean;
    parentheses: boolean;
  };

  /* --- Texte de l'article --- */
  text: {
    quotes: QuoteStyle;
    /** Guillemet ouvrant repete en tete de chaque alinea, usage typographique francais. */
    quoteEachAlinea: boolean;
    italic: boolean;
    bold: boolean;
  };

  /* --- Mise en forme du bloc --- */
  layout: {
    /**
     * Repart du style Normal et efface couleur et surlignage herites du point
     * d'insertion. Le gras et l'italique, eux, sont TOUJOURS imposes par les
     * reglages ci-dessus : une citation ne doit jamais prendre le gras de la
     * phrase qui la precede.
     */
    resetStyle: boolean;
    indent: boolean;
    /** Retrait gauche de tout le bloc, en centimetres. */
    indentCm: number;
    firstLineIndent: boolean;
    firstLineIndentCm: number;
    spaceBeforeCm: number;
    spaceAfterCm: number;
    alignment: Alignment;
    /** null = suit le style du document. */
    fontSizePt: Inherit<number>;
    fontName: Inherit<string>;
    lineSpacing: Inherit<number>;
  };

  /* --- Reference courte et source --- */
  reference: {
    /** Reference courte accolee au texte, « (C. pen., art. 111-1) ». */
    inlineAfterText: boolean;
    source: SourcePlacement;
    /** Ajoute la date de consultation a la mention de source. */
    withExtractionDate: boolean;
  };

  /* --- Citations groupees --- */
  group: {
    blankLineBetween: boolean;
    /** Repete l'intitule pour chaque article meme si l'intitule est desactive. */
    forceHeadingWhenMultiple: boolean;
  };
}

export const CM_TO_PT = 28.3464567;

export function cmToPt(cm: number): number {
  return Math.round(cm * CM_TO_PT * 100) / 100;
}

export const DEFAULT_STYLE: CitationStyle = {
  heading: { include: true, form: "long", bold: true, italic: false, underline: false, ownParagraph: true },
  version: { include: true, placement: "sousIntitule", complete: true, italic: true, parentheses: true },
  text: { quotes: "francais", quoteEachAlinea: false, italic: false, bold: false },
  layout: {
    resetStyle: false,
    indent: false,
    indentCm: 1,
    firstLineIndent: false,
    firstLineIndentCm: 0.5,
    spaceBeforeCm: 0.2,
    spaceAfterCm: 0.2,
    alignment: "herite",
    fontSizePt: null,
    fontName: null,
    lineSpacing: null,
  },
  reference: { inlineAfterText: false, source: "corps", withExtractionDate: true },
  group: { blankLineBetween: true, forceHeadingWhenMultiple: true },
};

/** Copie profonde, pour ne jamais partager une reference avec les preselections. */
export function cloneStyle(style: CitationStyle): CitationStyle {
  return {
    heading: { ...style.heading },
    version: { ...style.version },
    text: { ...style.text },
    layout: { ...style.layout },
    reference: { ...style.reference },
    group: { ...style.group },
  };
}

export type PresetId = "bloc" | "inline" | "note" | "brut";

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  style: CitationStyle;
}

function preset(id: PresetId, label: string, description: string, patch: (s: CitationStyle) => void): Preset {
  const style = cloneStyle(DEFAULT_STYLE);
  patch(style);
  return { id, label, description, style };
}

export const PRESETS: Preset[] = [
  preset("bloc", "Bloc", "Intitulé, mention de version, texte entre guillemets", () => {
    /* c'est le style par defaut */
  }),
  preset("inline", "Inline", "« texte » (C. pén., art. 111-1)", (s) => {
    s.heading.include = false;
    s.version.include = false;
    s.reference.inlineAfterText = true;
    s.reference.source = "aucune";
    s.group.blankLineBetween = false;
  }),
  preset("note", "Note", "Texte dans le corps, référence en note de bas de page", (s) => {
    s.heading.include = false;
    s.version.include = true;
    s.version.placement = "note";
    s.reference.source = "note";
  }),
  preset("brut", "Brut", "Texte seul, sans guillemets ni référence", (s) => {
    s.heading.include = false;
    s.version.include = false;
    s.text.quotes = "aucun";
    s.reference.source = "aucune";
    s.layout.spaceBeforeCm = 0;
    s.layout.spaceAfterCm = 0;
  }),
];

export function presetById(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}

/**
 * Reconnait la preselection correspondant a un style, pour afficher son nom
 * tant que l'utilisateur n'a rien modifie.
 */
export function matchingPreset(style: CitationStyle): PresetId | null {
  const serialized = JSON.stringify(style);
  return PRESETS.find((p) => JSON.stringify(p.style) === serialized)?.id ?? null;
}

/** Fusion defensive : un reglage enregistre par une version anterieure peut etre partiel. */
export function mergeStyle(stored: unknown): CitationStyle {
  const base = cloneStyle(DEFAULT_STYLE);
  if (!stored || typeof stored !== "object") return base;
  const s = stored as Partial<CitationStyle>;
  return {
    heading: { ...base.heading, ...(s.heading ?? {}) },
    version: { ...base.version, ...(s.version ?? {}) },
    text: { ...base.text, ...(s.text ?? {}) },
    layout: { ...base.layout, ...(s.layout ?? {}) },
    reference: { ...base.reference, ...(s.reference ?? {}) },
    group: { ...base.group, ...(s.group ?? {}) },
  };
}
