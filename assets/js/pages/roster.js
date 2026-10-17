// 출품작 — 육성 상태 (통찰·레벨·공명·형상·공명변조·광상·의지·스킨), 여러 출품작 일괄 편집
import { h, img, drawer, stepper, chip, field, toast, pickFile, readFileText, lightbox, fill } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { stars, afClass, ROMAN } from '../components.js';
import { importRosterJSON } from '../importer.js';

const AF_ORDER = ['star', 'mineral', 'beast', 'plant', 'spirit', 'intellect'];
const view = {
  q: '', rarity: new Set(), af: new Set(), own: 'all', euph: false, unreleased: false, sort: 'rarity',
  selecting: false, picked: new Set(),
};

export function render(root, { arg }) {
  const { characters } = store.state.game;
  const chars = store.state.user.roster.chars;
  const editing = store.state.editing;
  if (!editing) { view.selecting = false; view.picked.clear(); }

  const total = characters.filter((c) => c.released).length;
  const owned = characters.filter((c) => chars[c.id]?.owned).length;

  const search = h('input', {
    type: 'search', placeholder: '이름 검색 (한국어·영어·일본어·중국어)', value: view.q, 'aria-label': '출품작 검색',
    oninput: (e) => { view.q = e.target.value; draw(); },
  });

  const filterBar = h('div.toolbar',
    h('div.grow', search),
    h('select', { 'aria-label': '정렬', style: { width: 'auto' }, onchange: (e) => { view.sort = e.target.value; draw(); } },
      [['rarity', '성급별'], ['name', '이름순'], ['resonance', '공명 높은 순'], ['portray', '형상 높은 순'], ['level', '육성 높은 순']]
        .map(([v, t]) => h('option', { value: v, selected: view.sort === v }, t))),
    h('button.btn.edit-only', { type: 'button', 'aria-pressed': String(view.selecting), onclick: () => { view.selecting = !view.selecting; view.picked.clear(); rerender(); } },
      view.selecting ? '선택 끝내기' : '여러 개 선택'),
    h('button.btn.edit-only', { type: 'button', onclick: doImport }, '시뮬레이터 JSON 가져오기'),
  );

  const chipsRow = h('div.toolbar');
  const grid = h('div');
  const bulkBar = h('div.bulk-bar.edit-only');

  function chips() {
    const own = [['all', '전체'], ['owned', '보유'], ['missing', '미보유']];
    fill(chipsRow,
      h('div.chips', own.map(([v, t]) => chip(t, view.own === v, () => { view.own = v; draw(); }))),
      h('div.chips', [6, 5, 4, 3, 2].map((r) => chip(`${r}성`, view.rarity.has(r), () => { toggle(view.rarity, r); draw(); }))),
      h('div.chips', AF_ORDER.map((a) => chip(store.AFFLATUS[a], view.af.has(a), () => { toggle(view.af, a); draw(); },
        h('i.sw', { style: { background: `var(--${a})` } })))),
      h('div.chips',
        chip('광상 있음', view.euph, () => { view.euph = !view.euph; draw(); }),
        chip('미출시 포함', view.unreleased, () => { view.unreleased = !view.unreleased; draw(); })),
    );
  }

  function filtered() {
    const q = view.q.trim().toLowerCase();
    return characters.filter((c) => {
      const r = chars[c.id];
      if (!view.unreleased && !c.released && !r?.owned) return false;
      if (view.own === 'owned' && !r?.owned) return false;
      if (view.own === 'missing' && r?.owned) return false;
      if (view.rarity.size && !view.rarity.has(c.rarity)) return false;
      if (view.af.size && !view.af.has(c.afflatus) && !(c.afflatus === 'mineral-star' && (view.af.has('mineral') || view.af.has('star')))) return false;
      if (view.euph && !c.euphoria) return false;
      if (q) {
        const names = [store.charName(c), ...Object.values(c.name)].join(' ').toLowerCase();
        if (!names.includes(q)) return false;
      }
      return true;
    });
  }

  function sorted(list) {
    const rec = (c) => chars[c.id] || {};
    const score = (c) => (rec(c).owned ? 1 : 0);
    const by = {
      rarity: (a, b) => b.rarity - a.rarity || score(b) - score(a) || store.charName(a).localeCompare(store.charName(b), 'ko'),
      name: (a, b) => store.charName(a).localeCompare(store.charName(b), 'ko'),
      resonance: (a, b) => (rec(b).resonance || 0) * score(b) - (rec(a).resonance || 0) * score(a) || b.rarity - a.rarity,
      portray: (a, b) => (rec(b).portray || 0) * score(b) - (rec(a).portray || 0) * score(a) || b.rarity - a.rarity,
      level: (a, b) => growth(rec(b)) * score(b) - growth(rec(a)) * score(a) || b.rarity - a.rarity,
    };
    return [...list].sort(by[view.sort]);
  }

  function drawBulk(list) {
    if (!view.selecting) { bulkBar.hidden = true; return; }
    bulkBar.hidden = false;
    fill(bulkBar,
      h('span.bulk-count', `${view.picked.size}개 선택됨`),
      h('button.btn.small', { type: 'button', onclick: () => { list.forEach((c) => view.picked.add(c.id)); draw(); } }, `보이는 ${list.length}개 모두 선택`),
      h('button.btn.small.ghost', { type: 'button', disabled: !view.picked.size, onclick: () => { view.picked.clear(); draw(); } }, '선택 해제'),
      h('span', { style: { flex: 1 } }),
      h('button.btn.small', { type: 'button', disabled: !view.picked.size, onclick: () => quickOwn(true) }, '보유로'),
      h('button.btn.small', { type: 'button', disabled: !view.picked.size, onclick: () => quickOwn(false) }, '미보유로'),
      h('button.btn.small.primary', { type: 'button', disabled: !view.picked.size, onclick: bulkEdit }, '일괄 적용…'),
    );
  }

  function draw() {
    chips();
    const list = sorted(filtered());
    drawBulk(list);
    if (!list.length) {
      fill(grid, h('div.empty', h('p', '조건에 맞는 출품작이 없습니다. 필터를 줄여 보세요.')));
      return;
    }
    const onCard = (c) => {
      if (view.selecting) { toggle(view.picked, c.id); draw(); } else openChar(c);
    };
    if (view.sort === 'rarity') {
      const groups = [6, 5, 4, 3, 2].map((r) => [r, list.filter((c) => c.rarity === r)]).filter(([, l]) => l.length);
      fill(grid, groups.map(([r, l]) => h('section.roster-group',
        h('h2', `${r}성`, h('small', `${l.filter((c) => chars[c.id]?.owned).length} / ${l.length} 보유`),
          view.selecting ? h('button.btn.small.ghost', { type: 'button', style: { marginLeft: 'auto' }, onclick: () => { l.forEach((c) => view.picked.add(c.id)); draw(); } }, `${r}성 모두 선택`) : null),
        h('div.card-grid', l.map((c) => card(c, onCard))),
      )));
    } else {
      fill(grid, h('div.card-grid', list.map((c) => card(c, onCard))));
    }
  }

  function quickOwn(v) {
    const ids = [...view.picked];
    store.update('roster', () => { for (const id of ids) store.ensureChar(id).owned = v; }, { silent: true });
    toast(`${ids.length}개를 ${v ? '보유' : '미보유'}로 바꿨어요.`);
    draw();
  }

  root.append(
    h('div.page-head',
      h('div', h('h1', h('span.en', 'Exhibits'), '출품작'), h('p', `출시된 출품작 ${total}점 중 ${owned}점 보유. 마도학자·인간·혼혈종을 모두 담았어요. 카드를 누르면 육성 상태를 ${editing ? '고칠' : '볼'} 수 있어요.`)),
    ),
    filterBar, chipsRow, bulkBar, grid,
  );
  draw();

  if (arg) {
    // 홈 등에서 #/roster/<id>로 들어온 경우: 주소를 되돌려 두어 다시 그릴 때 서랍이 또 열리지 않게
    history.replaceState(null, '', '#/roster');
    const c = store.charById(arg);
    if (c) setTimeout(() => openChar(c), 0);
  }
}

function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
function growth(r) { return (r.insight || 0) * 100 + (r.level || 0); }

function card(c, onClick) {
  const r = store.charRecord(c.id) || {};
  const picked = view.selecting && view.picked.has(c.id);
  const cls = ['ccard', afClass(c), r.owned ? '' : 'unowned', c.released ? '' : 'unreleased', picked ? 'picked' : ''].filter(Boolean).join('.');
  const psy = r.owned && r.psychube ? store.psyById(r.psychube) : null;
  const tun = r.owned && r.tuning ? (c.tunings || []).find((t) => t.id === r.tuning) : null;
  const eu = r.owned && r.euphoria ? (c.euphorias || []).find((e) => e.id === r.euphoria) : null;
  const statBits = r.owned ? [
    h('span.pill', `${ROMAN[r.insight || 0]}·${r.level || 1}`),
    h('span.pill', `공명 ${r.resonance || 1}`),
    h('span.pill' + ((r.portray || 0) >= 5 ? '.gold' : ''), `P${r.portray || 0}`),
  ] : [h('span.faint', '미보유')];
  return h('button.' + cls, { type: 'button', onclick: () => onClick(c), 'aria-pressed': view.selecting ? String(picked) : undefined,
    'aria-label': `${store.charName(c)} ${c.rarity}성 ${r.owned ? '보유' : '미보유'}` },
    h('div.art',
      h('i.af-bar'),
      h('span.stars', stars(c.rarity)),
      eu ? h('span.euph', { title: `광상 ${ROMAN[eu.id]} ${eu.name}` }, eu.icon ? img(eu.icon, '') : null, `${ROMAN[eu.id]}${r.euphoriaLevel ? '·' + r.euphoriaLevel : ''}`) : null,
      img(store.charPortrait(c), ''),
      h('span.cname', store.charName(c)),
      psy || tun ? h('span.gear',
        tun ? h('span.tun', { title: `공명변조: ${tun.name}` }, img(tun.icon, tun.name)) : null,
        psy ? h('span.psy', { title: psy.name.ko }, img(psy.icon, psy.name.ko)) : null) : null,
      view.selecting ? h('span.tick', { 'aria-hidden': 'true' }, picked ? '✓' : '') : null,
    ),
    h('div.cstats', statBits),
  );
}

/** 보유한 광상 번호 목록 (예전 기록 호환) */
function euphList(r) { return r.euphorias || (r.euphoria ? [r.euphoria] : []); }

export function openChar(c) {
  const editing = store.state.editing;
  const rec = store.charRecord(c.id) || {};
  const growthData = store.state.game.materials.growth[c.id];
  const maxRes = growthData?.resonance?.length ? Math.max(...growthData.resonance.map((x) => x.Id)) : (c.rarity >= 6 ? 15 : 10);
  const portrait = h('div.portrait', img(store.charPortrait(c), store.charName(c)));
  portrait.addEventListener('click', () => {
    const s = store.skinById(store.charRecord(c.id)?.skin || c.defaultSkin);
    if (s?.art) lightbox(s.art, `${store.charName(c)} — ${s.name}`);
  });

  const hero = h('div.char-hero', { class: afClass(c) },
    portrait,
    h('div.meta',
      h('div', h('span', { style: { color: 'var(--gold)' } }, stars(c.rarity))),
      h('div.tagline',
        h('span.tag.af', store.AFFLATUS[c.afflatus]),
        store.DMG[c.dmg] ? h('span.tag', store.DMG[c.dmg]) : null,
        c.euphoria ? h('span.tag', `광상 ${c.euphoria}종`) : null,
        c.released ? null : h('span.tag', '미출시'),
      ),
      h('div.faint', { style: { fontSize: '13px' } }, [c.name.en, c.name.ja, c.name.zhCN].filter(Boolean).join(' / ')),
    ),
  );

  let body;
  const foot = [];
  if (!editing) {
    body = [hero, readOnly(c, rec)];
  } else {
    const r = store.ensureChar(c.id);
    if (!r.euphorias && r.euphoria) r.euphorias = [r.euphoria];
    const upd = (fn) => store.update('roster', () => fn(store.ensureChar(c.id)), { silent: true });
    const maxIns = store.maxInsight(c.rarity);
    const levelInput = h('input', { type: 'number', min: 1, max: store.maxLevel(c.rarity, r.insight), value: r.level || 1, 'aria-label': '레벨',
      onchange: (e) => upd((x) => { x.level = clamp(+e.target.value, 1, store.maxLevel(c.rarity, x.insight)); e.target.value = x.level; }) });
    const ownedBox = h('input', { type: 'checkbox', checked: !!r.owned, onchange: (e) => upd((x) => { x.owned = e.target.checked; }) });

    const skinPick = h('div.skin-pick', c.skins.map((sid) => {
      const s = store.skinById(sid);
      const btn = h('button', { type: 'button', 'aria-pressed': String((r.skin || null) === sid || (!r.skin && sid === c.defaultSkin)), title: s?.name,
        onclick: () => {
          upd((x) => { x.skin = sid === c.defaultSkin ? null : sid; });
          skinPick.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          btn.setAttribute('aria-pressed', 'true');
          portrait.replaceChildren(img(s?.portrait, store.charName(c)));
        } }, img(s?.portrait, s?.name || ''), h('span', s?.type === 'default' ? '기본' : (s?.type === 'insight' ? '통찰' : s?.name || '')));
      return btn;
    }));

    const nameInput = h('input', { type: 'text', value: store.state.user.roster.nameOverrides[c.id] || '', placeholder: c.name.ko,
      onchange: (e) => store.update('roster', (s) => { const v = e.target.value.trim(); if (v) s.nameOverrides[c.id] = v; else delete s.nameOverrides[c.id]; }, { silent: true }) });

    body = [
      hero,
      h('div.form-row', h('label.check', ownedBox, '보유 중')),
      h('div.form-row', h('div.lbl', h('span', '통찰')),
        stepper(Array.from({ length: maxIns + 1 }, (_, i) => i), r.insight || 0, (v) => upd((x) => {
          x.insight = v; const mx = store.maxLevel(c.rarity, v); levelInput.max = mx; if (x.level > mx) { x.level = mx; levelInput.value = mx; }
        }), (v) => `통찰 ${ROMAN[v]}`, { aria: '통찰' })),
      h('div.fields.form-row',
        field('레벨', levelInput),
        field('공명', h('select', { onchange: (e) => upd((x) => { x.resonance = +e.target.value; }) },
          Array.from({ length: maxRes }, (_, i) => i + 1).map((v) => h('option', { value: v, selected: (r.resonance || 1) === v }, `공명 ${v}`)))),
      ),
      h('div.form-row', h('div.lbl', h('span', '형상')),
        stepper([0, 1, 2, 3, 4, 5], r.portray || 0, (v) => upd((x) => { x.portray = v; }), (v) => `P${v}`, { aria: '형상' })),
      c.tunings?.length ? h('div.form-row', h('div.lbl', h('span', '공명변조'), h('span.faint', '눌러서 해금 · ★ 대표')),
        iconPicker({
          items: c.tunings.filter((t) => t.id !== 0),
          has: (t) => (r.tunings || []).includes(t.id),
          main: (t) => r.tuning === t.id,
          onToggle: (t) => upd((x) => {
            const set = new Set(x.tunings || []);
            if (set.has(t.id)) { set.delete(t.id); if (x.tuning === t.id) x.tuning = [...set][0] ?? null; } else { set.add(t.id); x.tuning ??= t.id; }
            x.tunings = [...set];
          }),
          onMain: (t) => upd((x) => { const set = new Set(x.tunings || []); set.add(t.id); x.tunings = [...set]; x.tuning = t.id; }),
          get: () => store.charRecord(c.id),
        })) : null,
      c.euphorias?.length ? h('div.form-row', h('div.lbl', h('span', '광상'), h('span.faint', '눌러서 해금 · ★ 장착')),
        iconPicker({
          items: c.euphorias, wide: true,
          label: (e) => `광상 ${ROMAN[e.id]}${e.name ? ` · ${e.name}` : ''}`,
          has: (e) => euphList(store.charRecord(c.id) || {}).includes(e.id),
          main: (e) => (store.charRecord(c.id) || {}).euphoria === e.id,
          onToggle: (e) => upd((x) => {
            const set = new Set(euphList(x));
            if (set.has(e.id)) { set.delete(e.id); if (x.euphoria === e.id) { x.euphoria = [...set][0] || 0; if (!x.euphoria) x.euphoriaLevel = 0; } } else { set.add(e.id); if (!x.euphoria) x.euphoria = e.id; }
            x.euphorias = [...set].sort();
          }),
          onMain: (e) => upd((x) => { const set = new Set(euphList(x)); set.add(e.id); x.euphorias = [...set].sort(); x.euphoria = e.id; }),
          get: () => store.charRecord(c.id),
        }),
        h('div', { style: { height: '8px' } }),
        h('div.lbl', h('span', '장착한 광상 단계')),
        stepper([0, 1, 2, 3, 4], r.euphoriaLevel || 0, (v) => upd((x) => { x.euphoriaLevel = v; }), (v) => v ? `${v}단계` : '—', { aria: '광상 단계' }),
      ) : null,
      h('div.form-row', h('div.lbl', h('span', '장착 의지'), h('span.faint', '눌러서 장착 · 다시 누르면 해제')), psyGrid(r.psychube, (v) => upd((x) => { x.psychube = v; }))),
      h('div.fields.form-row',
        field('공명 스펙트럼 코드', h('input', { type: 'text', value: r.spectrum || '', placeholder: '예: 공명 코드 또는 배치 메모', onchange: (e) => upd((x) => { x.spectrum = e.target.value; }) }), 'wide'),
        field('메모', h('textarea', { rows: 3, onchange: (e) => upd((x) => { x.note = e.target.value; }) }, r.note || ''), 'wide'),
      ),
      h('div.form-row', h('div.lbl', h('span', '표시할 스킨')), skinPick),
      h('div.fields.form-row', field(c.nameChecked ? '한국어 이름 고치기' : '한국어 이름 (아직 확인 안 됨)', nameInput, 'wide')),
    ];
    foot.push(h('a.btn', { href: `#/plans/new/${c.id}`, onclick: () => d.close() }, '육성 계획 만들기'));
  }
  foot.push(h('button.btn.primary', { type: 'button', onclick: () => d.close() }, editing ? '완료' : '닫기'));
  const d = drawer({ title: store.charName(c), body, foot, wide: editing, onClose: () => rerender() });
}

/** 이미지 선택 묶음: 눌러서 켜고 끄기 + ★로 대표 고르기 */
function iconPicker({ items, has, main, onToggle, onMain, label, wide }) {
  const box = h('div.icon-pick' + (wide ? '.wide' : ''));
  const draw = () => fill(box, items.map((t) => {
    const on = has(t); const star = main(t);
    return h('div.ip' + (on ? '.on' : ''),
      h('button.ip-main', { type: 'button', 'aria-pressed': String(on), title: label ? label(t) : t.name, onclick: () => { onToggle(t); draw(); } },
        img(t.icon, ''), h('span', label ? label(t) : t.name)),
      h('button.ip-star' + (star ? '.is' : ''), { type: 'button', title: '대표로', 'aria-label': `${t.name || ''} 대표로`, 'aria-pressed': String(star), onclick: () => { onMain(t); draw(); } }, '★'),
    );
  }));
  draw();
  return box;
}

/** 의지 이미지 선택판 */
function psyGrid(value, onChange) {
  let cur = value || null;
  let q = ''; let onlyOwned = Object.values(store.state.user.psychubes.items).some((x) => x.owned);
  const mine = store.state.user.psychubes.items;
  const grid = h('div.psy-pick');
  const sel = h('div.psy-current');
  const drawCur = () => {
    const p = cur && store.psyById(cur);
    fill(sel, p ? [img(p.icon, ''), h('div', h('b', p.name.ko), h('span.faint', `${p.rarity}성${mine[p.id]?.owned ? ` · 증폭 ${mine[p.id].amp || 1}` : ''}`)),
      h('button.btn.small.ghost', { type: 'button', onclick: () => { cur = null; onChange(null); drawCur(); draw(); } }, '해제')]
      : h('span.faint', '장착한 의지가 없어요.'));
  };
  const draw = () => {
    const list = store.state.game.psychubes.filter((p) => p.rarity >= 4)
      .filter((p) => !onlyOwned || mine[p.id]?.owned || p.id === cur)
      .filter((p) => !q || Object.values(p.name).join(' ').toLowerCase().includes(q));
    fill(grid, list.length ? list.map((p) => h('button' + (mine[p.id]?.owned ? '' : '.no'), {
      type: 'button', title: `${p.name.ko} (${p.rarity}성)`, 'aria-pressed': String(p.id === cur),
      onclick: () => { cur = cur === p.id ? null : p.id; onChange(cur); drawCur(); draw(); },
    }, img(p.icon, p.name.ko), h('span', p.name.ko))) : h('p.faint', { style: { margin: 0, fontSize: '13px' } }, onlyOwned ? '보유한 의지가 없어요. "보유만"을 꺼 보세요.' : '없어요.'));
  };
  drawCur(); draw();
  return h('div',
    sel,
    h('div.toolbar', { style: { margin: '8px 0' } },
      h('div.grow', h('input', { type: 'search', placeholder: '의지 이름 검색', 'aria-label': '의지 검색', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } })),
      h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: onlyOwned, onchange: (e) => { onlyOwned = e.target.checked; draw(); } }), '보유만')),
    grid);
}

function readOnly(c, r) {
  if (!r.owned) return h('p.muted', '아직 보유하지 않은 출품작입니다.');
  const p = r.psychube && store.psyById(r.psychube);
  const tuns = (c.tunings || []).filter((t) => (r.tunings || []).includes(t.id));
  const eus = (c.euphorias || []).filter((e) => euphList(r).includes(e.id));
  const iconRow = (list, isMain, name) => h('div.icon-row', list.map((t) => h('span.ir' + (isMain(t) ? '.main' : ''), { title: name(t) }, img(t.icon, ''), h('span', name(t)))));
  const rows = [
    ['통찰 · 레벨', `통찰 ${ROMAN[r.insight || 0]} · ${r.level || 1}레벨`],
    ['공명', `${r.resonance || 1}`],
    ['형상', `P${r.portray || 0}`],
    tuns.length ? ['공명변조', iconRow(tuns, (t) => t.id === r.tuning, (t) => t.name)] : null,
    eus.length ? ['광상', iconRow(eus, (e) => e.id === r.euphoria, (e) => `광상 ${ROMAN[e.id]}${e.id === r.euphoria && r.euphoriaLevel ? ` ${r.euphoriaLevel}단계` : ''}`)] : null,
    ['의지', p ? h('span.icon-row', h('span.ir.main', img(p.icon, ''), h('span', p.name.ko))) : '없음'],
    r.spectrum ? ['공명 스펙트럼', r.spectrum] : null,
    r.modulation ? ['변조 메모', r.modulation] : null,
    r.note ? ['메모', r.note] : null,
  ].filter(Boolean);
  return h('dl.kv', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)]));
}

/** 여러 출품작에 한꺼번에 적용 */
function bulkEdit() {
  const ids = [...view.picked];
  const KEEP = '';
  const st = { owned: KEEP, insight: KEEP, level: KEEP, resonance: KEEP, portray: KEEP };
  const sel = (key, opts) => h('select', { onchange: (e) => { st[key] = e.target.value; } },
    h('option', { value: KEEP }, '바꾸지 않음'), opts.map(([v, t]) => h('option', { value: v }, t)));
  const body = [
    h('p.muted', { style: { marginTop: 0 } }, `선택한 ${ids.length}개에 적용합니다. "바꾸지 않음"인 항목은 그대로 둬요. 출품작마다 최대치가 다르면 각자의 최대치까지만 올라가요.`),
    h('div.fields',
      field('보유', sel('owned', [['1', '보유'], ['0', '미보유']])),
      field('통찰', sel('insight', [['0', '통찰 0'], ['1', '통찰 Ⅰ'], ['2', '통찰 Ⅱ'], ['3', '통찰 Ⅲ'], ['max', '각자 최대']])),
      field('레벨', sel('level', [['1', '1'], ['max', '현재 통찰의 최대 레벨'], ...[10, 20, 30, 40, 50, 60].map((v) => [String(v), `${v}`])])),
      field('공명', sel('resonance', [...Array.from({ length: 15 }, (_, i) => [String(i + 1), `공명 ${i + 1}`]), ['max', '각자 최대']])),
      field('형상', sel('portray', [0, 1, 2, 3, 4, 5].map((v) => [String(v), `P${v}`]))),
    ),
    h('div', { style: { marginTop: '14px' } }, h('div.faces', ids.slice(0, 40).map((id) => h('span.face', { title: store.charName(store.charById(id)) }, img(store.charPortrait(store.charById(id)), ''))))),
  ];
  const apply = () => {
    const changed = Object.values(st).some((v) => v !== KEEP);
    if (!changed) { toast('바꿀 항목을 골라 주세요.', 'err'); return; }
    store.update('roster', () => {
      for (const id of ids) {
        const c = store.charById(id); const x = store.ensureChar(id);
        if (st.owned !== KEEP) x.owned = st.owned === '1';
        else if ([st.insight, st.level, st.resonance, st.portray].some((v) => v !== KEEP)) x.owned = true; // 육성 값을 넣으면 보유로
        if (st.insight !== KEEP) x.insight = st.insight === 'max' ? store.maxInsight(c.rarity) : Math.min(+st.insight, store.maxInsight(c.rarity));
        const mxLv = store.maxLevel(c.rarity, x.insight || 0);
        if (st.level !== KEEP) x.level = st.level === 'max' ? mxLv : Math.min(+st.level, mxLv);
        else if (x.level > mxLv) x.level = mxLv;
        if (st.resonance !== KEEP) {
          const g = store.state.game.materials.growth[id];
          const mxRes = g?.resonance?.length ? Math.max(...g.resonance.map((y) => y.Id)) : (c.rarity >= 6 ? 15 : 10);
          x.resonance = st.resonance === 'max' ? mxRes : Math.min(+st.resonance, mxRes);
        }
        if (st.portray !== KEEP) x.portray = +st.portray;
      }
    }, { silent: true });
    toast(`${ids.length}개에 적용했어요. 저장 버튼을 눌러야 저장소에 반영돼요.`);
    d.close();
  };
  const d = drawer({ title: '일괄 적용', body, foot: [h('button.btn', { type: 'button', onclick: () => d.close() }, '취소'), h('button.btn.primary', { type: 'button', onclick: apply }, '적용')], onClose: () => rerender() });
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, Number.isFinite(v) ? v : a)); }

async function doImport() {
  const f = await pickFile('application/json,.json');
  if (!f) return;
  try {
    const text = await readFileText(f);
    const res = importRosterJSON(JSON.parse(text));
    toast(`가져오기 완료: ${res.matched}개 반영${res.unmatched.length ? `, 이름을 못 찾은 항목 ${res.unmatched.length}개 (${res.unmatched.slice(0, 5).join(', ')}${res.unmatched.length > 5 ? ' …' : ''})` : ''}`);
  } catch (e) {
    toast(`가져오지 못했습니다: ${e.message}`, 'err');
  }
}
