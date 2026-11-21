// Rebuild from the repo root with `typst compile demo/demo.typ demo/demo.pdf`.
// On systems without PingFang SC, pass --input cjk-font="Noto Sans CJK SC".
// The matching notes and timings are in demo.pdfpc.
#set page(width: 32cm, height: 18cm, margin: 2cm, fill: rgb("#f7f5f0"), numbering: "1",
  footer: context align(right, text(14pt, fill: luma(140), counter(page).display())))
#let cjk-font = sys.inputs.at("cjk-font", default: "PingFang SC")
#set text(font: ("Libertinus Serif", cjk-font), size: 26pt, fill: rgb("#1d1d1f"))
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
  #text(30pt)[A pdfpc-style presenter for PDF slides]
  #v(1em)
  #text(20pt, fill: luma(110))[demo deck · click or press → to start the clock]
]

#pagebreak()
#slide[Two windows][
  - *Presenter* shows the clock, slides, notes, and thumbnails.
  - *Projector* (`Shift+W`) puts the audience fullscreen on a second screen.
    If remote fullscreen is unavailable, drag the audience window there and double-click it.
  - *Sharing* (`Shift+O`) fits the audience window to the slide's proportions for Zoom, Meet, or Teams, even with one screen.
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
  - And a third
  #v(0.5em)
  Press `Shift+PageDown` to skip to the next slide.
]

#pagebreak()
#slide[Laser pointer][
  Press #box(stroke: 1pt, inset: 4pt, radius: 3pt)[l] and move the mouse over the presenter's current slide.
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
  The `.pdfpc` file supplies speaker notes and planned timings.
]

#pagebreak()
#slide[A hidden slide][
  Normal navigation skips this slide.
  #v(0.5em)
  Press `g` and enter 6, or pick it in Overview (`v`) or the thumbnails at the right edge.
]

#pagebreak()
#align(center + horizon)[
  #text(54pt, weight: "bold", fill: rgb("#8a1c1c"))[Thanks]
  #v(0.4em)
  #text(24pt, fill: luma(110))[the end slide · backup follows]
]

#pagebreak()
#slide[Backup: details][
  Backup slides are outside the talk's pace plan. This slide has its own 30-second pace line.
]
