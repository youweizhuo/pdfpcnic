// Deck file names and versions, shared by the management page and the viewer.

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Six letters and digits, without the ones that look alike. */
export const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join("");

const parts = (name) => {
  const m = /^(.+?)(?:\.v(\d+))?\.(pdf|pdfpc)$/i.exec(name);
  return m && { base: m[1], version: Number(m[2] ?? 1), kind: m[3].toLowerCase() };
};

/** @param {string[]} names */
function latestPdf(names) {
  let newest = null;
  for (const name of names) {
    const parsed = parts(name);
    if (parsed?.kind === "pdf" && (!newest || parsed.version > newest.version)) newest = { name, ...parsed };
  }
  return newest;
}

/**
 * The latest PDF and the notes of that version, if present.
 * @param {string[]} names
 * @returns {{ pdf: string, notes?: string } | null}
 */
export function newestFiles(names) {
  const newest = latestPdf(names);
  if (!newest) return null;
  const notes = names.find((name) => {
    const parsed = parts(name);
    return parsed?.kind === "pdfpc" && parsed.base === newest.base && parsed.version === newest.version;
  });
  return notes ? { pdf: newest.name, notes } : { pdf: newest.name };
}

/** The stem for a deck's next version: `talk.v3`, after `talk.pdf` and `talk.v2.pdf`. */
export function nextVersion(names) {
  const newest = latestPdf(names);
  if (!newest) throw new Error("This deck no longer has a PDF.");
  return `${newest.base}.v${newest.version + 1}`;
}

/**
 * Files dropped together, as decks: each PDF with the `.pdfpc` file of its name, or with the only one if it's the only
 * PDF, whatever that's called. Throws, saying why, for what can't be kept.
 */
export function pairFiles(files) {
  const stem = (f) => f.name.replace(/\.[^.]+$/, "");
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
  const notes = files.filter((f) => /\.pdfpc$/i.test(f.name));
  const other = files.find((f) => !pdfs.includes(f) && !notes.includes(f));
  if (other) throw new Error(`${other.name} is neither a PDF nor a .pdfpc file.`);
  if (!pdfs.length) throw new Error("Add the PDF too: a .pdfpc file is uploaded with its PDF.");
  const decks = pdfs.map((pdf) => ({ pdf, notes: notes.find((n) => stem(n) === stem(pdf)) ?? (pdfs.length === 1 ? notes[0] : undefined) }));
  const loose = notes.find((n) => !decks.some((d) => d.notes === n));
  if (loose) throw new Error(`${loose.name} has no PDF of its name among these files.`);
  return decks;
}
