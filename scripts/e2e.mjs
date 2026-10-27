// End-to-end check in a real Chrome: loads the demo deck, walks through
// navigation, the audience window, freeze, black, laser, overview, go-to and
// resume, and saves screenshots to e2e-out/.
//
//   CHROME_PATH=/path/to/chrome npm run e2e            # single file over file://
//   CHROME_PATH=/path/to/chrome npm run e2e -- site    # site build over http
//   CHROME_PATH=/path/to/chrome npm run e2e -- https://youweizhuo.github.io/pdfpcnic/

import assert from "node:assert/strict";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./launch.mjs";

const chrome = process.env.CHROME_PATH;
if (!chrome) {
  console.error("Set CHROME_PATH to a Chrome or Chromium binary.");
  process.exit(2);
}
const remote = process.argv[2]?.startsWith("http") ? process.argv[2] : null;
const mode = remote || process.argv[2] === "site" ? "site" : "single";
const out = resolve("e2e-out", remote ? "remote" : mode);
mkdirSync(out, { recursive: true });

let server;
let url = remote;
if (remote) {
  // tested as deployed
} else if (mode === "site") {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
  server = createServer((req, res) => {
    const path = join(resolve("dist"), decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "index.html") : path;
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/`;
} else {
  url = pathToFileURL(resolve("dist/pdfpcnic.html")).href;
}

const browser = await launch({
  executablePath: chrome,
  headless: true,
  // A laptop, a projector to its right, and a third screen beyond.
  args: ["--no-sandbox", "--window-size=1440,900", "--screen-info={0,0 1440x900}{1440,0 1920x1080}{3360,0 1280x800}"],
  defaultViewport: null,
});
const errors = [];
const watch = (p, name) => {
  p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
};

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}\n       ${err.message.split("\n").join("\n       ")}`);
    process.exitCode = 1;
  }
}

try {
  if (mode === "site") {
    // As if the user had allowed window placement before.
    const cdp = await browser.target().createCDPSession();
    await cdp.send("Browser.grantPermissions", { origin: new URL(url).origin, permissions: ["windowManagement"] });
  }
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  watch(page, "presenter");
  await page.goto(url);
  await page.screenshot({ path: `${out}/start.png` });

  const state = () => page.evaluate(() => structuredClone(window.pdfpcnic.state));
  const press = async (...keys) => {
    for (const k of keys) {
      const [mod, key] = k.includes("+") && k.length > 1 ? k.split("+") : [null, k];
      if (mod) await page.keyboard.down(mod);
      await page.keyboard.press(key);
      if (mod) await page.keyboard.up(mod);
    }
    await new Promise((r) => setTimeout(r, 120));
  };
  const text = (sel) => page.$eval(sel, (e) => e.textContent);
  // For text the presenter redraws on the audience's fullscreenchange, which comes a frame after fullscreenElement.
  const textMatches = (sel, re) =>
    page.waitForFunction((sel, re) => new RegExp(re).test(document.querySelector(sel).textContent), { timeout: 5000 }, sel, re.source);
  const painted = (p, sel) =>
    p.$eval(sel, (c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < d.length; i += 4 * 97) {
        lo = Math.min(lo, d[i]);
        hi = Math.max(hi, d[i]);
      }
      return c.width > 0 && hi - lo > 40;
    });

  const input = await page.$("#files");

  await check(mode === "site" ? "the demo deck loads when asked for" : "the offline copy leaves the demo out", async () => {
    if (mode !== "site") {
      assert.equal(await page.$("#demo"), null);
      return;
    }
    const pdfs = [];
    page.on("request", (r) => r.url().endsWith(".pdf") && pdfs.push(r.url()));
    await page.click("#demo");
    await page.waitForFunction(() => window.pdfpcnic.deck?.pages.length === 10, { timeout: 20000 });
    assert.equal(pdfs.length, 1, "the demo PDF wasn't fetched once, on the click");
  });

  await page.evaluate(() => (window.shown = window.pdfpcnic.deck));
  // The audience window comes with the deck where the browser allows it. Here a script counts as a click, so it
  // always would: for the offline copy, the browser blocks it instead, as it does when no click or key came first.
  if (mode !== "site") await page.evaluate(() => ([window.allowed, window.open] = [window.open, () => null]));
  await input.uploadFile(resolve("demo/demo.pdf"), resolve("demo/demo.pdfpc"));
  await page.waitForFunction(() => window.pdfpcnic.deck && window.pdfpcnic.deck !== window.shown, { timeout: 20000 });

  await check("deck loads with pdfpc metadata", async () => {
    const d = await page.evaluate(() => ({
      pages: window.pdfpcnic.deck.pages.length,
      slides: window.pdfpcnic.deck.slides.length,
      end: window.pdfpcnic.deck.endSlide,
      hidden: window.pdfpcnic.deck.pages.filter((p) => p.hidden).map((p) => p.index),
    }));
    assert.deepEqual(d, { pages: 10, slides: 8, end: 6, hidden: [7] });
    assert.match(await text("#notes"), /Welcome/);
  });

  await check("current and next slides render", async () => {
    await page.waitForFunction(() => document.querySelector("#current canvas")?.width > 0);
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(await painted(page, "#current canvas"), "current slide is blank");
    assert.ok(await painted(page, "#next canvas"), "next slide is blank");
  });

  await page.screenshot({ path: `${out}/ready.png` });

  await check("timer starts on leaving the first slide", async () => {
    assert.equal((await state()).timer.startedAt, null);
    await press("ArrowRight");
    const s = await state();
    assert.equal(s.page, 1);
    assert.ok(s.timer.startedAt > 0);
  });

  await check("reveal steps: step forward, Shift+PageDown skips, back jumps to first step", async () => {
    await press("ArrowRight");
    assert.equal((await state()).page, 2);
    // Each step here has a window of its own; the talk bar spans all three.
    await press("ArrowRight");
    assert.equal(await page.$eval("#pace-slide", (e) => e.title), "This slide: planned 03:30–04:10, 40 s");
    await press("ArrowLeft");
    await press("Shift+PageDown");
    assert.equal((await state()).page, 5);
    await press("ArrowLeft");
    assert.equal((await state()).page, 2);
  });

  await check("hidden slide is skipped", async () => {
    await press("End");
    assert.equal((await state()).page, 8);
    assert.equal(await page.$eval("#next", (e) => e.classList.contains("backup")), true);
    await press("ArrowLeft");
    assert.equal((await state()).page, 6);
    await press("ArrowRight");
    assert.equal((await state()).page, 8);
    await press("ArrowLeft");
  });

  await page.screenshot({ path: `${out}/presenter.png` });

  if (mode !== "site") {
    await check("blocked, the window that comes with the deck is left to its button, with no error", async () => {
      assert.equal((await browser.pages()).length, 1, "a window opened");
      assert.match(await text("#audience-button"), /^Open audience window/);
      assert.equal(await page.$eval("#error", (e) => e.hidden), true);
    });
    await page.evaluate(() => (window.open = window.allowed));
  }
  const popupTarget = browser.waitForTarget((t) => t.opener() === page.target(), { timeout: 10000 });
  if (mode !== "site") await press("o");
  const audience = await (await popupTarget).page();
  watch(audience, "audience");
  await check(mode === "site" ? "the audience window opens with the deck and shows the slide" : "o opens the audience window, and it shows the slide", async () => {
    await audience.waitForFunction(() => document.querySelector("#stage canvas")?.width > 0, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(await painted(audience, "#stage canvas"), "audience slide is blank");
  });

  if (mode === "site") {
    await check("the audience opens on this screen; Shift+W makes it fullscreen on another, or where it was moved", async () => {
      const where = () => audience.evaluate(() => ({ x: screenX, w: outerWidth, full: !!document.fullscreenElement }));
      const full = (on) => audience.waitForFunction((on) => !!document.fullscreenElement === on, { timeout: 5000 }, on);
      assert.ok((await where()).x < 1440, "audience not on the presenter's screen");
      await textMatches("#audience-button", /^Audience fullscreen on /);
      await page.screenshot({ path: `${out}/audience-open.png` });
      await press("Shift+W");
      await full(true);
      assert.deepEqual(await where(), { x: 1440, w: 1920, full: true });
      await textMatches("#audience-status", /^Audience fullscreen on /);
      await audience.evaluate(() => document.exitFullscreen());
      await full(false);
      // Out of fullscreen, it stays on that screen rather than going back behind the presenter.
      await audience.waitForFunction(() => screen.availLeft === 1440, { timeout: 3000 });
      // Dragged to the third screen first: fullscreen there.
      await audience.evaluate(() => moveTo(3400, 50));
      await audience.waitForFunction(() => screen.availLeft === 3360);
      await press("Shift+W");
      await full(true);
      assert.deepEqual(await where(), { x: 3360, w: 1280, full: true });
      await audience.evaluate(() => document.exitFullscreen());
      await full(false);
    });
  }

  await check("Shift+W makes the audience fullscreen, pressed in either window, and so does its button", async () => {
    const exit = () => audience.evaluate(() => document.fullscreenElement && document.exitFullscreen());
    const shiftW = async (p) => {
      await p.keyboard.down("Shift");
      await p.keyboard.press("W");
      await p.keyboard.up("Shift");
    };
    const full = (on) => audience.waitForFunction((on) => !!document.fullscreenElement === on, { timeout: 3000 }, on);
    await exit();
    await audience.bringToFront();
    await shiftW(audience);
    await full(true);
    await exit();
    await page.bringToFront();
    await shiftW(page);
    await full(true);
    await textMatches("#audience-button", /^Exit audience fullscreen/);
    await page.click("#audience-button");
    await full(false);
    await page.click("#audience-button");
    await full(true);
    await exit();
  });

  await check("freeze holds the audience on its slide", async () => {
    await press("f", "ArrowRight");
    const s = await state();
    assert.equal(s.frozen, 6);
    assert.equal(s.page, 8);
    // Said over the current slide, and marked in the strip.
    assert.equal(await text("#audience-state strong"), "Audience frozen on slide 5");
    assert.equal(await page.$eval("#strip li.frozen .num", (e) => e.textContent), "5");
    await press("f");
    assert.equal((await state()).frozen, null);
  });

  await check("black screen covers the audience", async () => {
    await press("b");
    assert.equal(await audience.$eval("#black", (e) => e.hidden), false);
    assert.equal(await text("#audience-state strong"), "Audience screen is black");
    await press("b");
    assert.equal(await audience.$eval("#black", (e) => e.hidden), true);
    assert.equal(await page.$eval("#audience-state", (e) => e.hidden), true);
  });

  await check("laser follows the mouse onto the audience", async () => {
    await press("Home", "2");
    const box = await (await page.$("#current canvas")).boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await new Promise((r) => setTimeout(r, 150));
    const laser = await audience.$eval(".laser-dot", (e) => ({ hidden: e.hidden, left: e.offsetLeft, w: e.offsetWidth }));
    assert.equal(laser.hidden, false);
    const stage = await audience.$eval("#stage canvas", (c) => ({ left: c.offsetLeft, w: c.clientWidth }));
    assert.ok(Math.abs(laser.left + laser.w / 2 - (stage.left + stage.w / 2)) < 4, "laser not centered");
    await page.screenshot({ path: `${out}/laser.png` });
    await audience.screenshot({ path: `${out}/audience.png` });
    await press("1");
  });

  await check("overview opens with Tab, picks with arrows and Enter", async () => {
    await press("Tab");
    assert.equal(await page.$eval("#overview", (e) => e.hidden), false);
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: `${out}/overview.png` });
    await press("ArrowRight", "ArrowRight", "Enter");
    assert.equal(await page.$eval("#overview", (e) => e.hidden), true);
    assert.equal((await state()).page, 2);
  });

  await check("go to slide with g", async () => {
    await press("g");
    await page.keyboard.type("5");
    await press("Enter");
    assert.equal((await state()).page, 6);
    assert.match(await text("#notes"), /各位老师好/);
  });

  await check("a note's timing line becomes the pace panel", async () => {
    // Slide 5 of the demo plans 06:30 → 08:30, of a 10 minute talk planned to 09:30.
    assert.equal(await page.$eval("#pace-slide", (e) => e.title), "This slide: planned 06:30–08:30, 2:00");
    assert.equal(await page.$eval("#pace-all-text", (e) => e.title), "Where the talk ends at this pace. Planned to end at 09:30; target 10:00");
    assert.match(await page.$eval("#notes > :first-child", (e) => e.textContent), /^各位老师好/);
    const at = (s) => page.evaluate((s) => (window.pdfpcnic.state.timer = { startedAt: Date.now() - s * 1000, pausedAt: null, pausedFor: 0 }), s);
    const settle = () => new Promise((r) => setTimeout(r, 400));
    // Come back to the slide at `s` seconds into the talk, afresh: setting the
    // clock back first wipes each slide's time, as a reset would.
    const reach = async (s) => {
      await at(0);
      await settle();
      await press("Shift+PageUp");
      await at(s);
      await press("Shift+PageDown");
      await settle();
    };
    const cls = (sel) => page.$eval(sel, (e) => e.className);
    const fill = () => cls("#talkbar .spent");
    // All slides says where the talk would end if you moved on now. Reached
    // on time, with its two minutes ahead and the plan's 30 s of spare time:
    // moving on now would end 2:30 early.
    await reach(390);
    // Under the slide, just a line until you're seriously over.
    assert.equal(await text("#pace-slide-text"), "");
    assert.match(await text("#pace-all-text"), /^2:(29|30) early$/);
    assert.match(await cls("#pace-all-text"), /t-early/);
    assert.match(await fill(), /t-early/);
    // The line of time spent sits right under the slides, and runs on paler to
    // where the talk would end: 2:30 before the target, on a scale of 11:00.
    const line = await page.$eval("#talkbar", (bar) => {
      const b = bar.getBoundingClientRect();
      const r = (sel) => bar.querySelector(sel).getBoundingClientRect();
      return { gap: r(".spent").top - r(".seg").bottom, end: (r(".projected").right - b.left) / b.width };
    });
    assert.equal(line.gap, 0);
    assert.ok(Math.abs(line.end - 450 / 660) < 0.01, `projected end at ${line.end}`);
    assert.match(await cls("#talkbar .projected"), /t-early/);
    // A minute into its two: half the spoken characters dim, none of the *ref* paragraph.
    await at(450);
    await settle();
    // The edge fades: fully dim, then spoken-5 to spoken-1, each a sixth less.
    const dim = () =>
      page.evaluate(() => {
        const text = (name) => [...(CSS.highlights.get(name) ?? [])].map((r) => r.toString()).join("").replace(/\s/g, "");
        const said = ["spoken", ...[5, 4, 3, 2, 1].map((j) => `spoken-${j}`)].map(text);
        if (!said.join("")) return null;
        const first = document.querySelector("#notes-body p").textContent.replace(/\s/g, "");
        const share = said.reduce((n, t, k) => n + (t.length * (6 - k)) / 6, 0) / first.length;
        return { share, inFirst: first.startsWith(said.join("")) };
      });
    const half = await dim();
    assert.ok(half && Math.abs(half.share - 0.5) < 0.05 && half.inFirst, `notes dimmed: ${JSON.stringify(half)}`);
    // This slide's line moves on several times a second, not once, and stops with the clock.
    const widths = async () => {
      const seen = new Set();
      for (let i = 0; i < 10; i++) {
        seen.add(await page.$eval("#slide-fill", (e) => e.getBoundingClientRect().width));
        await new Promise((r) => setTimeout(r, 100));
      }
      return seen.size;
    };
    assert.ok((await widths()) >= 4, "the line moves in steps of a second");
    await press("p");
    assert.equal(await widths(), 1);
    await press("p");
    await press(",");
    await page.$eval("#set-dim", (e) => {
      e.value = 0;
      e.dispatchEvent(new Event("input"));
    });
    assert.equal(await dim(), null);
    await page.click("#set-defaults");
    await press("Escape");
    // Reached 1:30 into its window: moving on now ends a minute early, which
    // is within the minute of slack, so on time, which needs no words.
    await reach(480);
    assert.equal(await text("#pace-slide-text"), "");
    assert.equal(await text("#pace-all-text"), "");
    assert.match(await cls("#pace-all-text"), /t-on/);
    // 2:30 on it: the slide is 30 s over; the talk would end 1:30 late, serious
    // (the levels are 1 and 2 minutes).
    await at(630);
    await settle();
    assert.equal(await text("#pace-slide-text"), "");
    assert.match(await cls("#slide-fill"), /t-late/);
    assert.match(await text("#pace-all-text"), /^1:3\d late$/);
    assert.match(await cls("#pace-all-text"), /t-serious/);
    // 4:00 on it: two minutes over, very serious; the talk would end 3:00 late.
    await at(720);
    await settle();
    assert.match(await text("#pace-slide-text"), /^2:0\d over$/);
    assert.match(await cls("#pace-slide-text"), /t-severe/);
    assert.match(await text("#pace-all-text"), /^3:0\d late$/);
    assert.match(await fill(), /t-severe/);
    await page.screenshot({ path: `${out}/pace-late.png` });
    // A slide keeps its time over visits: on to the end slide for a minute and
    // back, it's still two minutes over, then counts on.
    await press("Shift+PageDown");
    await at(780);
    await press("Shift+PageUp");
    await at(790);
    await settle();
    assert.match(await text("#pace-slide-text"), /^2:1\d over$/);
    // A backup slide runs against its own length and isn't on the plan: the
    // talk would go on from slide 5, so the detour counts as late.
    await press("g");
    await page.keyboard.type("8");
    await press("Enter");
    await at(805);
    await settle();
    assert.equal(await page.$eval("#pace-slide", (e) => e.title), "This slide: 30 s, off the talk's plan");
    assert.match(await page.$eval("#notes > :first-child", (e) => e.textContent), /^Backup material/);
    const share = await page.$eval("#slide-fill", (e) => e.getBoundingClientRect().width / e.parentElement.getBoundingClientRect().width);
    assert.ok(Math.abs(share - 0.5) < 0.05, `backup line at ${share}`);
    assert.match(await text("#pace-all-text"), /^4:2\d late$/);
    // Back on slide 5, its own time picks up where it stopped.
    await press("Shift+Backspace");
    await settle();
    assert.match(await text("#pace-slide-text"), /^2:1\d over$/);
    // Fixed scale: 10:00 plus 10% room, so the target sits at 1/1.1 and the
    // last slide (08:30–09:30) where planned.
    const where = await page.$eval("#talkbar", (bar) => {
      const b = bar.getBoundingClientRect();
      const f = (e) => [(e.getBoundingClientRect().left - b.left) / b.width, (e.getBoundingClientRect().right - b.left) / b.width];
      const segs = [...bar.querySelectorAll(".seg")];
      return { target: f(bar.querySelector(".target")), last: f(segs.at(-1)) };
    });
    const near = (a, b) => Math.abs(a - b) < 0.01;
    assert.ok(near(where.target[0], 0.909), `target at ${where.target}`);
    assert.ok(near(where.last[0], 510 / 660) && near(where.last[1], 570 / 660), `last slide at ${where.last}`);
    // 50 s early: on time with a minute of slack, early with 5% (30 s here).
    await reach(490);
    assert.equal(await text("#pace-all-text"), "");
    await page.screenshot({ path: `${out}/pace.png` });
    await press(",");
    await page.click('#set-unit [data-unit="share"]');
    assert.match(await page.$eval("#set-early + output", (e) => e.textContent), /^\d+% \(/);
    await page.$eval("#set-early", (e) => {
      e.value = 5;
      e.dispatchEvent(new Event("input"));
    });
    assert.match(await cls("#pace-all-text"), /t-early/);
    await page.click("#set-defaults");
    assert.match(await cls("#pace-all-text"), /t-on/);
    assert.equal(await page.$eval('#set-unit [data-unit="time"]', (e) => e.classList.contains("on")), true);
    await press("Escape");
  });

  const cta = (sel) => page.$eval(sel, (e) => e.classList.contains("cta"));
  const ctaIs = (sel, on) => page.waitForFunction((sel, on) => document.querySelector(sel).classList.contains("cta") === on, { timeout: 5000 }, sel, on);

  await check("the clock, and the button under it, pause and resume the timer", async () => {
    assert.match(await text("#timer-toggle"), /^Pause/);
    await page.click("#timer");
    assert.ok((await state()).timer.pausedAt > 0);
    assert.match(await text("#timer-toggle"), /^Resume/);
    // One button stands out at a time: the audience's step first, then the clock's.
    assert.equal(await cta("#timer-toggle"), false);
    assert.equal(await cta("#audience-button"), true);
    await press("Shift+W");
    await ctaIs("#timer-toggle", true);
    assert.equal(await cta("#audience-button"), false);
    await page.click("#timer-toggle");
    assert.equal((await state()).timer.pausedAt, null);
    await page.click("#timer-toggle");
    assert.ok((await state()).timer.pausedAt > 0);
    await page.click("#timer");
    assert.equal((await state()).timer.pausedAt, null);
  });

  // Nothing under the clock comes and goes: the talk bar stays put whatever the clock does.
  const barTop = () => page.$eval("#talkbar", (e) => e.getBoundingClientRect().top);
  const runningTop = await barTop();

  await check("reset: Shift+R only while paused, the button with a second click while running", async () => {
    const running = (await state()).timer.startedAt;
    await press("Shift+R");
    assert.equal((await state()).timer.startedAt, running);
    await page.click("#timer-reset");
    assert.equal((await state()).timer.startedAt, running, "one click reset a running timer");
    assert.match(await text("#timer-reset"), /^Click again/);
    await page.click("#timer-reset");
    assert.equal((await state()).timer.startedAt, null);
    assert.equal(await text("#timer"), "0:00:00");
    assert.match(await text("#toast"), /next move/);
    assert.match(await text("#timer-toggle"), /^Start/);
    assert.equal(await cta("#timer-toggle"), true, "Start doesn't stand out before the talk");
    assert.equal(await page.$eval("#timer-reset", (e) => e.disabled), true);
    assert.equal(await barTop(), runningTop);
    await press("ArrowRight", "ArrowLeft");
    assert.ok((await state()).timer.startedAt > 0);
    await press("p");
    assert.equal(await barTop(), runningTop);
    await page.screenshot({ path: `${out}/paused.png` });
    await page.click("#timer-reset");
    assert.equal((await state()).timer.startedAt, null, "one click didn't reset a paused timer");
    await press("ArrowRight", "ArrowLeft");
    assert.ok((await state()).timer.startedAt > 0);
  });

  await check("back on slide 1 with time on the clock, Reset is offered", async () => {
    assert.equal(await cta("#timer-reset"), false);
    await press("Home");
    assert.match(await text("#toast"), /Reset it first/);
    assert.equal(await cta("#timer-reset"), true);
    assert.equal(await cta("#timer-toggle"), false);
    assert.equal(await barTop(), runningTop);
    await page.screenshot({ path: `${out}/stale-clock.png` });
    // The audience out of fullscreen: its button stands out instead.
    await audience.evaluate(() => document.exitFullscreen());
    await ctaIs("#timer-reset", false);
    assert.equal(await cta("#audience-button"), true);
    await press("g");
    await page.keyboard.type("5");
    await press("Enter");
    assert.equal((await state()).page, 6);
    assert.equal(await cta("#timer-reset"), false);
  });

  await check("an error stays, its text selectable, until closed", async () => {
    writeFileSync(`${out}/notes.txt`, "not a deck");
    await (await page.$("#files")).uploadFile(`${out}/notes.txt`);
    try {
      await page.waitForSelector("#error:not([hidden])");
      assert.equal(await text("#error-text"), "notes.txt is neither a PDF nor a .pdfpc file.");
      assert.equal(await page.$eval("#error", (e) => getComputedStyle(e).pointerEvents), "auto");
      // A note comes and goes under it; the error outlasts it.
      await press("Home");
      await new Promise((r) => setTimeout(r, 5000));
      assert.equal(await page.$eval("#error", (e) => e.hidden), false);
      await page.screenshot({ path: `${out}/error.png` });
    } finally {
      await page.click("#error-close");
      assert.equal(await page.$eval("#error", (e) => e.hidden), true);
      await press("g");
      await page.keyboard.type("5");
      await press("Enter");
      assert.equal((await state()).page, 6);
    }
  });

  await check("[ and ] trade current-slide size for room for notes", async () => {
    const box = () => page.$eval("#current", (e) => e.getBoundingClientRect().height);
    const notes = () => page.$eval("#notes", (e) => e.getBoundingClientRect().height);
    const [before, room] = [await box(), await notes()];
    await press("[");
    assert.ok((await box()) < before && (await notes()) > room, "[ didn't shrink the slide");
    await press("]");
    assert.equal(await box(), before);
  });

  await check("settings: slide and notes sizes, and back to defaults", async () => {
    await page.click('.toolbar [data-action="settings"]');
    assert.equal(await page.$eval("#settings", (e) => e.open), true);
    assert.equal(await page.$eval("#set-stage + output", (e) => e.textContent), "100%");
    const width = () => page.$eval("#current", (e) => e.getBoundingClientRect().width);
    const before = await width();
    const set = (id, v) =>
      page.$eval(id, (e, v) => {
        e.value = v;
        e.dispatchEvent(new Event("input"));
      }, v);
    await set("#set-stage", 70);
    await set("#set-notes", 30);
    assert.ok(Math.abs((await width()) / before - 0.7) < 0.02, "slide didn't shrink to 70%");
    assert.equal(await page.$eval("#notes", (e) => getComputedStyle(e).fontSize), "30px");
    // Keys belong to the dialog while it's open.
    await press("ArrowRight");
    assert.equal((await state()).page, 6);
    await page.click("#set-defaults");
    assert.equal(await width(), before);
    await press("Escape");
    assert.equal(await page.$eval("#settings", (e) => e.open), false);
  });

  await check("drag handles: the slide against its notes, and the thumbnails", async () => {
    const drag = async (sel, dx, dy) => {
      const b = await (await page.$(sel)).boundingBox();
      const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 5 });
      await page.mouse.up();
    };
    const height = () => page.$eval("#current", (e) => e.getBoundingClientRect().height);
    // This slide's line lies along the slide's foot, edge to edge, at any size.
    const flush = async () => {
      await new Promise((r) => setTimeout(r, 100));
      const [c, t] = await page.evaluate(() =>
        ["#current canvas", ".slidebar-track"].map((s) => document.querySelector(s).getBoundingClientRect().toJSON()),
      );
      for (const k of ["left", "right"]) assert.equal(t[k], c[k], `the line's ${k} edge isn't the slide's`);
      assert.equal(t.top, c.bottom, "the line doesn't touch the slide");
    };
    await flush();
    const before = await height();
    await drag("#stage-split", 0, -80);
    assert.ok((await height()) < before - 40, "the slide didn't shrink");
    await flush();
    await drag("#stage-split", 0, 200);
    assert.equal(await height(), before);
    const strip = () => page.$eval("#strip", (e) => (e.hidden ? 0 : e.getBoundingClientRect().width));
    const wide = await strip();
    await drag("#strip-split", -60, 0);
    assert.ok((await strip()) > wide + 40, "the thumbnails didn't widen");
    await page.click("#strip-split", { count: 2 });
    assert.equal(await strip(), 0);
    await page.click("#strip-split", { count: 2 });
    assert.ok((await strip()) > wide + 40, "the thumbnails didn't come back at their width");
  });

  await check("help sheet", async () => {
    await press("?");
    assert.equal(await page.$eval("#help", (e) => e.hidden), false);
    await page.screenshot({ path: `${out}/help.png` });
    await press("Escape");
    assert.equal(await page.$eval("#help", (e) => e.hidden), true);
  });

  await check("a reload offers to resume at the same page with the timer", async () => {
    // The demo deck isn't kept; load it as a user would, then reload.
    await input.uploadFile(resolve("demo/demo.pdf"), resolve("demo/demo.pdfpc"));
    await page.waitForFunction(() => window.pdfpcnic.state?.page === 0);
    await press("ArrowRight", "ArrowRight");
    await new Promise((r) => setTimeout(r, 600));
    const before = await state();
    await page.reload();
    await page.waitForSelector("#resume:not([hidden])");
    assert.match(await text("#resume"), /demo\.pdf at page 3/);
    await page.click("#resume");
    await page.waitForFunction(() => window.pdfpcnic.state);
    const after = await state();
    assert.equal(after.page, 2);
    assert.equal(after.timer.startedAt, before.timer.startedAt);
  });

  await check("links on the slide: outlined for the presenter, jump in either window, back returns", async () => {
    writeFileSync(`${out}/links.pdf`, pdfWithLinks());
    await (await page.$("#files")).uploadFile(`${out}/links.pdf`);
    await page.waitForFunction(() => window.pdfpcnic.deck?.name === "links.pdf", { timeout: 20000 });
    const links = "#current .slide-links a";
    await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 3, { timeout: 5000 }, links);
    const box = await (await page.$("#current canvas")).boundingBox();
    const first = await (await page.$(links)).boundingBox();
    // The first link covers x 50–250 of the 800 pt wide page.
    assert.ok(Math.abs(first.x - (box.x + box.width / 16)) < 2 && Math.abs(first.width - box.width / 4) < 2, "link box off the slide's");
    const look = await page.$eval(links, (a) => ({ outline: getComputedStyle(a).outlineStyle, border: getComputedStyle(a.parentElement).borderTopWidth }));
    assert.deepEqual(look, { outline: "solid", border: "0px" }, "the presenter's outline, without the PDF's red border");
    const web = await page.$eval(`${links}[href^="https:"]`, (a) => ({ href: a.href, target: a.target }));
    assert.deepEqual(web, { href: "https://example.com/", target: "_blank" });
    await page.hover(links);
    await page.screenshot({ path: `${out}/links.png` });
    const clickLink = async (p, i) => {
      await p.waitForFunction((i) => document.querySelectorAll(".slide-links a")[i], { timeout: 5000 }, i);
      await (await p.$$(".slide-links a"))[i].click();
      await new Promise((r) => setTimeout(r, 400));
    };
    await clickLink(page, 0);
    let s = await state();
    assert.equal(s.page, 2, "the link to page 3 didn't land there (or the click also stepped on)");
    assert.deepEqual(s.back, [0]);
    await press("Shift+Backspace");
    assert.equal((await state()).page, 0);
    await clickLink(page, 1);
    assert.equal((await state()).page, 3, "the named destination didn't land on page 4");
    await press("Home");
    // The same in the audience window, unmarked. The presenter has reloaded since it opened the window: the
    // site takes the window back, the offline file (a new origin each load) replaces it.
    await press("o");
    await new Promise((r) => setTimeout(r, 1000));
    const popup = (await browser.pages()).filter((p) => p !== page).at(-1);
    if (popup !== audience) watch(popup, "audience");
    assert.equal(popup === audience, mode === "site", "the audience window wasn't taken back (site) or replaced (offline file)");
    await popup.waitForFunction(() => document.querySelectorAll(".slide-links a").length === 3, { timeout: 10000 });
    assert.equal(await popup.$eval(".slide-links a", (a) => getComputedStyle(a).outlineStyle), "none");
    await clickLink(popup, 0);
    s = await state();
    assert.equal(s.page, 2, "a link clicked in the audience window didn't jump");
  });

  await check("Forget drops the kept deck", async () => {
    await page.reload();
    await page.waitForSelector("#forget:not([hidden])");
    await page.click("#forget");
    assert.equal(await page.$("#resume"), null);
    await new Promise((r) => setTimeout(r, 300));
    await page.reload();
    await page.waitForSelector("#files");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await page.$eval("#resume", (e) => e.hidden), true);
  });

  if (mode === "site") {
    await check("a PDF without embedded fonts gets pdf.js's CMaps and fonts from the site", async () => {
      const fetched = new Map();
      page.on("response", (r) => r.url().includes("/pdfjs/") && fetched.set(r.url().split("/pdfjs/")[1], r.status()));
      writeFileSync(`${out}/no-fonts.pdf`, pdfWithoutFonts());
      await (await page.$("#files")).uploadFile(`${out}/no-fonts.pdf`);
      await page.waitForFunction(() => window.pdfpcnic.deck?.name === "no-fonts.pdf", { timeout: 20000 });
      await page.waitForFunction(() => document.querySelector("#current canvas")?.width > 0);
      await new Promise((r) => setTimeout(r, 1000));
      assert.equal(fetched.get("cmaps/UniGB-UCS2-H.bcmap"), 200, `fetched: ${JSON.stringify([...fetched])}`);
      assert.ok(await painted(page, "#current canvas"), "the slide is blank");
      await page.screenshot({ path: `${out}/no-fonts.png` });
    });
  } else {
    await check("the offline copy carries the licenses", async () => {
      const html = readFileSync("dist/pdfpcnic.html", "utf8");
      for (const name of ["MIT License", "pdfjs-dist", "marked", "dompurify"]) assert.ok(html.includes(name), name);
    });
  }

  await check("hidden behind another tab, the presenter still draws slides for the audience", async () => {
    const other = await browser.newPage();
    try {
      await other.bringToFront();
      assert.equal(await page.evaluate(() => document.visibilityState), "hidden");
      // pdf.js draws in animation-frame steps, which a hidden tab doesn't get.
      const step = () => new Promise((r) => (requestAnimationFrame(() => r(true)), setTimeout(() => r(false), 2000)));
      assert.equal(await page.evaluate(step), true);
    } finally {
      await other.close();
      await page.bringToFront();
    }
  });

  await check("no errors in either window", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server?.close();
}
console.log(`${passed} checks passed (${mode}); screenshots in ${out}`);

/**
 * Four pages of colored boxes; the first links to page 3 (an explicit
 * destination, with a hyperref-style red border), to page 4 (a named
 * destination) and to a web page.
 */
function pdfWithLinks() {
  const colors = ["0.2 0.4 0.8", "0.8 0.3 0.2", "0.2 0.7 0.3", "0.6 0.3 0.7"];
  const pages = colors.map((_, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 450] /Contents ${7 + i} 0 R${i === 0 ? " /Annots [11 0 R 12 0 R 13 0 R]" : ""} >>`);
  const contents = colors.map((c) => {
    const ops = `${c} rg 0 0 800 450 re f 1 1 1 rg 50 300 200 100 re f 300 300 200 100 re f 550 300 200 100 re f`;
    return `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`;
  });
  return pdfFrom([
    "<< /Type /Catalog /Pages 2 0 R /Names << /Dests << /Names [(four) [6 0 R /Fit]] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R] /Count 4 >>",
    ...pages,
    ...contents,
    "<< /Type /Annot /Subtype /Link /Rect [50 300 250 400] /Border [0 0 2] /C [1 0 0] /Dest [5 0 R /Fit] >>",
    "<< /Type /Annot /Subtype /Link /Rect [300 300 500 400] /Border [0 0 0] /A << /S /GoTo /D (four) >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [550 300 750 400] /Border [0 0 0] /A << /S /URI /URI (https://example.com/) >> >>",
  ]);
}

/** A PDF file of these objects, numbered from 1, the first being the catalog. */
function pdfFrom(objects) {
  let pdf = "%PDF-1.7\n";
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

/** A one-page PDF whose text uses fonts it doesn't embed: Chinese in STSong-Light through a predefined CMap, and Helvetica. */
function pdfWithoutFonts() {
  const text = "BT /F1 40 Tf 80 300 Td <4F60597D002000500044004600200043004D00610070> Tj ET BT /F2 32 Tf 80 200 Td (Helvetica, not embedded) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 450] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor << /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >> >>] >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
