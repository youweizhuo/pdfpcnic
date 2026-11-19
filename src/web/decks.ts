// The deck server's own site fetches files by the token in its address.

import { newestFiles } from "../../deploy/upload/names.js";
import type { DeckDownload } from "../platform.ts";

type OnProgress = (progress: DeckDownload) => void;

async function readBody(res: Response, name: string, onProgress?: OnProgress): Promise<ArrayBuffer> {
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({ name, received: loaded, total });
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}

/** A deck's PDF, and its `.pdfpc` file if it has one. Rejects, saying why, if it can't get them. */
export async function fetchDeck(token: string, onProgress?: OnProgress, signal?: AbortSignal): Promise<File[]> {
  const folder = new URL(`decks/${token}/`, location.href);
  const unreachable = () => {
    throw new Error(`Can't reach ${folder.host}. Check the connection, or open the deck from its files.`);
  };
  const list = await fetch(folder, { signal }).catch(unreachable);
  if (list.status === 404) throw new Error(`There's no deck ${token} on ${folder.host}. Check the link.`);
  if (!list.ok) throw new Error(`${folder.host} answered ${list.status}, so the deck didn't arrive. Try again in a moment.`);
  const entries = (await list.json().catch(() => {
    throw new Error(`${folder.host} returned an unreadable file list for deck ${token}.`);
  })) as Array<{ name: string }>;
  const newest = newestFiles(Array.isArray(entries) ? entries.map((e) => e.name) : []);
  if (!newest) throw new Error(`Deck ${token} has no PDF yet.`);
  const file = async (name: string) => {
    onProgress?.({ name, received: 0, total: 0 });
    const res = await fetch(new URL(encodeURIComponent(name), folder), { signal }).catch(unreachable);
    if (res.status === 404) throw new Error(`${name} is missing from deck ${token} on ${folder.host}.`);
    if (!res.ok) throw new Error(`${folder.host} answered ${res.status} for ${name}, so the deck didn't arrive. Try again in a moment.`);
    const bytes = await readBody(res, name, onProgress).catch(unreachable);
    return new File([bytes], name);
  };
  const files = [await file(newest.pdf)];
  if (newest.notes) files.push(await file(newest.notes));
  return files;
}
