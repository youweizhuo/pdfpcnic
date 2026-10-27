import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// The site's policy: scripts, workers and fetches from this site only, so a PDF
// or a note can't load code or send anything elsewhere. (Workers also run from
// blob: URLs; pdf.js draws fonts and images from data: and blob: URLs.)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

/** Site build: puts the policy in the page, for hosts that can't send headers (GitHub Pages). */
function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
  };
}

/**
 * Site build: pdf.js's CMaps, standard fonts and image decoders, under `pdfjs/`.
 * Only PDFs that need them fetch them. (The script engine for PDF forms is left out.)
 */
function pdfjsResources(): Plugin {
  const root = resolve("node_modules/pdfjs-dist");
  return {
    name: "pdfjs-resources",
    apply: "build",
    generateBundle() {
      for (const dir of ["cmaps", "standard_fonts", "iccs", "wasm"]) {
        for (const name of readdirSync(resolve(root, dir))) {
          if (name.startsWith("quickjs")) continue;
          this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${name}`, source: readFileSync(resolve(root, dir, name)) });
        }
      }
    },
  };
}

/**
 * The calls between the Mac app and its presenter page. Bumped when either
 * side's change; an installed app only takes downloaded pages built for its own.
 */
const MAC_BRIDGE = 1;

/**
 * Mac build: the page on the Mac platform (src/mac/), saying which bridge it
 * speaks. Its policy keeps everything inside the app: the script and styles
 * are inline, and the only fetches go to the app (pdfpcnic:) or data: URLs.
 */
function macPage(): Plugin {
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "connect-src pdfpcnic: data:",
    "img-src data: blob:",
    "font-src data:",
    "worker-src blob:",
    "base-uri 'none'",
  ].join("; ");
  return {
    name: "mac-page",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => ({
        html: html.replace('src="./src/main.ts"', 'src="./src/mac/main.ts"'),
        tags: [
          { tag: "meta", attrs: { name: "pdfpcnic-bridge", content: String(MAC_BRIDGE) }, injectTo: "head-prepend" },
          { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" },
        ],
      }),
    },
  };
}

// Three builds from one source: the site (`dist/`, with files fetched as
// needed), `--mode single` (`dist-single/index.html`, everything inlined so it
// runs from file:// with no network), and `--mode mac` (`dist-mac/index.html`,
// the page inside the Mac app; mac/build.sh makes the app around it).
// `src/web/variant-*.ts` holds what differs between the first two.
export default defineConfig(({ mode }) => {
  const build = mode === "single" || mode === "mac" ? mode : "site";
  return {
    base: "./",
    define: {
      __BUILD__: JSON.stringify(build),
      __VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        variant: resolve(build === "site" ? "src/web/variant-site.ts" : "src/web/variant-single.ts"),
      },
    },
    plugins: { site: [contentSecurityPolicy(), pdfjsResources()], single: [viteSingleFile()], mac: [viteSingleFile(), macPage()] }[build],
    build: {
      outDir: { site: "dist", single: "dist-single", mac: "dist-mac" }[build],
      emptyOutDir: true,
      target: "es2022",
      chunkSizeWarningLimit: 4096,
      // The bundled libraries' licenses: beside the site, inside the offline copy (scripts/copy-single.mjs) and the Mac app.
      license: { fileName: "licenses.txt" },
    },
  };
});
