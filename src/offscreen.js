// PageReel offscreen document — the service worker has no canvas/Image APIs,
// so tile stitching happens here instead.

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode captured tile.'));
    img.src = dataUrl;
  });
}

async function stitch({ tiles, viewportWidth, totalHeight, dpr }) {
  const width = Math.round(viewportWidth * dpr);
  const height = Math.round(totalHeight * dpr);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  for (const tile of tiles) {
    const img = await loadImage(tile.dataUrl);
    const destY = Math.round(tile.y * dpr);
    ctx.drawImage(img, 0, destY, img.naturalWidth, img.naturalHeight);
  }

  return { dataUrl: canvas.toDataURL('image/png'), width, height };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'PAGEREEL_STITCH') return false;
  stitch(msg)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
  return true;
});
