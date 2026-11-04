/** Which build this is: the website, the offline file, or the page inside the Mac app. */
declare const __BUILD__: "site" | "single" | "mac";
declare const __VERSION__: string;
/** Whether this build opens decks by link: a deck server's own site, and the Mac app. */
declare const __DECKS__: boolean;
