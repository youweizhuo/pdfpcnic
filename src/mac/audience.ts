// The audience's window in the Mac app: native and frameless, it draws the
// slide itself with Quartz, and goes fullscreen on the projector when asked.

import type { Deck, LinkTarget } from "../core/deck.ts";
import type { AudienceStatus } from "../core/guide.ts";
import type { KeyPress } from "../core/keys.ts";
import type { Point } from "../core/talk.ts";
import type { Audience, AudienceEvents, Pdf } from "../platform.ts";
import { call, on } from "./bridge.ts";
import type { MacPdf } from "./pdf.ts";

export class MacAudience implements Audience {
  status: AudienceStatus = { mode: "closed", screen: null, remote: true, refused: false };
  /** It draws its own slides. */
  readonly pixelWidth = 0;
  /** What it was last told to show, so a laser that hasn't moved isn't sent again. */
  private shown = "";

  constructor(events: AudienceEvents) {
    on<AudienceStatus>("audience", (status) => {
      this.status = status;
      events.change();
    });
    on<KeyPress>("audienceKey", (key) => events.key(new KeyboardEvent("keydown", key)));
    on<1 | -1>("audienceStep", (delta) => events.step(delta));
    on<Point | null>("audiencePointer", (at) => events.pointer(at));
    on<LinkTarget>("audienceFollow", (to) => events.follow(to));
  }

  bind(_deck: Deck, pdf: Pdf): void {
    this.shown = "";
    void call("audienceShow", { doc: (pdf as MacPdf).id });
  }

  open(): void {
    void call("audienceOpen");
  }

  toggleFullscreen(): void {
    void call("audienceFullscreen");
  }

  render(page: number, black: boolean, laser: Point | null, laserSize: number): void {
    const view = { page, black, laser, laserSize };
    const key = JSON.stringify(view);
    if (key === this.shown) return;
    this.shown = key;
    void call("audienceRender", view);
  }
}
