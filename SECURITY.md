# Security

pdfpcnic opens PDFs and Markdown notes in your browser, including files you didn't make. It renders them with
[PDF.js](https://mozilla.github.io/pdf.js/), cleans notes with [DOMPurify](https://github.com/cure53/DOMPurify), and
never sends a file anywhere. On the site, a Content Security Policy lets scripts, workers and connections come from the
site alone.

## Reporting a vulnerability

Please report it privately through
[GitHub's form](https://github.com/youweizhuo/pdfpcnic/security/advisories/new), not in a public issue. Say what a
crafted file or page can make pdfpcnic do, with the file or the steps if you can. You'll get an answer within a week.

A flaw in PDF.js itself belongs with [Mozilla](https://www.mozilla.org/security/bug-bounty/); pdfpcnic takes their
fixes as they're released.

## Supported versions

The latest release and the website get fixes.
