// Decks for the tests, built as the PDF engine would describe them.

import { buildDeck } from "../src/core/deck.ts";

/** A deck from its pages' labels (null for none), and optionally notes from the PDF, a .pdfpc file and the PDF's outline. */
export function deck(labels, { meta = null, notes = [], name = "talk.pdf", outline = [] } = {}) {
  const info = labels.map((label, i) => ({ width: 800, height: 450, label, note: notes[i] ?? "", links: [] }));
  return buildDeck(name, info, meta, outline);
}

/** A .pdfpc file's settings, with notes by page index. */
export function pdfpc(notes = {}, extra = {}) {
  return { pages: Object.entries(notes).map(([idx, note]) => ({ idx: Number(idx), note })), ...extra };
}

/** A local time today, in ms. */
export const at = (h, m = 0, s = 0) => new Date(2026, 9, 27, h, m, s).getTime();
