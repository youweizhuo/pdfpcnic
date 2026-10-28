# Changelog

Notable changes to pdfpcnic. Versions follow [Semantic Versioning](https://semver.org/): the keys, the `.pdfpc`
fields read and the timing-line format are the interface. Each release attaches the offline file, `pdfpcnic.html`.

## 1.2.4 (2026-10-28)

### Changed

- **A deck waits on the start page for Present.** Chosen or dropped, it shows with its files, slides and length;
  **Present** (or `Enter`) opens the presenter and, in the same click, the audience window, so every browser allows
  it and the browser and the Mac app go the same way. **Resume** and **Try the demo** open it in their click too.
  Dropping the `.pdfpc` after the PDF adds it to the waiting deck. A deck opened from the Finder, or with one open
  already, opens at once.
- **The audience window is part of the presenter's** in the Mac app: it has no close of its own, and `Cmd-W` closes
  the presenter, the audience with it. In the browser, `o` brings it back if it's closed.
- **The version sits by the name**, larger: "1.2.4", or "1.2.4 for Mac" in the app.
- **The start page's words:** the website says your slides open in the browser and aren't sent anywhere; the app's
  page says "on your Mac" and drops the lines about uploads and the network.

### Fixed

- **No black line at the edge of the Mac app's audience window.** The slide's size was rounded down to whole points,
  so a window a fraction of a point off the slide's shape, as the app opens it on many screens, kept one point of
  black at the top or the right. Letterbox bars are now even on both sides.

## 1.2.3 (2026-10-28)

### Changed

- **The laser follows the mouse over the presenter's slide only**, as in Présentation.app, in the browser and the Mac
  app. The mouse over the audience window no longer moves it: Firefox on the Mac doesn't report the mouse over a
  window that isn't the active one, so pointing there showed nothing.

## 1.2.2 (2026-10-27)

### Changed

- **The two fullscreen buttons sit together** under the clock, audience over presenter, each lit while on and
  pressed again to end it. The presenter's has left the toolbar.
- **`Esc` steps back one thing at a time**, the same in the browser and the Mac app: it closes the help or the
  overview, then ends black, freeze and the laser, then leaves the presenter's fullscreen. It never takes the audience
  out of fullscreen. In Chrome and Edge, pdfpcnic has `Esc` in fullscreen too, and holding it down leaves fullscreen.
- **Early or late is as large as the clock.**
- **The bar shows its ends at the red line:** the target end over it (`10:00`), and where the talk would end under
  it, on the clock or, with a click on the bar (or in Settings), as times of day.
- **The time of day has left the toolbar's corner**: the bar shows it, a click away.
- **The help sheet leads with what nothing on screen shows:** notes and slide sizes, `Esc`, dragging the dividers,
  clicking the bar, and dropping a `.pdfpc` file to add notes. The ways to move and the keys the buttons already show
  follow in short lines, then the pace legend. It fits its window, and the legend no longer runs into its own text.

## 1.2.1 (2026-10-27)

### Changed

- **The audience window opens with the deck.** In the Mac app it opens behind the presenter, and `Shift+W` then puts
  it fullscreen on the projector. A browser opens a window only right after a click or key. After a dropped file,
  the yellow button by the clock still offers it (`o`), and allowing pop-ups for the page lets it open by itself.
- **The Mac app updates itself whole.** It downloads each new release and puts it in place of itself, wherever it is.
  The new version opens at the next launch, and macOS doesn't stop it, even when the app's own code changed. Releases
  now attach just the two downloads, `pdfpcnic.html` and `pdfpcnic-mac.zip`.
- **The Mac app installs with one line in Terminal** (see the README), with no Open Anyway.

1.2.0 can't update itself to this version: install it once more.

## 1.2.0 (2026-10-27)

### Added

- **pdfpcnic for the Mac**: `pdfpcnic-mac.zip`, attached to each release from now on. It's the same presenter, in an
  app of its own, for macOS 12 or later on Apple silicon or Intel.
  - `Shift+W` puts the audience fullscreen on the projector, whatever the screens, with nothing to allow first.
  - The audience window is frameless, and macOS draws the slides, in both windows, with its own PDF engine, as
    Preview does.
  - Fullscreen is instant, with no animation and no new Space, as in Présentation.app, and keys go on to the
    presenter window.
  - Decks open from the Finder (Open With › pdfpcnic), with File › Open, or by dropping them on the window.
  - **Updates come by themselves.** The presenter page downloads from each release in the background and opens at the
    next launch, never mid-talk. A release that changes the app itself is offered as a download, once.

  The app isn't signed by an Apple developer account: the first time, open it, then click Open Anyway in System
  Settings › Privacy & Security.

## 1.1.3 (2026-10-27)

### Changed

- **Links work on turned pages** too (a PDF page with its own rotation). They used to be left off.
- **For contributors:** the code is split into the talk (`src/core/`), the presenter page (`src/ui/`) and the
  browser's side (`src/web/`), behind the ports in `src/platform.ts`, so another platform, such as a native Mac app,
  can provide its own windows and PDF engine. See [docs/architecture.md](docs/architecture.md). The core has unit
  tests, `npm test`, which need Node 22.18 or later.

## 1.1.2 (2026-10-27)

### Changed

- **Errors stay until you close them**, above the notes that come and go, and their text can be selected to copy.
  They add the browser's own reason where there is one.
- **Firefox and Safari aren't offered `Shift+W` for the audience**, since only Chrome and Edge can make it fullscreen
  from the presenter window. There, once the audience window is open, the yellow button says to double-click it (and
  brings it forward), and `Shift+W` pressed in the presenter says the same instead of showing an error.

### Fixed

- **Closing the audience window shows at once**: the button goes back to "Open audience window" right away, instead
  of offering fullscreen for a second or more (up to three in Firefox).
- **The audience window stays on the projector when it leaves fullscreen** in Chrome and Edge. Chrome used to put it
  back where it opened, on the presenter's screen, where it hid behind the presenter and looked closed.
- **The audience stays sharp while the presenter's tab is hidden** behind another tab. pdf.js draws in steps timed to
  the presenter window's animation frames, which a hidden tab doesn't get, so new slides stopped half-drawn and the
  audience showed a blurry thumbnail until you came back.

## 1.1.1 (2026-10-27)

### Changed

- **One yellow button at a time**, the next thing to press: the audience's steps come first, then the clock's. Before
  the talk, Start turns yellow once the audience is fullscreen.
- **Messages, the key list and the demo deck say "clock"**, as the buttons do, instead of "timer" in some places.

## 1.1.0 (2026-10-27)

### Changed

- **`Shift+W` puts the audience fullscreen on the projector**, in one key press. `o` opens the audience window on
  your screen; `Shift+W` then makes it fullscreen on another screen (an external one over the laptop's own), or where
  you dragged it. Chrome picks the screen itself, so the window no longer has to be moved there first, which could
  leave it on the wrong display in Chrome on Windows. It no longer moves on its own when it opens.
- **A yellow button under the clock gives the audience's next step**: open the audience window, then make it
  fullscreen (naming the screen). It replaces the Audience button in the toolbar, and turns plain once the audience is
  fullscreen.
- **Start/Pause and Reset buttons sit under the clock**, always in sight, instead of a Reset that appeared only while
  paused. What to press next is yellow: Start before the clock starts, Resume while paused. While the clock runs,
  Reset takes a second click; the reset keys still work only while paused.
- **No more line of text under the clock**, so nothing there moves as the clock starts, pauses or resets. The buttons
  show the clock's state; the rest is in their tooltips and in the message at the bottom.
- **Back on slide 1 with time on the clock, Reset turns yellow** and a message asks whether to reset before you start:
  a look through the slides before the talk starts the clock and would throw the pace off.

## 1.0.1 (2026-10-26)

### Changed

- **The talk bar shows where the talk would end.** The line of time spent goes on, paler, to the projected end, so
  you see how far it is from the red line. The line sits right under the slides, and the bar is a little taller.
- **This slide's line moves smoothly**, a pixel at a time, and the notes dim with a soft edge that fades a character
  at a time, instead of both jumping once a second. Each is redrawn only when it has changed, a few times a second.
- **Early and late beside the clock are bigger**, and on time shows nothing.
- **The pace sliders in Settings are shorter** (up to 3 minutes early and 5 minutes late, or 10 to 20% of the talk),
  so the useful values are easier to set.

## 1.0.0 (2026-10-26)

The first stable release: the presenter, its pace display and the offline file are complete for talks given with
pdfpc files, and the site can now be self-hosted.

### Added

- **Self-hosting.** A container image (nginx, about 25 MB) and a Podman Quadlet unit that runs it as a service and
  starts it with the server. See [docs/self-hosting.md](https://github.com/youweizhuo/pdfpcnic/blob/main/docs/self-hosting.md).
- **Links in the PDF** work, in the presenter and the audience window: a jump to another page (back returns), a web
  link in a new tab, and PDF actions such as next page and back. The presenter outlines links; the PDF's own link
  borders stay hidden.
- **Forget**, beside **Resume** on the start page, removes the kept deck from the browser, for when you leave a
  shared computer.
- **PDFs that don't embed their fonts, and scanned images**, render on the site as in Firefox: pdf.js fetches its
  CMaps, standard fonts and JBIG2/JPEG 2000 decoders when a PDF needs them. The offline file stays without them.
- **Backup slides** (after `endSlide`) can carry their own length, `**45 s**`, which the line under the slide runs
  against. They're off the plan, so early/late goes on from the last planned slide you were on.
- **Time per slide over visits**: come back to a slide and its line goes on where it stopped.
- **Drag handles** to trade the current slide's size for notes, and to resize or hide the thumbnails.
- **Firefox is tested**: an end-to-end check runs the main path in both builds. Place the audience window by hand
  there.
- **Third-party licenses**, as `licenses.txt` on the site and inside the offline file.

### Changed

- **The demo deck is fetched when you ask for it**, and the offline file leaves it out: 60 KB less to load on every
  visit.
- **A Content Security Policy** on the site: scripts, workers and connections come from the site alone, so nothing in
  a PDF or a note can load code or send anything elsewhere.
- **One clock line**: elapsed time on the left, early or late on the right, counted as if you moved on now. The
  numbers turn over together, once a second.
- **This slide's time** is a slim line along the foot of the slide, flush with its edges, and the notes dim character
  by character as its planned time passes. Bars are square-cornered.
- **The audience window goes fullscreen** from a key pressed in it, too.

### Fixed

- The clock no longer freezes between page turns while the audience window is fullscreen on the other display (Chrome
  took the presenter for hidden and slowed its timers).
- In the offline file, reopening the audience window after the presenter reloaded left it frozen on the old slide;
  the stale window is now replaced.
- Opening a deck while the previous one is still drawing no longer logs an error.

## 0.9.0 (2026-10-26)

- This slide counts your time on it, against its planned length.
- Notes dim as the slide's planned time passes (Settings sets how much).

## 0.8.0 (2026-10-26)

- Pace levels in time or as shares of the talk; defaults: early is fine up to 1 minute, late is serious from 1 and
  very serious from 2.
- Time spent is a thin line under the talk bar.

## 0.7.0 (2026-10-26)

- Pace colors in levels: late always shows, deeper as it gets serious; early only past a slack.

## 0.6.0 (2026-10-26)

- A fixed, two-row talk bar colored by pace, with a red line at the target end.
- Black and freeze show as a card over the current slide; the toolbar shows buttons with their keys.

## 0.5.0 (2026-10-26)

- Reveal steps with windows of their own (forced overlays) count in the plan.
- The next step and slide render first; the rest wait until the machine is idle.

## 0.4.0 (2026-10-26)

- Settings (`,`): current slide, notes and laser sizes. Decks without timing lines get an even pace.

## 0.3.0 (2026-10-26)

- All the time under the next slide. Reset works only while the timer is paused.

## 0.2.0 (2026-10-26)

- Présentation.app's clock, and a pace panel read from timing lines such as `**01:22 → 01:58** · 36 s`.

## 0.1.0 (2026-10-25)

- First release: pdfpc keys and `.pdfpc` files, Présentation.app's presenter view, an audience window placed on the
  projector, laser, black, freeze, overview, resume after a reload, and the offline file.
