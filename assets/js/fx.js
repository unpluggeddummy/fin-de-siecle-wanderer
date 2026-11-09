// 화면 효과 — 금색 모자이크(마우스 근처는 선명), 숫자 계수기, 흐린 로그 글자
const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 그림·GIF·영상을 금색 모자이크로 그리고, 마우스 근처는 원래 그림이 보이게.
 * media: { src, type: 'image' | 'gif' | 'video', keyBlack }
 *  - GIF·영상은 매 장면을 다시 그린다 (화면에 보일 때만)
 *  - keyBlack: 검은 배경을 지운다 (투명 배경이 없는 영상용, 화면 섞기 방식)
 * onBounds({ left, right }): 그림이 실제로 있는 가로 범위(화면 좌표) — 뒤 글자를 가리는 데 쓴다
 */
export function mosaic(host, media, { block = 10, radius = 160, tint = [201, 163, 92], bottomFade = 0.28, onBounds } = {}) {
  if (typeof media === 'string') media = { src: media, type: 'image' };
  const type = media.type || (/\.(mp4|webm|mov)(\?|$)/i.test(media.src) ? 'video' : /\.gif(\?|$)/i.test(media.src) ? 'gif' : 'image');
  const moving = type !== 'image';
  const cv = document.createElement('canvas');
  cv.className = 'fx-mosaic';
  if (media.keyBlack) cv.style.mixBlendMode = 'screen';
  host.append(cv);
  const ctx = cv.getContext('2d');
  let el;
  if (type === 'video') {
    el = document.createElement('video');
    Object.assign(el, { muted: true, loop: true, autoplay: true, playsInline: true, preload: 'auto' });
    el.setAttribute('muted', ''); el.setAttribute('playsinline', '');
  } else el = new Image();
  el.src = media.src;
  const natW = () => el.videoWidth || el.naturalWidth, natH = () => el.videoHeight || el.naturalHeight;
  let mx = -9999, my = -9999, tx = -9999, ty = -9999, small = null, sctx = null, raf = 0, alive = true, ready = false, visible = true, last = 0, bounded = false;

  const tintSmall = () => {
    const sw = small.width, sh = small.height;
    sctx.clearRect(0, 0, sw, sh);
    sctx.drawImage(el, 0, 0, sw, sh);
    const d = sctx.getImageData(0, 0, sw, sh), p = d.data;
    const colOn = new Uint16Array(sw);
    for (let i = 0; i < p.length; i += 4) {
      const l = (0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]) / 255;
      const px = (i / 4) % sw, row = Math.floor(i / 4 / sw) / sh;
      const fade = row > 1 - bottomFade ? Math.max(0, 1 - (row - (1 - bottomFade)) / bottomFade) : 1;
      const on = media.keyBlack ? l > 0.09 : p[i + 3] > 40;
      if (on && row < 0.85) colOn[px]++;
      p[i] = tint[0] * (0.25 + l * 1.05); p[i + 1] = tint[1] * (0.25 + l * 1.05); p[i + 2] = tint[2] * (0.25 + l);
      p[i + 3] = (media.keyBlack ? 255 * Math.min(1, l * 3) : p[i + 3]) * fade;
    }
    sctx.putImageData(d, 0, 0);
    // 그림이 있는 가로 범위: 칸의 8% 넘게 차 있는 세로줄만 (흩날리는 조각은 빼고)
    let lo = sw, hi = -1;
    for (let x = 0; x < sw; x++) if (colOn[x] > sh * 0.08) { if (x < lo) lo = x; hi = x; }
    if (!bounded && hi >= 0 && onBounds) {
      bounded = true;
      const r = cv.getBoundingClientRect();
      onBounds({ left: r.left + (lo / sw) * r.width, right: r.left + ((hi + 1) / sw) * r.width });
    }
  };
  const draw = () => {
    if (!alive || !ready || !cv.width) return;
    const W = cv.width, H = cv.height;
    if (moving) tintSmall();
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width, small.height, 0, 0, W, H);
    if (radius > 0 && mx > -999) { // 마우스 근처: 원래 그림 (블록 모양 원)
      ctx.save();
      ctx.beginPath();
      const r = radius * devicePixelRatio, b = block * devicePixelRatio;
      for (let y = -r; y <= r; y += b) for (let x = -r; x <= r; x += b) if (x * x + y * y < r * r) ctx.rect(Math.floor((mx + x) / b) * b, Math.floor((my + y) / b) * b, b, b);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(el, 0, 0, W, H);
      ctx.restore();
    }
  };
  const prep = () => {
    const r = host.getBoundingClientRect();
    if (!r.width || !natW()) return;
    ready = true;
    // 자리 안에 다 들어가게 (높이 우선, 너무 넓으면 너비에 맞춤)
    const ar = natW() / natH();
    let h = r.height, w = h * ar;
    if (w > r.width) { w = r.width; h = w / ar; }
    const W = Math.round(w * devicePixelRatio), H = Math.round(h * devicePixelRatio);
    cv.width = W; cv.height = H;
    cv.style.width = `${W / devicePixelRatio}px`; cv.style.height = `${H / devicePixelRatio}px`;
    const b = block * devicePixelRatio;
    small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(W / b)); small.height = Math.max(1, Math.round(H / b));
    sctx = small.getContext('2d', { willReadFrequently: true });
    bounded = false;
    tintSmall();
    draw();
    if (moving) kick();
  };
  // GIF·영상은 1초에 24번 정도 다시 그리고, 그림은 마우스를 따라갈 때만
  const loop = (t) => {
    raf = 0;
    if (!alive) return;
    mx += (tx - mx) * 0.25; my += (ty - my) * 0.25;
    if (!moving || t - last > 40) { last = t; draw(); }
    const chasing = Math.abs(tx - mx) > 0.5 || Math.abs(ty - my) > 0.5;
    if ((moving && visible) || chasing) raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf && alive) raf = requestAnimationFrame(loop); };
  if (radius > 0) host.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    tx = (e.clientX - r.left) * devicePixelRatio; ty = (e.clientY - r.top) * devicePixelRatio;
    if (mx < -999 || reduce()) { mx = tx; my = ty; }
    kick();
  });
  host.addEventListener('pointerleave', () => { tx = ty = mx = my = -9999; draw(); });
  if (type === 'video') el.addEventListener('loadeddata', prep, { once: true }); else el.onload = prep;
  const ro = new ResizeObserver(prep); ro.observe(host);
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (type === 'video') visible ? el.play().catch(() => {}) : el.pause();
    if (visible) kick();
  });
  io.observe(host);
  return { destroy() { alive = false; ro.disconnect(); io.disconnect(); if (type === 'video') { el.pause(); el.removeAttribute('src'); el.load(); } cv.remove(); } };
}

/** 숫자가 아래에서 굴러 올라오는 계수기 */
export function counter(el, to, { dur = 1400, fmt = (n) => n.toLocaleString('ko-KR') } = {}) {
  if (reduce()) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(to * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** 자리마다 숫자 띠가 굴러가는 계수기 (from → to). 자리 수가 늘면 앞자리가 새로 굴러 들어온다 */
export function odometer(el, to, from = 0, { dur = 1100, sep = true } = {}) {
  const f = (n) => (sep ? Math.round(n).toLocaleString('ko-KR') : String(Math.round(n)));
  const a = f(to), b = f(from).padStart(a.length, ' ').slice(-a.length);
  el.classList.add('odo');
  el.setAttribute('aria-label', a);
  el.replaceChildren(...[...a].map((ch, i) => {
    if (!/\d/.test(ch)) { const s = document.createElement('span'); s.className = 'odo-sep'; s.textContent = ch; return s; }
    const col = document.createElement('span'); col.className = 'odo-d';
    const strip = document.createElement('span'); strip.className = 'odo-s';
    strip.textContent = '0123456789'.split('').join('\n');
    const start = /\d/.test(b[i]) ? +b[i] : 0;
    strip.style.transform = `translateY(${-start * 1.25}em)`;
    col.append(strip);
    if (!reduce()) {
      strip.style.transition = `transform ${dur + (a.length - i) * 70}ms cubic-bezier(.2,.8,.2,1) ${i * 25}ms`;
      requestAnimationFrame(() => requestAnimationFrame(() => { strip.style.transform = `translateY(${-ch * 1.25}em)`; }));
    } else strip.style.transform = `translateY(${-ch * 1.25}em)`;
    return col;
  }));
}

/** 화면 가장자리에 흐린 라플라스 로그 글자 */
const LOGS = [
  ['ARCANUM_SCAN 001', 'ARCANUM_SCAN 002', 'ARCANUM_SCAN 00▮'],
  ['[감응 확인]', '[영감 측정 중]', '▮'],
  ['> storm.forecast()', '> 1999.12.31 23:59', '> retreat --hold'],
  ['LAPLACE // ARCHIVE', 'DOC.No 0721', 'SEALED ▮'],
  ['$ suitcase --open', '$ timekeeper.log()', '$ wanderer ▮'],
];
export function logs(host, n = 5) {
  for (let i = 0; i < n; i++) {
    const d = document.createElement('pre');
    d.className = 'fx-log';
    d.textContent = LOGS[i % LOGS.length].join('\n');
    d.style.left = `${[4, 78, 6, 70, 40][i % 5]}%`;
    d.style.top = `${[8, 14, 62, 70, 88][i % 5]}%`;
    host.append(d);
  }
}
