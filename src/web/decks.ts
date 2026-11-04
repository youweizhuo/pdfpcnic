// Fetching a deck by its link. Only a deck server's own site and the Mac app carry
// this: not the public website or the offline file.

import { type DeckLink, newestFiles } from "../core/decklink.ts";

/** A deck's PDF, and its `.pdfpc` file if it has one. Rejects, saying why, if it can't get them. */
export async function fetchDeck(link: DeckLink): Promise<File[]> {
  if (!link.server && __BUILD__ === "mac") throw new Error("Paste the deck's whole link, with the server's address.");
  const folder = new URL(`decks/${link.token}/`, link.server || location.href);
  const list = await fetch(folder).catch(() => {
    throw new Error(`Can't reach ${folder.host}. Check the connection, or open the deck from its files.`);
  });
  if (list.status === 404) throw new Error(`There's no deck ${link.token} on ${folder.host}. Check the link.`);
  if (!list.ok) throw new Error(`${folder.host} answered ${list.status}, so the deck didn't arrive. Try again in a moment.`);
  const entries = (await list.json()) as Array<{ name: string }>;
  const newest = newestFiles(entries.map((e) => e.name));
  if (!newest) throw new Error(`Deck ${link.token} has no PDF yet.`);
  const file = async (name: string) => new File([await (await fetch(new URL(encodeURIComponent(name), folder))).arrayBuffer()], name);
  return Promise.all([file(newest.pdf), ...(newest.notes ? [file(newest.notes)] : [])]);
}
