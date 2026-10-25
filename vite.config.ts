import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// Two builds from one source: the site (`dist/`, pdf.js worker as its own
// file) and `--mode single` (`dist-single/index.html`, everything inlined so
// it runs from file:// with no network).
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
        "pdf-worker-source": resolve(single ? "src/worker-single.ts" : "src/worker-site.ts"),
      },
    },
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? "dist-single" : "dist",
      emptyOutDir: true,
      target: "es2022",
      chunkSizeWarningLimit: 4096,
    },
  };
});
