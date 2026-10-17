// 스킨 갤러리 — 구매 여부, 갖고 싶은 스킨, 획득 경로, 가격 메모
import { h, img, chip, drawer, field, lightbox, fmt } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';

export const SKIN_TYPE = {
  shop: '상점', 'shop-art': '상점 (한정)', event: '이벤트·보상', insight: '통찰', default: '기본', other: '기타',
};
const SOURCES = ['', '유료 결제', '상점 재화', '이벤트', '무료 보상', '배틀패스', '복각', '기타'];

const view = { q: '', own: 'all', types: new Set(['shop', 'shop-art', 'event']), group: false };

const mine = (id) => store.state.user.skins.items[id] || {};

export function render(root) {
  const all = store.state.game.skins;
  const costumes = all.filter((s) => ['shop', 'shop-art', 'event'].includes(s.type) && store.charById(s.char)?.released);
  const owned = costumes.filter((s) => mine(s.id).owned).length;
  const spent = Object.values(store.state.user.skins.items).reduce((a, x) => a + (x.owned && +x.price ? +x.price : 0), 0);

  const grid = h('div');
  const chipsRow = h('div.toolbar');

  function filtered() {
    const q = view.q.trim().toLowerCase();
    return all.filter((s) => {
      const m = mine(s.id);
      const c = store.charById(s.char);
      if (!c) return false;
      if (!c.released && !m.owned) return false;
      if (view.types.size && !view.types.has(s.type)) return false;
      if (view.own === 'owned' && !m.owned) return false;
      if (view.own === 'missing' && m.owned) return false;
      if (view.own === 'wish' && !(m.wish && !m.owned)) return false;
      if (q && ![s.name, s.nameEn, store.charName(c), ...Object.values(c.name)].join(' ').toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => b.id - a.id);
  }

  function chips() {
    chipsRow.replaceChildren(
      h('div.chips', [['all', '전체'], ['owned', '보유'], ['missing', '미보유'], ['wish', '갖고 싶은']].map(([v, t]) => chip(t, view.own === v, () => { view.own = v; draw(); }))),
      h('div.chips', ['shop', 'shop-art', 'event', 'insight', 'default'].map((t) => chip(SKIN_TYPE[t], view.types.has(t), () => {
        view.types.has(t) ? view.types.delete(t) : view.types.add(t); draw();
      }))),
      h('div.chips', chip('캐릭터별로 묶기', view.group, () => { view.group = !view.group; draw(); })),
    );
  }

  function draw() {
    chips();
    const list = filtered();
    if (!list.length) { grid.replaceChildren(h('div.empty', h('p', '조건에 맞는 스킨이 없습니다.'))); return; }
    if (!view.group) { grid.replaceChildren(h('div.sgrid', list.map(card))); return; }
    const by = new Map();
    for (const s of list) { if (!by.has(s.char)) by.set(s.char, []); by.get(s.char).push(s); }
    const groups = [...by.entries()].sort((a, b) => store.charName(store.charById(a[0])).localeCompare(store.charName(store.charById(b[0])), 'ko'));
    grid.replaceChildren(...groups.map(([cid, l]) => h('section.roster-group',
      h('h2', store.charName(store.charById(cid)), h('small', `${l.filter((s) => mine(s.id).owned).length} / ${l.length}`)),
      h('div.sgrid', l.map(card)))));
  }

  root.append(
    h('div.page-head',
      h('div', h('h1', '스킨'), h('p', '상점·이벤트 스킨을 산 것과 갖고 싶은 것으로 나눠 기록합니다. 그림을 누르면 크게 볼 수 있어요.')),
    ),
    h('div.progress-line',
      h('span', `${owned} / ${costumes.length} 보유`),
      h('div.meter', h('i', { style: { width: `${costumes.length ? (owned / costumes.length) * 100 : 0}%` } })),
      spent ? h('span.faint', `기록한 지출 합계 ${fmt(spent)}`) : null,
    ),
    h('div.toolbar', h('div.grow', h('input', { type: 'search', placeholder: '스킨 이름 또는 캐릭터 이름', value: view.q, 'aria-label': '스킨 검색',
      oninput: (e) => { view.q = e.target.value; draw(); } }))),
    chipsRow, grid,
  );
  draw();
}

function card(s) {
  const m = mine(s.id);
  const c = store.charById(s.char);
  const editing = store.state.editing;
  const art = s.art || s.portrait;
  const toggle = (k) => store.update('skins', (u) => {
    const x = (u.items[s.id] ||= {});
    x[k] = !x[k];
    if (k === 'owned' && x.owned) x.wish = false;
    if (!x.owned && !x.wish && !x.price && !x.note && !x.source) delete u.items[s.id];
  });
  const isCostume = ['shop', 'shop-art', 'event'].includes(s.type);
  return h('article.scard' + (m.owned || !isCostume ? '' : '.unowned'),
    m.owned && isCostume ? h('span.flag.own', '보유') : (m.wish ? h('span.flag.wish', '갖고 싶음') : null),
    h('button.sart', { type: 'button', 'aria-label': `${s.name} 크게 보기`, onclick: () => lightbox(art, `${store.charName(c)} — ${s.name}`) }, img(art, s.name)),
    h('div.sinfo',
      h('b', isCostume ? s.name : `${store.charName(c)} · ${SKIN_TYPE[s.type]}`),
      h('span', [store.charName(c), SKIN_TYPE[s.type], m.source].filter(Boolean).join(' · ')),
      m.note ? h('span', { style: { color: 'var(--paper-faint)' } }, m.note) : null,
    ),
    editing && isCostume ? h('div.sact',
      h('button.btn' + (m.owned ? '.primary' : ''), { type: 'button', 'aria-pressed': String(!!m.owned), onclick: () => toggle('owned') }, m.owned ? '보유 ✓' : '보유'),
      m.owned ? null : h('button.btn', { type: 'button', 'aria-pressed': String(!!m.wish), onclick: () => toggle('wish') }, m.wish ? '찜 ✓' : '찜'),
      h('button.btn', { type: 'button', 'aria-label': '자세히', style: { flex: '0 0 auto' }, onclick: () => details(s) }, '…'),
    ) : null,
  );
}

function details(s) {
  const c = store.charById(s.char);
  const cur = { ...(store.state.user.skins.items[s.id] || {}) };
  const commit = () => store.update('skins', (u) => { u.items[s.id] = { ...cur }; }, { silent: true });
  const body = [
    h('div', { style: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '14px', marginBottom: '16px' } },
      h('div', { style: { borderRadius: '8px', overflow: 'hidden', background: '#0b1714' } }, img(s.art || s.portrait, s.name)),
      h('div.muted', { style: { fontSize: '14px' } }, h('div', { style: { color: 'var(--paper)', fontFamily: 'var(--serif)', fontSize: '18px', fontWeight: 700 } }, s.name),
        h('div', s.nameEn), h('div', `${store.charName(c)} · ${SKIN_TYPE[s.type]}`))),
    h('div.form-row',
      h('label.check', h('input', { type: 'checkbox', checked: !!cur.owned, onchange: (e) => { cur.owned = e.target.checked; if (cur.owned) cur.wish = false; commit(); } }), '보유'),
      h('span', { style: { display: 'inline-block', width: '16px' } }),
      h('label.check', h('input', { type: 'checkbox', checked: !!cur.wish, onchange: (e) => { cur.wish = e.target.checked; commit(); } }), '갖고 싶음'),
    ),
    h('div.fields.form-row',
      field('획득 경로', h('select', { onchange: (e) => { cur.source = e.target.value; commit(); } }, SOURCES.map((x) => h('option', { value: x, selected: (cur.source || '') === x }, x || '—')))),
      field('가격 (원 또는 재화)', h('input', { type: 'number', min: 0, value: cur.price || '', onchange: (e) => { cur.price = e.target.value ? +e.target.value : ''; commit(); } })),
      field('구매한 날', h('input', { type: 'date', value: cur.date || '', onchange: (e) => { cur.date = e.target.value; commit(); } })),
      field('메모 (복각 시기 등)', h('textarea', { rows: 3, onchange: (e) => { cur.note = e.target.value; commit(); } }, cur.note || ''), 'wide'),
    ),
  ];
  const d = drawer({ title: s.name, body, foot: [h('button.btn.primary', { type: 'button', onclick: () => d.close() }, '완료')], onClose: () => rerender() });
}
