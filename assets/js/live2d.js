// Live2D — 보관용 저장소(reverse)에 담아 둔 모델을 불러와 움직이게 한다.
// 라이브러리(PixiJS, pixi-live2d-display, Cubism Core)는 처음 쓸 때만 불러온다.
import * as store from './store.js';

const DEFAULT_BASES = ['https://unpluggeddummy.github.io/reverse/', 'https://unpluggeddummy.github.io/reverse2/'];
let libsP = null;
let indexP = null;
const active = new Set();

/** Live2D 보관함 주소들 (설정에서 바꿀 수 있음, 쉼표로 여러 개) */
export function bases() {
  const set = store.state.user.settings?.live2dBase;
  const list = set ? String(set).split(/[,\s]+/).filter(Boolean) : DEFAULT_BASES;
  return list.map((b) => (b.endsWith('/') ? b : b + '/'));
}
const isOurs = (url) => bases().some((b) => url.startsWith(b));

/** 지금 이 출품작이 보여 줄 스킨 (내가 고른 스킨 > 통찰 스킨 > 기본) */
export function skinOf(c) {
  const rec = store.charRecord(c.id) || {};
  return rec.skin || ((rec.insight >= 2 && c.insightSkin) ? c.insightSkin : c.defaultSkin);
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[data-src="${src}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src; s.onload = res; s.onerror = () => rej(new Error(`${src}를 불러오지 못했어요`));
    document.head.append(s);
  });
}

async function libs() {
  libsP ||= (async () => {
    await loadScript('assets/vendor/live2d/live2dcubismcore.min.js');
    await loadScript('assets/vendor/live2d/pixi.min.js');
    await loadScript('assets/vendor/live2d/cubism4.min.js');
    const L = window.PIXI.live2d;
    // 보관함의 모델 뼈대(.moc3)는 용량을 줄이려고 gzip(.moc3.gz)으로 담아 둔다 → 받아서 풀어 준다
    L.Live2DLoader.middlewares.unshift(async (ctx, next) => {
      const url = ctx.settings ? ctx.settings.resolveURL(ctx.url) : ctx.url;
      if (ctx.type === 'arraybuffer' && /\.moc3$/.test(url) && isOurs(url) && 'DecompressionStream' in window) {
        const res = await fetch(url + '.gz');
        if (res.ok) {
          ctx.result = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
          return;
        }
      }
      return next();
    });
    return L;
  })();
  return libsP;
}

/** 보관함 여러 곳의 목록을 합친다. 직접 담긴 모델(path)이 원본 주소(remote)보다 우선 */
async function index() {
  indexP ||= Promise.all(bases().map((b) => fetch(b + 'live2d/index.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((d) => [b, d])))
    .then((all) => {
      const out = {};
      for (const [b, d] of all) {
        for (const [k, e] of Object.entries(d)) {
          if (e.path) out[k] = { ...e, url: b + e.path };
          else if (!out[k]) out[k] = { ...e, url: e.remote };
        }
      }
      return out;
    });
  return indexP;
}

/** 보관함에 담긴 모델 수 (0이면 아직 비었거나 못 불러온 것) */
export async function count() { return Object.keys(await index()).length; }

/** 이 스킨에 Live2D가 있으면 { url, motions, expressions } */
export async function find(skinId) {
  const e = (await index())[String(skinId)];
  if (!e) return null;
  return { url: e.url, motions: e.motions || [], expressions: [...new Set(e.expressions || [])] };
}

// 표정 이름 (중국어 병음) → 한국어
const FACE = {
  idle: '기본', kaixin: '기쁨', nanguo: '슬픔', shengqi: '화남', haixiu: '부끄러움', chijing: '놀람', jingya: '놀람',
  weixiao: '미소', danyou: '걱정', kunhuo: '곤혹', yihuo: '의아함', shiwang: '실망', jinzhang: '긴장', wunai: '난처함',
  lengmo: '냉담', deyi: '의기양양', beishang: '비통', kongju: '두려움', haipa: '겁먹음', fennu: '분노', ganga: '어색함',
  sikao: '생각', zhenjing: '충격', bishi: '경멸', xingfen: '흥분', pingjing: '평온', yanwu: '싫증', tiaopi: '장난',
  daxiao: '웃음', ku: '울음', bizui: '입 다묾', zhengyan: '눈 뜸', biyan: '눈 감음', xiaoxin: '조심', renzhen: '진지',
};
export function faceName(n) {
  const k = String(n).replace(/^e_/, '');
  return FACE[k] || k.split('_').map((p) => FACE[p] || p).join(' ');
}

// WebGL 화면은 하나만 만들어 함께 쓴다 (Live2D 그리기 도구가 여러 화면을 동시에 못 다뤄서).
// 매 프레임 각 모델을 이 공용 화면에 그린 뒤 각자의 그림판(2D 캔버스)으로 옮겨 그린다.
let shared = null;
function renderer() {
  if (!shared) {
    const P = window.PIXI;
    shared = new P.Renderer({ width: 256, height: 256, backgroundAlpha: 0, antialias: true, preserveDrawingBuffer: false });
    requestAnimationFrame(loop);
  }
  return shared;
}
function loop() {
  for (const m of active) {
    if (!m.visible || !m.el.isConnected) continue;
    const r = shared;
    const { w, h } = m.size;
    if (r.width !== w || r.height !== h) r.resize(w, h);
    r.render(m.stage);
    m.ctx.clearRect(0, 0, w, h);
    m.ctx.drawImage(r.view, 0, 0);
  }
  requestAnimationFrame(loop);
}

/** 모델이 실제로 그려지는 영역을 찾는다 (모델마다 캔버스 안 위치가 제각각이라) */
function measure(model) {
  const P = window.PIXI;
  const r = renderer();
  // 모델 캔버스 밖으로 삐져나와 그려지는 경우가 많아서 사방에 여백을 두고 잰다
  const s0 = 200 / Math.max(model.internalModel.originalWidth, model.internalModel.originalHeight);
  model.scale.set(s0);
  const w = Math.ceil(model.width), hgt = Math.ceil(model.height);
  model.position.set(w, hgt);
  const W = w * 3, H = hgt * 3;
  const rt = P.RenderTexture.create({ width: W, height: H });
  try {
    model.update(16);
    r.render(model, { renderTexture: rt });
    const px = r.extract.pixels(rt);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (px[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    if (x1 < 0) return null;
    return { x: (x0 - w) / s0, y: (y0 - hgt) / s0, w: (x1 - x0 + 2) / s0, h: (y1 - y0 + 2) / s0 };
  } catch (e) { console.warn(e); return null; } finally { rt.destroy(true); model.position.set(0, 0); }
}

/**
 * el 안에 Live2D를 띄운다.
 * mode: 'full' 전신이 다 보이게 / 'bust' 카드처럼 위쪽(얼굴~허리)을 크게
 * 돌려주는 것: { model, motion(), expression(name), destroy() } — 모델이 없으면 null
 */
export async function mount(el, skinId, { mode = 'full', interactive = true, onTap, allowRemote = true } = {}) {
  const info = await find(skinId);
  if (!info || !el.isConnected) return null;
  // 원본 저장소에서 바로 받는 모델은 압축 전이라 무거워서(10MB 이상) 카드 미리보기에서는 쓰지 않는다
  if (!allowRemote && !isOurs(info.url)) return null;
  const L = await libs();
  const P = window.PIXI;
  renderer();
  let model;
  try {
    model = await L.Live2DModel.from(info.url, { autoInteract: false, autoUpdate: true });
  } catch (e) {
    console.warn('Live2D 불러오기 실패', skinId, e);
    return null;
  }
  if (!el.isConnected) { model.destroy(); return null; }
  const mm = model.internalModel.motionManager;
  if (info.motions.includes('b_idle')) mm.groups.idle = 'b_idle';
  model.anchor.set(0, 0);
  const box = measure(model) || { x: 0, y: 0, w: model.internalModel.originalWidth, h: model.internalModel.originalHeight };
  const stage = new P.Container();
  stage.addChild(model);
  const canvas = document.createElement('canvas');
  canvas.className = 'l2d-canvas';
  const ctx = canvas.getContext('2d');
  const ctl = { el, stage, ctx, size: { w: 1, h: 1 }, visible: true, model, info, box };
  const place = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round((el.clientWidth || 1) * dpr));
    const h = Math.max(1, Math.round((el.clientHeight || 1) * dpr));
    canvas.width = w; canvas.height = h;
    ctl.size = { w, h };
    let s;
    if (mode === 'tall') {
      // 세로로 긴 칸: 키에 맞추고 좌우는 조금 잘려도 된다
      s = Math.min((h * 0.97) / box.h, (w * 1.6) / box.w);
      model.scale.set(s);
      model.position.set(w / 2 - (box.x + box.w / 2) * s, h - (box.y + box.h) * s);
    } else if (mode === 'bust') {
      s = (w / box.w) * 1.15;
      model.scale.set(s);
      model.position.set(w / 2 - (box.x + box.w / 2) * s, -box.y * s + h * 0.03);
    } else {
      s = Math.min(w / box.w, h / box.h) * 0.96;
      model.scale.set(s);
      model.position.set(w / 2 - (box.x + box.w / 2) * s, h - (box.y + box.h) * s - h * 0.01);
    }
  };
  place();
  el.append(canvas);
  if (window.L2D_DEBUG) console.log('l2d', skinId, JSON.stringify(box), el.clientWidth, el.clientHeight, model.scale.x);
  requestAnimationFrame(() => canvas.classList.add('on'));
  if (mm.groups.idle) model.motion(mm.groups.idle, undefined, 1);

  const body = info.motions.filter((m) => m.startsWith('b_') && m !== 'b_idle');
  ctl.motion = () => { if (body.length) model.motion(body[Math.floor(Math.random() * body.length)], undefined, 3); };
  ctl.expression = (n) => { try { model.expression(n); } catch { /* 없음 */ } };
  if (interactive) {
    canvas.style.cursor = 'pointer';
    canvas.addEventListener('click', () => { ctl.motion(); onTap && onTap(); });
  }
  // 화면 밖이면 그리지 않아서 배터리·그래픽 아끼기
  const io = new IntersectionObserver(([e]) => { ctl.visible = e.isIntersecting; });
  io.observe(el);
  const ro = new ResizeObserver(() => place());
  ro.observe(el);
  ctl.destroy = () => {
    io.disconnect(); ro.disconnect(); active.delete(ctl);
    canvas.remove();
    try { stage.destroy({ children: true }); } catch { /* 이미 정리됨 */ }
  };
  active.add(ctl);
  return ctl;
}

/** 페이지를 옮길 때 모두 정리 */
export function destroyAll() { for (const c of [...active]) c.destroy(); }
