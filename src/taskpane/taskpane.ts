/**
 * Volet lateral : coquille de l'application et parcours de citation.
 *
 * Principe d'interface repris du cahier des charges : rien n'est insere sans
 * confirmation des lors qu'un doute subsiste (code ambigu, plusieurs versions
 * dans l'annee, article long, hors periode d'existence).
 *
 * Les reglages ne sont plus un onglet mais une fenetre a part entiere, ouverte
 * par le bouton d'engrenage : ils sont trop nombreux pour tenir dans la largeur
 * d'un volet.
 */


import { resolveCode, type CodeEntry } from "../core/abbreviations";
import { countCharacters, firstAlineas, type Block } from "../core/blocks";
import { renderGroup, type ArticleData } from "../core/citation";
import { parseCommand, type ArticleSpec, type DateSpec } from "../core/parser";
import { detectInSelection, findIntroducedReferences, type DetectedReference } from "../core/references";
import type { CitationStyle } from "../core/citation-style";
import { formatPeriod, type ArticleVersion } from "../core/versions";
import { getSelectedText, readParagraphsBeforeSelection } from "../word/selection";
import {
  loadVersion,
  lookupArticle,
  lookupMany,
  prefetchArticles,
  resolveArticleNumbers,
  MAX_RANGE_SIZE,
} from "../services/articles";
import { isConfigured, loadSettings, onSettingsChange, saveSettings, type Settings } from "../settings/store";
import { insertCitation, replaceTriggerAndInsert } from "../word/insert";
import {
  isTriggerSupported,
  resumeWatcher,
  startTriggerWatcher,
  stopTriggerWatcher,
  suspendWatcher,
} from "../word/watcher";
import { LegifranceError } from "../api/types";
import { el, icon, mount, notice, spinner, toast } from "./dom";
import { renderBlocks } from "./preview";
import { renderVerify } from "./verify-view";

type ViewName = "search" | "verify";

const view = () => document.getElementById("view") as HTMLElement;
let settings: Settings = loadSettings();
let currentView: ViewName = "search";
/** Derniere saisie, conservee pour reprendre apres une desambiguisation. */
let lastQuery = "";
/** References reperees dans la selection courante, alimentees par Word. */
let selectionRefs: DetectedReference[] = [];

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Word) {
    mount(view(), notice("error", "LégiWord ne fonctionne que dans Word."));
    return;
  }

  settings = loadSettings();
  onSettingsChange((next) => {
    settings = next;
    updateConnectionPill();
  });

  registerRibbonToggle();
  void ensureRuntimeStartsWithDocument();

  setupChrome();
  updateConnectionPill();
  watchSelection();
  navigate("search");
  // Sans identifiants, rien n'est possible : on ouvre directement les reglages.
  // Mais seulement si le volet est VISIBLE : avec le runtime partage, ce code
  // s'execute aussi a l'ouverture d'un document, volet ferme — faire surgir
  // une fenetre de reglages a ce moment-la serait intrusif.
  if (!isConfigured(settings) && paneVisible) openSettingsDialog();
  void refreshSelection();

  await restartTrigger();
});

/* ------------------------------------------------------------------ */
/* Bascule du volet depuis le ruban                                     */
/* ------------------------------------------------------------------ */

/**
 * Visibilite courante du volet.
 *
 * Office n'expose pas de lecture directe : on part de l'etat de la page, puis
 * on suit les changements. Une supposition initiale fausse ne coute qu'un clic,
 * l'evenement remettant ensuite l'etat d'aplomb.
 */
let paneVisible = !document.hidden;

/**
 * Branche le bouton du ruban sur une bascule.
 *
 * Le manifeste declare `ExecuteFunction` plutot que `ShowTaskpane` : ce dernier
 * ouvre le volet a chaque clic sans jamais le refermer. La fonction ci-dessous,
 * portee par le runtime partage, alterne ouverture et fermeture.
 */
function registerRibbonToggle(): void {
  try {
    Office.addin.onVisibilityModeChanged((args) => {
      paneVisible = args.visibilityMode === Office.VisibilityMode.taskpane;
    });
  } catch {
    // Runtime partage indisponible : le bouton restera sans effet, le volet
    // s'ouvrant alors par le menu contextuel.
  }

  // Le volet peut aussi etre ferme par sa croix, sans passer par le ruban.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) paneVisible = true;
  });

  try {
    Office.actions.associate("basculerVolet", async () => {
      try {
        if (paneVisible) {
          await Office.addin.hide();
          paneVisible = false;
        } else {
          await Office.addin.showAsTaskpane();
          paneVisible = true;
        }
      } catch {
        // En cas d'echec, on tente au moins l'ouverture : un bouton qui
        // n'ouvre rien est pire qu'un bouton qui ne referme pas.
        try {
          await Office.addin.showAsTaskpane();
          paneVisible = true;
        } catch {
          /* rien de plus a tenter */
        }
      }
    });
  } catch {
    /* Office.actions indisponible */
  }
}

/**
 * Demande a Office de demarrer le runtime avec le document.
 *
 * Deux benefices : le premier clic sur le ruban bascule sans attendre le
 * chargement, et le declencheur `/art` fonctionne volet ferme — il ne
 * fonctionnait jusqu'ici que pendant que le volet etait ouvert.
 */
async function ensureRuntimeStartsWithDocument(): Promise<void> {
  try {
    const current = await Office.addin.getStartupBehavior();
    if (current !== Office.StartupBehavior.load) {
      await Office.addin.setStartupBehavior(Office.StartupBehavior.load);
    }
  } catch {
    /* non pris en charge : sans consequence, le volet fonctionne a l'ouverture */
  }
}

function setupChrome(): void {
  document.getElementById("tabs")?.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset["view"] as ViewName));
  });
  document.getElementById("settings")?.addEventListener("click", () => openSettingsDialog());
}

function navigate(name: ViewName): void {
  currentView = name;
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset["view"] === name));
  });

  if (name === "search") renderSearch();
  else renderVerify(view(), () => settings);
}

function updateConnectionPill(): void {
  const pill = document.getElementById("connection");
  if (!pill) return;
  // `.jt-status` du kit : pastille grise au repos, verte avec halo en `.is-on`.
  if (!isConfigured(settings)) {
    pill.className = "jt-status";
    pill.textContent = "À configurer";
  } else {
    pill.className = "jt-status is-on";
    pill.textContent = settings.piste.sandbox ? "Bac à sable" : "Connecté";
  }
}

/* ------------------------------------------------------------------ */
/* Fenetre de reglages                                                 */
/* ------------------------------------------------------------------ */

let dialogHandle: Office.Dialog | null = null;

function openSettingsDialog(): void {
  if (dialogHandle) {
    try {
      dialogHandle.close();
    } catch {
      /* deja fermee */
    }
    dialogHandle = null;
  }

  const url = new URL("dialog.html", window.location.href).href;

  Office.context.ui.displayDialogAsync(
    url,
    { height: 82, width: 68, displayInIframe: false },
    (result) => {
      if (result.status !== Office.AsyncResultStatus.Succeeded) {
        toast("Impossible d'ouvrir la fenêtre de réglages.", 5000);
        return;
      }

      dialogHandle = result.value;

      dialogHandle.addEventHandler(Office.EventType.DialogMessageReceived, (event) => {
        const message = (event as { message?: string }).message ?? "";
        let payload: { type?: string; settings?: Settings } = {};
        try {
          payload = JSON.parse(message) as { type?: string; settings?: Settings };
        } catch {
          /* message non structure */
        }

        // La fenetre s'ouvre hors iframe : elle ne partage pas le localStorage
        // du volet. Les reglages transitent donc explicitement par la messagerie,
        // le volet restant la seule autorite sur leur enregistrement.
        if (payload.type === "ready") {
          try {
            dialogHandle?.messageChild(JSON.stringify({ type: "settings", settings }));
          } catch {
            // DialogApi 1.2 indisponible : la fenetre se rabattra sur son
            // propre stockage, partage seulement si elle s'ouvre en iframe.
          }
          return;
        }

        if (payload.type === "settings-saved" && payload.settings) {
          settings = saveSettings(payload.settings);
          updateConnectionPill();
          toast("Réglages enregistrés.");
        }

        dialogHandle?.close();
        dialogHandle = null;
        void restartTrigger();
        if (currentView === "search") renderSearch();
      });

      dialogHandle.addEventHandler(Office.EventType.DialogEventReceived, () => {
        dialogHandle = null;
        settings = loadSettings();
        updateConnectionPill();
      });
    }
  );
}

/* ------------------------------------------------------------------ */
/* Consultation depuis la selection (clic droit / bouton du ruban)      */
/* ------------------------------------------------------------------ */

function watchSelection(): void {
  try {
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, () => {
      void refreshSelection();
    });
  } catch {
    // Sans cet evenement, la selection reste lue a l'ouverture du volet.
  }
}

async function refreshSelection(): Promise<void> {
  try {
    const text = await getSelectedText();
    selectionRefs = text ? detectInSelection(text, settings.customAbbreviations) : [];
  } catch {
    selectionRefs = [];
  }
  if (currentView === "search") {
    const banner = document.getElementById("selection-banner");
    if (banner) mount(banner, ...selectionBannerChildren());
  }
}

function selectionBannerChildren(): HTMLElement[] {
  const usable = selectionRefs.filter((ref) => ref.resolution.kind === "resolved");
  if (usable.length === 0) return [];

  return usable.flatMap((ref) =>
    ref.numbers.map((num) => {
      const code = ref.resolution.kind === "resolved" ? ref.resolution.code : null;
      if (!code) return el("div", {});
      return el(
        "div",
        {
          class: "card card--clickable",
          onclick: () => {
            const results = document.getElementById("results");
            if (results) void fetchAndRender(results, code, { type: "list", numbers: [num] }, undefined);
          },
        },
        [
          el("div", { class: "card__title", text: `Consulter l'article ${num}` }),
          el("div", { class: "card__meta", text: `${code.nom} · repéré dans la sélection` }),
        ]
      );
    })
  );
}

/* ------------------------------------------------------------------ */
/* Vue « Citer »                                                       */
/* ------------------------------------------------------------------ */

function renderSearch(): void {
  const root = view();

  if (!isConfigured(settings)) {
    mount(
      root,
      notice("warn", "Renseignez vos identifiants PISTE pour interroger Légifrance."),
      el("button", { class: "btn primary", onclick: () => openSettingsDialog() }, ["Ouvrir les réglages"])
    );
    return;
  }

  const input = el("input", {
    type: "text",
    id: "query",
    placeholder: "111-1 cpen   ·   /artv 1353 cciv 2020",
    value: lastQuery,
    autocomplete: "off",
  });

  const results = el("div", { id: "results", class: "stack" });

  const submit = () => {
    lastQuery = input.value.trim();
    if (lastQuery) void runQuery(lastQuery, results);
  };

  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") submit();
  });

  mount(
    root,
    el("div", { class: "stack" }, [
      el("div", { id: "selection-banner", class: "stack-tight" }, selectionBannerChildren()),
      el("div", {}, [
        el("label", { for: "query", text: "Article à citer" }),
        el("div", { class: "row" }, [input, el("button", { class: "btn primary", onclick: submit }, [icon("search", 14), "Chercher"])]),
        el("div", { class: "jt-hint" }, [
          "Syntaxes : ",
          el("code", { text: "111-1 cpen" }),
          " · ",
          el("code", { text: "111-1, 111-2 cpen" }),
          " · ",
          el("code", { text: "111-1 à 111-5 cpen" }),
          " · ",
          el("code", { text: "/artv 1353 cciv 2020" }),
        ]),
        el("div", { class: "jt-hint" }, [
          el("code", { text: "/citart" }),
          " cite l'article annoncé par la phrase précédant le curseur, sans le renseigner.",
        ]),
      ]),
      results,
    ])
  );

  input.focus();
}

async function runQuery(raw: string, container: HTMLElement): Promise<void> {
  mount(container, spinner("Recherche…"));

  // Dans le volet, le prefixe est facultatif : « 111-1 cpen » vaut « /art 111-1 cpen ».
  const command = /^\s*\//.test(raw) ? raw : `/art ${raw}`;
  const parsed = parseCommand(command);

  if (!parsed.ok) {
    mount(container, notice("error", parsed.error), parsed.hint ? el("div", { class: "jt-hint", text: parsed.hint }) : null);
    return;
  }

  if (parsed.command === "citart") {
    const target = await findCitartTarget(null);
    if (target.kind !== "ok") {
      mount(container, notice("warn", citartFailure(target)));
      return;
    }
    mount(
      container,
      notice("info", `Article annoncé par : « ${target.source} »`),
      spinner("Consultation de Légifrance…")
    );
    await fetchAndRender(
      container,
      target.code,
      { type: "list", numbers: target.numbers },
      parsed.date,
      citartStyle()
    );
    return;
  }

  const resolution = resolveCode(parsed.codeInput, settings.customAbbreviations);

  if (resolution.kind === "ambiguous") {
    renderCodeChoice(container, resolution.candidates, parsed.articles, parsed.date, resolution.reason);
    return;
  }
  if (resolution.kind === "unknown") {
    if (resolution.suggestions.length === 0) {
      mount(container, notice("error", `Code « ${parsed.codeInput} » non reconnu.`));
      return;
    }
    renderCodeChoice(container, resolution.suggestions, parsed.articles, parsed.date, "approx", parsed.codeInput);
    return;
  }

  if (resolution.warning) toast(resolution.warning, 6000);
  await fetchAndRender(container, resolution.code, parsed.articles, parsed.date);
}

function renderCodeChoice(
  container: HTMLElement,
  candidates: CodeEntry[],
  articles: ArticleSpec,
  date: DateSpec | undefined,
  reason: "collision" | "approx",
  typed?: string
): void {
  mount(
    container,
    notice(
      "info",
      reason === "collision"
        ? "Cette abréviation peut désigner plusieurs codes. Précisez lequel."
        : `« ${typed ?? ""} » n'a pas été reconnu. Vouliez-vous dire :`
    ),
    ...candidates.map((code) =>
      el("div", { class: "card card--clickable", onclick: () => void fetchAndRender(container, code, articles, date) }, [
        el("div", { class: "card__title", text: code.nom }),
        el("div", { class: "card__meta", text: `Saisie : ${code.alias[0] ?? code.slug} · Affichage : ${code.abrevAffichage}` }),
      ])
    )
  );
}

async function fetchAndRender(
  container: HTMLElement,
  code: CodeEntry,
  articles: ArticleSpec,
  date: DateSpec | undefined,
  style: CitationStyle = settings.citation
): Promise<void> {
  mount(container, spinner("Consultation de Légifrance…"));

  try {
    const range = await resolveArticleNumbers(settings, articles, code, date);
    if (range.truncated) toast(`Plage tronquée aux ${MAX_RANGE_SIZE} premiers articles.`, 6000);

    // Resolution en parallele : la latence ne croit plus avec le nombre d'articles.
    const outcomes = await lookupMany(settings, range.numbers, code, date);

    const collected: ArticleData[] = [];
    const problems: HTMLElement[] = [];

    for (const outcome of outcomes) {
      switch (outcome.kind) {
        case "article":
          collected.push(outcome.data);
          break;
        case "versionChoice":
          renderVersionChoice(container, outcome.versions, outcome.year, outcome.num, outcome.code);
          return;
        case "outOfRange":
          problems.push(notice("warn", `Article ${outcome.num} : ${outcome.message}`));
          break;
        case "notFound":
          problems.push(notice("error", `Aucun article ${outcome.num} dans le ${outcome.code.nom.toLowerCase()}.`));
          break;
      }
    }

    if (collected.length === 0) {
      mount(container, ...(problems.length > 0 ? problems : [notice("error", "Aucun article trouvé.")]));
      return;
    }

    renderResult(container, collected, problems, style);
  } catch (error) {
    mount(container, notice("error", errorMessage(error)));
  }
}

/* ------------------------------------------------------------------ */
/* Commande /citart : citer l'article annonce par la phrase precedente  */
/* ------------------------------------------------------------------ */

type CitartTarget =
  | { kind: "ok"; code: CodeEntry; numbers: string[]; source: string }
  | { kind: "ambiguous"; reference: DetectedReference; source: string }
  | { kind: "unknown"; reference: DetectedReference; source: string }
  | { kind: "none" };

/**
 * Retrouve l'article annonce dans le texte qui precede.
 *
 * `commandRaw` est fourni lorsque la commande a ete tapee dans le document :
 * le paragraphe le plus proche est alors celui de la commande, dont on retire
 * le texte de la commande avant d'y chercher une reference — la phrase
 * introductive peut tenir sur la meme ligne.
 */
async function findCitartTarget(commandRaw: string | null): Promise<CitartTarget> {
  const lookback = Math.max(1, settings.citart.lookback);
  const paragraphs = await readParagraphsBeforeSelection(lookback + (commandRaw ? 1 : 0));
  const texts = paragraphs.map((p) => p.text);

  const candidates = commandRaw
    ? [(texts[0] ?? "").replace(commandRaw, "").trim(), ...texts.slice(1)]
    : texts;

  const found = findIntroducedReferences(candidates, settings.customAbbreviations);
  if (!found) return { kind: "none" };

  const references = settings.citart.citeAll ? found.references : found.references.slice(0, 1);
  const first = references[0];
  if (!first) return { kind: "none" };

  if (first.resolution.kind === "ambiguous") return { kind: "ambiguous", reference: first, source: found.source };
  if (first.resolution.kind === "unknown") return { kind: "unknown", reference: first, source: found.source };

  // Tous les numeros des references partageant le code retenu.
  const code = first.resolution.code;
  const numbers = references
    .filter((ref) => ref.resolution.kind === "resolved" && ref.resolution.code.slug === code.slug)
    .flatMap((ref) => (settings.citart.citeAll ? ref.numbers : ref.numbers.slice(0, 1)));

  return { kind: "ok", code, numbers, source: found.source };
}

/** Style applique par /citart : l'intitule est masque, la phrase le porte deja. */
function citartStyle(): CitationStyle {
  if (!settings.citart.hideHeading) return settings.citation;
  return { ...settings.citation, heading: { ...settings.citation.heading, include: false } };
}

function citartFailure(target: CitartTarget): string {
  switch (target.kind) {
    case "none":
      return `Aucun article n'est annoncé dans les ${settings.citart.lookback} paragraphes précédents.`;
    case "ambiguous":
      return `« ${target.reference.codeInput} » peut désigner plusieurs codes : précisez-le dans votre phrase.`;
    case "unknown":
      return target.reference.codeInput
        ? `Code « ${target.reference.codeInput} » non reconnu dans « ${target.source} ».`
        : `Aucun code identifié dans « ${target.source} ».`;
    default:
      return "Article introuvable.";
  }
}

function renderVersionChoice(
  container: HTMLElement,
  versions: ArticleVersion[],
  year: number,
  num: string,
  code: CodeEntry
): void {
  const manual = el("input", { type: "text", placeholder: "JJ/MM", autocomplete: "off" });

  mount(
    container,
    notice("info", `L'article ${num} a changé au cours de l'année ${year}. Choisissez la version applicable.`),
    ...versions.map((version) =>
      el("div", { class: "card card--clickable", onclick: () => void applyVersion(container, version, num, code) }, [
        el("div", { class: "card__title", text: formatPeriod(version) }),
        el("div", { class: "card__meta", text: version.id }),
      ])
    ),
    el("div", { class: "card" }, [
      el("label", { text: `Ou saisissez le jour et le mois (année ${year})` }),
      el("div", { class: "row" }, [
        manual,
        el(
          "button",
          {
            onclick: () => {
              const match = /^(\d{1,2})\/(\d{1,2})$/.exec(manual.value.trim());
              if (!match) {
                toast("Format attendu : JJ/MM");
                return;
              }
              const iso = `${year}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
              const hit = versions.find((v) => iso >= v.dateDebut && (v.dateFin === null || iso < v.dateFin));
              if (!hit) {
                toast("Aucune version ne couvre cette date.");
                return;
              }
              void applyVersion(container, hit, num, code);
            },
          },
          ["Valider"]
        ),
      ]),
    ])
  );
}

async function applyVersion(
  container: HTMLElement,
  version: ArticleVersion,
  num: string,
  code: CodeEntry
): Promise<void> {
  mount(container, spinner("Chargement de la version…"));
  try {
    renderResult(container, [await loadVersion(settings, version, num, code)], []);
  } catch (error) {
    mount(container, notice("error", errorMessage(error)));
  }
}

function citationOptions(style: CitationStyle = settings.citation) {
  return { style, extractedAt: new Date().toISOString().slice(0, 10) };
}

function renderResult(
  container: HTMLElement,
  items: ArticleData[],
  problems: HTMLElement[],
  style: CitationStyle = settings.citation
): void {
  const rendered = renderGroup(items, citationOptions(style));
  const allBlocks = rendered.flatMap((r) => r.blocks);
  const total = countCharacters(allBlocks);
  const long = total > settings.longArticleThreshold;

  const doInsert = async (blocks: Block[][], footnotes: Array<string | undefined>) => {
    // Comme pour le declencheur : l'ecriture produit des evenements de
    // paragraphe qu'il ne faut pas confondre avec une saisie de l'utilisateur.
    suspendWatcher();
    try {
      for (let i = 0; i < blocks.length; i++) {
        const footnote = footnotes[i];
        await insertCitation(blocks[i]!, footnote ? { footnote } : {});
      }
      toast(items.length > 1 ? `${items.length} articles insérés.` : "Article inséré.");
    } catch (error) {
      toast(errorMessage(error), 6000);
    } finally {
      resumeWatcher();
    }
  };

  mount(
    container,
    ...problems,
    long
      ? notice(
          "warn",
          `Contenu long (${total} caractères, seuil ${settings.longArticleThreshold}). Choisissez ce que vous souhaitez insérer.`
        )
      : null,
    el("div", { class: "card" }, [
      el("div", { class: "card__title", text: items.length > 1 ? `${items.length} articles` : items[0]!.code.nom }),
      el("div", { class: "card__meta" }, [
        items.length === 1 ? `${formatPeriod(items[0]!.version)} · ${total} caractères` : `${total} caractères au total`,
      ]),
    ]),
    renderBlocks(allBlocks),
    el("div", { class: "row" }, [
      el(
        "button",
        { class: "btn primary", onclick: () => void doInsert(rendered.map((r) => r.blocks), rendered.map((r) => r.footnote)) },
        [icon("insert", 14), long ? "Insérer l'intégralité" : "Insérer"]
      ),
      long
        ? el(
            "button",
            {
              onclick: () =>
                void doInsert(rendered.map((r) => firstAlineas(r.blocks, 3)), rendered.map((r) => r.footnote)),
            },
            ["Trois premiers alinéas"]
          )
        : null,
    ])
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof LegifranceError) return error.message;
  if (error instanceof Error) return error.message;
  return "Erreur inattendue.";
}

/* ------------------------------------------------------------------ */
/* Declencheur /art tape dans le document                              */
/* ------------------------------------------------------------------ */

async function restartTrigger(): Promise<void> {
  await stopTriggerWatcher();
  if (!settings.triggerInDocument) return;
  if (!isTriggerSupported()) {
    console.info("LégiWord : WordApi 1.6 indisponible, le déclencheur /art est désactivé.");
    return;
  }

  await startTriggerWatcher({
    onTrigger: (event) => void handleTrigger(event.paragraphId, event.raw),
    ...(settings.prefetch ? { onPrefetch: (command: string) => void handlePrefetch(command) } : {}),
  });
}

/** Resout la commande sans rien inserer, pour que la validation soit immediate. */
async function handlePrefetch(raw: string): Promise<void> {
  const parsed = parseCommand(raw);
  if (!parsed.ok) return;

  if (parsed.command === "citart") {
    const target = await findCitartTarget(raw);
    if (target.kind !== "ok") return;
    await prefetchArticles(settings, target.numbers, target.code, parsed.date);
    return;
  }

  const resolution = resolveCode(parsed.codeInput, settings.customAbbreviations);
  if (resolution.kind !== "resolved") return;
  if (parsed.articles.type !== "list") return; // une plage exige le sommaire, trop lourd a precharger

  await prefetchArticles(settings, parsed.articles.numbers, resolution.code, parsed.date);
}

/**
 * Garde-fou de reentrance.
 *
 * Word peut emettre plusieurs fois l'evenement de paragraphe ajoute pour une
 * seule validation. Sans verrou, deux traitements partaient en parallele, lisaient
 * le meme paragraphe contenant encore la commande — le premier attendant le
 * reseau ne l'avait pas encore effacee — et inseraient tous les deux, produisant
 * une citation partiellement dupliquee.
 */
let triggerBusy = false;
let lastHandledTrigger = "";

async function handleTrigger(paragraphId: string, raw: string): Promise<void> {
  const key = `${paragraphId}|${raw}`;
  if (triggerBusy || key === lastHandledTrigger) return;
  triggerBusy = true;
  lastHandledTrigger = key;

  try {
    await runTrigger(paragraphId, raw);
  } finally {
    triggerBusy = false;
  }
}

async function runTrigger(paragraphId: string, raw: string): Promise<void> {
  const parsed = parseCommand(raw);
  if (!parsed.ok) {
    toast(parsed.error, 5000);
    return;
  }

  let code: CodeEntry;
  let articles: ArticleSpec;
  let style = settings.citation;

  if (parsed.command === "citart") {
    const target = await findCitartTarget(raw);
    if (target.kind !== "ok") {
      // On ne touche pas au document : la commande reste visible, l'utilisateur
      // corrige sa phrase introductive.
      toast(citartFailure(target), 7000);
      return;
    }
    code = target.code;
    articles = { type: "list", numbers: target.numbers };
    style = citartStyle();
  } else {
    const resolution = resolveCode(parsed.codeInput, settings.customAbbreviations);
    if (resolution.kind !== "resolved") {
      // Doute sur le code : on ne touche pas au document, on bascule dans le volet.
      lastQuery = raw.replace(/^\s*\/artv?\s*/i, "");
      navigate("search");
      const results = document.getElementById("results");
      if (results) void runQuery(raw, results);
      toast("Précisez le code dans le volet.");
      return;
    }
    code = resolution.code;
    articles = parsed.articles;
  }

  try {
    const range = await resolveArticleNumbers(settings, articles, code, parsed.date);
    const outcomes = await lookupMany(settings, range.numbers, code, parsed.date);

    const items: ArticleData[] = [];
    for (const outcome of outcomes) {
      if (outcome.kind !== "article") {
        // Version a choisir ou article hors periode : le volet prend le relais.
        navigate("search");
        const results = document.getElementById("results");
        if (results) await fetchAndRender(results, code, articles, parsed.date, style);
        return;
      }
      items.push(outcome.data);
    }

    const rendered = renderGroup(items, citationOptions(style));
    const blocks = rendered.flatMap((r) => r.blocks);

    if (countCharacters(blocks) > settings.longArticleThreshold) {
      navigate("search");
      const results = document.getElementById("results");
      if (results) renderResult(results, items, [], style);
      toast("Article long : validez l'insertion dans le volet.", 6000);
      return;
    }

    const first = rendered[0];
    // L'insertion ajoute des paragraphes, donc redeclenche les evenements que
    // l'on ecoute : on suspend la surveillance le temps d'ecrire.
    suspendWatcher();
    try {
      await replaceTriggerAndInsert(paragraphId, raw, blocks, first?.footnote ? { footnote: first.footnote } : {});
    } finally {
      resumeWatcher();
    }
  } catch (error) {
    toast(errorMessage(error), 6000);
  }
}

export { navigate };
