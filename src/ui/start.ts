// The start page: opening a deck from its files, the demo, or where the last
// visit left off. It hands each deck to a fresh presenter.

import { buildDeck } from "../core/deck.ts";
import { deckToken } from "../core/decklink.ts";
import { HELP } from "../core/keys.ts";
import { parsePdfpc, PdfpcError, type PdfpcFile } from "../core/pdfpc.ts";
import { resumes, type SavedSession } from "../core/talk.ts";
import type { Platform } from "../platform.ts";
import { $, el, reasonOf, report, toast } from "./dom.ts";
import { type Opened, Presenter, type Source } from "./presenter.ts";

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/** GitHub's mark (Octicons, MIT), for the link to the source. */
const GITHUB_MARK =
  '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

type PdfpcText = NonNullable<Source["pdfpc"]>;

function readNotes(notes: PdfpcText): PdfpcFile {
  try {
    return parsePdfpc(notes.text);
  } catch (err) {
    if (!(err instanceof PdfpcError)) throw err;
    throw new PdfpcError(`Couldn't load ${notes.name}. ${err.message}`);
  }
}

/** Files given at once: a PDF, and `.pdfpc` files (the deck's own, and one to compare with it). */
async function readFiles(files: Iterable<File>): Promise<{ pdf?: Source["pdf"]; pdfpcs: PdfpcText[] }> {
  const out: { pdf?: Source["pdf"]; pdfpcs: PdfpcText[] } = { pdfpcs: [] };
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (name.endsWith(".pdfpc") || name.endsWith(".json")) {
      out.pdfpcs.push({ name: f.name, text: await f.text() });
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

/** `.pdfpc` files, the deck's own first: the one named as its PDF, as pdfpc finds it, else the first given. */
const deckFirst = (pdfpcs: PdfpcText[], pdfName: string) =>
  [...pdfpcs].sort((a, b) => Number(stem(b.name) === stem(pdfName)) - Number(stem(a.name) === stem(pdfName)));

/** A deck read from its files, with what to say about them. */
interface Prepared extends Opened {
  notices: string[];
  /** Another `.pdfpc` file, to compare the deck's plan with. */
  other?: PdfpcText;
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
  const status = $("start-error");
  const progress = __DECKS__ ? el("progress", "deck-progress") : null;
  const update = $("update");
  let deckLoad: AbortController | undefined;
  let updateTimer = 0;

  function startStatus(message = "", failed = false): void {
    status.classList.toggle("error", failed);
    if (status.textContent !== message) status.textContent = message;
    status.hidden = !message;
  }

  function endDeckLoad(load: AbortController): void {
    if (load !== deckLoad) return;
    deckLoad = undefined;
    if (progress) progress.hidden = true;
  }

  function cancelDeckLoad(): void {
    if (!deckLoad) return;
    deckLoad.abort();
    endDeckLoad(deckLoad);
    startStatus();
  }

  function beginDeckLoad(): AbortController {
    cancelDeckLoad();
    return (deckLoad = new AbortController());
  }

  function dismissUpdateSoon(): void {
    window.clearTimeout(updateTimer);
    if (presenter && (update.dataset.phase === "installed" || update.dataset.phase === "failed")) {
      updateTimer = window.setTimeout(() => (update.hidden = true), 5000);
    }
  }
  const audience = platform.audience({
    key: (e) => presenter?.onKey(e),
    step: (d) => presenter?.act(d > 0 ? "next" : "prev"),
    follow: (to) => presenter?.follow(to),
    change: () => presenter?.render(),
  });

  /**
   * Opens the audience window, behind the presenter where the platform can put
   * it. Browser actions also call this in their click, while the browser
   * allows a popup. The button by the clock can reopen it.
   */
  function openAudience(): void {
    try {
      audience.open(true);
    } catch {
      // Blocked.
    }
  }

  /** Reads a deck from its files. A new PDF can open even if its notes can't be read. */
  async function prepare(source: Source, invalidNotes: "skip" | "reject" = "skip"): Promise<Prepared> {
    let meta: PdfpcFile | null = null;
    const notices: string[] = [];
    if (source.pdfpc) {
      try {
        meta = readNotes(source.pdfpc);
      } catch (err) {
        if (!(err instanceof PdfpcError)) throw err;
        if (invalidNotes === "reject") throw err;
        notices.push(`${err.message} You can present the PDF on its own or try another notes file.`);
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
  async function present({ notices, other, ...opened }: Prepared, { saved, keep = true, track = true }: OpenOptions = {}): Promise<void> {
    const { source } = opened;
    const previous = presenter;
    presenter = null;
    previous?.dispose();
    await previous?.opened.pdf.close();
    presenter = new Presenter(platform, audience, opened, saved, track);
    if (__BUILD__ === "mac" && !update.classList.contains("toast")) {
      update.classList.add("toast");
      $("toasts").append(update);
      dismissUpdateSoon();
    }
    openAudience();
    if (other) compare(other);
    if (keep) {
      void platform.store.saveDeck({ pdfName: source.pdf.name, pdf: source.pdf.data, pdfpcName: source.pdfpc?.name, pdfpc: source.pdfpc?.text });
    }
    if (notices.length) report(notices.join(" "));
    else if (!source.pdfpc) toast("No .pdfpc file. Drop it on this window any time to add notes and timing.", 6000);
  }

  const openSource = async (source: Source, options?: OpenOptions) => present(await prepare(source), options);

  /** Compares the open deck's plan with another `.pdfpc` file; one that can't be read is said, and changes nothing. */
  function compare(other: PdfpcText): void {
    try {
      presenter?.compareWith(other);
    } catch (err) {
      report(`${other.name}: ${reasonOf(err)}`);
    }
  }

  /** The deck on the start page, waiting for Present. */
  let ready: { prepared: Prepared; options?: OpenOptions } | null = null;
  function showReady(p: Prepared, options?: OpenOptions): void {
    if (ready && ready.prepared.pdf !== p.pdf) void ready.prepared.pdf.close();
    ready = { prepared: p, options };
    const { source, deck } = p;
    const n = deck.slides.length;
    $("ready-name").textContent =
      (source.pdfpc ? `${source.pdf.name} + ${source.pdfpc.name}` : source.pdf.name) + (p.other ? `, compared with ${p.other.name}` : "");
    $("ready-info").textContent = `${n} slide${n === 1 ? "" : "s"}` + (deck.duration ? ` · ${deck.duration} min` : "");
    $("drop").hidden = $("actions").hidden = true;
    $("ready").hidden = false;
    startStatus(p.notices.join(" "));
    $("present").focus();
  }

  /** Reads a deck from its files. On the start page it waits for Present. */
  async function openFiles(files: Iterable<File>, signal?: AbortSignal): Promise<void> {
    const now = presenter !== null;
    try {
      const got = await readFiles(files);
      if (signal?.aborted) return;
      if (got.pdf) {
        let [pdfpc, other] = deckFirst(got.pdfpcs, got.pdf.name);
        // A PDF brings the notes beside it, where the platform can look (the Mac app), as in pdfpc; a .pdfpc file
        // of another name given with it is then compared with them.
        if (!pdfpc || (!other && stem(pdfpc.name) !== stem(got.pdf.name))) {
          const text = await platform.notes?.(got.pdf.name);
          if (text) [pdfpc, other] = [{ name: `${stem(got.pdf.name)}.pdfpc`, text }, pdfpc];
        }
        if (signal?.aborted) return;
        startStatus(`Preparing ${got.pdf.name}…`);
        const prepared = { ...(await prepare({ pdf: got.pdf, pdfpc })), other };
        if (signal?.aborted) return await prepared.pdf.close();
        if (now) {
          await present(prepared);
          startStatus();
        } else showReady(prepared);
      } else if (got.pdfpcs.length && presenter) {
        const p = presenter;
        const [pdfpc, other] = deckFirst(got.pdfpcs, p.deck.name);
        const own = p.opened.source.pdfpc;
        // Another name than the deck's own .pdfpc file: compared with it, in place of any other. The same name, a new
        // export say, or a deck without one: its notes and timing, keeping the place, the clock and any comparison.
        if (own && !other && pdfpc.name !== own.name) return compare(pdfpc);
        if (other) readNotes(other);
        const prepared = await prepare({ pdf: p.opened.source.pdf, pdfpc }, "reject");
        if (presenter !== p) {
          await prepared.pdf.close();
          return;
        }
        const kept = p.comparing;
        const saved = p.talk.save(Date.now());
        await present(
          prepared,
          // Kept and tracked as the deck was: notes dropped on the demo don't make it the deck to resume.
          {
            saved: {
              ...saved,
              page: Math.min(saved.page, prepared.deck.pages.length - 1),
              endSlide: prepared.deck.endSlide !== p.deck.endSlide ? prepared.deck.endSlide : saved.endSlide,
            },
            keep: p.track,
            track: p.track,
          },
        );
        toast(`Loaded notes from ${pdfpc.name}.`);
        const again = other ?? kept;
        if (again) compare(again);
      } else if (got.pdfpcs.length && ready) {
        const staged = ready;
        const { prepared: previous, options } = staged;
        const [pdfpc, other] = deckFirst(got.pdfpcs, previous.source.pdf.name);
        const own = previous.source.pdfpc;
        if (own && !other && pdfpc.name !== own.name) {
          readNotes(pdfpc);
          showReady({ ...previous, other: pdfpc }, options);
        } else {
          if (other) readNotes(other);
          const prepared = await prepare({ pdf: previous.source.pdf, pdfpc }, "reject");
          if (ready === staged) showReady({ ...prepared, other }, options);
          else await prepared.pdf.close();
        }
      } else if (got.pdfpcs.length) {
        throw new Error("That's the .pdfpc file. Add the PDF too (you can select both at once).");
      }
    } catch (err) {
      if (signal?.aborted) return;
      const message = reasonOf(err);
      if (presenter) report(message);
      else startStatus(message, true);
    }
  }

  function openLocalFiles(files: File[]): void {
    cancelDeckLoad();
    void openFiles(files);
  }

  platform.updates?.(({ phase, version }) => {
    update.textContent = {
      downloading: `Update ${version} available. Downloading…`,
      installing: `Installing update ${version}…`,
      installed: `${version} is installed. Restart pdfpcnic to use it.`,
      failed: `Couldn’t update to ${version}. Use Check for Updates to try again.`,
    }[phase];
    update.dataset.phase = phase;
    update.hidden = false;
    dismissUpdateSoon();
  });
  $("version").textContent = __BUILD__ === "mac" ? `${__VERSION__} for Mac` : __VERSION__;
  const links = $("links");
  if (__BUILD__ === "mac") {
    const footer = links.parentElement;
    $("start-header").append(links);
    footer?.remove();
    $("forget").title = "Remove the saved deck from this Mac";
  } else {
    $("offline-note").innerHTML =
      __BUILD__ === "site"
        ? `<a href="./pdfpcnic.html" download>Download the offline copy</a> (one HTML file).`
        : "This is the offline copy: it needs no network.";
  }
  links.innerHTML =
    `<a class="source" href="https://github.com/youweizhuo/pdfpcnic" target="_blank" rel="noopener">${GITHUB_MARK}Source</a>` +
    (__BUILD__ === "site" ? ` · <a href="./licenses.txt" target="_blank">licenses</a>` : "");

  for (const [title, rows] of HELP) {
    const table = el("table");
    for (const [keys, what, highlight] of rows) {
      const row = el("tr", highlight ?? "");
      const description = el("td", "", what);
      if (keys === "v" || keys === ", / ?") {
        const link = el("button", "help-link", keys === "v" ? what : "settings");
        link.type = "button";
        link.dataset.action = keys === "v" ? "overview" : "settings";
        description.replaceChildren(link);
        if (keys !== "v") description.append(" / this help");
      }
      row.append(el("td", "", keys), description);
      table.append(row);
    }
    const section = el("section");
    section.append(el("h3", "", title), table);
    $("help-grid").append(section);
  }

  const input = $<HTMLInputElement>("files");
  input.addEventListener("change", () => {
    if (input.files?.length) openLocalFiles([...input.files]);
    input.value = "";
  });
  $("open-files").addEventListener("click", () => input.click());
  $("choose-other").addEventListener("click", () => input.click());
  $("present").addEventListener("click", () => {
    if (!ready) return;
    cancelDeckLoad();
    if (__BUILD__ !== "mac") openAudience();
    void present(ready.prepared, ready.options).catch((err) => startStatus(reasonOf(err), true));
    ready = null;
  });
  const demo = $("demo");
  const load = platform.demo;
  if (load) {
    demo.addEventListener("click", async () => {
      const opening = beginDeckLoad();
      if (__BUILD__ !== "mac") openAudience();
      startStatus("Loading the demo deck…");
      try {
        const { pdf, pdfpc } = await load();
        if (opening.signal.aborted) return;
        const prepared = await prepare({ pdf: { name: "demo.pdf", data: pdf }, pdfpc: { name: "demo.pdfpc", text: pdfpc } });
        const options = { keep: false, track: false };
        if (opening.signal.aborted) await prepared.pdf.close();
        else if (__BUILD__ === "mac") showReady(prepared, options);
        else await present(prepared, options);
      } catch (err) {
        if (!opening.signal.aborted) startStatus(reasonOf(err), true);
      } finally {
        endDeckLoad(opening);
      }
    });
  } else demo.remove();

  const drop = $("drop");
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (!e.dataTransfer?.types.includes("Files")) return;
    depth++;
    drop.classList.add("over");
  });
  window.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) drop.classList.remove("over");
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    drop.classList.remove("over");
    if (e.dataTransfer?.files.length) openLocalFiles([...e.dataTransfer.files]);
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

  platform.files?.(openLocalFiles);

  // Offer to pick up where an earlier visit left off (an accidental reload, say).
  const [deck, session] = await Promise.all([platform.store.loadDeck(), platform.store.loadSession()]);
  let midTalk = false;
  if (deck) {
    const resume = $<HTMLButtonElement>("resume");
    const recent = resumes(session, deck.pdfName, Date.now());
    midTalk = recent;
    resume.textContent = recent ? `Resume ${deck.pdfName} at page ${session.page + 1}` : `Reopen ${deck.pdfName}`;
    resume.hidden = false;
    resume.focus();
    const forget = $<HTMLButtonElement>("forget");
    forget.hidden = false;
    forget.addEventListener("click", () => {
      resume.remove();
      forget.remove();
      void platform.store.forget();
      toast(`Removed ${deck.pdfName} from ${__BUILD__ === "mac" ? "this Mac" : "this browser"}.`);
    });
    resume.addEventListener("click", () => {
      cancelDeckLoad();
      if (__BUILD__ !== "mac") openAudience();
      const source: Source = {
        pdf: { name: deck.pdfName, data: deck.pdf },
        pdfpc: deck.pdfpc && deck.pdfpcName ? { name: deck.pdfpcName, text: deck.pdfpc } : undefined,
      };
      void openSource(source, { saved: recent ? session : undefined, keep: false }).catch((err) => startStatus(reasonOf(err), true));
    });
  }

  // A deck server's own site reads the deck named in its address.
  if (progress && platform.fetchDeck) {
    progress.max = 1;
    progress.ariaLabel = "Deck download progress";
    progress.hidden = true;
    status.after(progress);
    const fetchDeck = platform.fetchDeck;
    const open = async (text: string) => {
      const token = deckToken(text);
      if (!token) {
        cancelDeckLoad();
        startStatus("That isn't a deck's link. It looks like example.com/#k3j9x2.", true);
        return;
      }
      const loading = beginDeckLoad();
      const { signal } = loading;
      progress.removeAttribute("value");
      progress.hidden = false;
      startStatus("Connecting to the deck server…");
      try {
        const files = await fetchDeck(token, ({ name, received, total }) => {
          if (signal.aborted) return;
          const knownTotal = total > 0 && received <= total;
          if (knownTotal) progress.value = received / total;
          else progress.removeAttribute("value");
          const amount = knownTotal ? ` (${Math.round(progress.value * 100)}%)` : received ? ` (${(received / 1_048_576).toFixed(1)} MB)` : "";
          startStatus(`Downloading ${name}${amount}…`);
        }, signal);
        if (signal.aborted) return;
        progress.hidden = true;
        // The token leaves the address, which may be on the wall.
        history.replaceState(null, "", location.pathname + location.search);
        await openFiles(files, signal);
      } catch (err) {
        if (!signal.aborted) startStatus(reasonOf(err), true);
      } finally {
        endDeckLoad(loading);
      }
    };

    // Load a linked deck unless a reload mid-talk has a deck and its clock to resume.
    const fromAddress = () => {
      if (!presenter && !midTalk && location.hash.length > 1) void open(location.hash);
    };
    window.addEventListener("hashchange", fromAddress);
    fromAddress();
  }
}
