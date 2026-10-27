# How pdfpcnic is built

One presenter, wherever it runs. What a talk is and how it goes is written once; what differs between a browser and
a native app sits behind a few small interfaces, the ports.

```
src/
  core/         the talk: slides, keys, clock, pace, the audience's next step
                no DOM, no browser, no PDF engine
  ui/           the presenter page: draws the talk, turns keys and clicks into its actions
  platform.ts   the ports: what pdfpcnic needs from where it runs
  web/          the browser's side of each port, for the website and the offline file
  main.ts       puts the presenter page on the web platform
```

The arrows go one way: `ui/` uses `core/` and the ports, never `web/`. `web/` implements the ports. `main.ts` is the
only file that names a platform:

```ts
void start(web);
```

## The core

`src/core/` is plain TypeScript, with no browser in it. Its own type check runs without the DOM's types
(`src/core/tsconfig.json`), so a browser API used there fails the build, and Node runs it as it is for the tests.

- `pdfpc.ts` reads `.pdfpc` files.
- `deck.ts` puts the PDF's pages and the `.pdfpc` file together into slides, as pdfpc does. It gets each page's size,
  label, notes and links from the PDF engine, as plain data.
- `talk.ts` is the talk: where it stands (`TalkState`), what each key does to it (`act`), what the room sees
  (`audience`), and how it keeps to its plan (`progress`). It saves and resumes itself.
- `guide.ts` says what the yellow button and the line under the slides tell the presenter, from what the platform
  reports about the audience window.
- `pace.ts`, `timer.ts` and `keys.ts` hold the timing lines, the clock and pdfpc's keys.

## The ports

`src/platform.ts` lists everything pdfpcnic needs from where it runs.

| Port | What it does | In the browser (`src/web/`) | In a native Mac app |
| --- | --- | --- | --- |
| `openPdf` → `Pdf` | reads each page's size, label, notes and links; draws a page as a picture | pdf.js (`pdfjs.ts`) | PDFKit, drawing with Quartz as Preview does |
| `audience` → `Audience` | the room's window: opens it, makes it fullscreen on the projector, shows a slide | a popup this page draws into (`audience.ts`), within each browser's limits | a frameless window on the chosen screen, drawn by PDFKit |
| `window` → `PresenterWindow` | the presenter's own fullscreen; whether there's a second screen | the Fullscreen API (`window.ts`) | both windows fullscreen at once, as in Présentation.app |
| `store` → `Store` | the last deck, where its talk stood, the settings | IndexedDB and localStorage (`store.ts`) | can stay the same: the app's web view has both |
| `demo` | the demo deck | fetched on the site, left out of the offline file | carried in the app |

Each port says what, never how. The audience's status, for one, is a mode (closed, window, fullscreen), the screen's
name, and whether the presenter can make it fullscreen (`remote`). The guide words its advice from that alone. In
Chrome, `remote` is true and the button offers `Shift+W`. In Firefox it's false, and the button says to double-click
the audience window. A native app, which can always place its windows, never needs that step.

## The presenter page

`src/ui/` is the page: plain DOM, the same in any browser engine.

- `presenter.ts` draws the talk and runs the input. A key goes `onKey` → `act`. The talk's own actions go to
  `Talk.act`, the view's (overview, settings, windows) stay here, and then `render` draws the result.
- `slide-view.ts` shows one slide in a box, with its links and the laser. `page-cache.ts` keeps the pictures the
  platform draws, and draws the next ones ahead.
- `settings.ts` holds the sizes and pace levels, with their dialog and drag handles.
- `start.ts` is the start page: files, the demo, resume. It hands each deck to a fresh `Presenter`.

## Adding a platform

Implement `Platform` in `src/<name>/platform.ts` and call `start()` with it. For the Mac, the plan is a Swift app
whose presenter window shows this page in a web view. Swift answers the ports over a message bridge, draws pages with
PDFKit, and owns both windows.

## Checks

```sh
npm test             # the core, in Node
npm run typecheck    # the whole app, and the core again without the DOM
npm run e2e          # the app in a real browser (see CONTRIBUTING.md)
```
