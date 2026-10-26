// End-to-end check in a real Chrome: loads the demo deck, walks through
// navigation, the audience window, freeze, black, laser, overview, go-to and
// resume, and saves screenshots to e2e-out/.
//
//   CHROME_PATH=/path/to/chrome npm run e2e            # single file over file://
//   CHROME_PATH=/path/to/chrome npm run e2e -- site    # site build over http
//   CHROME_PATH=/path/to/chrome npm run e2e -- https://youweizhuo.github.io/pdfpcnic/

import assert from "node:assert/strict";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

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
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
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

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  // Two screens: a laptop and a projector to its right.
  args: ["--no-sandbox", "--window-size=1440,900", "--screen-info={0,0 1440x900}{1440,0 1920x1080}"],
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
  await input.uploadFile(resolve("demo/demo.pdf"), resolve("demo/demo.pdfpc"));
  await page.waitForFunction(() => window.pdfpcnic.state, { timeout: 20000 });

  await check("deck loads with pdfpc metadata", async () => {
    const d = await page.evaluate(() => ({
      pages: window.pdfpcnic.deck.pages.length,
      slides: window.pdfpcnic.deck.slides.length,
      end: window.pdfpcnic.deck.endSlide,
      hidden: window.pdfpcnic.deck.pages.filter((p) => p.hidden).map((p) => p.index),
    }));
    assert.deepEqual(d, { pages: 10, slides: 8, end: 6, hidden: [7] });
    assert.match(await text("#notes"), /Welcome/);
    assert.equal(await text("#counter"), "1/7");
  });

  await check("current and next slides render", async () => {
    await page.waitForFunction(() => document.querySelector("#current canvas")?.width > 0);
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(await painted(page, "#current canvas"), "current slide is blank");
    assert.ok(await painted(page, "#next canvas"), "next slide is blank");
  });

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
    assert.match(await text("#counter-sub"), /step 1\/3/);
    // Each step here has a window of its own; the talk bar spans all three.
    await press("ArrowRight");
    assert.equal(await page.$eval("#pace-slide", (e) => e.title), "Planned 03:30–04:10");
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

  const popupTarget = browser.waitForTarget((t) => t.opener() === page.target(), { timeout: 10000 });
  await press("o");
  const audience = await (await popupTarget).page();
  watch(audience, "audience");
  await check("audience window opens and shows the slide", async () => {
    await audience.waitForFunction(() => document.querySelector("#stage canvas")?.width > 0, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(await painted(audience, "#stage canvas"), "audience slide is blank");
  });

  if (mode === "site") {
    await check("window placement puts the audience on the second screen; the next key makes it fullscreen", async () => {
      const where = await audience.evaluate(() => ({ x: screenX, w: outerWidth }));
      assert.ok(where.x >= 1440, `audience at x=${where.x}`);
      assert.equal(where.w, 1920);
      assert.match(await text("#audience-status"), /next key press/);
      await press("ArrowRight", "ArrowLeft");
      await audience.waitForFunction(() => !!document.fullscreenElement, { timeout: 5000 });
      assert.match(await text("#audience-status"), /fullscreen on/);
    });
  }

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
    assert.equal(await page.$eval("#pace-slide", (e) => e.title), "Planned 06:30–08:30");
    assert.equal(await page.$eval("#pace-all", (e) => e.title), "Planned to end at 09:30; target 10:00");
    assert.match(await page.$eval("#notes > :first-child", (e) => e.textContent), /^各位老师好/);
    const at = (s) => page.evaluate((s) => (window.pdfpcnic.state.timer = { startedAt: Date.now() - s * 1000, pausedAt: null, pausedFor: 0 }), s);
    const fill = () => page.$eval("#talkbar .spent", (e) => e.className);
    const cls = (sel) => page.$eval(sel, (e) => e.className);
    // A minute behind on this slide, 10% of the talk: very serious. The talk
    // ends 30 s past 10:00, 5%: serious (the levels are 3% and 6%).
    await at(570);
    await new Promise((r) => setTimeout(r, 400));
    assert.match(await text("#pace-slide-text"), /^1:0\d over$/);
    assert.match(await cls("#pace-slide-text"), /t-severe/);
    assert.match(await text("#pace-all-text"), /^3\d s late$/);
    assert.match(await cls("#pace-all-text"), /t-serious/);
    assert.match(await fill(), /t-severe/);
    await page.screenshot({ path: `${out}/pace-late.png` });
    // On time: the plan's 30 s of spare time stands.
    await at(420);
    await new Promise((r) => setTimeout(r, 400));
    assert.match(await text("#pace-slide-text"), /^1:[23]\d left$/);
    // 30 s early is within the 5% that passes without a color.
    assert.equal(await text("#pace-all-text"), "30 s early");
    assert.match(await cls("#pace-all-text"), /t-on/);
    assert.match(await fill(), /t-on/);
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
    await page.screenshot({ path: `${out}/pace.png` });
    // With no slack for early in Settings, it shows.
    await press(",");
    await page.$eval("#set-early", (e) => {
      e.value = 0;
      e.dispatchEvent(new Event("input"));
    });
    assert.match(await cls("#pace-all-text"), /t-early/);
    await page.click("#set-defaults");
    assert.match(await cls("#pace-all-text"), /t-on/);
    await press("Escape");
    // A minute and a half early on this slide is well ahead.
    await at(300);
    await new Promise((r) => setTimeout(r, 400));
    assert.match(await text("#pace-slide-text"), /^1:3\d early$/);
    assert.match(await cls("#pace-slide-text"), /t-early/);
  });

  await check("clicking the clock pauses and resumes the timer", async () => {
    await page.click("#timer");
    assert.ok((await state()).timer.pausedAt > 0);
    assert.match(await text("#timer-mode"), /paused/);
    await page.click("#timer");
    assert.equal((await state()).timer.pausedAt, null);
  });

  await check("the timer resets only while paused", async () => {
    const running = (await state()).timer.startedAt;
    await press("Shift+R");
    assert.equal((await state()).timer.startedAt, running);
    assert.equal(await page.$eval("#timer-reset", (e) => e.hidden), true);
    await press("p");
    await page.click("#timer-reset");
    assert.equal((await state()).timer.startedAt, null);
    assert.equal(await text("#timer"), "0:00:00");
    assert.match(await text("#timer-mode"), /next move/);
    await press("ArrowRight", "ArrowLeft");
    assert.ok((await state()).timer.startedAt > 0);
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

  await check("no errors in either window", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server?.close();
}
console.log(`${passed} checks passed (${mode}); screenshots in ${out}`);
