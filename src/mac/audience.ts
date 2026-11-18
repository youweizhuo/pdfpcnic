// The audience's window in the Mac app: native and frameless, it draws the
// slide itself with Quartz, and goes fullscreen on the projector when asked.

import type { Deck, LinkTarget } from "../core/deck.ts";
import type { AudienceStatus } from "../core/guide.ts";
import type { KeyPress } from "../core/keys.ts";
import type { Audience, AudienceEvents, AudienceFrame, Pdf } from "../platform.ts";
import type { PageCache } from "../ui/page-cache.ts";
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
    on<LinkTarget>("audienceFollow", (to) => events.follow(to));
  }

  bind(_deck: Deck, pdf: Pdf, _pages: PageCache, frame: AudienceFrame): void {
    this.shown = JSON.stringify(frame);
    void call("audienceRender", { ...frame, doc: (pdf as MacPdf).id });
  }

  open(behind = false): void {
    void call("audienceOpen", { behind });
  }

  toggleFullscreen(): void {
    void call("audienceFullscreen");
  }

  async prepareSharing(): Promise<void> {
    await call("audiencePrepareSharing");
  }

  render(frame: AudienceFrame): void {
    const key = JSON.stringify(frame);
    if (key === this.shown) return;
    this.shown = key;
    void call("audienceRender", { ...frame });
  }
}
