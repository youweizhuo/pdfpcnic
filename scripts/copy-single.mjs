// Puts the single-file build next to the site, so the site can offer it as a download.
import { copyFileSync } from "node:fs";

copyFileSync("dist-single/index.html", "dist/pdfpcnic.html");
console.log("dist/pdfpcnic.html");
