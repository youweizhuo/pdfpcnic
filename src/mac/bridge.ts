// The bridge to the Mac app's native side (mac/Sources/). Calls go out through
// WebKit's message handler and come back as promises; the app's events come in
// through window.pdfpcnicMac.emit.

declare global {
  interface Window {
    webkit?: { messageHandlers: { pdfpcnic: { postMessage(message: unknown): Promise<unknown> } } };
    pdfpcnicMac?: { emit(name: string, data: unknown): void };
  }
}

/** Asks the app to do something, and resolves with its answer. */
export function call<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  return window.webkit!.messageHandlers.pdfpcnic.postMessage({ op, ...args }) as Promise<T>;
}

const listeners = new Map<string, Set<(data: never) => void>>();

/** Listens to one of the app's events. */
export function on<T>(name: string, cb: (data: T) => void, signal?: AbortSignal): void {
  const set = listeners.get(name) ?? new Set();
  listeners.set(name, set);
  set.add(cb);
  signal?.addEventListener("abort", () => set.delete(cb));
}

window.pdfpcnicMac = { emit: (name, data) => listeners.get(name)?.forEach((cb) => cb(data as never)) };

/** Bytes as base64: the message handler carries only what JSON can. */
export function base64(data: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([data]));
  });
}
