/**
 * Vue « Vérifier ».
 *
 * Balaye le document, repere les articles visés et signale ceux qui ont été
 * abrogés ou modifiés. Fonctionne sur le texte visible : les références
 * rédigées à la main sont traitées au même titre que celles insérées par
 * l'extension.
 */

import { isConfigured, type Settings } from "../settings/store";
import { getParagraphs, selectParagraph } from "../word/selection";
import { sortFindings, verifyDocument, type Finding, type FindingStatus } from "../services/verify";
import { LegifranceError } from "../api/types";
import { el, icon, mount, notice, toast } from "./dom";

const STATUS_LABEL: Record<FindingStatus, string> = {
  abroge: "Abrogé",
  modifieRecemment: "Modifié récemment",
  vigueur: "En vigueur",
  introuvable: "Introuvable",
  codeAmbigu: "Code ambigu",
  codeInconnu: "Code non reconnu",
  erreur: "Non vérifié",
};

export function renderVerify(root: HTMLElement, getSettings: () => Settings): void {
  const settings = getSettings();

  if (!isConfigured(settings)) {
    mount(root, notice("warn", "Renseignez vos identifiants PISTE dans les réglages avant de vérifier un document."));
    return;
  }

  const output = el("div", { class: "stack" });
  const includeValid = el("input", { type: "checkbox" });

  const run = async () => {
    mount(output, notice("info", "Lecture du document…"));
    try {
      const paragraphs = await getParagraphs();
      const progress = el("div", { class: "jt-hint", text: "Analyse…" });
      mount(output, progress);

      const findings = await verifyDocument(getSettings(), paragraphs, {
        recentMonths: 24,
        onProgress: (done, total) => {
          progress.textContent = `Vérification ${done} / ${total}…`;
        },
      });

      renderFindings(output, findings, includeValid.checked);
    } catch (error) {
      mount(output, notice("error", error instanceof LegifranceError ? error.message : String(error)));
    }
  };

  mount(
    root,
    el("div", { class: "stack" }, [
      el("div", { class: "jt-hint" }, [
        "La vérification indique l'état ACTUEL de chaque article visé. Elle ne peut pas dire si le texte cité ",
        "correspondait à la version en vigueur au moment de la rédaction : cette information n'existe pas dans le fichier.",
      ]),
      el("label", { class: "row" }, [includeValid, el("span", { text: " Afficher aussi les articles en vigueur" })]),
      el("button", { class: "btn primary", onclick: () => void run() }, [icon("check", 14), "Vérifier le document"]),
      output,
    ])
  );
}

function renderFindings(container: HTMLElement, findings: Finding[], includeValid: boolean): void {
  const sorted = sortFindings(findings);
  const shown = includeValid ? sorted : sorted.filter((f) => f.status !== "vigueur");

  if (findings.length === 0) {
    mount(container, notice("info", "Aucune référence d'article détectée dans le document."));
    return;
  }

  const counts = sorted.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.status] = (acc[finding.status] ?? 0) + 1;
    return acc;
  }, {});

  const summary = [
    counts["abroge"] ? `${counts["abroge"]} abrogé(s)` : null,
    counts["modifieRecemment"] ? `${counts["modifieRecemment"]} modifié(s) récemment` : null,
    counts["introuvable"] ? `${counts["introuvable"]} introuvable(s)` : null,
    counts["codeAmbigu"] || counts["codeInconnu"]
      ? `${(counts["codeAmbigu"] ?? 0) + (counts["codeInconnu"] ?? 0)} code(s) non résolu(s)`
      : null,
    counts["vigueur"] ? `${counts["vigueur"]} en vigueur` : null,
  ].filter(Boolean);

  mount(
    container,
    notice(
      counts["abroge"] ? "error" : counts["modifieRecemment"] ? "warn" : "ok",
      `${findings.length} référence(s) analysée(s) — ${summary.join(", ")}.`
    ),
    ...(shown.length === 0
      ? [el("div", { class: "jt-hint", text: "Rien à signaler." })]
      : shown.map((finding) =>
          el(
            "div",
            {
              class: "card card--clickable",
              onclick: () => {
                void selectParagraph(finding.paragraphId).then((found) => {
                  if (!found) toast("Ce paragraphe n'existe plus dans le document.");
                });
              },
            },
            [
              el("div", { class: "card__title" }, [
                el("span", { class: `status status--${finding.status}` }),
                `${finding.raw.trim()} — ${STATUS_LABEL[finding.status]}`,
              ]),
              el("div", { class: "card__meta", text: finding.message }),
            ]
          )
        ))
  );
}
