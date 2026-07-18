/* ===== Storage: settings (localStorage) + projects/templates (Table API with localStorage fallback) ===== */
'use strict';

const Store = {
  KEY: 'capai_settings_v1',

  defaults: {
    apiKey: '',
    model: 'gemini-3.5-flash',
    theme: 'dark',
    export: { resolution: '1080x1920', fps: 30, bitrate: 8, format: 'webm', customW: 1080, customH: 1920 }
  },

  settings: null,

  load() {
    try { this.settings = { ...this.defaults, ...JSON.parse(localStorage.getItem(this.KEY) || '{}') }; }
    catch { this.settings = { ...this.defaults }; }
    this.settings.export = { ...this.defaults.export, ...(this.settings.export || {}) };
    return this.settings;
  },
  save() { localStorage.setItem(this.KEY, JSON.stringify(this.settings)); },

  // ---------- Projects (REST Table API, fallback to localStorage) ----------
  _lsKey: 'capai_projects_v1',
  _tplKey: 'capai_templates_v1',
  apiOk: true,

  async listProjects() {
    if (this.apiOk) {
      try {
        const r = await fetch('tables/projects?limit=50&sort=-updated');
        if (r.ok) { const j = await r.json(); return (j.data || []).filter(p => !p.deleted); }
        this.apiOk = false;
      } catch { this.apiOk = false; }
    }
    try { return JSON.parse(localStorage.getItem(this._lsKey) || '[]').sort((a, b) => b.updated - a.updated); } catch { return []; }
  },

  async saveProject(p) {
    p.updated = Date.now();
    if (this.apiOk) {
      try {
        const exists = await fetch(`tables/projects/${p.id}`);
        if (exists.ok) {
          const r = await fetch(`tables/projects/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
          if (r.ok) return true;
        } else {
          const r = await fetch('tables/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
          if (r.ok) return true;
        }
        this.apiOk = false;
      } catch { this.apiOk = false; }
    }
    // fallback
    try {
      const arr = JSON.parse(localStorage.getItem(this._lsKey) || '[]');
      const i = arr.findIndex(x => x.id === p.id);
      if (i >= 0) arr[i] = p; else arr.push(p);
      localStorage.setItem(this._lsKey, JSON.stringify(arr.slice(-30)));
      return true;
    } catch (e) { console.warn('saveProject fallback failed', e); return false; }
  },

  async deleteProject(id) {
    if (this.apiOk) {
      try { const r = await fetch(`tables/projects/${id}`, { method: 'DELETE' }); if (r.ok || r.status === 204) return true; this.apiOk = false; } catch { this.apiOk = false; }
    }
    try {
      const arr = JSON.parse(localStorage.getItem(this._lsKey) || '[]').filter(x => x.id !== id);
      localStorage.setItem(this._lsKey, JSON.stringify(arr));
      return true;
    } catch { return false; }
  },

  async getProject(id) {
    if (this.apiOk) {
      try { const r = await fetch(`tables/projects/${id}`); if (r.ok) return await r.json(); } catch { this.apiOk = false; }
    }
    try { return JSON.parse(localStorage.getItem(this._lsKey) || '[]').find(x => x.id === id) || null; } catch { return null; }
  },

  // ---------- Templates ----------
  async listTemplates() {
    if (this.apiOk) {
      try { const r = await fetch('tables/templates?limit=50'); if (r.ok) { const j = await r.json(); return (j.data || []).filter(t => !t.deleted); } } catch { this.apiOk = false; }
    }
    try { return JSON.parse(localStorage.getItem(this._tplKey) || '[]'); } catch { return []; }
  },

  async saveTemplate(t) {
    if (this.apiOk) {
      try { const r = await fetch('tables/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }); if (r.ok) return true; } catch { this.apiOk = false; }
    }
    try {
      const arr = JSON.parse(localStorage.getItem(this._tplKey) || '[]');
      arr.push(t); localStorage.setItem(this._tplKey, JSON.stringify(arr.slice(-40)));
      return true;
    } catch { return false; }
  },

  async deleteTemplate(id) {
    if (this.apiOk) {
      try { const r = await fetch(`tables/templates/${id}`, { method: 'DELETE' }); if (r.ok || r.status === 204) return true; } catch { this.apiOk = false; }
    }
    try {
      const arr = JSON.parse(localStorage.getItem(this._tplKey) || '[]').filter(x => x.id !== id);
      localStorage.setItem(this._tplKey, JSON.stringify(arr));
      return true;
    } catch { return false; }
  }
};

Store.load();
