// 스킨 갤러리 — 보유·찜, 분류(타로카드·콜라보·도삭절…), 버전·등급·시리즈별 보기
import { h, img, chip, drawer, field, lightbox, fmt, fill } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';

export const SKIN_CAT = {
  tarot: '타로카드', collab: '콜라보 (복각 없음)', dushuo: '도삭절', anniv: '세월의 책갈피', series: '테마 시리즈',
  event: '이벤트 보상', shop: '상점', other: '기타', insight: '통찰', default: '기본',
};
const CAT_ORDER = ['tarot', 'collab', 'dushuo', 'anniv', 'series', 'event', 'shop', 'other', 'insight', 'default'];
const COSTUME = new Set(['tarot', 'collab', 'dushuo', 'anniv', 'series', 'event', 'shop', 'other']);
const SOURCES = ['', '유료 결제', '상점 재화', '이벤트', '무료 보상', '배틀패스', '복각', '기타'];
const SORTS = [['version', '버전별'], ['grade', '등급별'], ['cat', '분류별'], ['source', '획득처별'], ['series', '시리즈별'], ['char', '출품작별'], ['new', '최신순']];
export const GRADE = { 3: '유니크', 2: '어드밴스드', 1: '일반 의상', 0: '등급 없음' };
const SOURCES_ALL = ['판매', '컨텐츠', '주크박스', '무료', '콜라보 판매'];
const TAROT = ['0', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

const view = { q: '', own: 'all', cats: new Set(COSTUME), sources: new Set(), sort: 'version' };
const mine = (id) => store.state.user.skins.items[id] || {};

/** 사용자가 고친 분류·버전을 반영한 스킨 정보 */
export function skinInfo(s) {
  const m = mine(s.id);
  const c = store.charById(s.char);
  return {
    cat: m.cat || s.cat || 'shop',
    version: m.version || s.version || (s.cat === 'default' || s.cat === 'insight' ? c?.version : null) || null,
    versionKnown: !!(m.version || s.version),
  };
}
const vnum = (v) => (v && /^\d/.test(v) ? String(v).split('.').reduce((a, x) => a * 100 + (+x || 0), 0) : (v === '콜라보' ? 0.5 : -1));

export function render(root) {
  const all = store.state.game.skins.filter((s) => store.charById(s.char)?.released || mine(s.id).owned);
  const costumes = all.filter((s) => COSTUME.has(skinInfo(s).cat));
  const owned = costumes.filter((s) => mine(s.id).owned).length;
  const spent = Object.values(store.state.user.skins.items).reduce((a, x) => a + (x.owned && +x.price ? +x.price : 0), 0);

  const grid = h('div');
  const chipsRow = h('div.toolbar');

  function filtered() {
    const q = view.q.trim().toLowerCase();
    return all.filter((s) => {
      const m = mine(s.id);
      const c = store.charById(s.char);
      const info = skinInfo(s);
      if (view.cats.size && !view.cats.has(info.cat)) return false;
      if (view.sources.size && !view.sources.has(s.source)) return false;
      if (view.own === 'owned' && !m.owned) return false;
      if (view.own === 'missing' && m.owned) return false;
      if (view.own === 'wish' && !(m.wish && !m.owned)) return false;
      if (q && ![s.name, s.nameEn, s.series, store.charName(c), ...Object.values(c.name)].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function chips() {
    fill(chipsRow,
      h('div.chips', [['all', '전체'], ['owned', '보유'], ['missing', '미보유'], ['wish', '갖고 싶은']].map(([v, t]) => chip(t, view.own === v, () => { view.own = v; draw(); }))),
      h('div.chips', CAT_ORDER.map((t) => chip(SKIN_CAT[t], view.cats.has(t), () => { view.cats.has(t) ? view.cats.delete(t) : view.cats.add(t); draw(); }))),
      h('div.chips', SOURCES_ALL.map((t) => chip(t, view.sources.has(t), () => { view.sources.has(t) ? view.sources.delete(t) : view.sources.add(t); draw(); }))),
    );
  }

  function groups(list) {
    const by = (keyFn, order, label) => {
      const m = new Map();
      for (const s of list) { const k = keyFn(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); }
      return [...m.entries()].sort((a, b) => order(a[0], b[0])).map(([k, l]) => [label(k), l]);
    };
    const newest = (a, b) => vnum(skinInfo(b).version) - vnum(skinInfo(a).version) || (b.order ?? 0) - (a.order ?? 0) || b.id - a.id;
    switch (view.sort) {
      case 'version': return by((s) => skinInfo(s).version || '?', (a, b) => vnum(b) - vnum(a), (k) => (k === '?' ? '버전 미상' : k === '콜라보' ? '콜라보' : `${k} 버전`)).map(([k, l]) => [k, l.sort(newest)]);
      case 'grade': return by((s) => (s.gradeName ? s.grade : 0), (a, b) => b - a, (k) => GRADE[k] || '등급 없음').map(([k, l]) => [k, l.sort(newest)]);
      case 'source': return by((s) => s.source || '', (a, b) => (SOURCES_ALL.indexOf(a) + 1 || 99) - (SOURCES_ALL.indexOf(b) + 1 || 99), (k) => k || '획득처 미상').map(([k, l]) => [k, l.sort(newest)]);
      case 'cat': return by((s) => skinInfo(s).cat, (a, b) => CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b), (k) => SKIN_CAT[k] || k).map(([k, l]) => [k, l.sort(newest)]);
      case 'series': return by((s) => s.series || '', (a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'ko')), (k) => k || '시리즈 없음').map(([k, l]) => [k, l.sort(newest)]);
      case 'char': return by((s) => s.char, (a, b) => store.charName(store.charById(a)).localeCompare(store.charName(store.charById(b)), 'ko'), (k) => store.charName(store.charById(k)));
      default: return [[null, [...list].sort(newest)]];
    }
  }

  function draw() {
    chips();
    const list = filtered();
    if (!list.length) { fill(grid, h('div.empty', h('p', '조건에 맞는 스킨이 없습니다.'))); return; }
    fill(grid, groups(list).map(([label, l]) => (label === null ? h('div.sgrid', l.map(card)) : h('section.roster-group',
      h('h2', label, h('small', `${l.filter((s) => mine(s.id).owned).length} / ${l.length}`)),
      h('div.sgrid', l.map(card))))));
  }

  root.append(
    h('div.page-head',
      h('div', h('h1', h('span.en', 'Wardrobe'), '스킨'), h('p', '스킨을 산 것과 갖고 싶은 것으로 나눠 기록해요. 분류와 시리즈는 게임의 스킨 도감을 따르고, 그림을 누르면 크게 볼 수 있어요.')),
    ),
    h('div.progress-line',
      h('span', `${owned} / ${costumes.length} 보유`),
      h('div.meter', h('i', { style: { width: `${costumes.length ? (owned / costumes.length) * 100 : 0}%` } })),
      spent ? h('span.faint', `기록한 지출 합계 ${fmt(spent)}`) : null,
    ),
    h('div.toolbar',
      h('div.grow', h('input', { type: 'search', placeholder: '스킨·시리즈·출품작 이름', value: view.q, 'aria-label': '스킨 검색', oninput: (e) => { view.q = e.target.value; draw(); } })),
      h('select', { 'aria-label': '정렬', style: { width: 'auto' }, onchange: (e) => { view.sort = e.target.value; draw(); } }, SORTS.map(([v, t]) => h('option', { value: v, selected: view.sort === v }, t)))),
    chipsRow, grid,
  );
  draw();
}

function card(s) {
  const m = mine(s.id);
  const c = store.charById(s.char);
  const info = skinInfo(s);
  const editing = store.state.editing;
  const art = s.art || s.portrait;
  const costume = COSTUME.has(info.cat);
  const toggle = (k) => store.update('skins', (u) => {
    const x = (u.items[s.id] ||= {});
    x[k] = !x[k];
    if (k === 'owned' && x.owned) x.wish = false;
    if (!Object.values(x).some(Boolean)) delete u.items[s.id];
  });
  return h('article.scard' + (m.owned || !costume ? '' : '.unowned'),
    m.owned && costume ? h('span.flag.own', '보유') : (m.wish ? h('span.flag.wish', '갖고 싶음') : null),
    h('span.cat-tag.c-' + info.cat, info.cat === 'tarot' && s.tarot != null ? `타로 ${TAROT[s.tarot] || s.tarot}` : SKIN_CAT[info.cat]),
    s.gradeName && costume ? h('span.grade-tag.g' + s.grade, GRADE[s.grade]) : null,
    h('button.sart', { type: 'button', 'aria-label': `${s.name} 크게 보기`, onclick: () => lightbox(art, `${store.charName(c)} — ${s.name}`) }, img(art, s.name)),
    h('div.sinfo',
      h('b', costume ? s.name : `${store.charName(c)} · ${SKIN_CAT[info.cat]}`),
      h('span', [store.charName(c), s.tarot != null ? `타로 ${TAROT[s.tarot] || s.tarot}` : s.series, info.version ? (info.version === '콜라보' ? '콜라보' : `${info.version}${info.versionKnown ? '' : ' (추정)'}`) : null, s.gradeName ? GRADE[s.grade] : null, s.source].filter(Boolean).join(' · ')),
      m.note ? h('span', { style: { color: 'var(--paper-faint)' } }, m.note) : null,
    ),
    editing ? h('div.sact',
      costume ? h('button.btn' + (m.owned ? '.primary' : ''), { type: 'button', 'aria-pressed': String(!!m.owned), onclick: () => toggle('owned') }, m.owned ? '보유 ✓' : '보유') : null,
      costume && !m.owned ? h('button.btn', { type: 'button', 'aria-pressed': String(!!m.wish), onclick: () => toggle('wish') }, m.wish ? '찜 ✓' : '찜') : null,
      h('button.btn', { type: 'button', 'aria-label': '자세히', style: { flex: '0 0 auto' }, onclick: () => details(s) }, '…'),
    ) : null,
  );
}

function details(s) {
  const c = store.charById(s.char);
  const cur = { ...(store.state.user.skins.items[s.id] || {}) };
  const commit = () => store.update('skins', (u) => {
    const x = Object.fromEntries(Object.entries(cur).filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false));
    if (Object.keys(x).length) u.items[s.id] = x; else delete u.items[s.id];
  }, { silent: true });
  const body = [
    h('div', { style: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '14px', marginBottom: '16px' } },
      h('div', { style: { overflow: 'hidden', background: 'var(--night)' } }, img(s.art || s.portrait, s.name)),
      h('div.muted', { style: { fontSize: '14px' } }, h('div', { style: { color: 'var(--paper)', fontSize: '18px', fontWeight: 700 } }, s.name),
        h('div', s.nameEn), h('div', store.charName(c)),
        s.series ? h('div', `${s.seriesGroup ? s.seriesGroup + ' › ' : ''}${s.series}`) : null,
        h('div', `분류 ${SKIN_CAT[s.cat] || s.cat}${s.gradeName ? ` · ${GRADE[s.grade]}` : ''}${s.version ? ` · ${s.version}` : ''}${s.source ? ` · ${s.source}` : ''}`))),
    h('div.form-row',
      h('label.check', h('input', { type: 'checkbox', checked: !!cur.owned, onchange: (e) => { cur.owned = e.target.checked; if (cur.owned) cur.wish = false; commit(); } }), '보유'),
      h('span', { style: { display: 'inline-block', width: '16px' } }),
      h('label.check', h('input', { type: 'checkbox', checked: !!cur.wish, onchange: (e) => { cur.wish = e.target.checked; commit(); } }), '갖고 싶음'),
    ),
    h('div.fields.form-row',
      field('분류 고치기', h('select', { onchange: (e) => { cur.cat = e.target.value || undefined; commit(); } },
        h('option', { value: '' }, `자동 (${SKIN_CAT[s.cat] || s.cat})`), CAT_ORDER.map((k) => h('option', { value: k, selected: cur.cat === k }, SKIN_CAT[k])))),
      field('버전 고치기', h('input', { type: 'text', value: cur.version || '', placeholder: s.version || '예: 2.4', onchange: (e) => { cur.version = e.target.value.trim(); commit(); } })),
      field('획득 경로', h('select', { onchange: (e) => { cur.source = e.target.value; commit(); } }, SOURCES.map((x) => h('option', { value: x, selected: (cur.source || '') === x }, x || '—')))),
      field('가격 (원 또는 재화)', h('input', { type: 'number', min: 0, value: cur.price || '', onchange: (e) => { cur.price = e.target.value ? +e.target.value : ''; commit(); } })),
      field('구매한 날', h('input', { type: 'date', value: cur.date || '', onchange: (e) => { cur.date = e.target.value; commit(); } })),
      field('메모 (복각 시기 등)', h('textarea', { rows: 3, onchange: (e) => { cur.note = e.target.value; commit(); } }, cur.note || ''), 'wide'),
    ),
  ];
  const d = drawer({ title: s.name, body, foot: [h('button.btn.primary', { type: 'button', onclick: () => d.close() }, '완료')], onClose: () => rerender() });
}
