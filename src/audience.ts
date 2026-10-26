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
  }
}

export type PlacementSupport = "granted" | "prompt" | "denied" | "unsupported";

export async function placementSupport(): Promise<PlacementSupport> {
  if (typeof window.getScreenDetails !== "function") return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: "window-management" as PermissionName });
    return status.state;
  } catch {
    return "prompt";
  }
}

/** A screen other than this window's, preferring an external one, or null. */
async function projector(): Promise<ScreenDetailed | null> {
  if (!window.getScreenDetails) return null;
  try {
    const details = await window.getScreenDetails();
    const here = details.currentScreen;
    const others = details.screens.filter(
      (s) => s !== here && (s.availLeft !== here.availLeft || s.availTop !== here.availTop),
    );
    return others.find((s) => !s.isInternal) ?? others[0] ?? null;
  } catch {
    return null;
  }
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
  /** Label of the screen the window was placed on, when the browser said. */
  screen: string | null = null;
  private fullscreenDue = false;

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

  /**
   * Opens (or re-attaches to) the audience window. Call from a click or key
   * press: browsers only allow popups, and fullscreen, from user input.
   */
  async show(): Promise<boolean> {
    if (!this.deck) return false;
    if (this.open) {
      this.win!.focus();
      return true;
    }
    const support = await placementSupport();
    const target = support === "granted" ? await projector() : null;
    const rect = target
      ? { left: target.availLeft, top: target.availTop, width: target.availWidth, height: target.availHeight }
      : centered();
    const features = `popup,left=${rect.left},top=${rect.top},width=${rect.width},height=${rect.height}`;
    let win = window.open("", NAME, target ? `${features},fullscreen` : features);
    if (!win) return false;
    try {
      this.attach(win);
    } catch {
      // The offline file gets a new origin each time it loads, so the window it
      // opened before a reload is out of reach. Replace it.
      win.close();
      win = window.open("", `${NAME}-${Date.now()}`, target ? `${features},fullscreen` : features);
      if (!win) return false;
      this.attach(win);
    }
    if (target) {
      this.screen = target.label || "second screen";
      // Browsers may size a new popup to fit the presenter's screen; fit the projector instead.
      win.resizeTo(target.availWidth, target.availHeight);
      // Opening the window used up this key press, so fullscreen waits for the next one.
      this.fullscreenDue = true;
    } else if (support === "prompt") {
      // Ask for window placement now; move the window once allowed.
      void projector().then((s) => {
        if (!s || win.closed) return;
        win.moveTo(s.availLeft, s.availTop);
        win.resizeTo(s.availWidth, s.availHeight);
        this.screen = s.label || "second screen";
        this.fullscreenDue = true;
        this.events.change();
      });
    }
    this.events.change();
    return true;
  }

  /** True while the window waits on another screen for the presenter's next key press. */
  get awaitingFullscreen(): boolean {
    return this.fullscreenDue && this.open && !this.fullscreen;
  }

  /**
   * Makes a window just placed on the projector fullscreen. Call on any key
   * press or click in the presenter window.
   */
  claimFullscreen(): void {
    if (!this.fullscreenDue) return;
    this.fullscreenDue = false;
    if (this.open && !this.fullscreen) this.goFullscreen();
  }

  /** Fullscreen on or off. Call from user input in the presenter window. */
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

  private goFullscreen(): void {
    const win = this.win!;
    // A key pressed (or a click) in the audience window itself: go fullscreen there.
    if (win.navigator.userActivation?.isActive) {
      win.document.documentElement.requestFullscreen().catch(() => this.events.refused());
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

    win.addEventListener("keydown", (e) => {
      // A window just placed on the projector goes fullscreen at the first key, here too.
      this.claimFullscreen();
      this.events.key(e);
    });
    win.addEventListener("message", (e) => {
      if (e.data === FULLSCREEN_MESSAGE && !doc.fullscreenElement) {
        doc.documentElement.requestFullscreen().catch(() => this.events.refused());
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
    this.fullscreenDue = false;
    this.view?.dispose();
    this.view = null;
    this.win = null;
    this.screen = null;
    this.events.change();
  }
}

function centered() {
  const width = Math.round(screen.availWidth * 0.6);
  const height = Math.round((width * 9) / 16);
  const left = Math.round(((screen as Screen & { availLeft?: number }).availLeft ?? 0) + (screen.availWidth - width) / 2);
  const top = Math.round(((screen as Screen & { availTop?: number }).availTop ?? 0) + (screen.availHeight - height) / 2);
  return { left, top, width, height };
}
