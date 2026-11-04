// A deck's link, as pasted or from the page's address, and which of a deck's files it
// opens. A deck on a pdfpcnic server is a folder named by its token, holding
// `talk.pdf`, then `talk.v2.pdf` and so on, each with the `.pdfpc` file of its own
// version.

export interface DeckLink {
  /** The server's address, or empty for this page's own server. */
  server: string;
  token: string;
}

const TOKEN = "[a-z2-9]{6}";

/** What a link names, or null if it names nothing. */
export function deckLink(text: string): DeckLink | null {
  const link = text.trim();
  const own = new RegExp(`^#?(${TOKEN})$`, "i").exec(link);
  if (own) return { server: "", token: own[1]!.toLowerCase() };
  // No spaces, and no other scheme. (A colon before digits is a port.)
  if (link.includes(" ") || /^(?!https?:\/\/)[a-z][a-z0-9+.-]*:(?!\d)/i.test(link)) return null;
  const url = /^https?:\/\//i.test(link) ? link : `https://${link}`;
  const shared = new RegExp(`^(https?://[^/#?]+(?:/[^#?]*)?)#(${TOKEN})$`, "i").exec(url);
  return shared && { server: shared[1]!.replace(/\/?$/, "/"), token: shared[2]!.toLowerCase() };
}

/** A file's name without its version and extension, its version (1 without a mark), and its kind. */
function parts(name: string): { base: string; version: number; kind: string } | null {
  const m = /^(.+?)(?:\.v(\d+))?\.(pdf|pdfpc)$/i.exec(name);
  return m && { base: m[1]!, version: Number(m[2] ?? 1), kind: m[3]!.toLowerCase() };
}

/** Which of a deck's files to open: the highest version's PDF, with the notes of that same version alone. */
export function newestFiles(names: string[]): { pdf: string; notes?: string } | null {
  let newest: { name: string; base: string; version: number } | null = null;
  for (const name of names) {
    const p = parts(name);
    if (p?.kind === "pdf" && (!newest || p.version > newest.version)) newest = { name, base: p.base, version: p.version };
  }
  if (!newest) return null;
  const { name: pdf, base, version } = newest;
  const notes = names.find((name) => {
    const p = parts(name);
    return p?.kind === "pdfpc" && p.base === base && p.version === version;
  });
  return notes ? { pdf, notes } : { pdf };
}
