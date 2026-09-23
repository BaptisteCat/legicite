/**
 * Fenetre de reglages.
 *
 * Ouverte par displayDialogAsync depuis le volet, elle regroupe l'ensemble des
 * reglages — la composition des citations en premier lieu, avec un apercu qui
 * se met a jour a chaque changement.
 *
 * La fenetre partage l'origine du volet, donc son localStorage : elle lit et
 * ecrit les memes reglages. Elle previent malgre tout le volet par
 * messageParent, pour qu'il rafraichisse son etat en memoire sans attendre.
 */


import { codeBySlug, allCodes } from "../core/abbreviations";
import { htmlToBlocks } from "../core/html-to-blocks";
import { normalizeCode } from "../core/normalize";
import { normalizeVersions } from "../core/versions";
import { renderCitation, type ArticleData } from "../core/citation";
import {
  cloneStyle,
  matchingPreset,
  PRESETS,
  type Alignment,
  type CitationStyle,
  type HeadingForm,
  type QuoteStyle,
  type SourcePlacement,
  type VersionPlacement,
} from "../core/citation-style";
import { purgeAll, purgeExpired } from "../api/cache";
import { clearToken } from "../api/auth";
import { ping } from "../api/legifrance";
import { currentTransportMode, resetTransportMode, type TransportMode } from "../api/transport";
import { LegifranceError } from "../api/types";
import {
  exportAbbreviations,
  importAbbreviations,
  loadSettings,
  saveSettings,
  type Settings,
} from "../settings/store";
import { el, icon, mount, notice, toast } from "../taskpane/dom";

/** Copie de travail : rien n'est enregistre avant un clic sur Enregistrer. */
let draft: Settings = loadSettings();
const openSections = new Set<string>(["composition"]);

/**
 * Les reglages transitent par la messagerie Office, PAS par localStorage.
 *
 * Une fenetre ouverte avec displayInIframe: false s'execute dans une fenetre
 * distincte, avec son propre cloisonnement de stockage : elle ne voit donc pas
 * le localStorage du volet. S'y fier revenait a afficher les valeurs par defaut
 * a l'ouverture, et a enregistrer dans le vide.
 *
 * Le volet reste la seule autorite : il envoie l'etat courant a l'ouverture et
 * enregistre ce que la fenetre lui renvoie.
 */
Office.onReady(() => {
  listenForParentSettings();
  render();
  askParentForSettings();

  document.getElementById("save")?.addEventListener("click", () => {
    // On enregistre aussi localement : sans effet si le stockage est cloisonne,
    // utile si la fenetre est ouverte directement dans un navigateur.
    saveSettings(draft);
    clearToken();
    resetTransportMode();
    send({ type: "settings-saved", settings: draft });
  });

  document.getElementById("cancel")?.addEventListener("click", () => send({ type: "closed" }));
});

function send(payload: unknown): void {
  try {
    Office.context.ui.messageParent(JSON.stringify(payload));
  } catch {
    window.close();
  }
}

function askParentForSettings(): void {
  send({ type: "ready" });
}

function listenForParentSettings(): void {
  try {
    Office.context.ui.addHandlerAsync(Office.EventType.DialogParentMessageReceived, (event: unknown) => {
      const message = (event as { message?: string }).message ?? "";
      try {
        const payload = JSON.parse(message) as { type?: string; settings?: Settings };
        if (payload.type === "settings" && payload.settings) {
          draft = payload.settings;
          render();
        }
      } catch {
        /* message illisible : on garde l'etat local */
      }
    });
  } catch {
    // DialogApi 1.2 indisponible : on se rabat sur le stockage local, qui est
    // partage lorsque la fenetre s'ouvre en iframe.
    draft = loadSettings();
  }
}

function update(mutate: (settings: Settings) => void): void {
  mutate(draft);
  render();
}

function updateStyle(mutate: (style: CitationStyle) => void): void {
  const style = cloneStyle(draft.citation);
  mutate(style);
  draft.citation = style;
  render();
}

/* ------------------------------------------------------------------ */
/* Fabriques de controles                                              */
/* ------------------------------------------------------------------ */

function check(
  label: string,
  value: boolean,
  onChange: (checked: boolean) => void,
  options: { hint?: string; disabled?: boolean } = {}
): HTMLElement {
  const input = el("input", {
    type: "checkbox",
    ...(value ? { checked: true } : {}),
    ...(options.disabled ? { disabled: true } : {}),
    onchange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
  });
  return el("label", { class: options.disabled ? "check check--disabled" : "check" }, [
    input,
    el("span", {}, [label, options.hint ? el("span", { class: "check__hint", text: options.hint }) : null]),
  ]);
}

function choose<T extends string>(
  label: string,
  value: T,
  options: Array<{ value: T; label: string }>,
  onChange: (value: T) => void,
  disabled = false
): HTMLElement {
  return el("div", { class: "control" }, [
    el("label", { text: label }),
    el(
      "select",
      {
        ...(disabled ? { disabled: true } : {}),
        onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value as T),
      },
      options.map((option) =>
        el("option", { value: option.value, selected: option.value === value }, [option.label])
      )
    ),
  ]);
}

function num(
  label: string,
  value: number,
  onChange: (value: number) => void,
  options: { step?: number; min?: number; max?: number; disabled?: boolean } = {}
): HTMLElement {
  return el("div", { class: "control" }, [
    el("label", { text: label }),
    el("input", {
      type: "number",
      value: String(value),
      step: String(options.step ?? 0.1),
      min: String(options.min ?? 0),
      max: String(options.max ?? 20),
      ...(options.disabled ? { disabled: true } : {}),
      onchange: (event: Event) => {
        const parsed = Number((event.target as HTMLInputElement).value);
        onChange(Number.isFinite(parsed) ? parsed : 0);
      },
    }),
  ]);
}

/** Champ numerique pouvant valoir « hérité du document ». */
function inheritable(
  label: string,
  value: number | null,
  onChange: (value: number | null) => void,
  options: { step?: number; min?: number; max?: number; unit?: string } = {}
): HTMLElement {
  const input = el("input", {
    type: "number",
    value: value === null ? "" : String(value),
    step: String(options.step ?? 0.5),
    min: String(options.min ?? 1),
    max: String(options.max ?? 72),
    placeholder: "hérité",
    ...(value === null ? { disabled: true } : {}),
    onchange: (event: Event) => {
      const parsed = Number((event.target as HTMLInputElement).value);
      onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    },
  });

  return el("div", { class: "control" }, [
    el("label", { text: label }),
    el("div", { class: "row" }, [
      el("input", {
        type: "checkbox",
        title: "Imposer une valeur",
        ...(value !== null ? { checked: true } : {}),
        onchange: (event: Event) =>
          onChange((event.target as HTMLInputElement).checked ? (options.min ?? 11) : null),
      }),
      input,
      options.unit ? el("span", { class: "jt-hint", text: options.unit }) : null,
    ]),
  ]);
}

function section(id: string, title: string, body: () => Array<Node | null>): HTMLElement {
  const open = openSections.has(id);
  return el("div", { class: "section" }, [
    el(
      "button",
      {
        class: "section__head",
        type: "button",
        onclick: () => {
          if (openSections.has(id)) openSections.delete(id);
          else openSections.add(id);
          render();
        },
      },
      // Chevron Lucide : la charte n'admet aucun autre jeu d'icônes, ni caractère
      // typographique en guise d'icône.
      [el("span", { text: title }), el("span", { class: "section__chevron" }, [icon(open ? "down" : "right", 15)])]
    ),
    open ? el("div", { class: "section__body" }, [el("div", { class: "controls" }, body())]) : null,
  ]);
}

/* ------------------------------------------------------------------ */
/* Rendu                                                               */
/* ------------------------------------------------------------------ */

function render(): void {
  const form = document.getElementById("form");
  if (!form) return;

  const s = draft.citation;
  const active = matchingPreset(s);

  mount(
    form,
    /* --- Preselections --- */
    el("div", { class: "section" }, [
      el("div", { class: "section__body", style: "padding-top:12px" }, [
        el("label", { text: "Présélection — point de départ, modifiable ensuite" }),
        el(
          "div",
          { class: "presets" },
          PRESETS.map((preset) =>
            el(
              "button",
              {
                class: "preset",
                type: "button",
                "aria-pressed": String(active === preset.id),
                title: preset.description,
                onclick: () => updateStyle((style) => Object.assign(style, cloneStyle(preset.style))),
              },
              [preset.label]
            )
          )
        ),
        el("div", {
          class: "jt-hint",
          text: active
            ? `Style identique à la présélection « ${PRESETS.find((p) => p.id === active)?.label} ».`
            : "Style personnalisé.",
        }),
      ]),
    ]),

    /* --- Intitule --- */
    section("intitule", "Intitulé de l'article", () => [
      check("Insérer l'intitulé", s.heading.include, (v) => updateStyle((st) => (st.heading.include = v)), {
        hint: "« Article 111-1 du code pénal »",
      }),
      choose<HeadingForm>(
        "Forme",
        s.heading.form,
        [
          { value: "long", label: "Longue — Article 111-1 du code pénal" },
          { value: "court", label: "Courte — C. pén., art. 111-1" },
        ],
        (v) => updateStyle((st) => (st.heading.form = v)),
        !s.heading.include
      ),
      check("Sur sa propre ligne", s.heading.ownParagraph, (v) => updateStyle((st) => (st.heading.ownParagraph = v)), {
        hint: "Sinon, l'intitulé précède le texte sur la même ligne, suivi de deux points.",
        disabled: !s.heading.include,
      }),
      el("div", { class: "controls controls--two" }, [
        check("Gras", s.heading.bold, (v) => updateStyle((st) => (st.heading.bold = v)), { disabled: !s.heading.include }),
        check("Italique", s.heading.italic, (v) => updateStyle((st) => (st.heading.italic = v)), { disabled: !s.heading.include }),
        check("Souligné", s.heading.underline, (v) => updateStyle((st) => (st.heading.underline = v)), { disabled: !s.heading.include }),
      ]),
    ]),

    /* --- Version --- */
    section("version", "Mention de version", () => [
      check("Indiquer la version citée", s.version.include, (v) => updateStyle((st) => (st.version.include = v)), {
        hint: "Sans elle, rien dans le document ne dit à quelle date le texte était en vigueur.",
      }),
      choose<VersionPlacement>(
        "Emplacement",
        s.version.placement,
        [
          { value: "sousIntitule", label: "Sous l'intitulé, sur sa propre ligne" },
          { value: "finTexte", label: "À la suite du texte cité" },
          { value: "note", label: "En note de bas de page" },
        ],
        (v) => updateStyle((st) => (st.version.placement = v)),
        !s.version.include
      ),
      check(
        "Formulation complète",
        s.version.complete,
        (v) => updateStyle((st) => (st.version.complete = v)),
        { hint: "« version en vigueur au 7 septembre 2026 » plutôt que la date seule.", disabled: !s.version.include }
      ),
      el("div", { class: "controls controls--two" }, [
        check("Entre parenthèses", s.version.parentheses, (v) => updateStyle((st) => (st.version.parentheses = v)), { disabled: !s.version.include }),
        check("Italique", s.version.italic, (v) => updateStyle((st) => (st.version.italic = v)), { disabled: !s.version.include }),
      ]),
    ]),

    /* --- Texte --- */
    section("texte", "Texte de l'article", () => [
      choose<QuoteStyle>(
        "Guillemets",
        s.text.quotes,
        [
          { value: "francais", label: "Français — « texte »" },
          { value: "anglais", label: "Anglais — “texte”" },
          { value: "aucun", label: "Aucun" },
        ],
        (v) => updateStyle((st) => (st.text.quotes = v))
      ),
      check(
        "Guillemet ouvrant à chaque alinéa",
        s.text.quoteEachAlinea,
        (v) => updateStyle((st) => (st.text.quoteEachAlinea = v)),
        { hint: "Usage typographique français pour une citation de plusieurs alinéas.", disabled: s.text.quotes === "aucun" }
      ),
      el("div", { class: "controls controls--two" }, [
        check("Texte en italique", s.text.italic, (v) => updateStyle((st) => (st.text.italic = v))),
        check("Texte en gras", s.text.bold, (v) => updateStyle((st) => (st.text.bold = v))),
      ]),
    ]),

    /* --- Mise en forme --- */
    section("miseEnForme", "Mise en forme du bloc", () => [
      el("div", {
        class: "jt-hint",
        text:
          "Tout ce qui n'est pas coché suit le style du document d'accueil : c'est le comportement recommandé. " +
          "Le gras et l'italique font exception : ils sont toujours ceux réglés ci-dessus, jamais ceux hérités " +
          "du texte qui précède la citation.",
      }),
      check(
        "Repartir du style Normal",
        s.layout.resetStyle,
        (v) => updateStyle((st) => (st.layout.resetStyle = v)),
        {
          hint: "Efface aussi la couleur et le surlignage hérités. Utile quand la citation suit un titre ou un paragraphe très mis en forme.",
        }
      ),
      check("Retrait du bloc entier", s.layout.indent, (v) => updateStyle((st) => (st.layout.indent = v)), {
        hint: "Décale toute la citation vers la droite, comme une citation longue.",
      }),
      num("Retrait gauche (cm)", s.layout.indentCm, (v) => updateStyle((st) => (st.layout.indentCm = v)), {
        step: 0.25,
        max: 10,
        disabled: !s.layout.indent,
      }),
      check("Retrait de première ligne", s.layout.firstLineIndent, (v) => updateStyle((st) => (st.layout.firstLineIndent = v))),
      num("Retrait de première ligne (cm)", s.layout.firstLineIndentCm, (v) => updateStyle((st) => (st.layout.firstLineIndentCm = v)), {
        step: 0.25,
        max: 5,
        disabled: !s.layout.firstLineIndent,
      }),
      el("div", { class: "controls controls--two" }, [
        num("Espace avant (cm)", s.layout.spaceBeforeCm, (v) => updateStyle((st) => (st.layout.spaceBeforeCm = v)), { step: 0.1, max: 3 }),
        num("Espace après (cm)", s.layout.spaceAfterCm, (v) => updateStyle((st) => (st.layout.spaceAfterCm = v)), { step: 0.1, max: 3 }),
      ]),
      choose<Alignment>(
        "Alignement",
        s.layout.alignment,
        [
          { value: "herite", label: "Hérité du document" },
          { value: "justifie", label: "Justifié" },
          { value: "gauche", label: "Aligné à gauche" },
        ],
        (v) => updateStyle((st) => (st.layout.alignment = v))
      ),
      inheritable("Taille de police", s.layout.fontSizePt, (v) => updateStyle((st) => (st.layout.fontSizePt = v)), {
        min: 6,
        max: 24,
        step: 0.5,
        unit: "pt",
      }),
      inheritable("Interligne", s.layout.lineSpacing, (v) => updateStyle((st) => (st.layout.lineSpacing = v)), {
        min: 8,
        max: 48,
        step: 1,
        unit: "pt",
      }),
      el("div", { class: "control" }, [
        el("label", { text: "Police (vide = héritée du document)" }),
        el("input", {
          type: "text",
          value: s.layout.fontName ?? "",
          placeholder: "hérité",
          onchange: (event: Event) => {
            const value = (event.target as HTMLInputElement).value.trim();
            updateStyle((st) => (st.layout.fontName = value === "" ? null : value));
          },
        }),
      ]),
    ]),

    /* --- Reference et source --- */
    section("reference", "Référence et source", () => [
      check(
        "Référence courte après le texte",
        s.reference.inlineAfterText,
        (v) => updateStyle((st) => (st.reference.inlineAfterText = v)),
        { hint: "« texte » (C. pén., art. 111-1)" }
      ),
      choose<SourcePlacement>(
        "Mention de la source",
        s.reference.source,
        [
          { value: "corps", label: "Dans le corps, en fin de citation" },
          { value: "note", label: "En note de bas de page" },
          { value: "aucune", label: "Aucune" },
        ],
        (v) => updateStyle((st) => (st.reference.source = v))
      ),
      check(
        "Ajouter la date de consultation",
        s.reference.withExtractionDate,
        (v) => updateStyle((st) => (st.reference.withExtractionDate = v)),
        { hint: "La Licence Ouverte 2.0 impose de mentionner la source et la date d'extraction.", disabled: s.reference.source === "aucune" }
      ),
    ]),

    /* --- Groupes --- */
    section("groupes", "Citations de plusieurs articles", () => [
      check("Ligne vide entre les articles", s.group.blankLineBetween, (v) => updateStyle((st) => (st.group.blankLineBetween = v))),
      check(
        "Toujours rappeler l'intitulé",
        s.group.forceHeadingWhenMultiple,
        (v) => updateStyle((st) => (st.group.forceHeadingWhenMultiple = v)),
        { hint: "Sans intitulé, une suite de citations devient illisible." }
      ),
    ]),

    /* --- Saisie et insertion --- */
    section("saisie", "Saisie et insertion", () => [
      check("Déclencher /art tapé dans le document", draft.triggerInDocument, (v) => update((d) => (d.triggerInDocument = v)), {
        hint: "La commande est traitée à la validation par Entrée.",
      }),
      check("Précharger pendant la frappe", draft.prefetch, (v) => update((d) => (d.prefetch = v)), {
        hint: "Récupère l'article avant validation pour que l'insertion soit immédiate. Coûte quelques appels sur des commandes abandonnées.",
        disabled: !draft.triggerInDocument,
      }),
      num(
        "Seuil d'avertissement des articles longs (caractères)",
        draft.longArticleThreshold,
        (v) => update((d) => (d.longArticleThreshold = Math.max(200, v))),
        { step: 100, min: 200, max: 20000 }
      ),
    ]),

    /* --- /citart --- */
    section("citart", "Commande /citart", () => [
      el("div", { class: "jt-hint" }, [
        "Cite l'article annoncé par la phrase qui précède. On écrit ",
        el("code", { text: "L'article 121-5 du code pénal dispose que :" }),
        ", on passe à la ligne, on tape ",
        el("code", { text: "/citart" }),
        " et l'article est inséré sans avoir à le renseigner de nouveau.",
      ]),
      check(
        "Masquer l'intitulé",
        draft.citart.hideHeading,
        (v) => update((d) => (d.citart.hideHeading = v)),
        { hint: "La phrase introductive nomme déjà l'article : le répéter serait redondant." }
      ),
      num(
        "Paragraphes remontés à la recherche de la référence",
        draft.citart.lookback,
        (v) => update((d) => (d.citart.lookback = Math.max(1, Math.round(v)))),
        { step: 1, min: 1, max: 10 }
      ),
      check(
        "Citer tous les articles annoncés",
        draft.citart.citeAll,
        (v) => update((d) => (d.citart.citeAll = v)),
        { hint: "« les articles 1353 et 1354 du Code civil » insère les deux ; sinon seulement le premier." }
      ),
    ]),

    /* --- Identifiants --- */
    section("piste", "Identifiants PISTE", () => renderPiste()),

    /* --- Abreviations --- */
    section("abreviations", "Abréviations", () => renderAbbreviations()),

    /* --- Cache --- */
    section("cache", "Cache", () => [
      el("div", {
        class: "jt-hint",
        text: "Les articles consultés sont conservés localement pour ménager les quotas PISTE et permettre un usage hors ligne.",
      }),
      el("div", { class: "row" }, [
        el("button", { class: "mini", type: "button", onclick: () => toast(`${purgeExpired()} entrée(s) expirée(s) supprimée(s).`) }, [
          "Purger les entrées expirées",
        ]),
        el("button", { class: "mini", type: "button", onclick: () => toast(`${purgeAll()} entrée(s) supprimée(s).`) }, ["Tout vider"]),
      ]),
    ])
  );

  renderPreview();
}

function renderPiste(): Array<Node | null> {
  const clientId = el("input", { type: "text", value: draft.piste.clientId, autocomplete: "off" });
  const clientSecret = el("input", { type: "password", value: draft.piste.clientSecret, autocomplete: "off" });
  const result = el("div", {});

  const capture = () => {
    draft.piste = {
      clientId: clientId.value.trim(),
      clientSecret: clientSecret.value.trim(),
      sandbox: draft.piste.sandbox,
    };
  };

  return [
    el("div", { class: "jt-hint" }, [
      "Créez une application sur ",
      el("code", { text: "piste.gouv.fr" }),
      ", abonnez-la à l'API Légifrance et acceptez les CGU, puis collez ici le client ID et le secret.",
    ]),
    el("div", { class: "control" }, [el("label", { text: "Client ID" }), clientId]),
    el("div", { class: "control" }, [el("label", { text: "Client secret" }), clientSecret]),
    check("Utiliser le bac à sable PISTE", draft.piste.sandbox, (v) => update((d) => (d.piste.sandbox = v))),
    el("div", { class: "row" }, [
      el(
        "button",
        {
          type: "button",
          class: "btn primary",
          onclick: () => {
            capture();
            clearToken();
            resetTransportMode();
            mount(result, notice("info", "Test en cours…"));
            void ping({ credentials: draft.piste, transport: draft.transport })
              .then((endpoint) => {
                const mode = currentTransportMode();
                mount(
                  result,
                  notice("ok", `Connexion établie${mode === "proxy" ? " via le relais" : " en accès direct"} — ${endpoint} répond.`)
                );
              })
              .catch((error: unknown) => {
                const box = notice("error", "");
                box.style.whiteSpace = "pre-wrap";
                box.textContent = error instanceof LegifranceError ? error.message : String(error);
                mount(result, box);
              });
          },
        },
        ["Tester la connexion"]
      ),
      el("button", { class: "mini", type: "button", onclick: () => { capture(); toast("Identifiants pris en compte — n'oubliez pas d'enregistrer."); } }, [
        "Appliquer",
      ]),
    ]),
    result,
    el("div", {
      class: "jt-hint",
      text:
        "L'API Légifrance accepte les appels directs depuis le navigateur : aucun relais n'est nécessaire. " +
        "Ne changez ce réglage que si votre réseau d'entreprise bloque les appels sortants.",
    }),
    choose<TransportMode>(
      "Accès réseau",
      draft.transport.mode,
      [
        { value: "auto", label: "Automatique (recommandé)" },
        { value: "direct", label: "Appel direct" },
        { value: "proxy", label: "Relais" },
      ],
      (v) => update((d) => (d.transport.mode = v))
    ),
    notice(
      "warn",
      "Le secret est conservé en clair dans le stockage local de Word sur ce poste. C'est le meilleur niveau atteignable pour une extension web ; ne l'utilisez pas sur un poste partagé."
    ),
  ];
}

function renderAbbreviations(): Array<Node | null> {
  const alias = el("input", { type: "text", placeholder: "ex. cpcex" });
  const target = el("select", {}, allCodes().map((code) => el("option", { value: code.slug }, [code.nom])));
  const zone = el("textarea", { placeholder: "Collez ici un export d'abréviations…" });

  const rows = Object.entries(draft.customAbbreviations).map(([key, slug]) =>
    el("tr", {}, [
      el("td", {}, [el("code", { text: key })]),
      el("td", { text: codeBySlug(slug)?.nom ?? slug }),
      el("td", {}, [
        el(
          "button",
          {
            class: "link-btn",
            type: "button",
            onclick: () =>
              update((d) => {
                const copy = { ...d.customAbbreviations };
                delete copy[key];
                d.customAbbreviations = copy;
              }),
          },
          ["Supprimer"]
        ),
      ]),
    ])
  );

  return [
    el("div", {
      class: "jt-hint",
      text: "Locales à ce poste, prioritaires sur les abréviations par défaut, et libres de les écraser.",
    }),
    el("div", { class: "row" }, [
      alias,
      target,
      el(
        "button",
        {
          class: "mini",
          type: "button",
          onclick: () => {
            const key = normalizeCode(alias.value);
            if (!key) {
              toast("Saisissez une abréviation.");
              return;
            }
            update((d) => (d.customAbbreviations = { ...d.customAbbreviations, [key]: target.value }));
          },
        },
        ["Ajouter"]
      ),
    ]),
    rows.length > 0
      ? el("table", { class: "table" }, [
          el("thead", {}, [el("tr", {}, [el("th", { text: "Saisie" }), el("th", { text: "Code" }), el("th", {})])]),
          el("tbody", {}, rows),
        ])
      : el("div", { class: "jt-hint", text: "Aucune abréviation personnelle." }),
    el("div", { class: "row" }, [
      el("button", { class: "mini", type: "button", onclick: () => { zone.value = exportAbbreviations(draft); toast("Export généré ci-dessous."); } }, ["Exporter"]),
      el(
        "button",
        {
          class: "mini",
          type: "button",
          onclick: () => {
            const outcome = importAbbreviations(zone.value);
            toast(outcome.ok ? `${outcome.added} entrée(s) importée(s).` : outcome.error ?? "Import impossible.");
            if (outcome.ok) {
              draft = loadSettings();
              render();
            }
          },
        },
        ["Importer"]
      ),
    ]),
    zone,
  ];
}

/* ------------------------------------------------------------------ */
/* Apercu                                                              */
/* ------------------------------------------------------------------ */

const SAMPLE: ArticleData = {
  id: "LEGIARTI000006417204",
  num: "111-1",
  code: codeBySlug("cpen")!,
  blocks: htmlToBlocks(
    "<p>Les infractions pénales sont classées, suivant leur gravité, en crimes, délits et contraventions.</p>" +
      "<p>Cette classification commande la juridiction compétente et la procédure applicable.</p>"
  ),
  version: normalizeVersions([{ id: "LEGIARTI000006417204", dateDebut: "1994-03-01", dateFin: null }])[0]!,
};

function renderPreview(): void {
  const host = document.getElementById("preview");
  if (!host) return;

  const rendered = renderCitation(SAMPLE, {
    style: draft.citation,
    extractedAt: new Date().toISOString().slice(0, 10),
  });

  const sheet = el("div", { class: "sheet" });

  for (const block of rendered.blocks) {
    if (block.type !== "paragraph") continue;
    const p = el("p", {});
    const f = block.format ?? {};
    const styles: string[] = [];
    if (f.leftIndentPt) styles.push(`margin-left:${f.leftIndentPt}pt`);
    if (f.firstLineIndentPt) styles.push(`text-indent:${f.firstLineIndentPt}pt`);
    if (f.spaceBeforePt) styles.push(`margin-top:${f.spaceBeforePt}pt`);
    if (f.spaceAfterPt) styles.push(`margin-bottom:${f.spaceAfterPt}pt`);
    if (f.alignment === "justified") styles.push("text-align:justify");
    if (f.alignment === "left") styles.push("text-align:left");
    if (f.fontSizePt) styles.push(`font-size:${f.fontSizePt}pt`);
    if (f.fontName) styles.push(`font-family:${f.fontName}`);
    if (styles.length > 0) p.setAttribute("style", styles.join(";"));

    for (const run of block.runs) {
      let node: Node = document.createTextNode(run.text);
      if (run.superscript) node = el("sup", {}, [node]);
      if (run.italic) node = el("em", {}, [node]);
      if (run.bold) node = el("strong", {}, [node]);
      p.appendChild(node);
    }
    sheet.appendChild(p);
  }

  if (rendered.footnote) {
    sheet.appendChild(el("div", { class: "footnote", text: "¹ " + rendered.footnote }));
  }

  mount(host, sheet);
}
