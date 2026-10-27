# pdfpcnic

[![Latest release](https://img.shields.io/github/v/release/youweizhuo/pdfpcnic?color=ffd60a&labelColor=1c1c1e)](https://github.com/youweizhuo/pdfpcnic/releases/latest)
[![Checks](https://github.com/youweizhuo/pdfpcnic/actions/workflows/pages.yml/badge.svg)](https://github.com/youweizhuo/pdfpcnic/actions/workflows/pages.yml)
[![MIT License](https://img.shields.io/github/license/youweizhuo/pdfpcnic?color=ffd60a&labelColor=1c1c1e)](LICENSE)
[![Open the presenter](https://img.shields.io/badge/open-the%20presenter-ffd60a?labelColor=1c1c1e)](https://youweizhuo.github.io/pdfpcnic/)

**pdfpcnic** is pronounced "PDF picnic": [pdfpc](https://github.com/pdfpc/pdfpc)'s presenter, packed light to take
anywhere.

It's a pdfpc-style presenter for PDF slides that runs in the browser. Use it from the website, carry it as **one HTML
file** for machines with no network, or host it yourself. Its layout follows
[Présentation.app](https://iihm.imag.fr/blanch/software/osx-presentation/): black and frameless, with the current
slide and its notes on the left, the next slide beside them, and thumbnails down the edge. All the time sits under the
next slide: the clock and one bar for the whole talk.

**Open it:** <https://youweizhuo.github.io/pdfpcnic/> · **Offline copy:** `pdfpcnic.html` from the
[latest release](https://github.com/youweizhuo/pdfpcnic/releases/latest) · **Self-host:**
[docs/self-hosting.md](docs/self-hosting.md)

![The presenter view: the current slide with its speaker notes, the next slide, the clock and the talk's pace, and thumbnails](docs/presenter.png)

- **Nothing to install.** Open the page, drop in the PDF and its `.pdfpc` file, press `o`, then `Shift+W`. In Chrome
  and Edge the audience goes fullscreen on the projector.
- **pdfpc's keys and files**: Markdown notes, reveal steps, hidden slides, the end slide, the talk's length.
- **Pace for timed talks.** Notes can carry each slide's planned window; pdfpcnic shows how this slide and the whole
  talk are going, and colors only what needs your attention.
- **Made for unfamiliar machines.** The offline file needs no network, a reload resumes mid-talk with the clock
  running, and the slides render at the screen's pixel size with the next ones ready ahead.
- **Private.** Files stay on the computer. There are no accounts, no analytics and no uploads.

## Presenting

1. Open the page (or `pdfpcnic.html` from a USB stick) and drop your PDF **and** its `.pdfpc` file on it, or choose
   both at once. The `.pdfpc` file is optional; it brings notes, timing, hidden slides and reveal steps.
2. Press `o` to open the audience window, then `Shift+W` to make it fullscreen. By the clock, one button at a time is
   yellow, the next thing to press: the audience's steps first, then **Start**.
   - **Chrome and Edge** ask once to manage windows. Allow it, and `Shift+W` puts the audience fullscreen on another
     screen than the presenter's: an external one over the laptop's own. If you dragged the audience window to a
     screen yourself, it goes fullscreen there.
   - **Other browsers**: drag the window to the projector and double-click it (or press `Shift+W`) for fullscreen.
3. Press `w` to make the presenter fullscreen too, and `→` to start. The clock starts when you leave the first slide.

If the page reloads mid-talk, **Resume** brings back the deck at the same page, with the clock still running.

On an unfamiliar machine, check that the displays are set to **Extend**, not mirror (`Win+P` on Windows). The presenter
warns you when it sees only one screen. With one screen, `Shift+W` presents in the same window. When you leave a
shared computer, open the page again and press **Forget** beside **Resume**, or present from a private window.

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
| `Esc` | leave black, freeze and laser |
| `s` / `p`, click the clock, or **Start** / **Pause** | start / pause the clock |
| `Ctrl+T` or `Shift+R`, or **Reset** | reset the clock to zero; the keys only while paused, the button with a second click while it runs |
| `,` | settings: current slide, notes and laser sizes; pace colors |
| `+` / `-` | notes text size |
| `[` / `]` | current slide smaller / bigger, trading room with the notes |
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

The clock counts up from zero, beside the time of day, as in Présentation.app. It never changes color; the pace bars
under it do that job. **Pause** and **Reset** sit right under it: if you looked through the slides before the talk,
the clock has been running, so reset it before you start (back on slide 1, Reset turns yellow to remind you). While
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

Along the foot of the current slide, a line fills as you spend its planned time, then turns the late colors; once
you're seriously over, it says by how much. A slide keeps its time over your visits: come back to it and the line
goes on where it stopped. The notes dim along with it, character by character, so the dimmed part is roughly what
you'd have said by now (paragraphs that open with *ref* don't count).

Next to the clock, the whole talk:

- **Early or late**: where the talk would end if you moved on right now, with the slides after this one as planned,
  against the target end (`duration` or `endTime`, else where the plan ends). Reach a two-minute slide on time and it
  starts at "2:00 early", says nothing once you're within the minute of slack (on time needs no words), and turns
  late if you stay on. A backup slide
  isn't on the plan, so there it counts from the last planned slide you were on: a detour shows as late.
- **The bar** is fixed, with a red line at the target end and some room past it: the slides as planned, this one in
  yellow, and right under them a thin line of time spent, colored like the early or late beside the clock. The line
  goes on, paler, to where the talk would end, so you see how far it is from the red line.

Late always shows: orange, deep orange from 1 minute (serious) and red from 2 minutes (very serious). Early shows, in
blue, only past 1 minute. **Settings** (`,`) changes the three levels, in time or as shares of the talk, and how much the notes dim.

Drag the handle between the current slide and its notes to trade one for the other, the line between the columns to
resize them, and the left edge of the thumbnails to resize them; double-click that edge to hide or show the thumbnails.

Without timing lines, the talk's length is split evenly over the slides (pdfpc's even pace). **Help** (`?`) has a key
to the colors.

## Privacy

The browser reads your PDF and `.pdfpc` file; nothing is uploaded, and there are no accounts, cookies or analytics. On
the website, a Content Security Policy lets the page load scripts and connect only to its own site, so nothing in a PDF
or a note can send anything elsewhere.

To resume after a reload, the browser keeps the last deck you opened, with your place and the clock, in its own storage
on this computer. **Forget** on the start page removes it. Settings such as sizes and pace colors are kept too.

## Browsers

Tested in Chrome and Firefox, from the website and from the offline file. Window placement and automatic fullscreen
need a Chromium browser (Chrome, Edge, Brave and others) and a secure page: the website, `localhost`, or your own copy
over HTTPS. In Firefox, drag the audience window to the projector and double-click it for fullscreen. Safari hasn't
been tested yet.

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
