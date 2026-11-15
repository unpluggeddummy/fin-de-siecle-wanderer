// 대사집 — 좋아하는 스토리 대사를 영어·한국어로 옮겨 적어 두고 글로 읽는 곳.
// 토큰을 연결한 기기에서만 메뉴가 보이고, 열 수 있다 (취향표처럼).
// 저장: data/user/transcripts/<문서 id>.json (스토리 한 편 = 한 파일) + data/user/transcripts/index.json (목록)
//   ※ 저장소가 공개라서 파일 자체는 저장소에서 열 수 있다. 사이트 화면에서만 숨긴다.
// 주소: #/transcripts 목록 · #/transcripts/<문서 id>/<장 번호> 읽기 · #/transcripts/stars 별표 모아 보기 · #/transcripts/search 검색
import { h, fill, toast, drawer, debounce, uid, confirmAsk } from '../ui.js';
import * as store from '../store.js';
import * as gh from '../github.js';

const DIR = 'data/user/transcripts';
const PREF = 'r1999.tx.pref';
const DRAFT = 'r1999.tx.draft.';
const PLACE = 'r1999.tx.place.';
const CATS = [['main', '메인 스토리'], ['mainevent', '버전 이벤트'], ['char', '캐릭터 스토리'], ['anec', '일화'], ['custom', '직접 만든 대사집']];

const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 */ } },
};
const pref = { mode: 'side', size: 16, lh: 1.85, font: 'serif', ...(ls.get(PREF) || {}) };
const savePref = () => ls.set(PREF, pref);

// 불러온 문서와 목록 (페이지를 옮겨 다녀도 유지)
const S = { index: null, docs: {}, dirty: new Set(), editing: false, saving: false, loadErr: null };
let rootEl = null;

const stories = () => store.state.game.stories || [];
const storyOf = (id) => stories().find((s) => s.id === id);
const docPath = (id) => `${DIR}/${id}.json`;
const nowISO = () => new Date().toISOString();

function blankDoc(id) {
  const st = storyOf(id);
  return {
    id, story: st ? id : null,
    title: st ? (st.name.ko || st.name.en) : '새 대사집',
    titleEn: st ? (st.name.en || '') : '',
    version: st?.version || '',
    stages: {},          // { "<장 번호>": { title, lines: [...] } }
    order: st ? (st.stages || []).map((s) => String(s.n)) : ['1'],
    customStages: st ? {} : { 1: '1장' },
    updatedAt: null,
  };
}
// 줄: { id, kind: 'line' | 'scene' | 'note', sp, en, ko, star }
const blankLine = (kind = 'line') => ({ id: uid(), kind, sp: '', en: '', ko: '', star: false });

// ── 이름표: 말하는 사람 이름은 한국어로 통일 ─────────────
// 출품작 이름(게임 데이터) + 내가 정한 이름(index.json 의 names) 으로 영어 이름을 한국어로 바꾼다
const BASE_NAMES = { Vertin: '베르틴', Schneider: '슈나이더' };
function nameMap() {
  const m = { ...BASE_NAMES };
  for (const c of store.state.game.characters || []) if (c.name?.en && c.name?.ko) m[c.name.en] = c.name.ko;
  Object.assign(m, S.index?.names || {});
  return m;
}
const normName = (n) => String(n || '').trim();
function koName(en, map = nameMap()) {
  const n = normName(en);
  if (!n) return '';
  if (/[가-힣]/.test(n)) return n;
  return map[n] || map[Object.keys(map).find((k) => k.toLowerCase() === n.toLowerCase())] || n;
}
const isUnmapped = (n, map) => n && !/[가-힣]/.test(n) && koName(n, map) === n;
/** 아직 한국어 이름이 없는 영어 이름들을 한 번에 적는 칸 */
function namesForm(names, onDone, { title = '말하는 사람 이름 (한국어로 통일)', note } = {}) {
  const map = nameMap();
  const rows = names.map((en) => ({ en, input: h('input', { type: 'text', value: map[en] && map[en] !== en ? map[en] : '', placeholder: '한국어 이름' }) }));
  const dr = drawer({
    title,
    body: h('div.tx-names',
      h('p.muted', note || '영어로 된 이름에 한국어 이름을 적어 주세요. 한 번 적으면 모든 대사집에 똑같이 쓰여요. 비워 두면 영어 그대로 둬요.'),
      rows.length ? rows.map((r) => h('label.tx-name-row', h('span', r.en), r.input)) : h('p', '바꿀 영어 이름이 없어요.')),
    foot: h('button.btn', { type: 'button', onclick: () => {
      S.index.names ||= {};
      for (const r of rows) { const v = r.input.value.trim(); if (v) S.index.names[r.en] = v; else delete S.index.names[r.en]; }
      dr.close(); onDone();
    } }, '이름 정하기'),
  });
}
/** 모든 대사집의 말하는 사람을 이름표대로 한국어로 바꾼다 */
async function applyNamesEverywhere() {
  const docs = await loadAll();
  const map = nameMap();
  let n = 0;
  for (const d of docs) {
    if (d.deleted) continue;
    let changed = false;
    for (const st of Object.values(d.stages)) for (const l of st.lines || []) {
      const k = koName(l.sp, map);
      if (k !== (l.sp || '')) { l.sp = k; changed = true; n++; }
    }
    if (changed) touch(d);
  }
  S.dirty.add('__index');
  return n;
}
function namesDrawer() {
  loadAll().then((docs) => {
    const map = nameMap();
    const seen = new Set();
    docs.forEach((d) => Object.values(d.stages || {}).forEach((st) => (st.lines || []).forEach((l) => isUnmapped(normName(l.sp), map) && seen.add(normName(l.sp)))));
    const mine = Object.keys(S.index.names || {});
    namesForm([...new Set([...seen, ...mine])].sort(), async () => {
      const n = await applyNamesEverywhere();
      toast(n ? `이름 ${n}곳을 한국어로 바꿨어요.` : '이름표를 정했어요.');
      paintSave(); autoSave();
    }, { note: '대사집에 남아 있는 영어 이름과 내가 정한 이름이에요. 고치면 모든 대사집의 이름이 바뀌어요.' });
  });
}

// ── 불러오기·저장 ─────────────────────────────────────────
async function readJSON(path) {
  const f = await gh.readText(path);
  return f ? JSON.parse(f.text) : null;
}
async function loadIndex() {
  if (S.index) return S.index;
  try { S.index = (await readJSON(`${DIR}/index.json`)) || { items: {} }; S.loadErr = null; }
  catch (e) { S.loadErr = e.message; S.index = { items: {} }; }
  // 저장하지 않은 문서가 있으면 목록에도 보이게
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith(DRAFT)) continue;
    const d = ls.get(k);
    if (d?.id && !S.index.items[d.id]) S.index.items[d.id] = summary(d);
    if (d?.id) { S.docs[d.id] ||= d; S.dirty.add(d.id); }
  }
  return S.index;
}
async function loadDoc(id) {
  if (S.docs[id]) return S.docs[id];
  let d = null;
  try { d = await readJSON(docPath(id)); } catch (e) { toast(`불러오기 실패: ${e.message}`, 'err'); }
  const draft = ls.get(DRAFT + id);
  if (draft && (!d || String(draft.updatedAt || '') >= String(d.updatedAt || ''))) { d = draft; S.dirty.add(id); }
  d = d ? { ...blankDoc(id), ...d } : blankDoc(id);
  S.docs[id] = d;
  return d;
}
async function loadAll() {
  const idx = await loadIndex();
  await Promise.all(Object.keys(idx.items).map(loadDoc));
  return Object.values(S.docs);
}
function summary(d) {
  const all = Object.values(d.stages || {}).flatMap((s) => s.lines || []);
  return {
    title: d.title, titleEn: d.titleEn, version: d.version, story: d.story,
    lines: all.filter((l) => l.kind === 'line').length, stars: all.filter((l) => l.star).length, updatedAt: d.updatedAt,
  };
}
const draftSoon = debounce((id) => ls.set(DRAFT + id, S.docs[id]), 400);
function touch(d) {
  d.updatedAt = nowISO();
  S.dirty.add(d.id);
  S.index ||= { items: {} };
  S.index.items[d.id] = summary(d);
  draftSoon(d.id);
  paintSave();
}
async function saveAll() {
  if (!S.dirty.size || S.saving) return;
  S.saving = true; paintSave();
  try {
    const ids = [...S.dirty].filter((id) => id !== '__index' && S.docs[id]);
    const files = ids.map((id) => ({ path: docPath(id), text: JSON.stringify(S.docs[id], null, 1) + '\n' }));
    files.push({ path: `${DIR}/index.json`, text: JSON.stringify(S.index, null, 1) + '\n' });
    await gh.commitFiles(files, `대사집 저장: ${ids.map((id) => S.docs[id]?.title).join(', ')}`);
    ids.forEach((id) => { S.dirty.delete(id); ls.set(DRAFT + id, null); });
    S.dirty.delete('__index');
    toast('대사집을 저장했어요.');
  } catch (e) { toast(`저장 실패: ${e.message}`, 'err'); }
  S.saving = false; paintSave();
}
/** 가져오기·붙여넣기·고치기를 마치면 바로 저장소에 올린다 (별표는 잠깐 모았다가) */
const autoSave = () => { if (S.dirty.size) saveAll(); };
const autoSaveSoon = debounce(autoSave, 2500);
let saveBtnEl = null;
function paintSave() {
  if (!saveBtnEl) return;
  saveBtnEl.hidden = !S.dirty.size && !S.saving;
  saveBtnEl.disabled = S.saving;
  saveBtnEl.textContent = S.saving ? '저장 중…' : `● 대사집 저장 (${[...S.dirty].filter((x) => x !== '__index').length || 1})`;
}

// ── 화면 ─────────────────────────────────────────────────
function readingFonts() {
  if (document.querySelector('link[data-reading-fonts]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: 'assets/fonts/reading.css', 'data-reading-fonts': '' }));
}
export function render(root, { arg } = {}) {
  rootEl = root;
  readingFonts();
  if (!gh.hasToken()) {
    root.append(h('div.empty', h('p', '대사집은 GitHub 토큰을 연결한 기기에서만 볼 수 있어요.'), h('a.btn', { href: '#/settings' }, '설정에서 연결하기')));
    return;
  }
  const [a, b] = (arg || '').split('/');
  saveBtnEl = h('button.btn.tx-save', { type: 'button', onclick: saveAll, hidden: true });
  const box = h('div', h('p.muted', '불러오는 중…'));
  root.append(box);
  const go = a === 'stars' ? starsView : a === 'search' ? searchView : a ? () => docView(a, b) : listView;
  // 목록(index)을 먼저 읽어 둔다 — 그래야 저장할 때 다른 대사집 목록을 덮어쓰지 않는다
  loadIndex().then(go).then((el) => { fill(box, el); paintSave(); }).catch((e) => fill(box, h('div.empty', h('p', `열지 못했어요: ${e.message}`))));
}
export function cleanup() { saveBtnEl = null; }
const rerender = () => { if (rootEl?.isConnected) { const r = rootEl; r.replaceChildren(); render(r, { arg: location.hash.replace(/^#\/?transcripts\/?/, '') }); } };

function head(titleKo, titleEn, desc, ...right) {
  return h('div.page-head',
    h('div', h('h1', h('span.en', titleEn), titleKo), desc ? h('p', desc) : null),
    h('div.tx-head-btns', ...right, saveBtnEl));
}

// 목록
async function listView() {
  const idx = await loadIndex();
  const items = Object.entries(idx.items).map(([id, x]) => ({ id, ...x, st: x.story ? storyOf(x.story) : null }));
  const groups = CATS.map(([k, name]) => [name, items.filter((x) => (x.st ? x.st.cat : 'custom') === k)]).filter(([, l]) => l.length);
  items.filter((x) => x.st && !CATS.some(([k]) => k === x.st.cat)).forEach((x) => groups.push(['기타', [x]]));
  const total = items.reduce((n, x) => n + (x.lines || 0), 0);
  const stars = items.reduce((n, x) => n + (x.stars || 0), 0);
  return h('div.tx',
    head('대사집', 'Transcript', '좋아하는 스토리 대사를 영어·한국어로 옮겨 두고 글로 읽어요. 토큰을 연결한 기기에서만 보여요.',
      h('a.btn.small.ghost', { href: '#/transcripts/search' }, '⌕ 검색'),
      h('a.btn.small.ghost', { href: '#/transcripts/stars' }, `★ 별표 대사 ${stars}`),
      h('button.btn.small.ghost', { type: 'button', onclick: namesDrawer }, '이름표'),
      h('button.btn.small', { type: 'button', onclick: newDocDrawer }, '+ 새 대사집')),
    S.loadErr ? h('p.tx-warn', `목록을 불러오지 못했어요: ${S.loadErr}`) : null,
    h('p.tx-stat', `대사집 ${items.length}편 · 대사 ${total.toLocaleString('ko-KR')}줄`),
    items.length ? null : h('div.empty', h('p', '아직 옮겨 둔 대사가 없어요.'), h('button.btn', { type: 'button', onclick: newDocDrawer }, '첫 대사집 만들기')),
    groups.map(([name, list]) => h('section.tx-group', h('h2.section', name),
      h('div.tx-cards', list.sort((x, y) => String(x.version).localeCompare(String(y.version), undefined, { numeric: true })).map((x) =>
        h('a.tx-card', { href: `#/transcripts/${x.id}` },
          x.st?.banner ? h('img', { src: x.st.banner, alt: '', loading: 'lazy' }) : h('span.tx-card-noimg', 'TXT'),
          h('div',
            h('b', x.title || '제목 없음'),
            x.titleEn ? h('small', x.titleEn) : null,
            h('span.tx-card-meta', [x.version ? `${x.version}` : null, `${x.lines || 0}줄`, x.stars ? `★ ${x.stars}` : null, S.dirty.has(x.id) ? '저장 안 함' : null].filter(Boolean).join(' · ')))))))),
  );
}

function newDocDrawer() {
  const idx = S.index?.items || {};
  const q = h('input', { type: 'search', placeholder: '스토리 이름으로 찾기 (한국어·영어)' });
  const list = h('div.tx-pick');
  const paint = () => {
    const t = q.value.trim().toLowerCase();
    fill(list, CATS.filter(([k]) => k !== 'custom').map(([k, name]) => {
      const ss = stories().filter((s) => s.cat === k && (!t || `${s.name.ko} ${s.name.en}`.toLowerCase().includes(t)));
      return ss.length ? h('div', h('h3', name), ss.map((s) => h('button.tx-pick-row', { type: 'button', onclick: () => { d.close(); location.hash = `#/transcripts/${s.id}`; } },
        h('span', s.version || ''), h('b', s.name.ko || s.name.en), h('small', s.name.en || ''), idx[s.id] ? h('em', '있음') : null))) : null;
    }));
  };
  q.addEventListener('input', paint);
  paint();
  const d = drawer({
    title: '새 대사집', wide: true,
    body: h('div', h('p.muted', '스토리를 고르면 장 이름이 자동으로 들어가요. 목록에 없는 이야기는 직접 만들어요.'), q, list),
    foot: h('button.btn', { type: 'button', onclick: () => { d.close(); location.hash = `#/transcripts/x-${uid()}`; } }, '직접 만들기'),
  });
  setTimeout(() => q.focus(), 50);
}

// 한 편 읽기·편집
async function docView(id, stageArg) {
  const d = await loadDoc(id);
  const st = d.story ? storyOf(d.story) : null;
  const order = d.order?.length ? d.order : Object.keys(d.stages);
  const stageName = (n) => {
    const s = st?.stages?.find((x) => String(x.n) === String(n));
    return s ? `${s.n}. ${s.ko || s.en}` : (d.customStages?.[n] || `${n}장`);
  };
  const cur = stageArg && order.includes(stageArg) ? stageArg
    : order.find((n) => d.stages[n]?.lines?.length) || order[0];
  const stage = (d.stages[cur] ||= { lines: [] });
  const count = (n) => (d.stages[n]?.lines || []).filter((l) => l.kind === 'line').length;

  const body = h('div.tx-body');
  const paint = () => fill(body, S.editing ? editLines(d, stage, paint) : readLines(d, stage, cur));
  paint();

  // 보기 설정
  const modeBtn = (m, label) => h('button' + (pref.mode === m ? '.on' : ''), { type: 'button', onclick: () => { pref.mode = m; savePref(); rerender(); } }, label);
  const size = (dv) => { pref.size = Math.max(13, Math.min(24, pref.size + dv)); savePref(); applyType(); };
  const lh = (dv) => { pref.lh = Math.round(Math.max(1.4, Math.min(2.4, pref.lh + dv)) * 100) / 100; savePref(); applyType(); };
  const wrap = h('div.tx.tx-doc');
  wrap.dataset.font = pref.font;
  const applyType = () => { wrap.style.setProperty('--tx-size', `${pref.size}px`); wrap.style.setProperty('--tx-lh', pref.lh); };
  applyType();

  const ci = order.indexOf(cur);
  const nav = h('div.tx-stage-nav',
    ci > 0 ? h('a.btn.small.ghost', { href: `#/transcripts/${id}/${order[ci - 1]}` }, `‹ ${stageName(order[ci - 1])}`) : h('span'),
    ci < order.length - 1 ? h('a.btn.small.ghost', { href: `#/transcripts/${id}/${order[ci + 1]}` }, `${stageName(order[ci + 1])} ›`) : h('span'));

  wrap.append(
    h('div.tx-crumb', h('a', { href: '#/transcripts' }, '← 대사집 목록'), st ? h('a', { href: `#/stories/${st.id}` }, '스토리 후기 보기') : null),
    h('div.tx-doc-head',
      st?.banner ? h('img.tx-banner', { src: st.banner, alt: '' }) : null,
      h('div',
        h('p.tx-k', [d.version, st ? CATS.find(([k]) => k === st.cat)?.[1] : '직접 만든 대사집'].filter(Boolean).join(' · ')),
        S.editing && !st ? h('input.tx-title-in', { value: d.title, onchange: (e) => { d.title = e.target.value.trim() || '제목 없음'; touch(d); } }) : h('h1', d.title),
        S.editing && !st ? h('input.tx-sub-in', { value: d.titleEn || '', placeholder: '영어 제목', onchange: (e) => { d.titleEn = e.target.value.trim(); touch(d); } }) : (d.titleEn ? h('p.tx-en-title', d.titleEn) : null),
        S.editing && !st ? h('input.tx-sub-in', { value: d.version || '', placeholder: '버전 (예: 3.9)', onchange: (e) => { d.version = e.target.value.trim(); touch(d); } }) : null),
      h('div.tx-head-btns', saveBtnEl)),
    h('nav.tx-stages', order.map((n) => h('a' + (n === cur ? '.on' : ''), { href: `#/transcripts/${id}/${n}` }, stageName(n), count(n) ? h('em', count(n)) : null)),
      S.editing && !st ? h('button.tx-add-stage', { type: 'button', onclick: () => {
        const name = prompt('새 장 이름', `${order.length + 1}장`); if (!name) return;
        const n = String(Math.max(0, ...order.map(Number).filter((x) => !isNaN(x))) + 1);
        d.order = [...order, n]; d.customStages = { ...(d.customStages || {}), [n]: name }; d.stages[n] = { lines: [] }; touch(d);
        location.hash = `#/transcripts/${id}/${n}`;
      } }, '+ 장') : null),
    h('div.tx-tools',
      h('div.tx-seg', modeBtn('side', '나란히'), modeBtn('stack', '위아래'), modeBtn('en', 'EN'), modeBtn('ko', '한국어')),
      h('div.tx-seg', ['serif', 'sans'].map((f) => h('button' + (pref.font === f ? '.on' : ''), { type: 'button', title: f === 'serif' ? '대사를 명조(고운 바탕 · Source Serif)로' : '대사를 고딕(프리텐다드)으로',
        onclick: () => { pref.font = f; savePref(); wrap.dataset.font = f; wrap.querySelectorAll('[data-fbtn]').forEach((b) => b.classList.toggle('on', b.dataset.fbtn === f)); }, 'data-fbtn': f }, f === 'serif' ? '명조' : '고딕'))),
      h('div.tx-seg', h('button', { type: 'button', title: '글씨 작게', onclick: () => size(-1) }, 'A−'), h('button', { type: 'button', title: '글씨 크게', onclick: () => size(1) }, 'A+'),
        h('button', { type: 'button', title: '줄 간격 좁게', onclick: () => lh(-0.1) }, '≡−'), h('button', { type: 'button', title: '줄 간격 넓게', onclick: () => lh(0.1) }, '≡+')),
      h('span.tx-gap'),
      S.editing ? h('button.btn.small.ghost', { type: 'button', onclick: () => wikiDrawer(d, st, cur, stage, () => { touch(d); paint(); }) }, '위키에서 영어 가져오기') : null,
      S.editing ? h('button.btn.small.ghost', { type: 'button', onclick: () => pasteDrawer(d, stage, () => { touch(d); paint(); }) }, '붙여넣기로 넣기') : null,
      h('button.btn.small' + (S.editing ? '' : '.ghost'), { type: 'button', 'aria-pressed': String(S.editing), onclick: () => { const leaving = S.editing; S.editing = !S.editing; rerender(); if (leaving) autoSave(); } }, S.editing ? '읽고 저장하기' : '✎ 고치기'),
      !st && S.editing ? h('button.btn.small.danger', { type: 'button', onclick: async () => {
        if (!confirmAsk(`"${d.title}" 대사집을 지울까요? 저장을 눌러야 저장소에서도 지워져요.`)) return;
        await deleteDoc(d.id); location.hash = '#/transcripts';
      } }, '지우기') : null),
    body,
    nav,
  );
  // 읽던 자리 기억
  if (!S.editing) {
    const key = PLACE + id + '/' + cur;
    const at = ls.get(key);
    if (at) requestAnimationFrame(() => setTimeout(() => window.scrollTo(0, at), 60));
    const remember = debounce(() => { if (wrap.isConnected) ls.set(key, Math.round(window.scrollY)); }, 300);
    window.addEventListener('scroll', remember, { passive: true });
    const stop = new MutationObserver(() => { if (!wrap.isConnected) { window.removeEventListener('scroll', remember); stop.disconnect(); } });
    requestAnimationFrame(() => wrap.parentNode && stop.observe(wrap.parentNode, { childList: true }));
  }
  return wrap;
}

async function deleteDoc(id) {
  // 빈 파일 대신 목록에서 빼고, 파일은 비운 채 저장 (git API 로 지우기 대신 간단하게)
  delete S.index.items[id];
  S.docs[id] = { id, deleted: true, stages: {}, updatedAt: nowISO() };
  S.dirty.add(id);
  ls.set(DRAFT + id, null);
  await saveAll();
  delete S.docs[id];
}

// 읽기: 말하는 사람 · 영어 · 한국어
function readLines(d, stage, cur) {
  const lines = stage.lines || [];
  if (!lines.length) return h('div.empty', h('p', '아직 이 장에 옮긴 대사가 없어요.'), h('button.btn', { type: 'button', onclick: () => { S.editing = true; rerender(); } }, '✎ 대사 넣기'));
  const mode = pref.mode;
  return h('ol.tx-lines.mode-' + mode, lines.map((l) => {
    if (l.kind === 'scene') return h('li.tx-scene', h('span', l.ko || l.en || '· · ·'));
    if (l.kind === 'note') return h('li.tx-note', l.ko || l.en);
    const star = h('button.tx-star' + (l.star ? '.on' : ''), { type: 'button', title: '별표', 'aria-pressed': String(!!l.star), onclick: () => { l.star = !l.star; star.classList.toggle('on', l.star); star.setAttribute('aria-pressed', String(l.star)); touch(d); autoSaveSoon(); } }, '★');
    return h('li.tx-line' + (l.sp ? '' : '.narr'), { id: `l-${l.id}` },
      h('div.tx-sp', koName(l.sp)),
      mode !== 'ko' && l.en ? h('p.tx-en', { lang: 'en' }, l.en) : null,
      mode !== 'en' && l.ko ? h('p.tx-ko', l.ko) : null,
      star);
  }));
}

// 편집: 줄마다 말하는 사람 · 영어 · 한국어
function speakerList(d) {
  const set = new Set();
  Object.values(d.stages).forEach((s) => (s.lines || []).forEach((l) => l.sp && set.add(l.sp)));
  (store.state.game.characters || []).forEach((c) => c.name?.ko && set.add(c.name.ko));
  return h('datalist#tx-speakers', [...set].slice(0, 600).map((v) => h('option', { value: v })));
}
function autosize(t, value = '') { t.value = value; const f = () => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; }; t.addEventListener('input', f); requestAnimationFrame(() => requestAnimationFrame(f)); return t; }
function editLines(d, stage, repaint) {
  const lines = stage.lines;
  const mv = (i, j) => { if (j < 0 || j >= lines.length) return; [lines[i], lines[j]] = [lines[j], lines[i]]; touch(d); repaint(); };
  const ins = (i, kind) => { lines.splice(i + 1, 0, blankLine(kind)); touch(d); repaint(); requestAnimationFrame(() => rootEl.querySelectorAll('.tx-edit-row')[i + 1]?.querySelector('input,textarea')?.focus()); };
  const row = (l, i) => {
    const set = (k) => (e) => { l[k] = e.target.value; touch(d); };
    const tools = h('div.tx-row-tools',
      h('button', { type: 'button', title: '위로', onclick: () => mv(i, i - 1) }, '↑'),
      h('button', { type: 'button', title: '아래로', onclick: () => mv(i, i + 1) }, '↓'),
      h('button', { type: 'button', title: '아래에 대사 추가', onclick: () => ins(i, 'line') }, '+'),
      h('button', { type: 'button', title: '지우기', onclick: () => { lines.splice(i, 1); touch(d); repaint(); } }, '✕'));
    if (l.kind === 'scene' || l.kind === 'note') {
      return h('div.tx-edit-row.k-' + l.kind,
        h('span.tx-kind', l.kind === 'scene' ? '장면' : '메모'),
        autosize(h('textarea', { rows: 1, placeholder: l.kind === 'scene' ? '장면 이름 (비우면 · · ·)' : '메모', oninput: (e) => { l.ko = e.target.value; touch(d); } }), l.ko || l.en || ''),
        tools);
    }
    return h('div.tx-edit-row',
      h('input.tx-sp-in', { list: 'tx-speakers', placeholder: '말하는 사람', value: l.sp || '', oninput: set('sp') }),
      autosize(h('textarea', { rows: 1, lang: 'en', placeholder: 'English', oninput: set('en') }), l.en || ''),
      autosize(h('textarea', { rows: 1, placeholder: '한국어', oninput: set('ko') }), l.ko || ''),
      tools);
  };
  return h('div.tx-edit',
    speakerList(d),
    h('p.muted', '고친 내용은 이 브라우저에 바로 임시 저장되고, "읽고 저장하기"를 누르면 저장소에 올라가요. 말하는 사람은 앞에서 쓴 이름이 자동으로 추천돼요.'),
    lines.map(row),
    h('div.tx-edit-add',
      h('button.btn.small', { type: 'button', onclick: () => ins(lines.length - 1, 'line') }, '+ 대사'),
      h('button.btn.small.ghost', { type: 'button', onclick: () => ins(lines.length - 1, 'scene') }, '+ 장면 구분'),
      h('button.btn.small.ghost', { type: 'button', onclick: () => ins(lines.length - 1, 'note') }, '+ 메모')));
}

/** "이름: 대사" / "이름 : 대사" / "[이름] 대사" 를 나눈다 */
function splitSpeaker(s) {
  const m = s.match(/^\s*\[([^\]]{1,40})\]\s*(.+)$/) || s.match(/^\s*([^:：]{1,30}?)\s*[:：]\s*(.+)$/);
  return m ? [m[1].trim(), m[2].trim()] : ['', s.trim()];
}
function pasteDrawer(d, stage, done) {
  const en = h('textarea.tx-paste', { rows: 12, lang: 'en', placeholder: 'English — 한 줄에 대사 하나\nVertin: Where are we?\nSonetto: ...' });
  const ko = h('textarea.tx-paste', { rows: 12, placeholder: '한국어 — 영어와 같은 순서로 한 줄에 하나\n베르틴: 여긴 어디지?\n소네트: ...' });
  const sp = h('input', { type: 'checkbox', checked: true });
  const replace = h('input', { type: 'checkbox' });
  const info = h('p.tx-paste-info');
  const parse = () => {
    const a = en.value.split('\n').map((x) => x.trim()).filter(Boolean);
    const b = ko.value.split('\n').map((x) => x.trim()).filter(Boolean);
    const n = Math.max(a.length, b.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      let [s1, t1] = sp.checked && a[i] ? splitSpeaker(a[i]) : ['', a[i] || ''];
      let [s2, t2] = sp.checked && b[i] ? splitSpeaker(b[i]) : ['', b[i] || ''];
      if (/^(-{3,}|={3,}|#\s*.+)$/.test(a[i] || b[i] || '')) { out.push({ ...blankLine('scene'), ko: (b[i] || a[i]).replace(/^#\s*|^[-=]+$/g, '') }); continue; }
      out.push({ ...blankLine(), sp: koName(s2 || s1), en: t1, ko: t2 });
    }
    fill(info, `영어 ${a.length}줄 · 한국어 ${b.length}줄 → 대사 ${out.length}줄`,
      a.length && b.length && a.length !== b.length ? h('b', ' · 줄 수가 달라요. 남는 줄은 한쪽만 들어가요.') : null);
    return out;
  };
  [en, ko, sp].forEach((x) => x.addEventListener('input', parse));
  sp.addEventListener('change', parse);
  parse();
  const dr = drawer({
    title: '붙여넣기로 넣기', wide: true,
    body: h('div.tx-paste-wrap',
      h('p.muted', '영어와 한국어를 같은 순서로 한 줄에 하나씩 붙여 넣으면 줄끼리 짝을 지어요. 한쪽만 넣어도 돼요. "---" 나 "# 장면 이름" 줄은 장면 구분이 돼요.'),
      h('div.tx-paste-cols', h('label', 'English', en), h('label', '한국어', ko)),
      h('label.tx-check', sp, ' "이름: 대사" 형식이면 말하는 사람을 따로 나누기'),
      h('label.tx-check', replace, ' 이 장의 대사를 모두 바꾸기 (끄면 끝에 이어 붙임)'),
      info),
    foot: h('button.btn', { type: 'button', onclick: () => {
      const out = parse();
      if (!out.length) { toast('붙여 넣은 대사가 없어요.'); return; }
      if (replace.checked) { if (stage.lines.length && !confirmAsk(`이 장의 대사 ${stage.lines.length}줄을 바꿀까요?`)) return; stage.lines = out; }
      else stage.lines.push(...out);
      dr.close(); done(); toast(`대사 ${out.length}줄을 넣었어요. 저장소에 올리는 중…`); autoSave();
    } }, '넣기'),
  });
}

// 별표 모아 보기
async function starsView() {
  const docs = (await loadAll()).filter((d) => !d.deleted);
  const groups = docs.map((d) => [d, Object.entries(d.stages).flatMap(([n, s]) => (s.lines || []).filter((l) => l.star).map((l) => [n, l]))]).filter(([, l]) => l.length);
  return h('div.tx',
    head('별표 대사', 'Starred Lines', '대사집에서 별표한 대사를 한곳에 모았어요.', h('a.btn.small.ghost', { href: '#/transcripts' }, '← 목록')),
    groups.length ? groups.map(([d, list]) => h('section.tx-group', h('h2.section', d.title),
      h('ol.tx-lines.mode-' + pref.mode, list.map(([n, l]) => h('li.tx-line' + (l.sp ? '' : '.narr'),
        h('div.tx-sp', koName(l.sp)),
        pref.mode !== 'ko' && l.en ? h('p.tx-en', { lang: 'en' }, l.en) : null,
        pref.mode !== 'en' && l.ko ? h('p.tx-ko', l.ko) : null,
        h('a.tx-jump', { href: `#/transcripts/${d.id}/${n}` }, `${n}장 ›`))))))
      : h('div.empty', h('p', '아직 별표한 대사가 없어요. 읽다가 대사 오른쪽 ★ 를 눌러 보세요.')));
}

// 검색 (말하는 사람·영어·한국어)
async function searchView() {
  const docs = (await loadAll()).filter((d) => !d.deleted);
  const q = h('input.tx-search', { type: 'search', placeholder: '대사·말하는 사람 찾기', value: ls.get('r1999.tx.q') || '' });
  const out = h('div');
  const paint = () => {
    const t = q.value.trim().toLowerCase();
    ls.set('r1999.tx.q', q.value);
    if (t.length < 2) { fill(out, h('p.muted', '두 글자 이상 입력해 주세요.')); return; }
    const hits = [];
    for (const d of docs) for (const [n, s] of Object.entries(d.stages)) for (const l of s.lines || []) {
      if (l.kind === 'line' && `${l.sp} ${l.en} ${l.ko}`.toLowerCase().includes(t)) hits.push([d, n, l]);
    }
    fill(out, h('p.tx-stat', `${hits.length}줄 찾음`),
      h('ol.tx-lines.mode-' + pref.mode, hits.slice(0, 300).map(([d, n, l]) => h('li.tx-line' + (l.sp ? '' : '.narr'),
        h('div.tx-sp', koName(l.sp)),
        pref.mode !== 'ko' && l.en ? h('p.tx-en', { lang: 'en' }, l.en) : null,
        pref.mode !== 'en' && l.ko ? h('p.tx-ko', l.ko) : null,
        h('a.tx-jump', { href: `#/transcripts/${d.id}/${n}` }, `${d.title} ${n}장 ›`)))));
  };
  q.addEventListener('input', debounce(paint, 200));
  paint();
  setTimeout(() => q.focus(), 50);
  return h('div.tx', head('대사 검색', 'Search', null, h('a.btn.small.ghost', { href: '#/transcripts' }, '← 목록')), q, out);
}

// ── 위키에서 영어 대사 가져오기 ────────────────────────────
// Reverse: 1999 팬덤 위키(CC BY-SA 3.0)의 스토리 기록을 이 브라우저에서 바로 읽어 온다.
// 스토리 "<영어 제목>/Story" 문서가 장(스테이지) 문서들을 순서대로 담고 있고, 장 문서는 표 한 줄 = 대사 한 줄.
const WIKI = 'https://reverse1999.fandom.com';
async function wikiText(page) {
  const u = `${WIKI}/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&redirects=1&format=json&origin=*`;
  const j = await fetch(u).then((r) => r.json());
  if (j.error) throw new Error(j.error.code === 'missingtitle' ? `위키에 "${page}" 문서가 없어요` : j.error.info);
  return j.parse.wikitext['*'];
}
/** 스토리의 장 문서 이름들 (순서대로) */
async function wikiStagePages(st) {
  try {
    const w = await wikiText(`${st.name.en}/Story`);
    const list = [...w.matchAll(/\{\{\s*:([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)].map((m) => m[1].trim());
    if (list.length) return list;
  } catch { /* 아래로 */ }
  return (st.stages || []).map((x) => x.en);
}
function wikiClean(t) {
  return t
    .replace(/<span[^>]*audio[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/\[\[(?:File|Image|파일):[^\]]*\]\]/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}
/** 장 문서 → [{ sp, en }] */
function wikiLines(w) {
  const out = [];
  for (const row of w.split(/\n\|-[^\n]*/)) {
    const cells = [];
    for (const raw of row.split('\n')) {
      if (!/^[|!]/.test(raw) || /^\|[}+-]/.test(raw) || /^\{\|/.test(raw)) continue;
      for (let c of raw.slice(1).split(/\|\||!!/)) {
        const m = c.match(/^\s*[a-z-]+\s*=\s*"[^"]*"(?:\s*[a-z-]+\s*=\s*"[^"]*")*\s*\|(?!\|)([\s\S]*)$/i);
        cells.push({ raw: c, text: m ? m[1] : c, wide: /colspan/i.test(c) });
      }
    }
    if (!cells.length) continue;
    const icon = cells.map((c) => c.raw.match(/\{\{\s*Story Icon\s*\|\s*([^|}]+)/i)).find(Boolean);
    const texts = cells.filter((c) => !/Story Icon/i.test(c.raw)).map((c) => wikiClean(c.text)).filter(Boolean);
    if (!texts.length) continue;
    const en = texts[texts.length - 1];
    if (icon) out.push({ sp: icon[1].trim(), en });
    else if (cells.some((c) => c.wide)) out.push({ sp: '', en });   // 지문(내레이션)
  }
  return out;
}

function wikiDrawer(d, st, cur, stage, done) {
  const idx = st ? (st.stages || []).findIndex((x) => String(x.n) === String(cur)) : -1;
  const page = h('input', { type: 'text', placeholder: '위키 문서 이름 (예: Rock \'n\' Roll Radio)', value: idx >= 0 ? st.stages[idx].en : '' });
  const mode = h('select',
    h('option', { value: 'fill' }, '지금 있는 줄에 순서대로 영어 채우기 (한국어는 그대로)'),
    h('option', { value: 'append' }, '이 장 끝에 이어 붙이기'),
    h('option', { value: 'replace' }, '이 장을 모두 바꾸기'));
  mode.value = stage.lines.length ? 'fill' : 'append';
  const info = h('div.tx-wiki-info', h('p.muted', '문서를 찾는 중…'));
  let got = null;
  const fetchIt = async () => {
    got = null;
    fill(info, h('p.muted', '위키에서 읽는 중…'));
    try {
      const lines = wikiLines(await wikiText(page.value.trim()));
      if (!lines.length) throw new Error('이 문서에서 대사 표를 찾지 못했어요. 문서 이름을 확인해 주세요.');
      got = lines;
      const map = nameMap();
      const unknown = [...new Set(lines.map((l) => l.sp).filter((n) => isUnmapped(n, map)))];
      fill(info,
        h('p', `대사 ${lines.length}줄 (지문 ${lines.filter((l) => !l.sp).length}줄 포함)`),
        unknown.length ? h('p.tx-warn', `한국어 이름이 없는 사람 ${unknown.length}명: ${unknown.join(', ')} — "가져오기"를 누르면 이름을 정하는 칸이 떠요.`) : h('p.muted', '말하는 사람 이름은 모두 한국어로 바뀌어요.'),
        h('ol.tx-lines.tx-preview', lines.slice(0, 4).map((l) => h('li.tx-line' + (l.sp ? '' : '.narr'), h('div.tx-sp', koName(l.sp, map)), h('p.tx-en', { lang: 'en' }, l.en)))));
    } catch (e) { fill(info, h('p.tx-warn', e.message || '읽지 못했어요.')); }
  };
  if (st && idx >= 0) wikiStagePages(st).then((pages) => { if (pages[idx]) page.value = pages[idx]; fetchIt(); }); else if (page.value) fetchIt(); else fill(info, h('p.muted', '위키 문서 이름을 적고 "읽기"를 눌러 주세요.'));
  const apply = () => {
    const map = nameMap();
    const lines = got.map((l) => ({ ...blankLine(), sp: koName(l.sp, map), en: l.en }));
    const m = mode.value;
    if (m === 'replace') {
      if (stage.lines.length && !confirmAsk(`이 장의 대사 ${stage.lines.length}줄을 위키 영어로 바꿀까요? 적어 둔 한국어도 사라져요.`)) return false;
      stage.lines = lines;
    } else if (m === 'append' || !stage.lines.length) stage.lines.push(...lines);
    else { // fill: 장면 구분·메모는 건너뛰고 대사 줄끼리 순서대로
      const slots = stage.lines.filter((l) => l.kind === 'line');
      lines.forEach((l, i) => {
        const t = slots[i];
        if (!t) { stage.lines.push(l); return; }
        t.en = l.en;
        if (!t.sp) t.sp = l.sp;
      });
    }
    return true;
  };
  const dr = drawer({
    title: '위키에서 영어 가져오기', wide: true,
    body: h('div.tx-wiki',
      h('p.muted', 'Reverse: 1999 팬덤 위키(CC BY-SA 3.0)의 스토리 기록에서 이 장의 영어 대사와 지문을 가져와요. 말하는 사람은 한국어 이름으로 바꿔 넣어요.'),
      h('div.tx-wiki-row', page, h('button.btn.small', { type: 'button', onclick: fetchIt }, '읽기')),
      h('label.tx-check', '넣는 방법 ', mode),
      info),
    foot: h('button.btn', { type: 'button', onclick: () => {
      if (!got) { toast('먼저 위키에서 읽어 와야 해요.'); return; }
      const map = nameMap();
      const unknown = [...new Set(got.map((l) => l.sp).filter((n) => isUnmapped(n, map)))];
      const finish = () => { if (!apply()) return; done(); toast(`영어 대사 ${got.length}줄을 넣었어요. 저장소에 올리는 중…`); autoSave(); };
      dr.close();
      if (unknown.length) namesForm(unknown, () => { S.dirty.add('__index'); finish(); });
      else finish();
    } }, '가져오기'),
  });
}
