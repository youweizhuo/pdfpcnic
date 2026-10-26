// Keeps the last deck and where the talk stood, so an accidental reload
// mid-talk resumes at the same slide with the timer still running. All of it
// stays in this browser's storage.

import type { TimerState } from "./timer";

export interface SavedDeck {
  pdfName: string;
  pdf: ArrayBuffer;
  pdfpcName?: string;
  pdfpc?: string;
}

export interface SavedSession {
  pdfName: string;
  page: number;
  timer: TimerState;
  endSlide?: number;
  bookmark?: number | null;
  /** Seconds spent on each planned window, by the presenter's keys. */
  spent?: Record<string, number>;
  savedAt: number;
}

const DB = "pdfpcnic";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// Storage can be off (private windows, locked-down machines); presenting must not depend on it.
const quiet = async <T>(p: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await p();
  } catch {
    return undefined;
  }
};

export const saveDeck = (d: SavedDeck) => quiet(() => run("readwrite", (s) => s.put(d, "deck")));
export const loadDeck = () => quiet(() => run<SavedDeck | undefined>("readonly", (s) => s.get("deck")));
export const saveSession = (x: SavedSession) => quiet(() => run("readwrite", (s) => s.put(x, "session")));
export const loadSession = () => quiet(() => run<SavedSession | undefined>("readonly", (s) => s.get("session")));
export const clearSession = () => quiet(() => run("readwrite", (s) => s.delete("session")));

/** Small per-browser preferences. */
export function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`pdfpcnic.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`pdfpcnic.${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}
