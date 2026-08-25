// PageReel background service worker — orchestrates capture, throttles the
// Chrome capture API, and hands tiles to the offscreen document for stitching.

const MAX_HEIGHT_PX = 30000; // guards against runaway canvases on infinite-scroll pages
const CAPTURE_MIN_GAP_MS = 550; // chrome.tabs.captureVisibleTab allows ~2 calls/sec
const MAX_OUTPUT_PIXELS = 220_000_000; // pure safety net for the stitched canvas (physical px)

// captureVisibleTab already returns pixels at the display's real device
// pixel ratio (2x+ on Retina), losslessly encoded as PNG — there's no
// artificial "resolution boost" applied on top of that.
//
// An earlier version tried to force extra sharpness by temporarily paging
// the tab to 200% zoom before capturing. That was reverted: page zoom
// shrinks the CSS viewport width, which can cross a site's responsive
// breakpoint and swap in its mobile layout (hidden sidebar, hamburger menu,
// reflowed columns) for the duration of the capture — a real risk of
// silently capturing the wrong layout, not just a cosmetic one.
//
// "Speed" instead controls how long we wait after each scroll before
// capturing, which is a real, safe trade-off: slower settling gives
// lazy-loaded images/animations more time to finish painting.
const SPEED_PRESETS = {
  thorough: { settleMs: 380 },
  fast: { settleMs: 120 }
};

const jobs = new Map(); // tabId -> { cancelled: boolean }
let offscreenReady = null;

function tabMessage(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, msg);
}

async function ensureContentScript(tabId) {
  try {
    await tabMessage(tabId, { type: 'PAGEREEL_PING' });
    return;
  } catch (_) {
    // not injected yet
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
  await tabMessage(tabId, { type: 'PAGEREEL_PING' });
}

async function ensureOffscreenDocument() {
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (existing.length > 0) return;
    await chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Stitch captured screenshot tiles into a single PNG using a canvas.'
    });
  })();
  return offscreenReady;
}

let lastCaptureAt = 0;
async function captureVisibleTabThrottled(windowId) {
  const wait = Math.max(0, CAPTURE_MIN_GAP_MS - (Date.now() - lastCaptureAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      lastCaptureAt = Date.now();
      return dataUrl;
    } catch (err) {
      const msg = String(err && err.message);
      if (msg.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND') && attempt < 2) {
        await new Promise((r) => setTimeout(r, 700));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Rate limited by Chrome while capturing.');
}

function buildScrollSteps(totalHeight, viewportHeight, viewportWidth, dpr) {
  let cappedHeight = Math.min(totalHeight, MAX_HEIGHT_PX);
  // Extra safety net so an already-huge page on a high-DPI display can't
  // produce a canvas too large for the browser to allocate.
  const widthPx = viewportWidth * dpr;
  if (widthPx > 0) {
    const maxHeightForBudget = Math.floor(MAX_OUTPUT_PIXELS / (widthPx * dpr));
    cappedHeight = Math.min(cappedHeight, Math.max(maxHeightForBudget, viewportHeight));
  }
  const steps = [];
  let y = 0;
  while (y < cappedHeight - viewportHeight) {
    steps.push(y);
    y += viewportHeight;
  }
  const last = Math.max(0, cappedHeight - viewportHeight);
  if (steps.length === 0 || steps[steps.length - 1] !== last) steps.push(last);
  return { steps, cappedHeight };
}

function friendlyError(err) {
  const msg = String((err && err.message) || err || '');
  if (msg.includes('Cannot access') || msg.includes('chrome://') || msg.includes('Extension manifest')) {
    return "This page can't be captured (browser-internal or restricted page).";
  }
  if (msg.includes('cancelled') || msg.includes('Cancelled')) return 'Cancelled';
  return 'Capture failed — please try again.';
}

async function runCapture(tabId, windowId, speed) {
  const job = { cancelled: false };
  jobs.set(tabId, job);
  const preset = SPEED_PRESETS[speed] || SPEED_PRESETS.thorough;

  try {
    await ensureContentScript(tabId);
    const metrics = await tabMessage(tabId, { type: 'PAGEREEL_GET_METRICS' });
    const { steps, cappedHeight } = buildScrollSteps(
      metrics.totalHeight,
      metrics.viewportHeight,
      metrics.viewportWidth,
      metrics.dpr
    );

    await tabMessage(tabId, { type: 'PAGEREEL_PREPARE' });

    const tiles = [];
    for (let i = 0; i < steps.length; i++) {
      if (job.cancelled) throw new Error('Cancelled');
      const targetY = steps[i];
      const { actualY } = await tabMessage(tabId, { type: 'PAGEREEL_SCROLL_TO', y: targetY, settleMs: preset.settleMs });
      const dataUrl = await captureVisibleTabThrottled(windowId);
      tiles.push({ dataUrl, y: actualY });

      if (i === 0 && steps.length > 1) {
        // The top-of-page frame just captured legitimately includes the
        // sticky header. From here on it would just get re-captured,
        // pinned, at every scroll position — hide it before scrolling on.
        await tabMessage(tabId, { type: 'PAGEREEL_HIDE_STICKY' }).catch(() => {});
      }

      const percent = Math.round(((i + 1) / steps.length) * 90); // reserve the tail for stitching
      await tabMessage(tabId, {
        type: 'PAGEREEL_PROGRESS',
        percent,
        label: `Capturing… ${i + 1}/${steps.length}`
      }).catch(() => {});
    }

    await tabMessage(tabId, { type: 'PAGEREEL_CLEANUP' }).catch(() => {});

    await ensureOffscreenDocument();
    const stitched = await chrome.runtime.sendMessage({
      type: 'PAGEREEL_STITCH',
      tiles,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight,
      totalHeight: cappedHeight,
      dpr: metrics.dpr
    });

    if (!stitched || !stitched.ok) throw new Error(stitched && stitched.error || 'Stitching failed');

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeHost = (metrics.hostname || 'page').replace(/[^a-z0-9.-]/gi, '_');
    await chrome.downloads.download({
      url: stitched.dataUrl,
      filename: `PageReel/${safeHost}-${stamp}.png`,
      saveAs: false
    });

    await tabMessage(tabId, { type: 'PAGEREEL_DONE' }).catch(() => {});
  } catch (err) {
    await tabMessage(tabId, { type: 'PAGEREEL_ERROR', message: friendlyError(err) }).catch(() => {});
    throw err;
  } finally {
    jobs.delete(tabId);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PAGEREEL_START') {
    const { tabId, windowId, speed } = msg;
    if (jobs.has(tabId)) {
      sendResponse({ ok: false, error: 'Already capturing this tab.' });
      return false;
    }
    sendResponse({ ok: true });
    runCapture(tabId, windowId, speed).catch((err) => {
      console.warn('[PageReel] capture failed', err);
    });
    return false;
  }

  if (msg.type === 'PAGEREEL_CANCEL_REQUEST') {
    const tabId = sender.tab && sender.tab.id;
    const job = tabId != null ? jobs.get(tabId) : null;
    if (job) job.cancelled = true;
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

const RESTRICTED_URL_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'devtools://'];

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-full-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || jobs.has(tab.id)) return;
  if (!tab.url || RESTRICTED_URL_PREFIXES.some((p) => tab.url.startsWith(p))) return;

  const { speed } = await chrome.storage.local.get('speed');
  runCapture(tab.id, tab.windowId, speed).catch((err) => {
    console.warn('[PageReel] capture failed', err);
  });
});
