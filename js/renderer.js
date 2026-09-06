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
    const isRtl = U.isRTL(displayText || cue.text);
    ctx.save();
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.direction = isRtl ? 'rtl' : 'ltr';

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
    let words = cue.words && cue.words.length ? cue.words : null;
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
      if (isRtl) {
        if (style.align === 'center') x = cx + line.width / 2;
        else if (style.align === 'right') x = cx + maxW / 2;
        else x = cx - maxW / 2 + line.width;
      } else {
        if (style.align === 'center') x = cx - line.width / 2;
        else if (style.align === 'left') x = cx - maxW / 2;
        else if (style.align === 'right') x = cx + maxW / 2 - line.width;
        else x = cx - line.width / 2;
      }

      for (const tok of line.tokens) {
        const isActive = tok.wordIdx === karaokeWordIdx && style.karaokeOn;
        const isSpoken = style.karaokeOn && words && tok.wordIdx >= 0 && tok.wordIdx <= karaokeWordIdx;

        // word-by-word: skip unspoken words
        if (style.karaokeOn && words && (style.karaokeMode === 'word-by-word') && tok.wordIdx > karaokeWordIdx) {
          if (isRtl) x -= tok.width + tok.space;
          else x += tok.width + tok.space;
          continue;
        }
        if (style.karaokeOn && words && style.karaokeMode === 'single-word' && !isActive) {
          if (isRtl) x -= tok.width + tok.space;
          else x += tok.width + tok.space;
          continue;
        }

        let scale = 1;
        if (isActive && style.karaokeZoom) {
          const wp = words[karaokeWordIdx];
          const p = U.clamp((t - wp.s) / Math.max(wp.e - wp.s, 0.01), 0, 1);
          scale = 1 + (style.karaokeScale - 1) * U.ease.outBack(Math.min(p * 3, 1));
        }

        // token color
        const stripped = tok.text.replace(/[.,،؟!:؛"'()[\]{}]/g, '');
        let fillColor = style.color;
        if (hlSet.has(stripped)) fillColor = style.hlColor;
        if (isActive) fillColor = style.karaokeColor;

        ctx.save();
        const tokCx = isRtl ? (x - tok.width / 2) : (x + tok.width / 2);
        if (scale !== 1) { ctx.translate(tokCx, y - fontPx * 0.35); ctx.scale(scale, scale); ctx.translate(-tokCx, -(y - fontPx * 0.35)); }

        // active word background pill
        if (isActive && style.karaokeBgOn) {
          const pad = fontPx * 0.18;
          ctx.save();
          ctx.fillStyle = style.karaokeBg;
          const pillX = isRtl ? (x - tok.width - pad) : (x - pad);
          this.roundRect(ctx, pillX, y - fontPx * 0.85, tok.width + pad * 2, fontPx * 1.15, fontPx * 0.22);
          ctx.fill();
          ctx.restore();
        }

        // shadow
        if (style.shadowOn) {
          ctx.shadowColor = U.hexWithAlpha(style.shadowColor, style.shadowOpacity);
          ctx.shadowBlur = style.shadowBlur * S;
          ctx.shadowOffsetX = (isRtl ? -1 : 1) * style.shadowDist * S * 0.7;
          ctx.shadowOffsetY = style.shadowDist * S;
        }

        ctx.font = font;
        if (style.letterSpacing) ctx.letterSpacing = (style.letterSpacing * S) + 'px';

        // strokes (multi-layer, thickest first)
        if (style.strokeOn && style.strokes && style.strokes.length) {
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
          const g = isRtl ? ctx.createLinearGradient(x - tok.width, y - fontPx, x, y) : ctx.createLinearGradient(x, y - fontPx, x + tok.width, y);
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

        if (isRtl) {
          x -= tok.width + tok.space;
        } else {
          x += tok.width + tok.space;
        }
      }
      y += lineH;
    }

    ctx.restore();
  },

  layoutLines(ctx, text, maxW, style, S, words, karaokeWordIdx, t) {
    // tokenize; map tokens to word indices for karaoke
    const rawTokens = text.split(/\s+/).filter(Boolean);
    const spaceW = ctx.measureText(' ').width + (style.letterSpacing * S || 0);
    const tokens = rawTokens.map((txt, i) => ({
      text: txt,
      width: ctx.measureText(txt).width + (style.letterSpacing * S || 0) * txt.length,
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
