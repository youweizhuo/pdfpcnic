// Starts the browser for the end-to-end checks. On a busy CI machine it
// sometimes doesn't come up in time; then it gets one more, longer try.
import puppeteer from "puppeteer-core";

export async function launch(options) {
  try {
    return await puppeteer.launch(options);
  } catch (err) {
    console.log(`  ..  the browser didn't start (${err.message.split("\n")[0]}); trying once more`);
    return puppeteer.launch({ ...options, timeout: 90_000 });
  }
}
