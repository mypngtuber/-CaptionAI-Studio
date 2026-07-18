/* ===== Chroma Key Web Worker: heavy per-pixel processing off the main thread ===== */
'use strict';

/**
 * message: { data: ArrayBuffer(RGBA), width, height, opts: {keyR,keyG,keyB,threshold,smooth,feather,spill,blur}, jobId }
 * returns processed RGBA buffer (transferable)
 */
self.onmessage = (e) => {
  const { data, width, height, opts, jobId } = e.data;
  const px = new Uint8ClampedArray(data);

  const { keyR, keyG, keyB, threshold, smooth, spill, feather, blur } = opts;

  // Convert key color to CbCr for robust chroma distance
  const kCb = 128 - 0.168736 * keyR - 0.331264 * keyG + 0.5 * keyB;
  const kCr = 128 + 0.5 * keyR - 0.418688 * keyG - 0.081312 * keyB;

  const n = width * height;
  const alpha = new Float32Array(n);

  const thLow = threshold * 255 * 0.7;
  const thHigh = thLow + Math.max(smooth * 255, 1);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const d = Math.sqrt((cb - kCb) * (cb - kCb) + (cr - kCr) * (cr - kCr));

    let a;
    if (d < thLow) a = 0;
    else if (d > thHigh) a = 1;
    else a = (d - thLow) / (thHigh - thLow);
    alpha[i] = a;
  }

  // Feather: box blur on alpha channel
  if (feather > 0) boxBlurAlpha(alpha, width, height, feather);

  // Blur edges: extra blur only on semi-transparent pixels
  if (blur > 0) {
    const soft = new Float32Array(alpha);
    boxBlurAlpha(soft, width, height, blur);
    for (let i = 0; i < n; i++) {
      if (alpha[i] > 0.02 && alpha[i] < 0.98) alpha[i] = soft[i];
    }
  }

  // Apply alpha + spill removal
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = alpha[i];
    px[o + 3] = Math.round(a * 255);
    if (a > 0 && spill > 0) {
      // suppress green spill: clamp green toward max(r, b)
      const r = px[o], g = px[o + 1], b = px[o + 2];
      const maxRB = Math.max(r, b);
      if (g > maxRB) px[o + 1] = Math.round(g - (g - maxRB) * spill);
    }
  }

  self.postMessage({ jobId, data: px.buffer, width, height }, [px.buffer]);
};

function boxBlurAlpha(alpha, w, h, radius) {
  const r = Math.round(radius);
  if (r <= 0) return;
  const tmp = new Float32Array(alpha.length);
  // horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    const cnt = 2 * r + 1;
    for (let x = -r; x <= r; x++) { const xi = Math.min(Math.max(x, 0), w - 1); acc += alpha[row + xi]; }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / cnt;
      const xOut = Math.min(Math.max(x - r, 0), w - 1);
      const xIn = Math.min(Math.max(x + r + 1, 0), w - 1);
      acc += alpha[row + xIn] - alpha[row + xOut];
    }
  }
  // vertical pass
  for (let x = 0; x < w; x++) {
    let acc = 0;
    const cnt = 2 * r + 1;
    for (let y = -r; y <= r; y++) { const yi = Math.min(Math.max(y, 0), h - 1); acc += tmp[yi * w + x]; }
    for (let y = 0; y < h; y++) {
      alpha[y * w + x] = acc / cnt;
      const yOut = Math.min(Math.max(y - r, 0), h - 1);
      const yIn = Math.min(Math.max(y + r + 1, 0), h - 1);
      acc += tmp[yIn * w + x] - tmp[yOut * w + x];
    }
  }
}
