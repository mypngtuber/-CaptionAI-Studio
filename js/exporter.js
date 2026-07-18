/* ===== Video Exporter: render video + captions to WebM/MP4 via MediaRecorder ===== */
'use strict';

const Exporter = {
  exporting: false,

  init() {
    $('#ex-start').addEventListener('click', () => this.start());
    $('#ex-resolution').addEventListener('change', e => $('#ex-custom-res').classList.toggle('hidden', e.target.value !== 'custom'));
    $('#ex-bg').addEventListener('change', e => {
      const v = e.target.value;
      $('#ex-bg-color').classList.toggle('hidden', v !== 'color');
      // الشفاف يتطلب WebM
      if (v === 'transparent') { $('#ex-format').value = 'webm'; $('#ex-format').disabled = true; }
      else $('#ex-format').disabled = false;
    });
    $('#ex-bitrate').addEventListener('input', e => $('#v-exBitrate').textContent = e.target.value);
    $$('.modal-close').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.add('hidden')));
    $('#export-modal').addEventListener('click', e => { if (e.target.id === 'export-modal' && !this.exporting) e.target.classList.add('hidden'); });
  },

  open() {
    if (!Editor.cues.length && !Editor.hasVideo()) { toast('لا يوجد محتوى للتصدير — استورد فيديو أو كابشن أولاً', 'err'); return; }
    // defaults from settings
    const ex = Store.settings.export;
    $('#ex-fps').value = ex.fps; $('#ex-bitrate').value = ex.bitrate; $('#v-exBitrate').textContent = ex.bitrate;
    $('#ex-format').value = this.mp4Supported() && ex.format === 'mp4' ? 'mp4' : 'webm';
    $('#ex-format').disabled = false;
    // إذا لا يوجد فيديو، اجعل الخلفية الخضراء هي الافتراضي
    if (!Editor.hasVideo()) $('#ex-bg').value = 'green';
    // support note
    $('#ex-support-note').textContent = this.mp4Supported()
      ? '✔ متصفحك يدعم MP4 (H.264) و WebM'
      : '⚠ متصفحك يدعم WebM فقط — MP4 سيتحول تلقائياً إلى WebM (تصدير MP4 متاح في Chrome/Edge الحديث)';
    $('#export-modal').classList.remove('hidden');
  },

  mp4Supported() {
    return typeof MediaRecorder !== 'undefined' &&
      (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2') || MediaRecorder.isTypeSupported('video/mp4'));
  },

  pickMime(fmt) {
    if (fmt === 'mp4') {
      for (const m of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'])
        if (MediaRecorder.isTypeSupported(m)) return { mime: m, ext: 'mp4' };
    }
    for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm'])
      if (MediaRecorder.isTypeSupported(m)) return { mime: m, ext: 'webm' };
    return null;
  },

  targetRes() {
    const v = $('#ex-resolution').value;
    if (v === '1080x1920') return { w: 1080, h: 1920 };
    if (v === '1920x1080') return { w: 1920, h: 1080 };
    if (v === 'custom') return { w: U.clamp(+$('#ex-res-w').value || 1080, 128, 4096), h: U.clamp(+$('#ex-res-h').value || 1920, 128, 4096) };
    return Editor.targetSize(); // source/preview
  },

  progress(pct, label) {
    $('#ex-progress').classList.remove('hidden');
    $('#ex-progress-bar').style.width = pct + '%';
    $('#ex-progress-pct').textContent = Math.round(pct) + '%';
    if (label) $('#ex-progress-label').textContent = label;
  },

  async start() {
    if (this.exporting) return;
    const fmt = $('#ex-format').value;
    const fps = +$('#ex-fps').value;
    const bitrate = +$('#ex-bitrate').value * 1_000_000;
    const picked = this.pickMime(fmt);
    if (!picked) { toast('متصفحك لا يدعم تسجيل الفيديو', 'err'); return; }
    if (fmt === 'mp4' && picked.ext === 'webm') toast('MP4 غير مدعوم في متصفحك — سيتم التصدير WebM', 'info', 4000);

    const { w: W, h: H } = this.targetRes();
    const btn = $('#ex-start');
    btn.disabled = true; this.exporting = true;
    Editor.pause();

    try {
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      const bgMode = $('#ex-bg').value; // video | green | transparent | color
      const bgColor = bgMode === 'green' ? '#00ff00' : bgMode === 'color' ? $('#ex-bg-color').value : '#000000';
      const useVideoBg = bgMode === 'video';

      const hasVideo = Editor.hasVideo();
      const v = Editor.video;
      const duration = hasVideo ? v.duration : Editor.duration;

      const stream = canvas.captureStream(fps);
      // include original audio track if video present AND we're using the video background
      // (createMediaElementSource can only be called ONCE per element — cache the graph)
      if (hasVideo && useVideoBg) {
        try {
          if (!this._audioGraph) {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const src = audioCtx.createMediaElementSource(v);
            const dest = audioCtx.createMediaStreamDestination();
            src.connect(dest);
            src.connect(audioCtx.destination);
            this._audioGraph = { audioCtx, dest };
          }
          if (this._audioGraph.audioCtx.state === 'suspended') await this._audioGraph.audioCtx.resume();
          this._audioGraph.dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
        } catch (e) { console.warn('audio capture failed', e); }
      }

      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 192_000 });
      recorder.ondataavailable = e => e.data.size && chunks.push(e.data);

      this.progress(0, 'جاري التصدير (تشغيل حقيقي Realtime)…');

      const drawFrame = (t) => {
        ctx.clearRect(0, 0, W, H);
        if (bgMode !== 'transparent') { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, W, H); }
        if (useVideoBg && hasVideo && v.readyState >= 2) {
          const s = Math.max(W / v.videoWidth, H / v.videoHeight);
          const dw = v.videoWidth * s, dh = v.videoHeight * s;
          ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
        }
        Renderer.draw(ctx, Editor.cues, Editor.style, t, W, H);
      };

      recorder.start(250);

      if (hasVideo && useVideoBg) {
        // realtime playback capture (keeps audio synced)
        v.currentTime = 0;
        await new Promise(r => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); });
        v.muted = false;
        await v.play();
        await new Promise(resolve => {
          const loop = () => {
            if (v.ended || v.currentTime >= duration - 0.05) { drawFrame(duration); resolve(); return; }
            drawFrame(v.currentTime);
            this.progress(v.currentTime / duration * 100);
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        });
        v.pause();
      } else {
        // captions on green/transparent/color background: simulated clock (realtime for MediaRecorder timing)
        const t0 = performance.now();
        await new Promise(resolve => {
          const loop = (now) => {
            const t = (now - t0) / 1000;
            if (t >= duration) { resolve(); return; }
            drawFrame(t);
            this.progress(t / duration * 100);
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        });
      }

      await new Promise(res => { recorder.onstop = res; recorder.stop(); });

      const blob = new Blob(chunks, { type: picked.mime.split(';')[0] });
      const name = (Editor.projectName || 'video').replace(/[\\/:*?"<>|]/g, '') + '.' + picked.ext;
      U.download(name, blob);
      this.progress(100, 'اكتمل ✔');
      toast(`تم تصدير ${name} ✔ (${U.fmtBytes(blob.size)})`, 'ok', 5000);
    } catch (e) {
      console.error(e);
      toast('فشل التصدير: ' + e.message, 'err', 6000);
    } finally {
      this.exporting = false;
      btn.disabled = false;
      setTimeout(() => $('#ex-progress').classList.add('hidden'), 1500);
    }
  }
};
