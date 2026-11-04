// Fetching a deck by its link. Only the builds with a network carry this; the
// offline file doesn't.

import { type DeckLink, newestFiles } from "../core/decklink.ts";

const nameOf = (url: string) => decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "deck.pdf");

/** A deck's PDF, and its `.pdfpc` file if it has one. Rejects, saying why, if it can't get them. */
export async function fetchDeck(link: DeckLink): Promise<File[]> {
  const file = async (url: string) => new File([await (await fetch(url)).arrayBuffer()], nameOf(url));
  if (link.kind === "pdf") {
    const host = new URL(link.pdf).host;
    const pdf = await fetch(link.pdf).catch(() => {
      throw new Error(`Can't read that from ${host}: it may be offline, or not let other sites read its files.`);
    });
    if (!pdf.ok) throw new Error(`${host} answered ${pdf.status} for that PDF. Check the address.`);
    const files = [new File([await pdf.arrayBuffer()], nameOf(link.pdf))];
    // No notes beside it, however the host says so: some refuse the page even an answer for a missing file.
    const notes = await fetch(link.notes).catch(() => null);
    if (notes?.ok) files.push(new File([await notes.arrayBuffer()], nameOf(link.notes)));
    return files;
  }
  const folder = new URL(`decks/${link.token}/`, link.server || location.href);
  const list = await fetch(folder).catch(() => {
    throw new Error(`Can't reach ${link.server ? folder.host : "the deck's server"}. Check the connection, or open the deck from its files.`);
  });
  if (list.status === 404) {
    throw new Error(`There's no deck ${link.token} ${link.server ? `on ${folder.host}` : "here: paste its whole link, with the server's address"}.`);
  }
  if (!list.ok) throw new Error(`${folder.host} answered ${list.status}, so the deck didn't arrive. Try again in a moment.`);
  const entries = (await list.json()) as Array<{ name: string }>;
  const newest = newestFiles(entries.map((e) => e.name));
  if (!newest) throw new Error(`Deck ${link.token} has no PDF yet.`);
  const at = (name: string) => new URL(encodeURIComponent(name), folder).href;
  return Promise.all([file(at(newest.pdf)), ...(newest.notes ? [file(at(newest.notes))] : [])]);
}
