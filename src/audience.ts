import css from "./audience.css?inline";
import type { Deck } from "./deck";
import type { PageCache } from "./render";
import { SlideView, type FollowLink, type Point } from "./view";

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

const NAME = "pdfpcnic-audience";
const FULLSCREEN_MESSAGE = "pdfpcnic:fullscreen";

export interface AudienceEvents {
  key(e: KeyboardEvent): void;
  step(delta: 1 | -1): void;
  pointer(at: Point | null): void;
  /** A link on the slide was clicked. */
  follow: FollowLink;
  change(): void;
  /** The browser refused fullscreen asked for from the presenter window. */
  refused(): void;
}

/**
 * The audience window: an empty popup this window draws into. One script
 * drives both windows, so nothing has to be synced or stored, and it works
 * from file:// too.
 */
export class Audience {
  private win: Window | null = null;
  private view: SlideView | null = null;
  private deck: Deck | null = null;
  private cache: PageCache | null = null;
  private black: HTMLElement | null = null;
  private poll = 0;

  constructor(private events: AudienceEvents) {}

  /** Switches to another deck, keeping the window if it is open. */
  bind(deck: Deck, cache: PageCache): void {
    this.deck = deck;
    this.cache = cache;
    if (this.open) this.mount();
  }

  get open(): boolean {
    return !!this.win && !this.win.closed;
  }

  get fullscreen(): boolean {
    return this.open && !!this.win!.document.fullscreenElement;
  }

  get pixelWidth(): number {
    return this.open ? (this.view?.pixelWidth ?? 0) : 0;
  }

  /** The screen the window is fullscreen on, or goes to at Shift+W, when the browser lists screens. */
  get screen(): string | null {
    if (!this.open) return null;
    const s = this.fullscreen ? screenOf(this.win!) : destination(this.win!);
    return s ? nameOf(s) : null;
  }

  /**
   * Opens (or re-attaches to) the audience window, on this screen. Call from a
   * click or key press: browsers only allow popups from user input.
   */
  show(): boolean {
    if (!this.deck) return false;
    if (this.open) {
      this.win!.focus();
      return true;
    }
    const { left, top, width, height } = centered();
    const features = `popup,left=${left},top=${top},width=${width},height=${height}`;
    let win = window.open("", NAME, features);
    if (!win) return false;
    try {
      this.attach(win);
    } catch {
      // The offline file gets a new origin each time it loads, so the window it
      // opened before a reload is out of reach. Replace it.
      win.close();
      win = window.open("", `${NAME}-${Date.now()}`, features);
      if (!win) return false;
      this.attach(win);
    }
    // Chrome asks once to manage windows; Shift+W then knows the other screens.
    void loadScreens().then(() => this.events.change());
    this.events.change();
    return true;
  }

  /** Fullscreen on or off. Call from user input in either window. */
  toggleFullscreen(): void {
    if (!this.open) return;
    if (this.win!.document.fullscreenElement) void this.win!.document.exitFullscreen();
    else this.goFullscreen();
  }

  close(): void {
    this.win?.close();
    this.detach();
  }

  render(page: number, black: boolean, laser: Point | null, laserSize: number): void {
    if (!this.open || !this.view) return;
    this.view.show(page);
    this.view.setLaser(laser, laserSize);
    this.black!.hidden = !black;
  }

  dispose(): void {
    clearInterval(this.poll);
    this.view?.dispose();
  }

  private fullscreenOptions(): FullscreenOptions {
    const to = this.open ? destination(this.win!) : null;
    return to ? { screen: to } : {};
  }

  private goFullscreen(): void {
    const win = this.win!;
    // A key pressed (or a click) in the audience window itself: go fullscreen there.
    if (win.navigator.userActivation?.isActive) {
      win.document.documentElement.requestFullscreen(this.fullscreenOptions()).catch(() => this.events.refused());
      return;
    }
    // Otherwise the presenter window holds the user's input; capability
    // delegation (Chromium) lends it to the audience window.
    try {
      win.postMessage(FULLSCREEN_MESSAGE, { targetOrigin: "/", delegate: "fullscreen" } as WindowPostMessageOptions);
    } catch {
      this.events.refused();
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
    this.mount();
    this.black = doc.getElementById("black")!;
    const hint = doc.getElementById("hint")!;

    win.addEventListener("keydown", (e) => this.events.key(e));
    win.addEventListener("message", (e) => {
      if (e.data === FULLSCREEN_MESSAGE && !doc.fullscreenElement) {
        doc.documentElement.requestFullscreen(this.fullscreenOptions()).catch(() => this.events.refused());
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
      hint.hidden = !!doc.fullscreenElement;
      this.events.change();
    });
    doc.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.events.step(-1);
    });
    let idle = 0;
    doc.addEventListener("pointermove", (e) => {
      doc.body.classList.remove("idle");
      clearTimeout(idle);
      idle = win.setTimeout(() => doc.body.classList.add("idle"), 2000);
      this.events.pointer(this.view?.toPage(e.clientX, e.clientY) ?? null);
    });
    doc.addEventListener("pointerleave", () => this.events.pointer(null));
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
    this.events.change();
  }
}

function centered() {
  const width = Math.round(screen.availWidth * 0.6);
  const height = Math.round((width * 9) / 16);
  const left = Math.round((screen.availLeft ?? 0) + (screen.availWidth - width) / 2);
  const top = Math.round((screen.availTop ?? 0) + (screen.availHeight - height) / 2);
  return { left, top, width, height };
}
