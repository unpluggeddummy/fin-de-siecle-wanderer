// 여러 화면에서 함께 쓰는 조각
import { h, img } from './ui.js';
import * as store from './store.js';

export function face(charId, skinId) {
  const c = store.charById(charId);
  return h('span.face', { title: store.charName(c) }, img(store.charPortrait(c, skinId), store.charName(c)));
}

/** 캐릭터 선택 <select> (보유 캐릭터 우선) */
export function charSelect(value, onChange, { allowEmpty = true, ownedFirst = true, label = '출품작 선택' } = {}) {
  const chars = [...store.state.game.characters].filter((c) => c.released || store.charRecord(c.id)?.owned);
  const owned = chars.filter((c) => store.charRecord(c.id)?.owned);
  const rest = chars.filter((c) => !store.charRecord(c.id)?.owned);
  const opt = (c) => h('option', { value: c.id, selected: +value === c.id }, `${store.charName(c)} (${c.rarity}성)`);
  const sel = h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value ? +e.target.value : null) },
    allowEmpty ? h('option', { value: '' }, '— 비어 있음 —') : null,
    ownedFirst && owned.length ? h('optgroup', { label: '보유' }, owned.map(opt)) : null,
    h('optgroup', { label: ownedFirst && owned.length ? '미보유' : '전체' }, (ownedFirst && owned.length ? rest : chars).map(opt)),
  );
  return sel;
}

/** 의지 선택 <select> (보유 의지 우선) */
export function psySelect(value, onChange, { label = '의지 선택' } = {}) {
  const all = store.state.game.psychubes.filter((p) => p.rarity >= 4 && !p.refine);
  const mine = store.state.user.psychubes.items;
  const owned = all.filter((p) => mine[p.id]?.owned);
  const rest = all.filter((p) => !mine[p.id]?.owned);
  const opt = (p) => h('option', { value: p.id, selected: +value === p.id }, `${p.name.ko} (${p.rarity}성)`);
  return h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value ? +e.target.value : null) },
    h('option', { value: '' }, '— 의지 없음 —'),
    owned.length ? h('optgroup', { label: '보유' }, owned.map(opt)) : null,
    h('optgroup', { label: owned.length ? '미보유' : '전체' }, rest.map(opt)),
  );
}

/** 4칸 팀 표시 (읽기용) */
export function teamView(members = []) {
  const slots = [0, 1, 2, 3].map((i) => {
    const m = members[i];
    const c = m && store.charById(m.char);
    if (!c) return h('div.slot.empty-slot', i === 3 ? '후보' : '빈칸');
    const p = m.psychube && store.psyById(m.psychube);
    return h('div.slot' + (i === 3 ? '.sub' : ''), { title: store.charName(c) + (p ? ` · ${p.name.ko}` : '') },
      img(store.charPortrait(c), store.charName(c), 'c'),
      p ? img(p.icon, p.name.ko, 'p') : null,
      h('span.sn', store.charName(c)),
    );
  });
  return h('div.team', slots);
}

/** 4칸 팀 편집 */
export function teamEditor(members, onChange) {
  const rows = [0, 1, 2, 3].map((i) => {
    const m = members[i] || { char: null, psychube: null };
    const mini = h('div.mini', m.char ? img(store.charPortrait(store.charById(m.char)), '') : null);
    const set = (patch) => {
      const next = [...members];
      next[i] = { ...m, ...patch };
      if (patch.char !== undefined && patch.char && !next[i].psychube) {
        next[i].psychube = store.charRecord(patch.char)?.psychube || null; // 캐릭터에 장착한 의지를 기본값으로
      }
      onChange(next);
    };
    return h('div.slot-row',
      mini,
      charSelect(m.char, (v) => set({ char: v }), { label: `${i + 1}번 자리 출품작` }),
      psySelect(m.psychube, (v) => set({ psychube: v }), { label: `${i + 1}번 자리 의지` }),
    );
  });
  return h('div.slot-edit', h('p.faint', { style: { margin: 0, fontSize: '12.5px' } }, '1~3번은 출전, 4번은 후보입니다.'), rows);
}

export function stars(n) { return '★'.repeat(n); }

export function afClass(c) { return 'af-' + (c?.afflatus || 'unknown'); }

export function insightLabel(n) { return ['통찰 0', '통찰 Ⅰ', '통찰 Ⅱ', '통찰 Ⅲ'][n] || `통찰 ${n}`; }
export const ROMAN = ['0', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];
