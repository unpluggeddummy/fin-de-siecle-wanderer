// 의지 보관함 — 보유·레벨·증폭, 누가 장착했는지, 증폭 재료(도철·탐욕) 개수, 여러 개 일괄 편집
import { h, img, chip, drawer, field, stepper, toast, fill, fmt } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { face } from '../components.js';

export const PSY_MAX_LV = 60;
const view = { q: '', own: 'all', rarity: new Set([6, 5]), sort: 'rarity', selecting: false, picked: new Set() };
const SORTS = [['rarity', '성급별'], ['new', '출시순 (최신 먼저)'], ['level', '레벨별'], ['amp', '증폭별']];
const mine = (id) => store.state.user.psychubes.items[id] || {};

/** 의지 id → 장착한 출품작 목록 */
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
  const all = store.state.game.psychubes.filter((p) => !p.refine);
  const refine = store.state.game.psychubes.filter((p) => p.refine);
  const editing = store.state.editing;
  if (!editing) { view.selecting = false; view.picked.clear(); }
  const hold = holders();
  const ownedCount = all.filter((p) => mine(p.id).owned).length;
  const grid = h('div');
  const chipsRow = h('div.toolbar');
  const bulkBar = h('div.bulk-bar.edit-only');

  function filtered() {
    const q = view.q.trim().toLowerCase();
    return all.filter((p) => {
      const m = mine(p.id);
      const eq = hold.get(p.id)?.length;
      if (view.rarity.size && !view.rarity.has(p.rarity)) return false;
      if (view.own === 'owned' && !m.owned) return false;
      if (view.own === 'missing' && m.owned) return false;
      if (view.own === 'equipped' && !eq) return false;
      if (view.own === 'free' && !(m.owned && !eq)) return false;
      if (view.own === 'amp5' && !(m.owned && (m.amp || 1) >= 5)) return false;
      if (q && !Object.values(p.name).join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function draw() {
    fill(chipsRow,
      h('div.chips', [['all', '전체'], ['owned', '보유'], ['missing', '미보유'], ['equipped', '장착 중'], ['free', '보유 · 미장착'], ['amp5', '증폭 5']]
        .map(([v, t]) => chip(t, view.own === v, () => { view.own = v; draw(); }))),
      h('div.chips', [6, 5, 4, 3].map((r) => chip(`${r}성`, view.rarity.has(r), () => { view.rarity.has(r) ? view.rarity.delete(r) : view.rarity.add(r); draw(); }))),
    );
    const list = filtered();
    drawBulk(list);
    const onCard = (p) => { if (view.selecting) { view.picked.has(p.id) ? view.picked.delete(p.id) : view.picked.add(p.id); draw(); } else open(p, hold.get(p.id) || []); };
    if (!list.length) { fill(grid, h('div.empty', h('p', '조건에 맞는 의지가 없습니다.'))); return; }
    fill(grid, groups(list).map(([label, l]) => (label === null ? h('div.pgrid', l.map((p) => card(p, hold.get(p.id) || [], onCard)))
      : h('section.roster-group', h('h2', label, h('small', `${l.filter((p) => mine(p.id).owned).length} / ${l.length} 보유`),
        view.selecting ? h('button.btn.small.ghost', { type: 'button', style: { marginLeft: 'auto' }, onclick: () => { l.forEach((p) => view.picked.add(p.id)); draw(); } }, '이 묶음 모두 선택') : null),
      h('div.pgrid', l.map((p) => card(p, hold.get(p.id) || [], onCard)))))));
  }

  function groups(list) {
    const newest = (a, b) => b.id - a.id;
    const by = (keyFn, label) => {
      const m = new Map();
      for (const p of list) { const k = keyFn(p); if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
      return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([k, l]) => [label(k), l.sort((a, b) => b.rarity - a.rarity || newest(a, b))]);
    };
    if (view.sort === 'new') return [[null, [...list].sort(newest)]];
    if (view.sort === 'level') return by((p) => (mine(p.id).owned ? mine(p.id).level || 1 : -1), (k) => (k < 0 ? '미보유' : `Lv.${k}`));
    if (view.sort === 'amp') return by((p) => (mine(p.id).owned ? mine(p.id).amp || 1 : -1), (k) => (k < 0 ? '미보유' : `증폭 ${k}`));
    return by((p) => p.rarity, (k) => `${k}성`).map(([k, l]) => [k, l.sort(newest)]);
  }

  function drawBulk(list) {
    if (!view.selecting) { bulkBar.hidden = true; return; }
    bulkBar.hidden = false;
    fill(bulkBar,
      h('span.bulk-count', `${view.picked.size}개 선택됨`),
      h('button.btn.small', { type: 'button', onclick: () => { list.forEach((p) => view.picked.add(p.id)); draw(); } }, `보이는 ${list.length}개 모두 선택`),
      h('button.btn.small.ghost', { type: 'button', disabled: !view.picked.size, onclick: () => { view.picked.clear(); draw(); } }, '선택 해제'),
      h('span', { style: { flex: 1 } }),
      h('button.btn.small', { type: 'button', disabled: !view.picked.size, onclick: () => quick({ owned: true }) }, '보유로'),
      h('button.btn.small', { type: 'button', disabled: !view.picked.size, onclick: () => quick({ owned: false }) }, '미보유로'),
      h('button.btn.small.primary', { type: 'button', disabled: !view.picked.size, onclick: bulkEdit }, '일괄 적용…'),
    );
  }

  function quick(patch) {
    const ids = [...view.picked];
    store.update('psychubes', (u) => { for (const id of ids) { const x = (u.items[id] ||= { amp: 1, level: 1, count: 1 }); Object.assign(x, patch); } }, { silent: true });
    toast(`${ids.length}개를 ${patch.owned ? '보유' : '미보유'}로 바꿨어요.`);
    draw();
  }

  root.append(
    h('div.page-head', h('div', h('h1', h('span.en', 'Psychubes'), '의지'),
      h('p', `보유 ${ownedCount} / ${all.length}. 카드 아래 얼굴은 그 의지를 장착한 출품작이에요 (출품작 화면에서 장착 의지를 고르면 반영돼요).`))),
    refinePanel(refine, editing),
    h('div.toolbar',
      h('div.grow', h('input', { type: 'search', placeholder: '의지 이름 검색', value: view.q, 'aria-label': '의지 검색', oninput: (e) => { view.q = e.target.value; draw(); } })),
      h('select', { 'aria-label': '정렬', style: { width: 'auto' }, onchange: (e) => { view.sort = e.target.value; draw(); } }, SORTS.map(([v, t]) => h('option', { value: v, selected: view.sort === v }, t))),
      h('button.btn.edit-only', { type: 'button', 'aria-pressed': String(view.selecting), onclick: () => { view.selecting = !view.selecting; view.picked.clear(); rerender(); } }, view.selecting ? '선택 끝내기' : '여러 개 선택')),
    chipsRow, bulkBar, grid,
  );
  draw();
}

/** 증폭 재료 (도철·탐욕) — 개수로 센다 */
function refinePanel(refine, editing) {
  if (!refine.length) return null;
  return h('section.panel.refine',
    h('div.panel-head', h('h3', '증폭 재료', h('span.en', 'Refine'))),
    h('div.refine-list', refine.map((p) => {
      const n = mine(p.id).count || 0;
      return h('div.refine-item',
        h('div.ri-icon', img(p.icon, p.name.ko)),
        h('div', h('b', p.name.ko), h('span.faint', `${p.rarity}성`)),
        editing
          ? h('div.ri-count',
            h('button.btn.small', { type: 'button', 'aria-label': `${p.name.ko} 하나 빼기`, onclick: () => setCount(p, Math.max(0, n - 1)) }, '−'),
            h('input', { type: 'number', min: 0, value: n, 'aria-label': `${p.name.ko} 개수`, onchange: (e) => setCount(p, Math.max(0, +e.target.value || 0)) }),
            h('button.btn.small', { type: 'button', 'aria-label': `${p.name.ko} 하나 더하기`, onclick: () => setCount(p, n + 1) }, '+'))
          : h('div.ri-num', fmt(n), h('small', '개')),
      );
    })),
  );
}
function setCount(p, n) {
  store.update('psychubes', (u) => { if (n) u.items[p.id] = { count: n }; else delete u.items[p.id]; });
}

function ampDots(n) {
  return h('span.amp', { title: `증폭 ${n || 0}단계`, 'aria-label': `증폭 ${n || 0}단계` }, [1, 2, 3, 4, 5].map((i) => h('i' + (i <= (n || 0) ? '.on' : ''))));
}

function card(p, eq, onClick) {
  const m = mine(p.id);
  const picked = view.selecting && view.picked.has(p.id);
  const amp = m.amp || 1;
  const cls = ['pcard', `r${p.rarity}`, m.owned ? '' : 'unowned', picked ? 'picked' : ''].filter(Boolean).join('.');
  return h('button.' + cls, { type: 'button', onclick: () => onClick(p), 'aria-pressed': view.selecting ? String(picked) : undefined, 'aria-label': `${p.name.ko} ${m.owned ? `레벨 ${m.level || 1} 증폭 ${amp}` : '미보유'}` },
    h('div.icon',
      img(p.icon, ''),
      view.selecting ? h('span.tick', { 'aria-hidden': 'true' }, picked ? '✓' : '') : null,
    ),
    h('div.pname', p.name.ko),
    m.owned
      ? h('div.pstat', h('span', h('small', 'Lv'), m.level || 1), h('span', h('small', '증폭'), amp), ampDots(amp))
      : h('div.pmeta', h('span', `${p.rarity}성 · 미보유`)),
    eq.length ? h('div.wearers', h('div.faces', eq.slice(0, 4).map((cid) => face(cid))),
      h('span', eq.map((cid) => store.charName(store.charById(cid))).join(', '))) : (m.owned ? h('div.wearers.none', '착용 없음') : null),
  );
}

function open(p, eq) {
  const editing = store.state.editing;
  const cur = { amp: 1, level: 1, count: 1, ...mine(p.id) };
  const commit = () => store.update('psychubes', (u) => { u.items[p.id] = { ...cur }; if (!cur.owned && !cur.note) delete u.items[p.id]; }, { silent: true });
  const head = h('div', { style: { display: 'grid', gridTemplateColumns: '110px 1fr', gap: '14px', marginBottom: '16px', alignItems: 'center' } },
    h('div.pcard', { style: { padding: 0, cursor: 'default' } }, h('div.icon', img(p.icon, p.name.ko))),
    h('div', h('div', { style: { color: 'var(--gold)' } }, '★'.repeat(p.rarity)),
      h('div.faint', { style: { fontSize: '13px' } }, [p.name.en, p.name.ja, p.name.zhCN].filter(Boolean).join(' / ')),
      p.skill ? h('div.muted', { style: { fontSize: '13px' } }, p.skill) : null));
  const eqRow = h('div.form-row', h('div.lbl', h('span', '장착한 출품작')),
    eq.length ? h('div.faces', eq.map((cid) => h('a', { href: `#/roster/${cid}`, onclick: () => d.close() }, face(cid)))) : h('p.muted', { style: { margin: 0 } }, '없음'));
  let body;
  if (!editing) {
    body = [head, h('dl.kv', h('dt', '보유'), h('dd', cur.owned ? '예' : '아니요'),
      cur.owned ? [h('dt', '레벨'), h('dd', `Lv.${cur.level}`), h('dt', '증폭'), h('dd', `${cur.amp}단계`), h('dt', '개수'), h('dd', cur.count)] : null,
      cur.note ? [h('dt', '메모'), h('dd', cur.note)] : null), eqRow];
  } else {
    const lv = h('input', { type: 'number', min: 1, max: PSY_MAX_LV, value: cur.level, 'aria-label': '레벨',
      onchange: (e) => { cur.level = Math.max(1, Math.min(PSY_MAX_LV, +e.target.value || 1)); e.target.value = cur.level; cur.owned = true; commit(); } });
    body = [head,
      h('div.form-row', h('label.check', h('input', { type: 'checkbox', checked: !!cur.owned, onchange: (e) => { cur.owned = e.target.checked; commit(); } }), '보유 중')),
      h('div.form-row', h('div.lbl', h('span', '레벨')),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
          h('div', { style: { width: '90px' } }, lv),
          [1, 20, 30, 40, 50, 60].map((v) => h('button.btn.small', { type: 'button', onclick: () => { cur.level = v; lv.value = v; cur.owned = true; commit(); } }, `${v}`)))),
      h('div.form-row', h('div.lbl', h('span', '증폭 단계')), stepper([1, 2, 3, 4, 5], cur.amp, (v) => { cur.amp = v; cur.owned = true; commit(); }, (v) => `⚡${v}`)),
      h('div.fields.form-row',
        field('보유 개수', h('input', { type: 'number', min: 0, value: cur.count, onchange: (e) => { cur.count = Math.max(0, +e.target.value || 0); commit(); } })),
        field('메모', h('textarea', { rows: 2, onchange: (e) => { cur.note = e.target.value; commit(); } }, cur.note || ''), 'wide')),
      eqRow];
  }
  const d = drawer({ title: p.name.ko, body, foot: [h('button.btn.primary', { type: 'button', onclick: () => d.close() }, editing ? '완료' : '닫기')], onClose: () => rerender() });
}

function bulkEdit() {
  const ids = [...view.picked];
  const st = { owned: '', level: '', amp: '' };
  const sel = (key, opts) => h('select', { onchange: (e) => { st[key] = e.target.value; } }, h('option', { value: '' }, '바꾸지 않음'), opts.map(([v, t]) => h('option', { value: v }, t)));
  const body = [
    h('p.muted', { style: { marginTop: 0 } }, `선택한 ${ids.length}개에 적용합니다. 레벨이나 증폭을 정하면 보유로도 표시돼요.`),
    h('div.fields',
      field('보유', sel('owned', [['1', '보유'], ['0', '미보유']])),
      field('레벨', sel('level', [1, 10, 20, 30, 40, 50, 60].map((v) => [String(v), `Lv.${v}`]))),
      field('증폭', sel('amp', [1, 2, 3, 4, 5].map((v) => [String(v), `⚡${v}`]))),
    ),
    h('div.faces', { style: { marginTop: '14px' } }, ids.slice(0, 40).map((id) => { const p = store.psyById(id); return h('span.face', { title: p.name.ko, style: { borderRadius: '2px' } }, img(p.icon, '')); })),
  ];
  const apply = () => {
    if (!st.owned && !st.level && !st.amp) { toast('바꿀 항목을 골라 주세요.', 'err'); return; }
    store.update('psychubes', (u) => {
      for (const id of ids) {
        const x = (u.items[id] ||= { amp: 1, level: 1, count: 1 });
        if (st.owned) x.owned = st.owned === '1'; else x.owned = true;
        if (st.level) x.level = +st.level;
        if (st.amp) x.amp = +st.amp;
        x.amp ||= 1; x.level ||= 1; x.count ||= 1;
      }
    }, { silent: true });
    toast(`${ids.length}개에 적용했어요. 저장 버튼을 눌러야 저장소에 반영돼요.`);
    d.close();
  };
  const d = drawer({ title: '의지 일괄 적용', body, foot: [h('button.btn', { type: 'button', onclick: () => d.close() }, '취소'), h('button.btn.primary', { type: 'button', onclick: apply }, '적용')], onClose: () => rerender() });
}
