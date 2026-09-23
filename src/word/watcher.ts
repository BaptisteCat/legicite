/**
 * Declenchement de /art et /artv tapes directement dans le document.
 *
 * Office.js ne permet pas d'intercepter les frappes clavier : il n'existe
 * aucun equivalent de keydown sur le corps du document. On surveille donc les
 * evenements de paragraphe (WordApi 1.6).
 *
 * Deux evenements, deux roles :
 *
 *  - `onParagraphAdded` (validation par Entree) declenche l'insertion. Le
 *    paragraphe a traiter est celui qui PRECEDE le point d'insertion : on y
 *    accede par getPreviousOrNullObject, en temps constant. La version
 *    precedente chargeait tous les paragraphes du document a chaque Entree,
 *    ce qui devenait tres couteux sur un dossier de plusieurs centaines de
 *    pages — pour un evenement qui, la plupart du temps, ne concerne pas
 *    l'extension.
 *
 *  - `onParagraphChanged` (frappe en cours) sert uniquement a PRECHARGER
 *    l'article. Rien n'est insere : on remplit le cache pendant que
 *    l'utilisateur finit de taper, pour que la validation soit instantanee.
 */

import { findTrigger, parseCommand } from "../core/parser";

export interface TriggerEvent {
  /** Identifiant du paragraphe contenant la commande. */
  paragraphId: string;
  /** Texte exact de la commande, a remplacer par la citation. */
  raw: string;
}

type AddedHandler = (args: Word.ParagraphAddedEventArgs) => Promise<void>;
type ChangedHandler = (args: Word.ParagraphChangedEventArgs) => Promise<void>;

let addedRef: AddedHandler | null = null;
let changedRef: ChangedHandler | null = null;
let running = false;

/** Delai d'inactivite avant de precharger, en millisecondes. */
const PREFETCH_DELAY = 450;
let prefetchTimer: number | undefined;
let lastPrefetched = "";

/**
 * Suspension temporaire de la surveillance.
 *
 * L'insertion d'une citation ajoute elle-meme des paragraphes, ce qui redeclenche
 * les evenements que l'on ecoute. Sans cette suspension, l'extension reagit a sa
 * propre ecriture.
 */
let suspended = false;

export function suspendWatcher(): void {
  suspended = true;
}

export function resumeWatcher(): void {
  suspended = false;
}

/** Le declencheur exige WordApi 1.6 ; sinon seuls le volet et le ruban restent. */
export function isTriggerSupported(): boolean {
  try {
    return Office.context.requirements.isSetSupported("WordApi", "1.6");
  } catch {
    return false;
  }
}

/**
 * Lit le paragraphe precedant le point d'insertion, sans parcourir le document.
 */
async function readPreviousParagraph(): Promise<{ id: string; text: string } | null> {
  let result: { id: string; text: string } | null = null;

  await Word.run(async (context) => {
    const previous = context.document.getSelection().paragraphs.getFirst().getPreviousOrNullObject();
    previous.load("text,uniqueLocalId,isNullObject");
    await context.sync();
    if (!previous.isNullObject) result = { id: previous.uniqueLocalId, text: previous.text };
  });

  return result;
}

/** Lit le paragraphe courant, pour le prechargement pendant la frappe. */
async function readCurrentParagraph(): Promise<string | null> {
  let text: string | null = null;

  await Word.run(async (context) => {
    const current = context.document.getSelection().paragraphs.getFirst();
    current.load("text");
    await context.sync();
    text = current.text;
  });

  return text;
}

export interface WatcherHandlers {
  /** Commande validee : il faut inserer. */
  onTrigger: (event: TriggerEvent) => void;
  /** Commande en cours de frappe et deja complete : occasion de precharger. */
  onPrefetch?: (command: string) => void;
}

export async function startTriggerWatcher(handlers: WatcherHandlers): Promise<boolean> {
  if (running || !isTriggerSupported()) return false;

  await Word.run(async (context) => {
    addedRef = async () => {
      if (suspended) return;
      const previous = await readPreviousParagraph();
      if (!previous) return;
      const trigger = findTrigger(previous.text);
      if (trigger) handlers.onTrigger({ paragraphId: previous.id, raw: trigger.raw });
    };
    context.document.onParagraphAdded.add(addedRef);

    if (handlers.onPrefetch) {
      changedRef = async () => {
        if (suspended) return;
        if (prefetchTimer) window.clearTimeout(prefetchTimer);
        prefetchTimer = window.setTimeout(() => {
          void (async () => {
            const text = await readCurrentParagraph();
            if (!text) return;
            const trigger = findTrigger(text);
            if (!trigger) return;

            // On ne precharge que si la commande est deja complete et exploitable,
            // pour ne pas consommer de quota sur des saisies inachevees.
            const parsed = parseCommand(trigger.raw);
            if (!parsed.ok) return;
            if (trigger.raw === lastPrefetched) return;

            lastPrefetched = trigger.raw;
            handlers.onPrefetch?.(trigger.raw);
          })();
        }, PREFETCH_DELAY);
      };
      context.document.onParagraphChanged.add(changedRef);
    }

    await context.sync();
  });

  running = true;
  return true;
}

export async function stopTriggerWatcher(): Promise<void> {
  if (!running) return;
  await Word.run(async (context) => {
    if (addedRef) context.document.onParagraphAdded.remove(addedRef);
    if (changedRef) context.document.onParagraphChanged.remove(changedRef);
    await context.sync();
  });
  if (prefetchTimer) window.clearTimeout(prefetchTimer);
  addedRef = null;
  changedRef = null;
  lastPrefetched = "";
  running = false;
}

export function isWatching(): boolean {
  return running;
}
