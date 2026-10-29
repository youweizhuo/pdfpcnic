// Firefox check: the main path through both builds. The full suite (scripts/e2e.mjs)
// runs in Chrome; this one covers what a Firefox presenter relies on: loading a
// deck, drawing it, keys, the clock and pace, and an audience window placed by hand.
//
//   FIREFOX_PATH=/path/to/firefox npm run e2e:firefox

import assert from "node:assert/strict";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./launch.mjs";

const firefox = process.env.FIREFOX_PATH;
if (!firefox) {
  console.error("Set FIREFOX_PATH to a Firefox binary.");
  process.exit(2);
}
const out = resolve("e2e-out", "firefox");
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

const browser = await launch({
  browser: "firefox",
  executablePath: firefox,
  headless: true,
  defaultViewport: { width: 1440, height: 810 },
});
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
    const page = await browser.newPage();
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
    await page.goto(url);

    await check(`${build}: the deck loads and draws`, async () => {
      await (await page.$("#files")).uploadFile(resolve("demo/demo.pdf"), resolve("demo/demo.pdfpc"));
      await page.waitForSelector("#ready:not([hidden])", { timeout: 20000 });
      await page.click("#present");
      await page.waitForFunction(() => window.pdfpcnic.state, { timeout: 20000 });
      assert.equal(await page.evaluate(() => window.pdfpcnic.deck.slides.length), 8);
      await page.waitForFunction(() => document.querySelector("#next canvas")?.width > 0);
      await sleep(800);
      assert.ok(await painted(page, "#current canvas"), "current slide is blank");
      assert.ok(await painted(page, "#next canvas"), "next slide is blank");
      assert.match(await page.$eval("#notes", (e) => e.textContent), /Welcome/);
      // Until the talk starts, the line under the bar says what to do with the audience window.
      await page.waitForFunction(() => /^Drag the audience window to the projector, then double-click it/.test(document.querySelector("#guide").textContent), { timeout: 5000 });
    });

    await check(`${build}: keys step through, the clock runs, pace shows`, async () => {
      await page.keyboard.press("ArrowRight");
      await sleep(2200);
      assert.equal(await page.evaluate(() => window.pdfpcnic.state.page), 1);
      assert.match(await page.$eval("#timer", (e) => e.textContent), /^0:00:0[12]$/);
      assert.match(await page.$eval("#finish", (e) => e.textContent), /^\d+:\d\d(:\d\d)?$/);
      assert.equal(await page.evaluate(() => typeof CSS.highlights), "object");
    });

    await check(`${build}: the audience window opens with the deck and follows`, async () => {
      const pages = await browser.pages();
      const audience = pages.at(-1);
      assert.notEqual(audience, page, "no audience window");
      // Only the audience window can make itself fullscreen here, so no Shift+W: the button says what to do.
      assert.equal(await page.$eval("#audience-button", (e) => e.textContent), "Double-click the audience window");
      await page.keyboard.press("ArrowRight");
      await sleep(800);
      assert.equal(await page.evaluate(() => window.pdfpcnic.state.page), 2);
      assert.ok(await painted(audience, "canvas"), "audience slide is blank");
      // Shift+W pressed here anyway says the same.
      await page.bringToFront();
      await page.keyboard.down("Shift");
      await page.keyboard.press("W");
      await page.keyboard.up("Shift");
      await page.waitForFunction(() => /can.t make it fullscreen from here: double-click the audience window/.test(document.querySelector("#guide").textContent));
      assert.equal(await page.$eval("#error", (e) => e.hidden), true);
      await page.screenshot({ path: `${out}/${build}-ask.png` });
      await audience.screenshot({ path: `${out}/${build}-audience.png` });
      await audience.close();
      // The presenter hears of it at once, and offers to open it again.
      await page.waitForFunction(() => /^Open audience window/.test(document.querySelector("#audience-button").textContent), { timeout: 300 });
    });

    await page.screenshot({ path: `${out}/${build}.png` });
    await check(`${build}: no errors`, async () => assert.deepEqual(errors, []));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`${passed} checks passed (firefox); screenshots in ${out}`);
