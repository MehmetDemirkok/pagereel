# PageReel — Full Page Screenshot

A Manifest V3 Chrome extension that scrolls the active tab and stitches a full-length screenshot into one PNG, saved locally. No accounts, no server, no tracking.

## Why it's built this way (design notes)

The earlier extension you mentioned likely broke because a mid-capture failure (rate limiting, a slow/lazy page, or the popup closing) left the page in a half-modified state — sticky elements hidden, scroll position never restored, an overlay stuck on screen. PageReel is built specifically to avoid that:

- All capture state lives in the **content script**, not the popup, so closing the popup never interrupts anything.
- Every "prepare" step (hiding sticky/fixed elements, disabling smooth scroll) has a matching, always-run cleanup step.
- A **45-second watchdog timer** in the content script force-restores the page (visibility, scroll position, overlay removed) if it never hears back from the background script — so a crash can never leave a page stuck.
- `chrome.tabs.captureVisibleTab` calls are throttled and retried to respect Chrome's ~2-calls/second limit, instead of firing them as fast as possible.
- Page height is capped (30,000px) to avoid crashing on infinite-scroll pages.
- Minimal permissions: only `activeTab` (granted by the user's own click), no `<all_urls>`.

## Project structure

```
manifest.json
src/
  background.js     — service worker: orchestrates scroll+capture loop
  content.js         — injected into the page: scrolling, overlay UI, watchdog
  offscreen.html/js  — stitches tiles into one PNG (canvas isn't available in the worker)
  popup/              — toolbar popup UI
icons/                — extension icons (icon.svg is the source, rasterized to 16/32/48/128)
store/
  listing.md          — title, descriptions, keywords, permission justifications
  privacy-policy.html — must be hosted at a public URL for the dashboard (see below)
  promo/               — promo tile art
```

## Test it locally (do this first)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `pagereel` folder.
4. Open any long webpage (a blog post, docs page, etc.).
5. Click the PageReel icon in the toolbar → **Capture full page**.
6. Watch the small progress pill scroll down the page, then check your Downloads folder for `PageReel/<site>-<timestamp>.png`.
7. Try **Cancel** mid-capture, and try it on a page with a sticky header/nav to confirm it's hidden in the result.

If something looks off, check `chrome://extensions` → PageReel → **service worker** (console) and the page's own DevTools console (the content script logs there).

## Publish to the Chrome Web Store today

1. **Developer account** — if you don't already have one: go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), pay the one-time $5 registration fee if prompted.
2. **Host the privacy policy** — `store/privacy-policy.html` needs a public URL (the dashboard won't accept a local file). Fastest option: push this folder to a GitHub repo and enable GitHub Pages, or drop just that file on any static host you already use. Paste the resulting URL into `store/listing.md` where it says `<PRIVACY_POLICY_URL>` and into the dashboard's privacy policy field.
3. **Zip the package** (from one level above `pagereel/`):
   ```
   cd pagereel && zip -r ../pagereel.zip . -x "store/*" -x "*.svg" -x "README.md" -x ".DS_Store"
   ```
   The store package should contain `manifest.json`, `icons/`, and `src/` only — the `store/` folder is listing material, not part of the extension.
4. In the dashboard: **New item** → upload `pagereel.zip`.
5. Fill in the listing using `store/listing.md` (title, short/detailed description, category: Productivity).
6. Upload icons (already in `icons/`) and at least one screenshot (1280x800 or 640x400 — take one of the popup and one of the in-page progress overlay from your local test in step above).
7. **Privacy practices tab**: paste the single-purpose description and the permission justifications from `store/listing.md`, and the hosted privacy policy URL from step 2. Declare no data collection.
8. Submit for review.

Realistic expectation: submission takes ~15 minutes today, but Google's review isn't instant — simple, minimal-permission extensions like this one are often approved within a few hours to a couple of days, not necessarily the same day. There's no way to guarantee same-day approval since that's Google's process, not something controllable from here.
