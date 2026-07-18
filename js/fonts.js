/* ===== Font management: bundled web fonts, local device fonts, custom TTF/OTF uploads ===== */
'use strict';

const Fonts = {
  // Google-hosted Arabic + Latin fonts included via <link>
  bundled: [
    'Cairo', 'Tajawal', 'Almarai', 'Changa', 'El Messiri', 'Amiri',
    'Reem Kufi', 'Lalezar', 'Noto Kufi Arabic', 'IBM Plex Sans Arabic',
    'Inter', 'Montserrat', 'Bebas Neue', 'Arial', 'Tahoma', 'Segoe UI'
  ],
  local: [],   // from Local Font Access API
  custom: [],  // uploaded { name, dataUrl }

  CUSTOM_KEY: 'capai_custom_fonts_v1',

  async init() {
    // restore custom fonts from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem(this.CUSTOM_KEY) || '[]');
      for (const f of saved) await this._registerCustom(f.name, f.dataUrl, false);
    } catch (e) { console.warn('custom fonts restore failed', e); }
    this.refreshSelects();
  },

  all() {
    const seen = new Set();
    const out = [];
    for (const f of [...this.custom.map(c => c.name), ...this.bundled, ...this.local]) {
      if (!seen.has(f)) { seen.add(f); out.push(f); }
    }
    return out;
  },

  async queryLocalFonts() {
    if (!('queryLocalFonts' in window)) {
      toast('متصفحك لا يدعم قراءة خطوط الجهاز (متوفر في Chrome/Edge). يمكنك رفع الخطوط يدوياً.', 'err', 4500);
      return;
    }
    try {
      const fonts = await window.queryLocalFonts();
      const fams = new Set();
      for (const f of fonts) fams.add(f.family);
      this.local = [...fams].sort();
      this.refreshSelects();
      toast(`تم العثور على ${this.local.length} خط من الجهاز ✔`, 'ok');
    } catch (e) {
      toast('تم رفض الإذن لقراءة خطوط الجهاز', 'err');
    }
  },

  async uploadFonts(fileList) {
    for (const file of fileList) {
      try {
        const dataUrl = await U.readFileAsDataURL(file);
        const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[_-]+/g, ' ');
        await this._registerCustom(name, dataUrl, true);
        toast(`تم تثبيت الخط: ${name} ✔`, 'ok');
      } catch (e) {
        console.error(e);
        toast(`فشل تحميل الخط: ${file.name}`, 'err');
      }
    }
    this.refreshSelects();
  },

  async _registerCustom(name, dataUrl, persist) {
    const face = new FontFace(name, `url(${dataUrl})`);
    await face.load();
    document.fonts.add(face);
    if (!this.custom.find(c => c.name === name)) this.custom.push({ name, dataUrl });
    if (persist) {
      try { localStorage.setItem(this.CUSTOM_KEY, JSON.stringify(this.custom)); }
      catch { toast('الخط كبير جداً للحفظ الدائم — سيعمل في هذه الجلسة فقط', 'info', 4000); }
    }
  },

  removeCustom(name) {
    this.custom = this.custom.filter(c => c.name !== name);
    try { localStorage.setItem(this.CUSTOM_KEY, JSON.stringify(this.custom)); } catch {}
    this.refreshSelects();
  },

  refreshSelects() {
    const sel = document.getElementById('st-font');
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = this.all().map(f => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('');
      if (cur && this.all().includes(cur)) sel.value = cur;
    }
    // settings page list
    const list = document.getElementById('set-fonts-list');
    if (list) {
      if (!this.custom.length) {
        list.innerHTML = '<p class="text-[11px] text-gray-500">لا توجد خطوط مخصصة مرفوعة بعد</p>';
      } else {
        list.innerHTML = this.custom.map(c => `
          <div class="flex items-center justify-between bg-base-800 rounded-lg px-3 py-2">
            <span class="text-xs font-bold" style="font-family:'${c.name}'">${c.name} — نموذج معاينة Aa بج</span>
            <button class="text-gray-500 hover:text-rose text-xs" onclick="Fonts.removeCustom('${c.name.replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash"></i></button>
          </div>`).join('');
      }
    }
  },

  async ensureLoaded(family, weight = 700, px = 64) {
    try { await document.fonts.load(`${weight} ${px}px '${family}'`); } catch {}
  }
};
