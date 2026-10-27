// Small helpers for the presenter page.

export const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** A button's label and key, redrawn only when they change (so a click in progress isn't lost). */
export function label(b: HTMLElement, text: string, key = ""): void {
  const now = `${text}\n${key}`;
  if (b.dataset.label === now) return;
  b.dataset.label = now;
  b.replaceChildren(text, ...(key ? [el("kbd", "", key)] : []));
}

let toastTimer = 0;
/** A note at the bottom that goes away on its own, out of the way of clicks. */
export function toast(message: string, ms = 4500): void {
  const t = $("toast");
  t.textContent = message;
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
  handle.addEventListener(
    "pointerdown",
    (e) => {
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      on.start?.(e);
    },
    { signal },
  );
  handle.addEventListener("pointermove", (e) => handle.hasPointerCapture(e.pointerId) && on.move(e), { signal });
  handle.addEventListener(
    "pointerup",
    () => {
      handle.classList.remove("dragging");
      on.end();
    },
    { signal },
  );
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
