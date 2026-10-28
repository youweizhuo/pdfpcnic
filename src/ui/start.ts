// The start page: opening a deck from its files, the demo, or where the last
// visit left off. It hands each deck to a fresh presenter.

import { buildDeck } from "../core/deck.ts";
import { HELP, HELP_TOP } from "../core/keys.ts";
import { parsePdfpc, PdfpcError, type PdfpcFile } from "../core/pdfpc.ts";
import { resumes, type SavedSession } from "../core/talk.ts";
import type { Platform } from "../platform.ts";
import { $, el, reasonOf, report, toast } from "./dom.ts";
import { type Opened, Presenter, type Source } from "./presenter.ts";

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

/** A deck read from its files, with what to say about them. */
interface Prepared extends Opened {
  notices: string[];
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
    follow: (to) => presenter?.follow(to),
    change: () => presenter?.render(),
  });

  /**
   * Opens the audience window, behind the presenter where the platform can put
   * it. A browser opens one only during a click or key, so Present, Resume and
   * the demo call this in their click, before the deck is read. Blocked, the
   * button by the clock offers it, as it does once the window is closed.
   */
  function openAudience(): void {
    try {
      audience.open(true);
    } catch {
      // Blocked.
    }
  }

  /** Reads a deck from its files. */
  async function prepare(source: Source): Promise<Prepared> {
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
    const deck = buildDeck(source.pdf.name, pdf.pages, meta, pdf.outline);
    if (source.pdfpc && stem(source.pdfpc.name) !== stem(source.pdf.name)) {
      notices.push(`Note: ${source.pdfpc.name} and ${source.pdf.name} have different names. Check that they belong together.`);
    }
    notices.push(...deck.warnings);
    return { source, pdf, deck, notices };
  }

  /** Hands a deck to a fresh presenter, with the audience window. */
  async function present({ notices, ...opened }: Prepared, { saved, keep = true, track = true }: OpenOptions = {}): Promise<void> {
    const { source } = opened;
    const previous = presenter;
    presenter = null;
    previous?.dispose();
    await previous?.opened.pdf.close();
    presenter = new Presenter(platform, audience, opened, saved, track);
    openAudience();
    if (keep) {
      void platform.store.saveDeck({ pdfName: source.pdf.name, pdf: source.pdf.data, pdfpcName: source.pdfpc?.name, pdfpc: source.pdfpc?.text });
    }
    if (notices.length) report(notices.join(" "));
    else if (!source.pdfpc) toast("No .pdfpc file. Drop it on this window any time to add notes and timing.", 6000);
  }

  const openSource = async (source: Source, options?: OpenOptions) => present(await prepare(source), options);

  /** The deck on the start page, waiting for Present. */
  let ready: Prepared | null = null;
  function showReady(p: Prepared): void {
    void ready?.pdf.close();
    ready = p;
    const { source, deck } = p;
    const n = deck.slides.length;
    $("ready-name").textContent = source.pdfpc ? `${source.pdf.name} + ${source.pdfpc.name}` : source.pdf.name;
    $("ready-info").textContent = `${n} slide${n === 1 ? "" : "s"}` + (deck.duration ? ` · ${deck.duration} min` : "");
    $("drop").hidden = $("actions").hidden = true;
    $("ready").hidden = false;
    $("present").focus();
  }

  /**
   * Opens a deck from its files: on the start page, it waits there for
   * Present; with a deck open, or from the Finder, it opens at once.
   */
  async function openFiles(files: Iterable<File>, now = presenter !== null): Promise<void> {
    const status = $("start-error");
    try {
      const got = await readFiles(files);
      if (got.pdf) {
        status.hidden = false;
        status.textContent = `Opening ${got.pdf.name}…`;
        const source = { pdf: got.pdf, pdfpc: got.pdfpc };
        if (now) await openSource(source);
        else showReady(await prepare(source));
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
      } else if (got.pdfpc && ready) {
        showReady(await prepare({ pdf: ready.source.pdf, pdfpc: got.pdfpc }));
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

  $("version").textContent = __BUILD__ === "mac" ? `${__VERSION__} for Mac` : __VERSION__;
  if (__BUILD__ === "mac") {
    $("tagline").textContent = "Present PDF slides with a pdfpc-style presenter view, on your Mac.";
    $("private").textContent = "";
  }
  $("offline-note").innerHTML = {
    site: `<a href="./pdfpcnic.html" download>Download the offline copy</a> (one HTML file).`,
    single: "This is the offline copy: it needs no network.",
    mac: "",
  }[__BUILD__];
  $("links").innerHTML =
    `<a href="https://github.com/youweizhuo/pdfpcnic" target="_blank" rel="noopener">source</a>` +
    (__BUILD__ === "site" ? ` · <a href="./licenses.txt" target="_blank">licenses</a>` : "");

  for (const [keys, what, mouse] of HELP_TOP) {
    const li = el("li");
    li.append(el(mouse ? "b" : "kbd", "", keys), el("span", "", what));
    $("help-top").append(li);
  }
  for (const [title, rows] of HELP) {
    const section = el("section");
    const line = el("p");
    for (const [keys, what] of rows) {
      const span = el("span", "", ` ${what}`);
      span.prepend(el("kbd", "", keys));
      line.append(span);
    }
    section.append(el("h3", "", title), line);
    $("help-rest").append(section);
  }

  const input = $<HTMLInputElement>("files");
  input.addEventListener("change", () => {
    if (input.files?.length) void openFiles([...input.files]);
    input.value = "";
  });
  $("open-files").addEventListener("click", () => input.click());
  $("choose-other").addEventListener("click", () => input.click());
  $("present").addEventListener("click", () => {
    if (!ready) return;
    openAudience();
    void present(ready).catch((err) => {
      $("start-error").hidden = false;
      $("start-error").textContent = reasonOf(err);
    });
    ready = null;
  });
  const demo = $("demo");
  const load = platform.demo;
  if (load) {
    demo.addEventListener("click", () => {
      openAudience();
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

  platform.files?.((files) => void openFiles(files, true));

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
      openAudience();
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
