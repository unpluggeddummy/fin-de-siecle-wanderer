// 여러 화면에서 함께 쓰는 조각
import { h, img, drawer } from './ui.js';
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
    if (!c) return h('div.slot.empty-slot', '빈칸');
    const p = m.psychube && store.psyById(m.psychube);
    return h('div.slot', { title: store.charName(c) + (p ? ` · ${p.name.ko}` : '') },
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
        next[i].psychube = store.psyList(store.charRecord(patch.char))[0] || null; // 출품작에 장착한 의지를 기본값으로
      }
      onChange(next);
    };
    return h('div.slot-row',
      mini,
      charSelect(m.char, (v) => set({ char: v }), { label: `${i + 1}번 자리 출품작` }),
      psySelect(m.psychube, (v) => set({ psychube: v }), { label: `${i + 1}번 자리 의지` }),
    );
  });
  return h('div.slot-edit', h('p.faint', { style: { margin: 0, fontSize: '12.5px' } }, '1~4번 모두 출전합니다.'), rows);
}

export function stars(n) { return '★'.repeat(n); }

export function afClass(c) { return 'af-' + (c?.afflatus || 'unknown'); }

/** 영감 아이콘 */
export function afImg(key, cls = 'af-ico') { const src = store.afIcon(key); return src ? h('img.' + cls, { src, alt: store.AFFLATUS[key], title: store.AFFLATUS[key] }) : null; }

export function insightLabel(n) { return ['통찰 0', '통찰 Ⅰ', '통찰 Ⅱ', '통찰 Ⅲ'][n] || `통찰 ${n}`; }
export const ROMAN = ['0', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];

/**
 * 출품작 이미지 선택 창.
 * charPicker({ title, multi, selected: [ids], min, npc, onDone(ids) })
 * npc: true면 'NPC도 보기' 스위치가 생긴다 (기본은 꺼짐 — 필요할 때만 켜서 고른다)
 */
export function charPicker({ title = '출품작 고르기', multi = false, selected = [], min = 1, npc = false, onDone }) {
  const pick = new Set(selected.filter(Boolean));
  let q = '';
  let ownedOnly = false;
  let showNpc = npc && [...pick].some(store.isNpcId);
  const grid = h('div.char-pick');
  const countEl = h('span.faint');
  const draw = () => {
    const rec = store.state.user.roster.chars;
    const list = store.state.game.characters
      .filter((c) => c.released || rec[c.id]?.owned)
      .filter((c) => !ownedOnly || rec[c.id]?.owned)
      .concat(store.npcList().filter((n) => pick.has(n.id) || (showNpc && !ownedOnly)))
      .filter((c) => !q || [store.charName(c), ...Object.values(c.name)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (pick.has(b.id) - pick.has(a.id)) || (!!a.npc - !!b.npc) || b.rarity - a.rarity || store.charName(a).localeCompare(store.charName(b), 'ko'));
    grid.replaceChildren(...list.map((c) => h('button', {
      type: 'button', class: afClass(c), 'aria-pressed': String(pick.has(c.id)), title: store.charName(c),
      onclick: () => {
        if (multi) { pick.has(c.id) ? pick.delete(c.id) : pick.add(c.id); draw(); } else { onDone([c.id]); d.close(); }
      },
    }, img(store.charPortrait(c), ''), h('span', store.charName(c)), c.npc ? h('em.npc-tag', 'NPC') : null, multi && pick.has(c.id) ? h('i.order', [...pick].indexOf(c.id) + 1) : null)));
    countEl.textContent = multi ? `${pick.size}개 선택` : '';
  };
  const body = [
    h('div.toolbar', { style: { marginBottom: '10px' } },
      h('div.grow', h('input', { type: 'search', placeholder: '이름 검색', 'aria-label': '출품작 검색', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } })),
      h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', onchange: (e) => { ownedOnly = e.target.checked; draw(); } }), '보유만'),
      npc && store.npcList().length ? h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: showNpc, onchange: (e) => { showNpc = e.target.checked; draw(); } }), 'NPC도 보기') : null,
      countEl),
    grid,
  ];
  const foot = multi ? [
    h('button.btn', { type: 'button', onclick: () => d.close() }, '취소'),
    h('button.btn.primary', { type: 'button', onclick: () => {
      if (pick.size < min) { countEl.textContent = `${min}개 이상 골라 주세요`; return; }
      onDone([...pick]); d.close();
    } }, '확인'),
  ] : [h('button.btn', { type: 'button', onclick: () => d.close() }, '취소')];
  draw();
  const d = drawer({ title, body, foot, wide: true });
  return d;
}

/** 출품작 프로필 (위키·게임 데이터): 소개, 생일, 출신, 활동 시기, 매개, 영감, 성우, 생일 이야기 */
export function profileBlock(c, { open = false } = {}) {
  const p = store.profileOf(c.id);
  if (!p) return null;
  const b = store.birthdayOf(c.id);
  const CV = [['kor', '한국어'], ['jpn', '일본어'], ['eng', '영어'], ['zho', '중국어']];
  const row = (k, v, small) => (v ? [h('dt', k), h('dd', v, small ? h('small.faint', ` ${small}`) : null)] : null);
  return h('section.profile-block',
    h('div.profile-top',
      p.chibi ? h('img.profile-chibi', { src: p.chibi, alt: '', loading: 'lazy' }) : null,
      h('div',
        h('p.code', 'Profile'),
        p.intro ? h('p.profile-intro', p.intro) : null,
        p.exhibit ? h('p.profile-exhibit', p.exhibit) : null,
        h('dl.profile-dl',
          row('생일', b ? `${b.m}월 ${b.d}일` : null),
          row('키', p.heightCm ? `${p.heightCm}cm` : null, p.size ? `(규격 ${p.size})` : null),
          row('출신', p.origin),
          row('활동 시기', p.debut),
          row('분류', p.role),
          row('매개체', p.medium, p.mediumEn && p.medium !== p.mediumEn ? p.mediumEn : null),
          row('영감', p.inspiration),
          row('조향 노트', p.scent),
        ))),
    Object.keys(p.cv || {}).length ? h('dl.profile-dl.cv', h('dt', '성우'), h('dd', CV.filter(([k]) => p.cv[k]).map(([k, l]) => h('span.cv', h('small.faint', l), ' ', p.cv[k])))) : null,
    p.bdayStories?.length ? h('details.profile-bday', { open },
      h('summary', `생일 이야기 ${p.bdayStories.length}편`),
      h('ol', p.bdayStories.map((t) => h('li', t)))) : null,
    p.wiki ? h('p.faint', { style: { fontSize: '12px', margin: '8px 0 0' } }, '출처: ', h('a', { href: p.wiki, target: '_blank', rel: 'noopener' }, 'Reverse: 1999 Wiki'), ' · 게임 데이터') : null,
  );
}

/** 스킬·통찰·형상·광상 — 출품작 하나로 캐릭터를 분석할 수 있게 (게임 데이터 한국어) */
export function skillBlock(c) {
  const box = h('section.skill-block', h('p.code', 'Skills'), h('p.faint', '스킬 정보를 불러오는 중…'));
  store.loadSkills().then((d) => {
    const s = d.chars?.[c.id];
    if (!s) { box.replaceChildren(h('p.code', 'Skills'), h('p.faint', { style: { fontSize: '13px' } }, '아직 스킬 정보가 없어요. (글로벌에 나오기 전인 출품작은 비어 있어요)')); return; }
    const rec = store.charRecord(c.id) || {};
    const owned = !!rec.owned;
    const gl = d.glossary || {};
    // [용어]를 눌러 뜻을 볼 수 있게
    const text = (t) => {
      const out = [];
      const re = /\[([^\]]{1,20})\]/g;
      let last = 0; let m;
      while ((m = re.exec(t || ''))) {
        out.push(t.slice(last, m.index));
        const term = m[1].trim();
        out.push(gl[term] ? h('button.kw', { type: 'button', title: gl[term], onclick: (e) => {
          const p = e.currentTarget.closest('.sk-text');
          const old = p.querySelector('.kw-pop');
          if (old && old.dataset.term === term) { old.remove(); return; }
          old && old.remove();
          p.append(h('span.kw-pop', { 'data-term': term }, h('b', term), ' ', gl[term]));
        } }, term) : h('span.kw-plain', `[${term}]`));
        last = re.lastIndex;
      }
      out.push((t || '').slice(last));
      return h('div.sk-text', out);
    };
    const lvTabs = (levels) => {
      let cur = levels.length - 1;
      const body = h('div');
      const bar = h('div.sk-lv', levels.map((_, i) => h('button', { type: 'button', 'aria-pressed': String(i === cur), onclick: (e) => {
        cur = i; bar.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i))); body.replaceChildren(text(levels[i]));
      } }, '★'.repeat(i + 1))));
      body.append(text(levels[cur]));
      return [bar, body];
    };
    const ROM = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];
    box.replaceChildren(
      h('p.code', 'Skills'),
      h('div.sk-grid',
        s.skills.map((k, i) => h('div.sk-card', h('header', h('span.sk-tag', `주문 ${i + 1}`), h('b', k.name)), ...lvTabs(k.levels))),
        s.ultimate ? h('div.sk-card.ult', h('header', h('span.sk-tag', '최종 술식'), h('b', s.ultimate.name)), text(s.ultimate.desc)) : null),
      s.insight.length ? h('div.sk-sec', h('h4', '통찰 패시브', owned ? h('small', ` 지금 통찰 ${ROM[rec.insight || 0] || 0}`) : null),
        h('ol.sk-steps', s.insight.map((p) => h('li', { class: owned && (rec.insight || 0) >= p.lv ? 'on' : '' },
          h('span.sk-step', `통찰 ${ROM[p.lv]}`), h('div', h('b', p.name), text(p.desc)))))) : null,
      s.portray.length ? h('div.sk-sec', h('h4', '형상 (중복 획득 강화)', owned ? h('small', ` 지금 P${rec.portray || 0}`) : null),
        h('ol.sk-steps', s.portray.map((p) => h('li', { class: owned && (rec.portray || 0) >= p.lv ? 'on' : '' },
          h('span.sk-step', `P${p.lv}`), text(p.desc))))) : null,
      s.euphoria.length ? h('div.sk-sec', h('h4', '광상'),
        s.euphoria.map((e) => {
          const eu = (c.euphorias || []).find((x) => x.id === e.id);
          const mine = owned && rec.euphoria === e.id;
          return h('div.sk-euph', h('b', `광상 ${ROM[e.id] || e.id}`, eu?.name ? ` · ${eu.name}` : '', mine ? h('small', ` 장착 중 · ${rec.euphoriaLevel || 0}단계`) : null),
            h('ol.sk-steps', e.levels.map((l) => h('li', { class: mine && (rec.euphoriaLevel || 0) >= l.lv ? 'on' : '' }, h('span.sk-step', `${l.lv}단계`), text(l.desc)))));
        })) : null,
      h('p.faint', { style: { fontSize: '12px', margin: '8px 0 0' } }, '[ ]로 표시된 용어를 누르면 뜻이 나와요. 출처: 게임 데이터(글로벌 한국어).'),
    );
  });
  return box;
}
