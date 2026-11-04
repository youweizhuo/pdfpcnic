// The upload page, on the server's private port. It's only ever here: not in the
// site, the offline file or the Mac app. nginx does the file work; this picks
// each deck's token and version, and shows the links.

import { newToken, nextVersion, pairFiles } from "./names.js";

const $ = (id) => document.getElementById(id);
const say = (text, bad = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("bad", bad);
};
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const at = (token, name = "") => `decks/${token}/${encodeURIComponent(name)}`;

async function list(path) {
  const res = await fetch(path);
  return res.ok ? res.json() : [];
}

async function put(token, name, file) {
  say(`Uploading ${name} (${megabytes(file.size)})…`);
  const res = await fetch(at(token, name), { method: "PUT", body: file });
  if (!res.ok) throw new Error(res.status === 409 ? `${name} is already there, and isn't overwritten.` : `The server answered ${res.status} for ${name}.`);
}

/** A token no deck has. */
async function freeToken() {
  for (;;) {
    const token = newToken();
    if ((await fetch(at(token))).status === 404) return token;
  }
}

const stored = (stem, deck) => {
  const extension = (name) => name.slice(name.lastIndexOf(".")).toLowerCase();
  return [
    [`${stem}${extension(deck.pdf.name)}`, deck.pdf],
    ...(deck.notes ? [[`${stem}.pdfpc`, deck.notes]] : []),
  ];
};

async function uploadDecks(files) {
  try {
    const decks = pairFiles(files);
    const links = [];
    for (const deck of decks) {
      const token = await freeToken();
      for (const [name, file] of stored(deck.pdf.name.replace(/\.[^.]+$/, ""), deck)) await put(token, name, file);
      links.push(token);
    }
    await show();
    say(`Uploaded: ${(await Promise.all(links.map(linkFor))).join(", ")}`);
  } catch (err) {
    say(err.message, true);
    await show();
  }
}

async function uploadVersion(token, files) {
  try {
    const [deck, more] = pairFiles(files);
    if (more) throw new Error("A new version is one PDF, with its .pdfpc file if it has one.");
    const names = (await list(at(token))).map((f) => f.name);
    const stem = nextVersion(names);
    for (const [name, file] of stored(stem, deck)) await put(token, name, file);
    await show();
    say(`Uploaded ${stem}: the link now opens it.`);
  } catch (err) {
    say(err.message, true);
    await show();
  }
}

let site = null;
async function linkFor(token) {
  site ??= await fetch("public-url")
    .then((res) => (res.ok ? res.text() : ""))
    .catch(() => "");
  return `${site.trim().replace(/\/?$/, site.trim() ? "/" : "")}#${token}`;
}

async function row(token) {
  const files = await list(at(token));
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
  if (!pdfs.length) return null;
  const when = new Date(Math.max(...files.map((f) => Date.parse(f.mtime))));
  const tr = document.createElement("tr");
  tr.dataset.token = token;
  const cell = (node) => {
    const td = document.createElement("td");
    td.append(node);
    tr.append(td);
  };
  cell(pdfs[0].name.replace(/\.[^.]+$/, ""));
  const link = document.createElement("input");
  link.readOnly = true;
  link.value = await linkFor(token);
  link.addEventListener("click", () => link.select());
  const copy = document.createElement("button");
  copy.textContent = "Copy";
  copy.type = "button";
  // On plain http the clipboard API is absent; selecting and copying still works.
  copy.addEventListener("click", () => {
    link.select();
    say(document.execCommand("copy") ? `Copied ${link.value}` : "Press Ctrl+C or ⌘C to copy the selected link.");
  });
  const both = document.createDocumentFragment();
  both.append(link, " ", copy);
  cell(both);
  cell(String(pdfs.length));
  cell(when.toLocaleString());
  const add = document.createElement("button");
  add.textContent = "Add version";
  add.type = "button";
  add.addEventListener("click", () => {
    versionFor = token;
    $("version-files").click();
  });
  cell(add);
  return { tr, when };
}

async function show() {
  const tokens = (await list("decks/")).filter((f) => f.type === "directory" && !f.name.startsWith("."));
  const rows = (await Promise.all(tokens.map((t) => row(t.name)))).filter(Boolean);
  rows.sort((a, b) => b.when - a.when);
  $("decks").replaceChildren(...rows.map((r) => r.tr));
  $("none").hidden = rows.length > 0;
}

let versionFor = null;
$("files").addEventListener("change", (e) => {
  void uploadDecks([...e.target.files]);
  e.target.value = "";
});
$("version-files").addEventListener("change", (e) => {
  if (versionFor) void uploadVersion(versionFor, [...e.target.files]);
  e.target.value = "";
});
const drop = $("drop");
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
window.addEventListener("dragleave", () => drop.classList.remove("over"));
window.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  if (e.dataTransfer?.files.length) void uploadDecks([...e.dataTransfer.files]);
});
void show().catch((err) => say(err.message, true));
