/**
 * Helpers DOM minimalistes.
 * Pas de framework : l'interface du volet reste modeste et une couche de plus
 * alourdirait le bundle charge par Word a chaque ouverture.
 */

/**
 * `JT` est pose par icons.js, charge par la page avant le bundle. Le kit n'est
 * pas empaquete : il est servi tel quel pour que `sync-kit.js --check` puisse le
 * comparer au kit d'origine, octet pour octet.
 */
declare const JT: {
  icon(name: string, size?: number, strokeWidth?: number): string;
  addIcons(more: Record<string, string>): void;
  paintIcons(root?: ParentNode): void;
};

type Attrs = Record<string, string | number | boolean | ((event: Event) => void) | undefined>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      node.className = String(value);
    } else if (key === "text") {
      // Pas d'equivalent `html` volontairement : tout le contenu affiche par le
      // volet provient de l'API Legifrance, et une echappatoire innerHTML
      // reviendrait a injecter du balisage distant dans l'interface.
      node.textContent = String(value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(node: HTMLElement, ...children: Child[]): void {
  clear(node);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

/**
 * Icone Lucide du kit, posee dans un element.
 *
 * Seul jeu d'icones de la famille : jamais d'emoji, jamais un autre jeu.
 * Le SVG vient de JT.icon(), qui peint en `currentColor`.
 */
export function icon(name: string, size = 14): HTMLElement {
  const holder = el("span", { class: "ic-wrap" });
  // innerHTML est sans danger ici : la chaine vient d'une table d'icones close,
  // embarquee dans le kit, et `size` est un nombre. Rien de distant n'y entre —
  // contrairement au contenu des articles, qui n'est jamais pose ainsi.
  holder.innerHTML = JT.icon(name, size);
  return holder;
}

let toastTimer: number | undefined;

export function toast(message: string, ms = 3500): void {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  // Le toast du kit s'anime par la classe `show` : l'attribut `hidden` le
  // ferait apparaitre sans transition.
  node.classList.add("show");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.classList.remove("show");
  }, ms);
}

export function spinner(label: string): HTMLElement {
  return el("div", { class: "row" }, [el("span", { class: "spinner" }), el("span", { text: label })]);
}

export function notice(kind: "info" | "warn" | "error" | "ok", message: string): HTMLElement {
  return el("div", { class: `notice notice--${kind}`, text: message });
}
