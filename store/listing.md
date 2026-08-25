# PageReel — Chrome Web Store listing

## Title
PageReel — Full Page Screenshot

## Short description (max 132 characters — shown in search results)
Capture an entire scrolling webpage as one clean image. One click, no login, sticky headers handled automatically.
(118 characters)

## Category
Productivity

## Language
English (primary)

## Detailed description (Web Store listing body)

PageReel captures the *entire* page — not just what fits on your screen. One click scrolls the page from top to bottom, stitches every frame together, and saves a single, ready-to-share PNG straight to your Downloads folder.

**Why PageReel**
- True full-page capture — long articles, pricing pages, dashboards, chat threads, entire documentation sites, all in one image.
- The top of the page is captured exactly as you see it; sticky headers and floating widgets are then kept out of every frame below it, so you don't get the same navbar repeated ten times down your screenshot.
- A quiet on-page progress indicator shows exactly what's happening, with a one-click cancel if you change your mind.
- A keyboard shortcut (⌘⇧U / Ctrl+Shift+U, customizable) starts a capture without opening any menu.
- Adjustable capture speed: Fast for simple pages, Thorough for pages with lazy-loaded images or animations.
- Nothing leaves your computer. No accounts, no cloud upload, no tracking — the image is built entirely on your device, at your screen's full native resolution.

**How it works**
1. Open the page you want to capture.
2. Click the PageReel icon (or press ⌘⇧U) and press "Capture full page."
3. Watch the progress bar as PageReel scrolls and captures.
4. Find your screenshot in Downloads, named after the site and timestamp.

**Good for**
Bug reports and QA documentation, saving long articles or receipts, archiving web pages, design reviews, sharing full page context with teammates, and portfolio/case-study screenshots.

**Permissions, plainly explained**
PageReel only acts on the tab you explicitly click it on (`activeTab`), never runs in the background, and never sends any data anywhere. See the full privacy policy: https://mehmetdemirkok.github.io/pagereel/store/privacy-policy.html

Keywords: full page screenshot, full page screenshot chrome extension, scrolling screenshot, capture entire page, webpage screenshot, long screenshot, screen capture extension, website screenshot tool, page to image, save whole page, screenshot entire webpage, capture full website, download webpage as image.

## Single purpose description (Chrome Web Store "Privacy practices" tab)
PageReel's single purpose is to capture a full-length screenshot of the currently active browser tab by scrolling the page and stitching the captured frames into one image file, saved locally.

## Permission justifications (paste into the corresponding dashboard fields)

- **activeTab**: Needed to read the dimensions of the page the user explicitly asked to capture and to trigger the screenshot only on that tab.
- **scripting**: Needed to inject the small content script that scrolls the page, hides sticky/fixed elements during capture, and shows the on-page progress indicator.
- **downloads**: Needed to save the final stitched screenshot to the user's Downloads folder.
- **offscreen**: Needed to stitch the captured image tiles on a canvas, which is unavailable inside the Manifest V3 background service worker.
- **storage**: Needed to remember the user's preferred capture speed setting locally on-device.

## Data usage disclosure (Chrome Web Store "Data collected" checkboxes)
None of the listed data categories are collected. PageReel does not collect personally identifiable information, health info, financial info, authentication info, personal communications, location, web history, user activity, or website content — the generated screenshot is written directly to the user's local disk and never transmitted anywhere.

## Assets checklist
- [x] Icons: 16/32/48/128 px — `icons/icon16.png` … `icons/icon128.png`
- [ ] At least one screenshot, 1280x800 or 640x400 px (see `store/promo/`)
- [ ] Small promo tile, 440x280 px (optional but recommended)
- [ ] Marquee promo tile, 1400x560 px (optional)
- [x] Privacy policy page — hosted and live at https://mehmetdemirkok.github.io/pagereel/store/privacy-policy.html
