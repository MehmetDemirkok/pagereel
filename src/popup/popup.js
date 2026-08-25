const btn = document.getElementById('capture-btn');
const btnLabel = document.getElementById('btn-label');
const inlineMsg = document.getElementById('inline-msg');
const speedInputs = document.querySelectorAll('input[name="speed"]');
const qualityHint = document.getElementById('quality-hint');
const privacyLink = document.getElementById('privacy-link');
const shortcutKeys = document.getElementById('shortcut-keys');
const shortcutEdit = document.getElementById('shortcut-edit');
const versionLabel = document.getElementById('version-label');

const UNSUPPORTED_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'devtools://'];

const SPEED_HINTS = {
  thorough: 'Waits longer for lazy-loaded content — most reliable.',
  fast: 'Captures quickly — best for simple, fully-loaded pages.'
};

function showError(text) {
  inlineMsg.textContent = text;
  inlineMsg.hidden = false;
}

function selectedSpeed() {
  return document.querySelector('input[name="speed"]:checked').value;
}

// Restore the saved speed choice, default to "thorough".
chrome.storage.local.get('speed').then(({ speed }) => {
  if (!speed) return;
  const input = document.querySelector(`input[name="speed"][value="${speed}"]`);
  if (input) {
    input.checked = true;
    qualityHint.textContent = SPEED_HINTS[speed] || SPEED_HINTS.thorough;
  }
});

speedInputs.forEach((input) => {
  input.addEventListener('change', () => {
    chrome.storage.local.set({ speed: input.value });
    qualityHint.textContent = SPEED_HINTS[input.value] || SPEED_HINTS.thorough;
  });
});

versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

function formatShortcut(text) {
  // "Ctrl+Shift+U" -> "⌃⇧U"-style compact keycap text stays readable cross-platform.
  return text
    .replace(/Command/g, '⌘')
    .replace(/Shift/g, '⇧')
    .replace(/Alt/g, '⌥')
    .replace(/\+/g, ' ');
}

chrome.commands.getAll().then((commands) => {
  const cmd = commands.find((c) => c.name === 'capture-full-page');
  if (cmd && cmd.shortcut) {
    shortcutKeys.textContent = formatShortcut(cmd.shortcut);
  } else {
    shortcutKeys.textContent = 'No shortcut set';
  }
});

shortcutEdit.addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

privacyLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('store/privacy-policy.html') });
});

btn.addEventListener('click', async () => {
  inlineMsg.hidden = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || UNSUPPORTED_PREFIXES.some((p) => tab.url.startsWith(p))) {
    showError("This page can't be captured — try a regular website.");
    return;
  }

  btn.disabled = true;
  btnLabel.textContent = 'Starting…';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'PAGEREEL_START',
      tabId: tab.id,
      windowId: tab.windowId,
      speed: selectedSpeed()
    });
    if (!response || !response.ok) {
      showError(response && response.error ? response.error : 'Could not start capture.');
      btn.disabled = false;
      btnLabel.textContent = 'Capture full page';
      return;
    }
    // Capture continues in the background/content script even after the
    // popup closes — progress is shown as an overlay on the page itself.
    window.close();
  } catch (err) {
    showError('Could not start capture. Reload the page and try again.');
    btn.disabled = false;
    btnLabel.textContent = 'Capture full page';
  }
});
