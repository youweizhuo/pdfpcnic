/**
 * Calls `tick`, then again after the ms it returns. The beat comes from a
 * worker: a window the browser takes for hidden (on a Mac, the presenter while
 * the audience is fullscreen on the other screen, say) has its timers slowed
 * to once a second, then once a minute, but not its messages.
 */
export function ticker(tick: () => number): () => void {
  let stop = () => {};
  // Beats on even if a tick fails.
  const beat = (after: (ms: number) => void) => {
    let ms = 250;
    try {
      ms = tick();
    } finally {
      after(ms);
    }
  };
  // Without a worker, or if the browser turns it down later, plain timers.
  const fallback = () => {
    let id = 0;
    const run = () => beat((ms) => (id = window.setTimeout(run, ms)));
    run();
    stop = () => clearTimeout(id);
  };
  try {
    const src = "onmessage = (e) => setTimeout(() => postMessage(0), e.data);";
    const url =
      location.protocol === "file:"
        ? `data:text/javascript,${encodeURIComponent(src)}`
        : URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const loaded = () => url.startsWith("blob:") && URL.revokeObjectURL(url);
    const run = () => beat((ms) => worker.postMessage(ms));
    worker.onmessage = () => {
      loaded();
      worker.onmessage = run;
      run();
    };
    worker.onerror = () => {
      loaded();
      worker.terminate();
      fallback();
    };
    worker.postMessage(0);
    stop = () => worker.terminate();
  } catch {
    fallback();
  }
  return () => stop();
}
