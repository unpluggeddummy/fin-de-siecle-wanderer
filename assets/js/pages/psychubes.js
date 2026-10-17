// 의지 보관함 — 보유 여부, 증폭 단계, 누가 장착했는지
import { h, img, chip, drawer, field, stepper } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { face } from '../components.js';

const view = { q: '', own: 'all', rarity: new Set([6, 5]) };
const mine = (id) => store.state.user.psychubes.items[id] || {};

/** 의지 id → 장착한 캐릭터 목록 */
function holders() {
  const map = new Map();
  for (const [cid, r] of Object.entries(store.state.user.roster.chars)) {
    if (!r.owned || !r.psychube) continue;
    if (!map.has(r.psychube)) map.set(r.psychube, []);
    map.get(r.psychube).push(+cid);
  }
  return map;
}

export function render(root) {
  const all = store.state.game.psychubes;
  const hold = holders();
  const ownedCount = all.filter((p) => mine(p.id).owned).length;
  const grid = h('div');
  const chipsRow = h('div.toolbar');

  function draw() {
    chipsRow.replaceChildren(
      h('div.chips', [['all', '전체'], ['owned', '보유'], ['missing', '미보유'], ['equipped', '장착 중'], ['free', '보유 · 미장착']]
        .map(([v, t]) => chip(t, view.own === v, () => { view.own = v; draw(); }))),
      h('div.chips', [6, 5, 4, 3].map((r) => chip(`${r}성`, view.rarity.has(r), () => { view.rarity.has(r) ? view.rarity.delete(r) : view.rarity.add(r); draw(); }))),
    );
    const q = view.q.trim().toLowerCase();
    const list = all.filter((p) => {
      const m = mine(p.id);
      const eq = hold.get(p.id)?.length;
      if (view.rarity.size && !view.rarity.has(p.rarity)) return false;
      if (view.own === 'owned' && !m.owned) return false;
      if (view.own === 'missing' && m.owned) return false;
      if (view.own === 'equipped' && !eq) return false;
      if (view.own === 'free' && !(m.owned && !eq)) return false;
      if (q && !Object.values(p.name).join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    grid.replaceChildren(list.length ? h('div.pgrid', list.map((p) => card(p, hold.get(p.id) || []))) : h('div.empty', h('p', '조건에 맞는 의지가 없습니다.')));
  }

  root.append(
    h('div.page-head', h('div', h('h1', '의지'),
      h('p', `보유 ${ownedCount}개. 카드 아래 얼굴은 그 의지를 장착한 캐릭터입니다 (캐릭터 화면에서 장착 의지를 고르면 반영돼요).`))),
    h('div.toolbar', h('div.grow', h('input', { type: 'search', placeholder: '의지 이름 검색', value: view.q, 'aria-label': '의지 검색', oninput: (e) => { view.q = e.target.value; draw(); } }))),
    chipsRow, grid,
  );
  draw();
}

function ampDots(n) {
  return h('span.amp', { title: `증폭 ${n || 0}단계`, 'aria-label': `증폭 ${n || 0}단계` }, [1, 2, 3, 4, 5].map((i) => h('i' + (i <= (n || 0) ? '.on' : ''))));
}

function card(p, eq) {
  const m = mine(p.id);
  return h('button.pcard' + (m.owned ? '' : '.unowned'), { type: 'button', onclick: () => open(p, eq) },
    h('div.icon', img(p.icon, '')),
    h('div.pname', p.name.ko),
    h('div.pmeta', h('span', `${p.rarity}성`), m.owned ? ampDots(m.amp) : h('span', '미보유'), m.count > 1 ? h('span', `×${m.count}`) : null),
    eq.length ? h('div.faces', eq.slice(0, 6).map((cid) => face(cid))) : null,
  );
}

function open(p, eq) {
  const editing = store.state.editing;
  const cur = { amp: 1, count: 1, ...mine(p.id) };
  const commit = () => store.update('psychubes', (u) => { u.items[p.id] = { ...cur }; if (!cur.owned && !cur.note) delete u.items[p.id]; }, { silent: true });
  const head = h('div', { style: { display: 'grid', gridTemplateColumns: '110px 1fr', gap: '14px', marginBottom: '16px', alignItems: 'center' } },
    h('div.pcard', { style: { padding: 0, cursor: 'default' } }, h('div.icon', img(p.icon, p.name.ko))),
    h('div', h('div', { style: { color: 'var(--brass-bright)' } }, '★'.repeat(p.rarity)),
      h('div.faint', { style: { fontSize: '13px' } }, [p.name.en, p.name.ja, p.name.zhCN].filter(Boolean).join(' / ')),
      p.skill ? h('div.muted', { style: { fontSize: '13px' } }, p.skill) : null));
  const eqRow = h('div.form-row', h('div.lbl', h('span', '장착한 캐릭터')),
    eq.length ? h('div.faces', eq.map((cid) => h('a', { href: `#/roster/${cid}`, onclick: () => d.close() }, face(cid)))) : h('p.muted', { style: { margin: 0 } }, '없음'));
  let body;
  if (!editing) {
    body = [head, h('dl.kv', h('dt', '보유'), h('dd', cur.owned ? '예' : '아니요'),
      cur.owned ? [h('dt', '증폭'), h('dd', `${cur.amp}단계`), h('dt', '개수'), h('dd', cur.count)] : null,
      cur.note ? [h('dt', '메모'), h('dd', cur.note)] : null), eqRow];
  } else {
    body = [head,
      h('div.form-row', h('label.check', h('input', { type: 'checkbox', checked: !!cur.owned, onchange: (e) => { cur.owned = e.target.checked; commit(); } }), '보유 중')),
      h('div.form-row', h('div.lbl', h('span', '증폭 단계')), stepper([1, 2, 3, 4, 5], cur.amp, (v) => { cur.amp = v; cur.owned = true; commit(); }, (v) => `${v}`)),
      h('div.fields.form-row',
        field('보유 개수', h('input', { type: 'number', min: 0, value: cur.count, onchange: (e) => { cur.count = Math.max(0, +e.target.value || 0); commit(); } })),
        field('메모', h('textarea', { rows: 2, onchange: (e) => { cur.note = e.target.value; commit(); } }, cur.note || ''), 'wide')),
      eqRow];
  }
  const d = drawer({ title: p.name.ko, body, foot: [h('button.btn.primary', { type: 'button', onclick: () => d.close() }, editing ? '완료' : '닫기')], onClose: () => rerender() });
}
