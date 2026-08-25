// PageReel content script — runs in the page, drives scrolling and the on-page overlay.
// Guarded against double-injection: chrome.scripting.executeScript may run this more than once.
if (!window.__pageReelLoaded) {
  window.__pageReelLoaded = true;

  const NS = 'pagereel';
  let hiddenEls = [];
  let injectedStyle = null;
  let originalScrollTop = 0;
  let scrollRoot = null;
  let overlayHost = null;
  let shadow = null;
  let watchdogTimer = null;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function nextPaint() {
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  }

  // --- Scroll root detection --------------------------------------------
  // Most pages scroll on window/<html>, but plenty of SPAs keep html/body
  // pinned to 100vh with overflow:hidden and scroll an inner container
  // instead. If we only ever call window.scrollTo, those pages look like
  // they have no scroll at all and we capture just the first screen.

  function isWindowRoot(el) {
    return el === document.documentElement || el === document.body;
  }

  function getScrollTop(el) {
    return isWindowRoot(el) ? window.scrollY : el.scrollTop;
  }

  function setScrollTop(el, y) {
    if (isWindowRoot(el)) window.scrollTo(0, y);
    else el.scrollTop = y;
  }

  function getViewportHeight(el) {
    return isWindowRoot(el) ? window.innerHeight : el.clientHeight;
  }

  function isScrollableContainer(el) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY)) return false;
    if (el.scrollHeight - el.clientHeight < 40) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 100 && rect.height >= 100;
  }

  function detectScrollRoot() {
    const de = document.documentElement;
    const body = document.body;
    if (de.scrollHeight - de.clientHeight > 40) return de;
    if (body && body.scrollHeight - body.clientHeight > 40) return body;

    // Window itself doesn't scroll — look for the largest scrollable
    // descendant (typical of app-shell SPAs).
    let best = null;
    let bestArea = 0;
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of all) {
      if (!isScrollableContainer(el)) continue;
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best || de;
  }

  // --- Overlay UI -----------------------------------------------------

  function buildOverlay() {
    if (overlayHost) return;
    overlayHost = document.createElement('div');
    overlayHost.id = `${NS}-overlay-host`;
    overlayHost.style.all = 'initial';
    overlayHost.style.position = 'fixed';
    overlayHost.style.zIndex = '2147483647';
    overlayHost.style.top = '16px';
    overlayHost.style.left = '50%';
    overlayHost.style.transform = 'translateX(-50%)';
    shadow = overlayHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      .card {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 260px;
        padding: 12px 16px;
        border-radius: 14px;
        background: rgba(23, 23, 30, 0.92);
        color: #fff;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 8px 30px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06);
        backdrop-filter: blur(6px);
        transition: opacity .25s ease, transform .25s ease;
      }
      .spinner {
        width: 18px; height: 18px; flex: none;
        border-radius: 50%;
        border: 2.5px solid rgba(255,255,255,0.25);
        border-top-color: #7c9bff;
        animation: spin .8s linear infinite;
      }
      .check {
        width: 18px; height: 18px; flex: none; color: #34d399;
      }
      .warn { width: 18px; height: 18px; flex: none; color: #f87171; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .body { flex: 1; min-width: 0; }
      .title { font-weight: 600; margin: 0 0 4px; }
      .bar-track {
        height: 4px; border-radius: 2px; background: rgba(255,255,255,0.15);
        overflow: hidden;
      }
      .bar-fill {
        height: 100%; width: 0%; background: linear-gradient(90deg,#7c9bff,#8f6cff);
        transition: width .18s ease;
      }
      .cancel {
        flex: none; background: transparent; border: none; color: rgba(255,255,255,0.6);
        font-size: 12px; cursor: pointer; padding: 4px 8px; border-radius: 8px;
      }
      .cancel:hover { background: rgba(255,255,255,0.1); color: #fff; }
    `;

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="spinner" data-role="spinner"></div>
      <svg class="check" data-role="check" style="display:none" viewBox="0 0 20 20" fill="none"><path d="M4 10.5l3.8 3.8L16 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <svg class="warn" data-role="warn" style="display:none" viewBox="0 0 20 20" fill="none"><path d="M10 3l8 14H2L10 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="14.5" r="0.9" fill="currentColor"/></svg>
      <div class="body">
        <p class="title" data-role="title">Capturing page…</p>
        <div class="bar-track"><div class="bar-fill" data-role="bar"></div></div>
      </div>
      <button class="cancel" data-role="cancel" type="button">Cancel</button>
    `;
    shadow.appendChild(style);
    shadow.appendChild(card);
    document.documentElement.appendChild(overlayHost);

    shadow.querySelector('[data-role="cancel"]').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PAGEREEL_CANCEL_REQUEST' }).catch(() => {});
      setOverlayState('error', 'Cancelled');
      setTimeout(removeOverlay, 900);
    });
  }

  // Hidden right before each screenshot is taken so the progress pill never
  // ends up baked into the captured image, then shown again afterwards.
  function hideOverlay() {
    if (overlayHost) overlayHost.style.setProperty('display', 'none', 'important');
  }

  function showOverlay() {
    if (overlayHost) overlayHost.style.removeProperty('display');
  }

  function setOverlayProgress(percent, label) {
    if (!shadow) return;
    showOverlay();
    shadow.querySelector('[data-role="bar"]').style.width = `${percent}%`;
    if (label) shadow.querySelector('[data-role="title"]').textContent = label;
  }

  function setOverlayState(state, label) {
    if (!shadow) return;
    showOverlay();
    const spinner = shadow.querySelector('[data-role="spinner"]');
    const check = shadow.querySelector('[data-role="check"]');
    const warn = shadow.querySelector('[data-role="warn"]');
    const cancel = shadow.querySelector('[data-role="cancel"]');
    spinner.style.display = state === 'busy' ? 'block' : 'none';
    check.style.display = state === 'done' ? 'block' : 'none';
    warn.style.display = state === 'error' ? 'block' : 'none';
    cancel.style.display = state === 'busy' ? 'inline-block' : 'none';
    if (label) shadow.querySelector('[data-role="title"]').textContent = label;
  }

  function removeOverlay() {
    if (overlayHost && overlayHost.parentNode) overlayHost.parentNode.removeChild(overlayHost);
    overlayHost = null;
    shadow = null;
  }

  // --- Fixed/sticky element handling ----------------------------------

  function hideStickyAndFixed() {
    hiddenEls = [];
    const all = document.body ? document.body.querySelectorAll('*') : [];
    for (const el of all) {
      if (el === overlayHost) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        hiddenEls.push({ el, prevVisibility: el.style.visibility });
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }

  function restoreStickyAndFixed() {
    for (const { el, prevVisibility } of hiddenEls) {
      if (prevVisibility) el.style.visibility = prevVisibility;
      else el.style.removeProperty('visibility');
    }
    hiddenEls = [];
  }

  let scrollRootPrevBehavior;

  function injectScrollBehaviorOverride() {
    injectedStyle = document.createElement('style');
    injectedStyle.textContent = 'html, body { scroll-behavior: auto !important; }';
    document.documentElement.appendChild(injectedStyle);
    if (scrollRoot && !isWindowRoot(scrollRoot)) {
      scrollRootPrevBehavior = scrollRoot.style.scrollBehavior;
      scrollRoot.style.setProperty('scroll-behavior', 'auto', 'important');
    }
  }

  function removeScrollBehaviorOverride() {
    if (injectedStyle && injectedStyle.parentNode) injectedStyle.parentNode.removeChild(injectedStyle);
    injectedStyle = null;
    if (scrollRoot && !isWindowRoot(scrollRoot)) {
      if (scrollRootPrevBehavior) scrollRoot.style.scrollBehavior = scrollRootPrevBehavior;
      else scrollRoot.style.removeProperty('scroll-behavior');
    }
  }

  // --- Watchdog: guarantees the page is never left in a broken state --
  // If background dies mid-capture (crash, extension reload, unexpected
  // error) this fires and force-restores everything so the tab stays usable.
  function armWatchdog() {
    disarmWatchdog();
    watchdogTimer = setTimeout(() => {
      console.warn('[PageReel] watchdog triggered — force-restoring page state');
      hardReset();
    }, 45000);
  }

  function disarmWatchdog() {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }

  function hardReset() {
    disarmWatchdog();
    restoreStickyAndFixed();
    removeScrollBehaviorOverride();
    setScrollTop(scrollRoot || document.documentElement, originalScrollTop);
    setOverlayState('error', 'Something went wrong — page restored');
    setTimeout(removeOverlay, 2200);
  }

  // --- Message handling -------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      switch (msg.type) {
        case 'PAGEREEL_PING':
          sendResponse({ ok: true });
          break;

        case 'PAGEREEL_GET_METRICS': {
          scrollRoot = detectScrollRoot();
          const totalHeight = Math.max(scrollRoot.scrollHeight, getViewportHeight(scrollRoot));
          sendResponse({
            totalHeight,
            viewportWidth: window.innerWidth,
            viewportHeight: getViewportHeight(scrollRoot),
            dpr: window.devicePixelRatio || 1,
            startY: getScrollTop(scrollRoot),
            title: document.title,
            hostname: location.hostname
          });
          break;
        }

        case 'PAGEREEL_PREPARE':
          if (!scrollRoot) scrollRoot = detectScrollRoot();
          originalScrollTop = getScrollTop(scrollRoot);
          buildOverlay();
          setOverlayState('busy', 'Preparing page…');
          injectScrollBehaviorOverride();
          // Sticky/fixed elements (header, nav) stay visible for now — the
          // very first frame is captured at the real top of the page, so
          // the header belongs there. They only get hidden afterwards, via
          // PAGEREEL_HIDE_STICKY, once scrolling starts.
          armWatchdog();
          await nextPaint();
          sendResponse({ ok: true });
          break;

        case 'PAGEREEL_HIDE_STICKY':
          hideStickyAndFixed();
          await nextPaint();
          sendResponse({ ok: true });
          break;

        case 'PAGEREEL_SCROLL_TO':
          setScrollTop(scrollRoot || document.documentElement, msg.y);
          hideOverlay(); // must not appear in the screenshot about to be taken
          await nextPaint();
          await wait(msg.settleMs || 220);
          sendResponse({ actualY: getScrollTop(scrollRoot || document.documentElement) });
          break;

        case 'PAGEREEL_PROGRESS':
          setOverlayProgress(msg.percent, msg.label);
          sendResponse({ ok: true });
          break;

        case 'PAGEREEL_CLEANUP':
          restoreStickyAndFixed();
          removeScrollBehaviorOverride();
          setScrollTop(scrollRoot || document.documentElement, originalScrollTop);
          setOverlayState('busy', 'Stitching image…');
          sendResponse({ ok: true });
          break;

        case 'PAGEREEL_DONE':
          disarmWatchdog();
          setOverlayState('done', 'Saved to Downloads');
          setTimeout(removeOverlay, 1800);
          sendResponse({ ok: true });
          break;

        case 'PAGEREEL_ERROR':
          hardReset();
          setOverlayState('error', msg.message || 'Capture failed');
          sendResponse({ ok: true });
          break;

        default:
          break;
      }
    })();
    return true; // keep the message channel open for the async response
  });

  // Belt-and-suspenders: if the tab is being torn down mid-capture, restore
  // sticky/fixed visibility synchronously rather than leaving it hidden.
  window.addEventListener('pagehide', () => {
    restoreStickyAndFixed();
    removeScrollBehaviorOverride();
  });
}
