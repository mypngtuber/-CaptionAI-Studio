# CaptionAI Studio 🎬

أداة ويب احترافية لصناعة وترجمة وتخصيص الكابشن للفيديوهات — مدعومة بـ **Google Gemini AI**، شبيهة بـ CapCut Caption Editor مع دعم كامل للغة العربية ولهجاتها.

## ✅ الميزات المكتملة

### 1. استخراج الكابشن بالذكاء الاصطناعي (Caption Generator)
- رفع فيديو/صوت (MP4, WebM, MOV, MP3, WAV, M4A, OGG) بالسحب والإفلات
- استخراج الصوت تلقائياً في المتصفح (Web Audio API → WAV mono 16kHz)
- إرسال الصوت إلى Gemini API (inline للملفات الصغيرة، Files API Resumable Upload للكبيرة)
- دعم كامل للعربية: اللهجات (مصري/خليجي/شامي/مغاربي)، تشكيل اختياري، علامات ترقيم، إيموجي
- تقسيم الجمل: طبيعي / قصير للشورتس / 3-4 كلمات
- توقيت على مستوى الكلمة (Word-level) لنظام Karaoke
- إخراج: **SRT · VTT · JSON Timeline · ملف مشروع `.capai`**

### 2. محرر كابشن احترافي (Caption Editor)
- معاينة Canvas حية مع الفيديو + Timeline تفاعلي (سحب/تمديد/تقليص المقاطع)
- قائمة جمل قابلة للتحرير المباشر (بدون فقدان الفوكس أثناء الكتابة)
- **توليد توقيت الكلمات تلقائياً**: ملفات SRT/VTT المستوردة والنصوص المُعدّلة تحصل على توقيت كلمات موزّع حسب طول الكلمة — فيعمل Karaoke/قالب تيك توك مع أي مصدر كابشن
- **الخطوط**: 13+ خط عربي/لاتيني مدمج، قراءة خطوط الجهاز (Local Font Access API)، رفع TTF/OTF/WOFF مع حفظ دائم
- **إعدادات النص**: الحجم، الوزن، تباعد الحروف والسطور، المحاذاة، الدوران، الشفافية
- **الموضع**: أعلى/وسط/أسفل + تحريك يدوي بالسحب على المعاينة
- **التأثيرات**: Stroke متعدد الطبقات (حتى 4)، Shadow (لون/Blur/Distance/Opacity)، خلفية (Rounded/Gradient/Blur)، Gradient Text، تلوين كلمات محددة
- **Animations دخول**: Pop, Typing, Fade, Slide Up/Down, Zoom, Bounce, Glitch, Shake
- **Animations خروج**: Fade Out, Zoom Out, Slide, Blur — مع تحكم بالمدة والتأخير والسرعة
- **Word Highlight (Karaoke)**: تلوين الكلمة المنطوقة / كلمة-كلمة / كلمة واحدة + Zoom + خلفية Pill + دعم RTL كامل
- 14 قالباً مستوحى من الأنماط الشائعة: تيك توك/ريلز، Hormozi، MrBeast، Vox، نيون، صندوق، تدرج، آلة كاتبة، جليتش، سينمائي، مينيمال، بودكاست، شورتس، وكاب كات
- إزالة القالب والرجوع لتصميمك السابق، أو إعادة التصميم الافتراضي بشكل مستقل
- حذف القوالب المحفوظة بزر ظاهر، وإخفاء القوالب الجاهزة مع إمكانية استعادتها
- حفظ قوالب مخصصة + تصدير/استيراد إعدادات التصميم JSON
- **Auto Save** للمشاريع (RESTful Table API مع fallback إلى localStorage)

### 3. تصدير الفيديو
- WebM (VP9) دائماً + MP4 (H.264) في المتصفحات الداعمة (Chrome/Edge)
- **خلفيات التصدير**: الفيديو الأصلي / 🟢 خلفية خضراء Green Screen (للكابشن فقط — جاهز للكروما في برامج المونتاج) / شفافة WebM Alpha / لون مخصص
- دقة: 1080×1920 Shorts / 1920×1080 YouTube / المصدر / مخصص
- FPS: 30/60 · تحكم في Bitrate (2–40 Mbps)
- دمج صوت الفيديو الأصلي تلقائياً (عند التصدير مع الفيديو)

### 4. الإعدادات
- Gemini API Key (يُحفظ محلياً في localStorage فقط) + زر اختبار الاتصال
- اختيار الموديل: `gemini-3.5-flash` (افتراضي)، `gemini-3-flash-preview`، `gemini-3.1-flash-lite`، `gemini-3.1-flash-lite-preview`، `gemini-2.5-flash`، `gemini-2.5-flash-lite`
- إدارة الخطوط المخصصة + إعدادات تصدير افتراضية
- Dark Mode / Light Mode

## 📄 مداخل الاستخدام
| المسار | الوصف |
|---|---|
| `index.html` | التطبيق كاملاً (SPA بأربع صفحات: Dashboard · Generator · Editor · Settings) |
| `tables/projects` | REST API للمشاريع (Auto Save) |
| `tables/templates` | REST API لقوالب التصميم |

## 🗂 بنية المشروع
```
index.html            التطبيق والواجهة
css/style.css         الأنماط المخصصة (RTL, Timeline, Panels)
js/utils.js           أدوات: SRT/VTT/JSON، WAV encoder، easing
js/storage.js         الإعدادات + المشاريع/القوالب (Table API + fallback)
js/fonts.js           إدارة الخطوط (مدمجة/جهاز/مرفوعة)
js/gemini.js          تكامل Gemini (تفريغ صوتي + Files API)
js/renderer.js        محرك رسم الكابشن على Canvas (تأثيرات/حركات/كاريوكي)
js/generator.js       صفحة الاستخراج
js/editor.js          المحرر (Timeline, Preview, Style bindings, Autosave)
js/exporter.js        تصدير الفيديو النهائي
js/main.js            التنقل، الإعدادات، Dashboard
```

## 💾 نماذج البيانات
- **projects**: `id, name, kind(caption), data(JSON: cues+style+template), thumb, updated`
- **templates**: `id, name, style(JSON), created`
- **cue**: `{id, start, end, text, words:[{w, s, e}]}`
- إعدادات المستخدم (API Key، الموديل، التصدير، الثيم): `localStorage`

تم حذف أداة إزالة الخلفية الخضراء. خيار **تصدير الكابشن على خلفية خضراء** مستقل وما زال متاحاً للمونتاج الخارجي.

## ⚠️ حدود معروفة (بيئة متصفح ثابتة)
- **MOV Alpha / ProRes**: غير ممكن في المتصفح — البديل: WebM Alpha أو PNG Sequence
- **MP4 export**: متاح فقط حيث يدعم MediaRecorder صيغة MP4 (Chrome/Edge حديث)؛ غير ذلك يتحول لـ WebM
- التصدير يتم بسرعة التشغيل الحقيقية (Realtime) للحفاظ على تزامن الصوت
- الفيديوهات نفسها لا تُحفظ مع المشروع (تُعاد عبر الاستيراد) — تُحفظ الجمل والتصميم فقط
- قراءة خطوط الجهاز تتطلب Chrome/Edge (Local Font Access API)

## 🚀 خطوات مقترحة للتطوير القادم
1. ترجمة الكابشن لأكثر من لغة عبر Gemini (زر "ترجمة" في المحرر)
2. تصدير فائق السرعة عبر WebCodecs (أسرع من Realtime)
3. Undo/Redo في المحرر
4. حفظ الفيديو محلياً عبر IndexedDB لإعادة فتح المشروع كاملاً

## 🔑 البدء السريع
1. افتح **الإعدادات** → أدخل Gemini API Key (مجاني من [Google AI Studio](https://aistudio.google.com/apikey)) → **اختبار الاتصال** → حفظ
2. افتح **استخراج الكابشن** → ارفع الفيديو → استخراج
3. **فتح في المحرر** → صمّم وحرّك → **تصدير الفيديو**

## 🌐 النشر
لنشر الموقع استخدم تبويب **Publish** في المنصة.
