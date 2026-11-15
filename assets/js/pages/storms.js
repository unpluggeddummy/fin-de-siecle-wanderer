// 폭풍우 연표 — 폭풍우가 올 때마다 세계가 어느 해로 갔는지, 그 시대에 어떤 스토리가 있었는지
// 자료: data/game/storm-timeline.json (손으로 정리: 나무위키 + 버틴의 여행가방, 버전·영문 제목은 Reverse: 1999 Wiki)
// 주소: #/storms   한 시대로 바로: #/storms/<시대 id>  (예: #/storms/e1990)
import { h, img, chip } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';

let data = null;
let loading = null;
const view = { kind: 'all' };   // all | main | event

function load() {
  loading ||= fetch('data/game/storm-timeline.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { data = d; rerender(); })
    .catch((e) => { data = { error: e.message }; rerender(); });
  return loading;
}

const U = () => store.state.user.stories || {};
const SRC_SHORT = { namu: '나', suitcase: '여' };
const yearNum = (y) => parseInt(y, 10);

export function render(root, { arg } = {}) {
  root.append(h('div.page-head', h('div',
    h('h1', h('span.en', 'Storm Chronicle'), '폭풍우 연표'),
    h('p', '폭풍우가 올 때마다 세계가 어느 해로 건너갔는지, 그 시대에 어떤 이야기가 있었는지 순서대로 모았어요. 메인 13장까지 들어 있어요.'))));

  if (!data) { load(); root.append(h('p.loading', '연표를 불러오는 중…')); return; }
  if (data.error) { root.append(h('div.empty', h('p', `연표 자료를 불러오지 못했어요 (${data.error}).`))); return; }

  const eras = data.eras;
  const byId = new Map(eras.map((e) => [e.id, e]));
  const stormAfter = new Map(data.storms.map((s) => [s.from, s]));

  root.append(pathChart(eras, data.storms));

  root.append(h('div.toolbar.st-toolbar',
    h('div.chips',
      chip('전체', view.kind === 'all', () => { view.kind = 'all'; rerender(); }),
      chip('메인 스토리', view.kind === 'main', () => { view.kind = 'main'; rerender(); }),
      chip('버전 이벤트', view.kind === 'event', () => { view.kind = 'event'; rerender(); })),
    h('span.st-legend',
      h('span.st-src', '나'), ' 나무위키 ',
      h('span.st-src', '여'), ' 버틴의 여행가방 ',
      h('span.st-flag', '?'), ' 출처끼리 다르거나 불확실')));

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
      h('small', era.label)),
    h('div.st-era-body',
      stories.length ? h('ul.st-stories', stories.map((s) => storyRow(s)))
        : era.stories.length ? h('p.st-empty', '이 필터에 맞는 스토리가 없어요.') : era.note ? null : h('p.st-empty', '이 시대가 무대인 스토리는 아직 없어요.'),
      era.note ? h('p.st-note', era.note) : null));
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
        s.src && s.src.length === 1 && s.src[0] === 'suitcase' ? h('span.st-flag', { title: '여행가방에만 있는 배치예요' }, '?') : null)),
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
  return h('figure.st-chart-wrap', svg, h('figcaption.faint', `폭풍우 ${storms.length}번 · 가장 먼 과거 1912년 · 가장 큰 도약 76년 (1914 → 1990)`));
}
