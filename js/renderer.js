/* ===== Caption Canvas Renderer: styles, effects, animations, karaoke, RTL ===== */
'use strict';

const DEFAULT_STYLE = () => ({
  fontFamily: 'Cairo',
  fontSize: 64,
  fontWeight: 700,
  letterSpacing: 0,
  lineHeight: 1.25,
  align: 'center',            // right | center | left
  position: 'bottom',         // top | middle | bottom | custom
  customX: 0.5, customY: 0.8, // normalized 0..1 (used when position=custom)
  rotation: 0,
  opacity: 1,

  color: '#ffffff',
  gradientOn: false, grad1: '#ff5c7a', grad2: '#7c6cff',

  strokeOn: true,
  strokes: [{ color: '#000000', width: 6 }],

  shadowOn: true,
  shadowColor: '#000000', shadowBlur: 8, shadowDist: 4, shadowOpacity: 0.8,

  bgOn: false,
  bgColor: '#000000', bgOpacity: 0.7, bgRadius: 14, bgPadding: 16,
  bgGradient: false, bgGrad1: '#7c6cff', bgGrad2: '#ff5c7a', bgBlur: false,

  hlWords: '', hlColor: '#ffd23f',

  animIn: 'pop', animOut: 'fadeOut',
  animInDur: 0.35, animOutDur: 0.3, animDelay: 0, animSpeed: 1,

  karaokeOn: false,
  karaokeMode: 'highlight',  // highlight | word-by-word | single-word
  karaokeColor: '#ffd23f', karaokeBg: '#7c6cff', karaokeBgOn: false,
  karaokeZoom: true, karaokeScale: 1.15
});

const Renderer = {
  // Copy only supported values; imported templates must not poison Canvas state.
  normalizeStyle(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid style');
    const style = DEFAULT_STYLE();
    const limits = {
      fontSize: [12, 200], fontWeight: [100, 900], letterSpacing: [-5, 20], lineHeight: [0.8, 3],
      customX: [0, 1], customY: [0, 1], rotation: [-180, 180], opacity: [0, 1],
      shadowBlur: [0, 50], shadowDist: [0, 40], shadowOpacity: [0, 1],
      bgOpacity: [0, 1], bgRadius: [0, 80], bgPadding: [0, 80],
      animInDur: [0.1, 2], animOutDur: [0.1, 2], animDelay: [0, 1], animSpeed: [0.25, 3],
      karaokeScale: [1, 1.6]
    };
    const enums = {
      align: ['left', 'center', 'right'], position: ['top', 'middle', 'bottom', 'custom'],
      animIn: ['none', 'pop', 'typing', 'fade', 'slideUp', 'slideDown', 'zoom', 'bounce', 'glitch', 'shake'],
      animOut: ['none', 'fadeOut', 'zoomOut', 'slide', 'blur'],
      karaokeMode: ['highlight', 'word-by-word', 'single-word']
    };
    for (const key of Object.keys(style)) {
      const value = input[key];
      if (limits[key]) {
        if (typeof value === 'number' && Number.isFinite(value)) style[key] = U.clamp(value, ...limits[key]);
      } else if (enums[key]) {
        if (enums[key].includes(value)) style[key] = value;
      } else if (typeof style[key] === 'boolean') {
        if (typeof value === 'boolean') style[key] = value;
      } else if (typeof style[key] === 'string' && typeof value === 'string') {
        if (style[key].startsWith('#')) {
          if (/^#[0-9a-f]{6}$/i.test(value)) style[key] = value;
        } else style[key] = value.slice(0, key === 'fontFamily' ? 100 : 2000);
      }
    }
    if (Array.isArray(input.strokes)) {
      style.strokes = input.strokes.filter(s => s && /^#[0-9a-f]{6}$/i.test(s.color) && Number.isFinite(s.width))
        .slice(0, 4).map(s => ({ color: s.color, width: U.clamp(s.width, 0, 40) }));
    }
    return style;
  },

  // Use the first strong letter, not the surrounding Arabic UI's direction.
  textDirection(text, fallback = 'ltr') {
    for (const char of text) {
      if (!/\p{L}/u.test(char)) continue;
      return /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(char) ? 'rtl' : 'ltr';
    }
    return fallback;
  },

  // Keep Latin phrases/numbers together inside Arabic lines (and vice versa).
  visualTokens(tokens, direction) {
    const runs = [];
    for (const token of tokens) {
      const dir = this.textDirection(token.text, /\p{N}/u.test(token.text) ? 'ltr' : (runs.at(-1)?.direction || direction));
      if (runs.at(-1)?.direction !== dir) runs.push({ direction: dir, tokens: [] });
      runs.at(-1).tokens.push(token);
    }
    if (direction === 'rtl') runs.reverse();
    return runs.flatMap(run => run.direction === 'rtl' ? [...run.tokens].reverse() : run.tokens);
  },
  /**
   * Draw active cues onto ctx at time t.
   * canvasW/H — target pixel size. scale — style values are authored for 1080-wide reference.
   */
  draw(ctx, cues, style, t, canvasW, canvasH) {
    const active = cues.filter(c => {
      const inStart = c.start + (style.animDelay / style.animSpeed);
      const outEnd = c.end;
      return t >= Math.min(inStart, c.start) && t <= outEnd;
    });
    for (const cue of active) this.drawCue(ctx, cue, style, t, canvasW, canvasH);
  },

  drawCue(ctx, cue, style, t, W, H) {
    const S = W / 1080; // reference scale
    const fontPx = style.fontSize * S;
    const font = `${style.fontWeight} ${fontPx}px '${style.fontFamily}', 'Cairo', sans-serif`;
    ctx.save();
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    const direction = this.textDirection(cue.text);
    ctx.direction = direction;
    ctx.textAlign = 'right'; // physical anchor, independent of Canvas direction
    ctx.letterSpacing = `${(style.letterSpacing || 0) * S}px`;

    // ----- animation progress -----
    const speed = style.animSpeed || 1;
    const inDur = (style.animInDur || 0.3) / speed;
    const outDur = (style.animOutDur || 0.3) / speed;
    const delay = (style.animDelay || 0) / speed;
    const tIn = U.clamp((t - cue.start - delay) / Math.max(inDur, 0.001), 0, 1);
    const tOut = U.clamp((cue.end - t) / Math.max(outDur, 0.001), 0, 1);
    if (t < cue.start + delay && style.animIn !== 'none') { ctx.restore(); return; }

    const anim = this.computeAnim(style, tIn, tOut, S);
    if (anim.alpha <= 0.001) { ctx.restore(); return; }

    // ----- text content (typing effect trims text) -----
    let displayText = cue.text;
    if (style.animIn === 'typing' && tIn < 1) {
      const n = Math.ceil(displayText.length * U.ease.linear(tIn));
      displayText = displayText.slice(0, n);
      if (!displayText) { ctx.restore(); return; }
    }

    // karaoke single-word mode: only the current word
    let karaokeWordIdx = -1;
    const words = Array.isArray(cue.words) && cue.words.length ? cue.words : null;
    if (style.karaokeOn && words) {
      karaokeWordIdx = words.findIndex(w => t >= w.s && t < w.e);
      if (karaokeWordIdx === -1) {
        // pick last spoken
        for (let i = words.length - 1; i >= 0; i--) if (t >= words[i].s) { karaokeWordIdx = i; break; }
      }
    }

    // ----- layout: wrap text -----
    const maxW = W * 0.86;
    const lines = this.layoutLines(ctx, displayText, maxW, style, S, words, karaokeWordIdx, t);
    if (style.karaokeOn && words && style.karaokeMode === 'single-word') {
      const token = lines.flatMap(line => line.tokens).find(tok => tok.wordIdx === karaokeWordIdx);
      lines.splice(0, lines.length, ...(token ? [{ tokens: [token], width: token.width }] : []));
    }
    const lineH = fontPx * style.lineHeight;
    const blockH = lines.length * lineH;

    // ----- position -----
    let cx = W / 2, topY;
    if (style.position === 'top') topY = H * 0.08;
    else if (style.position === 'middle') topY = H / 2 - blockH / 2;
    else if (style.position === 'custom') { cx = style.customX * W; topY = style.customY * H - blockH / 2; }
    else topY = H * 0.92 - blockH; // bottom

    // ----- transform (animation + rotation) -----
    const blockCx = cx + anim.dx, blockCy = topY + blockH / 2 + anim.dy;
    ctx.translate(blockCx, blockCy);
    ctx.rotate(((style.rotation || 0) + anim.rot) * Math.PI / 180);
    ctx.scale(anim.scale, anim.scale);
    ctx.translate(-blockCx, -blockCy);
    ctx.globalAlpha = (style.opacity ?? 1) * anim.alpha;
    if (anim.blur > 0) ctx.filter = `blur(${anim.blur}px)`;

    // ----- background box -----
    if (style.bgOn && lines.length) {
      const widest = Math.max(...lines.map(l => l.width));
      const pad = style.bgPadding * S;
      const bx = cx - widest / 2 - pad, by = topY + anim.dyGroupOffset - pad * 0.6;
      const bw = widest + pad * 2, bh = blockH + pad * 1.2;
      ctx.save();
      const rad = style.bgRadius * S;
      this.roundRect(ctx, bx, by, bw, bh, rad);
      if (style.bgBlur) {
        // fake blur: darken with translucency layers
        ctx.fillStyle = U.hexWithAlpha(style.bgColor, style.bgOpacity * 0.55);
        ctx.fill();
        ctx.filter = 'blur(6px)';
        this.roundRect(ctx, bx, by, bw, bh, rad);
        ctx.fillStyle = U.hexWithAlpha(style.bgColor, style.bgOpacity * 0.4);
        ctx.fill();
        ctx.filter = 'none';
      } else if (style.bgGradient) {
        const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
        g.addColorStop(0, U.hexWithAlpha(style.bgGrad1, style.bgOpacity));
        g.addColorStop(1, U.hexWithAlpha(style.bgGrad2, style.bgOpacity));
        ctx.fillStyle = g; ctx.fill();
      } else {
        ctx.fillStyle = U.hexWithAlpha(style.bgColor, style.bgOpacity); ctx.fill();
      }
      ctx.restore();
    }

    // ----- draw lines word-by-word -----
    const hlSet = new Set((style.hlWords || '').split(/[,،]/).map(s => s.trim()).filter(Boolean));

    let y = topY + fontPx * 0.9;
    for (const line of lines) {
      let x;
      if (style.align === 'center') x = cx - line.width / 2;
      else if (style.align === 'right') x = cx + maxW / 2 - line.width;
      else x = cx - maxW / 2;
      // Draw in visual left-to-right order without changing logical karaoke indices.
      for (const tok of this.visualTokens(line.tokens, direction)) {
        x += tok.width;
        const isActive = !!words && karaokeWordIdx >= 0 && tok.wordIdx === karaokeWordIdx && style.karaokeOn;
        const isSpoken = style.karaokeOn && words && tok.wordIdx >= 0 && tok.wordIdx <= karaokeWordIdx;

        // word-by-word: skip unspoken words
        if (style.karaokeOn && words && (style.karaokeMode === 'word-by-word') && tok.wordIdx > karaokeWordIdx) { x += tok.space; continue; }
        if (style.karaokeOn && words && style.karaokeMode === 'single-word' && !isActive) { x += tok.space; continue; }

        let scale = 1;
        if (isActive && style.karaokeZoom) {
          const wp = words[karaokeWordIdx];
          const p = U.clamp((t - wp.s) / Math.max(wp.e - wp.s, 0.01), 0, 1);
          scale = 1 + (style.karaokeScale - 1) * U.ease.outBack(Math.min(p * 3, 1));
        }

        // token color
        const stripped = tok.text.replace(/[.,،؟!:؛"'()\[\]{}]/g, '');
        let fillColor = style.color;
        if (hlSet.has(stripped)) fillColor = style.hlColor;
        if (isActive) fillColor = style.karaokeColor;

        ctx.save();
        ctx.direction = this.textDirection(tok.text, direction);
        const tokCx = x - tok.width / 2;
        if (scale !== 1) { ctx.translate(tokCx, y - fontPx * 0.35); ctx.scale(scale, scale); ctx.translate(-tokCx, -(y - fontPx * 0.35)); }

        // active word background pill
        if (isActive && style.karaokeBgOn) {
          const pad = fontPx * 0.18;
          ctx.save();
          ctx.fillStyle = style.karaokeBg;
          this.roundRect(ctx, x - tok.width - pad, y - fontPx * 0.85, tok.width + pad * 2, fontPx * 1.15, fontPx * 0.22);
          ctx.fill();
          ctx.restore();
        }

        // shadow
        if (style.shadowOn) {
          ctx.shadowColor = U.hexWithAlpha(style.shadowColor, style.shadowOpacity);
          ctx.shadowBlur = style.shadowBlur * S;
          ctx.shadowOffsetX = -style.shadowDist * S * 0.7;
          ctx.shadowOffsetY = style.shadowDist * S;
        }

        ctx.font = font;
        if (style.letterSpacing) ctx.letterSpacing = `${style.letterSpacing * S}px`;

        // strokes (multi-layer, thickest first)
        if (style.strokeOn && style.strokes?.length) {
          const sorted = [...style.strokes].sort((a, b) => b.width - a.width);
          for (const st of sorted) {
            if (st.width <= 0) continue;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = st.color;
            ctx.lineWidth = st.width * S;
            ctx.strokeText(tok.text, x, y);
          }
        }

        // fill (gradient / solid)
        if (style.gradientOn && !isActive && !hlSet.has(stripped)) {
          const g = ctx.createLinearGradient(x - tok.width, y - fontPx, x, y);
          g.addColorStop(0, style.grad1); g.addColorStop(1, style.grad2);
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = fillColor;
        }

        // dim unspoken words in highlight mode
        if (style.karaokeOn && words && style.karaokeMode === 'highlight' && !isSpoken) {
          ctx.globalAlpha *= 0.45;
        }

        ctx.fillText(tok.text, x, y);
        ctx.restore();

        x += tok.space;
      }
      y += lineH;
    }

    ctx.restore();
  },

  layoutLines(ctx, text, maxW, style, S, words, karaokeWordIdx, t) {
    // tokenize; map tokens to word indices for karaoke
    const rawTokens = text.split(/\s+/).filter(Boolean);
    const spaceW = ctx.measureText(' ').width;
    const tokens = rawTokens.map((txt, i) => ({
      text: txt,
      width: ctx.measureText(txt).width,
      space: spaceW,
      wordIdx: words && i < words.length ? i : (words ? words.length - 1 : -1)
    }));

    const lines = [];
    let cur = { tokens: [], width: 0 };
    for (const tok of tokens) {
      const add = tok.width + (cur.tokens.length ? tok.space : 0);
      if (cur.width + add > maxW && cur.tokens.length) {
        lines.push(cur); cur = { tokens: [], width: 0 };
      }
      cur.tokens.push(tok);
      cur.width += cur.tokens.length === 1 ? tok.width : tok.width + tok.space;
    }
    if (cur.tokens.length) lines.push(cur);
    return lines;
  },

  computeAnim(style, tIn, tOut, S) {
    let alpha = 1, scale = 1, dx = 0, dy = 0, rot = 0, blur = 0;
    const E = U.ease;

    // ---- IN ----
    if (tIn < 1) {
      switch (style.animIn) {
        case 'pop': scale = 0.3 + 0.7 * E.outBack(tIn); alpha = Math.min(tIn * 2.5, 1); break;
        case 'fade': alpha = E.outCubic(tIn); break;
        case 'typing': alpha = 1; break;
        case 'slideUp': dy = (1 - E.outCubic(tIn)) * 120 * S; alpha = Math.min(tIn * 2, 1); break;
        case 'slideDown': dy = -(1 - E.outCubic(tIn)) * 120 * S; alpha = Math.min(tIn * 2, 1); break;
        case 'zoom': scale = 1.8 - 0.8 * E.outCubic(tIn); alpha = E.outCubic(tIn); break;
        case 'bounce': dy = -(1 - E.outBounce(tIn)) * 150 * S; alpha = Math.min(tIn * 3, 1); break;
        case 'glitch': {
          alpha = Math.min(tIn * 2, 1);
          if (tIn < 0.85) {
            dx = (Math.random() - 0.5) * 18 * S * (1 - tIn);
            dy = (Math.random() - 0.5) * 10 * S * (1 - tIn);
          }
          break;
        }
        case 'shake': {
          alpha = Math.min(tIn * 2, 1);
          if (tIn < 1) rot = Math.sin(tIn * 40) * 4 * (1 - tIn);
          break;
        }
      }
    }

    // ---- OUT ----
    if (tOut < 1 && style.animOut !== 'none') {
      const p = 1 - tOut; // 0 -> 1 as we exit
      switch (style.animOut) {
        case 'fadeOut': alpha *= tOut; break;
        case 'zoomOut': scale *= 1 - 0.6 * E.inCubic(p); alpha *= tOut; break;
        case 'slide': dx += E.inCubic(p) * -200 * S; alpha *= tOut; break;
        case 'blur': blur = E.inCubic(p) * 14 * S; alpha *= Math.min(tOut * 1.5, 1); break;
      }
    }

    return { alpha, scale, dx, dy, rot, blur, dyGroupOffset: 0 };
  },

  roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
};
