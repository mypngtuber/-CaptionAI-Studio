/* ===== Caption Editor: preview canvas, timeline, cue list, style bindings, autosave ===== */
'use strict';

const Editor = {
  projectId: null,
  projectName: 'مشروع بدون اسم',
  cues: [],
  style: DEFAULT_STYLE(),
  activeCueId: null,

  video: null,          // HTMLVideoElement (offscreen)
  videoURL: null,
  duration: 20,         // fallback duration when no video
  playing: false,
  time: 0,
  _raf: null,
  _lastTick: 0,
  aspect: 'source',

  canvas: null, ctx: null,

  init() {
    this.canvas = $('#ed-canvas');
    this.ctx = this.canvas.getContext('2d');

    this.video = document.createElement('video');
    this.video.playsInline = true; this.video.muted = false; this.video.crossOrigin = 'anonymous';
    this.video.addEventListener('loadedmetadata', () => {
      this.duration = this.video.duration;
      $('#ed-no-video').classList.add('hidden');
      this.resizeCanvas(); this.renderTimeline(); this.renderFrame();
    });
    this.video.addEventListener('ended', () => this.pause());

    // transport
    $('#ed-play').addEventListener('click', () => this.playing ? this.pause() : this.play());
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && $('#page-editor').classList.contains('active') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        e.preventDefault(); this.playing ? this.pause() : this.play();
      }
    });

    $('#ed-aspect').addEventListener('change', e => { this.aspect = e.target.value; this.resizeCanvas(); this.renderFrame(); });

    // timeline interactions
    this.initTimeline();

    // cue list
    $('#ed-add-cue').addEventListener('click', () => this.addCue());

    // import
    $('#ed-import-btn').addEventListener('click', () => $('#ed-import-input').click());
    $('#ed-import-input').addEventListener('change', e => { const f = e.target.files[0]; if (f) this.importFile(f); e.target.value = ''; });

    // drag & drop on canvas area
    const wrap = $('#ed-canvas-wrap');
    ['dragover', 'dragenter'].forEach(ev => wrap.addEventListener(ev, e => e.preventDefault()));
    wrap.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) this.importFile(f); });

    // canvas text dragging (custom position)
    this.initCanvasDrag();

    // style bindings
    this.bindStyleControls();
    this.renderStrokeLayers();
    this.renderPresets();

    // toolbar
    $('#ed-project-name').addEventListener('input', e => { this.projectName = e.target.value; this.autosave(); });
    $('#ed-template-save').addEventListener('click', () => this.saveAsTemplate());
    $('#ed-style-export').addEventListener('click', () => {
      U.download((this.projectName || 'style') + '.style.json', JSON.stringify({ type: 'capai-style', version: 1, style: this.style }, null, 2), 'application/json');
      toast('تم تصدير إعدادات التصميم ✔', 'ok');
    });
    $('#ed-style-import').addEventListener('click', () => $('#ed-style-import-input').click());
    $('#ed-style-import-input').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await U.readFileAsText(f));
        this.applyStyle(j.style || j);
        toast('تم استيراد إعدادات التصميم ✔', 'ok');
      } catch { toast('ملف غير صالح', 'err'); }
      e.target.value = '';
    });
    $('#ed-export-video').addEventListener('click', () => Exporter.open());

    window.addEventListener('resize', () => { this.resizeCanvas(); this.renderFrame(); });
    this.resizeCanvas();
    this.renderCueList();
    this.renderTimeline();
    this.renderFrame();
  },

  // ---------- Video ----------
  loadVideoFile(file) {
    if (this.videoURL) URL.revokeObjectURL(this.videoURL);
    this.videoURL = URL.createObjectURL(file);
    this.video.src = this.videoURL;
    this.video.load();
  },

  hasVideo() { return !!this.video.src && this.video.readyState >= 1; },

  // ---------- Canvas sizing ----------
  targetSize() {
    let w = 1080, h = 1920;
    if (this.aspect === 'source' && this.hasVideo()) { w = this.video.videoWidth; h = this.video.videoHeight; }
    else if (this.aspect === '16:9') { w = 1920; h = 1080; }
    else if (this.aspect === '1:1') { w = 1080; h = 1080; }
    else if (this.aspect === '9:16') { w = 1080; h = 1920; }
    else if (this.hasVideo()) { w = this.video.videoWidth; h = this.video.videoHeight; }
    return { w: w || 1080, h: h || 1920 };
  },

  resizeCanvas() {
    const { w, h } = this.targetSize();
    this.canvas.width = w; this.canvas.height = h;
    const wrap = $('#ed-canvas-wrap');
    const availW = wrap.clientWidth - 32, availH = wrap.clientHeight - 32;
    const scale = Math.min(availW / w, availH / h, 1);
    this.canvas.style.width = (w * scale) + 'px';
    this.canvas.style.height = (h * scale) + 'px';
  },

  // ---------- Playback ----------
  play() {
    this.playing = true;
    $('#ed-play-icon').className = 'fa-solid fa-pause';
    if (this.hasVideo()) { this.video.currentTime = this.time; this.video.play().catch(() => {}); }
    this._lastTick = performance.now();
    const loop = (now) => {
      if (!this.playing) return;
      if (this.hasVideo()) this.time = this.video.currentTime;
      else {
        this.time += (now - this._lastTick) / 1000;
        if (this.time >= this.duration) { this.time = 0; }
      }
      this._lastTick = now;
      this.renderFrame(); this.updatePlayhead();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  },

  pause() {
    this.playing = false;
    $('#ed-play-icon').className = 'fa-solid fa-play';
    if (this.hasVideo()) this.video.pause();
    cancelAnimationFrame(this._raf);
  },

  seek(t) {
    this.time = U.clamp(t, 0, this.duration);
    if (this.hasVideo()) this.video.currentTime = this.time;
    this.renderFrame(); this.updatePlayhead();
  },

  // ---------- Frame rendering ----------
  renderFrame() {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (this.hasVideo() && this.video.readyState >= 2) {
      // cover-fit video
      const vw = this.video.videoWidth, vh = this.video.videoHeight;
      const s = Math.max(W / vw, H / vh);
      const dw = vw * s, dh = vh * s;
      ctx.drawImage(this.video, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
    Renderer.draw(ctx, this.cues, this.style, this.time, W, H);
    $('#ed-time').textContent = `${U.fmtTime(this.time)} / ${U.fmtTime(this.duration)}`;
  },

  // ---------- Cues ----------
  loadCues(cues) {
    this.cues = cues;
    this.ensureAllWords();
    if (!this.hasVideo() && cues.length) this.duration = Math.max(...cues.map(c => c.end)) + 1;
    this.activeCueId = cues[0]?.id || null;
    this.projectId = this.projectId || U.uid();
    this.renderCueList(); this.renderTimeline(); this.renderFrame();
    this.autosave();
  },

  addCue() {
    const start = this.time;
    const cue = { id: U.uid(), start, end: Math.min(start + 2, this.duration), text: 'نص جديد', words: [] };
    this.regenWords(cue);
    this.cues.push(cue);
    this.cues.sort((a, b) => a.start - b.start);
    this.activeCueId = cue.id;
    if (!this.projectId) this.projectId = U.uid();
    this.renderCueList(); this.renderTimeline(); this.renderFrame(); this.autosave();
  },

  deleteCue(id) {
    this.cues = this.cues.filter(c => c.id !== id);
    if (this.activeCueId === id) this.activeCueId = null;
    this.renderCueList(); this.renderTimeline(); this.renderFrame(); this.autosave();
  },

  renderCueList() {
    const wrap = $('#ed-cue-list');
    $('#ed-cue-count').textContent = this.cues.length ? `(${this.cues.length})` : '';
    if (!this.cues.length) {
      wrap.innerHTML = '<p class="text-[11px] text-gray-500 text-center py-8">لا توجد جمل — استورد كابشن أو أضف جملة</p>';
      return;
    }
    wrap.innerHTML = '';
    for (const c of this.cues) {
      const div = document.createElement('div');
      div.className = 'cue-item' + (c.id === this.activeCueId ? ' active' : '');
      div.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="cue-time">${U.fmtTime(c.start)} → ${U.fmtTime(c.end)}</span>
          <button class="cue-del text-gray-600 hover:text-rose text-[10px]"><i class="fa-solid fa-trash"></i></button>
        </div>
        <textarea class="cue-text" rows="1">${c.text.replace(/</g, '&lt;')}</textarea>`;
      div.dataset.id = c.id;
      div.addEventListener('click', e => {
        if (e.target.closest('.cue-del')) return;
        const editingText = e.target.classList.contains('cue-text');
        // لا نعيد بناء القائمة حتى لا يفقد مربع النص الفوكس أثناء الكتابة
        this.setActiveCue(c.id, !editingText);
      });
      div.querySelector('.cue-del').addEventListener('click', () => this.deleteCue(c.id));
      const ta = div.querySelector('.cue-text');
      const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      ta.addEventListener('input', () => {
        c.text = ta.value;
        // النص تغيّر → توقيتات الكلمات القديمة لم تعد مطابقة — أعد توليدها تلقائياً
        this.regenWords(c);
        fit(); this.renderFrame(); this.updateTimelineCueLabel(c); this.autosaveDebounced();
      });
      setTimeout(fit, 0);
      wrap.appendChild(div);
    }
  },

  /** تفعيل جملة بدون إعادة بناء القائمة (حتى لا ينقطع الفوكس) */
  setActiveCue(id, seekToCue = false) {
    this.activeCueId = id;
    $$('#ed-cue-list .cue-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
    $$('#ed-timeline-track .tl-cue').forEach(el => el.classList.toggle('active', el.dataset.id === id));
    if (seekToCue) {
      const c = this.cues.find(x => x.id === id);
      if (c) this.seek(c.start + 0.05);
    }
  },

  /** تحديث نص مقطع التايملاين بدون إعادة بناء كاملة */
  updateTimelineCueLabel(cue) {
    const el = document.querySelector(`#ed-timeline-track .tl-cue[data-id="${cue.id}"] span`);
    if (el) el.textContent = cue.text.slice(0, 30);
  },

  /**
   * توليد/إعادة توليد توقيتات الكلمات تلقائياً (لملفات SRT/VTT أو بعد تعديل النص)
   * توزيع زمني متناسب مع طول كل كلمة — يجعل Karaoke (قالب تيك توك) يعمل دائماً
   */
  regenWords(cue) {
    const tokens = (cue.text || '').split(/\s+/).filter(Boolean);
    if (!tokens.length) { cue.words = []; return; }
    const dur = Math.max(cue.end - cue.start, 0.1);
    const totalLen = tokens.reduce((s, t) => s + Math.max(t.length, 2), 0);
    let t = cue.start;
    cue.words = tokens.map(tok => {
      const wDur = dur * Math.max(tok.length, 2) / totalLen;
      const w = { w: tok, s: +t.toFixed(3), e: +(t + wDur).toFixed(3) };
      t += wDur;
      return w;
    });
    cue._autoWords = true;
  },

  /** تأكد أن كل الجمل لديها توقيت كلمات (للمستورد من SRT/VTT بدون words) */
  ensureAllWords() {
    for (const c of this.cues) {
      if (!Array.isArray(c.words) || !c.words.length) this.regenWords(c);
      else if (c._autoWords) continue;
    }
  },

  // ---------- Timeline ----------
  initTimeline() {
    const tl = $('#ed-timeline');
    let dragMode = null, dragCue = null, startX = 0, origStart = 0, origEnd = 0;

    tl.addEventListener('mousedown', e => {
      const cueEl = e.target.closest('.tl-cue');
      const rect = tl.getBoundingClientRect();
      if (cueEl) {
        dragCue = this.cues.find(c => c.id === cueEl.dataset.id);
        this.activeCueId = dragCue.id;
        origStart = dragCue.start; origEnd = dragCue.end; startX = e.clientX;
        if (e.target.classList.contains('l')) dragMode = 'resize-l';
        else if (e.target.classList.contains('r')) dragMode = 'resize-r';
        else dragMode = 'move';
        this.renderCueList(); this.renderTimeline();
      } else {
        const t = ((e.clientX - rect.left) / rect.width);
        // RTL: timeline runs left→right in ltr terms; use physical left→right = time
        this.seek(t * this.duration);
        dragMode = 'scrub';
      }
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      if (!dragMode) return;
      const rect = tl.getBoundingClientRect();
      if (dragMode === 'scrub') {
        this.seek(((e.clientX - rect.left) / rect.width) * this.duration);
        return;
      }
      const dt = ((e.clientX - startX) / rect.width) * this.duration;
      if (dragMode === 'move') {
        const len = origEnd - origStart;
        dragCue.start = U.clamp(origStart + dt, 0, this.duration - len);
        dragCue.end = dragCue.start + len;
      } else if (dragMode === 'resize-l') {
        dragCue.start = U.clamp(origStart + dt, 0, dragCue.end - 0.2);
      } else if (dragMode === 'resize-r') {
        dragCue.end = U.clamp(origEnd + dt, dragCue.start + 0.2, this.duration);
      }
      this.renderTimeline(); this.renderFrame();
    });

    window.addEventListener('mouseup', () => {
      if (dragMode && dragMode !== 'scrub') {
        // إذا كانت توقيتات الكلمات مولّدة تلقائياً أعد توليدها حسب التوقيت الجديد
        if (dragCue && dragCue._autoWords) this.regenWords(dragCue);
        this.renderCueList(); this.autosave();
      }
      dragMode = null; dragCue = null;
    });
  },

  renderTimeline() {
    const track = $('#ed-timeline-track');
    track.innerHTML = '';
    const dur = Math.max(this.duration, 0.1);
    for (const c of this.cues) {
      const el = document.createElement('div');
      el.className = 'tl-cue' + (c.id === this.activeCueId ? ' active' : '');
      el.dataset.id = c.id;
      el.style.left = (c.start / dur * 100) + '%';
      el.style.width = Math.max((c.end - c.start) / dur * 100, 0.5) + '%';
      el.innerHTML = `<span style="pointer-events:none">${c.text.slice(0, 30).replace(/</g, '&lt;')}</span><div class="tl-handle l"></div><div class="tl-handle r"></div>`;
      track.appendChild(el);
    }
    this.updatePlayhead();
  },

  updatePlayhead() {
    $('#ed-playhead').style.left = (this.time / Math.max(this.duration, 0.1) * 100) + '%';
  },

  // ---------- Canvas drag (custom position) ----------
  initCanvasDrag() {
    let dragging = false;
    this.canvas.addEventListener('mousedown', e => {
      dragging = true;
      this.setStyleVal('position', 'custom');
      $$('#st-position button').forEach(b => b.classList.toggle('active', b.dataset.v === 'custom'));
      this.moveTo(e);
    });
    window.addEventListener('mousemove', e => dragging && this.moveTo(e));
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; this.autosave(); } });
  },
  moveTo(e) {
    const r = this.canvas.getBoundingClientRect();
    this.style.customX = U.clamp((e.clientX - r.left) / r.width, 0.05, 0.95);
    this.style.customY = U.clamp((e.clientY - r.top) / r.height, 0.05, 0.95);
    this.renderFrame();
  },

  // ---------- Import ----------
  async importFile(file) {
    const name = file.name.toLowerCase();
    try {
      if (/\.(mp4|webm|mov)$/.test(name) || file.type.startsWith('video')) {
        this.loadVideoFile(file);
        toast('تم تحميل الفيديو ✔', 'ok');
      } else if (name.endsWith('.srt')) {
        this.loadCues(U.parseSRT(await U.readFileAsText(file)));
        toast('تم استيراد SRT ✔', 'ok');
      } else if (name.endsWith('.vtt')) {
        this.loadCues(U.parseVTT(await U.readFileAsText(file)));
        toast('تم استيراد VTT ✔', 'ok');
      } else if (name.endsWith('.capai') || name.endsWith('.json')) {
        const j = JSON.parse(await U.readFileAsText(file));
        if (j.cues) {
          this.loadCues(j.cues);
          if (j.style) this.applyStyle(j.style);
          if (j.name) { this.projectName = j.name; $('#ed-project-name').value = j.name; }
          toast('تم استيراد المشروع ✔', 'ok');
        } else if (j.style) {
          this.applyStyle(j.style); toast('تم استيراد التصميم ✔', 'ok');
        } else toast('ملف JSON غير معروف', 'err');
      } else if (file.type.startsWith('audio')) {
        toast('لملفات الصوت استخدم صفحة "استخراج الكابشن"', 'info');
      } else toast('صيغة غير مدعومة', 'err');
    } catch (e) { console.error(e); toast('فشل الاستيراد: ' + e.message, 'err'); }
  },

  // ---------- Style bindings ----------
  bindStyleControls() {
    const bindRange = (id, key, fmt, post) => {
      const el = $('#' + id);
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        this.setStyleVal(key, v);
        const lbl = $('#v-' + key) || $('#v-' + id.replace('st-', ''));
        if (lbl) lbl.textContent = fmt ? fmt(v) : v;
        post?.(v);
      });
    };
    bindRange('st-fontSize', 'fontSize');
    bindRange('st-letterSpacing', 'letterSpacing');
    bindRange('st-lineHeight', 'lineHeight');
    bindRange('st-rotation', 'rotation', v => v + '°');
    bindRange('st-opacity', 'opacityPct', v => v + '%', v => this.setStyleVal('opacity', v / 100));
    bindRange('st-shadowBlur', 'shadowBlur');
    bindRange('st-shadowDist', 'shadowDist');
    bindRange('st-shadowOpacity', 'shadowOpacityPct', v => v + '%', v => this.setStyleVal('shadowOpacity', v / 100));
    bindRange('st-bgOpacity', 'bgOpacityPct', v => v + '%', v => this.setStyleVal('bgOpacity', v / 100));
    bindRange('st-bgRadius', 'bgRadius');
    bindRange('st-bgPadding', 'bgPadding');
    bindRange('st-animInDur', 'animInDur', v => v + 's');
    bindRange('st-animOutDur', 'animOutDur', v => v + 's');
    bindRange('st-animDelay', 'animDelay', v => v + 's');
    bindRange('st-animSpeed', 'animSpeed', v => v + 'x');
    bindRange('st-karaokeScale', 'karaokeScale');

    // fix mapping for labels with different ids
    const relabel = { 'st-opacity': 'v-opacity', 'st-shadowOpacity': 'v-shadowOpacity', 'st-bgOpacity': 'v-bgOpacity' };
    for (const [id, lbl] of Object.entries(relabel)) {
      $('#' + id).addEventListener('input', e => { $('#' + lbl).textContent = e.target.value + '%'; });
    }
    $('#st-shadowDist').addEventListener('input', e => $('#v-shadowDist').textContent = e.target.value);

    const bindSelect = (id, key, isNum) => $('#' + id).addEventListener('change', e => this.setStyleVal(key, isNum ? +e.target.value : e.target.value));
    bindSelect('st-font', 'fontFamily');
    $('#st-font').addEventListener('change', () => Fonts.ensureLoaded(this.style.fontFamily, this.style.fontWeight).then(() => this.renderFrame()));
    bindSelect('st-fontWeight', 'fontWeight', true);
    bindSelect('st-animIn', 'animIn');
    bindSelect('st-animOut', 'animOut');
    bindSelect('st-karaokeMode', 'karaokeMode');

    const bindColor = (id, key) => $('#' + id).addEventListener('input', e => this.setStyleVal(key, e.target.value));
    bindColor('st-color', 'color'); bindColor('st-grad1', 'grad1'); bindColor('st-grad2', 'grad2');
    bindColor('st-shadowColor', 'shadowColor'); bindColor('st-bgColor', 'bgColor');
    bindColor('st-bgGrad1', 'bgGrad1'); bindColor('st-bgGrad2', 'bgGrad2');
    bindColor('st-hlColor', 'hlColor'); bindColor('st-karaokeColor', 'karaokeColor'); bindColor('st-karaokeBg', 'karaokeBg');

    const bindCheck = (id, key, post) => $('#' + id).addEventListener('change', e => { this.setStyleVal(key, e.target.checked); post?.(e.target.checked); });
    bindCheck('st-gradientOn', 'gradientOn', v => $('#st-gradient-row').classList.toggle('hidden', !v));
    bindCheck('st-strokeOn', 'strokeOn');
    bindCheck('st-shadowOn', 'shadowOn');
    bindCheck('st-bgOn', 'bgOn');
    bindCheck('st-bgGradient', 'bgGradient', v => $('#st-bggrad-row').classList.toggle('hidden', !v));
    bindCheck('st-bgBlur', 'bgBlur');
    bindCheck('st-karaokeOn', 'karaokeOn');
    bindCheck('st-karaokeBgOn', 'karaokeBgOn');
    bindCheck('st-karaokeZoom', 'karaokeZoom');

    $('#st-hlWords').addEventListener('input', e => this.setStyleVal('hlWords', e.target.value));

    // segmented groups
    const segBind = (groupId, key) => {
      $$('#' + groupId + ' button').forEach(b => b.addEventListener('click', () => {
        $$('#' + groupId + ' button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.setStyleVal(key, b.dataset.v);
      }));
    };
    segBind('st-align', 'align');
    segBind('st-position', 'position');

    // stroke layers
    $('#stroke-add').addEventListener('click', () => {
      if (this.style.strokes.length >= 4) { toast('الحد الأقصى 4 طبقات', 'info'); return; }
      this.style.strokes.push({ color: '#7c6cff', width: 12 });
      this.renderStrokeLayers(); this.renderFrame(); this.autosaveDebounced();
    });

    // font upload / local (editor panel)
    $('#st-font-upload').addEventListener('click', () => $('#st-font-file').click());
    $('#st-font-file').addEventListener('change', async e => { await Fonts.uploadFonts(e.target.files); e.target.value = ''; });
    $('#st-font-local').addEventListener('click', () => Fonts.queryLocalFonts());

    // tabs
    $$('.style-tab').forEach(tab => tab.addEventListener('click', () => {
      $$('.style-tab').forEach(t => t.classList.remove('active'));
      $$('.style-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(`.style-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
    }));
  },

  setStyleVal(key, val) {
    if (key === 'opacityPct' || key === 'shadowOpacityPct' || key === 'bgOpacityPct') return; // handled via post
    this.style[key] = val;
    this.renderFrame();
    this.autosaveDebounced();
  },

  renderStrokeLayers() {
    const wrap = $('#stroke-layers');
    wrap.innerHTML = '';
    this.style.strokes.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'stroke-layer';
      row.innerHTML = `
        <input type="color" value="${s.color}">
        <input type="range" min="0" max="40" value="${s.width}">
        <span class="text-[10px] text-gray-400 w-6 text-center">${s.width}</span>
        <button class="sl-del"><i class="fa-solid fa-xmark"></i></button>`;
      const [colorEl, rangeEl, valEl, delBtn] = [row.children[0], row.children[1], row.children[2], row.children[3]];
      colorEl.addEventListener('input', e => { s.color = e.target.value; this.renderFrame(); this.autosaveDebounced(); });
      rangeEl.addEventListener('input', e => { s.width = +e.target.value; valEl.textContent = s.width; this.renderFrame(); this.autosaveDebounced(); });
      delBtn.addEventListener('click', () => { this.style.strokes.splice(i, 1); this.renderStrokeLayers(); this.renderFrame(); });
      wrap.appendChild(row);
    });
  },

  applyStyle(style) {
    this.style = { ...DEFAULT_STYLE(), ...style };
    if (!Array.isArray(this.style.strokes) || !this.style.strokes.length) this.style.strokes = [{ color: '#000000', width: 6 }];
    this.syncControlsFromStyle();
    this.renderFrame();
    Fonts.ensureLoaded(this.style.fontFamily, this.style.fontWeight).then(() => {
      this.renderFrame();
    });
    this.autosaveDebounced();
  },

  resetToDefaultStyle() {
    this.applyStyle(DEFAULT_STYLE());
    toast('تمت إزالة القالب والرجوع للتصميم الافتراضي ✔', 'ok');
  },

  syncControlsFromStyle() {
    const s = this.style;
    const set = (id, v) => { const el = $('#' + id); if (el) el.value = v; };
    const setChk = (id, v) => { const el = $('#' + id); if (el) el.checked = !!v; };
    set('st-font', s.fontFamily); set('st-fontSize', s.fontSize); set('st-fontWeight', s.fontWeight);
    set('st-letterSpacing', s.letterSpacing); set('st-lineHeight', s.lineHeight);
    set('st-rotation', s.rotation); set('st-opacity', Math.round(s.opacity * 100));
    set('st-color', s.color); setChk('st-gradientOn', s.gradientOn);
    set('st-grad1', s.grad1); set('st-grad2', s.grad2);
    $('#st-gradient-row').classList.toggle('hidden', !s.gradientOn);
    setChk('st-strokeOn', s.strokeOn);
    setChk('st-shadowOn', s.shadowOn); set('st-shadowColor', s.shadowColor);
    set('st-shadowBlur', s.shadowBlur); set('st-shadowDist', s.shadowDist); set('st-shadowOpacity', Math.round(s.shadowOpacity * 100));
    setChk('st-bgOn', s.bgOn); set('st-bgColor', s.bgColor); set('st-bgOpacity', Math.round(s.bgOpacity * 100));
    set('st-bgRadius', s.bgRadius); set('st-bgPadding', s.bgPadding);
    setChk('st-bgGradient', s.bgGradient); setChk('st-bgBlur', s.bgBlur);
    $('#st-bggrad-row').classList.toggle('hidden', !s.bgGradient);
    set('st-hlWords', s.hlWords); set('st-hlColor', s.hlColor);
    set('st-animIn', s.animIn); set('st-animOut', s.animOut);
    set('st-animInDur', s.animInDur); set('st-animOutDur', s.animOutDur);
    set('st-animDelay', s.animDelay); set('st-animSpeed', s.animSpeed);
    setChk('st-karaokeOn', s.karaokeOn); set('st-karaokeMode', s.karaokeMode);
    set('st-karaokeColor', s.karaokeColor); set('st-karaokeBg', s.karaokeBg);
    setChk('st-karaokeBgOn', s.karaokeBgOn); setChk('st-karaokeZoom', s.karaokeZoom);
    set('st-karaokeScale', s.karaokeScale);
    // labels
    $('#v-fontSize').textContent = s.fontSize; $('#v-letterSpacing').textContent = s.letterSpacing;
    $('#v-lineHeight').textContent = s.lineHeight; $('#v-rotation').textContent = s.rotation + '°';
    $('#v-opacity').textContent = Math.round(s.opacity * 100) + '%';
    $$('#st-align button').forEach(b => b.classList.toggle('active', b.dataset.v === s.align));
    $$('#st-position button').forEach(b => b.classList.toggle('active', b.dataset.v === s.position));
    this.renderStrokeLayers();
  },

  // ---------- Presets ----------
  PRESETS: [
    { name: '🔥 تيك توك / ريلز', style: { fontFamily: 'Cairo', fontSize: 72, fontWeight: 900, strokes: [{ color: '#000000', width: 8 }], karaokeOn: true, karaokeMode: 'highlight', karaokeColor: '#ffd23f', karaokeZoom: true, animIn: 'pop', animOut: 'fadeOut', shadowOn: true, shadowBlur: 12 } },
    { name: '⚡ هورموزي (Hormozi)', style: { fontFamily: 'Montserrat', fontSize: 76, fontWeight: 900, color: '#ffffff', strokes: [{ color: '#000000', width: 12 }], karaokeOn: true, karaokeMode: 'highlight', karaokeColor: '#00ff66', karaokeBg: '#000000', karaokeBgOn: true, karaokeZoom: true, karaokeScale: 1.2, animIn: 'pop', animOut: 'none' } },
    { name: '🏆 مستر بيست (MrBeast)', style: { fontFamily: 'Montserrat', fontSize: 74, fontWeight: 900, color: '#ffffff', strokes: [{ color: '#000000', width: 10 }], shadowOn: true, shadowColor: '#000000', shadowBlur: 16, shadowDist: 6, karaokeOn: true, karaokeMode: 'single-word', karaokeColor: '#ffe600', karaokeZoom: true, karaokeScale: 1.25, animIn: 'bounce' } },
    { name: '📰 وثائقي فوكس (Vox)', style: { fontFamily: 'IBM Plex Sans Arabic', fontSize: 60, fontWeight: 700, color: '#ffffff', bgOn: true, bgColor: '#ffcc00', bgOpacity: 0.95, bgRadius: 6, bgPadding: 14, strokeOn: false, shadowOn: false, animIn: 'slideUp', animOut: 'fadeOut' } },
    { name: '💜 نيون سايبر', style: { fontFamily: 'Changa', fontSize: 66, fontWeight: 800, color: '#ffffff', strokes: [{ color: '#7c6cff', width: 10 }, { color: '#2a1a6e', width: 20 }], shadowOn: true, shadowColor: '#7c6cff', shadowBlur: 30, shadowDist: 0, animIn: 'zoom' } },
    { name: '📦 صندوق عصري', style: { fontFamily: 'Tajawal', fontSize: 56, fontWeight: 700, bgOn: true, bgColor: '#11111a', bgOpacity: 0.85, bgRadius: 16, bgPadding: 20, strokeOn: false, shadowOn: false, animIn: 'slideUp' } },
    { name: '🌈 تدرج ديناميكي', style: { fontFamily: 'Almarai', fontSize: 70, fontWeight: 800, gradientOn: true, grad1: '#ff5c7a', grad2: '#7c6cff', strokes: [{ color: '#ffffff', width: 3 }], animIn: 'bounce' } },
    { name: '✍️ آلة كاتبة', style: { fontFamily: 'Amiri', fontSize: 60, fontWeight: 700, animIn: 'typing', animInDur: 1.2, strokeOn: false, shadowOn: true, shadowBlur: 6 } },
    { name: '⚡ جليتش حماسي', style: { fontFamily: 'Noto Kufi Arabic', fontSize: 64, fontWeight: 900, animIn: 'glitch', color: '#3ddc97', strokes: [{ color: '#000000', width: 6 }] } },
    { name: '🎬 سينمائي راقي', style: { fontFamily: 'El Messiri', fontSize: 52, fontWeight: 600, letterSpacing: 4, position: 'bottom', animIn: 'fade', animInDur: 0.8, animOut: 'fadeOut', strokeOn: false, shadowOn: true, shadowBlur: 14, shadowDist: 2 } },
    { name: '🤍 بسيط مينيمال', style: { fontFamily: 'Inter', fontSize: 54, fontWeight: 600, color: '#ffffff', strokeOn: true, strokes: [{ color: '#000000', width: 4 }], shadowOn: false, bgOn: false, animIn: 'fade', animOut: 'fadeOut' } }
  ],

  async renderPresets() {
    const wrap = $('#ed-presets');
    wrap.innerHTML = '';

    // Reset button: remove active template and restore original default style
    const resetBtn = document.createElement('button');
    resetBtn.className = 'preset-chip !border-rose/50 !text-rose hover:!bg-rose/20 font-bold';
    resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left ml-1"></i>الافتراضي (حذف القالب)';
    resetBtn.title = 'إلغاء القالب والرجوع للتصميم الأصلي الافتراضي';
    resetBtn.addEventListener('click', () => this.resetToDefaultStyle());
    wrap.appendChild(resetBtn);

    for (const p of this.PRESETS) {
      const b = document.createElement('button');
      b.className = 'preset-chip'; b.textContent = p.name;
      b.addEventListener('click', () => { this.applyStyle({ ...DEFAULT_STYLE(), ...p.style }); toast(`تم تطبيق قالب ${p.name}`, 'ok'); });
      wrap.appendChild(b);
    }
    // saved templates
    const saved = await Store.listTemplates();
    for (const t of saved) {
      const container = document.createElement('div');
      container.className = 'inline-flex items-center rounded-lg border border-mint/40 bg-base-800 shrink-0 text-xs';

      const b = document.createElement('button');
      b.className = 'px-2.5 py-1 text-white hover:text-mint transition flex items-center gap-1';
      b.innerHTML = `<i class="fa-solid fa-bookmark text-mint text-[10px]"></i><span>${t.name}</span>`;
      b.addEventListener('click', () => {
        try { this.applyStyle(JSON.parse(t.style)); toast(`تم تطبيق ${t.name}`, 'ok'); } catch { toast('قالب تالف', 'err'); }
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'px-1.5 py-1 text-gray-500 hover:text-rose transition border-r border-base-700/50';
      delBtn.title = 'حذف هذا القالب المحفوظ';
      delBtn.innerHTML = '<i class="fa-solid fa-xmark text-[11px]"></i>';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`هل أنت متأكد من حذف القالب "${t.name}"؟`)) {
          await Store.deleteTemplate(t.id);
          this.renderPresets();
          toast('تم حذف القالب ✔', 'ok');
        }
      });

      container.appendChild(b);
      container.appendChild(delBtn);
      wrap.appendChild(container);
    }
  },

  async saveAsTemplate() {
    const name = prompt('اسم القالب:', 'قالبي ' + new Date().toLocaleDateString('ar'));
    if (!name) return;
    await Store.saveTemplate({ id: U.uid(), name, style: JSON.stringify(this.style), created: Date.now() });
    this.renderPresets();
    toast('تم حفظ القالب ✔ (اضغط بزر الفأرة الأيمن على القالب لحذفه)', 'ok', 4500);
  },

  // ---------- Autosave ----------
  autosaveDebounced: null,
  autosave() {
    if (!this.projectId || (!this.cues.length && !this.hasVideo())) return;
    $('#ed-autosave-badge').innerHTML = '<i class="fa-solid fa-rotate fa-spin ml-1"></i>جاري الحفظ…';
    Store.saveProject({
      id: this.projectId,
      name: this.projectName || 'مشروع بدون اسم',
      kind: 'caption',
      data: JSON.stringify({ cues: this.cues, style: this.style }),
      thumb: '',
      updated: Date.now()
    }).then(ok => {
      $('#ed-autosave-badge').innerHTML = ok ? '<i class="fa-solid fa-cloud ml-1"></i>محفوظ' : '<i class="fa-solid fa-triangle-exclamation ml-1"></i>فشل الحفظ';
    });
  },

  async openProject(id) {
    const p = await Store.getProject(id);
    if (!p) { toast('المشروع غير موجود', 'err'); return; }
    this.projectId = p.id;
    this.projectName = p.name;
    $('#ed-project-name').value = p.name;
    try {
      const d = JSON.parse(p.data || '{}');
      this.cues = d.cues || [];
      if (d.style) this.applyStyle(d.style);
      if (!this.hasVideo() && this.cues.length) this.duration = Math.max(...this.cues.map(c => c.end)) + 1;
      this.activeCueId = this.cues[0]?.id || null;
      this.renderCueList(); this.renderTimeline(); this.renderFrame();
      App.goto('editor');
      toast('تم فتح المشروع — أعد استيراد الفيديو إن لزم (الفيديوهات لا تُحفظ مع المشروع)', 'info', 5000);
    } catch { toast('بيانات المشروع تالفة', 'err'); }
  }
};

Editor.autosaveDebounced = U.debounce(() => Editor.autosave(), 1500);
