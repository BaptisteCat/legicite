/**
 * Cache a duree de vie, persiste dans localStorage.
 *
 * Double objectif : menager les quotas PISTE (fixes par la DILA et modifiables
 * a tout moment) et rendre l'interface reactive. Rien de sensible n'y transite :
 * uniquement des textes legaux publics.
 *
 * Regle de prudence : une donnee servie depuis le cache est toujours
 * accompagnee de sa date de recuperation, pour ne jamais laisser croire
 * qu'elle est a jour.
 */

const PREFIX = "legiword:cache:";

interface Entry<T> {
  value: T;
  storedAt: number;
  expiresAt: number;
}

export interface CachedValue<T> {
  value: T;
  storedAt: Date;
  fromCache: boolean;
}

function read<T>(key: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (typeof entry.expiresAt !== "number") return null;
    return entry;
  } catch {
    return null;
  }
}

function write<T>(key: string, entry: Entry<T>): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota de stockage atteint : on purge les entrees expirees puis on abandonne
    // silencieusement, le cache n'est jamais indispensable au fonctionnement.
    purgeExpired();
  }
}

export function getCached<T>(key: string): CachedValue<T> | null {
  const entry = read<T>(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
    return null;
  }
  return { value: entry.value, storedAt: new Date(entry.storedAt), fromCache: true };
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  const now = Date.now();
  write(key, { value, storedAt: now, expiresAt: now + ttlMs });
}

/**
 * Recupere depuis le cache, sinon appelle `loader`. En cas d'echec reseau, une
 * valeur expiree est preferee a une erreur : c'est le mode degrade hors ligne.
 */
export async function withCache<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<CachedValue<T>> {
  const hit = getCached<T>(key);
  if (hit) return hit;

  try {
    const value = await loader();
    setCached(key, value, ttlMs);
    return { value, storedAt: new Date(), fromCache: false };
  } catch (error) {
    const stale = read<T>(key);
    if (stale) return { value: stale.value, storedAt: new Date(stale.storedAt), fromCache: true };
    throw error;
  }
}

export function purgeExpired(): number {
  let removed = 0;
  try {
    const now = Date.now();
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as Entry<unknown>;
        if (now > entry.expiresAt) {
          localStorage.removeItem(key);
          removed++;
        }
      } catch {
        localStorage.removeItem(key);
        removed++;
      }
    }
  } catch {
    /* localStorage indisponible */
  }
  return removed;
}

export function purgeAll(): number {
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      localStorage.removeItem(key);
      removed++;
    }
  } catch {
    /* ignore */
  }
  return removed;
}

export const TTL = {
  /** Liste des codes : change rarement. */
  codeList: 30 * 24 * 3600 * 1000,
  /** Contenu d'un article : une journee suffit, la loi ne change pas a l'heure. */
  article: 24 * 3600 * 1000,
  /** Resultats de recherche. */
  search: 6 * 3600 * 1000,
  /** Sommaire d'un code, volumineux. */
  sommaire: 7 * 24 * 3600 * 1000,
} as const;
