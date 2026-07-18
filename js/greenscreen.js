/* ===== Green Screen (Chroma Key) tool: live preview + WebM Alpha / PNG sequence export ===== */
'use strict';

const GreenScreen = {
  file: null,
  fileURL: null,
  video: null,
  canvas: null, ctx: null,
  worker: null,
  _jobId: 0,
  _busy: false,
  _previewRaf: null,
  _cancelled: false,

  opts() {
    const { r, g, b } = U.hexToRgb($('#gs-keyColor').value);
    return {
      keyR: r, keyG: g, keyB: b,
      threshold: parseFloat($('#gs-threshold').value),
      smooth: parseFloat($('#gs-smooth').value),
      feather: parseInt($('#gs-feather').value),
      spill: parseFloat($('#gs-spill').value),
      blur: parseInt($('#gs-blur').value)
    };
  },

  init() {
    this.video = $('#gs-video');
    this.canvas = $('#gs-canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    try { this.worker = new Worker('js/workers/chroma-worker.js'); }
    catch (e) { console.warn('Worker failed, will process on main thread', e); }

    // dropzone
    const dz = $('#gs-dropzone'), input = $('#gs-file-input');
    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => input.files[0] && this.setFile(input.files[0]));
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) this.setFile(f); });

    // live preview loop while playing/seeking
    this.video.addEventListener('loadeddata', () => { this.syncCanvasSize(); this.processCurrentFrame(); this.enableExports(); });
    this.video.addEventListener('seeked', () => this.processCurrentFrame());
    this.video.addEventListener('play', () => this.startPreviewLoop());
    this.video.addEventListener('pause', () => this.stopPreviewLoop());

    // settings changes -> re-render current frame
    const relabel = { 'gs-threshold': ['v-gsThreshold', v => (+v).toFixed(2)], 'gs-smooth': ['v-gsSmooth', v => (+v).toFixed(2)], 'gs-feather': ['v-gsFeather', v => v], 'gs-spill': ['v-gsSpill', v => v], 'gs-blur': ['v-gsBlur', v => v] };
    for (const [id, [lbl, fmt]] of Object.entries(relabel)) {
      $('#' + id).addEventListener('input', e => { $('#' + lbl).textContent = fmt(e.target.value); this.processCurrentFrame(); });
    }
    $('#gs-keyColor').addEventListener('input', () => this.processCurrentFrame());

    // eyedropper: pick key color by clicking the original video after activating
    $('#gs-pick-color').addEventListener('click', () => {
      toast('اضغط على مكان اللون الأخضر في الفيديو الأصلي لالتقاطه', 'info', 4000);
      const pick = (e) => {
        const r = this.video.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left) / r.width * this.video.videoWidth);
        const y = Math.floor((e.clientY - r.top) / r.height * this.video.videoHeight);
        const c = document.createElement('canvas');
        c.width = this.video.videoWidth; c.height = this.video.videoHeight;
        const cctx = c.getContext('2d');
        cctx.drawImage(this.video, 0, 0);
        const d = cctx.getImageData(x, y, 1, 1).data;
        const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
        $('#gs-keyColor').value = hex;
        this.processCurrentFrame();
        toast('تم التقاط اللون: ' + hex, 'ok');
        this.video.removeEventListener('click', pick);
      };
      this.video.addEventListener('click', pick);
    });

    // exports
    $('#gs-export-webm').addEventListener('click', () => this.exportWebmAlpha());
    $('#gs-export-png').addEventListener('click', () => this.exportPngSequence());
    $('#gs-export-frame').addEventListener('click', () => this.exportCurrentFrame());
    $('#gs-cancel').addEventListener('click', () => { this._cancelled = true; });
  },

  setFile(file) {
    if (!file.type.startsWith('video') && !/\.(mp4|webm|mov)$/i.test(file.name)) { toast('ارفع ملف فيديو', 'err'); return; }
    if (this.fileURL) URL.revokeObjectURL(this.fileURL);
    this.file = file;
    this.fileURL = URL.createObjectURL(file);
    this.video.src = this.fileURL;
    this.video.load();
    toast('تم تحميل الفيديو — اضبط الإعدادات وشاهد المعاينة الحية', 'ok');
  },

  enableExports() {
    ['gs-export-webm', 'gs-export-png', 'gs-export-frame'].forEach(id => $('#' + id).disabled = false);
  },

  syncCanvasSize() {
    // limit preview processing size for speed; exports use full/limited size separately
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const maxW = 640;
    const s = Math.min(1, maxW / vw);
    this.canvas.width = Math.round(vw * s);
    this.canvas.height = Math.round(vh * s);
  },

  startPreviewLoop() {
    const loop = () => {
      if (this.video.paused || this.video.ended) return;
      this.processCurrentFrame();
      this._previewRaf = requestAnimationFrame(loop);
    };
    this._previewRaf = requestAnimationFrame(loop);
  },
  stopPreviewLoop() { cancelAnimationFrame(this._previewRaf); },

  /** Draw current video frame, chroma-key it (worker), paint result on preview canvas */
  processCurrentFrame() {
    if (!this.video.videoWidth || this._busy) return;
    this._busy = true;
    const W = this.canvas.width, H = this.canvas.height;
    this.ctx.drawImage(this.video, 0, 0, W, H);
    const img = this.ctx.getImageData(0, 0, W, H);
    this.keyFrame(img.data.buffer, W, H).then(buf => {
      this.ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), W, H), 0, 0);
      this._busy = false;
    }).catch(() => { this._busy = false; });
  },

  /** Chroma-key one RGBA buffer via worker (falls back to sync) */
  keyFrame(buffer, w, h, optsOverride) {
    const opts = optsOverride || this.opts();
    if (!this.worker) return Promise.resolve(this.keyFrameSync(buffer, w, h, opts));
    return new Promise((resolve, reject) => {
      const jobId = ++this._jobId;
      const onMsg = (e) => {
        if (e.data.jobId !== jobId) return;
        this.worker.removeEventListener('message', onMsg);
        resolve(e.data.data);
      };
      this.worker.addEventListener('message', onMsg);
      this.worker.addEventListener('error', reject, { once: true });
      this.worker.postMessage({ data: buffer, width: w, height: h, opts, jobId }, [buffer]);
    });
  },

  keyFrameSync(buffer, w, h, opts) {
    // minimal fallback (no feather/blur) if Worker unavailable
    const px = new Uint8ClampedArray(buffer);
    const kCb = 128 - 0.168736 * opts.keyR - 0.331264 * opts.keyG + 0.5 * opts.keyB;
    const kCr = 128 + 0.5 * opts.keyR - 0.418688 * opts.keyG - 0.081312 * opts.keyB;
    const thLow = opts.threshold * 255 * 0.7, thHigh = thLow + Math.max(opts.smooth * 255, 1);
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const d = Math.hypot(cb - kCb, cr - kCr);
      let a = d < thLow ? 0 : d > thHigh ? 1 : (d - thLow) / (thHigh - thLow);
      px[i + 3] = a * 255;
      const maxRB = Math.max(r, b);
      if (a > 0 && opts.spill > 0 && g > maxRB) px[i + 1] = g - (g - maxRB) * opts.spill;
    }
    return px.buffer;
  },

  progress(pct, label) {
    $('#gs-progress').classList.remove('hidden');
    $('#gs-progress-bar').style.width = pct + '%';
    $('#gs-progress-pct').textContent = Math.round(pct) + '%';
    if (label) $('#gs-progress-label').textContent = label;
  },
  progressDone() { setTimeout(() => $('#gs-progress').classList.add('hidden'), 800); },

  /** Step through the whole video frame by frame, calling cb(canvas, time) */
  async forEachFrame(fps, maxW, cb) {
    const v = this.video;
    v.pause();
    this._cancelled = false;
    const dur = v.duration;
    const total = Math.floor(dur * fps);
    const s = Math.min(1, maxW / v.videoWidth);
    const W = Math.round(v.videoWidth * s), H = Math.round(v.videoHeight * s);
    const work = document.createElement('canvas');
    work.width = W; work.height = H;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    const opts = this.opts();

    const seekTo = (t) => new Promise(res => {
      const on = () => { v.removeEventListener('seeked', on); res(); };
      v.addEventListener('seeked', on);
      v.currentTime = Math.min(t, dur - 0.001);
    });

    for (let i = 0; i < total; i++) {
      if (this._cancelled) throw new Error('CANCELLED');
      await seekTo(i / fps);
      wctx.drawImage(v, 0, 0, W, H);
      const img = wctx.getImageData(0, 0, W, H);
      const buf = await this.keyFrame(img.data.buffer, W, H, opts);
      wctx.putImageData(new ImageData(new Uint8ClampedArray(buf), W, H), 0, 0);
      await cb(work, i, total);
      this.progress((i + 1) / total * 100);
    }
    return { W, H, total };
  },

  // ---------- Export: WebM with alpha (VP9/VP8) ----------
  async exportWebmAlpha() {
    if (!this.video.videoWidth) return;
    const fps = +$('#gs-fps').value;
    const mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = mimes.find(m => MediaRecorder.isTypeSupported(m));
    if (!mime) { toast('متصفحك لا يدعم تسجيل WebM', 'err'); return; }

    this.progress(0, 'تصدير WebM Alpha…');
    try {
      // record from a canvas stream; browser keeps alpha in VP9/VP8 when canvas has transparency
      const out = document.createElement('canvas');
      const octx = out.getContext('2d');
      let inited = false, recorder, chunks = [], stream, track;

      await this.forEachFrame(fps, 1280, async (frameCanvas) => {
        if (!inited) {
          out.width = frameCanvas.width; out.height = frameCanvas.height;
          stream = out.captureStream(0);
          track = stream.getVideoTracks()[0];
          recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
          recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
          recorder.start();
          inited = true;
        }
        octx.clearRect(0, 0, out.width, out.height);
        octx.drawImage(frameCanvas, 0, 0);
        if (track.requestFrame) track.requestFrame();
        await new Promise(r => setTimeout(r, 1000 / fps / 4)); // pacing
      });

      await new Promise(res => { recorder.onstop = res; recorder.stop(); });
      const blob = new Blob(chunks, { type: 'video/webm' });
      U.download((this.file?.name || 'greenscreen').replace(/\.[^.]+$/, '') + '-alpha.webm', blob);
      toast('تم تصدير WebM Alpha ✔', 'ok');
    } catch (e) {
      if (e.message === 'CANCELLED') toast('تم الإلغاء', 'info');
      else { console.error(e); toast('فشل التصدير: ' + e.message, 'err'); }
    }
    this.progressDone();
  },

  // ---------- Export: PNG sequence (ZIP) ----------
  async exportPngSequence() {
    if (!this.video.videoWidth) return;
    const fps = +$('#gs-fps').value;
    const dur = this.video.duration;
    const est = Math.floor(dur * fps);
    if (est > 900 && !confirm(`سيتم إنشاء ${est} صورة PNG — قد يستغرق وقتاً وذاكرة كبيرة. متابعة؟`)) return;

    this.progress(0, 'تصدير PNG Sequence…');
    try {
      const zip = new JSZip();
      const folder = zip.folder('png_sequence');
      await this.forEachFrame(fps, 1280, async (frameCanvas, i) => {
        const blob = await new Promise(r => frameCanvas.toBlob(r, 'image/png'));
        folder.file(`frame_${String(i).padStart(5, '0')}.png`, blob);
      });
      this.progress(99, 'ضغط ZIP…');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      U.download((this.file?.name || 'frames').replace(/\.[^.]+$/, '') + '-png-sequence.zip', zipBlob);
      toast('تم تصدير PNG Sequence ✔', 'ok');
    } catch (e) {
      if (e.message === 'CANCELLED') toast('تم الإلغاء', 'info');
      else { console.error(e); toast('فشل التصدير: ' + e.message, 'err'); }
    }
    this.progressDone();
  },

  // ---------- Export: single frame PNG ----------
  async exportCurrentFrame() {
    if (!this.video.videoWidth) return;
    // full-resolution single frame
    const W = this.video.videoWidth, H = this.video.videoHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cctx = c.getContext('2d');
    cctx.drawImage(this.video, 0, 0, W, H);
    const img = cctx.getImageData(0, 0, W, H);
    const buf = await this.keyFrame(img.data.buffer, W, H);
    cctx.putImageData(new ImageData(new Uint8ClampedArray(buf), W, H), 0, 0);
    c.toBlob(b => { U.download('frame-alpha.png', b); toast('تم تصدير الفريم ✔', 'ok'); }, 'image/png');
  }
};
