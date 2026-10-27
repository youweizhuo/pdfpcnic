// The start page: opening a deck from its files, the demo, or where the last
// visit left off. It hands each deck to a fresh presenter.

import { buildDeck } from "../core/deck.ts";
import { HELP } from "../core/keys.ts";
import { parsePdfpc, PdfpcError, type PdfpcFile } from "../core/pdfpc.ts";
import { resumes, type SavedSession } from "../core/talk.ts";
import type { Platform } from "../platform.ts";
import { $, el, reasonOf, report, toast } from "./dom.ts";
import { Presenter, type Source } from "./presenter.ts";

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

async function readFiles(files: Iterable<File>): Promise<Partial<Source>> {
  const out: Partial<Source> = {};
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (name.endsWith(".pdfpc") || name.endsWith(".json")) {
      out.pdfpc = { name: f.name, text: await f.text() };
    } else if (name.endsWith(".pdf") || f.type === "application/pdf") {
      out.pdf = { name: f.name, data: await f.arrayBuffer() };
    } else if (new TextDecoder().decode(await f.slice(0, 5).arrayBuffer()) === "%PDF-") {
      out.pdf = { name: f.name, data: await f.arrayBuffer() };
    } else {
      throw new Error(`${f.name} is neither a PDF nor a .pdfpc file.`);
    }
  }
  return out;
}

interface OpenOptions {
  /** Where to resume. */
  saved?: SavedSession;
  /** Keep the files for "Resume" after a reload. */
  keep?: boolean;
  /** Save the place and the clock as the talk goes. */
  track?: boolean;
}

export async function start(platform: Platform): Promise<void> {
  let presenter: Presenter | null = null;
  const audience = platform.audience({
    key: (e) => presenter?.onKey(e),
    step: (d) => presenter?.act(d > 0 ? "next" : "prev"),
    pointer: (at) => presenter?.pointAt(at),
    follow: (to) => presenter?.follow(to),
    change: () => presenter?.render(),
  });

  async function openSource(source: Source, { saved, keep = true, track = true }: OpenOptions = {}): Promise<void> {
    let meta: PdfpcFile | null = null;
    const notices: string[] = [];
    if (source.pdfpc) {
      try {
        meta = parsePdfpc(source.pdfpc.text);
      } catch (err) {
        if (!(err instanceof PdfpcError)) throw err;
        notices.push(`${source.pdfpc.name}: ${err.message} Continuing without it.`);
        source = { pdf: source.pdf };
      }
    }
    const pdf = await platform.openPdf(source.pdf.data);
    const deck = buildDeck(source.pdf.name, pdf.pages, meta);
    if (source.pdfpc && stem(source.pdfpc.name) !== stem(source.pdf.name)) {
      notices.push(`Note: ${source.pdfpc.name} and ${source.pdf.name} have different names. Check that they belong together.`);
    }
    notices.push(...deck.warnings);

    const previous = presenter;
    presenter = null;
    previous?.dispose();
    await previous?.opened.pdf.close();
    presenter = new Presenter(platform, audience, { source, pdf, deck }, saved, track);
    // The audience window comes with the deck. A browser opens one only right
    // after a click or key (or once its pop-ups are allowed): otherwise the
    // button by the clock offers it, as it does once the window is closed.
    try {
      audience.open(true);
    } catch {
      // Blocked.
    }
    if (keep) {
      void platform.store.saveDeck({ pdfName: source.pdf.name, pdf: source.pdf.data, pdfpcName: source.pdfpc?.name, pdfpc: source.pdfpc?.text });
    }
    if (notices.length) report(notices.join(" "));
    else if (!source.pdfpc) toast("No .pdfpc file. Drop it on this window any time to add notes and timing.", 6000);
  }

  async function openFiles(files: Iterable<File>): Promise<void> {
    const status = $("start-error");
    try {
      const got = await readFiles(files);
      if (got.pdf) {
        status.hidden = false;
        status.textContent = `Opening ${got.pdf.name}…`;
        await openSource({ pdf: got.pdf, pdfpc: got.pdfpc });
        status.hidden = true;
      } else if (got.pdfpc && presenter) {
        // Notes added to the deck already open: keep the place and the clock.
        const p = presenter;
        const s = p.talk.state;
        await openSource(
          { pdf: p.opened.source.pdf, pdfpc: got.pdfpc },
          // Kept and tracked as the deck was: notes dropped on the demo don't make it the deck to resume.
          { saved: { pdfName: p.deck.name, page: s.page, timer: s.timer, bookmark: s.bookmark, savedAt: Date.now() }, keep: p.track, track: p.track },
        );
        toast(`Loaded notes from ${got.pdfpc.name}.`);
      } else if (got.pdfpc) {
        throw new Error("That's the .pdfpc file. Add the PDF too (you can select both at once).");
      }
    } catch (err) {
      const message = reasonOf(err);
      if (presenter) report(message);
      else {
        status.hidden = false;
        status.textContent = message;
      }
    }
  }

  $("version").innerHTML =
    `v${__VERSION__} · <a href="https://github.com/youweizhuo/pdfpcnic" target="_blank" rel="noopener">source</a>` +
    (__BUILD__ === "site" ? ` · <a href="./licenses.txt" target="_blank">licenses</a>` : "");
  $("offline-note").innerHTML = {
    site: `<a href="./pdfpcnic.html" download>Download the offline copy</a> (one HTML file).`,
    single: "This is the offline copy: it needs no network.",
    mac: "The Mac app: it needs no network.",
  }[__BUILD__];

  const grid = $("help-grid");
  for (const [title, rows] of HELP) {
    const section = el("section");
    const dl = el("dl");
    for (const [keys, what] of rows) dl.append(el("dt", "", keys), el("dd", "", what));
    section.append(el("h3", "", title), dl);
    grid.insertBefore(section, $("legend"));
  }

  const input = $<HTMLInputElement>("files");
  input.addEventListener("change", () => {
    if (input.files?.length) void openFiles([...input.files]);
    input.value = "";
  });
  $("open-files").addEventListener("click", () => input.click());
  const demo = $("demo");
  const load = platform.demo;
  if (load) {
    demo.addEventListener("click", () => {
      void load()
        .then(({ pdf, pdfpc }) =>
          openSource({ pdf: { name: "demo.pdf", data: pdf }, pdfpc: { name: "demo.pdfpc", text: pdfpc } }, { keep: false, track: false }),
        )
        .catch((err) => {
          $("start-error").hidden = false;
          $("start-error").textContent = reasonOf(err);
        });
    });
  } else demo.remove();

  const drop = $("drop");
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    drop.classList.add("over");
  });
  window.addEventListener("dragleave", () => {
    if (--depth <= 0) drop.classList.remove("over");
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    drop.classList.remove("over");
    if (e.dataTransfer?.files.length) void openFiles([...e.dataTransfer.files]);
  });

  window.addEventListener("keydown", (e) => presenter?.onKey(e));
  $("error-close").addEventListener("click", () => ($("error").hidden = true));

  // For tests and the curious.
  Object.assign(window, {
    pdfpcnic: {
      get state() {
        return presenter?.talk.state;
      },
      get deck() {
        return presenter?.deck;
      },
      audience,
    },
  });

  platform.files?.((files) => void openFiles(files));

  // Offer to pick up where an earlier visit left off (an accidental reload, say).
  const [deck, session] = await Promise.all([platform.store.loadDeck(), platform.store.loadSession()]);
  if (deck) {
    const resume = $<HTMLButtonElement>("resume");
    const recent = resumes(session, deck.pdfName, Date.now());
    resume.textContent = recent ? `Resume ${deck.pdfName} at page ${session.page + 1}` : `Reopen ${deck.pdfName}`;
    resume.hidden = false;
    resume.focus();
    const forget = $<HTMLButtonElement>("forget");
    forget.hidden = false;
    forget.addEventListener("click", () => {
      resume.remove();
      forget.remove();
      void platform.store.forget();
      toast(`Removed ${deck.pdfName} from this browser.`);
    });
    resume.addEventListener("click", () => {
      const source: Source = {
        pdf: { name: deck.pdfName, data: deck.pdf },
        pdfpc: deck.pdfpc && deck.pdfpcName ? { name: deck.pdfpcName, text: deck.pdfpc } : undefined,
      };
      void openSource(source, { saved: recent ? session : undefined, keep: false }).catch((err) => {
        $("start-error").hidden = false;
        $("start-error").textContent = String(err);
      });
    });
  }
}
