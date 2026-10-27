// Demo deck for pdfpcnic. Rebuild with `typst compile demo.typ` (needs a CJK
// font such as Noto Sans CJK SC for the last slides); demo.pdfpc is
// hand-written to match its pages.
#set page(width: 32cm, height: 18cm, margin: 2cm, fill: rgb("#f7f5f0"), numbering: "1",
  footer: context align(right, text(14pt, fill: luma(140), counter(page).display())))
#set text(font: ("Libertinus Serif", "Noto Sans CJK SC"), size: 26pt, fill: rgb("#1d1d1f"))
#show heading: set text(40pt, weight: "bold", fill: rgb("#8a1c1c"))

#let slide(title, body) = {
  heading(title)
  v(0.6em)
  body
}
// A reveal step: same page label as the page before, so pdfpc groups them.
#let step = counter(page).update(n => n - 1)

#align(center + horizon)[
  #text(60pt, weight: "bold", fill: rgb("#8a1c1c"))[pdfpcnic]
  #v(0.2em)
  #text(30pt)[A pdfpc-style presenter in the browser]
  #v(1em)
  #text(20pt, fill: luma(110))[demo deck · press → to start the clock]
]

#pagebreak()
#slide[Two windows][
  - *Presenter*: clock, current and next slide, notes, thumbnails
  - *Audience*: the slide, fullscreen on the projector
  - Press #box(stroke: 1pt, inset: 4pt, radius: 3pt)[o] to open the audience window
]

#pagebreak()
#slide[Reveal steps][
  - First, a point
]
#pagebreak()
#step
#slide[Reveal steps][
  - First, a point
  - Then another
]
#pagebreak()
#step
#slide[Reveal steps][
  - First, a point
  - Then another
  - And a third: Shift+PageDown skips the rest
]

#pagebreak()
#slide[Laser pointer][
  Press #box(stroke: 1pt, inset: 4pt, radius: 3pt)[2] and move the mouse over the current slide.
  #v(1em)
  #align(center, grid(columns: 3, gutter: 1.2cm,
    circle(radius: 1.6cm, fill: rgb("#e0a458")),
    rect(width: 3.2cm, height: 3.2cm, fill: rgb("#5b8e7d")),
    polygon.regular(vertices: 3, size: 3.6cm, fill: rgb("#3d5a80")),
  ))
]

#pagebreak()
#slide[中文备注][
  备注支持中文和 Markdown。
  #v(0.5em)
  Notes come from the `.pdfpc` file.
]

#pagebreak()
#slide[A hidden slide][
  Marked `hidden` in the `.pdfpc` file: normal navigation skips it.
]

#pagebreak()
#align(center + horizon)[
  #text(54pt, weight: "bold", fill: rgb("#8a1c1c"))[Thanks]
  #v(0.4em)
  #text(24pt, fill: luma(110))[the end slide: backup slides follow]
]

#pagebreak()
#slide[Backup: details][
  Slides after `endSlide` stay reachable but don't count in the progress.
]
