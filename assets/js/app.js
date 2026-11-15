import * as store from './store.js';
import * as gh from './github.js';
import * as owner from './owner.js';
import { h, toast, append, closeDrawer } from './ui.js';

const pages = {
  home: () => import('./pages/home.js'),
  timekeeper: () => import('./pages/timekeeper.js'),
  roster: () => import('./pages/roster.js'),
  bulletin: () => import('./pages/bulletin.js'),
  skins: () => import('./pages/skins.js'),
  psychubes: () => import('./pages/psychubes.js'),
  decks: () => import('./pages/decks.js'),
  plans: () => import('./pages/plans.js'),
  gacha: () => import('./pages/gacha.js'),
  names: () => import('./pages/names.js'),
  stories: () => import('./pages/stories.js'),
  timeline: () => import('./pages/timeline.js'),
  storms: () => import('./pages/storms.js'),
  codex: () => import('./pages/codex.js'),
  tastes: () => import('./pages/tastes.js'),
  transcripts: () => import('./pages/transcripts.js'),
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
  try { current.mod?.cleanup?.(); } catch { /* 무시 */ }
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
  current.root = root;
  pageHead(root, name);
  const t = document.querySelector(`.tabs a[data-route="${name}"] .ft-ko`)?.textContent;
  document.body.dataset.route = name;
  document.title = `${t && name !== 'home' ? t + ' — ' : ''}${store.state.user.settings?.title || '세기말의 방랑자'}`;
  if (scrollTop) window.scrollTo(0, 0);
}

export function rerender() { render(false); }

/**
 * 각 화면 머리말(// 영문 라벨 · 한국어 제목 · 밑 문구)을 설정에 저장한 글로 바꾸고,
 * 편집 모드에서는 그 자리에서 고친다. 비우면 기본 글로 돌아간다.
 * 대사집처럼 머리말을 나중에(불러온 뒤) 그리는 화면도 있어서, 머리말이 생길 때마다 적용한다.
 */
let headObserver = null;
function pageHead(root, name) {
  headObserver?.disconnect();
  const apply = () => root.querySelectorAll('.page-head:not([data-ph])').forEach((head) => decorateHead(head, name));
  apply();
  headObserver = new MutationObserver(() => { if (current.root !== root) { headObserver?.disconnect(); return; } apply(); });
  headObserver.observe(root, { childList: true, subtree: true });
}
function decorateHead(head, name) {
  head.dataset.ph = '1';
  const set = store.state.user.settings || {};
  const titles = set.pageTitles?.[name] || {};
  const notes = set.pageNotes || {};
  const h1 = head.querySelector('h1');
  const en = h1?.querySelector('.en');
  // 한국어 제목 글자(h1 안에서 .en 을 뺀 나머지 글자)를 span 으로 감싼다
  let ko = null;
  if (h1) {
    const txt = [...h1.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (txt.length) { ko = h('span.ph-ko', txt.map((n) => n.textContent).join('').trim()); txt.forEach((n, i) => (i ? n.remove() : n.replaceWith(ko))); }
  }
  const p = head.querySelector(':scope > div > p, :scope > p');
  const parts = [
    [en, titles.en, (v) => store.update('settings', (x) => { x.pageTitles ||= {}; x.pageTitles[name] ||= {}; if (v) x.pageTitles[name].en = v; else delete x.pageTitles[name].en; }, { silent: true })],
    [ko, titles.ko, (v) => store.update('settings', (x) => { x.pageTitles ||= {}; x.pageTitles[name] ||= {}; if (v) x.pageTitles[name].ko = v; else delete x.pageTitles[name].ko; }, { silent: true })],
    [p, notes[name], (v) => store.update('settings', (x) => { x.pageNotes ||= {}; if (v) x.pageNotes[name] = v; else delete x.pageNotes[name]; }, { silent: true })],
  ];
  for (const [el, saved, save] of parts) {
    if (!el) continue;
    const def = el.textContent;
    if (saved) el.textContent = saved;
    if (!store.state.editing) continue;
    let cur = saved || def;
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.classList.add('ed', 'page-note');
    el.title = '눌러서 고치기 (비우면 기본 글로 돌아가요)';
    el.addEventListener('click', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } if (e.key === 'Escape') { el.textContent = cur; el.blur(); } });
    el.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    el.addEventListener('blur', () => {
      const v = el.innerText.replace(/\u00a0/g, ' ').trim();
      if (v === cur) return;
      save(v && v !== def ? v : '');
      cur = v || def;
      if (!v) el.textContent = def;
    });
  }
}

// ── 메뉴: 순서와 이름 (설정의 menu 에 저장) ─────────────────
// menu = { order: ['home', 'roster', …], labels: { roster: { en: 'Exhibits', ext: '.page', ko: '출품작' } } }
const MENU_DEFAULT = [];
export function menuItems() {
  const nav = document.querySelector('.tabs');
  if (!MENU_DEFAULT.length) {
    nav.querySelectorAll('a[data-route]').forEach((a) => MENU_DEFAULT.push({
      route: a.dataset.route,
      en: a.querySelector('b')?.textContent || '', ext: a.querySelector('i')?.textContent || '', ko: a.querySelector('.ft-ko')?.textContent || '',
    }));
  }
  return MENU_DEFAULT;
}
function applyMenu() {
  const nav = document.querySelector('.tabs');
  const defs = menuItems();
  const menu = store.state.user.settings?.menu || {};
  const order = [...(menu.order || []).filter((r) => defs.some((d) => d.route === r)), ...defs.map((d) => d.route).filter((r) => !(menu.order || []).includes(r))];
  for (const r of order) {
    const a = nav.querySelector(`a[data-route="${r}"]`);
    if (!a) continue;
    const d = defs.find((x) => x.route === r);
    const l = menu.labels?.[r] || {};
    const b = a.querySelector('b'); const i = a.querySelector('i'); const k = a.querySelector('.ft-ko');
    if (b) b.textContent = l.en || d.en;
    if (i) i.textContent = l.ext ?? d.ext;
    if (k) k.textContent = l.ko || d.ko;
    nav.append(a);   // 순서대로 다시 붙인다 (맨 앞의 FDS 로고는 그대로)
  }
}

// ── 헤더: 편집 모드, 저장 버튼 ─────────────────────────────
const editBtn = document.querySelector('[data-edit-toggle]');
const saveBtn = document.querySelector('[data-save]');
const saveLabel = document.querySelector('[data-save-label]');

editBtn.addEventListener('click', () => {
  if (!owner.isOwner()) { location.hash = '#/settings'; return; }
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
  const tastesTab = document.querySelector('[data-tastes-tab]');
  if (tastesTab) tastesTab.hidden = !gh.hasToken(); // 취향표: 토큰을 연결한 기기에서만
  applyMenu();
  const stTab = document.querySelector('[data-storms-tab]');
  if (stTab) stTab.hidden = !gh.hasToken(); // 폭풍우 연표: 아직 정리 중이라 토큰을 연결한 기기에서만
  const txTab = document.querySelector('[data-tx-tab]');
  if (txTab) txTab.hidden = !gh.hasToken(); // 대사집: 토큰을 연결한 기기에서만
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
      g.addColorStop(0, `rgba(228,200,146,${d.a})`);
      g.addColorStop(1, 'rgba(228,200,146,0)');
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
  owner.apply();
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
  window.addEventListener('hashchange', () => { if (document.querySelector('.drawer')) closeDrawer(); render(true); });
  render(true);
}
boot();
