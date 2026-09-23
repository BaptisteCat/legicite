/**
 * Helpers DOM minimalistes.
 * Pas de framework : l'interface du volet reste modeste et une couche de plus
 * alourdirait le bundle charge par Word a chaque ouverture.
 */

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

let toastTimer: number | undefined;

export function toast(message: string, ms = 3500): void {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.hidden = true;
  }, ms);
}

export function spinner(label: string): HTMLElement {
  return el("div", { class: "row" }, [el("span", { class: "spinner" }), el("span", { text: label })]);
}

export function notice(kind: "info" | "warn" | "error" | "ok", message: string): HTMLElement {
  return el("div", { class: `notice notice--${kind}`, text: message });
}
