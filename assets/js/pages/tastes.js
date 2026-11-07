// 취향표 — 트친들과 함께 채우는 리버스: 1999 취향표 메이커.
// 여러 사람을 한 장에 모은 가로표와 한 사람씩 보는 세로 카드를 캔버스로 그리고 PNG로 저장한다.
// 토큰·비밀번호 없이 누구나 쓴다. 기록은 이 브라우저(localStorage)에만 두고, 저장소에는 올리지 않는다.
// 다른 기기로 옮길 때는 백업 파일(JSON)로 내보내고 가져온다.
import { h, toast, drawer, uid, pickFile, readFileText, downloadJSON, shrinkImage, confirmAsk, fill } from '../ui.js';
import * as store from '../store.js';
import { afClass } from '../components.js';
import * as gh from '../github.js';

const KEY = 'r1999.tastes';
const AF = ['star', 'mineral', 'beast', 'plant', 'spirit', 'intellect'];
const AF_EN = { star: 'Star', mineral: 'Mineral', beast: 'Beast', plant: 'Plant', spirit: 'Spirit', intellect: 'Intellect' };
const AF_COLOR = { star: '#6f9fd8', mineral: '#c9a24b', plant: '#78ac63', beast: '#d26a4c', spirit: '#b28ad8', intellect: '#d8c25e' };
const AF_MAX = 2;
const CP_MAX = 2;
const BANNER = 1202 / 210; // 스토리 배너 가로:세로
const C = {
  bg: '#0a0908', panel: '#110f0c', cell: '#18150f', line: '#2a241b', lineStrong: '#4a3f2e',
  paper: '#ede6d8', dim: '#a99d88', faint: '#6f6553', brass: '#c9a35c', brassBright: '#ecd19a',
};
const SANS = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
// 캔버스 글씨는 모두 프리텐다드
const SERIF = SANS;
const MONO = SANS;
const MONOLOG = 'assets/img/item/unilog-large.webp';
const SKIN_FOCUS = 0.28; // 넓은 스킨 칸: 스킨 그림에서 얼굴이 오는 높이
const LOGO = 'assets/img/logo-kr.webp'; // 한국판 리버스: 1999 로고 (꾸미기에서 다른 그림으로 바꿀 수 있음) // 빈칸 기본 그림: 모노로그
const EXPORT_SCALE = 2;

// ── 기록 ──────────────────────────────────────────────────
const blankPerson = () => ({ id: uid(), name: '', avatar: null, avatarChar: null, af: {}, main: null, event: null, skin: null, cps: [] });
const blankSheet = (title = '리버스 1999 취향표') => ({ id: uid(), title, people: [blankPerson()] });

let db = null;
const OPTS = { charNames: false, storyNames: false, blankMode: 'monolog', blankText: '', blankImg: null, logoImg: null };
function normalize(d) {
  if (!d?.sheets?.length) return null;
  return { cur: d.sheets[0].id, updatedAt: 0, ...d, opts: { ...OPTS, ...(d.opts || {}) } };
}
function loadLocal() {
  try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch { return null; }
}
function fresh() { const s = blankSheet(); return { sheets: [s], cur: s.id, updatedAt: 0, opts: { ...OPTS } }; }
function save() {
  db.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { toast('브라우저 저장 공간이 모자라요. 백업 파일로 내보내 두고 사진을 줄여 보세요.', 'err'); }
}

const sheet = () => db.sheets.find((s) => s.id === db.cur) || db.sheets[0];
const person = (pid) => sheet().people.find((p) => p.id === pid);
function edit(pid, fn) { const p = person(pid); if (!p) return; fn(p); save(); refresh(); }

const view = { mode: 'table', person: null, fit: true };
let page = null; // 지금 그려진 화면의 갱신 함수

// ── 이미지 ────────────────────────────────────────────────
const cache = new Map();
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (!cache.has(src)) {
    cache.set(src, new Promise((res) => {
      const i = new Image();
      i.decoding = 'async';
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    }));
  }
  return cache.get(src);
}
// 위키 NPC 목록에 없어서 게임 원본(대화 머리 그림)에서 따로 가져온 NPC
const EXTRA_NPCS = [
  // 2.5 차이나타운 결투 — 何日君 / Teresa (게임 데이터 story_heroparam 2507, 머리 그림 631001)
  { id: 'npc-x-teresa', name: { ko: '하일군', en: 'Teresa', zh: '何日君' }, icon: 'assets/img/npc-extra/teresa.webp', firstVersion: '2.5' },
].map((n) => ({ ...n, npc: true, released: true, rarity: 0, skins: [], art: n.icon, portrait: n.icon }));
const EXTRA_BY_ID = new Map(EXTRA_NPCS.map((n) => [n.id, n]));
const charOf = (id) => EXTRA_BY_ID.get(id) || store.charById(id);
const npcs = () => store.npcList().concat(EXTRA_NPCS);

// 얼굴 위치 (tools/faces.py 로 미리 찾아 둔 값): 그림 경로 -> [cx, cy, 얼굴 크기]
let FACES = {};
let FACE_RATIO = 0.42; // 정사각형 칸에서 얼굴 너비가 차지하는 몫 (흉상)
let facesP = null;
function loadFaces() {
  facesP ||= fetch('data/game/faces.json').then((r) => (r.ok ? r.json() : {})).then((d) => {
    FACES = { ...(d.auto || {}), ...(d.manual || {}) };
    if (d.meta?.face) FACE_RATIO = d.meta.face;
  }).catch(() => {});
  return facesP;
}
const faceOf = (im) => { const src = im?.src || ''; const i = src.indexOf('assets/img/'); return i >= 0 ? FACES[decodeURIComponent(src.slice(i))] || null : null; };

/** 출품작 얼굴: 그 사람이 고른 의상 > 통찰 2 그림 > 기본, NPC는 대화 아이콘 > 전신 */
function charSrc(id, p) {
  const c = charOf(id);
  if (!c) return null;
  if (c.npc) return c.icon || c.art;
  const look = p?.looks?.[id];
  const sk = store.skinById(look) || store.skinById(c.insightSkin) || store.skinById(c.defaultSkin);
  if (!sk) return null;
  // 흉상으로 자르려면 폭이 넓은 그림이 낫다 (얼굴 위치를 아는 경우만)
  return (sk.art && FACES[sk.art]) ? sk.art : (sk.portrait || sk.art || null);
}
const skinSrc = (id) => { const s = store.skinById(id); return s?.art || s?.portrait || null; };
/** 버전 이벤트 이름: 게임 데이터에 아직 한국어가 없으면 그 버전 제목(한섭)으로 */
const verOf = (v) => (store.state.game.versions || []).find((x) => x.id === v);
/** 스토리 배너: 위키 배너가 아직 없으면 그 버전 대표 그림으로 */
// 위키 배너가 아직 없는 스토리에 임시로 쓰는 배너 [그림, 세로 위치(0 위 ~ 1 아래)]
const BANNER_EXTRA = {
  'mainevent-rekindled-games-of-the-summer-gold-sea': ['assets/img/story-extra/mainevent-rekindled-games-of-the-summer-gold-sea.webp', 0.12],
};
const storySrc = (id) => {
  const s = store.storyById(id); if (!s) return null;
  return s.banner || BANNER_EXTRA[id]?.[0] || (s.version ? `assets/img/ver/${s.version}/key.webp` : null);
};
/** 배너 자르기 높이: 위키 배너는 가운데, 임시 배너·대표 그림은 정한 위치 */
const storyFocus = (id) => { const s = store.storyById(id); if (!s || s.banner) return null; return BANNER_EXTRA[id]?.[1] ?? 0.3; };
const avatarSrc = (p) => p.avatar || (p.avatarChar ? charSrc(p.avatarChar) : null);
/** 빈칸 그림: 모노로그(기본) / 직접 올린 그림 / 없음 */
const blankSrc = () => (db.opts.blankMode === 'custom' ? db.opts.blankImg : db.opts.blankMode === 'none' ? null : MONOLOG);
/** 프로필 자르기: z 확대, x·y 0~1 위치 (사진은 가운데, 출품작은 위쪽이 기본) */
const avatarCrop = (p) => ({ z: 1, x: 0.5, y: p.avatar ? 0.5 : 0, ...(p.avatarCrop || {}) });
/** 출품작 프로필을 손으로 맞춘 적 없으면 얼굴 기준으로 자른다 */
const useFace = (p) => !p.avatar && !p.avatarCrop;
function cropSquare(im, c) {
  const side = Math.min(im.width, im.height) / Math.max(1, c.z || 1);
  return [(im.width - side) * c.x, (im.height - side) * c.y, side, side];
}
/** 목록·편집 창에 쓰는 동그란 프로필 (캔버스) */
function avatarThumb(p, size, cls = '') {
  const cv = h('canvas.tt-avc' + cls, { width: size * 2, height: size * 2, 'aria-hidden': 'true' });
  loadImg(avatarSrc(p)).then((im) => {
    if (!im) return;
    const ctx = cv.getContext('2d');
    ctx.beginPath(); ctx.arc(size, size, size, 0, Math.PI * 2); ctx.clip();
    if (useFace(p) && faceOf(im)) cover(ctx, im, 0, 0, size * 2, size * 2, true);
    else ctx.drawImage(im, ...cropSquare(im, avatarCrop(p)), 0, 0, size * 2, size * 2);
  });
  return cv;
}
const cName = (id) => store.charName(charOf(id));
function storyName(id) {
  const s = typeof id === 'object' ? id : store.storyById(id);
  if (!s) return '';
  if ((!s.name.ko || s.name.ko === s.name.en) && s.cat === 'mainevent' && verOf(s.version)?.title?.ko) return verOf(s.version).title.ko;
  return s.name.ko || s.name.en;
}
const skinName = (id) => { const s = store.skinById(id); return s ? (s.name || s.nameEn || '') : ''; };
const cpFilled = (cp) => cp && (cp.a || cp.b);
const afList = (p, k) => (p.af[k] || []).filter(Boolean).slice(0, AF_MAX);

function sourcesOf(people) {
  const out = new Set(AF.map((k) => store.afIcon(k)));
  out.add(blankSrc()); out.add(db.opts.logoImg || LOGO);
  for (const p of people) {
    out.add(avatarSrc(p));
    for (const k of AF) for (const id of afList(p, k)) out.add(charSrc(id, p));
    out.add(storySrc(p.main)); out.add(storySrc(p.event)); out.add(skinSrc(p.skin));
    for (const cp of p.cps) { out.add(charSrc(cp.a, p)); out.add(charSrc(cp.b, p)); }
  }
  out.delete(null); out.delete(undefined);
  return [...out];
}
async function preload(people) {
  await loadFaces();
  const srcs = sourcesOf(people);
  const ims = await Promise.all(srcs.map(loadImg));
  const map = new Map(srcs.map((s, i) => [s, ims[i]]));
  // 글꼴: 캔버스에 쓸 글자가 들어 있는 조각을 미리 받아 둔다
  const text = [sheet().title, ...people.map((p) => p.name), ...people.flatMap((p) => [
    ...AF.flatMap((k) => afList(p, k).map(cName)), storyName(p.main), storyName(p.event), skinName(p.skin),
  ]), '속성별 최애 메인스 이벤스 스킨 씨피 천체 암석 야수 나무 영혼 지능 이름 없음 0123456789'].join(' ');
  try {
    await Promise.all([
      document.fonts.load(`700 20px ${SANS}`, text), document.fonts.load(`500 20px ${SANS}`, text),
      document.fonts.load(`800 20px ${SANS}`, text + ' REVERSE : 1999 Fin de Siècle Wanderer · STAR MINERAL BEAST PLANT SPIRIT INTELLECT MAIN EVENT SKIN COUPLING'),
    ]);
  } catch { /* 글꼴 없이도 그린다 */ }
  return (src) => (src ? map.get(src) || null : null);
}

// ── 그리기 도우미 ─────────────────────────────────────────
function rr(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, hh, r); else ctx.rect(x, y, w, hh);
}
/** 칸을 꽉 채우게 잘라 그린다. top: 세로로 긴 그림은 위쪽(얼굴)을 맞춘다 */
function cover(ctx, im, x, y, w, hh, top, focusY) {
  const r = w / hh; const ir = im.width / im.height;
  const W = im.width; const H = im.height;
  const f = focusY == null ? faceOf(im) : null;
  if (f) {
    // 흉상: 얼굴 너비가 칸 너비의 FACE_RATIO(정사각형 기준)쯤 되게, 얼굴은 위에서 40% 높이에
    const fw = f[2] * W; const fx = f[0] * W; const fy = f[1] * H;
    // 그림 밖으로는 넓히지 않는다: 폭이 좁은 그림(예: 미스 스트레인저)은 그림 폭 그대로 정사각형으로
    let sh = (fw / FACE_RATIO) * (r > 1.3 ? 1.3 : 1); let sw = sh * r;
    if (sw > W) { sw = W; sh = sw / r; }
    if (sh > H) { sh = H; sw = sh * r; }
    region(ctx, im, fx - sw / 2, fy - sh * (r > 1.3 ? 0.44 : 0.4), sw, sh, x, y, w, hh);
    return;
  }
  let sx; let sy; let sw; let sh;
  if (ir > r) { sh = H; sw = sh * r; sx = (W - sw) / 2; sy = 0; } else {
    sw = W; sh = sw / r; sx = 0;
    sy = focusY != null ? (H - sh) * focusY : top ? Math.min(H - sh, W * 0.02) : (H - sh) / 2;
  }
  ctx.drawImage(im, sx, sy, sw, sh, x, y, w, hh);
}
/** 그림의 (sx,sy,sw,sh) 부분을 칸에 그린다. 그림 밖으로 나가는 부분은 같은 그림을 흐리게 깔아 채운다 */
function region(ctx, im, sx, sy, sw, sh, x, y, w, hh) {
  const W = im.width; const H = im.height;
  if (sw <= W) sx = Math.min(Math.max(0, sx), W - sw);
  if (sh <= H) sy = Math.min(Math.max(0, sy), H - sh);
  const k = w / sw;
  if (sx < 0 || sy < 0 || sx + sw > W || sy + sh > H) {
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(12px)';
    const r = w / hh; const ir = W / H;
    let bw; let bh;
    if (ir > r) { bh = H; bw = bh * r; } else { bw = W; bh = bw / r; }
    ctx.drawImage(im, (W - bw) / 2, Math.max(0, sy) * (bh < H ? 1 : 0), bw, bh, x - 12, y - 12, w + 24, hh + 24);
    ctx.restore();
    ctx.fillStyle = 'rgba(10,9,8,.45)'; ctx.fillRect(x, y, w, hh);
  }
  const ix0 = Math.max(0, sx); const iy0 = Math.max(0, sy); const ix1 = Math.min(W, sx + sw); const iy1 = Math.min(H, sy + sh);
  if (ix1 <= ix0 || iy1 <= iy0) return;
  const dx = x + (ix0 - sx) * k; const dw = (ix1 - ix0) * k;
  ctx.drawImage(im, ix0, iy0, ix1 - ix0, iy1 - iy0, dx, y + (iy0 - sy) * k, dw, (iy1 - iy0) * k);
  // 그림 가장자리를 배경 쪽으로 살짝 녹인다
  const fade = Math.min(14, dw * 0.08);
  for (const [ex, dir] of [[dx, 1], [dx + dw, -1]]) {
    if ((dir === 1 && ix0 > 0) || (dir === -1 && ix1 < W)) continue;
    if (dir === 1 && dx <= x + 0.5) continue;
    if (dir === -1 && dx + dw >= x + w - 0.5) continue;
    const g = ctx.createLinearGradient(ex, 0, ex + dir * fade, 0);
    g.addColorStop(0, 'rgba(10,9,8,.55)'); g.addColorStop(1, 'rgba(10,9,8,0)');
    ctx.fillStyle = g; ctx.fillRect(Math.min(ex, ex + dir * fade), y, fade, hh);
  }
}
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
/** 그림 칸 하나 */
function cell(ctx, x, y, w, hh, im, { top = true, focusY = null, label = '', edge = C.line, preview = false, r = 6 } = {}) {
  ctx.save();
  rr(ctx, x, y, w, hh, r); ctx.fillStyle = C.cell; ctx.fill(); ctx.clip();
  if (im) cover(ctx, im, x, y, w, hh, top, focusY);
  else if (preview) {
    ctx.fillStyle = C.faint; ctx.font = `300 ${Math.round(hh * 0.34)}px ${SANS}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+', x + w / 2, y + hh / 2);
  }
  if (im && label) {
    const lh = Math.max(18, Math.round(hh * 0.22));
    const g = ctx.createLinearGradient(0, y + hh - lh * 1.6, 0, y + hh);
    g.addColorStop(0, 'rgba(5,4,3,0)'); g.addColorStop(1, 'rgba(5,4,3,.88)');
    ctx.fillStyle = g; ctx.fillRect(x, y + hh - lh * 1.6, w, lh * 1.6);
    ctx.fillStyle = C.paper; ctx.font = `600 ${Math.round(lh * 0.62)}px ${SANS}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitText(ctx, label, w - 8), x + w / 2, y + hh - lh * 0.38);
  }
  ctx.restore();
  ctx.save(); rr(ctx, x + 0.5, y + 0.5, w - 1, hh - 1, r); ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}
function avatar(ctx, cx, cy, d, im, crop) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fillStyle = C.cell; ctx.fill(); ctx.clip();
  if (im && !crop) cover(ctx, im, cx - d / 2, cy - d / 2, d, d, true);
  else if (im) ctx.drawImage(im, ...cropSquare(im, crop), cx - d / 2, cy - d / 2, d, d);
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, d / 2 + 0.5, 0, Math.PI * 2); ctx.strokeStyle = C.brass; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
}
/** 빈칸: '꽝' (원하는 그림을 올려 두면 그 그림 + 글자) */
function blank(ctx, x, y, w, hh, get, { preview = false, r = 6 } = {}) {
  const im = get(blankSrc());
  const text = db.opts.blankText || '';
  if (!im && !text) { cell(ctx, x, y, w, hh, null, { preview, r }); return; }
  ctx.save();
  rr(ctx, x, y, w, hh, r); ctx.fillStyle = C.panel; ctx.fill(); ctx.clip();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const wide = w > hh * 1.5;
  if (im) {
    const box = hh * (text ? 0.82 : 0.92);
    const k = Math.min(box / im.width, box / im.height);
    const iw = im.width * k; const ih = im.height * k;
    const tx = wide ? hh * 0.42 : 0; // 넓은 칸은 그림 오른쪽에 글자
    const ix = x + (w - iw) / 2 - (wide && text ? tx : 0);
    const iy = y + (hh - ih) / 2 - (!wide && text ? hh * 0.06 : 0);
    ctx.drawImage(im, ix, iy, iw, ih);
    if (text) {
      const fs = Math.round(hh * (wide ? 0.3 : 0.24));
      ctx.font = `900 ${fs}px ${SANS}`;
      const px = wide ? ix + iw + hh * 0.08 + ctx.measureText(text).width / 2 : x + w / 2;
      const py = wide ? y + hh / 2 : y + hh - fs * 0.62;
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, fs * 0.22); ctx.strokeStyle = C.bg; ctx.strokeText(text, px, py);
      ctx.fillStyle = C.brassBright; ctx.fillText(text, px, py);
    }
  } else if (text) {
    ctx.font = `900 ${Math.round(hh * 0.4)}px ${SANS}`;
    ctx.fillStyle = C.faint; ctx.fillText(text, x + w / 2, y + hh / 2 + 2);
  }
  ctx.restore();
  ctx.save(); ctx.setLineDash([4, 4]); rr(ctx, x + 0.5, y + 0.5, w - 1, hh - 1, r); ctx.strokeStyle = C.lineStrong; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}
function background(ctx, w, hh) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, hh);
  const g = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, Math.max(w, hh) * 0.7);
  g.addColorStop(0, 'rgba(201,163,92,.10)'); g.addColorStop(1, 'rgba(201,163,92,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, hh);
  ctx.strokeStyle = 'rgba(201,163,92,.035)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0.5; x < w; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, hh); }
  for (let y = 0.5; y < hh; y += 48) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}
/** 머리 칸 이름표 (알약 모양) */
/** 영감 색 위에 올릴 글자색: 밝은 색이면 검정, 어두우면 흰색 */
function onColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#0a0908' : '#ffffff';
}
/** 영감 아이콘을 글자색 한 가지로 칠한다 (색 칸 위에서도 보이게) */
const tintCache = new Map();
function tinted(im, color) {
  const k = im.src + color;
  if (!tintCache.has(k)) {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    tintCache.set(k, c);
  }
  return tintCache.get(k);
}
function pill(ctx, x, y, w, hh, text, { color = null, icon = null } = {}) {
  ctx.save();
  rr(ctx, x, y, w, hh, hh / 2); ctx.fillStyle = color || C.panel; ctx.fill();
  if (!color) { ctx.strokeStyle = C.lineStrong; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.font = `700 15px ${SANS}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const tw = ctx.measureText(text).width; const iw = icon ? 18 : 0; const gap = icon ? 6 : 0;
  const sx = x + (w - tw - iw - gap) / 2;
  if (icon) ctx.drawImage(color ? tinted(icon, onColor(color)) : icon, sx, y + (hh - iw) / 2, iw, iw);
  ctx.fillStyle = color ? onColor(color) : C.paper; ctx.fillText(text, sx + iw + gap, y + hh / 2 + 1);
  ctx.restore();
}
/** 리버스: 1999 로고 (올린 로고 그림이 없으면 글자로) — cx 기준 가운데, 상자 boxW×boxH 안에 맞춘다 */
function logo(ctx, cx, y, boxW, boxH, get, align = 'center') {
  const im = get(db.opts.logoImg || LOGO);
  if (im) {
    const k = Math.min(boxW / im.width, boxH / im.height);
    const w = im.width * k; const hh = im.height * k;
    const x = align === 'right' ? cx - w : cx - w / 2;
    ctx.drawImage(im, x, y + (boxH - hh) / 2, w, hh);
    return;
  }
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillStyle = C.paper; ctx.font = `800 ${Math.round(boxH * 0.5)}px ${SANS}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(boxH * 0.06)}px`;
  ctx.fillText('REVERSE : 1999', cx, y + boxH / 2);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

// ── 가로표 (여러 사람) ─────────────────────────────────────
const T = { S: 96, G: 6, COLG: 22, PAD: 48, PERSON: 120, ROWPAD: 16, HEAD: 150, LABEL: 40 };
function tableLayout(sh) {
  const { S, G, COLG, PAD, PERSON } = T;
  const people = sh.people;
  const B = Math.round(S * BANNER);
  const cols = [];
  let x = PAD + PERSON + COLG;
  for (const k of AF) {
    const n = Math.min(AF_MAX, Math.max(1, ...people.map((p) => afList(p, k).length)));
    const w = n * S + (n - 1) * G;
    cols.push({ key: 'af:' + k, af: k, x, w, n, label: store.AFFLATUS[k] });
    x += w + COLG;
  }
  cols.push({ key: 'main', x, w: B, label: '메인스' }); x += B + COLG;
  cols.push({ key: 'event', x, w: B, label: '이벤스' }); x += B + COLG;
  cols.push({ key: 'skin', x, w: 2 * S + G, label: '스킨' }); x += 2 * S + G + COLG;
  const ncp = Math.min(CP_MAX, Math.max(1, ...people.map((p) => p.cps.filter(cpFilled).length)));
  const cpw = ncp * (2 * S + G) + (ncp - 1) * 14;
  cols.push({ key: 'cp', x, w: Math.max(cpw, 2 * S + G), n: ncp, label: '씨피' }); x += Math.max(cpw, 2 * S + G);
  const W = x + PAD;
  const rowH = S + T.ROWPAD * 2;
  const top = T.HEAD + T.LABEL + 14;
  const H = top + people.length * rowH + 40;
  return { W, H, cols, rowH, top, B };
}

function drawTable(ctx, sh, get, { preview } = {}) {
  const L = tableLayout(sh);
  const { S, G, PAD, PERSON } = T;
  const hits = [];
  background(ctx, L.W, L.H);
  logo(ctx, L.W / 2, 34, 520, 92, get);
  // 머리 칸
  const ly = T.HEAD;
  for (const c of L.cols) {
    const pw = Math.min(c.w, 150);
    pill(ctx, c.x + (c.w - pw) / 2, ly, pw, 34, c.label, c.af ? { color: AF_COLOR[c.af], icon: get(store.afIcon(c.af)) } : {});
  }
  ctx.strokeStyle = C.lineStrong; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, L.top - 7.5); ctx.lineTo(L.W - PAD, L.top - 7.5); ctx.stroke();

  sh.people.forEach((p, i) => {
    const y0 = L.top + i * L.rowH;
    const y = y0 + T.ROWPAD;
    // 사람 칸: 프로필 + 닉네임
    const d = Math.round(S * 0.62);
    avatar(ctx, PAD + PERSON / 2, y + d / 2 + 2, d, get(avatarSrc(p)), useFace(p) && faceOf(get(avatarSrc(p))) ? null : avatarCrop(p));
    const name = p.name || (preview ? '이름 없음' : '');
    if (name) {
      ctx.font = `600 14px ${SANS}`;
      const t = fitText(ctx, name, PERSON - 16);
      const tw = Math.min(PERSON, ctx.measureText(t).width + 22);
      const py = y + d + 10;
      rr(ctx, PAD + (PERSON - tw) / 2, py, tw, 24, 12); ctx.fillStyle = C.panel; ctx.fill();
      ctx.strokeStyle = C.lineStrong; ctx.stroke();
      ctx.fillStyle = p.name ? C.paper : C.faint; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t, PAD + PERSON / 2, py + 12.5);
    }
    hits.push({ x: PAD, y: y0, w: PERSON, h: L.rowH, pid: p.id, kind: 'person' });

    for (const c of L.cols) {
      hits.push({ x: c.x - 4, y: y0, w: c.w + 8, h: L.rowH, pid: p.id, kind: c.key });
      if (c.af) {
        const ids = afList(p, c.af);
        for (let j = 0; j < c.n; j++) {
          const id = ids[j];
          if (id) cell(ctx, c.x + j * (S + G), y, S, S, get(charSrc(id, p)), { edge: hexA(AF_COLOR[c.af], 0.55), label: db.opts.charNames ? cName(id) : '' });
          else blank(ctx, c.x + j * (S + G), y, S, S, get, { preview });
        }
      } else if (c.key === 'main' || c.key === 'event') {
        const sid = p[c.key];
        if (!sid) blank(ctx, c.x, y, c.w, S, get, { preview });
        else cell(ctx, c.x, y, c.w, S, get(storySrc(sid)), { top: false, focusY: storyFocus(sid), label: db.opts.storyNames ? storyName(sid) : '' });
      } else if (c.key === 'skin') {
        if (!p.skin) blank(ctx, c.x, y, c.w, S, get, { preview });
        else cell(ctx, c.x, y, c.w, S, get(skinSrc(p.skin)), { focusY: p.skinFocus ?? (faceOf(get(skinSrc(p.skin))) ? null : SKIN_FOCUS), label: db.opts.charNames ? skinName(p.skin) : '' });
      } else if (c.key === 'cp') {
        const cps = p.cps.filter(cpFilled);
        for (let j = 0; j < c.n; j++) {
          const px = c.x + j * (2 * S + G + 14);
          if (cps[j]) drawPair(ctx, px, y, S, G, cps[j], get, preview, p);
          else blank(ctx, px, y, 2 * S + G, S, get, { preview });
        }
      }
    }
    if (i < sh.people.length - 1) {
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD, y0 + L.rowH + 0.5); ctx.lineTo(L.W - PAD, y0 + L.rowH + 0.5); ctx.stroke();
    }
  });
  return { W: L.W, H: L.H, hits };
}
function drawPair(ctx, x, y, S, G, cp, get, preview, p) {
  [cp.a, cp.b].forEach((id, i) => {
    if (id) cell(ctx, x + i * (S + G), y, S, S, get(charSrc(id, p)), { label: db.opts.charNames ? cName(id) : '' });
    else blank(ctx, x + i * (S + G), y, S, S, get, { preview });
  });
  // 가운데 작은 이음표
  const cx = x + S + G / 2; const cy = y + S / 2; const r = Math.round(S * 0.11);
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = C.bg; ctx.fill();
  ctx.strokeStyle = C.brass; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = C.brassBright; ctx.font = `700 ${Math.round(r * 1.2)}px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('×', cx, cy + 1); ctx.restore();
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── 세로 카드 (한 사람) ─────────────────────────────────────
const K = { S: 112, G: 8, P: 48, BG: 28, LBL: 30, SEC: 26 };
function cardLayout() {
  const { S, G, P, BG } = K;
  const block = AF_MAX * S + (AF_MAX - 1) * G;
  const cw = block * 3 + BG * 2; // 속성 블록 3열 × 2줄
  const W = cw + P * 2;
  let y = P + 140; // 머리 부분
  const afY = y + 22;
  y = afY + 2 * (K.LBL + S) + K.SEC;
  const mainY = y + K.SEC + 6; y = mainY + K.LBL + S;
  const evY = y + K.SEC; y = evY + K.LBL + S;
  const lastY = y + K.SEC; y = lastY + K.LBL + S;
  const H = y + K.P;
  return { W, H, cw, block, afY, mainY, evY, lastY, B: Math.round(S * BANNER) };
}
function secLabel(ctx, x, y, ko, en, color) {
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color || C.paper; ctx.font = `700 16px ${SANS}`;
  ctx.fillText(ko, x, y + 18);
  const w = ctx.measureText(ko).width;
  ctx.fillStyle = C.faint; ctx.font = `600 11px ${SANS}`;
  ctx.fillText(en.toUpperCase(), x + w + 8, y + 17);
}
function drawCard(ctx, sh, p, get, { preview } = {}) {
  const L = cardLayout();
  const { S, G, P, BG } = K;
  const hits = [];
  const tl = tableLayout(sh); // 빈칸(꽝) 수는 가로표와 같게: 그 속성에서 가장 많이 고른 사람 기준
  const nOf = (k) => tl.cols.find((c) => c.af === k).n;
  background(ctx, L.W, L.H);
  // 머리: 프로필 + 닉네임
  const d = 112;
  avatar(ctx, P + d / 2, P + 10 + d / 2, d, get(avatarSrc(p)), useFace(p) && faceOf(get(avatarSrc(p))) ? null : avatarCrop(p));
  hits.push({ x: P, y: P, w: L.cw, h: d + 20, pid: p.id, kind: 'person' });
  const tx = P + d + 26;
  const logoW = 230;
  logo(ctx, L.W - P, P + 30, logoW, 72, get, 'right');
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = p.name ? C.paper : C.faint; ctx.font = `800 38px ${SANS}`;
  ctx.fillText(fitText(ctx, p.name || (preview ? '이름 없음' : ''), L.cw - d - 30 - logoW - 20), tx, P + 10 + d / 2);
  ctx.strokeStyle = C.lineStrong; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(P, L.afY - 10.5); ctx.lineTo(L.W - P, L.afY - 10.5); ctx.stroke();

  // 속성별 최애: 2열 × 3줄
  AF.forEach((k, i) => {
    const bx = P + (i % 3) * (L.block + BG);
    const by = L.afY + Math.floor(i / 3) * (K.LBL + S + K.SEC);
    ctx.font = `700 15px ${SANS}`;
    pill(ctx, bx, by, ctx.measureText(store.AFFLATUS[k]).width + 50, 24, store.AFFLATUS[k], { color: AF_COLOR[k], icon: get(store.afIcon(k)) });
    const ids = afList(p, k);
    const yy = by + K.LBL;
    for (let j = 0; j < nOf(k); j++) {
      if (ids[j]) cell(ctx, bx + j * (S + G), yy, S, S, get(charSrc(ids[j], p)), { edge: hexA(AF_COLOR[k], 0.55), label: db.opts.charNames ? cName(ids[j]) : '' });
      else blank(ctx, bx + j * (S + G), yy, S, S, get, { preview });
    }
    hits.push({ x: bx, y: by, w: L.block, h: K.LBL + S, pid: p.id, kind: 'af:' + k });
  });
  // 메인스 · 이벤스: 배너 높이 = 정사각형 높이
  const bx = P + (L.cw - L.B) / 2;
  [['main', L.mainY, '최애 메인스', 'Main Story'], ['event', L.evY, '최애 이벤스', 'Event Story']].forEach(([key, y, ko, en]) => {
    secLabel(ctx, bx, y, ko, en);
    if (!p[key]) blank(ctx, bx, y + K.LBL, L.B, S, get, { preview });
    else cell(ctx, bx, y + K.LBL, L.B, S, get(storySrc(p[key])), { top: false, focusY: storyFocus(p[key]), label: db.opts.storyNames ? storyName(p[key]) : '' });
    hits.push({ x: bx, y, w: L.B, h: K.LBL + S, pid: p.id, kind: key });
  });
  // 스킨 + 씨피
  const skinW = 2 * S + G; // 스킨은 씨피 한 쌍만큼 넓게
  const rowW = skinW + BG + 2 * (2 * S + G) + 18;
  const sx = P + Math.max(0, (L.cw - rowW) / 2);
  secLabel(ctx, sx, L.lastY, '최애 스킨', 'Skin');
  if (!p.skin) blank(ctx, sx, L.lastY + K.LBL, skinW, S, get, { preview });
  else cell(ctx, sx, L.lastY + K.LBL, skinW, S, get(skinSrc(p.skin)), { focusY: p.skinFocus ?? (faceOf(get(skinSrc(p.skin))) ? null : SKIN_FOCUS), label: db.opts.charNames ? skinName(p.skin) : '' });
  hits.push({ x: sx, y: L.lastY, w: skinW, h: K.LBL + S, pid: p.id, kind: 'skin' });
  const cx = sx + skinW + BG;
  secLabel(ctx, cx, L.lastY, '최애 씨피', 'Coupling');
  const cps = p.cps.filter(cpFilled);
  if (!cps.length) blank(ctx, cx, L.lastY + K.LBL, 2 * S + G, S, get, { preview });
  cps.slice(0, CP_MAX).forEach((cp, j) => drawPair(ctx, cx + j * (2 * S + G + 18), L.lastY + K.LBL, S, G, cp, get, preview, p));
  hits.push({ x: cx, y: L.lastY, w: 4 * S + 2 * G + 18, h: K.LBL + S, pid: p.id, kind: 'cp' });
  return { W: L.W, H: L.H, hits };
}

// ── 캔버스로 만들기 ────────────────────────────────────────
async function renderTo(canvas, { mode, pid, scale, preview, maxPx = 16e6 }) {
  const sh = sheet();
  const people = mode === 'card' ? [person(pid)].filter(Boolean) : sh.people;
  const get = await preload(people);
  const size = mode === 'card' ? cardLayout() : tableLayout(sh);
  // 휴대폰 브라우저는 캔버스 넓이에 한도가 있어서(아이폰 약 1,670만 화소) 넘지 않게 배율을 줄인다
  scale = Math.min(scale, Math.sqrt(maxPx / (size.W * size.H)));
  canvas.width = Math.round(size.W * scale);
  canvas.height = Math.round(size.H * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  const out = mode === 'card' ? drawCard(ctx, sh, people[0], get, { preview }) : drawTable(ctx, sh, get, { preview });
  return out;
}
function fileSafe(s) { return String(s || '취향표').replace(/[\\/:*?"<>|]+/g, '').trim() || '취향표'; }
async function exportPNG(mode, pid) {
  const cv = document.createElement('canvas');
  await renderTo(cv, { mode, pid, scale: EXPORT_SCALE, preview: false, maxPx: 16e6 });
  // 미리보기와 달리 저장본은 크게 만든 뒤 바로 비운다
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  if (!blob) { toast('이미지를 만들지 못했어요.', 'err'); return; }
  const sh = sheet();
  const name = mode === 'card' ? `${fileSafe(sh.title)} - ${fileSafe(person(pid)?.name || '카드')}.png` : `${fileSafe(sh.title)} - 가로표.png`;
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  cv.width = 1; cv.height = 1; // 큰 캔버스 메모리 돌려주기
}

// ── 고르기 창 ─────────────────────────────────────────────
/** 출품작 여러 명 고르기 (고른 순서대로) */
function pickChars({ title, max, selected = [], af = null, npc = false, onDone, onClose }) {
  const pick = selected.filter(Boolean);
  let q = '';
  let afF = af;
  let showNpc = npc || pick.some(store.isNpcId);
  const grid = h('div.char-pick');
  const count = h('span.faint', { style: { fontSize: '13px' } });
  const chips = h('div.chips');
  const drawChips = () => chips.replaceChildren(
    h('button.chip', { type: 'button', 'aria-pressed': String(!afF), onclick: () => { afF = null; drawChips(); draw(); } }, '전체'),
    ...AF.map((k) => h('button.chip', { type: 'button', 'aria-pressed': String(afF === k), onclick: () => { afF = k; drawChips(); draw(); } },
      h('i.sw', { style: { background: AF_COLOR[k] } }), store.AFFLATUS[k])),
  );
  const matchAf = (c) => !afF || c.afflatus === afF || (c.afflatus === 'mineral-star' && (afF === 'mineral' || afF === 'star'));
  const draw = () => {
    const list = store.state.game.characters.filter((c) => c.released)
      .concat(showNpc ? npcs() : npcs().filter((n) => pick.includes(n.id)))
      .filter((c) => c.npc || matchAf(c) || pick.includes(c.id))
      .filter((c) => !q || [store.charName(c), ...Object.values(c.name || {})].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (pick.includes(b.id) - pick.includes(a.id)) || (!!a.npc - !!b.npc) || b.rarity - a.rarity || store.charName(a).localeCompare(store.charName(b), 'ko'));
    grid.replaceChildren(...list.map((c) => h('button', {
      type: 'button', class: afClass(c), 'aria-pressed': String(pick.includes(c.id)), title: store.charName(c),
      onclick: () => {
        const i = pick.indexOf(c.id);
        if (i >= 0) pick.splice(i, 1);
        else if (max === 1) { pick.length = 0; pick.push(c.id); }
        else if (pick.length >= max) { count.textContent = `최대 ${max}명까지 고를 수 있어요`; return; } else pick.push(c.id);
        draw();
      },
    }, h('img', { src: charSrc(c.id) || '', alt: '', loading: 'lazy' }), h('span', store.charName(c)), c.npc ? h('em.npc-tag', 'NPC') : null,
    pick.includes(c.id) ? h('i.order', pick.indexOf(c.id) + 1) : null)));
    count.textContent = `${pick.length} / ${max}`;
  };
  drawChips(); draw();
  const d = drawer({
    title, wide: true, onClose,
    body: [
      h('div.toolbar', { style: { marginBottom: '10px' } },
        h('div.grow', h('input', { type: 'search', placeholder: '이름 검색', 'aria-label': '출품작 검색', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } })),
        h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: showNpc, onchange: (e) => { showNpc = e.target.checked; draw(); } }), 'NPC도 보기'),
        count),
      af ? h('div', { style: { marginBottom: '12px' } }, chips) : null,
      grid,
    ],
    foot: [
      h('button.btn.ghost', { type: 'button', onclick: () => { pick.length = 0; draw(); } }, '비우기'),
      h('button.btn', { type: 'button', onclick: () => d.close() }, '취소'),
      h('button.btn.primary', { type: 'button', onclick: () => { onDone([...pick]); d.close(); } }, '확인'),
    ],
  });
}

/** 스토리 하나 고르기 (배너 목록) */
function pickStory({ title, cats, selected, onDone, onClose }) {
  let q = '';
  let cat = cats[0][0];
  const grid = h('div.story-pick');
  const chips = h('div.chips');
  const drawChips = () => chips.replaceChildren(...cats.map(([k, label]) => h('button.chip', { type: 'button', 'aria-pressed': String(cat === k), onclick: () => { cat = k; drawChips(); draw(); } }, label)));
  const draw = () => {
    const list = (store.state.game.stories || []).filter((s) => s.cat === cat)
      .filter((s) => !q || [storyName(s), s.name.ko, s.name.en, s.version].join(' ').toLowerCase().includes(q))
      .sort((a, b) => store.verNum(a.version) - store.verNum(b.version) || (a.order ?? 0) - (b.order ?? 0));
    grid.replaceChildren(...list.map((s) => h('button', {
      type: 'button', 'aria-pressed': String(s.id === selected), onclick: () => { onDone(s.id); d.close(); },
    }, storySrc(s.id) ? h('img', { src: storySrc(s.id), alt: '', loading: 'lazy' }) : h('div.tt-nobanner', storyName(s)), h('span', h('b', storyName(s)), !s.banner && storySrc(s.id) ? h('em.faint', BANNER_EXTRA[s.id] ? ' (임시 배너)' : ' (대표 그림)') : null, h('small', s.version ? store.verLabel(s.version, true) : '')))));
  };
  if (selected) { const s = store.storyById(selected); if (s && cats.some(([k]) => k === s.cat)) cat = s.cat; }
  drawChips(); draw();
  const d = drawer({
    title, wide: true, onClose,
    body: [
      h('div.toolbar', { style: { marginBottom: '10px' } },
        h('div.grow', h('input', { type: 'search', placeholder: '스토리 이름·버전 검색', 'aria-label': '스토리 검색', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } }))),
      cats.length > 1 ? h('div', { style: { marginBottom: '12px' } }, chips) : null,
      grid,
    ],
    foot: [
      selected ? h('button.btn.ghost', { type: 'button', onclick: () => { onDone(null); d.close(); } }, '비우기') : null,
      h('button.btn', { type: 'button', onclick: () => d.close() }, '취소'),
    ],
  });
}

/** 스킨 하나 고르기 */
function pickSkin({ selected, onDone, onClose, char = null }) {
  let q = '';
  let costumeOnly = !char;
  const grid = h('div.char-pick.skin-pick');
  const draw = () => {
    const list = store.state.game.skins
      .filter((s) => (char ? s.char === char : charOf(s.char)?.released))
      .filter((s) => !costumeOnly || !['default', 'insight'].includes(s.cat) || s.id === selected)
      .filter((s) => !q || [s.name, s.nameEn, cName(s.char)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (char ? a.id - b.id : ((b.id === selected) - (a.id === selected)) || store.verNum(b.version) - store.verNum(a.version) || b.id - a.id));
    grid.replaceChildren(...list.map((s) => h('button', {
      type: 'button', class: afClass(charOf(s.char)), 'aria-pressed': String(s.id === selected), title: `${cName(s.char)} · ${s.name}`,
      onclick: () => { onDone(s.id); d.close(); },
    }, h('img', { src: (char ? s.portrait : s.art) || s.portrait || s.art, alt: '', loading: 'lazy' }),
    h('span', char ? null : [h('b', cName(s.char)), h('br')], char && s.id === charOf(char)?.insightSkin ? '통찰 2 (기본값)' : (s.name || s.nameEn)))));
  };
  draw();
  const d = drawer({
    title: char ? `${cName(char)} — 표에 넣을 의상` : '최애 스킨 고르기', wide: true, onClose,
    body: [
      h('div.toolbar', { style: { marginBottom: '10px' } },
        h('div.grow', h('input', { type: 'search', placeholder: '스킨·출품작 이름 검색', 'aria-label': '스킨 검색', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } })),
        h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: costumeOnly, onchange: (e) => { costumeOnly = e.target.checked; draw(); } }), '의상만 (기본·통찰 빼기)')),
      grid,
    ],
    foot: [
      selected ? h('button.btn.ghost', { type: 'button', onclick: () => { onDone(null); d.close(); } }, '비우기') : null,
      h('button.btn', { type: 'button', onclick: () => d.close() }, '취소'),
    ],
  });
}

/** 씨피 고르기: 한 쌍씩 */
function pickCp(pid, idx, back) {
  const p = person(pid);
  const cp = p.cps[idx] || {};
  pickChars({
    title: `최애 씨피 ${idx + 1} 고르기 (두 명)`, max: 2, selected: [cp.a, cp.b], npc: true, onClose: back,
    onDone: (ids) => edit(pid, (x) => {
      x.cps[idx] = { a: ids[0] || null, b: ids[1] || null };
      x.cps = x.cps.filter(cpFilled).slice(0, CP_MAX);
    }),
  });
}

/** 칸을 눌렀을 때 */
function openSlot(pid, kind, back) {
  const p = person(pid);
  if (!p) return;
  if (kind === 'person') { personEditor(pid); return; }
  if (kind.startsWith('af:')) {
    const k = kind.slice(3);
    pickChars({
      title: `${store.AFFLATUS[k]} 최애 고르기 (1~${AF_MAX}명)`, max: AF_MAX, selected: afList(p, k), af: k, onClose: back,
      onDone: (ids) => edit(pid, (x) => { x.af[k] = ids; if (!ids.length) delete x.af[k]; }),
    });
  } else if (kind === 'main') {
    pickStory({ title: '최애 메인스 고르기', cats: [['main', '메인 스토리']], selected: p.main, onClose: back, onDone: (id) => edit(pid, (x) => { x.main = id; }) });
  } else if (kind === 'event') {
    pickStory({ title: '최애 이벤스 고르기', cats: [['mainevent', '버전 이벤트'], ['anec', '일화'], ['char', '캐릭터 스토리']], selected: p.event, onClose: back, onDone: (id) => edit(pid, (x) => { x.event = id; }) });
  } else if (kind === 'skin') {
    pickSkin({ selected: p.skin, onClose: back, onDone: (id) => edit(pid, (x) => { x.skin = id; x.skinFocus = null; }) });
  } else if (kind === 'cp') {
    if (back) { pickCp(pid, Math.min(p.cps.filter(cpFilled).length, CP_MAX - 1), back); return; }
    personEditor(pid, 'cp');
  }
}

// ── 한 사람 편집 서랍 ──────────────────────────────────────
function thumbs(srcs, cls = '') {
  return h('div.tt-thumbs' + cls, srcs.length ? srcs.map(([src, label]) => h('figure', h('img', { src: src || '', alt: '' }), h('figcaption', label))) : h('span.faint', '비어 있음'));
}
/** 고른 출품작 썸네일 + 의상 바꾸기 (예: 투스 페어리를 스킨 입힌 모습으로) */
function lookThumbs(p, ids, back) {
  if (!ids.length) return h('div.tt-thumbs', h('span.faint', '비어 있음'));
  return h('div.tt-thumbs', ids.map((id) => {
    const c = charOf(id);
    const look = p.looks?.[id] && store.skinById(p.looks[id]);
    return h('figure', h('img', { src: charSrc(id, p) || '', alt: '' }), h('figcaption', cName(id), look ? h('small.tt-look', look.name) : null),
      c && !c.npc && c.skins?.length > 1 ? h('button.btn.small.ghost.tt-lookbtn', { type: 'button', onclick: () => pickSkin({
        char: id, selected: p.looks?.[id] || c.insightSkin || c.defaultSkin, onClose: back,
        onDone: (sid) => edit(p.id, (x) => { x.looks ||= {}; if (!sid || sid === (c.insightSkin || c.defaultSkin)) delete x.looks[id]; else x.looks[id] = sid; }),
      }) }, '의상') : null);
  }));
}
function personEditor(pid, focus) {
  const p = person(pid);
  if (!p) return;
  const back = () => setTimeout(() => { if (alive()) personEditor(pid); }, 0);
  const go = (kind) => openSlot(pid, kind, back);
  const row = (label, content, actions) => h('div.tt-row', h('div.tt-row-head', h('b', label), h('div.tt-row-act', actions)), content);
  const name = h('input', { type: 'text', value: p.name, placeholder: '트위터 닉네임', 'aria-label': '닉네임' });
  name.addEventListener('change', () => edit(pid, (x) => { x.name = name.value.trim(); }));
  const av = avatarSrc(p);
  const body = [
    h('div.tt-person-top',
      h('button.tt-av', { type: 'button', title: '위치 맞추기', onclick: () => av && cropEditor(pid, back) }, avatarThumb(p, 42)),
      h('div.grow',
        h('label.field', h('span', '닉네임'), name),
        h('div.chips', { style: { marginTop: '8px' } },
          h('button.btn.small', { type: 'button', onclick: async () => {
            const f = await pickFile('image/*'); if (!f) return;
            const url = await shrinkImage(f, 640, 0.88);
            edit(pid, (x) => { x.avatar = url; x.avatarChar = null; x.avatarCrop = null; });
            cropEditor(pid, back);
          } }, '원하는 이미지 올리기'),
          h('button.btn.small', { type: 'button', onclick: () => pickChars({ title: '프로필로 쓸 출품작', max: 1, selected: [p.avatarChar], npc: true, onClose: back,
            onDone: (ids) => edit(pid, (x) => { x.avatarChar = ids[0] || null; x.avatarCrop = null; if (ids[0]) x.avatar = null; }) }) }, '출품작으로'),
          av ? h('button.btn.small', { type: 'button', onclick: () => cropEditor(pid, back) }, '위치·크기 맞추기') : null,
          av ? h('button.btn.small.ghost', { type: 'button', onclick: () => { edit(pid, (x) => { x.avatar = null; x.avatarChar = null; x.avatarCrop = null; }); back(); } }, '지우기') : null,
        ),
      ),
    ),
    h('h3.tt-sec', '속성별 최애', h('small', ` 속성마다 1~${AF_MAX}명`)),
    ...AF.map((k) => row(h('span.tt-afpill', { style: { background: AF_COLOR[k], color: onColor(AF_COLOR[k]) } }, store.AFFLATUS[k]),
      lookThumbs(p, afList(p, k), back),
      h('button.btn.small', { type: 'button', onclick: () => go('af:' + k) }, '고르기'))),
    h('h3.tt-sec', '최애 스토리'),
    row('메인스', p.main ? thumbs([[storySrc(p.main), storyName(p.main)]], '.banner') : thumbs([]), h('button.btn.small', { type: 'button', onclick: () => go('main') }, '고르기')),
    row('이벤스', p.event ? thumbs([[storySrc(p.event), storyName(p.event)]], '.banner') : thumbs([]), h('button.btn.small', { type: 'button', onclick: () => go('event') }, '고르기')),
    h('h3.tt-sec', '스킨 · 씨피'),
    row('스킨', p.skin ? thumbs([[skinSrc(p.skin), `${cName(store.skinById(p.skin)?.char)} · ${skinName(p.skin)}`]]) : thumbs([]), [
      p.skin ? h('button.btn.small.ghost', { type: 'button', title: '표에 들어가는 부분을 위로', onclick: () => { edit(pid, (x) => { x.skinFocus = Math.max(0, +((x.skinFocus ?? SKIN_FOCUS) - 0.08).toFixed(2)); }); } }, '▲ 위쪽') : null,
      p.skin ? h('button.btn.small.ghost', { type: 'button', title: '표에 들어가는 부분을 아래로', onclick: () => { edit(pid, (x) => { x.skinFocus = Math.min(1, +((x.skinFocus ?? SKIN_FOCUS) + 0.08).toFixed(2)); }); } }, '▼ 아래쪽') : null,
      h('button.btn.small', { type: 'button', onclick: () => go('skin') }, '고르기'),
    ]),
    ...p.cps.filter(cpFilled).map((cp, i) => row(`씨피 ${i + 1}`, lookThumbs(p, [cp.a, cp.b].filter(Boolean), back), [
      h('button.btn.small', { type: 'button', onclick: () => pickCp(pid, i, back) }, '바꾸기'),
      h('button.btn.small.ghost', { type: 'button', onclick: () => { edit(pid, (x) => { x.cps = x.cps.filter(cpFilled); x.cps.splice(i, 1); }); back(); } }, '지우기'),
    ])),
    p.cps.filter(cpFilled).length < CP_MAX ? h('button.btn', { type: 'button', style: { marginTop: '6px' }, onclick: () => pickCp(pid, p.cps.filter(cpFilled).length, back) }, `+ 씨피 추가 (최대 ${CP_MAX}개)`) : null,
  ];
  const d = drawer({ title: p.name ? `${p.name}의 취향` : '취향 채우기', body, wide: true, foot: [h('button.btn.primary', { type: 'button', onclick: () => d.close() }, '완료')] });
  if (focus === 'cp') d.panel.querySelector('.drawer-body').scrollTop = 1e5;
}

/** 프로필 위치·크기 맞추기: 끌어서 옮기고, 막대로 확대 */
function cropEditor(pid, back) {
  const p = person(pid);
  if (!p || !avatarSrc(p)) return;
  const crop = avatarCrop(p);
  const N = 480;
  const cv = h('canvas.tt-crop', { width: N, height: N, 'aria-label': '프로필 미리보기 (끌어서 옮기기)' });
  let im = null;
  const draw = () => {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, N, N);
    if (!im) return;
    ctx.drawImage(im, ...cropSquare(im, crop), 0, 0, N, N);
    ctx.fillStyle = 'rgba(5,4,3,.62)';
    ctx.beginPath(); ctx.rect(0, 0, N, N); ctx.arc(N / 2, N / 2, N / 2 - 4, 0, Math.PI * 2, true); ctx.fill();
    ctx.strokeStyle = C.brass; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(N / 2, N / 2, N / 2 - 4, 0, Math.PI * 2); ctx.stroke();
  };
  loadImg(avatarSrc(p)).then((x) => { im = x; draw(); });
  const range = (label, key, min, max) => {
    const inp = h('input', { type: 'range', min, max, step: 0.005, value: crop[key], oninput: (e) => { crop[key] = +e.target.value; draw(); } });
    inp.dataset.key = key;
    return h('label.field', h('span', label), inp);
  };
  const ranges = [range('확대', 'z', 1, 4), range('좌우', 'x', 0, 1), range('위아래', 'y', 0, 1)];
  const syncRanges = () => ranges.forEach((r) => { const i = r.querySelector('input'); i.value = crop[i.dataset.key]; });
  // 끌어서 옮기기
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { if (!im) return; drag = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = cv.getBoundingClientRect();
    const side = Math.min(im.width, im.height) / crop.z;
    const scale = side / r.width; // 화면 1px = 원본 몇 px
    const fx = im.width - side; const fy = im.height - side;
    if (fx > 0) crop.x = Math.min(1, Math.max(0, drag.cx - ((e.clientX - drag.x) * scale) / fx));
    if (fy > 0) crop.y = Math.min(1, Math.max(0, drag.cy - ((e.clientY - drag.y) * scale) / fy));
    draw(); syncRanges();
  });
  const end = () => { drag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  const d = drawer({
    title: '프로필 위치·크기 맞추기', onClose: back,
    body: [h('div.tt-crop-wrap', cv), h('p.faint', { style: { fontSize: '13px' } }, '그림을 끌어서 옮기고, 확대 막대로 크기를 맞춰요. 동그라미 안이 표에 들어가요.'), h('div.fields', ranges)],
    foot: [
      h('button.btn.ghost', { type: 'button', onclick: () => { Object.assign(crop, { z: 1, x: 0.5, y: p.avatar ? 0.5 : 0 }); draw(); syncRanges(); } }, '처음대로'),
      h('button.btn.primary', { type: 'button', onclick: () => { edit(pid, (x) => { x.avatarCrop = { ...crop }; }); d.close(); } }, '완료'),
    ],
  });
}

// ── 화면 ──────────────────────────────────────────────────
function refresh() { page && page(); }
/** 아직 취향표 화면에 있는지 (다른 메뉴로 옮긴 뒤 편집 창이 다시 뜨지 않게) */
const alive = () => !!page && location.hash.startsWith('#/tastes');

export function cleanup() { page = null; }

/** 빈칸·로고 꾸미기 */
function stylePanel() {
  const o = db.opts;
  const setOpt = (patch) => { Object.assign(db.opts, patch); save(); refresh(); };
  const upload = async (key, maxW) => {
    const f = await pickFile('image/*'); if (!f) return;
    const url = await shrinkImage(f, maxW, 0.9);
    setOpt(key === 'blankImg' ? { blankImg: url, blankMode: 'custom' } : { [key]: url });
  };
  const thumb = (src) => h('span.tt-mini', src ? h('img', { src, alt: '' }) : h('span.faint', '없음'));
  const mode = (val, label) => h('button', { type: 'button', 'aria-pressed': String(o.blankMode === val), onclick: () => setOpt({ blankMode: val }) }, label);
  const text = h('input', { type: 'text', value: o.blankText || '', placeholder: '예: 꽝 (비우면 그림만)', 'aria-label': '빈칸 글자', style: { maxWidth: '180px' } });
  text.addEventListener('change', () => setOpt({ blankText: text.value.trim() }));
  return h('details.panel.tt-share',
    h('summary', h('b', '꾸미기'), h('span.faint', ' · 빈칸 그림, 로고')),
    h('div.tt-style-row',
      h('b', '빈칸'),
      h('div.stepper', mode('monolog', '모노로그'), mode('custom', '직접 올린 그림'), mode('none', '그림 없음')),
      thumb(blankSrc()),
      h('button.btn.small', { type: 'button', onclick: () => upload('blankImg', 512) }, '그림 올리기'),
      text),
    h('div.tt-style-row',
      h('b', '로고'),
      thumb(o.logoImg || LOGO),
      h('button.btn.small', { type: 'button', onclick: () => upload('logoImg', 1200) }, '로고 그림 올리기'),
      o.logoImg ? h('button.btn.small.ghost', { type: 'button', onclick: () => setOpt({ logoImg: null }) }, '기본 로고로') : null,
      h('span.faint', { style: { fontSize: '12.5px' } }, '기본은 한국판 로고예요. 바꾸려면 배경이 투명한 PNG를 올려 주세요.')),
  );
}

export function render(root) {
  root.append(h('div.page-head', h('div', h('h1', h('span.en', 'Taste Chart'), '취향표'),
    h('p', '트친들 취향을 모아 여럿을 한 장에 모은 가로표와 한 사람씩 보는 세로 카드로 만들어요. 그림 칸을 누르면 바로 고를 수 있어요. 기록은 이 브라우저에만 남아요.'))));
  const box = h('div');
  root.append(box);
  if (!gh.hasToken()) {
    box.append(h('div.empty', h('p', '취향표는 GitHub 토큰을 연결한 기기에서만 쓸 수 있어요.'), h('a.btn', { href: '#/settings' }, '설정에서 연결하기')));
    return;
  }
  db ||= loadLocal() || fresh();
  const ro = false;

  let token = 0;
  page = () => {
    const sh = sheet();
    if (!view.person || !person(view.person)) view.person = sh.people[0]?.id || null;
    const canvas = h('canvas.tt-canvas', { role: 'img', 'aria-label': '취향표 미리보기' });
    const wrap = h('div.tt-preview' + (view.fit ? '.fit' : ''), canvas);
    let hits = [];
    let natW = 1;
    const previewScale = Math.min(2, window.devicePixelRatio || 1);
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      const k = natW / r.width;
      const x = (e.clientX - r.left) * k; const y = (e.clientY - r.top) * k;
      return hits.find((t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
    };
    if (!ro) {
      canvas.addEventListener('click', (e) => { const hit = at(e); if (hit) openSlot(hit.pid, hit.kind, null); });
      canvas.addEventListener('mousemove', (e) => { canvas.style.cursor = at(e) ? 'pointer' : 'default'; });
    }
    const my = ++token;
    const status = h('p.faint.tt-status', '그리는 중…');
    renderTo(canvas, { mode: view.mode, pid: view.person, scale: previewScale, preview: !ro, maxPx: 6e6 }).then((out) => {
      if (my !== token) return;
      hits = out.hits; natW = out.W; status.textContent = '';
      canvas.style.setProperty('--natural', out.W + 'px');
    });

    const sheetSel = h('select', { 'aria-label': '취향표 고르기', onchange: (e) => { db.cur = e.target.value; save(); refresh(); } },
      db.sheets.map((s) => h('option', { value: s.id, selected: s.id === sh.id }, s.title || '제목 없음')));
    const titleIn = h('input', { type: 'text', value: sh.title, 'aria-label': '표 이름 (파일 이름에 쓰여요)', placeholder: '표 이름' });
    titleIn.addEventListener('change', () => { sh.title = titleIn.value.trim(); save(); refresh(); });

    const seg = (val, label) => h('button', { type: 'button', 'aria-pressed': String(view.mode === val), onclick: () => { view.mode = val; refresh(); } }, label);
    const personSel = view.mode === 'card' ? h('select', { 'aria-label': '카드로 볼 사람', onchange: (e) => { view.person = e.target.value; refresh(); } },
      sh.people.map((p, i) => h('option', { value: p.id, selected: p.id === view.person }, p.name || `이름 없음 ${i + 1}`))) : null;
    const opt = (key, label) => h('label.check', { style: { fontSize: '13.5px' } },
      h('input', { type: 'checkbox', checked: !!db.opts[key], onchange: (e) => { db.opts[key] = e.target.checked; save(); refresh(); } }), label);

    const people = ro ? null : h('div.tt-people', sh.people.map((p, i) => {
      const n = AF.reduce((a, k) => a + afList(p, k).length, 0);
      const bits = [`최애 ${n}명`, p.main ? '메인스' : null, p.event ? '이벤스' : null, p.skin ? '스킨' : null, p.cps.filter(cpFilled).length ? `씨피 ${p.cps.filter(cpFilled).length}` : null].filter(Boolean);
      const move = (dlt) => { const a = sh.people; const j = i + dlt; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; save(); refresh(); };
      return h('div.tt-person',
        h('button.tt-av.small', { type: 'button', 'aria-label': '편집', onclick: () => personEditor(p.id) }, avatarThumb(p, 20)),
        h('button.tt-pname', { type: 'button', onclick: () => personEditor(p.id) }, h('b', p.name || `이름 없음 ${i + 1}`), h('small', bits.join(' · '))),
        h('div.tt-pact',
          view.mode === 'card' ? null : h('button.btn.small.ghost', { type: 'button', title: '세로 카드로 보기', onclick: () => { view.mode = 'card'; view.person = p.id; refresh(); } }, '카드'),
          h('button.btn.small.ghost', { type: 'button', 'aria-label': '위로', disabled: i === 0, onclick: () => move(-1) }, '↑'),
          h('button.btn.small.ghost', { type: 'button', 'aria-label': '아래로', disabled: i === sh.people.length - 1, onclick: () => move(1) }, '↓'),
          h('button.btn.small.danger', { type: 'button', 'aria-label': '빼기', onclick: () => {
            if (!confirmAsk(`${p.name || '이 사람'}을(를) 표에서 뺄까요?`)) return;
            sh.people.splice(i, 1); save(); refresh();
          } }, '×'),
        ));
    }));

    const saveBtn = h('button.btn.primary', { type: 'button', onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true; const t = b.textContent; b.textContent = '만드는 중…';
      try { await exportPNG(view.mode, view.person); } finally { b.disabled = false; b.textContent = t; }
    } }, view.mode === 'card' ? '이 카드 PNG 저장' : '가로표 PNG 저장');

    fill(box,
      ro ? (db.sheets.length > 1 ? h('div.toolbar', h('label.field', h('span', '표'), sheetSel)) : null) : h('section.panel.tt-controls',
        h('div.toolbar',
          h('label.field.tt-grow', h('span', '표'), sheetSel),
          h('label.field.tt-grow2', h('span', '표 이름 (파일 이름에 쓰여요)'), titleIn),
          h('div.tt-btns',
            h('button.btn.small', { type: 'button', onclick: () => { const s = blankSheet(); db.sheets.push(s); db.cur = s.id; save(); refresh(); } }, '새 표'),
            h('button.btn.small', { type: 'button', onclick: () => {
              const c = JSON.parse(JSON.stringify(sh)); c.id = uid(); c.title = `${sh.title} (사본)`; db.sheets.push(c); db.cur = c.id; save(); refresh();
            } }, '복제'),
            db.sheets.length > 1 ? h('button.btn.small.danger', { type: 'button', onclick: () => {
              if (!confirmAsk(`'${sh.title}' 표를 지울까요? 되돌릴 수 없어요.`)) return;
              db.sheets = db.sheets.filter((s) => s.id !== sh.id); db.cur = db.sheets[0].id; save(); refresh();
            } }, '표 지우기') : null,
          ),
        ),
        h('div.tt-head', h('h3', `참여한 사람 ${sh.people.length}명`),
          h('button.btn.small.primary', { type: 'button', onclick: () => { const p = blankPerson(); sh.people.push(p); save(); refresh(); personEditor(p.id); } }, '+ 사람 추가')),
        people,
      ),
      ro ? null : stylePanel(),
      h('div.toolbar.tt-viewbar',
        h('div.stepper', { role: 'group', 'aria-label': '보기' }, seg('table', '가로표 (여럿)'), seg('card', '세로 카드 (한 명)')),
        personSel,
        ro ? null : opt('charNames', '출품작·스킨 이름 넣기'),
        ro ? null : opt('storyNames', '스토리 이름 넣기'),
        h('label.check', { style: { fontSize: '13.5px' } }, h('input', { type: 'checkbox', checked: view.fit, onchange: (e) => { view.fit = e.target.checked; wrap.classList.toggle('fit', view.fit); } }), '화면에 맞추기'),
        h('div.grow'),
        saveBtn,
        view.mode === 'card' && sh.people.length > 1 ? h('button.btn', { type: 'button', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { for (const p of sh.people) { await exportPNG('card', p.id); await new Promise((r) => setTimeout(r, 400)); } } finally { b.disabled = false; }
        } }, `카드 ${sh.people.length}장 모두 저장`) : null,
      ),
      status,
      wrap,
      ro ? null : h('div.toolbar.tt-backup',
        h('span.faint', { style: { fontSize: '13px' } }, '다른 기기로 옮기거나 혹시 몰라 남겨 두려면:'),
        h('button.btn.small', { type: 'button', onclick: () => downloadJSON(`취향표 백업 ${new Date().toISOString().slice(0, 10)}.json`, db) }, '백업 내보내기'),
        h('button.btn.small', { type: 'button', onclick: async () => {
          const f = await pickFile('application/json,.json'); if (!f) return;
          try {
            const d = normalize(JSON.parse(await readFileText(f)));
            if (!d) throw new Error('취향표 백업 파일이 아니에요.');
            const ids = new Set(db.sheets.map((s) => s.id));
            const add = d.sheets.filter((s) => !ids.has(s.id));
            const replace = d.sheets.filter((s) => ids.has(s.id));
            if (replace.length && !confirmAsk(`같은 표 ${replace.length}개를 백업 내용으로 덮어쓸까요?`)) return;
            db.sheets = db.sheets.map((s) => replace.find((r) => r.id === s.id) || s).concat(add);
            save(); refresh(); toast(`표 ${d.sheets.length}개를 가져왔어요.`);
          } catch (err) { toast(err.message, 'err'); }
        } }, '백업 가져오기'),
      ),
    );
  };
  page();
}
