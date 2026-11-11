// WebKit check: the main path through both builds, in Playwright's WebKit on Linux, the closest a check here comes to
// Safari. It isn't Safari: the system's graphics, fonts and windows differ. The full suite (scripts/e2e.mjs) runs in
// Chrome; this one covers what a Safari presenter relies on: loading a deck, drawing it at once, keys, the clock and
// pace, the display kept awake, the text fitting, and an audience window placed by hand.
//
//   npx playwright-core install --with-deps webkit
//   npm run e2e:webkit

import assert from "node:assert/strict";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { webkit } from "playwright-core";

const out = resolve("e2e-out", "webkit");
mkdirSync(out, { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  const path = join(resolve("dist"), decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "index.html") : path;
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const builds = {
  site: `http://127.0.0.1:${server.address().port}/`,
  single: pathToFileURL(resolve("dist/pdfpcnic.html")).href,
};

const browser = await webkit.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  for (const [build, url] of Object.entries(builds)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 810 } });
    // The real wake lock, with a note of each one asked for.
    await context.addInitScript(() => {
      window.wakeLocks = [];
      const request = WakeLock.prototype.request;
      WakeLock.prototype.request = async function (type) {
        const lock = await request.call(this, type);
        window.wakeLocks.push(lock);
        return lock;
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
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
    const text = (sel) => page.$eval(sel, (e) => e.textContent);
    await page.goto(url);

    let audience;
    await check(`${build}: the deck loads and draws, and the audience window opens with it`, async () => {
      await page.setInputFiles("#files", [resolve("demo/demo.pdf"), resolve("demo/demo.pdfpc")]);
      await page.waitForSelector("#ready:not([hidden])", { timeout: 30000 });
      [audience] = await Promise.all([context.waitForEvent("page", { timeout: 10000 }), page.click("#present")]);
      await page.waitForFunction(() => window.pdfpcnic.state, null, { timeout: 30000 });
      assert.equal(await page.evaluate(() => window.pdfpcnic.deck.slides.length), 8);
      await page.waitForFunction(() => document.querySelector("#next canvas")?.width > 0, null, { timeout: 30000 });
      await sleep(1500);
      assert.ok(await painted(page, "#current canvas"), "current slide is blank");
      assert.ok(await painted(page, "#next canvas"), "next slide is blank");
      assert.match(await text("#notes"), /Welcome/);
      // Only the audience window can make itself fullscreen here: the guide explains the extra step.
      await page.waitForFunction(() => /^Drag the audience window to the projector, then double-click it/.test(document.querySelector("#guide").textContent), null, { timeout: 5000 });
      assert.equal(await text("#audience-button"), "Projector");
    });

    await check(`${build}: keys step through, the clock runs, pace shows, and the audience follows`, async () => {
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.evaluate(() => window.pdfpcnic.state.page), 0);
      assert.ok(await page.evaluate(() => window.pdfpcnic.state.timer.startedAt));
      await page.keyboard.press("ArrowRight");
      await sleep(2200);
      assert.equal(await page.evaluate(() => window.pdfpcnic.state.page), 1);
      assert.match(await text("#timer"), /^0:00:0[1-3]$/);
      assert.match(await text("#finish"), /^\d+:\d\d(:\d\d)?$/);
      await page.keyboard.press("ArrowRight");
      await sleep(1000);
      assert.equal(await page.evaluate(() => window.pdfpcnic.state.page), 2);
      assert.ok(await painted(audience, "canvas"), "audience slide is blank");
    });

    await check(`${build}: a key press in either window keeps the display awake`, async () => {
      const held = (p) => p.evaluate(() => window.wakeLocks.filter((l) => !l.released).length);
      assert.equal(await held(page), 1, "in the presenter");
      await audience.keyboard.press("ArrowLeft");
      await sleep(300);
      assert.equal(await held(audience), 1, "in the audience window");
      await page.bringToFront();
      await page.keyboard.press("ArrowRight");
    });

    await check(`${build}: the clock's row fits as times of day, and a long guide line wraps, moving nothing`, async () => {
      await page.keyboard.press("t");
      await sleep(300);
      assert.match(await text("#timer"), /^\d{1,2}:\d\d [AP]M$/);
      const row = await page.$eval(".clock", (e) => [e.scrollWidth, e.clientWidth]);
      assert.ok(row[0] <= row[1], `the clock's row overflows: ${row}`);
      await page.keyboard.press("t");
      const wrapped = await page.evaluate(() => {
        const guide = document.querySelector("#guide");
        const at = () => ["#timer", ".foot"].map((s) => document.querySelector(s).getBoundingClientRect().top).join();
        const [before, height, was] = [at(), guide.offsetHeight, guide.textContent];
        guide.textContent = "A line far too long for its column. ".repeat(6);
        const result = { same: at() === before, taller: guide.offsetHeight > height };
        guide.textContent = was;
        return result;
      });
      assert.deepEqual(wrapped, { same: true, taller: true });
    });

    await check(`${build}: scrolling the thumbnails with the mouse still, the outline follows; leaving, they go at once`, async () => {
      const strip = page.locator("#strip");
      const { width, height } = page.viewportSize();
      await page.mouse.move(width / 2, height / 2);
      await page.mouse.move(width - 3, height / 2);
      await page.waitForFunction(() => document.querySelector("#strip").getBoundingClientRect().left < innerWidth - 100);
      await strip.evaluate((s) => (s.scrollTop = 0));
      const box = await page.locator("#strip li:not(.divider)").first().boundingBox();
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.move(x, y);
      assert.equal(await page.$$eval("#strip li.hover", (ls) => ls.length), 1);
      // With no input in between: the mark follows what's under the mouse, a thumbnail or (they load as they scroll in) none.
      const seen = await strip.evaluate(async (s, [x, y]) => {
        const name = (li) => li?.querySelector(".num").textContent ?? null;
        const was = name(s.querySelector("li.hover"));
        s.scrollTop = 200;
        const frames = [];
        for (let i = 0; i < 12; i++) {
          await new Promise(requestAnimationFrame);
          frames.push([name(s.querySelector("li.hover")), name(document.elementFromPoint(x, y)?.closest("li:not(.divider)"))]);
        }
        return { was, frames };
      }, [x, y]);
      assert.ok(seen.frames.some(([mark, under]) => mark === under && under !== seen.was), JSON.stringify(seen));
      await page.mouse.move(width / 2, height - 5);
      assert.ok(await strip.evaluate((e) => e.getBoundingClientRect().left >= innerWidth - 1), "the thumbnails lingered");
      assert.equal(await page.$$eval("#strip li.hover", (ls) => ls.length), 0);
    });

    await check(`${build}: the help fits its window`, async () => {
      await page.keyboard.press("?");
      await sleep(200);
      assert.deepEqual(await page.$$eval("#help-grid h3", (hs) => hs.map((h) => h.textContent)), ["Move", "Audience", "Presenter"]);
      assert.ok(await page.$eval(".help-card", (e) => e.scrollHeight <= e.clientHeight), "the help scrolls");
      await page.screenshot({ path: `${out}/${build}-help.png` });
      await page.keyboard.press("Escape");
    });

    await page.screenshot({ path: `${out}/${build}.png` });
    await audience?.screenshot({ path: `${out}/${build}-audience.png` });
    await check(`${build}: no errors`, async () => assert.deepEqual(errors, []));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`${passed} checks passed (webkit); screenshots in ${out}`);
