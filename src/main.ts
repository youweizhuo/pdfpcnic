// pdfpcnic in the browser: the presenter page (src/ui/) on the web platform (src/web/).

import "./ui/style.css";
import { start } from "./ui/start.ts";
import { web } from "./web/platform.ts";

void start(web);
