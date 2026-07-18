/* ===== Gemini API integration: audio -> timed captions ===== */
'use strict';

const Gemini = {
  BASE: 'https://generativelanguage.googleapis.com',

  get key() { return Store.settings.apiKey; },
  get model() { return Store.settings.model || 'gemini-3.5-flash'; },

  async testConnection() {
    const r = await fetch(`${this.BASE}/v1beta/models/${this.model}:generateContent?key=${this.key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'قل "تم" فقط' }] }] })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${r.status}`);
    }
    return true;
  },

  /**
   * Upload big audio via the Files API (resumable), returns file uri.
   */
  async uploadFile(blob, onProgress) {
    onProgress?.(60, 'رفع الصوت إلى Gemini…');
    const startRes = await fetch(`${this.BASE}/upload/v1beta/files?key=${this.key}`, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': blob.size,
        'X-Goog-Upload-Header-Content-Type': blob.type || 'audio/wav',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: 'capai-audio' } })
    });
    if (!startRes.ok) throw new Error('فشل بدء رفع الملف: HTTP ' + startRes.status);
    const uploadUrl = startRes.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) throw new Error('لم يتم الحصول على رابط الرفع');

    const upRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' },
      body: blob
    });
    if (!upRes.ok) throw new Error('فشل رفع الملف: HTTP ' + upRes.status);
    const info = await upRes.json();
    let file = info.file;

    // wait until ACTIVE
    let tries = 0;
    while (file.state === 'PROCESSING' && tries < 30) {
      await new Promise(r => setTimeout(r, 2000));
      const st = await fetch(`${this.BASE}/v1beta/${file.name}?key=${this.key}`);
      file = await st.json();
      tries++;
      onProgress?.(65, 'معالجة الملف على خوادم Google…');
    }
    if (file.state !== 'ACTIVE') throw new Error('فشلت معالجة الملف على الخادم');
    return file;
  },

  buildPrompt(opts, duration) {
    const langMap = {
      'ar': 'العربية بجميع لهجاتها — اكتب النص كما نُطق باللهجة الأصلية',
      'ar-eg': 'العربية باللهجة المصرية — اكتب كما نُطق',
      'ar-sa': 'العربية باللهجة الخليجية — اكتب كما نُطق',
      'ar-lev': 'العربية باللهجة الشامية — اكتب كما نُطق',
      'ar-ma': 'العربية باللهجة المغاربية — اكتب كما نُطق',
      'en': 'English',
      'auto': 'اكتشف اللغة تلقائياً واكتب بها'
    };
    const splitMap = {
      'natural': 'قسّم الجمل بشكل طبيعي حسب المعنى والتوقف في الكلام (جملة كاملة المعنى لكل مقطع، بحد أقصى 12 كلمة)',
      'short': 'قسّم إلى مقاطع قصيرة جداً مناسبة لفيديوهات Shorts/TikTok (4-7 كلمات لكل مقطع)',
      'word3': 'قسّم إلى مقاطع من 3-4 كلمات فقط لكل مقطع'
    };
    let p = `أنت خبير تفريغ صوتي (Transcription) محترف. استمع للمقطع الصوتي التالي بعناية فائقة وفرّغه إلى نص كابشن مع التوقيتات الدقيقة.

القواعد:
- اللغة: ${langMap[opts.lang] || langMap['ar']}.
- ${splitMap[opts.split] || splitMap['natural']}.
- ${opts.punct ? 'أضف علامات الترقيم المناسبة (، . ؟ !).' : 'بدون علامات ترقيم.'}
- ${opts.tashkeel ? 'أضف التشكيل الكامل للنص العربي.' : 'بدون تشكيل.'}
- ${opts.emoji ? 'أضف إيموجي واحدة مناسبة للمعنى في نهاية بعض المقاطع المهمة (ليس كلها).' : ''}
- حافظ على معنى الكلام تماماً كما قيل — لا تلخص ولا تعيد الصياغة.
- التوقيتات بالثواني (أرقام عشرية) ويجب أن تكون دقيقة ومتطابقة مع الكلام الفعلي.
- مدة المقطع الصوتي الكلية: ${duration ? duration.toFixed(1) + ' ثانية' : 'غير معروفة'} — لا تتجاوزها.
- يجب ألا تتداخل المقاطع زمنياً.`;
    if (opts.words) p += `
- لكل مقطع، أعطِ توقيت بداية ونهاية كل كلمة على حدة في مصفوفة words (لنظام Karaoke).`;
    if (opts.custom) p += `
- تعليمات إضافية من المستخدم: ${opts.custom}`;
    p += `

أرجع النتيجة بصيغة JSON فقط بهذا الشكل:
{"language":"ar","segments":[{"start":0.0,"end":2.5,"text":"النص هنا"${opts.words ? ',"words":[{"w":"النص","s":0.0,"e":0.8},{"w":"هنا","s":0.9,"e":1.4}]' : ''}}]}`;
    return p;
  },

  /**
   * Transcribe audio blob -> [{id,start,end,text,words:[{w,s,e}]}]
   */
  async transcribe(audioBlob, opts, duration, onProgress) {
    if (!this.key) throw new Error('NO_KEY');

    let audioPart;
    if (audioBlob.size > 14 * 1024 * 1024) {
      const file = await this.uploadFile(audioBlob, onProgress);
      audioPart = { file_data: { mime_type: file.mimeType || 'audio/wav', file_uri: file.uri } };
    } else {
      onProgress?.(60, 'تجهيز الصوت للإرسال…');
      const b64 = await U.blobToBase64(audioBlob);
      audioPart = { inline_data: { mime_type: 'audio/wav', data: b64 } };
    }

    onProgress?.(70, `جاري الاستخراج بواسطة ${this.model}…`);

    const body = {
      contents: [{ parts: [{ text: this.buildPrompt(opts, duration) }, audioPart] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        maxOutputTokens: 65536
      }
    };

    const r = await fetch(`${this.BASE}/v1beta/models/${this.model}:generateContent?key=${this.key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${r.status}`;
      if (r.status === 400 && /API key/i.test(msg)) throw new Error('مفتاح API غير صالح — تحقق منه في الإعدادات');
      if (r.status === 429) throw new Error('تم تجاوز حد الاستخدام — انتظر قليلاً وأعد المحاولة');
      if (r.status === 404) throw new Error(`الموديل ${this.model} غير متاح لحسابك — جرّب موديل آخر من الإعدادات`);
      throw new Error(msg);
    }

    onProgress?.(90, 'تحليل النتيجة…');
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!text) throw new Error('لم يُرجع الموديل أي نتيجة — جرّب مرة أخرى');

    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('صيغة الاستجابة غير صالحة');
      parsed = JSON.parse(m[0]);
    }

    const segs = parsed.segments || parsed.cues || [];
    if (!Array.isArray(segs) || !segs.length) throw new Error('لم يتم العثور على كلام في الملف');

    const cues = segs.map(s => ({
      id: U.uid(),
      start: Math.max(0, +s.start || 0),
      end: Math.max(+s.start + 0.3, +s.end || 0),
      text: String(s.text || '').trim(),
      words: Array.isArray(s.words) ? s.words.map(w => {
        const ws = Number(w.s ?? w.start), we = Number(w.e ?? w.end);
        return { w: String(w.w || w.word || '').trim(), s: isFinite(ws) ? ws : 0, e: isFinite(we) ? we : 0 };
      }).filter(w => w.w) : []
    })).filter(c => c.text);

    // sanitize: sort + fix overlaps
    cues.sort((a, b) => a.start - b.start);
    for (let i = 1; i < cues.length; i++) {
      if (cues[i].start < cues[i - 1].end) cues[i].start = cues[i - 1].end;
      if (cues[i].end <= cues[i].start) cues[i].end = cues[i].start + 0.5;
    }
    onProgress?.(100, 'اكتمل ✔');
    return { cues, language: parsed.language || 'ar' };
  }
};
