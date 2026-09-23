/**
 * Verification du document.
 *
 * Les citations n'etant pas ancrees (choix arrete au cahier des charges §6),
 * la verification s'appuie sur le texte VISIBLE. Elle couvre donc aussi bien
 * les references redigees a la main que celles inserees par l'extension —
 * ce qui est en pratique un avantage : un document recu d'un confrere est
 * verifiable au meme titre.
 *
 * Ce qu'elle peut dire : l'etat ACTUEL de chaque article vise.
 * Ce qu'elle ne peut pas dire : si le texte cite correspond a la version en
 * vigueur au moment ou le document a ete redige, cette information n'existant
 * nulle part dans le fichier.
 */

import { detectReferences, type DetectedReference } from "../core/references";
import { currentVersion, formatDateFr, normalizeVersions, type ArticleVersion } from "../core/versions";
import { TTL, withCache } from "../api/cache";
import { getArticle, searchArticleInCode, type ClientContext } from "../api/legifrance";
import { LegifranceError } from "../api/types";
import type { Settings } from "../settings/store";
import type { ParagraphInfo } from "../word/selection";

export type FindingStatus =
  | "vigueur"
  | "modifieRecemment"
  | "abroge"
  | "introuvable"
  | "codeAmbigu"
  | "codeInconnu"
  | "erreur";

export interface Finding {
  paragraphId: string;
  raw: string;
  num: string;
  codeName: string;
  status: FindingStatus;
  message: string;
  /** Date de la derniere modification connue de l'article. */
  lastModified?: string;
}

export interface VerifyOptions {
  /** Fenetre au-dela de laquelle une modification n'est plus signalee, en mois. */
  recentMonths: number;
  /** Appelee apres chaque reference traitee, pour la barre de progression. */
  onProgress?: (done: number, total: number) => void;
}

export const DEFAULT_VERIFY_OPTIONS: VerifyOptions = { recentMonths: 24 };

function monthsSince(iso: string): number {
  const then = new Date(iso + "T12:00:00Z").getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / (1000 * 3600 * 24 * 30.44);
}

function statusOf(versions: ArticleVersion[], recentMonths: number): { status: FindingStatus; message: string; lastModified?: string } {
  const current = currentVersion(versions);
  if (!current) return { status: "introuvable", message: "Aucune version connue." };

  const today = new Date().toISOString().slice(0, 10);
  const abrogated = current.dateFin !== null && current.dateFin <= today;

  if (abrogated || (current.etat ?? "").toUpperCase().startsWith("ABROG")) {
    const veille = current.dateFin;
    return {
      status: "abroge",
      message: veille
        ? `Article abroge depuis le ${formatDateFr(veille)}.`
        : "Article abroge.",
      ...(veille ? { lastModified: veille } : {}),
    };
  }

  const age = monthsSince(current.dateDebut);
  if (age <= recentMonths) {
    return {
      status: "modifieRecemment",
      message: `Version en vigueur depuis le ${formatDateFr(current.dateDebut)} : verifiez que la citation est a jour.`,
      lastModified: current.dateDebut,
    };
  }

  return {
    status: "vigueur",
    message: `En vigueur, inchange depuis le ${formatDateFr(current.dateDebut)}.`,
    lastModified: current.dateDebut,
  };
}

async function checkReference(
  ctx: ClientContext,
  settings: Settings,
  reference: DetectedReference,
  num: string,
  options: VerifyOptions
): Promise<Omit<Finding, "paragraphId" | "raw">> {
  if (reference.resolution.kind === "ambiguous") {
    return {
      num,
      codeName: reference.codeInput,
      status: "codeAmbigu",
      message: `« ${reference.codeInput} » peut designer plusieurs codes : ${reference.resolution.candidates
        .map((c) => c.nom)
        .join(", ")}.`,
    };
  }
  if (reference.resolution.kind === "unknown") {
    return {
      num,
      codeName: reference.codeInput || "code non identifie",
      status: "codeInconnu",
      message: reference.codeInput
        ? `Code « ${reference.codeInput} » non reconnu.`
        : "Aucun code identifie pour cette reference.",
    };
  }

  const code = reference.resolution.code;
  try {
    const hits = await withCache(`search:${code.slug}:${num}:now`, TTL.search, () =>
      searchArticleInCode(ctx, num, code.nom)
    );
    if (hits.value.length === 0) {
      return {
        num,
        codeName: code.nom,
        status: "introuvable",
        message: `Aucun article ${num} dans le ${code.nom.toLowerCase()}.`,
      };
    }
    const article = await withCache(`article:${hits.value[0]!.id}`, TTL.article, () =>
      getArticle(ctx, hits.value[0]!.id)
    );
    const versions = normalizeVersions(
      (article.value.listArticle && article.value.listArticle.length > 0
        ? article.value.listArticle
        : [article.value]
      ).map((v) => ({
        id: v.id,
        dateDebut: v.dateDebut ?? "",
        dateFin: v.dateFin ?? null,
        ...(v.etat ? { etat: v.etat } : {}),
      }))
    );
    return { num, codeName: code.nom, ...statusOf(versions, options.recentMonths) };
  } catch (error) {
    const message =
      error instanceof LegifranceError ? error.message : "Verification impossible pour cette reference.";
    return { num, codeName: code.nom, status: "erreur", message };
  }
}

/**
 * Verifie toutes les references d'un document.
 * Le traitement est sequentiel : une rafale d'appels paralleles ferait tomber
 * les quotas PISTE sur un document un peu fourni.
 */
export async function verifyDocument(
  settings: Settings,
  paragraphs: ParagraphInfo[],
  options: VerifyOptions = DEFAULT_VERIFY_OPTIONS
): Promise<Finding[]> {
  const ctx: ClientContext = { credentials: settings.piste, transport: settings.transport };

  const tasks: Array<{ paragraph: ParagraphInfo; reference: DetectedReference; num: string }> = [];
  for (const paragraph of paragraphs) {
    for (const reference of detectReferences(paragraph.text, settings.customAbbreviations)) {
      for (const num of reference.numbers) tasks.push({ paragraph, reference, num });
    }
  }

  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const key = `${task.paragraph.id}|${task.num}|${task.reference.codeInput}`;
    if (seen.has(key)) {
      options.onProgress?.(i + 1, tasks.length);
      continue;
    }
    seen.add(key);

    const result = await checkReference(ctx, settings, task.reference, task.num, options);
    findings.push({ paragraphId: task.paragraph.id, raw: task.reference.raw, ...result });
    options.onProgress?.(i + 1, tasks.length);
  }

  return findings;
}

/** Ordre d'affichage : ce qui demande une action d'abord. */
export const STATUS_ORDER: FindingStatus[] = [
  "abroge",
  "modifieRecemment",
  "introuvable",
  "codeAmbigu",
  "codeInconnu",
  "erreur",
  "vigueur",
];

export function sortFindings(findings: Finding[]): Finding[] {
  return findings
    .slice()
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
}
