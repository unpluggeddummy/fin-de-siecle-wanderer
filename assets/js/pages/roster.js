import { h, img, drawer, stepper, chip, field, toast, pickFile, readFileText, lightbox } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { stars, afClass, ROMAN } from '../components.js';
import { importRosterJSON } from '../importer.js';

const AF_ORDER = ['star', 'mineral', 'beast', 'plant', 'spirit', 'intellect'];
const view = {
  q: '', rarity: new Set(), af: new Set(), own: 'all', euph: false, unreleased: false, sort: 'rarity',
};

export function render(root, { arg }) {
  const { characters } = store.state.game;
  const chars = store.state.user.roster.chars;
  const editing = store.state.editing;

  const total = characters.filter((c) => c.released).length;
  const owned = characters.filter((c) => chars[c.id]?.owned).length;

  const search = h('input', {
    type: 'search', placeholder: '이름 검색 (한국어·영어·일본어·중국어)', value: view.q, 'aria-label': '출품작 검색',
    oninput: (e) => { view.q = e.target.value; draw(); },
  });

  const filterBar = h('div.toolbar',
    h('div.grow', search),
    h('select', { 'aria-label': '정렬', onchange: (e) => { view.sort = e.target.value; draw(); } },
      [['rarity', '성급별'], ['name', '이름순'], ['resonance', '공명 높은 순'], ['portray', '형상 높은 순'], ['level', '육성 높은 순']]
        .map(([v, t]) => h('option', { value: v, selected: view.sort === v }, t))),
    h('button.btn.edit-only', { type: 'button', onclick: doImport }, '시뮬레이터 JSON 가져오기'),
  );

  const chipsRow = h('div.toolbar');
  const grid = h('div');

  function chips() {
    const own = [['all', '전체'], ['owned', '보유'], ['missing', '미보유']];
    chipsRow.replaceChildren(
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

  function draw() {
    chips();
    const list = sorted(filtered());
    if (!list.length) {
      grid.replaceChildren(h('div.empty', h('p', '조건에 맞는 출품작이 없습니다. 필터를 줄여 보세요.')));
      return;
    }
    if (view.sort === 'rarity') {
      const groups = [6, 5, 4, 3, 2].map((r) => [r, list.filter((c) => c.rarity === r)]).filter(([, l]) => l.length);
      grid.replaceChildren(...groups.map(([r, l]) => h('section.roster-group',
        h('h2', `${r}성`, h('small', `${l.filter((c) => chars[c.id]?.owned).length} / ${l.length} 보유`)),
        h('div.card-grid', l.map(card)),
      )));
    } else {
      grid.replaceChildren(h('div.card-grid', list.map(card)));
    }
  }

  root.append(
    h('div.page-head',
      h('div', h('h1', h('span.en', 'Exhibits'), '출품작'), h('p', `출시된 출품작 ${total}점 중 ${owned}점 보유. 마도학자·인간·혼혈종을 모두 담았어요. 카드를 누르면 육성 상태를 ${editing ? '고칠' : '볼'} 수 있어요.`)),
    ),
    filterBar, chipsRow, grid,
  );
  draw();

  if (arg) { const c = store.charById(arg); if (c) openChar(c); }
}

function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
function growth(r) { return (r.insight || 0) * 100 + (r.level || 0); }

function card(c) {
  const r = store.charRecord(c.id) || {};
  const cls = ['ccard', afClass(c), r.owned ? '' : 'unowned', c.released ? '' : 'unreleased'].filter(Boolean).join('.');
  const statBits = r.owned ? [
    h('span.pill', `${ROMAN[r.insight || 0]}·${r.level || 1}`),
    h('span.pill', `공명 ${r.resonance || 1}`),
    h('span.pill' + ((r.portray || 0) >= 5 ? '.gold' : ''), `P${r.portray || 0}`),
    r.psychube ? h('span', { title: store.psyById(r.psychube)?.name.ko }, img(store.psyById(r.psychube)?.icon, '', null)) : null,
  ] : [h('span.faint', '미보유')];
  // 의지 아이콘은 작게
  const statsEl = h('div.cstats', statBits);
  statsEl.querySelectorAll('img').forEach((i) => { i.style.width = '18px'; i.style.height = '18px'; });
  return h('button.' + cls, { type: 'button', onclick: () => openChar(c), 'aria-label': `${store.charName(c)} ${c.rarity}성 ${r.owned ? '보유' : '미보유'}` },
    h('div.art',
      h('i.af-bar'),
      h('span.stars', stars(c.rarity)),
      r.owned && r.euphoria ? h('span.euph', `광상 ${ROMAN[r.euphoria]}${r.euphoriaLevel ? '·' + r.euphoriaLevel : ''}`) : null,
      img(store.charPortrait(c), ''),
      h('span.cname', store.charName(c)),
    ),
    statsEl,
  );
}

export function openChar(c) {
  const editing = store.state.editing;
  const rec = store.charRecord(c.id) || {};
  const growthData = store.state.game.materials.growth[c.id];
  const maxRes = growthData?.resonance?.length ? Math.max(...growthData.resonance.map((x) => x.Id)) : (c.rarity >= 6 ? 15 : 10);
  const portrait = h('div.portrait', img(store.charPortrait(c), store.charName(c)));
  portrait.addEventListener('click', () => {
    const s = store.skinById(rec.skin || c.defaultSkin);
    if (s?.art) lightbox(s.art, `${store.charName(c)} — ${s.name}`);
  });

  const hero = h('div.char-hero', { class: afClass(c) },
    portrait,
    h('div.meta',
      h('div', h('span', { style: { color: 'var(--brass-bright)' } }, stars(c.rarity))),
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
    const upd = (fn) => store.update('roster', () => fn(store.ensureChar(c.id)), { silent: true });
    const maxIns = store.maxInsight(c.rarity);
    const levelInput = h('input', { type: 'number', min: 1, max: store.maxLevel(c.rarity, r.insight), value: r.level || 1, 'aria-label': '레벨',
      onchange: (e) => upd((x) => { x.level = clamp(+e.target.value, 1, store.maxLevel(c.rarity, x.insight)); e.target.value = x.level; }) });
    const ownedBox = h('input', { type: 'checkbox', checked: !!r.owned, onchange: (e) => upd((x) => { x.owned = e.target.checked; }) });

    const skinIds = c.skins;
    const skinPick = h('div.skin-pick', skinIds.map((sid) => {
      const s = store.skinById(sid);
      const btn = h('button', { type: 'button', 'aria-pressed': String((r.skin || null) === sid || (!r.skin && sid === c.defaultSkin)), title: s?.name,
        onclick: () => {
          upd((x) => { x.skin = sid === c.defaultSkin ? null : sid; });
          skinPick.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          btn.setAttribute('aria-pressed', 'true');
          portrait.replaceChildren(img(s?.portrait, store.charName(c)));
        } }, img(s?.portrait, s?.name || ''));
      return btn;
    }));

    const euphRow = c.euphoria ? h('div.form-row',
      h('div.lbl', h('span', '광상'), h('span.faint', '해금한 광상과 단계')),
      stepper([0, ...Array.from({ length: c.euphoria }, (_, i) => i + 1)], r.euphoria || 0, (v) => upd((x) => { x.euphoria = v; if (!v) x.euphoriaLevel = 0; }),
        (v) => v ? `광상 ${ROMAN[v]}` : '없음', { aria: '광상 종류' }),
      h('div', { style: { height: '6px' } }),
      stepper([0, 1, 2, 3, 4], r.euphoriaLevel || 0, (v) => upd((x) => { x.euphoriaLevel = v; }), (v) => v ? `${v}단계` : '—', { aria: '광상 단계' }),
    ) : null;

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
      euphRow,
      h('div.form-row', field('장착 의지', psyPicker(r.psychube, (v) => upd((x) => { x.psychube = v; })))),
      h('div.fields.form-row',
        field('공명 스펙트럼 코드', h('input', { type: 'text', value: r.spectrum || '', placeholder: '예: 공명 코드 또는 배치 메모', onchange: (e) => upd((x) => { x.spectrum = e.target.value; }) }), 'wide'),
        field('변조', h('input', { type: 'text', value: r.modulation || '', placeholder: '예: 이해 — 술식 위력', onchange: (e) => upd((x) => { x.modulation = e.target.value; }) }), 'wide'),
        field('메모', h('textarea', { rows: 3, onchange: (e) => upd((x) => { x.note = e.target.value; }) }, r.note || ''), 'wide'),
      ),
      h('div.form-row', h('div.lbl', h('span', '표시할 스킨')), skinPick),
      h('div.fields.form-row', field(c.nameChecked ? '한국어 이름 고치기' : '한국어 이름 (아직 확인 안 됨)', nameInput, 'wide')),
    ];
    foot.push(h('a.btn', { href: `#/plans/new/${c.id}`, onclick: () => d.close() }, '육성 계획 만들기'));
  }
  foot.push(h('button.btn.primary', { type: 'button', onclick: () => d.close() }, editing ? '완료' : '닫기'));
  const d = drawer({ title: store.charName(c), body, foot, onClose: () => rerender() });
}

function psyPicker(value, onChange) {
  const all = store.state.game.psychubes.filter((p) => p.rarity >= 4);
  const mine = store.state.user.psychubes.items;
  const owned = all.filter((p) => mine[p.id]?.owned);
  const rest = all.filter((p) => !mine[p.id]?.owned);
  const opt = (p) => h('option', { value: p.id, selected: +value === p.id }, `${p.name.ko} (${p.rarity}성)`);
  return h('select', { onchange: (e) => onChange(e.target.value ? +e.target.value : null) },
    h('option', { value: '' }, '— 없음 —'),
    owned.length ? h('optgroup', { label: '보유한 의지' }, owned.map(opt)) : null,
    h('optgroup', { label: owned.length ? '그 밖의 의지' : '전체' }, rest.map(opt)));
}

function readOnly(c, r) {
  if (!r.owned) return h('p.muted', '아직 보유하지 않은 출품작입니다.');
  const p = r.psychube && store.psyById(r.psychube);
  const rows = [
    ['통찰 · 레벨', `통찰 ${ROMAN[r.insight || 0]} · ${r.level || 1}레벨`],
    ['공명', `${r.resonance || 1}`],
    ['형상', `P${r.portray || 0}`],
    c.euphoria ? ['광상', r.euphoria ? `광상 ${ROMAN[r.euphoria]}${r.euphoriaLevel ? ` ${r.euphoriaLevel}단계` : ''}` : '없음'] : null,
    ['의지', p ? p.name.ko : '없음'],
    r.spectrum ? ['공명 스펙트럼', r.spectrum] : null,
    r.modulation ? ['변조', r.modulation] : null,
    r.note ? ['메모', r.note] : null,
  ].filter(Boolean);
  return h('dl.kv', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)]));
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, Number.isFinite(v) ? v : a)); }

async function doImport() {
  const f = await pickFile('application/json,.json');
  if (!f) return;
  try {
    const text = await readFileText(f);
    const res = importRosterJSON(JSON.parse(text));
    toast(`가져오기 완료: ${res.matched}명 반영${res.unmatched.length ? `, 이름을 못 찾은 항목 ${res.unmatched.length}개 (${res.unmatched.slice(0, 5).join(', ')}${res.unmatched.length > 5 ? ' …' : ''})` : ''}`);
  } catch (e) {
    toast(`가져오지 못했습니다: ${e.message}`, 'err');
  }
}
