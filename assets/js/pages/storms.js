// 폭풍우 연표 — 폭풍우가 올 때마다 세계가 어느 해로 갔는지, 그 시대에 어떤 스토리가 있었는지
// 자료: data/game/storm-timeline.json (UTTU 아카이브 타임라인 기준 — 시대 구분·사건은 UTTU를 한국어로 요약, 버전·영문 제목은 Reverse: 1999 Wiki)
// 주소: #/storms   한 시대로 바로: #/storms/<시대 id>  (예: #/storms/e1990)
// 아직 확실하지 않은 자료라 토큰을 연결한 기기에서만 메뉴가 보이고 열린다 (취향표·대사집처럼).
// 편집 모드에서 "✎ 연표 고치기"로 시대·폭풍우·스토리 배치를 고치고, "연표 저장"을 누르면 저장소에 커밋된다.
import { h, img, chip, toast, confirmAsk } from '../ui.js';
import * as store from '../store.js';
import * as gh from '../github.js';
import { rerender } from '../app.js';

const FILE = 'data/game/storm-timeline.json';
const DRAFT = 'r1999.storms.draft';

let data = null;
let loading = null;
const view = { kind: 'all', events: true };   // kind: all | main | event | char, events: 시대별 사건 보이기

function load() {
  // 토큰이 있으니 저장소에서 바로 읽는다 (사이트 반영을 기다리지 않게). 실패하면 사이트 파일로.
  loading ||= gh.readText(FILE)
    .then((f) => (f ? JSON.parse(f.text) : Promise.reject(new Error('없음'))))
    .catch(() => fetch(FILE, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }))
    .then((d) => {
      data = d;
      // 저장하지 않은 고친 내용이 있으면 이어서
      try { const dr = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (dr?.eras) { edit.draft = dr; edit.on = true; } } catch { /* 없음 */ }
      rerender();
    })
    .catch((e) => { data = { error: e.message }; rerender(); });
  return loading;
}

const U = () => store.state.user.stories || {};
const SRC_SHORT = { uttu: 'U' };
const yearNum = (y) => parseInt(y, 10);

export function render(root, { arg } = {}) {
  if (!gh.hasToken()) {
    root.append(h('div.empty', h('p', '폭풍우 연표는 아직 정리 중이라 GitHub 토큰을 연결한 기기에서만 볼 수 있어요.'), h('a.btn', { href: '#/settings' }, '설정에서 연결하기')));
    return;
  }
  root.append(h('div.page-head', h('div',
    h('h1', h('span.en', 'Storm Chronicle'), '폭풍우 연표'),
    h('p', '폭풍우가 올 때마다 세계가 어느 해로 건너갔는지, 그 시대에 어떤 이야기가 있었는지 순서대로 모았어요. 메인 13장까지 들어 있어요.')),
    store.state.editing && data && !data.error ? h('div.tx-head-btns',
      edit.on ? h('button.btn.small', { type: 'button', disabled: edit.saving, onclick: saveEdit }, edit.saving ? '저장 중…' : '연표 저장') : null,
      edit.on ? h('button.btn.small.ghost', { type: 'button', onclick: cancelEdit }, '그만 고치기') : h('button.btn.small.ghost', { type: 'button', onclick: startEdit }, '✎ 연표 고치기')) : null));

  if (!data) { load(); root.append(h('p.loading', '연표를 불러오는 중…')); return; }
  if (data.error) { root.append(h('div.empty', h('p', `연표 자료를 불러오지 못했어요 (${data.error}).`))); return; }
  if (edit.on && store.state.editing) { root.append(editView()); return; }

  const eras = data.eras;
  const byId = new Map(eras.map((e) => [e.id, e]));
  const stormAfter = new Map(data.storms.map((s) => [s.from, s]));

  root.append(pathChart(eras, data.storms));

  root.append(h('div.toolbar.st-toolbar',
    h('div.chips',
      chip('전체', view.kind === 'all', () => { view.kind = 'all'; rerender(); }),
      chip('메인 스토리', view.kind === 'main', () => { view.kind = 'main'; rerender(); }),
      chip('버전 이벤트', view.kind === 'event', () => { view.kind = 'event'; rerender(); }),
      chip('캐릭터 스토리', view.kind === 'char', () => { view.kind = 'char'; rerender(); }),
      chip('사건 보기', view.events, () => { view.events = !view.events; rerender(); })),
    h('span.st-legend',
      h('span.st-src', 'U'), ' UTTU 사건에 나오는 스토리 ',
      h('span.st-flag', '?'), ' 불확실')));

  if (data.prehistory && view.events) root.append(prehistoryBlock(data.prehistory));

  const list = h('ol.st-list');
  eras.forEach((era, i) => {
    list.append(eraBlock(era, i));
    const s = stormAfter.get(era.id);
    if (s) list.append(stormRow(s, byId));
  });
  root.append(list);

  // 시대를 알 수 없는 이야기
  const un = data.unplaced.filter(pass);
  if (un.length) {
    root.append(h('section.st-unplaced',
      h('h2.group-head', h('span.en', 'Unplaced'), '시대를 알 수 없는 이야기'),
      h('ul.st-stories', un.map((s) => storyRow(s)))));
  }
  if (data.excluded) root.append(h('p.faint.story-src', data.excluded));
  if (data.note_char) root.append(h('p.faint.story-src', data.note_char));
  root.append(h('p.faint.story-src',
    `${data.basis} · ${data.updated} 정리 · 출처: `,
    ...Object.values(data.sources).flatMap((s, i) => [i ? ', ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.label)])));

  if (arg) requestAnimationFrame(() => document.getElementById(`st-${decodeURIComponent(arg)}`)?.scrollIntoView({ block: 'start' }));
}

const pass = (s) => view.kind === 'all' || s.kind === view.kind;

function eraBlock(era, i) {
  const stories = era.stories.filter(pass);
  return h('li.st-era', { id: `st-${era.id}`, class: era.uncertain ? 'uncertain' : '' },
    h('div.st-era-year',
      h('span.st-era-n', i === 0 ? 'ORIGIN' : `ERA ${String(i).padStart(2, '0')}`),
      h('b', era.year === '1930s' ? '1930년대' : era.year, era.uncertain ? h('span.st-flag', { title: '출처마다 다르거나 확실하지 않아요' }, '?') : null),
      h('small', era.label),
      era.span ? h('small.st-real', era.span) : null,
      era.realYears ? h('small.st-real', { title: 'UTTU 타임라인에 적힌, 폭풍우 밖에서 실제로 흐른 해' }, `실제 ${era.realYears}`) : null),
    h('div.st-era-body',
      stories.length ? h('ul.st-stories', stories.map((s) => storyRow(s)))
        : era.stories.length ? h('p.st-empty', '이 필터에 맞는 스토리가 없어요.') : era.note ? null : h('p.st-empty', '이 시대가 무대인 스토리는 아직 없어요.'),
      era.note ? h('p.st-note', era.note) : null,
      view.events && era.events?.length ? h('div.st-events',
        h('p.st-events-head', h('span.st-src', 'U'), ` 이 시대의 사건 ${era.events.length}`),
        h('ol.st-evlist', era.events.map(eventRow))) : null));
}

/** UTTU 타임라인 사건 한 줄 — 내 스토리 목록에 있으면 그 스토리로, 아니면 UTTU 원문 페이지로 */
function eventRow(e) {
  const st = e.story && store.storyById(e.story);
  const label = e.mineTitle || e.ko;
  const title = st ? h('a', { href: `#/stories/${e.story}` }, label)
    : e.link ? h('a', { href: e.link, target: '_blank', rel: 'noopener' }, label) : label;
  return h('li.st-ev',
    h('span.st-ev-date', e.date || '—'),
    h('span.st-ev-body',
      h('b', title, e.ver ? h('em.st-ev-ver', e.ver) : null),
      e.en ? h('small.en', { title: 'UTTU 원문 제목' }, e.en) : null,
      e.mineTitle && e.mineTitle !== e.ko ? h('small.st-ev-alt', `Claude 번역: ${e.ko}`) : null,
      e.note ? h('span.st-ev-note', e.note) : null,
      e.mine ? h('span.st-ev-mine', h('em', '내 번역'), e.mine) : null,
      e.orig ? h('details.st-ev-orig', h('summary', '원문 메모'), h('p', e.orig)) : null));
}

/** 첫 폭풍우 전 원래 흐르던 시간 — 접어 둘 수 있게 */
function prehistoryBlock(p) {
  return h('details.st-pre', { open: true },
    h('summary', h('span.en', 'Before the Storm'), ` ${p.label}`, h('small.faint', ` · 사건 ${p.years.reduce((n, y) => n + y.events.length, 0)}`)),
    p.note ? h('p.st-note', p.note) : null,
    h('ol.st-pre-list', p.years.map((y) => h('li.st-pre-year',
      h('b.st-pre-y', y.year),
      h('ol.st-evlist', y.events.map(eventRow))))));
}

function storyRow(s) {
  const st = s.story && store.storyById(s.story);
  const read = s.story && U().read?.[s.story];
  const rating = s.story && U().ratings?.[s.story];
  const inner = [
    h('span.st-thumb', st?.banner ? img(st.banner, '') : h('span.st-thumb-none', s.code)),
    h('span.st-main',
      h('span.st-code', { class: s.kind }, s.code, s.ver ? h('em', ` · ${s.ver}`) : null),
      h('b', s.ko, s.part ? h('span.st-part', s.part) : null),
      h('small.en', s.en)),
    h('span.st-side',
      s.when ? h('span.st-when', s.when) : null,
      s.note ? h('span.st-snote', s.note) : null,
      h('span.st-meta',
        rating ? h('span.stars', '★'.repeat(rating)) : null,
        read ? h('span.read-mark', '읽음') : null,
        (s.src || []).map((k) => h('span.st-src', { title: data.sources[k]?.label }, SRC_SHORT[k] || k)),
        null)),
  ];
  return h('li', st ? h('a.st-story', { href: `#/stories/${s.story}` }, inner) : h('div.st-story', inner));
}

function stormRow(s, byId) {
  const gap = s.toYear - s.fromYear;
  const dir = gap < 0 ? 'past' : 'future';
  const to = byId.get(s.to);
  return h('li.st-storm', { class: [dir, s.uncertain ? 'uncertain' : ''].join(' ') },
    h('div.st-storm-mark', h('span', `STORM ${String(s.n).padStart(2, '0')}`)),
    h('div.st-storm-body',
      h('b', `${s.n}차 폭풍우`),
      h('span.st-storm-date', s.date),
      h('span.st-storm-jump',
        `${s.fromYear} → ${to?.year === '1930s' ? '1930년대' : to?.year}`,
        h('em', s.uncertain ? (gap < 0 ? '약 40년 과거로' : '') : `${Math.abs(gap)}년 ${gap < 0 ? '과거' : '미래'}로`)),
      s.note ? h('span.st-snote', s.note) : null,
      s.disagree ? h('span.st-disagree', h('span.st-flag', '?'), s.disagree) : null));
}

/** 위: 폭풍우마다 몇 년으로 갔는지 한눈에 보는 꺾은선 (누르면 그 시대로) */
function pathChart(eras, storms) {
  const W = 960; const H = 190; const padL = 44; const padR = 20; const padT = 26; const padB = 34;
  const ys = eras.map((e) => yearNum(e.year) || 1935);
  const minY = 1900; const maxY = 2000;
  const x = (i) => padL + (i * (W - padL - padR)) / (eras.length - 1);
  const y = (v) => padT + ((maxY - v) * (H - padT - padB)) / (maxY - minY);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text) n.textContent = text; return n; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'st-chart', role: 'img', 'aria-label': '폭풍우마다 도착한 연도를 이은 꺾은선' });
  for (const g of [1900, 1925, 1950, 1975, 2000]) {
    svg.append(el('line', { x1: padL, x2: W - padR, y1: y(g), y2: y(g), class: 'st-grid' }));
    svg.append(el('text', { x: padL - 8, y: y(g) + 4, class: 'st-axis', 'text-anchor': 'end' }, String(g)));
  }
  let d = '';
  ys.forEach((v, i) => { d += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
  svg.append(el('path', { d, class: 'st-line' }));
  eras.forEach((e, i) => {
    const a = el('a', { href: `#/storms/${e.id}`, class: 'st-pt' + (e.uncertain ? ' uncertain' : '') });
    a.addEventListener('click', (ev) => { ev.preventDefault(); document.getElementById(`st-${e.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    a.append(el('title', {}, `${i === 0 ? '출발' : `${i}차 폭풍우 뒤`} · ${e.year === '1930s' ? '1930년대' : e.year}`));
    a.append(el('circle', { cx: x(i), cy: y(ys[i]), r: 5 }));
    const above = i === 0 || ys[i] >= ys[i - 1];
    a.append(el('text', { x: x(i), y: y(ys[i]) + (above ? -10 : 18), 'text-anchor': 'middle', class: 'st-pt-label' }, e.year === '1930s' ? '1930s' : e.year));
    svg.append(a);
    svg.append(el('text', { x: x(i), y: H - 10, 'text-anchor': 'middle', class: 'st-axis' }, i === 0 ? '출발' : `#${i}`));
  });
  // 설명 줄은 자료에서 계산 (고쳐도 맞게)
  const nums = ys.filter((v, i) => yearNum(eras[i].year));
  const minYear = Math.min(...nums);
  let big = null;
  for (let i = 1; i < eras.length; i++) {
    const a = yearNum(eras[i - 1].year); const b = yearNum(eras[i].year);
    if (a && b && (!big || Math.abs(b - a) > big.gap)) big = { gap: Math.abs(b - a), a, b };
  }
  return h('figure.st-chart-wrap', svg, h('figcaption.faint',
    [`폭풍우 ${storms.length}번`, isFinite(minYear) ? `가장 먼 과거 ${minYear}년` : null, big ? `가장 큰 도약 ${big.gap}년 (${big.a} → ${big.b})` : null].filter(Boolean).join(' · ')));
}

// ── 고치기 ────────────────────────────────────────────────
// 시대(eras)를 순서대로 고치면, 폭풍우(storms)는 "앞 시대 → 다음 시대" 사이에 하나씩 자동으로 맞춰진다.
// 폭풍우의 날짜·메모·출처 차이·불확실 표시는 몇 번째 폭풍우인지(n)로 이어 붙는다.
const edit = { on: false, draft: null, saving: false };
const clone = (o) => JSON.parse(JSON.stringify(o));
const keep = () => { try { localStorage.setItem(DRAFT, JSON.stringify(edit.draft)); } catch { /* 저장 불가 */ } };
const touch = (redraw = false) => { keep(); if (redraw) rerender(); };

function startEdit() { edit.draft = clone(data); edit.on = true; rerender(); }
function cancelEdit() {
  if (!confirmAsk('고친 내용을 버리고 원래 연표로 돌아갈까요?')) return;
  edit.on = false; edit.draft = null; try { localStorage.removeItem(DRAFT); } catch { /* 무시 */ }
  rerender();
}
/** 시대 순서에 맞춰 폭풍우를 다시 만든다 */
function syncStorms(d) {
  const old = new Map((d.storms || []).map((s) => [s.n, s]));
  d.storms = d.eras.slice(1).map((e, i) => {
    const prev = d.eras[i]; const o = old.get(i + 1) || {};
    return { ...o, n: i + 1, from: prev.id, to: e.id, fromYear: yearNum(prev.year) || null, toYear: yearNum(e.year) || null, date: o.date || '' };
  });
}
async function saveEdit() {
  const d = edit.draft;
  syncStorms(d);
  d.updated = new Date().toISOString().slice(0, 10);
  edit.saving = true; rerender();
  try {
    await gh.commitFiles([{ path: FILE, text: JSON.stringify(d, null, 1) + '\n' }], '폭풍우 연표 고치기');
    data = clone(d); edit.on = false; edit.draft = null;
    try { localStorage.removeItem(DRAFT); } catch { /* 무시 */ }
    toast('폭풍우 연표를 저장했어요.');
  } catch (e) { toast(`저장 실패: ${e.message}`, 'err'); }
  edit.saving = false; rerender();
}

const txt = (obj, key, ph, cls = '') => h('input' + cls, { type: 'text', value: obj[key] ?? '', placeholder: ph, 'aria-label': ph,
  onchange: (e) => { const v = e.target.value.trim(); if (v) obj[key] = v; else delete obj[key]; touch(); } });
const check = (obj, key, label) => h('label.check', h('input', { type: 'checkbox', checked: !!obj[key], onchange: (e) => { if (e.target.checked) obj[key] = true; else delete obj[key]; touch(); } }), label);
const moveIn = (arr, i, j) => { if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; touch(true); };
const tools = (arr, i, extra = []) => h('div.st-ed-tools',
  h('button', { type: 'button', 'aria-label': '위로', onclick: () => moveIn(arr, i, i - 1) }, '↑'),
  h('button', { type: 'button', 'aria-label': '아래로', onclick: () => moveIn(arr, i, i + 1) }, '↓'),
  ...extra,
  h('button', { type: 'button', 'aria-label': '지우기', onclick: () => { if (confirmAsk('지울까요?')) { arr.splice(i, 1); touch(true); } } }, '✕'));

const area = (obj, key, ph) => h('textarea.st-ed-area', { rows: 2, placeholder: ph, 'aria-label': ph,
  onchange: (e) => { const v = e.target.value.trim(); if (v) obj[key] = v; else delete obj[key]; touch(); } }, obj[key] ?? '');

/** UTTU 사건 번역 고치기 — 원문 제목(en) · Claude 번역(ko·note) · 내 번역(mineTitle·mine) · 원문 메모(orig) */
function eventsEditor(holder, key, head) {
  const list = (holder[key] ||= []);
  return h('details.st-ed-events', h('summary', `${head} · 사건 ${list.length}`),
    list.map((e, k) => h('div.st-ed-ev',
      h('div.st-ed-row', h('span.st-ev-date', e.date || '—'), h('small.en', e.en || ''), h('span'), tools(list, k)),
      h('div.st-ed-evgrid',
        txt(e, 'date', '날짜 (예: 1987.06)'),
        txt(e, 'en', '원문 제목 (영어)'),
        txt(e, 'ko', 'Claude 번역 제목'),
        txt(e, 'mineTitle', '내 번역 제목 (쓰면 이걸 먼저 보여줘요)'),
        area(e, 'note', 'Claude 요약'),
        area(e, 'mine', '내 번역'),
        area(e, 'orig', '원문 메모 (직접 옮겨 적기)')))),
    h('button.btn.small.ghost', { type: 'button', onclick: () => { list.push({ date: '', ko: '', en: '' }); touch(true); } }, '+ 사건 더하기'));
}

function editView() {
  const d = edit.draft;
  syncStorms(d);
  const stormBy = new Map(d.storms.map((s) => [s.n, s]));
  const places = [...d.eras.map((e) => [e.id, `${e.year} ${e.label || ''}`.trim()]), ['__unplaced', '시대를 알 수 없는 이야기']];
  const listOf = (id) => (id === '__unplaced' ? d.unplaced : d.eras.find((e) => e.id === id)?.stories);

  const storyEditor = (arr, i, here) => {
    const s = arr[i];
    const st = s.story && store.storyById(s.story);
    const moveTo = h('select', { 'aria-label': '다른 시대로 옮기기', onchange: (e) => { const to = listOf(e.target.value); if (!to) return; arr.splice(i, 1); to.push(s); touch(true); } },
      h('option', { value: '' }, '옮기기…'), places.filter(([id]) => id !== here).map(([id, name]) => h('option', { value: id }, name)));
    return h('div.st-ed-story',
      h('div.st-ed-row',
        h('span.st-code', { class: s.kind }, s.code || '—'),
        h('b', s.ko || st?.name?.ko || '(제목 없음)'),
        h('small.en', s.en || st?.name?.en || ''),
        tools(arr, i, [moveTo])),
      h('div.st-ed-fields',
        txt(s, 'when', '언제 (예: 1912년 11월 30일)'),
        txt(s, 'part', '부분 (예: 회상)'),
        txt(s, 'note', '메모'),
        h('span.st-ed-src', '출처', ...Object.entries(d.sources || {}).filter(([k]) => k !== 'fandom').map(([k, v]) =>
          h('label.check', h('input', { type: 'checkbox', checked: (s.src || []).includes(k), onchange: (e) => { s.src = (s.src || []).filter((x) => x !== k); if (e.target.checked) s.src.push(k); touch(); } }), v.label)))));
  };

  const addStory = (arr) => {
    const used = new Set([...d.eras.flatMap((e) => e.stories), ...d.unplaced].map((x) => x.story));
    const opts = (store.state.game.stories || []).filter((x) => ['main', 'mainevent'].includes(x.cat) && !used.has(x.id));
    return h('select.st-ed-add', { 'aria-label': '스토리 더하기', onchange: (e) => {
      const x = opts.find((o) => o.id === e.target.value); if (!x) return;
      arr.push({ story: x.id, code: x.cat === 'main' ? (x.abbr === '00' ? 'PRO' : x.abbr) : (x.version || ''), kind: x.cat === 'main' ? 'main' : 'event', ko: x.name.ko, en: x.name.en, src: [] });
      touch(true);
    } }, h('option', { value: '' }, '+ 스토리 더하기…'), opts.map((o) => h('option', { value: o.id }, `${o.version || ''} ${o.name.ko}`)));
  };

  const blocks = [];
  d.eras.forEach((era, i) => {
    blocks.push(h('li.st-ed-era',
      h('div.st-ed-head',
        h('span.st-era-n', i === 0 ? 'ORIGIN' : `ERA ${String(i).padStart(2, '0')}`),
        txt(era, 'year', '연도 (예: 1966, 1930s)', '.st-ed-year'),
        txt(era, 'label', '시대 이름'),
        txt(era, 'span', '연도 범위 (예: 1977 ~ 1978)'),
        check(era, 'uncertain', '불확실'),
        tools(d.eras, i)),
      txt(era, 'note', '시대 메모', '.st-ed-wide'),
      h('div.st-ed-stories', era.stories.map((_, k) => storyEditor(era.stories, k, era.id)), addStory(era.stories)),
      eventsEditor(era, 'events', `${era.year} 시대의 사건`)));
    const st = stormBy.get(i + 1);
    if (st && i < d.eras.length - 1) {
      blocks.push(h('li.st-ed-storm',
        h('span.st-storm-mark', h('span', `STORM ${String(st.n).padStart(2, '0')}`)),
        h('span.faint', `${era.year} → ${d.eras[i + 1].year}`),
        txt(st, 'date', '날짜 (예: 1999년 12월 31일)'),
        txt(st, 'note', '메모'),
        txt(st, 'disagree', '출처끼리 다른 점'),
        check(st, 'uncertain', '불확실')));
    }
  });

  const pre = d.prehistory;
  return h('div.st-edit',
    pre ? h('details.st-ed-pre', h('summary', `${pre.label} 사건 번역 고치기 (${pre.years.reduce((n, y) => n + y.events.length, 0)})`),
      pre.years.map((y) => eventsEditor(y, 'events', y.year))) : null,
    h('p.muted', '연도·이름·메모는 칸을 고치고 다른 곳을 누르면 바로 반영돼요. 시대 순서를 바꾸면 폭풍우 순서도 같이 맞춰져요. 다 고치면 위의 "연표 저장"을 눌러 주세요. 저장하기 전까지는 이 브라우저에만 임시로 남아요.'),
    h('div.fields.st-ed-meta', txt(d, 'basis', '기준 (예: 한국 서버 3.9 기준)'), txt(d, 'excluded', '빠진 것 설명', '.st-ed-wide')),
    h('ol.st-ed-list', blocks),
    h('button.btn.small.ghost', { type: 'button', onclick: () => { d.eras.push({ id: `e${Date.now().toString(36)}`, year: '', label: '', stories: [] }); touch(true); } }, '+ 시대 더하기'),
    h('section.st-unplaced', h('h2.group-head', h('span.en', 'Unplaced'), '시대를 알 수 없는 이야기'),
      h('div.st-ed-stories', d.unplaced.map((_, k) => storyEditor(d.unplaced, k, '__unplaced')), addStory(d.unplaced))));
}
