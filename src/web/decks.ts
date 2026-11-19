// Fetching a deck by its link. Only a deck server's own site and the Mac app carry
// this: not the public website or the offline file.

import { type DeckLink, newestFiles } from "../core/decklink.ts";

const megabytes = (bytes: number) => (bytes / 1_048_576).toFixed(1);

async function readBody(res: Response, name: string, onProgress?: (status: string) => void): Promise<ArrayBuffer> {
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
    onProgress(
      total >= loaded
        ? `Fetching ${name} (${megabytes(loaded)} / ${megabytes(total)} MB, ${Math.round((loaded / total) * 100)}%)…`
        : `Fetching ${name} (${megabytes(loaded)} MB)…`,
    );
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
export async function fetchDeck(link: DeckLink, onProgress?: (status: string) => void): Promise<File[]> {
  if (!link.server && typeof __BUILD__ !== "undefined" && __BUILD__ === "mac") {
    throw new Error("Paste the deck's whole link, with the server's address.");
  }
  const folder = new URL(`decks/${link.token}/`, link.server || location.href);
  const unreachable = () => {
    throw new Error(`Can't reach ${folder.host}. Check the connection, or open the deck from its files.`);
  };
  const list = await fetch(folder).catch(unreachable);
  if (list.status === 404) throw new Error(`There's no deck ${link.token} on ${folder.host}. Check the link.`);
  if (!list.ok) throw new Error(`${folder.host} answered ${list.status}, so the deck didn't arrive. Try again in a moment.`);
  const entries = (await list.json().catch(() => {
    throw new Error(`${folder.host} returned an unreadable file list for deck ${link.token}.`);
  })) as Array<{ name: string }>;
  const newest = newestFiles(Array.isArray(entries) ? entries.map((e) => e.name) : []);
  if (!newest) throw new Error(`Deck ${link.token} has no PDF yet.`);
  const file = async (name: string) => {
    onProgress?.(`Fetching ${name}…`);
    const res = await fetch(new URL(encodeURIComponent(name), folder)).catch(unreachable);
    if (res.status === 404) throw new Error(`${name} is missing from deck ${link.token} on ${folder.host}.`);
    if (!res.ok) throw new Error(`${folder.host} answered ${res.status} for ${name}, so the deck didn't arrive. Try again in a moment.`);
    const bytes = await readBody(res, name, onProgress).catch(unreachable);
    return new File([bytes], name);
  };
  const files = [await file(newest.pdf)];
  if (newest.notes) files.push(await file(newest.notes));
  return files;
}
