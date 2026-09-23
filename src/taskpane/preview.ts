/**
 * Rendu d'apercu des blocs dans le volet.
 *
 * Volontairement construit noeud par noeud plutot qu'en assemblant du HTML :
 * le contenu vient d'une API externe, et l'injecter via innerHTML ouvrirait la
 * porte a du balisage arbitraire dans le volet.
 */

import type { Block, Inline } from "../core/blocks";
import { el } from "./dom";

function runNode(run: Inline): Node {
  let node: Node = document.createTextNode(run.text);
  if (run.superscript) node = el("sup", {}, [node]);
  if (run.underline) node = el("u", {}, [node]);
  if (run.italic) node = el("em", {}, [node]);
  if (run.bold) node = el("strong", {}, [node]);
  return node;
}

export function renderBlocks(blocks: Block[]): HTMLElement {
  const container = el("div", { class: "preview" });

  for (const block of blocks) {
    switch (block.type) {
      case "paragraph": {
        const paragraph = el("p", {});
        block.runs.forEach((run) => paragraph.appendChild(runNode(run)));
        container.appendChild(paragraph);
        break;
      }
      case "list": {
        const list = el(block.ordered ? "ol" : "ul", {});
        for (const item of block.items) {
          const li = el("li", {});
          item.forEach((run) => li.appendChild(runNode(run)));
          list.appendChild(li);
        }
        container.appendChild(list);
        break;
      }
      case "table": {
        const table = el("table", {});
        block.rows.forEach((row, index) => {
          const tr = el("tr", {});
          const cellTag = block.hasHeader && index === 0 ? "th" : "td";
          row.forEach((cell) => tr.appendChild(el(cellTag, { text: cell })));
          table.appendChild(tr);
        });
        container.appendChild(table);
        break;
      }
    }
  }

  if (!container.firstChild) container.appendChild(el("p", { class: "jt-hint", text: "(contenu vide)" }));
  return container;
}
