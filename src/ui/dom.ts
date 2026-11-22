// Small helpers for the presenter page.

import type { InlineText } from "../core/guide.ts";

export const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** Turns structured inline text (strings, button names, and keys) into DOM nodes. */
export function renderInline(text: InlineText): Array<Node | string> {
  if (typeof text === "string") return [text];
  return text.map((part) =>
    typeof part === "string" ? part : "button" in part ? el("strong", "hint-button", part.button) : el("kbd", "", part.key),
  );
}

/** A button's label and key, redrawn only when they change (so a click in progress isn't lost). */
export function label(b: HTMLElement, text: string, key = ""): void {
  const now = `${text}\n${key}`;
  if (b.dataset.label === now) return;
  b.dataset.label = now;
  b.replaceChildren(text, ...(key ? [el("kbd", "", key)] : []));
}

/**
 * A button that takes turns at a few labels, as wide as the widest: all are in
 * it, in one place, and all but the one shown invisible, so a change of label
 * moves nothing beside it.
 */
export function steadyLabel(b: HTMLElement, labels: Array<[text: string, key: string]>, shown: number): void {
  const all = labels.map((l) => l.join("\n")).join("\n\n");
  if (b.dataset.steady !== all) {
    b.dataset.steady = all;
    b.classList.add("steady");
    b.replaceChildren(
      ...labels.map(([text, key]) => {
        const span = el("span");
        span.append(text, ...(key ? [el("kbd", "", key)] : []));
        return span;
      }),
    );
  }
  [...b.children].forEach((c, i) => c.classList.toggle("off", i !== shown));
}

export type ToastTone = "info" | "hint" | "warn";

let toastTimer = 0;
/** A note at the top that goes away on its own, out of the way of clicks. */
export function toast(message: InlineText, options: number | { ms?: number; tone?: ToastTone } = {}): void {
  const { ms = 4500, tone = "info" } = typeof options === "number" ? { ms: options } : options;
  const t = $("toast");
  t.className = tone === "info" ? "toast" : `toast ${tone}`;
  t.replaceChildren(...renderInline(message));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

export const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Something went wrong: it stays, above any note and selectable for copying, until closed. */
export function report(message: string, reason = ""): void {
  $("error-text").textContent = reason ? `${message}\nThe browser said: ${reason}` : message;
  $("error").hidden = false;
}

/** Reports an error from the platform: its message says what happened, its cause is the browser's own reason. */
export const reportError = (err: unknown) => report(reasonOf(err), err instanceof Error && err.cause ? reasonOf(err.cause) : "");

/** Calls back while `handle` is dragged with the pointer. */
export function draggable(
  handle: HTMLElement,
  signal: AbortSignal,
  on: { start?: (e: PointerEvent) => void; move: (e: PointerEvent) => void; end: () => void },
): void {
  let active: number | null = null;
  const finish = (e: PointerEvent) => {
    if (active !== e.pointerId) return;
    active = null;
    handle.classList.remove("dragging");
    on.end();
  };
  handle.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      active = e.pointerId;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer events in tests have no active pointer to capture.
      }
      handle.classList.add("dragging");
      on.start?.(e);
    },
    { signal },
  );
  handle.addEventListener("pointermove", (e) => active === e.pointerId && on.move(e), { signal });
  handle.addEventListener("lostpointercapture", finish, { signal });
  handle.addEventListener("pointercancel", finish, { signal });
  handle.addEventListener("pointerup", finish, { signal });
}

/** Turns wheel or touchpad scrolling into single steps. */
export function wheelStepper(step: (dir: 1 | -1) => void): (e: WheelEvent) => void {
  let sum = 0;
  let last = 0;
  return (e) => {
    sum += e.deltaY;
    const now = performance.now();
    if (Math.abs(sum) > 40 && now - last > 350) {
      step(sum > 0 ? 1 : -1);
      sum = 0;
      last = now;
    }
  };
}
