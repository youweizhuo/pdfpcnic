// Puts the single-file build next to the site, so the site can offer it as a
// download, with the licenses of pdfpcnic and the libraries it carries inside.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("dist-single/index.html", "utf8");
const licenses = `${readFileSync("LICENSE", "utf8")}\n${readFileSync("dist-single/licenses.txt", "utf8")}`;
// Only "-->" would end the comment early.
const comment = `<!--\npdfpcnic ${JSON.parse(readFileSync("package.json", "utf8")).version}\n\n${licenses.replaceAll("-->", "- ->")}-->\n`;
writeFileSync("dist/pdfpcnic.html", html.replace(/<\/html>\s*$/, `</html>\n${comment}`));
console.log("dist/pdfpcnic.html");
