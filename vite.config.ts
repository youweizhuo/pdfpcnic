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

// Two builds from one source: the site (`dist/`, with files fetched as needed)
// and `--mode single` (`dist-single/index.html`, everything inlined so it runs
// from file:// with no network). `src/variant-*.ts` holds what differs.
export default defineConfig(({ mode }) => {
  const single = mode === "single";
  return {
    base: "./",
    define: {
      __SINGLE_FILE__: JSON.stringify(single),
      __VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        variant: resolve(single ? "src/variant-single.ts" : "src/variant-site.ts"),
      },
    },
    plugins: single ? [viteSingleFile()] : [contentSecurityPolicy(), pdfjsResources()],
    build: {
      outDir: single ? "dist-single" : "dist",
      emptyOutDir: true,
      target: "es2022",
      chunkSizeWarningLimit: 4096,
      // The bundled libraries' licenses: beside the site, inside the offline copy (scripts/copy-single.mjs).
      license: { fileName: "licenses.txt" },
    },
  };
});
