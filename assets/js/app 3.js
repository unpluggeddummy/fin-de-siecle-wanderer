import * as store from './store.js';
import * as gh from './github.js';
import { h, toast, append } from './ui.js';

const pages = {
  home: () => import('./pages/home.js'),
  roster: () => import('./pages/roster.js'),
  bulletin: () => import('./pages/bulletin.js'),
  skins: () => import('./pages/skins.js'),
  psychubes: () => import('./pages/psychubes.js'),
  decks: () => import('./pages/decks.js'),
  plans: () => import('./pages/plans.js'),
  gacha: () => import('./pages/gacha.js'),
  names: () => import('./pages/names.js'),
  settings: () => import('./pages/settings.js'),
};

const main = document.getElementById('main');
let current = { name: null, mod: null, arg: null };

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  return { name: pages[name] ? name : 'home', arg: rest.join('/') || null };
}

async function render(scrollTop = true) {
  const { name, arg } = parseRoute();
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const tab = document.querySelector(`.tabs a[data-route="${name}"]`);
  tab && tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const mod = await pages[name]();
  current = { name, mod, arg };
  const root = h('div');
  root.append = (...kids) => append(root, kids); // null·배열도 안전하게
  try {
    mod.render(root, { arg });
  } catch (e) {
    console.error(e);
    root.replaceChildren(h('div.empty', h('p', `화면을 그리는 중 오류가 났습니다: ${e.message}`)));
  }
  main.replaceChildren(root);
  const t = document.querySelector(`.tabs a[data-route="${name}"]`)?.firstChild?.textContent;
  document.title = `${t && name !== 'home' ? t + ' — ' : ''}${store.state.user.settings?.title || '세기말의 방랑자'}`;
  if (scrollTop) window.scrollTo(0, 0);
}

export function rerender() { render(false); }

// ── 헤더: 편집 모드, 저장 버튼 ─────────────────────────────
const editBtn = document.querySelector('[data-edit-toggle]');
const saveBtn = document.querySelector('[data-save]');
const saveLabel = document.querySelector('[data-save-label]');

editBtn.addEventListener('click', () => {
  if (!store.state.editing && !gh.hasToken()) {
    toast('편집하려면 먼저 설정에서 GitHub 연결을 해 주세요.');
    location.hash = '#/settings';
    return;
  }
  store.setEditing(!store.state.editing);
});

saveBtn.addEventListener('click', doSave);
async function doSave() {
  if (saveBtn.dataset.state === 'saving') return;
  saveBtn.dataset.state = 'saving';
  saveLabel.textContent = '저장 중…';
  try {
    await store.save();
    saveBtn.dataset.state = 'saved';
    saveLabel.textContent = '저장됨';
    toast('저장했습니다. 사이트에 반영되기까지 1~2분 걸릴 수 있어요.');
    setTimeout(updateHeader, 2500);
  } catch (e) {
    saveBtn.dataset.state = '';
    toast(e.message, 'err');
    updateHeader();
  }
}

function updateHeader() {
  const s = store.state;
  editBtn.setAttribute('aria-pressed', String(s.editing));
  editBtn.textContent = s.editing ? '편집 중' : '편집';
  const n = s.dirty.size + (s.pendingFiles.length ? 1 : 0);
  if (store.hasChanges()) {
    saveBtn.hidden = false;
    saveBtn.dataset.state = '';
    saveLabel.textContent = `저장 (${n})`;
  } else if (saveBtn.dataset.state !== 'saved') {
    saveBtn.hidden = true;
  }
  const set = s.user.settings || {};
  document.querySelector('[data-site-title]').textContent = set.title || '세기말의 방랑자';
  document.querySelector('[data-site-sub]').textContent = set.subtitle || '';
  // 영문 제호: de·of·the 같은 작은 낱말은 기울인 붉은 글씨로
  const en = set.titleEn || 'Fin de Siècle Wanderer';
  const enEl = document.querySelector('[data-site-title-en]');
  enEl.replaceChildren(...en.split(/(\s+)/).map((w) => (/^(de|du|of|the|la|le|des|and|&)$/i.test(w) ? h('em', w) : document.createTextNode(w))));
  document.querySelector('.site-foot .foot-mark').textContent = en;
  document.querySelector('[data-names-tab]').hidden = !set.showNames;
}

window.addEventListener('beforeunload', (e) => {
  if (store.hasChanges()) { e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && store.state.editing) { e.preventDefault(); doSave(); }
});

store.on((kind) => {
  updateHeader();
  if (kind === 'change' || kind === 'mode' || kind === 'load') rerender();
});

// ── 위로 내리는 비 (게임 속 '폭풍'의 비) ─────────────────────
function rain() {
  const cv = document.querySelector('.rain');
  const ctx = cv.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let drops = [];
  let w = 0; let hgt = 0; let raf = 0;
  const resize = () => {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; hgt = r.height;
    cv.width = w * dpr; cv.height = hgt * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(w / 9);
    drops = Array.from({ length: n }, () => spawn(true));
    draw();
  };
  const spawn = (anywhere) => ({
    x: Math.random() * w,
    y: anywhere ? Math.random() * hgt : hgt + Math.random() * 40,
    len: 6 + Math.random() * 16,
    v: 0.6 + Math.random() * 1.8,
    a: 0.15 + Math.random() * 0.45,
  });
  const draw = () => {
    ctx.clearRect(0, 0, w, hgt);
    for (const d of drops) {
      const g = ctx.createLinearGradient(d.x, d.y, d.x, d.y + d.len);
      g.addColorStop(0, `rgba(170,228,242,${d.a})`);
      g.addColorStop(1, 'rgba(170,228,242,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x, d.y + d.len); ctx.stroke();
    }
  };
  const tick = () => {
    for (const d of drops) {
      d.y -= d.v;
      if (d.y + d.len < 0) Object.assign(d, spawn(false));
    }
    draw();
    raf = requestAnimationFrame(tick);
  };
  const start = () => { cancelAnimationFrame(raf); if (!reduce.matches && !document.hidden) raf = requestAnimationFrame(tick); else draw(); };
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', start);
  reduce.addEventListener?.('change', start);
  resize();
  start();
}

// ── 시작 ──────────────────────────────────────────────────
async function boot() {
  rain();
  try {
    const restored = await store.loadAll();
    const meta = store.state.game.meta;
    document.querySelector('[data-game-updated]').textContent =
      `게임 데이터 갱신: ${new Date(meta.updatedAt).toLocaleString('ko-KR')} · 출품작 ${meta.counts.characters} · 스킨 ${meta.counts.skins} · 의지 ${meta.counts.psychubes}`;
    if (gh.hasToken()) store.setEditing(true);
    updateHeader();
    if (restored) toast(`저장하지 않은 변경 사항 ${restored}건을 복구했어요. 오른쪽 위 저장 버튼으로 저장할 수 있어요.`);
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('div.empty', h('p', `데이터를 불러오지 못했습니다: ${e.message}`)));
    return;
  }
  window.addEventListener('hashchange', () => render(true));
  render(true);
}
boot();
