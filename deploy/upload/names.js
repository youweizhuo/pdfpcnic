// What to call what's uploaded: a deck's token, its next version, and which files
// go together. Nothing here touches the page, so the unit tests read it too.

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Six letters and digits, without the ones that look alike. */
export const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join("");

const parts = (name) => {
  const m = /^(.+?)(?:\.v(\d+))?\.(pdf|pdfpc)$/i.exec(name);
  return m && { base: m[1], version: Number(m[2] ?? 1), kind: m[3].toLowerCase() };
};

/** The stem for a deck's next version: `talk.v3`, after `talk.pdf` and `talk.v2.pdf`. */
export function nextVersion(names) {
  const pdfs = names.map(parts).filter((p) => p?.kind === "pdf");
  const newest = pdfs.reduce((a, b) => (b.version > a.version ? b : a));
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
