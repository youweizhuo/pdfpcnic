# pdfpcnic

[![Latest release](https://img.shields.io/github/v/release/youweizhuo/pdfpcnic?color=ffd60a&labelColor=1c1c1e)](https://github.com/youweizhuo/pdfpcnic/releases/latest)
[![Checks](https://github.com/youweizhuo/pdfpcnic/actions/workflows/pages.yml/badge.svg)](https://github.com/youweizhuo/pdfpcnic/actions/workflows/pages.yml)
[![MIT License](https://img.shields.io/github/license/youweizhuo/pdfpcnic?color=ffd60a&labelColor=1c1c1e)](LICENSE)
[![Open the presenter](https://img.shields.io/badge/open-the%20presenter-ffd60a?labelColor=1c1c1e)](https://youweizhuo.github.io/pdfpcnic/)

**pdfpcnic** is pronounced "PDF picnic": [pdfpc](https://github.com/pdfpc/pdfpc)'s presenter, packed light to take
anywhere.

It's a pdfpc-style presenter for PDF slides that runs in the browser. Use it from the website, carry it as **one HTML
file** for machines with no network, host it yourself, or install the **Mac app**. Its layout follows
[Présentation.app](https://iihm.imag.fr/blanch/software/osx-presentation/): black and frameless, with the current
slide and its notes on the left, the next slide and its notes, in grey, beside them, and the thumbnails a mouse move
away at the right edge. All the time sits under the next slide: one line for the whole talk, and the clock.

**Open it:** <https://youweizhuo.github.io/pdfpcnic/> · **Offline copy:** `pdfpcnic.html` from the
[latest release](https://github.com/youweizhuo/pdfpcnic/releases/latest) · **Mac app:** `pdfpcnic-mac.zip`, same place
([below](#mac-app)) · **Self-host:** [docs/self-hosting.md](docs/self-hosting.md)

![The presenter view: the current slide with its speaker notes, the next slide, the clock and the talk's pace, and thumbnails](docs/presenter.png)

- **Nothing to install.** Open the page, choose the PDF and its `.pdfpc` file, and press `Shift+W`. The audience
  window comes with the deck, and in Chrome and Edge it goes fullscreen on the projector.
- **pdfpc's keys and files**: Markdown notes, reveal steps, hidden slides, the end slide, the talk's length.
- **Pace for timed talks.** Notes can carry each slide's planned window; pdfpcnic shows how this slide and the whole
  talk are going, and colors only what needs your attention.
- **Made for unfamiliar machines.** The offline file needs no network, a reload resumes mid-talk with the clock
  running, and the slides render at the screen's pixel size with the next ones ready ahead.
- **Private.** Files stay on the computer. There are no accounts, no analytics and no uploads.

## Presenting

1. Open the page (or `pdfpcnic.html` from a USB stick) and drop your PDF **and** its `.pdfpc` file on it, or choose
   both at once. The `.pdfpc` file is optional; it brings notes, timing, hidden slides and reveal steps. The deck
   shows on the page, with its slides and length: press **Present** (or `Enter`).
2. Present opens the presenter and, in the same click, the audience window; press `Shift+W` to make it fullscreen.
   One button at a time has a yellow outline, the next thing to press: the audience's, at the foot of the right
   column, first, then **Start** over the clock. Filled yellow means on: black, freeze, the laser, fullscreen.
   - **If the browser blocked the window** (pop-ups blocked for the page): allow them, then press `o`. If you close
     the audience window, `o` brings it back too.
   - **Chrome and Edge** ask once to manage windows. Allow it, and `Shift+W` puts the audience fullscreen on another
     screen than the presenter's: an external one over the laptop's own. If you dragged the audience window to a
     screen yourself, it goes fullscreen there.
   - **Other browsers**: drag the window to the projector and double-click it for fullscreen, as the yellow button
     says. Only Chrome and Edge can make it fullscreen from the presenter window.

   Until the talk starts, the line under the talk bar says what to do with the audience window.
3. Press `w` to make the presenter fullscreen too (its button is beside the audience's), and `→` to start. The clock
   starts when you leave the first slide.

`Esc` steps back one thing at a time: it closes the help or the overview, then ends black, freeze and the laser, then
leaves the presenter's fullscreen. It never takes the audience out of fullscreen; `Shift+W` does. Chrome and Edge let
pdfpcnic have `Esc` in fullscreen, and holding it down leaves fullscreen. Firefox and Safari leave fullscreen at the
first press.

If the page reloads mid-talk, **Resume** brings back the deck at the same page, with the clock still running.

On an unfamiliar machine, check that the displays are set to **Extend**, not mirror (`Win+P` on Windows). The presenter
warns you when it sees only one screen. With one screen, `Shift+W` presents in the same window. When you leave a
shared computer, open the page again and press **Forget** beside **Resume**, or present from a private window.

## Mac app

The same presenter, in a Mac app of its own, with an audience window it places itself:

- **The audience window opens with the deck, behind the presenter**, and `Shift+W` puts it fullscreen on the
  projector, whatever the screens, with nothing to allow first. It's part of the presenter's window: it closes with it.
- **The audience window is frameless**, and macOS draws the slides, in both windows, with its own PDF engine, as
  Preview does.
- **Fullscreen is instant**, with no animation and no new Space, as in Présentation.app. Keys go on to the presenter
  window.
- **Open a deck from the Finder** (Open With › pdfpcnic), with File › Open, or by dropping it on the window.

To install it, paste this line into Terminal (in Applications › Utilities). It puts pdfpcnic in Applications and opens
it:

```sh
curl -fsSL https://github.com/youweizhuo/pdfpcnic/releases/latest/download/pdfpcnic-mac.zip -o /tmp/pdfpcnic.zip && ditto -x -k /tmp/pdfpcnic.zip /Applications && open /Applications/pdfpcnic.app
```

Or download `pdfpcnic-mac.zip` from the [latest release](https://github.com/youweizhuo/pdfpcnic/releases/latest) and
unzip it. The app isn't signed by a paid Apple developer account, so macOS stops an app that a browser downloaded:
*Apple could not verify "pdfpcnic" is free of malware*. Click **Done**, open System Settings › Privacy & Security,
scroll to the bottom, and click **Open Anyway** beside *"pdfpcnic" was blocked*. The button stays there for about an
hour after macOS stopped the app. It's needed only once, and not at all with the Terminal line: macOS checks only
files that a browser marks as downloaded, and `curl` doesn't mark them.

**Updates install themselves.** A few seconds after it starts, the app looks for a newer release. If there is one, it
downloads it and puts it in place of itself, wherever it is. The new version opens the next time you start the app,
never mid-talk, and macOS doesn't stop it. **Check for Updates…** in the pdfpcnic menu looks right away and says how
it went. In Applications this happens without a word. In Downloads or Desktop, macOS may first ask to let pdfpcnic
change files there.

It needs macOS 12 or later, on Apple silicon or Intel.

## Keys

The same keys as pdfpc, plus `o` for the audience window. Press `?` (or **Help**) for the full list.

| Key | |
| --- | --- |
| `→` `↓` `PgDn` `Space` `Enter`, click | next step |
| `←` `↑` `PgUp` `Backspace`, right-click | back; skips back over the reveal steps of a slide |
| `Shift+PgDn` / `Shift+PgUp` | next / previous slide, skipping reveal steps |
| `Home` / `End` | first slide / end slide |
| `g` | go to a slide number |
| `Tab` | overview |
| `o` | open the audience window |
| `b` / `f` | black screen / freeze the audience on this slide while you move on (a card over your current slide says so) |
| `2` / `1` | laser pointer on / off (`+` `-` change its size) |
| `Esc` | one step back: close the help or the overview, then end black, freeze and laser, then leave presenter fullscreen; never the audience's |
| `s` / `p`, click the clock, or **Start** / **Pause** by it | start / pause the clock |
| `Ctrl+T` or `Shift+R`, or **Reset** | reset the clock to zero; the keys only while paused, the button with a second click while it runs |
| `,` | settings: current slide, notes and laser sizes; pace colors |
| `+` / `-` | notes text size |
| `[` / `]` | current slide smaller / bigger, trading room with the notes |
| `0` | the layout as at first: equal columns, the current slide full size |
| `w` / `Shift+W` | presenter / audience fullscreen |

## pdfpc support

pdfpcnic reads `.pdfpc` files in pdfpc's JSON format (`pdfpcFormat: 2`). From Typst with
[Touying](https://touying-typ.github.io/), export one with `typst query deck.typ --field value --one "<pdfpc-file>" > deck.pdfpc`
or tinymist's "Export PDF + Pdfpc".

| `.pdfpc` field | |
| --- | --- |
| `pages[].note` | speaker notes, rendered as Markdown (unless `disableMarkdown`) |
| `pages[].label`, `overlay`, `forcedOverlay` | reveal steps grouped into one slide, as pdfpc does |
| `pages[].hidden` | skipped by normal navigation |
| `duration`, `endTime`, `startTime` | countdown, and a countdown to the start (in the Start button's tooltip) |
| `endSlide` | the talk's last slide; later ones are backup |
| `savedSlide` | bookmark (`Shift+M`) |
| `noteFontSize` | notes size, until you change it with `+`/`-` |

As in pdfpc:

- Pages that share a PDF page label count as one slide.
- Note annotations in the PDF (sticky notes and highlights) become notes and are left off the slides.

Links in the PDF work: click one to jump to its page (`Shift+Backspace` comes back), or to open a web page in a new
tab. The presenter outlines them so you can see what's clickable; the audience sees the slide as designed.

Not supported: Beamer notes on half pages, transitions, movies, drawing tools and spotlight. Changes made while
presenting (`Ctrl+E` for the end slide, `m` for the bookmark) stay in the browser rather than being written back to
the `.pdfpc` file.

## Pace

The clock counts up from zero, as in Présentation.app. It never changes color; the talk's line over it does that
job. Over it, **Start**, then **Pause** and **Resume**, and **Reset**, which is outlined in yellow while the clock
is paused: if you looked through the slides before the talk, the clock has been running, so reset it before you
start (back on slide 1, Reset is outlined to remind you). While
it runs, Reset takes a second click, and the reset keys work only while paused, so a stray click or key can't zero
the clock mid-talk. After a reset the clock starts again at your next move.

A note can start with the slide's planned window, in minutes and seconds from the start of the talk:

```
**01:22 → 01:58** · 36 s
```

pdfpcnic takes that line off the note and draws it instead. It has to be the note's first line, on its own. The arrow
may be `->`, minutes may pass 59, and the `· 36 s` is optional. `**01:22**` alone plans a slide that takes no time.
Reveal steps repeat their slide's line, or carry windows of their own; then each step goes by its own. A backup slide
(after `endSlide`) can say just how long it takes, `**45 s**`. TokenSlides, a Typst theme built on Touying, writes
these lines from the speaker notes, and marks the slides after `#show: appendix` as backup.

Along the foot of the current slide, a line fills as you spend its planned time, then turns the late colors. A
slide keeps its time over your visits: come back to it and the line goes on where it stopped. The notes dim along
with it, a character at a time, like a typewriter, so the dimmed part is roughly what you'd have said by now
(paragraphs that open with *ref* don't count; they show in grey, as references not to read out).

Under the next slide, the whole talk, laid out as the current slide's own line and level with it:

- **The talk's line** is fixed, with a red line at the target end (`duration` or `endTime`, else where the plan
  ends) and some room past it. Time spent runs along it in the color of the pace, then on, paler, to where the talk
  would end if you moved on right now, with the slides after this one as planned; this slide's planned part is
  see-through yellow over it. Under the red line, where the talk would end.
- **Early or late**, by that same end: it shows as the line's color and as the time at the clock's right, where the
  talk would end. Reach a two-minute slide on time and it's early; within the minute of slack it's on time; stay on
  and it turns late. Hover over the time for how early or late, in words. A backup slide isn't on the plan, so
  there it counts from the last planned slide you were on: a detour shows as late.
- **Click the line** for the clocks as times of day (also in **Settings**): the clock shows the time, and where the
  talk would end runs on from now, so a pause moves it later.

Late always shows: orange, deep orange from 1 minute (serious) and red from 2 minutes (very serious). Early shows, in
blue, only past 1 minute. **Settings** (`,`) changes the three levels, in time or as shares of the talk, and how much the notes dim.

Drag the handle between the current slide and its notes to trade one for the other, and the line between the columns
to resize them; `0` puts both back. Rest the mouse at the window's right edge and the thumbnails come in over the
page, to jump to a slide; they go once the mouse leaves them. **Overview** (`Tab`) shows every slide at once. If the
PDF's outline (its bookmarks) groups the slides into sections, as Beamer's and Typst's do, both show where each
section starts.

Without timing lines, the talk's length is split evenly over the slides (pdfpc's even pace). **Help** (`?`) has a key
to the colors.

## Privacy

Your PDF and `.pdfpc` file open in the browser and aren't sent anywhere; there are no accounts, cookies or analytics. On
the website, a Content Security Policy lets the page load scripts and connect only to its own site, so nothing in a PDF
or a note can send anything elsewhere. The Mac app's page is held to the same: it reaches only the app. The app itself
connects only to GitHub, a few seconds after it starts, to look for updates and download them.

To resume after a reload, the browser keeps the last deck you opened, with your place and the clock, in its own storage
on this computer. **Forget** on the start page removes it. Settings such as sizes and pace colors are kept too.

## Browsers

Tested in Chrome and Firefox, from the website and from the offline file, and the Mac app on macOS. In a browser,
window placement and automatic fullscreen need a Chromium browser (Chrome, Edge, Brave and others) and a secure page:
the website, `localhost`, or your own copy over HTTPS. In Firefox, drag the audience window to the projector and
double-click it for fullscreen. Safari hasn't been tested yet; on a Mac, the app does all of it.

The website also renders PDFs that don't embed their fonts, and scanned images (JBIG2 and JPEG 2000), by fetching
pdf.js's extra files when a PDF needs them. The offline file goes without; slides made with Typst, LaTeX, PowerPoint
or Keynote rarely need them.

## Self-hosting

```sh
podman run -d --name pdfpcnic -p 8080:8080 ghcr.io/youweizhuo/pdfpcnic:1
```

The image is nginx with the site, about 25 MB, for amd64 and arm64. [docs/self-hosting.md](docs/self-hosting.md) sets
it up as a service that starts with the server and keeps itself up to date, behind HTTPS.

## Contributing

Bug reports, ideas and pull requests are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) explains the setup and the
checks. To build it yourself:

```sh
npm install
npm run build        # dist/ (the site) and dist/pdfpcnic.html (the offline file)
```

## Credits

Started from the idea of [pdf-webslides-js](https://github.com/misc0110/pdf-webslides-js) by Michael Schwarz. The keys
and file format come from [pdfpc](https://github.com/pdfpc/pdfpc), and the look from
[Présentation.app](https://iihm.imag.fr/blanch/software/osx-presentation/) by Renaud Blanch. Built with PDF.js
(Apache-2.0), [marked](https://marked.js.org/) (MIT) and [DOMPurify](https://github.com/cure53/DOMPurify)
(Apache-2.0 or MPL-2.0).

## License

[MIT](LICENSE)
