/* ===== Caption Generator page: upload -> extract audio -> Gemini -> results/export ===== */
'use strict';

const Generator = {
  file: null,
  fileURL: null,
  duration: 0,
  cues: [],

  init() {
    const dz = $('#dropzone'), input = $('#gen-file-input');
    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => input.files[0] && this.setFile(input.files[0]));
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) this.setFile(f); });

    $('#gen-file-remove').addEventListener('click', () => this.clearFile());
    $('#gen-start').addEventListener('click', () => this.start());
    $('#gen-open-editor').addEventListener('click', () => this.openInEditor());
    $$('#gen-export-panel .export-btn').forEach(b => b.addEventListener('click', () => this.export(b.dataset.fmt)));
  },

  setFile(file) {
    if (!/^(video|audio)\//.test(file.type) && !/\.(mp4|webm|mov|mp3|wav|m4a|ogg|aac)$/i.test(file.name)) {
      toast('صيغة الملف غير مدعومة', 'err'); return;
    }
    this.clearFile();
    this.file = file;
    this.fileURL = URL.createObjectURL(file);
    $('#gen-file-info').classList.remove('hidden');
    $('#gen-file-name').textContent = file.name;
    $('#gen-file-meta').textContent = `${U.fmtBytes(file.size)} · ${file.type || 'غير معروف'}`;

    const isVideo = file.type.startsWith('video') || /\.(mp4|webm|mov)$/i.test(file.name);
    const vid = $('#gen-preview'), aud = $('#gen-preview-audio');
    if (isVideo) {
      vid.src = this.fileURL; vid.classList.remove('hidden'); aud.classList.add('hidden');
      vid.onloadedmetadata = () => { this.duration = vid.duration; };
    } else {
      aud.src = this.fileURL; aud.classList.remove('hidden'); vid.classList.add('hidden');
      aud.onloadedmetadata = () => { this.duration = aud.duration; };
    }
    $('#gen-start').disabled = false;
  },

  clearFile() {
    if (this.fileURL) URL.revokeObjectURL(this.fileURL);
    this.file = null; this.fileURL = null; this.duration = 0;
    $('#gen-file-info').classList.add('hidden');
    $('#gen-preview').removeAttribute('src'); $('#gen-preview-audio').removeAttribute('src');
    $('#gen-start').disabled = true;
    $('#gen-file-input').value = '';
  },

  progress(pct, label) {
    $('#gen-progress').classList.remove('hidden');
    $('#gen-progress-bar').style.width = pct + '%';
    $('#gen-progress-pct').textContent = Math.round(pct) + '%';
    if (label) $('#gen-progress-label').textContent = label;
  },

  async start() {
    if (!this.file) return;
    if (!Store.settings.apiKey) {
      toast('يجب إضافة Gemini API Key أولاً من صفحة الإعدادات', 'err', 4500);
      App.goto('settings');
      return;
    }
    const btn = $('#gen-start');
    btn.disabled = true;
    try {
      const opts = {
        lang: $('#gen-lang').value,
        split: $('#gen-split').value,
        tashkeel: $('#gen-tashkeel').checked,
        punct: $('#gen-punct').checked,
        words: $('#gen-words').checked,
        emoji: $('#gen-emoji').checked,
        custom: $('#gen-custom').value.trim()
      };

      // 1) extract audio
      const { blob, duration } = await U.extractAudioWav(this.file, (p, l) => this.progress(p, l));
      this.duration = duration;

      // 2) Gemini
      const result = await Gemini.transcribe(blob, opts, duration, (p, l) => this.progress(p, l));
      this.cues = result.cues;
      this.renderResults();
      toast(`تم استخراج ${this.cues.length} مقطع كابشن بنجاح ✔`, 'ok');
    } catch (e) {
      console.error(e);
      if (e.message === 'NO_KEY') { toast('أضف API Key من الإعدادات', 'err'); App.goto('settings'); }
      else toast('فشل الاستخراج: ' + e.message, 'err', 6000);
      $('#gen-progress').classList.add('hidden');
    } finally {
      btn.disabled = false;
    }
  },

  renderResults() {
    const wrap = $('#gen-result');
    wrap.innerHTML = this.cues.map(c => `
      <div class="res-cue">
        <div class="rc-time">${U.srtTime(c.start)} → ${U.srtTime(c.end)}${c.words?.length ? ' · <i class="fa-solid fa-music"></i> word-level' : ''}</div>
        <div class="rc-text">${c.text.replace(/</g, '&lt;')}</div>
      </div>`).join('');
    $('#gen-result-actions').classList.remove('hidden');
    $('#gen-export-panel').classList.remove('hidden');
  },

  export(fmt) {
    if (!this.cues.length) return;
    const base = (this.file?.name || 'captions').replace(/\.[^.]+$/, '');
    if (fmt === 'srt') U.download(base + '.srt', U.toSRT(this.cues));
    else if (fmt === 'vtt') U.download(base + '.vtt', U.toVTT(this.cues));
    else if (fmt === 'json') U.download(base + '.timeline.json', U.toJSONTimeline(this.cues), 'application/json');
    else if (fmt === 'capai') {
      const proj = { version: 1, type: 'capai-project', name: base, cues: this.cues, style: Editor.style || DEFAULT_STYLE() };
      U.download(base + '.capai', JSON.stringify(proj, null, 2), 'application/json');
    }
    toast('تم التحميل ✔', 'ok');
  },

  openInEditor() {
    if (!this.cues.length) return;
    Editor.loadCues(JSON.parse(JSON.stringify(this.cues)));
    if (this.file && (this.file.type.startsWith('video') || /\.(mp4|webm|mov)$/i.test(this.file.name))) {
      Editor.loadVideoFile(this.file);
    }
    Editor.projectName = (this.file?.name || 'مشروع جديد').replace(/\.[^.]+$/, '');
    $('#ed-project-name').value = Editor.projectName;
    App.goto('editor');
    toast('تم فتح الكابشن في المحرر ✔', 'ok');
  }
};
