# Roadmap

What may come next, and what was weighed and left out, with why, so a proposal can start from there. A good reason
can change any of it: open an issue.

## Not for now

- **A phone as the remote or a second presenter view.** The phone and the computer would need a relay between them.
- **Notes that follow your voice**, dimmed to where you actually are rather than where the clock says. A browser's
  speech recognition can send the audio off the machine.

## Left out

- **Editing notes.** They belong in the deck's source: a `.pdfpc` file made from Typst or LaTeX is written again at
  the next export, and an edit made here would be lost with it.
- **Beamer notes on half pages.** Notes come from the `.pdfpc` file or the PDF's note annotations.
- **The spotlight.** The laser shows where to look.
- **Passwords and managing decks on the public site.** A leaked password would let anyone host PDFs on your domain.
  The public side only reads; uploads are on a private port, and deleting is done on the server.
- **A pen**, to draw on the slide for the audience. It would have to draw in every window and take over the click
  that steps on, and it suits a touchscreen or a stylus more than a borrowed laptop's trackpad.
- **Video in the PDF.** pdf.js doesn't play it.
- **Transitions**, and editing the slides.
