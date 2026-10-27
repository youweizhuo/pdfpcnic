# How pdfpcnic is built

One presenter, wherever it runs. What a talk is and how it goes is written once; what differs between a browser and
the Mac app sits behind a few small interfaces, the ports.

```
src/
  core/         the talk: slides, keys, clock, pace, the audience's next step
                no DOM, no browser, no PDF engine
  ui/           the presenter page: draws the talk, turns keys and clicks into its actions
  platform.ts   the ports: what pdfpcnic needs from where it runs
  web/          the browser's side of each port, for the website and the offline file
  mac/          the Mac app's side of each port, in the page; it talks to the app's native half
  main.ts       puts the presenter page on the web platform (mac/main.ts: on the Mac's)
mac/            the Mac app's native half, in Swift: windows, PDFKit, updates
```

The arrows go one way: `ui/` uses `core/` and the ports, never a platform. `web/` and `mac/` implement the ports. The
entry points are the only files that name a platform:

```ts
void start(web); // src/main.ts
void start(mac); // src/mac/main.ts
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

| Port | What it does | In the browser (`src/web/`) | In the Mac app (`src/mac/`, `mac/Sources/`) |
| --- | --- | --- | --- |
| `openPdf` → `Pdf` | reads each page's size, label, notes and links; draws a page as a picture | pdf.js (`pdfjs.ts`) | PDFKit reads, Quartz draws, as Preview does (`pdf.ts`, `Documents.swift`) |
| `audience` → `Audience` | the room's window: opens it, makes it fullscreen on the projector, shows a slide | a popup this page draws into (`audience.ts`), within each browser's limits | a frameless window that draws the slide itself, fullscreen on the chosen screen (`audience.ts`, `Audience.swift`, `SlideView.swift`) |
| `window` → `PresenterWindow` | the presenter's own fullscreen; whether there's a second screen | the Fullscreen API (`window.ts`) | the window's view takes the screen, as in Présentation.app (`window.ts`, `Presenter.swift`) |
| `store` → `Store` | the last deck, where its talk stood, the settings | IndexedDB and localStorage (`store.ts`) | the same: the app's web view keeps both |
| `demo` | the demo deck | fetched on the site, left out of the offline file | carried in the page |
| `files` | files the platform opens itself | none | from the Finder or File › Open (`App.swift`) |

Each port says what, never how. The audience's status, for one, is a mode (closed, window, fullscreen), the screen's
name, and whether the presenter can make it fullscreen (`remote`). The guide words its advice from that alone. In
Chrome, `remote` is true and the button offers `Shift+W`. In Firefox it's false, and the button says to double-click
the audience window. The Mac app can always place its windows, so it never needs that step.

## The presenter page

`src/ui/` is the page: plain DOM, the same in any browser engine.

- `presenter.ts` draws the talk and runs the input. A key goes `onKey` → `act`. The talk's own actions go to
  `Talk.act`, the view's (overview, settings, windows) stay here, and then `render` draws the result.
- `slide-view.ts` shows one slide in a box, with its links and the laser. `page-cache.ts` keeps the pictures the
  platform draws, and draws the next ones ahead.
- `settings.ts` holds the sizes and pace levels, with their dialog and drag handles.
- `start.ts` is the start page: files, the demo, resume. It hands each deck to a fresh `Presenter`.

## The Mac app

The presenter window shows the page (built with `vite build --mode mac`: one file, no pdf.js) in a web view. The page
calls the app over a bridge, `src/mac/bridge.ts` → `mac/Sources/Bridge.swift`, and `App.swift` wires each call to the
part that answers it. Bytes go the other way through the page's own address, `pdfpcnic://app/`
(`PageScheme.swift`): pictures of pages as raw pixels, and the files opened from the Finder.

**The app updates itself whole** (`Updates.swift`). A few seconds after launch, it reads the latest release's version
from where GitHub sends `releases/latest`. If that's newer, it downloads the release's `pdfpcnic-mac.zip`, unpacks it
on the app's disk, and swaps it in for the app, wherever the app is. A downloaded app opened where it was unpacked runs
from a read-only copy (App Translocation), so the swap goes to the original. The running app keeps the page it read at
launch, so the new version starts at the next launch. Files the app downloads itself carry no quarantine mark, so
Gatekeeper doesn't stop the new version. With one download for both halves, the page and the Swift code always match.

`mac/build.sh` builds it on a Mac, for Apple silicon and Intel, signed to run but not with an Apple Developer ID. CI
builds it on every change and runs its smoke test (`pdfpcnic --smoke-test`): the deck opens with the audience window
behind the presenter, both windows draw it, the audience goes fullscreen, the zip installs over an app, and a reload
resumes.

## Adding a platform

Implement `Platform` in `src/<name>/platform.ts`, and an entry point that calls `start()` with it, as `src/mac/` does.

## Checks

```sh
npm test             # the core, in Node
npm run typecheck    # the whole app, and the core again without the DOM
npm run e2e          # the app in a real browser (see CONTRIBUTING.md)
sh mac/build.sh      # the Mac app, on a Mac; then pdfpcnic --smoke-test (see .github/workflows/mac.yml)
```
