// 대사집 — 좋아하는 스토리 대사를 영어·한국어로 옮겨 적어 두고 글로 읽는 곳.
// 토큰을 연결한 기기에서만 메뉴가 보이고, 열 수 있다 (취향표처럼).
// 저장: data/user/transcripts/<문서 id>.json (스토리 한 편 = 한 파일) + data/user/transcripts/index.json (목록)
//   ※ 저장소가 공개라서 파일 자체는 저장소에서 열 수 있다. 사이트 화면에서만 숨긴다.
// 주소: #/transcripts 목록 · #/transcripts/<문서 id>/<장 번호> 읽기 · #/transcripts/stars 별표 모아 보기 · #/transcripts/search 검색
import { h, fill, toast, drawer, debounce, uid, confirmAsk, pickFile, readFileText } from '../ui.js';
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
const pref = { mode: 'sub', size: 17, lh: 1.75, font: 'serif', ...(ls.get(PREF) || {}) };
if ((pref.v || 0) < 3) { pref.mode = 'sub'; pref.v = 3; }  // 보기는 자막(한국어 크게 · 영어 작게) 하나로
if (!['sub', 'ko'].includes(pref.mode)) pref.mode = 'sub';  // ko = 영어 자막 끄기
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
    order: st?.stages?.length ? st.stages.map((s) => String(s.n)) : ['1'],
    customStages: st?.stages?.length ? {} : { 1: st ? '본편' : '1장' },
    updatedAt: null,
  };
}
// 줄: { id, kind: 'line' | 'scene' | 'note', sp, en, ko, star }
const blankLine = (kind = 'line') => ({ id: uid(), kind, sp: '', en: '', ko: '', star: false });

// ── 이름표: 말하는 사람 이름은 한국어로 통일 ─────────────
// 출품작 이름(게임 데이터) + 내가 정한 이름(index.json 의 names) 으로 영어 이름을 한국어로 바꾼다
// 영어 → 한국어, 그리고 잘못 들어간 한국어 표기 → 맞는 표기 (예: 베르틴 → 버틴)
const BASE_NAMES = { Vertin: '버틴', Schneider: '슈나이더', 베르틴: '버틴' };
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
  if (map[n] && map[n] !== n) return map[n];          // 이름표에 있으면 (영어든 한국어든) 바꾼다
  if (/[가-힣]/.test(n)) return n;
  return map[Object.keys(map).find((k) => k.toLowerCase() === n.toLowerCase())] || n;
}
const isUnmapped = (n, map) => n && !/[가-힣]/.test(n) && koName(n, map) === n;
/** 아직 한국어 이름이 없는 영어 이름들을 한 번에 적는 칸 */
function namesForm(names, onDone, { title = '말하는 사람 이름 (한국어로 통일)', note, suggest = {} } = {}) {
  const map = nameMap();
  const rows = names.map((en) => ({ en, input: h('input', { type: 'text', value: suggest[en] || (map[en] && map[en] !== en ? map[en] : ''), placeholder: /[가-힣]/.test(en) ? '바꿀 이름 (비우면 그대로)' : '한국어 이름' }) }));
  const dr = drawer({
    title,
    body: h('div.tx-names',
      h('p.muted', note || '영어로 된 이름에 한국어 이름을 적어 주세요. 한 번 적으면 모든 대사집에 똑같이 쓰여요. 비워 두면 영어 그대로 둬요.'),
      rows.length ? [h('div.tx-name-row.head', h('span', '지금 이름'), h('span', '바꿀 이름')), rows.map((r) => h('label.tx-name-row', h('span', r.en), r.input))] : h('p', '바꿀 이름이 없어요.')),
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
/** 위키에서 먼저 불러온 영어 줄(한국어가 없는 줄)을 모든 대사집에서 지운다 */
async function cleanEnglishOnly() {
  const docs = (await loadAll()).filter((d) => !d.deleted);
  const count = docs.reduce((n, d) => n + Object.values(d.stages).reduce((k, st) => k + (st.lines || []).filter((l) => l.kind === 'line' && !l.ko).length, 0), 0);
  if (!count) { toast('지울 영어만 있는 줄이 없어요.'); return; }
  if (!confirmAsk(`한국어가 없는 줄 ${count}줄을 모든 대사집에서 지울까요? 한국어가 있는 줄은 그대로 둬요.`)) return;
  for (const d of docs) {
    let changed = false;
    for (const st of Object.values(d.stages)) {
      const before = (st.lines || []).length;
      st.lines = (st.lines || []).filter((l) => !(l.kind === 'line' && !l.ko));
      // 대사가 하나도 안 남은 장은 장면 구분·메모도 같이 비운다
      if (!st.lines.some((l) => l.kind === 'line')) st.lines = [];
      if (st.lines.length !== before) changed = true;
    }
    if (changed) touch(d);
  }
  toast(`${count}줄을 지웠어요. 저장소에 올리는 중…`);
  await saveAll();
  rerender();
}

function namesDrawer() {
  loadAll().then((docs) => {
    const map = nameMap();
    const seen = new Set();
    docs.forEach((d) => Object.values(d.stages || {}).forEach((st) => (st.lines || []).forEach((l) => { const n = normName(l.sp); if (n) seen.add(n); })));
    const mine = Object.keys(S.index.names || {});
    const all = [...new Set([...seen, ...mine])];
    // 아직 정하지 않은 영어 이름을 맨 위로, 나머지는 가나다순
    all.sort((a, b) => (isUnmapped(b, map) - isUnmapped(a, map)) || a.localeCompare(b, 'ko'));
    namesForm(all, async () => {
      const n = await applyNamesEverywhere();
      toast(n ? `이름 ${n}곳을 고쳤어요.` : '이름표를 정했어요.');
      paintSave(); autoSave();
    }, { title: '이름표 — 이름 고치기', note: '대사집에 나오는 모든 이름이에요. 오른쪽에 바꿀 이름을 적으면 모든 대사집에서 한꺼번에 바뀌고, 앞으로 가져오는 대사에도 똑같이 쓰여요. 이미 한국어로 쓴 이름도 여기서 고쳐요 (예: 베르틴 → 버틴). 비우면 그대로 둬요.' });
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
  const map = nameMap();
  for (const st of Object.values(d.stages || {})) for (const l of st.lines || []) { const k = koName(l.sp, map); if (k !== (l.sp || '')) l.sp = k; }
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

// 버전 · 장 표시와 정렬
// 게임 데이터에 버전이 비어 있는 메인 스토리: 4장은 1.0(출시 때), SP 장은 본편과 같은 버전에 나왔다
const VER_FALLBACK = { 'main-el-oro-de-los-tigres': '1.0', 'main-the-star': '1.4', 'main-to-the-new-world': '1.9' };
const verOf = (x) => x.version || x.st?.version || VER_FALLBACK[x.story || x.id] || '';
/** 메인 스토리 장 이름: 00 → 서막, 4TH → 4장, 5SP → 5장 SP */
function chapterLabel(st) {
  if (!st || st.cat !== 'main') return null;
  const a = String(st.abbr || '');
  if (a === '00') return '서막';
  const n = parseInt(a, 10);
  if (isNaN(n)) return null;
  return /SP$/i.test(a) ? `${n}장 SP` : `${n}장`;
}
/** 버전 순서 → (메인은) 장 번호 → SP 는 본편 뒤 → 스토리 목록 순서 */
function byVersion(x, y) {
  const num = (v) => { const m = String(v).match(/^(\d+)\.(\d+)/); return m ? +m[1] * 100 + +m[2] : 9999; };
  const sidx = (a) => { const i = stories().indexOf(a.st); return i < 0 ? 99999 : i; };
  const chap = (a) => (a.st?.cat === 'main' ? parseInt(a.st.abbr, 10) || 0 : 0) + (/SP$/i.test(a.st?.abbr || '') ? 0.5 : 0);
  // 콜라보(S01 등)는 버전 숫자가 없어서 스토리 목록에서 놓인 자리를 따른다
  const key = (a) => { const v = num(verOf(a)); return v < 9999 ? v : num(verOf(stories()[sidx(a) - 1] ? { st: stories()[sidx(a) - 1] } : {})) + 0.5; };
  return key(x) - key(y) || chap(x) - chap(y) || sidx(x) - sidx(y);
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
      h('button.btn.small.ghost', { type: 'button', onclick: cleanEnglishOnly, title: '한국어가 없는 영어 줄을 모든 대사집에서 지워요' }, '영어만 있는 줄 지우기'),
      h('button.btn.small', { type: 'button', onclick: newDocDrawer }, '+ 새 대사집')),
    S.loadErr ? h('p.tx-warn', `목록을 불러오지 못했어요: ${S.loadErr}`) : null,
    h('p.tx-stat', `대사집 ${items.length}편 · 대사 ${total.toLocaleString('ko-KR')}줄`),
    items.length ? null : h('div.empty', h('p', '아직 옮겨 둔 대사가 없어요.'), h('button.btn', { type: 'button', onclick: newDocDrawer }, '첫 대사집 만들기')),
    groups.map(([name, list]) => h('section.tx-group', h('h2.section', name),
      h('div.tx-cards', list.sort(byVersion).map((x) =>
        h('a.tx-card', { href: `#/transcripts/${x.id}` },
          x.st?.banner ? h('img', { src: x.st.banner, alt: '', loading: 'lazy' }) : h('span.tx-card-noimg', 'TXT'),
          h('div',
            h('b', x.title || '제목 없음'),
            x.titleEn ? h('small', x.titleEn) : null,
            h('span.tx-card-meta', [chapterLabel(x.st), verOf(x) ? `Ver. ${verOf(x)}` : null, `${(x.lines || 0).toLocaleString('ko-KR')}줄`, x.stars ? `★ ${x.stars}` : null, S.dirty.has(x.id) ? '저장 안 함' : null].filter(Boolean).join(' · ')))))))),
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
        h('p.tx-k', [chapterLabel(st), verOf({ ...d, st }) ? `Ver. ${verOf({ ...d, st })}` : null, st ? CATS.find(([k]) => k === st.cat)?.[1] : '직접 만든 대사집'].filter(Boolean).join(' · ')),
        S.editing && !st ? h('input.tx-title-in', { value: d.title, onchange: (e) => { d.title = e.target.value.trim() || '제목 없음'; touch(d); } }) : h('h1', d.title),
        S.editing && !st ? h('input.tx-sub-in', { value: d.titleEn || '', placeholder: '영어 제목', onchange: (e) => { d.titleEn = e.target.value.trim(); touch(d); } }) : (d.titleEn ? h('p.tx-en-title', d.titleEn) : null),
        S.editing && !st ? h('input.tx-sub-in', { value: d.version || '', placeholder: '버전 (예: 3.9)', onchange: (e) => { d.version = e.target.value.trim(); touch(d); } }) : null),
      h('div.tx-head-btns', saveBtnEl)),
    h('nav.tx-stages', order.map((n) => h('a' + (n === cur ? '.on' : ''), { href: `#/transcripts/${id}/${n}` }, stageName(n), count(n) ? h('em', count(n)) : null)),
      S.editing && !st?.stages?.length ? h('button.tx-add-stage', { type: 'button', onclick: () => {
        const name = prompt('새 장 이름', `${order.length + 1}장`); if (!name) return;
        const n = String(Math.max(0, ...order.map(Number).filter((x) => !isNaN(x))) + 1);
        d.order = [...order, n]; d.customStages = { ...(d.customStages || {}), [n]: name }; d.stages[n] = { lines: [] }; touch(d);
        location.hash = `#/transcripts/${id}/${n}`;
      } }, '+ 장') : null),
    h('div.tx-tools',
      h('div.tx-seg', modeBtn('sub', '영어 자막 켜기'), modeBtn('ko', '끄기')),
      h('div.tx-seg', ['serif', 'sans'].map((f) => h('button' + (pref.font === f ? '.on' : ''), { type: 'button', title: f === 'serif' ? '대사를 명조(고운 바탕 · Source Serif)로' : '대사를 고딕(프리텐다드)으로',
        onclick: () => { pref.font = f; savePref(); wrap.dataset.font = f; wrap.querySelectorAll('[data-fbtn]').forEach((b) => b.classList.toggle('on', b.dataset.fbtn === f)); }, 'data-fbtn': f }, f === 'serif' ? '명조' : '고딕'))),
      h('div.tx-seg', h('button', { type: 'button', title: '글씨 작게', onclick: () => size(-1) }, 'A−'), h('button', { type: 'button', title: '글씨 크게', onclick: () => size(1) }, 'A+'),
        h('button', { type: 'button', title: '줄 간격 좁게', onclick: () => lh(-0.1) }, '≡−'), h('button', { type: 'button', title: '줄 간격 넓게', onclick: () => lh(0.1) }, '≡+')),
      h('span.tx-gap'),
      S.editing ? h('button.btn.small.ghost', { type: 'button', onclick: () => scriptDrawer(d, st) }, '한국어 대본 파일 넣기') : null,
      S.editing && st?.stages?.length ? h('button.btn.small.ghost', { type: 'button', onclick: () => wikiAllStages(d, st) }, '모든 장 영어 채우기') : null,
      S.editing ? h('button.btn.small.ghost', { type: 'button', onclick: () => wikiDrawer(d, st, cur, stage, () => { touch(d); paint(); }) }, '위키에서 영어 가져오기') : null,
      S.editing ? h('button.btn.small.ghost', { type: 'button', onclick: () => pasteDrawer(d, stage, () => { touch(d); paint(); }) }, '붙여넣기로 넣기') : null,
      h('button.btn.small' + (S.editing ? '' : '.ghost'), { type: 'button', 'aria-pressed': String(S.editing), onclick: () => { const leaving = S.editing; S.editing = !S.editing; rerender(); if (leaving) autoSave(); } }, S.editing ? '읽고 저장하기' : '✎ 고치기'),
      !st && S.editing ? h('button.btn.small.danger', { type: 'button', onclick: async () => {
        if (!confirmAsk(`"${d.title}" 대사집을 지울까요? 저장을 눌러야 저장소에서도 지워져요.`)) return;
        await deleteDoc(d.id); location.hash = '#/transcripts';
      } }, '지우기') : null),
    S.editing ? null : stageHead(st, d, cur, ci, order.length),
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

// 장 머리말: 장 번호 · 한국어 제목 · 영어 제목
function stageHead(st, d, cur, ci, total) {
  const s = st?.stages?.find((x) => String(x.n) === String(cur));
  const custom = String(d.customStages?.[cur] || '').replace(/^\d+\.\s*/, '');
  return h('header.tx-stage-head',
    h('span.tx-stage-no', `Stage ${String(ci + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`),
    h('h2', s?.ko || s?.en || custom || `${cur}장`),
    s?.en && s.en !== s.ko ? h('span.tx-stage-en', s.en) : null);
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

// 말하는 사람 아이콘: NPC 대화 아이콘 → 출품작 초상 순서로 찾는다 (한국어 이름 기준)
let ICONS = null;
function speakerIcon(name) {
  if (!ICONS) {
    ICONS = new Map();
    for (const c of store.state.game.characters || []) {
      const src = c.name?.ko && store.charPortrait?.(c);
      if (src) ICONS.set(c.name.ko, src);
    }
    for (const n of store.state.game.npcs || []) {
      const src = n.icon || n.moods?.[0]?.src;
      if (src && n.name?.ko) ICONS.set(n.name.ko, src);
    }
  }
  return ICONS.get(normName(name)) || null;
}
const HANGUL = /[가-힣]/;

// 읽기: 말하는 사람 · 영어 · 한국어
function readLines(d, stage, cur) {
  const lines = stage.lines || [];
  if (!lines.length) return h('div.empty', h('p', '아직 이 장에 옮긴 대사가 없어요.'), h('button.btn', { type: 'button', onclick: () => { S.editing = true; rerender(); } }, '✎ 대사 넣기'));
  const mode = pref.mode;
  let prevSp = null;
  return h('ol.tx-lines.mode-' + mode, lines.map((l) => {
    if (l.kind !== 'line') prevSp = null;
    if (l.kind === 'scene') return h('li.tx-scene', h('span', l.ko || l.en || '· · ·'));
    if (l.kind === 'note') return h('li.tx-note', l.ko || l.en);
    if (l.kind === 'music') return h('li.tx-music', h('span', { 'aria-hidden': 'true' }, '♪ '), l.ko || l.en);
    if (l.kind === 'combat') return h('li.tx-combat', h('details', h('summary', '⚔ 전투'), h('p', l.ko || l.en || '')));
    const star = h('button.tx-star' + (l.star ? '.on' : ''), { type: 'button', title: '별표', 'aria-pressed': String(!!l.star), onclick: () => { l.star = !l.star; star.classList.toggle('on', l.star); star.setAttribute('aria-pressed', String(l.star)); touch(d); autoSaveSoon(); } }, '★');
    const name = koName(l.sp);
    const same = !!name && name === prevSp;   // 같은 사람이 이어서 말하면 아이콘·이름은 한 번만
    prevSp = name || null;
    const icon = name && !same ? speakerIcon(name) : null;
    const latin = l.ko && !HANGUL.test(l.ko);  // 주문·시·외국어 구절
    return h('li.tx-line' + (l.sp ? '' : '.narr') + (l.ko ? '' : '.noko') + (same ? '.cont' : '') + (latin ? '.latin' : ''), { id: `l-${l.id}` },
      h('div.tx-sp',
        name && !same ? (icon ? h('span.tx-ava', h('img', { src: icon, alt: '', loading: 'lazy' }))
          : h('span.tx-ava.blank', { 'aria-hidden': 'true' })) : null,   // 그림이 없는 사람은 같은 크기의 투명한 자리만 (이름 줄 맞춤)
        same ? null : h('span.tx-name', name)),
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
    const set = (k) => (e) => { l[k] = e.target.value; delete l.chk; touch(d); };
    const tools = h('div.tx-row-tools',
      h('button', { type: 'button', title: '위로', onclick: () => mv(i, i - 1) }, '↑'),
      h('button', { type: 'button', title: '아래로', onclick: () => mv(i, i + 1) }, '↓'),
      h('button', { type: 'button', title: '아래에 대사 추가', onclick: () => ins(i, 'line') }, '+'),
      h('button', { type: 'button', title: '지우기', onclick: () => { lines.splice(i, 1); touch(d); repaint(); } }, '✕'));
    if (['scene', 'note', 'music', 'combat'].includes(l.kind)) {
      const KIND = { scene: ['장면', '장면 이름 (비우면 · · ·)'], note: ['메모', '메모'], music: ['배경음악', '곡 이름'], combat: ['전투', '전투 안내'] }[l.kind];
      return h('div.tx-edit-row.k-' + l.kind,
        h('span.tx-kind', KIND[0]),
        autosize(h('textarea', { rows: 1, placeholder: KIND[1], oninput: (e) => { l.ko = e.target.value; touch(d); } }), l.ko || l.en || ''),
        tools);
    }
    return h('div.tx-edit-row' + (l.chk ? '.chk' : ''), { title: l.chk ? '위키 줄과 이름이 달라요. 영어가 맞는지 확인해 주세요 (고치면 표시가 사라져요)' : null },
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
  if (/^\s*[(（\[［*].*[)）\]］*]\s*$/.test(s)) return ['', s.trim()];   // (행동 묘사) → 이름 없이
  const m = s.match(/^\s*\[([^\]]{1,40})\]\s*(.+)$/) || s.match(/^\s*([^:：]{1,30}?)\s*[:：]\s*(.+)$/);
  return m ? [m[1].trim(), m[2].trim()] : ['', s.trim()];
}
function pasteDrawer(d, stage, done) {
  const en = h('textarea.tx-paste', { rows: 12, lang: 'en', placeholder: 'English — 한 줄에 대사 하나\nVertin: Where are we?\nSonetto: ...' });
  const ko = h('textarea.tx-paste', { rows: 12, placeholder: '한국어 — 영어와 같은 순서로 한 줄에 하나\n버틴: 여긴 어디지?\n소네트: ...' });
  const sp = h('input', { type: 'checkbox', checked: true });
  const how = h('select',
    h('option', { value: 'append' }, '이 장 끝에 이어 붙이기'),
    h('option', { value: 'fillko' }, '지금 있는 줄에 한국어만 순서대로 채우기 (영어는 그대로)'),
    h('option', { value: 'replace' }, '이 장을 모두 바꾸기'));
  const slots = () => stage.lines.filter((l) => l.kind === 'line');
  how.value = slots().length && slots().every((l) => !l.ko) ? 'fillko' : 'append';
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
    if (how.value === 'fillko') {
      const n2 = slots().length, k = out.filter((l) => l.kind === 'line').length;
      fill(info, `이 장의 대사 ${n2}줄 · 붙여 넣은 한국어 ${k}줄`,
        n2 !== k ? h('b', ` · 줄 수가 달라요. ${Math.min(n2, k)}번째 줄까지 채우고${k > n2 ? ', 남는 한국어는 끝에 새 줄로 붙여요' : ''}. 넣은 뒤 어긋난 곳은 고치기에서 맞춰 주세요.`) : h('span', ' · 줄 수가 딱 맞아요.'));
    } else fill(info, `영어 ${a.length}줄 · 한국어 ${b.length}줄 → 대사 ${out.length}줄`,
      a.length && b.length && a.length !== b.length ? h('b', ' · 줄 수가 달라요. 남는 줄은 한쪽만 들어가요.') : null);
    return out;
  };
  [en, ko, sp].forEach((x) => x.addEventListener('input', parse));
  sp.addEventListener('change', parse);
  how.addEventListener('change', parse);
  parse();
  const dr = drawer({
    title: '붙여넣기로 넣기', wide: true,
    body: h('div.tx-paste-wrap',
      h('p.muted', '영어와 한국어를 같은 순서로 한 줄에 하나씩 붙여 넣으면 줄끼리 짝을 지어요. 한쪽만 넣어도 돼요. "---" 나 "# 장면 이름" 줄은 장면 구분이 돼요.'),
      h('div.tx-paste-cols', h('label', 'English', en), h('label', '한국어', ko)),
      h('label.tx-check', sp, ' "이름: 대사" 형식이면 말하는 사람을 따로 나누기'),
      h('label.tx-check', '넣는 방법 ', how),
      info),
    foot: h('button.btn', { type: 'button', onclick: () => {
      const out = parse();
      if (!out.length) { toast('붙여 넣은 대사가 없어요.'); return; }
      if (how.value === 'replace') { if (stage.lines.length && !confirmAsk(`이 장의 대사 ${stage.lines.length}줄을 바꿀까요?`)) return; stage.lines = out; }
      else if (how.value === 'fillko') {
        const ss = slots();
        out.filter((l) => l.kind === 'line').forEach((l, i) => {
          const t = ss[i];
          if (!t) { stage.lines.push(l); return; }
          t.ko = l.ko || l.en;
          if (!t.sp && l.sp) t.sp = l.sp;
        });
      } else stage.lines.push(...out);
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
      h('ol.tx-lines.mode-' + pref.mode, list.map(([n, l]) => h('li.tx-line' + (l.sp ? '' : '.narr') + (l.ko ? '' : '.noko'),
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
      h('ol.tx-lines.mode-' + pref.mode, hits.slice(0, 300).map(([d, n, l]) => h('li.tx-line' + (l.sp ? '' : '.narr') + (l.ko ? '' : '.noko'),
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
/** 위키 주소(https://reverse1999.fandom.com/wiki/7TH-01/Story)나 문서 이름 → 문서 이름 */
function wikiTitle(v) {
  let t = String(v || '').trim();
  const m = t.match(/\/wiki\/([^?#]+)/);
  if (m) t = m[1];
  try { t = decodeURIComponent(t); } catch { /* 그대로 */ }
  return t.replace(/_/g, ' ').trim();
}
async function wikiApi(q) {
  return fetch(`${WIKI}/api.php?format=json&origin=*&${q}`).then((r) => r.json());
}
/** 있는 문서만 골라 순서대로 */
async function wikiExisting(titles) {
  const j = await wikiApi(`action=query&redirects=1&titles=${encodeURIComponent(titles.join('|'))}`);
  const norm = Object.fromEntries((j.query?.normalized || []).map((x) => [x.from, x.to]));
  const ok = new Set(Object.values(j.query?.pages || {}).filter((p) => p.missing === undefined).map((p) => p.title));
  return titles.filter((t) => ok.has(norm[t] || t));
}
async function wikiSearch(q) {
  const j = await wikiApi(`action=query&list=search&srlimit=8&srsearch=${encodeURIComponent(q)}`);
  return (j.query?.search || []).map((x) => x.title).sort((a, b) => (/\/Story$/.test(b) ? 1 : 0) - (/\/Story$/.test(a) ? 1 : 0));
}
/** 이 장의 위키 문서 이름: 7장 이후는 "7TH-01/Story", 프롤로그 같은 예전 장은 장 이름 문서 */
async function wikiStagePage(st, idx) {
  const sg = st.stages[idx];
  const nn = String(sg.n).padStart(2, '0');
  const cands = [];
  if (st.abbr) cands.push(`${st.abbr}-${nn}/Story`, `${st.abbr}-${sg.n}/Story`);
  if (sg.en) cands.push(sg.en, `${sg.en}/Story`);
  try { const ok = await wikiExisting([...new Set(cands)]); if (ok.length) return ok[0]; } catch { /* 아래로 */ }
  const pages = await wikiStagePages(st);
  return pages[idx] || sg.en || '';
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

/**
 * 한국어 줄(이름)과 위키 줄(이름)을 순서대로 맞춘다 — 이름이 같은 줄끼리 짝짓고, 한쪽에만 있는 줄은 건너뛴다.
 * 이름이 다른데 짝지은 줄은 chk 표시(고치기 화면에서 확인).  행동 묘사(이름 없음)끼리도 짝을 짓는다.
 */
function alignFill(slots, wiki) {
  const A = slots.map((l) => normName(l.sp)), B = wiki.map((l) => normName(l.sp));
  const n = A.length, m = B.length, SUB = 1.6, GAP = 1;
  const D = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  for (let i = 1; i <= n; i++) D[i][0] = i * GAP;
  for (let j = 1; j <= m; j++) D[0][j] = j * GAP;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    D[i][j] = Math.min(D[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : SUB), D[i - 1][j] + GAP, D[i][j - 1] + GAP);
  }
  let i = n, j = m, filled = 0, check = 0, used = 0;
  while (i > 0 && j > 0) {
    const same = A[i - 1] === B[j - 1];
    if (D[i][j] === D[i - 1][j - 1] + (same ? 0 : SUB)) {
      const t = slots[i - 1];
      t.en = wiki[j - 1].en; filled++; used++;
      if (same) delete t.chk; else { t.chk = true; check++; }
      i--; j--;
    } else if (D[i][j] === D[i - 1][j] + GAP) i--;
    else j--;
  }
  return { filled, check, leftover: m - used, missing: n - filled };
}

function wikiDrawer(d, st, cur, stage, done) {
  const idx = st ? (st.stages || []).findIndex((x) => String(x.n) === String(cur)) : -1;
  const page = h('input', { type: 'text', placeholder: '위키 문서 이름이나 주소 (예: 7TH-01/Story)', value: idx >= 0 ? st.stages[idx].en : '' });
  const mode = h('select',
    h('option', { value: 'fill' }, '한국어 줄에 맞춰 영어 채우기 (말하는 사람 순서로 맞춤)'),
    h('option', { value: 'append' }, '이 장 끝에 이어 붙이기'),
    h('option', { value: 'replace' }, '이 장을 모두 바꾸기'));
  mode.value = stage.lines.length ? 'fill' : 'append';
  const info = h('div.tx-wiki-info', h('p.muted', '문서를 찾는 중…'));
  let got = null;
  let lastAlign = null;
  const fetchIt = async () => {
    got = null;
    let title = wikiTitle(page.value);
    if (!title) { fill(info, h('p.muted', '위키 문서 이름이나 주소를 넣어 주세요.')); return; }
    page.value = title;
    fill(info, h('p.muted', '위키에서 읽는 중…'));
    try {
      let lines = [];
      let err = null;
      try { lines = wikiLines(await wikiText(title)); } catch (e) { err = e; }
      // 장 설명 문서면 대사는 "/Story" 쪽에 있다
      if (!lines.length && !/\/Story$/.test(title)) {
        try { const l2 = wikiLines(await wikiText(`${title}/Story`)); if (l2.length) { lines = l2; title = `${title}/Story`; page.value = title; err = null; } } catch { /* 없음 */ }
      }
      if (!lines.length) {
        const hits = await wikiSearch(title.replace(/\/Story$/, '')).catch(() => []);
        fill(info,
          h('p.tx-warn', err ? `위키에 "${title}" 문서가 없어요.` : '이 문서에서 대사 표를 찾지 못했어요.'),
          hits.length ? h('div.tx-wiki-hits', h('p.muted', '혹시 이 문서인가요? 누르면 바로 읽어요.'),
            hits.map((t) => h('button.btn.small.ghost', { type: 'button', onclick: () => { page.value = t; fetchIt(); } }, t))) : null,
          h('p.muted', '위키에서 그 장의 대사가 보이는 페이지 주소를 그대로 붙여 넣어도 돼요. (예: …/wiki/7TH-01/Story)'));
        return;
      }
      got = lines;
      const map = nameMap();
      const unknown = [...new Set(lines.map((l) => l.sp).filter((n) => isUnmapped(n, map)))];
      fill(info,
        h('p', `대사 ${lines.length}줄 (지문 ${lines.filter((l) => !l.sp).length}줄 포함) · 문서: ${title}`),
        unknown.length ? h('p.tx-warn', `한국어 이름이 없는 사람 ${unknown.length}명: ${unknown.join(', ')} — "가져오기"를 누르면 이름을 정하는 칸이 떠요.`) : h('p.muted', '말하는 사람 이름은 모두 한국어로 바뀌어요.'),
        h('ol.tx-lines.tx-preview', lines.slice(0, 4).map((l) => h('li.tx-line' + (l.sp ? '' : '.narr') + (l.ko ? '' : '.noko'), h('div.tx-sp', koName(l.sp, map)), h('p.tx-en', { lang: 'en' }, l.en)))));
    } catch (e) { fill(info, h('p.tx-warn', e.message || '읽지 못했어요.')); }
  };
  page.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchIt(); } });
  if (st?.stages?.length && idx >= 0) wikiStagePage(st, idx).then((t) => { if (t) page.value = t; fetchIt(); }).catch(() => fetchIt());
  else if (page.value) fetchIt();
  else fill(info, h('p.muted', '위키 문서 이름이나 주소를 넣고 "읽기"를 눌러 주세요.'));
  const apply = () => {
    const map = nameMap();
    const lines = got.map((l) => ({ ...blankLine(), sp: koName(l.sp, map), en: l.en }));
    const m = mode.value;
    if (m === 'replace') {
      if (stage.lines.length && !confirmAsk(`이 장의 대사 ${stage.lines.length}줄을 위키 영어로 바꿀까요? 적어 둔 한국어도 사라져요.`)) return false;
      stage.lines = lines;
    } else if (m === 'append' || !stage.lines.length) stage.lines.push(...lines);
    else { // fill: 한국어 줄(이름)과 위키 줄(이름)을 맞춰서 영어만 채운다. 이름·한국어는 건드리지 않는다
      const r = alignFill(stage.lines.filter((l) => l.kind === 'line'), lines);
      lastAlign = r;
    }
    return true;
  };
  const dr = drawer({
    title: '위키에서 영어 가져오기', wide: true,
    body: h('div.tx-wiki',
      h('p.muted', 'Reverse: 1999 팬덤 위키(CC BY-SA 3.0)의 스토리 기록에서 이 장의 영어 대사와 지문을 가져와요. 한국어를 먼저 넣어 두면, 말하는 사람 순서를 보고 한국어 줄마다 영어 자막을 맞춰 채워요.'),
      h('div.tx-wiki-row', page, h('button.btn.small', { type: 'button', onclick: fetchIt }, '읽기')),
      h('label.tx-check', '넣는 방법 ', mode),
      info),
    foot: h('button.btn', { type: 'button', onclick: () => {
      if (!got) { toast('먼저 위키에서 읽어 와야 해요.'); return; }
      const map = nameMap();
      const unknown = [...new Set(got.map((l) => l.sp).filter((n) => isUnmapped(n, map)))];
      const finish = () => { if (!apply()) return; done(); const r = lastAlign; toast(r ? `영어 ${r.filled}줄을 맞춰 넣었어요${r.check ? ` · 이름이 달라 확인할 줄 ${r.check}` : ''}${r.leftover ? ` · 짝이 없는 위키 줄 ${r.leftover}` : ''}. 저장소에 올리는 중…` : `영어 대사 ${got.length}줄을 넣었어요. 저장소에 올리는 중…`); autoSave(); };
      dr.close();
      if (unknown.length) namesForm(unknown, () => { S.dirty.add('__index'); finish(); });
      else finish();
    } }, '가져오기'),
  });
}

// ── 한국어 대본 파일(텍스트) 넣기 ─────────────────────────
// 노션 등에서 복사해 온 대본 형식:
//   1.9 고독의 노래            ← 스토리 제목 (건너뜀)
//   1. 대각선의 비밀(섬)        ← 장 머리말: 번호. 이름(장소)
//   1914/1/12 20:30            ← 날짜·시간 → 장면 구분
//   37                         ← 말하는 사람 (짧은 줄, 문장부호 없음)
//   …엄마, 궁금한 게 있어.       ← 대사 (다음 이름/지문이 나올 때까지)
//   모래사장에 서 있던 여인이…   ← 지문 (…다. 로 끝나는 서술) → 이름 없이
//   -  /  -전투-                ← 구분 줄 → 장면 구분
const SEP_RE = /^-+$|^-[^-]{1,10}-$/;
const DATE_RE = /^\d{3,4}[/.]\d{1,2}[/.]\d{1,2}(\s+\d{1,2}:\d{2})?$/;
const STAGE_RE = /^(\d{1,3})\.\s+(.+?)\s*$/;
const STORY_RE = /^\d+\.\d+\s+\S/;
const ENDPUNCT_RE = /[.!?…~,"”’'」』)\]）:：]$/;
/** 서술(지문)처럼 끝나는 줄: "…했다." "…이었다." (존댓말 "…니다."는 대사로 본다) */
const isNarration = (t) => /다[.。]?["”’]?$/.test(t) && !/(니다|니까|란다|단다|거든다)[.。]?$/.test(t) && !/^[…"“'‘]/.test(t);
function parseKoScript(text) {
  const L = text.replace(/\r/g, '').split('\n').map((x) => x.trim());
  // 말하는 사람 후보: 짧고 문장부호 없이 끝나는 줄 중 두 번 넘게 나오거나 이름표·출품작 이름인 것
  const map = nameMap();
  const known = new Set([...Object.values(map), ...(store.state.game.characters || []).map((c) => c.name?.ko).filter(Boolean)]);
  const cand = (t) => t && t.length <= 16 && !ENDPUNCT_RE.test(t) && !SEP_RE.test(t) && !DATE_RE.test(t) && !STAGE_RE.test(t) && !STORY_RE.test(t);
  const freq = {};
  L.forEach((t, i) => { if (cand(t) && L[i + 1]) freq[t] = (freq[t] || 0) + 1; });
  const isSpeaker = (t, next) => cand(t) && !!next && !cand(next) && (freq[t] >= 2 || known.has(t) || /^\d{1,4}$/.test(t));
  const stages = [];
  let cur = null, sp = '', inSpeech = false;
  const push = (l) => { if (!cur) { cur = { n: '0', title: '', lines: [] }; stages.push(cur); } cur.lines.push(l); };
  for (let i = 0; i < L.length; i++) {
    const t = L[i];
    if (!t) { inSpeech = false; continue; }
    const m = t.match(STAGE_RE);
    if (m && !STORY_RE.test(t)) {
      const place = (m[2].match(/\(([^)]*)\)\s*$/) || [])[1] || '';
      cur = { n: m[1], title: m[2].replace(/\s*\([^)]*\)\s*$/, ''), place, lines: [] };
      stages.push(cur); sp = ''; inSpeech = false; continue;
    }
    if (STORY_RE.test(t) && !cur) continue;
    if (DATE_RE.test(t)) { push({ ...blankLine('scene'), ko: t }); inSpeech = false; continue; }
    if (SEP_RE.test(t)) { push({ ...blankLine('scene'), ko: t.replace(/^-+|-+$/g, '') }); inSpeech = false; continue; }
    if (isSpeaker(t, L[i + 1])) { sp = koName(t, map); inSpeech = 'first'; continue; }
    // "이름: 대사" 한 줄 형식도 받는다
    const [s1, body] = splitSpeaker(t);
    if (s1 && (known.has(s1) || freq[s1] >= 2)) { push({ ...blankLine(), sp: koName(s1, map), ko: body }); inSpeech = false; continue; }
    if (inSpeech === 'first' || (inSpeech && !isNarration(t))) { push({ ...blankLine(), sp, ko: t }); inSpeech = true; continue; }
    push({ ...blankLine(), sp: '', ko: t });   // 지문(행동 묘사)은 이름 없이
    inSpeech = false;
  }
  return stages.filter((x) => x.lines.length || x.n !== '0');
}

function scriptDrawer(d, st) {
  const ta = h('textarea.tx-paste', { rows: 10, placeholder: '대본 텍스트를 붙여 넣거나, 위의 "파일 고르기"로 .txt 파일을 열어요.' });
  const how = h('select',
    h('option', { value: 'empty' }, '비어 있는 장에만 넣기 (이미 쓴 장은 건너뜀)'),
    h('option', { value: 'replace' }, '들어 있는 장도 모두 바꾸기'));
  const info = h('div.tx-script-info');
  let parsed = [];
  const known = (n) => (d.order || []).includes(String(n));
  const paint = () => {
    parsed = parseKoScript(ta.value);
    if (!parsed.length) { fill(info, h('p.muted', '장 머리말("1. 장 이름")을 찾으면 장별로 나눠서 보여 줘요.')); return; }
    const total = parsed.reduce((n, x) => n + x.lines.filter((l) => l.kind === 'line').length, 0);
    const narr = parsed.reduce((n, x) => n + x.lines.filter((l) => l.kind === 'line' && !l.sp).length, 0);
    const who = {};
    parsed.forEach((x) => x.lines.forEach((l) => { if (l.sp) who[l.sp] = (who[l.sp] || 0) + 1; }));
    fill(info,
      h('p', `${parsed.length}장 · 대사 ${total}줄 (그중 이름 없는 지문 ${narr}줄)`),
      h('p.muted', '말하는 사람: ', Object.entries(who).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => `${k} ${v}`).join(' · ')),
      h('ol.tx-script-stages', parsed.map((x) => {
        const have = (d.stages[x.n]?.lines || []).length;
        return h('li', h('b', `${x.n}. ${x.title}`), x.place ? h('small', ` (${x.place})`) : null,
          h('span', ` ${x.lines.filter((l) => l.kind === 'line').length}줄`),
          !known(x.n) && x.n !== '0' ? h('em', ' · 새 장으로 추가') : null,
          have ? h('em', how.value === 'empty' ? ' · 이미 있어서 건너뜀' : ' · 바꿈') : null);
      })),
      h('p.muted', '지문과 대사는 문장 끝 모양으로 나눠요. 잘못 나뉜 줄은 넣은 뒤 고치기에서 이름 칸만 고치면 돼요.'));
  };
  ta.addEventListener('input', debounce(paint, 300));
  how.addEventListener('change', paint);
  const pick = h('button.btn.small', { type: 'button', onclick: async () => {
    const f = await pickFile('.txt,.md,text/plain');
    if (!f) return;
    ta.value = await readFileText(f);
    paint();
  } }, '파일 고르기');
  paint();
  const dr = drawer({
    title: '한국어 대본 파일 넣기', wide: true,
    body: h('div.tx-script',
      h('p.muted', '장 머리말("1. 대각선의 비밀(섬)")로 장을 나누고, 이름 줄 다음 줄들은 그 사람의 대사로, "…다."로 끝나는 서술은 이름 없는 지문으로 넣어요. 날짜 줄과 "-" 줄은 장면 구분이 돼요.'),
      h('div.tx-wiki-row', pick),
      ta,
      h('label.tx-check', '넣는 방법 ', how),
      info),
    foot: [
      h('button.btn.ghost', { type: 'button', onclick: () => { if (doPut()) { autoSave(); rerender(); } } }, '한국어만 넣기'),
      st?.stages?.length ? h('button.btn', { type: 'button', onclick: async () => {
        if (!doPut()) return;
        await wikiAllStages(d, st, { ask: false });   // 이어서 모든 장 영어 채우기 (저장까지)
      } }, '넣고 영어까지 채우기') : null,
    ],
  });
  /** 나눈 대본을 장마다 넣는다. 넣은 장 수를 돌려준다 */
  function doPut() {
    if (!parsed.length) { toast('넣을 대본이 없어요.'); return 0; }
    let put = 0, skip = 0;
    for (const x of parsed) {
      if (x.n === '0') continue;
      const have = (d.stages[x.n]?.lines || []).length;
      if (have && how.value === 'empty') { skip++; continue; }
      d.stages[x.n] = { ...(d.stages[x.n] || {}), lines: x.lines };
      if (!(d.order || []).includes(x.n)) {
        d.order = [...(d.order || []), x.n].sort((p, q) => Number(p) - Number(q));
        d.customStages = { ...(d.customStages || {}), [x.n]: `${x.n}. ${x.title}` };
      }
      put++;
    }
    dr.close();
    if (!put) { toast(skip ? `${skip}장이 이미 있어서 넣을 장이 없어요. 넣는 방법을 "모두 바꾸기"로 고르면 바꿔 넣어요.` : '넣을 장이 없어요.'); return 0; }
    touch(d);
    toast(`한국어 ${put}장을 넣었어요${skip ? ` · ${skip}장은 이미 있어서 건너뜀` : ''}.`);
    return put;
  }
}

// ── 모든 장 영어 채우기 (위키) ────────────────────────────
async function wikiAllStages(d, st, { ask = true } = {}) {
  const order = d.order?.length ? d.order : st.stages.map((x) => String(x.n));
  const todo = order.filter((n) => (d.stages[n]?.lines || []).some((l) => l.kind === 'line' && l.ko && !l.en));
  if (!todo.length) { if (ask) toast('영어를 채울 장이 없어요. 한국어가 있고 영어가 빈 장만 채워요.'); else { await saveAll(); rerender(); } return; }
  if (ask && !confirmAsk(`${todo.length}개 장에 위키 영어를 채울까요? 한국어 줄에 말하는 사람 순서로 맞춰 넣어요.`)) return;
  const log = h('ol.tx-batch-log');
  const dr = drawer({ title: '모든 장 영어 채우기', wide: true, body: h('div', h('p.muted', '한 장씩 위키에서 읽어서 맞추는 중이에요. 창을 닫아도 계속돼요.'), log) });
  const pairs = {};   // 위키 영어 이름 → 짝지어진 한국어 이름 (이름표 추천용)
  let total = 0, chk = 0;
  for (const n of todo) {
    const idx = st.stages.findIndex((x) => String(x.n) === String(n));
    const row = h('li', `${n}장 … `);
    log.append(row);
    try {
      if (idx < 0) { row.append('사이트 장 목록에 없는 장이라 건너뜀 (위키에서 영어 가져오기로 직접)'); continue; }
      const title = await wikiStagePage(st, idx);
      const w = wikiLines(await wikiText(title));
      if (!w.length) { row.append(`위키 문서(${title})에서 대사를 못 찾음`); continue; }
      const map = nameMap();
      const slots = d.stages[n].lines.filter((l) => l.kind === 'line');
      const wl = w.map((l) => ({ ...l, sp: koName(l.sp, map), raw: l.sp }));
      const r = alignFill(slots, wl);
      // 이름이 달랐던 짝: 아직 한국어 이름이 없는 영어 이름이면 추천으로 모은다
      slots.forEach((t) => { if (t.chk && t._raw) delete t._raw; });
      wl.forEach((l) => { if (isUnmapped(l.raw, map)) { const hit = slots.find((t) => t.en === l.en && t.chk); if (hit?.sp) { pairs[l.raw] ||= {}; pairs[l.raw][hit.sp] = (pairs[l.raw][hit.sp] || 0) + 1; } } });
      total += r.filled; chk += r.check;
      row.append(`영어 ${r.filled}줄${r.check ? ` · 확인 ${r.check}` : ''}${r.leftover ? ` · 짝 없는 위키 줄 ${r.leftover}` : ''}`);
      touch(d);
    } catch (e) { row.append(`실패: ${e.message}`); }
  }
  log.append(h('li', h('b', `끝 — 영어 ${total}줄${chk ? `, 이름이 달라 확인할 줄 ${chk}` : ''}. 저장소에 올리는 중…`)));
  await saveAll();
  rerender();
  // 위키에만 있는 영어 이름(예: 직원 Ⅰ)에 한국어 이름을 추천해서 이름표에 넣을 수 있게
  const unknown = Object.keys(pairs);
  if (unknown.length) {
    dr.close();
    S.index.names ||= {};
    const suggest = Object.fromEntries(unknown.map((k) => [k, Object.entries(pairs[k]).sort((a, b) => b[1] - a[1])[0][0]]));
    namesForm(unknown, async () => { S.dirty.add('__index'); await saveAll(); toast('이름표를 정했어요. 다음 장부터는 이 이름으로 맞춰요.'); },
      { title: '위키 영어 이름 → 한국어 이름', note: '위키에만 있는 영어 이름이에요. 같은 자리에 있던 한국어 이름을 미리 적어 뒀어요. 맞으면 그대로 "이름 정하기"를 누르세요. 다음에 영어를 채울 때 더 정확하게 맞춰요.', suggest });
  }
}
