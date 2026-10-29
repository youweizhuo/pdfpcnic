# Contributing

Thanks for helping. pdfpcnic has one job: present PDF slides well on a machine you've never seen, possibly a slow one
with no network. Changes are judged by that.

## Reporting a problem

[Open an issue](https://github.com/youweizhuo/pdfpcnic/issues/new/choose). The form asks for what helps most: the
browser and system, the website or the offline file, how the displays were set up, and what happened. If you can share
the PDF and `.pdfpc` file, or a cut-down copy that still shows the problem, attach them.

Security problems go to a private report instead; see [SECURITY.md](SECURITY.md).

## Proposing a change

For anything beyond a small fix, open an issue first so we can agree on the behavior before you write the code. What
fits: what pdfpc and Présentation.app do, in the browser, and pace display for timed talks. What doesn't: editing
slides, transitions, video, and anything that sends a deck off the machine. [docs/roadmap.md](docs/roadmap.md) has
what's being weighed and what was left out, and why.

## Development

You need Node 22.18 or later, and Chrome or Chromium and Firefox for the end-to-end checks.

```sh
npm install
npm run dev                                      # local server with reload
npm test                                         # unit tests of the core
npm run build                                    # type-check, then dist/ (the site) and dist/pdfpcnic.html
CHROME_PATH=/path/to/chrome npm run e2e          # end-to-end checks on the offline file
CHROME_PATH=/path/to/chrome npm run e2e -- site  # ... and on the site, with window placement
FIREFOX_PATH=/path/to/firefox npm run e2e:firefox # the main path in Firefox, on both builds
```

The e2e script drives a real Chrome through the demo deck and saves screenshots to `e2e-out/`. It also runs against a
deployed copy: `npm run e2e -- https://youweizhuo.github.io/pdfpcnic/`.

### Where things are

[docs/architecture.md](docs/architecture.md) explains the layout. In short:

- `src/core/` is the talk itself: slides from the PDF and `.pdfpc` file, keys, the clock and pace. No browser code;
  its tests are in `test/`.
- `src/ui/` is the presenter page, which draws the talk.
- `src/platform.ts` lists what pdfpcnic needs from where it runs, and `src/web/` provides it in the browser: pdf.js,
  the audience popup, fullscreen and storage. `src/web/variant-*.ts` hold what differs between the site and the
  offline file.
- `src/mac/` provides it in the Mac app, over a bridge to the app's native half in `mac/` (Swift: the windows, PDFKit,
  updates). `sh mac/build.sh` builds the app on a Mac; CI builds it and runs its smoke test on every change.
- `demo/` has the demo deck: Typst source, PDF and `.pdfpc`.
- `deploy/` and `Containerfile` are for self-hosting.

## Pull requests

- `npm test`, `npm run build` and the e2e runs pass. New behavior gets a check: a unit test for the core, an e2e
  check for the page.
- Keep it light. Every dependency and every kilobyte ends up in the offline file, and drawing on the main thread
  costs smoothness on weak machines.
- Match the code around you: plain TypeScript and DOM, no framework, comments that say why.
- Text people read, in the interface or the docs, is short and plain: say what happens, in the words a presenter
  would use.
- Add a line to `CHANGELOG.md` under the coming release for anything a user would notice.

By contributing, you agree that your work is released under the [MIT License](LICENSE).
