// Keeps the last deck and where the talk stood, so an accidental reload
// mid-talk resumes at the same slide with the timer still running. All of it
// stays in this browser's storage.

import type { SavedSession } from "../core/talk.ts";
import type { SavedDeck, Store } from "../platform.ts";

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

/** Small per-browser preferences. */
function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`pdfpcnic.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function setPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`pdfpcnic.${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export const store: Store = {
  saveDeck: (d: SavedDeck) => quiet(() => run("readwrite", (s) => s.put(d, "deck"))),
  loadDeck: () => quiet(() => run<SavedDeck | undefined>("readonly", (s) => s.get("deck"))),
  saveSession: (x: SavedSession) => quiet(() => run("readwrite", (s) => s.put(x, "session"))),
  loadSession: () => quiet(() => run<SavedSession | undefined>("readonly", (s) => s.get("session"))),
  forget: () => quiet(() => run("readwrite", (s) => s.clear())),
  pref,
  setPref,
};
