// WebGL render motoru: kaynak doku → dönüşüm → bulanıklık → ana renk geçişi → ekran.
// Aynı hat hem önizleme (ekran boyutu) hem dışa aktarım (tam çözünürlük) için kullanılır.

import { VERT_QUAD, FRAG_TRANSFORM, FRAG_BLUR, FRAG_MAIN, FRAG_PRESENT } from './shaders.js';
import * as m3 from './mat3.js';

function compile(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Gölgelendirici derlenemedi: ' + log);
  }
  return sh;
}

function program(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program bağlanamadı: ' + gl.getProgramInfoLog(p));
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  // Uniform konumlarını önbelleğe al
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { program: p, u: uniforms };
}

function createTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

function disposeTarget(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

export class Engine {
  constructor(canvas) {
    const opts = { alpha: false, antialias: false, preserveDrawingBuffer: false, premultipliedAlpha: false };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL desteklenmiyor.');
    this.canvas = canvas;
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    this.pTransform = program(gl, VERT_QUAD, FRAG_TRANSFORM);
    this.pBlur = program(gl, VERT_QUAD, FRAG_BLUR);
    this.pMain = program(gl, VERT_QUAD, FRAG_MAIN);
    this.pPresent = program(gl, VERT_QUAD, FRAG_PRESENT);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    this.srcTex = null;
    this.srcW = 0;
    this.srcH = 0;
    this.curveTex = null;
    this.targets = {};
    this.seed = Math.random() * 100;
  }

  /** Kaynak görüntüyü (ImageBitmap / HTMLImageElement / Canvas) yükler. */
  setImage(img) {
    const gl = this.gl;
    let w = img.width || img.videoWidth;
    let h = img.height || img.videoHeight;
    let source = img;
    const cap = Math.min(this.maxTex, 8192);
    if (w > cap || h > cap) {
      const k = Math.min(cap / w, cap / h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      source = c;
      w = c.width;
      h = c.height;
    }
    if (this.srcTex) gl.deleteTexture(this.srcTex);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.srcTex = tex;
    this.srcW = w;
    this.srcH = h;
    return { width: w, height: h };
  }

  /** 256x1 RGBA eğri arama tablosunu günceller. */
  setCurveLUT(bytes) {
    const gl = this.gl;
    if (!this.curveTex) {
      this.curveTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }

  target(key, w, h) {
    const t = this.targets[key];
    if (t && t.w === w && t.h === h) return t;
    disposeTarget(this.gl, t);
    const nt = createTarget(this.gl, w, h);
    this.targets[key] = nt;
    return nt;
  }

  drawQuad(prog, target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    const w = target ? target.w : this.canvas.width;
    const h = target ? target.h : this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Kırpma/döndürme sonrası çıktı boyutunu hesaplar.
   * transform: { rotate90, angle, flipX, flipY, crop:{x,y,w,h} } (crop 0..1, döndürülmüş çerçevede)
   */
  outputSize(transform) {
    const t = transform;
    const theta = (t.rotate90 * Math.PI) / 2 + (t.angle * Math.PI) / 180;
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));
    const bw = this.srcW * c + this.srcH * s;
    const bh = this.srcW * s + this.srcH * c;
    return {
      w: Math.max(1, Math.round(bw * t.crop.w)),
      h: Math.max(1, Math.round(bh * t.crop.h)),
      bw, bh,
    };
  }

  uvMatrix(transform) {
    const t = transform;
    const theta = (t.rotate90 * Math.PI) / 2 + (t.angle * Math.PI) / 180;
    const ct = Math.abs(Math.cos(theta));
    const st = Math.abs(Math.sin(theta));
    const bw = this.srcW * ct + this.srcH * st;
    const bh = this.srcW * st + this.srcH * ct;
    return m3.chain(
      m3.translate(0.5, 0.5),
      m3.scale(1 / this.srcW, 1 / this.srcH),
      m3.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1),
      m3.rotate(-theta),
      m3.translate(-bw / 2, -bh / 2),
      m3.scale(bw, bh),
      m3.translate(t.crop.x, t.crop.y),
      m3.scale(t.crop.w, t.crop.h)
    );
  }

  /** Hattı çalıştırır, sonucu `base` hedefine yazar ve hedefi döndürür. */
  process(params, transform, outW, outH, keyPrefix = 'p') {
    const gl = this.gl;
    if (!this.srcTex) return null;

    // 1) Dönüşüm geçişi
    const base = this.target(keyPrefix + 'Base', outW, outH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.useProgram(this.pTransform.program);
    gl.uniform1i(this.pTransform.u.uImage, 0);
    gl.uniformMatrix3fv(this.pTransform.u.uUvMatrix, false, new Float32Array(this.uvMatrix(transform)));
    this.drawQuad(this.pTransform, base);

    // 2) Bulanıklık geçişleri (yarı çözünürlükte)
    const bw = Math.max(2, Math.round(outW / 2));
    const bh = Math.max(2, Math.round(outH / 2));
    const blurA = this.target(keyPrefix + 'BlurA', bw, bh);
    const blurB = this.target(keyPrefix + 'BlurB', bw, bh);

    const needClarity = Math.abs(params.clarity) > 0.001 || params.sharpen > 0.001;
    const smallR = Math.max(1.5, Math.min(bw, bh) * 0.012);
    this.blurInto(base, blurA, blurB, smallR, needClarity ? 2 : 1);
    const blurSmall = this.lastBlur;

    let blurBig = blurSmall;
    if (params.blurAmount > 0.001) {
      // Küçük bulanıklığın üstüne devam ederek büyük yarıçapı ucuza elde et.
      // Kaynak ile hedefler ayrı olmalı; aksi halde geri besleme (INVALID_OPERATION) olur.
      const blurC = this.target(keyPrefix + 'BlurC', bw, bh);
      const blurD = this.target(keyPrefix + 'BlurD', bw, bh);
      const bigR = Math.max(2, Math.min(bw, bh) * 0.07 * params.blurAmount);
      this.blurInto(blurSmall, blurC, blurD, bigR, 3);
      blurBig = this.lastBlur;
    }

    // 3) Ana renk geçişi
    const out = this.target(keyPrefix + 'Out', outW, outH);
    const P = this.pMain;
    gl.useProgram(P.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, base.tex);
    gl.uniform1i(P.u.uImage, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurSmall.tex);
    gl.uniform1i(P.u.uBlur, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, blurBig.tex);
    gl.uniform1i(P.u.uBlurBig, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    gl.uniform1i(P.u.uCurve, 3);

    const set = (name, v) => { if (P.u[name] !== undefined) gl.uniform1f(P.u[name], v); };
    gl.uniform2f(P.u.uTexel, 1 / outW, 1 / outH);
    set('uAspect', outW / outH);
    set('uExposure', params.exposure);
    set('uContrast', params.contrast);
    set('uHighlights', params.highlights);
    set('uShadows', params.shadows);
    set('uWhites', params.whites);
    set('uBlacks', params.blacks);
    set('uTemp', params.temperature);
    set('uTint', params.tint);
    set('uVibrance', params.vibrance);
    set('uSaturation', params.saturation);
    set('uHue', params.hue);
    set('uClarity', params.clarity);
    set('uSharpen', params.sharpen);
    set('uFade', params.fade);
    set('uGrain', params.grain);
    set('uGrainSize', params.grainSize * Math.max(1, outW / 1200));
    set('uVignette', params.vignette);
    set('uVignetteSize', params.vignetteSize);
    set('uBlurAmount', params.blurAmount);
    set('uGamma', params.gamma);
    set('uSplitBalance', params.splitBalance);
    set('uSeed', this.seed);
    set('uCurveOn', params.curveOn ? 1 : 0);
    set('uInvert', params.invert);
    set('uPosterize', params.posterize);
    set('uThreshold', params.threshold);
    if (P.u.uShadowTint) gl.uniform3fv(P.u.uShadowTint, params.shadowTint);
    if (P.u.uHighlightTint) gl.uniform3fv(P.u.uHighlightTint, params.highlightTint);

    this.drawQuad(P, out);
    return out;
  }

  /**
   * Ayrılabilir bulanıklık. `a` yatay ara hedef, `b` dikey sonuç hedefi; ikisi de
   * `src`'den farklı olmalı. Hedefler sabit tutulur (takas edilmez) — takas edilirse
   * ikinci turda aynı doku hem okunup hem yazılır ve WebGL geri besleme hatası verir.
   */
  blurInto(src, a, b, radius, iterations) {
    const gl = this.gl;
    const P = this.pBlur;
    let input = src;
    for (let i = 0; i < iterations; i++) {
      const r = (radius * (i + 1)) / iterations;
      gl.useProgram(P.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input.tex);
      gl.uniform1i(P.u.uImage, 0);
      gl.uniform2f(P.u.uDir, r / a.w, 0);
      this.drawQuad(P, a);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.uniform1i(P.u.uImage, 0);
      gl.uniform2f(P.u.uDir, 0, r / b.h);
      this.drawQuad(P, b);

      input = b;
    }
    this.lastBlur = input;
    return input;
  }

  /** Verilen kutuya sığan tuval ölçüsü. */
  fitSize(transform, viewW, viewH) {
    const size = this.outputSize(transform);
    const scale = Math.min(viewW / size.w, viewH / size.h, 1);
    return {
      w: Math.max(1, Math.round(size.w * scale)),
      h: Math.max(1, Math.round(size.h * scale)),
      scale,
      full: size,
    };
  }

  /**
   * Önizlemeyi tam olarak w×h tuvale çizer. Yakınlaştırmada `transform.crop`
   * daraltıldığı için aynı piksel sayısı daha küçük bir alanı kaplar; görüntü
   * büyütülmez, yeniden işlenir.
   */
  renderToCanvas(params, transform, w, h) {
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const out = this.process(params, transform, w, h, 'prev');
    if (!out) return null;
    gl.useProgram(this.pPresent.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, out.tex);
    gl.uniform1i(this.pPresent.u.uImage, 0);
    this.drawQuad(this.pPresent, null);
    return { w, h };
  }

  /** Tam çözünürlükte işleyip ImageData döndürür. */
  renderToImageData(params, transform, maxLongEdge = 0) {
    const gl = this.gl;
    const size = this.outputSize(transform);
    let w = size.w;
    let h = size.h;
    if (maxLongEdge > 0 && Math.max(w, h) > maxLongEdge) {
      const k = maxLongEdge / Math.max(w, h);
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
    }
    const out = this.process(params, transform, w, h, 'exp');
    if (!out) return null;
    const pixels = new Uint8ClampedArray(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return new ImageData(pixels, w, h);
  }

  /** Histogram için küçük ölçekli piksel örneği. */
  samplePixels(params, transform, maxSide = 200) {
    const size = this.outputSize(transform);
    const k = Math.min(maxSide / size.w, maxSide / size.h, 1);
    const w = Math.max(1, Math.round(size.w * k));
    const h = Math.max(1, Math.round(size.h * k));
    const out = this.process(params, transform, w, h, 'hist');
    if (!out) return null;
    const gl = this.gl;
    const pixels = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { pixels, w, h };
  }

  reseed() {
    this.seed = Math.random() * 100;
  }
}
