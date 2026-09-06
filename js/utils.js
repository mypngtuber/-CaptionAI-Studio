/* ===== CaptionAI Studio — Utilities ===== */
'use strict';

const U = {
  uid: () => 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),

  isRTL(text) {
    if (!text) return true;
    const arabicMatch = text.match(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g);
    const latinMatch = text.match(/[A-Za-z]/g);
    const arCount = arabicMatch ? arabicMatch.length : 0;
    const latCount = latinMatch ? latinMatch.length : 0;
    if (arCount === 0 && latCount > 0) return false;
    return arCount >= latCount;
  },

  fmtTime(s, withMs = true) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), sec = s % 60;
    return `${String(m).padStart(2, '0')}:${withMs ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0')}`;
  },

  srtTime(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  },
  vttTime(s) { return U.srtTime(s).replace(',', '.'); },

  parseTimecode(t) {
    // supports HH:MM:SS,mmm / HH:MM:SS.mmm / MM:SS.mmm
    const m = t.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
    if (!m) return 0;
    const h = m[1] ? +m[1] : 0;
    return h * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0').slice(0, 3)) / 1000;
  },

  // ---------- Caption format converters ----------
  toSRT(cues) {
    return cues.map((c, i) => `${i + 1}\n${U.srtTime(c.start)} --> ${U.srtTime(c.end)}\n${c.text}`).join('\n\n') + '\n';
  },
  toVTT(cues) {
    return 'WEBVTT\n\n' + cues.map(c => `${U.vttTime(c.start)} --> ${U.vttTime(c.end)}\n${c.text}`).join('\n\n') + '\n';
  },
  toJSONTimeline(cues) {
    return JSON.stringify({ version: 1, type: 'caption-timeline', generator: 'CaptionAI Studio', cues }, null, 2);
  },

  parseSRT(text) {
    const cues = [];
    const blocks = text.replace(/\r/g, '').split(/\n\n+/);
    for (const b of blocks) {
      const lines = b.trim().split('\n');
      const tlIdx = lines.findIndex(l => l.includes('-->'));
      if (tlIdx === -1) continue;
      const [s, e] = lines[tlIdx].split('-->');
      const txt = lines.slice(tlIdx + 1).join('\n').trim();
      if (txt) cues.push({ id: U.uid(), start: U.parseTimecode(s), end: U.parseTimecode(e), text: txt, words: [] });
    }
    return cues;
  },
  parseVTT(text) { return U.parseSRT(text.replace(/^WEBVTT.*?\n/, '')); },

  // ---------- Download helpers ----------
  download(filename, content, mime = 'text/plain') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  readFileAsText: (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }),
  readFileAsDataURL: (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }),
  readFileAsArrayBuffer: (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); }),

  fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  },

  // ---------- Audio extraction: decode media -> mono 16k WAV ----------
  async extractAudioWav(file, onProgress) {
    onProgress?.(5, 'قراءة الملف…');
    const buf = await U.readFileAsArrayBuffer(file);
    onProgress?.(15, 'فك ترميز الصوت…');
    const AC = window.AudioContext || window.webkitAudioContext;
    const probeCtx = new AC();
    let decoded;
    try { decoded = await probeCtx.decodeAudioData(buf.slice(0)); }
    finally { probeCtx.close(); }

    const targetRate = 16000;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
    const src = offline.createBufferSource();
    src.buffer = decoded; src.connect(offline.destination); src.start();
    onProgress?.(35, 'تحويل الصوت (mono 16kHz)…');
    const rendered = await offline.startRendering();
    onProgress?.(55, 'ترميز WAV…');
    const wav = U.encodeWav(rendered.getChannelData(0), targetRate);
    return { blob: wav, duration: decoded.duration };
  },

  encodeWav(samples, sampleRate) {
    const len = samples.length;
    const buffer = new ArrayBuffer(44 + len * 2);
    const v = new DataView(buffer);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, len * 2, true);
    let off = 44;
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  },

  blobToBase64: (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej; r.readAsDataURL(blob);
  }),

  hexToRgb(hex) {
    const m = hex.replace('#', '');
    return { r: parseInt(m.substr(0, 2), 16), g: parseInt(m.substr(2, 2), 16), b: parseInt(m.substr(4, 2), 16) };
  },
  hexWithAlpha(hex, alpha01) {
    const { r, g, b } = U.hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha01})`;
  },

  debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },

  // easing
  ease: {
    outCubic: t => 1 - Math.pow(1 - t, 3),
    outBack: t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outBounce: t => {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375;
      return n * (t -= 2.625 / d) * t + .984375;
    },
    inCubic: t => t * t * t,
    linear: t => t
  }
};

function toast(msg, type = 'info', dur = 3200) {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 350); }, dur);
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
