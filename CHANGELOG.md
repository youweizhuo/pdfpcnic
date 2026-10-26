# Changelog

Notable changes to pdfpcnic. Versions follow [Semantic Versioning](https://semver.org/): the keys, the `.pdfpc`
fields read and the timing-line format are the interface. Each release attaches the offline file, `pdfpcnic.html`.

## 1.0.0 (unreleased)

The first stable release: the presenter, its pace display and the offline file are complete for talks given with
pdfpc files, and the site can now be self-hosted.

### Added

- **Self-hosting.** A container image (nginx, about 25 MB) and a Podman Quadlet unit that runs it as a service and
  starts it with the server. See [docs/self-hosting.md](docs/self-hosting.md).
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
