// Deck-server check: nginx's two ports and the upload page, as they're deployed. Uploads go through the page on the
// private port, and decks open with no password from the public port's own site and from another origin, as GitHub
// Pages or the Mac app would, in Chrome and WebKit.
//
//   deploy/deploy.sh
//   npm run build
//   CHROME_PATH=/path/to/chrome npm run e2e:decks
//
// DECKS_VIEW and DECKS_UPLOAD say where the two ports are, if not on deploy.sh's defaults. NO_HTTPS=webkit skips what
// needs HTTPS in that engine, where this machine's WebKit has none.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

const view = process.env.DECKS_VIEW ?? "http://127.0.0.1:28613/";
const upload = process.env.DECKS_UPLOAD ?? "http://127.0.0.1:28614/";
const out = resolve("e2e-out", "decks");
mkdirSync(out, { recursive: true });

// The site as GitHub Pages serves it: another origin. The check's local server stands in for an HTTPS one.
const pages = resolve(out, "pages");
execFileSync("npx", ["vite", "build", "--outDir", pages, "--logLevel", "error"], { env: { ...process.env, PDFPCNIC_CHECK_SERVER: new URL(view).origin }, stdio: "inherit" });
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  const path = join(pages, decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "index.html") : path;
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const elsewhere = `http://localhost:${server.address().port}/`;

const pdf = readFileSync("demo/demo.pdf");
const notes = readFileSync("demo/demo.pdfpc");
const LONG = "A Very Long File Name, the Final Version";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onView = (path, init) => fetch(new URL(path, view), init);
const onUpload = (path, init) => fetch(new URL(path, upload), init);

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

const seed = "zzzzz3";
await check("the upload port takes a new file, and nothing else", async () => {
  const at = `decks/${seed}/check.pdf`;
  assert.equal((await onUpload(at, { method: "PUT", body: pdf })).status, 201, "a new deck");
  assert.equal((await onUpload(at, { method: "PUT", body: "x" })).status, 409, "over a deck");
  assert.deepEqual(Buffer.from(await (await onView(at)).arrayBuffer()), pdf, "the deck after that");
  assert.equal((await onUpload(at, { method: "DELETE" })).status, 403, "a delete");
  assert.equal((await onUpload(`decks/${seed}/`, { method: "DELETE" })).status, 403, "a folder's delete");
  assert.equal((await onUpload(at, { method: "MOVE", headers: { destination: new URL(`decks/${seed}/x.pdf`, upload).href } })).status, 403, "a rename");
  assert.equal((await onUpload(at, { method: "POST", body: "x" })).status, 403, "a post");
  assert.equal((await onUpload(`decks/${seed}/page.html`, { method: "PUT", body: "<script>" })).status, 404, "another kind of file");
  assert.equal((await onUpload("index.html", { method: "PUT", body: "x" })).status, 403, "over the page");
});

await check("the public port only reads, and never lists", async () => {
  const at = `decks/${seed}/check.pdf`;
  assert.equal((await onView(at)).status, 200);
  for (const method of ["PUT", "POST", "PATCH"]) assert.equal((await onView(at, { method, body: "x" })).status, 403, method);
  assert.equal((await onView(`decks/${seed}/new.pdf`, { method: "PUT", body: "x" })).status, 403, "a new file");
  assert.equal((await onView(at, { method: "DELETE" })).status, 403, "a delete");
  assert.equal((await onView(at, { method: "MOVE", headers: { destination: new URL(`decks/${seed}/x.pdf`, view).href } })).status, 403, "a rename");
  assert.equal((await onView("decks/")).status, 404, "the list of decks");
  assert.equal((await onView("public-url")).status, 404, "the upload side's files");
  assert.equal(await (await onView("upload.js")).status, 404, "the upload page");
  assert.equal((await onView("decks/aaaaaa/")).status, 404, "a wrong token");
  assert.notEqual((await onView("decks/../../etc/passwd.pdf")).status, 200, "out of the folder");
});

await check("a deck comes to any origin, and no cache keeps it", async () => {
  const res = await onView(`decks/${seed}/check.pdf`);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const list = await onView(`decks/${seed}/`);
  assert.equal(list.headers.get("access-control-allow-origin"), "*");
  assert.equal(list.headers.get("cache-control"), "no-store");
  assert.equal((await onView("index.html")).headers.get("access-control-allow-origin"), null, "the site stays its own");
});

await check("guessing tokens is slowed down, for each visitor", async () => {
  const guess = (who) =>
    Promise.all(Array.from({ length: 40 }, (_, i) => onView(`decks/aaaa${String.fromCharCode(97 + (i % 26))}${(i % 8) + 2}/`, { headers: { "cf-connecting-ip": who } }).then((r) => r.status)));
  const codes = await guess("203.0.113.7");
  assert.ok(codes.includes(429), `no 429 in ${codes}`);
  assert.equal((await onView(`decks/${seed}/`, { headers: { "cf-connecting-ip": "203.0.113.8" } })).status, 200, "another visitor");
  await sleep(5000);
});

await check("the offline file, the site and the Mac page have no upload side", async () => {
  const single = readFileSync("dist/pdfpcnic.html", "utf8");
  for (const trace of ["Open link", "decks/", "public-url", "Add version"]) assert.ok(!single.includes(trace), `${trace} in the offline file`);
  const site = readFileSync("dist/index.html", "utf8");
  assert.ok(!site.includes("Add version"), "the upload page in the site");
  assert.ok(!existsSync("dist/upload.js"), "the upload page beside the site");
});

const engines = { chrome: [chromium, { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] }], webkit: [webkit, {}] };
for (const [engine, [type, options]] of Object.entries(engines)) {
  if (engine === "chrome" && !process.env.CHROME_PATH) continue;
  const browser = await type.launch(options);
  const fresh = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    return { context, page, errors };
  };
  const ready = (page, name) => page.waitForFunction((name) => document.querySelector("#ready-name")?.textContent === name, name, { timeout: 15000 });
  const said = (page, re) => page.waitForFunction((re) => new RegExp(re).test(document.querySelector("#start-error").textContent), re.source, { timeout: 15000 });
  const paste = async (page, text) => {
    await page.waitForSelector(".deck-link input");
    await page.fill(".deck-link input", text);
    await page.keyboard.press("Enter");
  };
  const uploads = [
    { name: `${LONG}.pdf`, mimeType: "application/pdf", buffer: pdf },
    { name: `${LONG}.pdfpc`, mimeType: "application/json", buffer: notes },
  ];
  let token;
  let token2;

  await check(`${engine}: the upload page makes a deck with its own link, and the same name again makes another`, async () => {
    const { context, page, errors } = await fresh();
    await page.goto(upload);
    const uploaded = async (other) => {
      await page.setInputFiles("#files", uploads);
      const said = await page.waitForFunction(
        (other) => {
          const token = /^Uploaded: \S*#([a-z2-9]{6})$/.exec(document.querySelector("#status").textContent)?.[1];
          return token !== other && token;
        },
        other,
      );
      return said.jsonValue();
    };
    token = await uploaded();
    token2 = await uploaded(token);
    assert.notEqual(token2, token);
    await page.waitForSelector(`#decks tr[data-token="${token2}"]`);
    assert.ok(await page.$(`#decks tr[data-token="${token}"]`), "the first deck left the list");
    assert.ok((await page.textContent("#decks")).includes(LONG), "no file name in the list");
    assert.ok(await page.$eval("#decks input", (i) => i.scrollWidth <= i.clientWidth), "the link's token is cut off");
    await page.screenshot({ path: `${out}/${engine}-upload.png` });
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check(`${engine}: a link opens the deck and its notes with no password, the token leaves the address, and Present works`, async () => {
    const { context, page, errors } = await fresh();
    await page.goto(`${view}#${token}`);
    await ready(page, `${LONG}.pdf + ${LONG}.pdfpc`);
    assert.equal(new URL(page.url()).hash, "", "the token stayed in the address");
    await page.screenshot({ path: `${out}/${engine}-ready.png` });
    const [popup] = await Promise.all([context.waitForEvent("page"), page.click("#present")]);
    await page.waitForFunction(() => window.pdfpcnic.deck?.slides.length > 1);
    assert.ok((await page.textContent("#notes-body")).length > 0, "no notes");
    assert.ok(popup, "no audience window");
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check(`${engine}: from another origin, the box takes the same link`, async () => {
    const { context, page, errors } = await fresh();
    await page.goto(elsewhere);
    await page.waitForSelector(".deck-link input");
    await page.screenshot({ path: `${out}/${engine}-box.png` });
    await paste(page, `${view}#${token}`);
    await ready(page, `${LONG}.pdf + ${LONG}.pdfpc`);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await check(`${engine}: Add version keeps the link, the link opens the new one, and old notes don't come with it`, async () => {
    const { context, page } = await fresh();
    await page.goto(upload);
    await page.waitForSelector(`#decks tr[data-token="${token}"]`);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(`#decks tr[data-token="${token}"] td:last-child button`)]);
    await chooser.setFiles({ name: "anything.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.waitForFunction(() => /^Uploaded .*\.v2/.test(document.querySelector("#status").textContent));
    assert.equal(await page.textContent(`#decks tr[data-token="${token}"] td:nth-child(3)`), "2");
    const opener = await context.newPage();
    await opener.goto(`${view}#${token}`);
    await ready(opener, `${LONG}.v2.pdf`);
    await context.close();
  });

  await check(`${engine}: a wrong token or link says so, and the page still works`, async () => {
    const { context, page } = await fresh();
    await page.goto(`${view}#aaaaaa`);
    await said(page, /no deck aaaaaa/);
    await paste(page, `${view}#bbbbbb`);
    await said(page, /no deck bbbbbb on/);
    await paste(page, "https://example.com/page.html");
    await said(page, /isn't a deck's link/);
    await page.goto(elsewhere);
    await paste(page, token);
    await said(page, /no deck .* paste its whole link/);
    await paste(page, `${view}#${token2}`);
    await ready(page, `${LONG}.pdf + ${LONG}.pdfpc`);
    await context.close();
  });

  await check(`${engine}: a reload mid-talk offers to resume, and doesn't take the link over it`, async () => {
    const { context, page } = await fresh();
    await page.goto(`${view}#${token2}`);
    await ready(page, `${LONG}.pdf + ${LONG}.pdfpc`);
    await page.click("#present");
    await page.waitForFunction(() => window.pdfpcnic.deck?.slides.length > 1);
    await page.bringToFront();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("s");
    await sleep(2500);
    await page.goto(`${view}#${token2}`);
    await page.reload();
    await page.waitForSelector("#resume:not([hidden])");
    assert.match(await page.textContent("#resume"), /^Resume /);
    assert.equal(await page.$eval("#ready", (e) => e.hidden), true, "the link took over");
    assert.equal(await page.inputValue(".deck-link input"), `#${token2}`, "the link isn't kept to hand");
    await context.close();
  });

  if (process.env.NO_HTTPS !== engine) {
    await check(`${engine}: a PDF on another host opens by its own address, with the notes beside it`, async () => {
      const { context, page, errors } = await fresh();
      await page.goto(elsewhere);
      await paste(page, "https://raw.githubusercontent.com/youweizhuo/pdfpcnic/main/demo/demo.pdf");
      await ready(page, "demo.pdf + demo.pdfpc");
      assert.deepEqual(errors, []);
      await context.close();
    });
    await check(`${engine}: a host that doesn't let pages read its files says so`, async () => {
      const { context, page } = await fresh();
      await page.goto(elsewhere);
      await paste(page, "https://github.com/youweizhuo/pdfpcnic/releases/latest/download/nothing.pdf");
      await said(page, /Can't read that from github\.com/);
      await context.close();
    });
  }

  await browser.close();
}

server.close();
console.log(`${passed} checks passed (decks); screenshots in ${out}`);
process.exit();
