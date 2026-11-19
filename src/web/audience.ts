import type { Deck } from "../core/deck.ts";
import type { AudienceStatus } from "../core/guide.ts";
import type { Audience, AudienceEvents, AudienceFrame, Pdf } from "../platform.ts";
import type { PageCache } from "../ui/page-cache.ts";
import { SlideView } from "../ui/slide-view.ts";
import css from "./audience.css?inline";
import { holdWakeLock, lockEscape } from "./window.ts";

// Window Management API (Chromium); absent elsewhere, which is fine.
interface ScreenDetailed extends Screen {
  availLeft: number;
  availTop: number;
  isInternal: boolean;
  isPrimary: boolean;
  label: string;
}
interface ScreenDetails extends EventTarget {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}
declare global {
  interface Window {
    getScreenDetails?: () => Promise<ScreenDetails>;
  }
  interface Screen {
    isExtended?: boolean;
    availLeft?: number;
    availTop?: number;
  }
  interface FullscreenOptions {
    screen?: ScreenDetailed;
  }
}

/** The screens, kept current by the browser, once it lists them. */
let screens: ScreenDetails | null = null;

/** Asks for the screens; Chromium asks the user once. */
async function loadScreens(): Promise<void> {
  if (screens || !window.getScreenDetails) return;
  try {
    screens = await window.getScreenDetails();
  } catch {
    // Not allowed: the audience goes fullscreen wherever it is.
  }
}

/** One screen, or two listed for one (mirrored). */
const same = (a: Screen, b: Screen) => a.availLeft === b.availLeft && a.availTop === b.availTop;

/** The listed screen a window is on. */
function screenOf(win: Window): ScreenDetailed | undefined {
  return screens?.screens.find((s) => same(s, win.screen));
}

/**
 * Where the audience goes fullscreen. Moved off the presenter's screen, it
 * stays where it was put; otherwise it takes another screen, an external one
 * over the laptop's own, then one that isn't the main screen. Not by size: a
 * 1280×800 projector can count as smaller than a laptop with display scaling.
 * With one screen, there.
 */
function destination(win: Window): ScreenDetailed | null {
  if (!screens) return null;
  const here = screens.currentScreen;
  const at = screenOf(win);
  if (at && !same(at, here)) return at;
  const rank = (s: ScreenDetailed) => (s.isInternal ? 0 : 2) + (s.isPrimary ? 0 : 1);
  const others = screens.screens.filter((s) => !same(s, here));
  return others.reduce<ScreenDetailed | null>((best, s) => (!best || rank(s) > rank(best) ? s : best), null) ?? at ?? null;
}

function nameOf(s: ScreenDetailed): string {
  return s.label || (screens && same(s, screens.currentScreen) ? "this screen" : "the other screen");
}

/**
 * Whether a key press in the presenter can make the audience fullscreen:
 * capability delegation (Chrome, Edge). Told by whether postMessage reads its
 * `delegate` option; the throw right after means nothing is sent.
 */
const delegates = (() => {
  let read = false;
  try {
    window.postMessage(null, {
      get delegate() {
        read = true;
        return undefined;
      },
      get targetOrigin(): string {
        throw 0;
      },
    } as WindowPostMessageOptions);
  } catch {
    // The throw above.
  }
  return read;
})();

const NAME = "pdfpcnic-audience";
const FULLSCREEN_MESSAGE = "pdfpcnic:fullscreen";

/**
 * The audience window: an empty popup this window draws into. One script
 * drives both windows, so nothing has to be synced or stored, and it works
 * from file:// too.
 */
export class PopupAudience implements Audience {
  private win: Window | null = null;
  private view: SlideView | null = null;
  private deck: Deck | null = null;
  private cache: PageCache | null = null;
  private black: HTMLElement | null = null;
  private poll = 0;
  /** Fullscreen asked for from the presenter and refused, until the audience goes fullscreen. */
  private refused = false;
  private forSharing = false;
  private freshOpen = false;
  private refuse = () => {
    this.refused = true;
    this.events.change();
  };

  constructor(private events: AudienceEvents) {}

  /** Switches to another deck, keeping the window if it is open. */
  bind(deck: Deck, _pdf: Pdf, cache: PageCache, frame: AudienceFrame): void {
    this.deck = deck;
    this.cache = cache;
    if (this.isOpen) {
      this.mount();
      if (!this.win!.document.fullscreenElement) {
        if (this.forSharing) this.fitForSharing();
        else if (this.freshOpen) {
          this.freshOpen = false;
          const { left, top, width, height } = centered(this.win!.screen, this.aspect(), this.win!);
          this.win!.moveTo(left, top);
          this.win!.resizeTo(width, height);
        }
      } else {
        this.freshOpen = false;
      }
    }
    this.render(frame);
  }

  private get isOpen(): boolean {
    return !!this.win && !this.win.closed;
  }

  get status(): AudienceStatus {
    const win = this.isOpen ? this.win! : null;
    const fullscreen = !!win?.document.fullscreenElement;
    // The screen it is fullscreen on, or goes to at Shift+W, when the browser lists screens.
    const screen = win && (fullscreen ? screenOf(win) : destination(win));
    return {
      mode: !win ? "closed" : fullscreen ? "fullscreen" : "window",
      screen: screen ? nameOf(screen) : null,
      // Shift+W in the presenter makes the audience fullscreen (Chrome, Edge); elsewhere only the audience window can.
      remote: delegates,
      refused: this.refused,
      forSharing: !!win && !fullscreen && this.forSharing,
    };
  }

  get pixelWidth(): number {
    return this.isOpen ? (this.view?.pixelWidth ?? 0) : 0;
  }

  /**
   * Opens (or re-attaches to) the audience window, on this screen. Call from a
   * click or key press: browsers only allow popups from user input. A browser
   * puts a new window in front, `behind` or not.
   */
  open(behind = false): void {
    if (this.isOpen) {
      // Chromium can leave fullscreen when focus() is called on this popup again.
      // A prepared projector is already showing the audience; keep its fullscreen intact.
      if (!behind && !this.win!.document.fullscreenElement) this.win!.focus();
      return;
    }
    const { left, top, width, height } = centered(screen, this.aspect());
    const features = `popup,left=${left},top=${top},width=${width},height=${height}`;
    const blocked = () => new Error("The browser blocked the audience window. Allow pop-ups for this page, then press o again.");
    let win = window.open("", NAME, features);
    if (!win) throw blocked();
    this.freshOpen = !this.deck;
    try {
      this.attach(win);
    } catch {
      // The offline file gets a new origin each time it loads, so the window it
      // opened before a reload is out of reach. Replace it.
      win.close();
      win = window.open("", `${NAME}-${Date.now()}`, features);
      if (!win) throw blocked();
      this.attach(win);
    }
    // Chrome asks once to manage windows; Shift+W then knows the other screens.
    void loadScreens().then(() => this.events.change());
    this.events.change();
  }

  /** Fullscreen on or off. Call from user input in either window. */
  toggleFullscreen(): void {
    if (!this.isOpen) return;
    if (this.win!.document.fullscreenElement) void this.win!.document.exitFullscreen();
    else this.goFullscreen();
  }

  /** A large ordinary window fitted to the slide's proportions stays on the desktop when the presenter covers it. */
  async prepareSharing(): Promise<void> {
    // Open before awaiting anything: a new popup needs the original user gesture.
    this.open();
    const win = this.win!;
    if (win.document.fullscreenElement) await win.document.exitFullscreen();
    if (win.closed || this.win !== win) return;
    this.freshOpen = false;
    // Resize the existing popup: replacing it would break an active window share.
    // Browsers may ignore these calls; the presenter also explains the manual option.
    this.fitForSharing();
    // Leaving fullscreen can restore the window's titlebar only after the first resize; refine once if needed.
    if (Math.abs(win.innerWidth / Math.max(1, win.innerHeight) - this.aspect(this.view?.current ?? 0)) > 0.02) {
      this.fitForSharing();
    }
    this.forSharing = true;
    this.refused = false;
    win.document.getElementById("hint")!.hidden = true;
    this.events.change();
  }

  private aspect(page = 0): number {
    const p = this.deck?.pages[page] ?? this.deck?.pages[0];
    return p && p.width > 0 && p.height > 0 ? p.width / p.height : 16 / 9;
  }

  private fitForSharing(): void {
    const win = this.win;
    if (!win || win.closed) return;
    const s = win.screen;
    const chromeW = Math.max(0, win.outerWidth - win.innerWidth);
    const chromeH = Math.max(0, win.outerHeight - win.innerHeight);
    const maxW = Math.max(1, s.availWidth - chromeW);
    const maxH = Math.max(1, s.availHeight - chromeH);
    const ratio = this.aspect(this.view?.current ?? 0);
    const wider = maxW / maxH >= ratio;
    const innerW = wider ? Math.round(maxH * ratio) : maxW;
    const innerH = wider ? maxH : Math.round(maxW / ratio);
    const width = Math.min(s.availWidth, innerW + chromeW);
    const height = Math.min(s.availHeight, innerH + chromeH);
    const left = Math.round((s.availLeft ?? 0) + (s.availWidth - width) / 2);
    const top = Math.round((s.availTop ?? 0) + (s.availHeight - height) / 2);
    win.moveTo(left, top);
    win.resizeTo(width, height);
  }

  render({ page, black, laser, laserSize }: AudienceFrame): void {
    if (!this.isOpen || !this.view) return;
    this.black!.hidden = !black;
    this.view.show(page);
    this.view.setLaser(laser, laserSize);
  }

  private fullscreenOptions(): FullscreenOptions {
    const to = this.isOpen ? destination(this.win!) : null;
    return to ? { screen: to } : {};
  }

  private goFullscreen(): void {
    const win = this.win!;
    // A key pressed (or a click) in the audience window itself: go fullscreen there.
    if (win.navigator.userActivation?.isActive) {
      win.document.documentElement.requestFullscreen(this.fullscreenOptions()).catch(this.refuse);
      return;
    }
    // Otherwise the presenter window holds the user's input; capability
    // delegation (Chromium) lends it to the audience window.
    if (!delegates) return this.refuse();
    try {
      win.postMessage(FULLSCREEN_MESSAGE, { targetOrigin: "/", delegate: "fullscreen" } as WindowPostMessageOptions);
    } catch {
      this.refuse();
    }
  }

  private attach(win: Window): void {
    this.win = win;
    const doc = win.document;
    doc.open();
    doc.write(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title></title><style>${css}</style></head>` +
        `<body><main id="stage"></main><div id="black" hidden></div>` +
        `<p id="hint">Double-click for fullscreen</p></body></html>`,
    );
    doc.close();
    // Opened in a click before the deck is read, it shows it once bound.
    if (this.deck) this.mount();
    this.black = doc.getElementById("black")!;
    const hint = doc.getElementById("hint")!;

    // Closed (or reloaded, which loses what this window drew): forget it now,
    // not at the next poll, so the presenter offers to open it again.
    // It may be all that shows, with the presenter's window hidden, and where the keys go once it's been double-clicked.
    holdWakeLock(win);
    win.addEventListener("pagehide", () => this.detach());
    win.addEventListener("keydown", (e) => this.events.key(e));
    // Esc goes on to the presenter too, rather than ending the room's fullscreen.
    lockEscape(win);
    win.addEventListener("message", (e) => {
      if (e.data === FULLSCREEN_MESSAGE && !doc.fullscreenElement) {
        doc.documentElement.requestFullscreen(this.fullscreenOptions()).catch(this.refuse);
      }
    });
    // A click steps forward, unless it turns out to be a double-click (fullscreen).
    let click = 0;
    doc.addEventListener("click", () => {
      clearTimeout(click);
      click = win.setTimeout(() => this.events.step(1), 250);
    });
    doc.addEventListener("dblclick", () => {
      clearTimeout(click);
      if (doc.fullscreenElement) void doc.exitFullscreen();
      else doc.documentElement.requestFullscreen().catch(() => {});
    });
    doc.addEventListener("fullscreenchange", () => {
      hint.hidden = !!doc.fullscreenElement || this.forSharing;
      if (doc.fullscreenElement) {
        this.refused = false;
        this.forSharing = false;
      }
      this.events.change();
    });
    // Out of fullscreen, Chrome puts the window back where it opened, often
    // behind the presenter: it stays on the screen it was fullscreen on instead.
    let was: ScreenDetailed | undefined;
    win.addEventListener("resize", () => {
      if (doc.fullscreenElement) was = screenOf(win);
      else if (was) {
        const s = was;
        if (!same(win.screen, s)) win.moveTo(s.availLeft + (s.availWidth - win.outerWidth) / 2, s.availTop + (s.availHeight - win.outerHeight) / 2);
        was = undefined;
      }
    });
    doc.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.events.step(-1);
    });
    win.setTimeout(() => (hint.hidden = true), 6000);

    clearInterval(this.poll);
    this.poll = window.setInterval(() => {
      if (win.closed) this.detach();
    }, 500);
  }

  private mount(): void {
    const doc = this.win!.document;
    this.view?.dispose();
    doc.title = `${this.deck!.name} · audience`;
    this.view = new SlideView(doc.getElementById("stage")!, this.deck!, this.cache!, 0, { follow: (to) => this.events.follow(to) });
    this.view.start();
  }

  private detach(): void {
    clearInterval(this.poll);
    this.view?.dispose();
    this.view = null;
    this.win = null;
    this.refused = false;
    this.forSharing = false;
    this.freshOpen = false;
    this.events.change();
  }
}

function centered(s: Screen = screen, aspect = 16 / 9, existing?: Window) {
  const chromeW = existing ? Math.max(0, existing.outerWidth - existing.innerWidth) : 0;
  const chromeH = existing ? Math.max(0, existing.outerHeight - existing.innerHeight) : 0;
  const maxW = s.availWidth * 0.6;
  const maxH = Math.max(1, s.availHeight * 0.75 - chromeH);
  const innerW = Math.round(Math.min(maxW, maxH * aspect));
  const innerH = Math.round(innerW / aspect);
  const width = innerW + chromeW;
  const height = innerH + chromeH;
  const left = Math.round((s.availLeft ?? 0) + (s.availWidth - width) / 2);
  const top = Math.round((s.availTop ?? 0) + (s.availHeight - height) / 2);
  return { left, top, width, height };
}
