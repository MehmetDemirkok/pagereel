# PageReel — Full Page Screenshot

A Manifest V3 Chrome extension that scrolls the active tab and stitches a full-length screenshot into one PNG, saved locally. No accounts, no server, no tracking.

Source: https://github.com/MehmetDemirkok/pagereel
Live privacy policy: https://mehmetdemirkok.github.io/pagereel/store/privacy-policy.html

## How it behaves (and why)

- **Header handling**: the very first frame (top of page) is captured exactly as a visitor sees it, sticky header included. Only from the second frame on is the sticky/fixed header hidden — otherwise it would get re-captured, pinned, at every scroll position.
- **Resolution**: captures happen at the display's real device pixel ratio (2x+ on Retina), losslessly encoded as PNG. There is deliberately no artificial zoom-based "sharpening" — an earlier version tried temporarily zooming the tab to 200% to force extra pixel density, but page zoom shrinks the CSS viewport and can cross a site's responsive breakpoint (swapping in its mobile layout mid-capture). That was reverted as unsafe.
- **Crash safety**: all capture state lives in the content script, not the popup, so closing the popup never interrupts anything. A 45-second watchdog force-restores the page (visibility, scroll position, overlay removed) if it never hears back from the background script.
- **Screenshots never contain the progress overlay**: the overlay is hidden immediately before each `captureVisibleTab` call and re-shown right after.
- **Scroll detection**: works on both ordinary pages (window/`<html>` scrolls) and app-shell SPAs that keep `html`/`body` pinned to 100vh and scroll an inner container instead — the largest scrollable element is auto-detected.
- `chrome.tabs.captureVisibleTab` calls are throttled/retried to respect Chrome's ~2-calls/second limit. Page height is capped (30,000px, with a total-pixel safety net on top) to avoid crashing on infinite-scroll pages.
- Minimal permissions: only `activeTab` (granted by the user's own click or the keyboard shortcut), no `<all_urls>`.
- Keyboard shortcut: `⌘⇧U` / `Ctrl+Shift+U` (user-customizable at `chrome://extensions/shortcuts`), shown live in the popup.

## Project structure

```
manifest.json
src/
  background.js     — service worker: orchestrates scroll+capture loop, keyboard command
  content.js         — injected into the page: scrolling, overlay UI, watchdog
  offscreen.html/js  — stitches tiles into one PNG (canvas isn't available in the worker)
  popup/              — toolbar popup UI
icons/                — icon.svg (128/48, detailed) + icon-small.svg (16/32, simplified for legibility), rasterized to PNG
store/
  listing.md          — title, descriptions, keywords, permission justifications (ready to paste into the dashboard)
  privacy-policy.html — source; live copy is hosted via GitHub Pages (see link above)
  promo/               — promo tile + popup screenshot
```

## Test it locally

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `pagereel` folder.
4. Open any long webpage. Click the PageReel icon → **Capture full page**, or just press `⌘⇧U`.
5. Watch the progress pill scroll down the page, then check Downloads for `PageReel/<site>-<timestamp>.png`.
6. Try **Cancel** mid-capture, and try a page with a sticky header to confirm it appears once at the top and isn't duplicated below.

If something looks off, check `chrome://extensions` → PageReel → **service worker** console, and the page's own DevTools console (the content script logs there).

## Publish to the Chrome Web Store — what's already done

- [x] Icons (16/32/48/128), tuned separately for small-size legibility vs. the detailed 128px store icon.
- [x] Privacy policy written and **live** at a public URL (see top of this file) — paste it straight into the dashboard.
- [x] Store listing copy, keywords, single-purpose description, and permission justifications — all in `store/listing.md`, ready to paste in.
- [x] Promo tile (440×280) and a popup screenshot in `store/promo/`.
- [x] Source pushed to GitHub (public): https://github.com/MehmetDemirkok/pagereel

## What's left — needs your Chrome Web Store account (can't be done from here)

1. **Developer account**: [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) — pay the one-time $5 registration fee if you haven't already.
2. **Zip the package** (run from inside `pagereel/`):
   ```
   zip -r ../pagereel.zip . -x "store/*" -x "*.svg" -x "README.md" -x ".DS_Store" -x ".git/*" -x ".gitignore"
   ```
   The store package should contain only `manifest.json`, `icons/*.png`, and `src/`.
3. Dashboard → **New item** → upload `pagereel.zip`.
4. Fill in the listing using `store/listing.md` (title, short/detailed description, category: Productivity, keywords).
5. Upload `icons/icon128.png` as the store icon, plus the screenshot(s) in `store/promo/` (at least one 1280×800 or 640×400 — for a stronger listing, also grab one of the in-page progress overlay from your local test above).
6. **Privacy practices tab**: paste the single-purpose description + permission justifications from `store/listing.md`, and the privacy policy URL from the top of this file. Declare no data collection.
7. Submit for review.

Realistic expectation: submission takes ~15 minutes today, but Google's review isn't instant — simple, minimal-permission extensions like this are often approved within a few hours to a couple of days. There's no lever here (or anywhere) that guarantees same-day approval or install volume — that's Google's review queue and organic/Store-search discovery, not something an extension's code or listing copy can force. What *is* in scope and done: the keywords, title, and description are written to maximize how easily people searching for "full page screenshot" actually find it.
