/* ===== App bootstrap: navigation, dashboard, settings, theme ===== */
'use strict';

const App = {
  init() {
    // navigation
    $$('#main-nav .nav-btn').forEach(b => b.addEventListener('click', () => this.goto(b.dataset.page)));
    $$('[data-goto]').forEach(b => b.addEventListener('click', () => this.goto(b.dataset.goto)));

    // theme
    $('#theme-toggle').addEventListener('click', () => this.toggleTheme());
    this.applyTheme(Store.settings.theme);

    // settings page
    this.initSettings();
    this.updateApiStatus();

    // dashboard
    $('#refresh-projects').addEventListener('click', () => this.renderProjects());
    this.renderProjects();

    // modules
    Fonts.init().then(() => {
      $('#st-font').value = Editor.style.fontFamily;
    });
    Generator.init();
    Editor.init();
    Exporter.init();
  },

  goto(page) {
    $$('#main-nav .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    $$('.page').forEach(p => p.classList.remove('active'));
    $('#page-' + page).classList.add('active');
    if (page === 'dashboard') this.renderProjects();
    if (page === 'editor') { Editor.resizeCanvas(); Editor.renderFrame(); }
  },

  // ---------- Theme ----------
  applyTheme(theme) {
    const isDark = theme !== 'light';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
    document.body.classList.toggle('bg-base-950', isDark);
    document.body.classList.toggle('text-gray-200', isDark);
    $('#theme-icon').className = isDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    $('#theme-label').textContent = isDark ? 'الوضع الداكن' : 'الوضع الفاتح';
    Store.settings.theme = isDark ? 'dark' : 'light';
    Store.save();
  },
  toggleTheme() { this.applyTheme(Store.settings.theme === 'light' ? 'dark' : 'light'); },

  // ---------- API status ----------
  updateApiStatus() {
    const has = !!Store.settings.apiKey;
    $('#api-dot').className = `w-2 h-2 rounded-full inline-block ${has ? 'bg-mint' : 'bg-rose'}`;
    $('#api-status-text').textContent = has ? `متصل · ${Store.settings.model}` : 'لم يتم ضبط API Key';
  },

  // ---------- Settings ----------
  initSettings() {
    $('#set-apikey').value = Store.settings.apiKey || '';
    $('#set-model').value = Store.settings.model;
    const ex = Store.settings.export;
    $('#set-resolution').value = ex.resolution;
    $('#set-fps').value = ex.fps;
    $('#set-bitrate').value = ex.bitrate; $('#v-bitrate').textContent = ex.bitrate;
    $('#set-format').value = ex.format;
    $('#set-res-w').value = ex.customW; $('#set-res-h').value = ex.customH;
    $('#set-custom-res').classList.toggle('hidden', ex.resolution !== 'custom');

    $('#set-apikey-toggle').addEventListener('click', () => {
      const inp = $('#set-apikey');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    $('#set-save-api').addEventListener('click', () => {
      Store.settings.apiKey = $('#set-apikey').value.trim();
      Store.settings.model = $('#set-model').value;
      Store.save();
      this.updateApiStatus();
      toast('تم حفظ إعدادات API ✔', 'ok');
    });

    $('#set-test-api').addEventListener('click', async () => {
      const res = $('#set-api-result');
      Store.settings.apiKey = $('#set-apikey').value.trim();
      Store.settings.model = $('#set-model').value;
      Store.save();
      if (!Store.settings.apiKey) { res.textContent = '✖ أدخل المفتاح أولاً'; res.className = 'text-xs self-center text-rose'; return; }
      res.textContent = '… جاري الاختبار'; res.className = 'text-xs self-center text-gray-400';
      try {
        await Gemini.testConnection();
        res.textContent = '✔ الاتصال ناجح'; res.className = 'text-xs self-center text-mint';
        this.updateApiStatus();
        toast('الاتصال بـ Gemini يعمل ✔', 'ok');
      } catch (e) {
        res.textContent = '✖ ' + e.message; res.className = 'text-xs self-center text-rose';
      }
    });

    $('#set-model').addEventListener('change', () => {
      Store.settings.model = $('#set-model').value;
      Store.save(); this.updateApiStatus();
    });

    // fonts management
    $('#set-font-upload').addEventListener('click', () => $('#set-font-file').click());
    $('#set-font-file').addEventListener('change', async e => { await Fonts.uploadFonts(e.target.files); e.target.value = ''; });
    $('#set-font-local').addEventListener('click', () => Fonts.queryLocalFonts());

    // export defaults
    $('#set-resolution').addEventListener('change', e => $('#set-custom-res').classList.toggle('hidden', e.target.value !== 'custom'));
    $('#set-bitrate').addEventListener('input', e => $('#v-bitrate').textContent = e.target.value);
    $('#set-save-export').addEventListener('click', () => {
      Store.settings.export = {
        resolution: $('#set-resolution').value,
        fps: +$('#set-fps').value,
        bitrate: +$('#set-bitrate').value,
        format: $('#set-format').value,
        customW: +$('#set-res-w').value || 1080,
        customH: +$('#set-res-h').value || 1920
      };
      Store.save();
      toast('تم حفظ إعدادات التصدير ✔', 'ok');
    });
  },

  // ---------- Dashboard projects ----------
  async renderProjects() {
    const grid = $('#projects-grid');
    const projects = await Store.listProjects();
    if (!projects.length) {
      grid.innerHTML = '<p class="text-sm text-gray-500 col-span-full py-8 text-center">لا توجد مشاريع بعد — ابدأ بإنشاء مشروع جديد من الأعلى ⬆</p>';
      return;
    }
    grid.innerHTML = '';
    for (const p of projects) {
      let cueCount = 0;
      try { cueCount = (JSON.parse(p.data || '{}').cues || []).length; } catch {}
      const card = document.createElement('article');
      card.className = 'project-card';
      card.innerHTML = `
        <div class="project-thumb">${p.thumb ? `<img src="${p.thumb}" alt="">` : `<i class="fa-solid ${p.kind === 'greenscreen' ? 'fa-clapperboard' : 'fa-closed-captioning'}"></i>`}</div>
        <div class="p-3">
          <div class="flex items-center justify-between gap-2">
            <h4 class="text-sm font-bold text-white truncate">${(p.name || 'بدون اسم').replace(/</g, '&lt;')}</h4>
            <button class="proj-del text-gray-600 hover:text-rose text-xs shrink-0"><i class="fa-solid fa-trash"></i></button>
          </div>
          <p class="text-[10px] text-gray-500 mt-1">${cueCount} جملة · ${new Date(p.updated || Date.now()).toLocaleDateString('ar-EG')} ${new Date(p.updated || Date.now()).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>`;
      card.addEventListener('click', e => {
        if (e.target.closest('.proj-del')) return;
        Editor.openProject(p.id);
      });
      card.querySelector('.proj-del').addEventListener('click', async () => {
        if (!confirm(`حذف المشروع "${p.name}"؟`)) return;
        await Store.deleteProject(p.id);
        this.renderProjects();
        toast('تم الحذف', 'info');
      });
      grid.appendChild(card);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
