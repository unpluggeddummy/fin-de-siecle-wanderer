// 도감 — 생일 달력 · NPC · 모집 배너
// #/codex/birthdays  #/codex/npcs  #/codex/summons
import { h, img, chip, drawer, lightbox, fill, closeDrawer } from '../ui.js';
import * as store from '../store.js';
import { afClass, profileBlock } from '../components.js';
import { summonCard } from './timeline.js';

const TABS = [['birthdays', '생일 달력', 'Birthdays'], ['npcs', 'NPC', 'Characters'], ['summons', '모집 배너', 'Summons']];
const view = { npcQ: '', npcKo: false, suQ: '', suLimited: true, suMine: false, month: null };

export function render(root, { arg } = {}) {
  const tab = TABS.find(([k]) => k === (arg || '').split('/')[0])?.[0] || 'birthdays';
  root.append(
    h('div.page-head', h('div', h('h1', h('span.en', 'Codex'), '도감'),
      h('p', '출품작 생일과 프로필, 스토리 속 NPC, 지금까지의 모집 배너를 모아 봐요.'))),
    h('nav.codex-tabs', { 'aria-label': '도감 분류' }, TABS.map(([k, ko, en]) => h('a', { href: `#/codex/${k}`, 'aria-current': k === tab ? 'page' : null }, ko, h('small', en)))),
  );
  if (tab === 'birthdays') birthdays(root);
  if (tab === 'npcs') npcs(root);
  if (tab === 'summons') summons(root);
}

// ── 생일 달력 ───────────────────────────────────────────
export function upcomingBirthdays(n = 6, from = new Date()) {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const list = store.state.game.characters.filter((c) => c.released && store.birthdayOf(c.id)).map((c) => {
    const b = store.birthdayOf(c.id);
    let d = new Date(today.getFullYear(), b.m - 1, b.d);
    if (d < today) d = new Date(today.getFullYear() + 1, b.m - 1, b.d);
    return { c, b, days: Math.round((d - today) / 864e5) };
  });
  return list.sort((a, b) => a.days - b.days || b.c.rarity - a.c.rarity).slice(0, n);
}

export function openProfile(c) {
  const b = store.birthdayOf(c.id);
  drawer({ title: store.charName(c), wide: false,
    body: [h('div.pp-head', { class: afClass(c) }, img(store.charPortrait(c), ''), h('div', h('b', store.charName(c)), h('small.faint', [c.name.en, b ? `${b.m}월 ${b.d}일` : null].filter(Boolean).join(' · ')))),
      profileBlock(c, { open: true }) || h('p.muted', '프로필 정보가 없어요.')],
    foot: [h('a.btn', { href: `#/roster/${c.id}`, onclick: () => closeDrawer() }, '출품작 화면'), h('button.btn.primary', { type: 'button', onclick: () => closeDrawer() }, '닫기')] });
}

function birthdays(root) {
  const now = new Date();
  const owned = store.state.user.roster.chars;
  const up = upcomingBirthdays(8);
  root.append(h('section.panel.bday-next', h('h3', '다가오는 생일'),
    h('div.bday-strip', up.map(({ c, b, days }) => h('button.bday-chip', { type: 'button', class: afClass(c) + (days === 0 ? ' today' : ''), onclick: () => openProfile(c) },
      img(store.charPortrait(c), ''), h('b', store.charName(c)), h('small', days === 0 ? '오늘!' : `${b.m}/${b.d} · D-${days}`))))));

  const byMonth = Array.from({ length: 12 }, () => []);
  for (const c of store.state.game.characters) {
    const b = c.released && store.birthdayOf(c.id);
    if (b) byMonth[b.m - 1].push({ c, b });
  }
  root.append(h('div.bday-cal', byMonth.map((l, i) => h('section.bday-month', { class: i === now.getMonth() ? 'now' : '' },
    h('h3', h('span.num', String(i + 1).padStart(2, '0')), `${i + 1}월`, h('small', `${l.length}명`)),
    h('ul', l.sort((a, b) => a.b.d - b.b.d || b.c.rarity - a.c.rarity).map(({ c, b }) => h('li',
      h('button', { type: 'button', class: afClass(c) + (owned[c.id]?.owned ? ' own' : '') + (b.m === now.getMonth() + 1 && b.d === now.getDate() ? ' today' : ''), onclick: () => openProfile(c) },
        h('span.d', b.d), img(store.charPortrait(c), ''), h('span.n', store.charName(c))))))))));
  root.append(h('p.faint.story-src', '생일·생일 이야기: 게임 데이터 (글로벌에 아직 없는 출품작은 Reverse: 1999 Wiki). 보유한 출품작은 밝게 보여요.'));
}

// ── NPC ─────────────────────────────────────────────────
function npcs(root) {
  const list = store.npcList();
  const grid = h('div.npc-grid');
  root.append(h('div.toolbar',
    h('div.grow', h('input', { type: 'search', placeholder: '이름·소속 검색 (한/영/중/일)', value: view.npcQ, 'aria-label': 'NPC 검색', oninput: (e) => { view.npcQ = e.target.value; draw(); } })),
    h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: view.npcKo, onchange: (e) => { view.npcKo = e.target.checked; draw(); } }), '한국어 이름 있는 것만'),
    h('span.faint', { style: { fontSize: '13px' } }, `${list.length}명`)), grid);
  function draw() {
    const q = view.npcQ.trim().toLowerCase();
    const l = list.filter((n) => (!view.npcKo || /[가-힣]/.test(n.name.ko)) && (!q || [n.name.ko, n.name.en, n.name.zh, n.name.ja, n.affiliation].join(' ').toLowerCase().includes(q)));
    fill(grid, l.length ? l.map((n) => h('button.npc-card', { type: 'button', onclick: () => openNpc(n) },
      h('span.npc-img', img(n.portrait, '')), h('b', n.name.ko), n.name.ko !== n.name.en ? h('small', n.name.en) : null)) : h('div.empty', h('p', '찾는 NPC가 없어요.')));
  }
  draw();
}

function openNpc(n) {
  const CV = [['kor', '한국어'], ['jpn', '일본어'], ['eng', '영어'], ['zho', '중국어']];
  const art = h('div.npc-art', n.art ? h('button', { type: 'button', onclick: () => lightbox(art.querySelector('img').src, n.name.ko) }, img(n.art, n.name.ko)) : null);
  const arts = (n.arts || []).length > 1 ? h('div.chips', n.arts.map((a, i) => chip(a.label, i === 0, (e) => {
    art.querySelector('img').src = a.src;
    e.currentTarget.parentElement.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === e.currentTarget)));
  }))) : null;
  let spoil = false;
  const status = h('dd');
  const drawStatus = () => fill(status, spoil ? n.status : h('button.btn.small.ghost', { type: 'button', onclick: () => { spoil = true; drawStatus(); } }, '스포일러 보기'));
  drawStatus();
  const stories = (n.stories || []).map((id) => store.storyById(id)).filter(Boolean);
  const body = [
    h('div.npc-detail',
      art,
      h('div',
        h('p.code', 'NPC'),
        h('h2', { style: { margin: '0 0 2px' } }, n.name.ko),
        h('p.faint', { style: { margin: '0 0 10px', fontSize: '13px' } }, [n.name.en, n.name.zh, n.name.ja].filter((x) => x && x !== n.name.ko).join(' / ')),
        arts,
        h('dl.profile-dl',
          n.affiliation ? [h('dt', '소속'), h('dd', n.affiliation)] : null,
          n.first ? [h('dt', '첫 등장'), h('dd', n.first)] : null,
          n.status ? [h('dt', '상태'), status] : null,
          Object.keys(n.cv || {}).length ? [h('dt', '성우'), h('dd', CV.filter(([k]) => n.cv[k]).map(([k, l]) => h('span.cv', h('small.faint', l), ' ', n.cv[k])))] : null),
        stories.length ? h('div', { style: { marginTop: '10px' } }, h('div.lbl', h('span', '등장 스토리')),
          h('div.chips', stories.map((st) => h('a.chip', { href: `#/stories/${st.id}`, onclick: () => d.close() }, st.name.ko)))) : null,
        n.intro ? h('p.muted', { style: { fontSize: '13px' } }, n.intro) : null)),
    (n.moods || []).length ? h('div', h('div.lbl', h('span', `표정 ${n.moods.length}개`)),
      h('div.npc-moods', n.moods.map((m) => h('figure', img(m.src, ''), h('figcaption', [m.form !== 'Default' ? m.form : null, m.mood].filter(Boolean).join(' · ')))))) : null,
    h('p.faint', { style: { fontSize: '12px' } }, '출처: ', n.wiki ? h('a', { href: n.wiki, target: '_blank', rel: 'noopener' }, 'Reverse: 1999 Wiki') : 'Reverse: 1999 Wiki', ' (CC BY-SA 3.0)', n.nameChecked ? '' : ' · 한국어 이름은 게임 데이터에서 찾은 것이거나 영문이에요'),
  ];
  const d = drawer({ title: n.name.ko, body, wide: true, foot: [h('button.btn.primary', { type: 'button', onclick: () => d.close() }, '닫기')] });
}

// ── 모집 배너 ───────────────────────────────────────────
function summons(root) {
  const vers = [...(store.state.game.versions || [])].sort((a, b) => store.verNum(b.id) - store.verNum(a.id));
  const mine = store.state.user.gacha?.banners || [];
  const box = h('div');
  root.append(h('div.toolbar',
    h('div.grow', h('input', { type: 'search', placeholder: '배너·출품작 이름 검색', value: view.suQ, 'aria-label': '배너 검색', oninput: (e) => { view.suQ = e.target.value; draw(); } })),
    h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: view.suLimited, onchange: (e) => { view.suLimited = e.target.checked; draw(); } }), '픽업 배너만'),
    h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: view.suMine, onchange: (e) => { view.suMine = e.target.checked; draw(); } }), '내가 돌린 것만')), box);
  function draw() {
    const q = view.suQ.trim().toLowerCase();
    const ok = (s) => (!view.suLimited || s.six.length) && (!view.suMine || mine.some((b) => b.ref === s.id))
      && (!q || [s.name.ko, s.name.en, ...s.six.concat(s.five).map((id) => store.charName(store.charById(id)))].join(' ').toLowerCase().includes(q));
    const groups = vers.map((v) => [v, v.summons.filter(ok)]).filter(([, l]) => l.length);
    fill(box, groups.length ? groups.map(([v, l]) => h('section.tl-sec',
      h('h2.group-head', h('a', { href: `#/timeline/${v.id}`, style: { color: 'inherit', textDecoration: 'none' } }, store.verLabel(v.id)), h('small', v.title?.ko || v.title?.en || '')),
      h('div.tl-summons', l.map((s) => summonCard(s, v, mine))))) : h('div.empty', h('p', '조건에 맞는 배너가 없어요.')));
  }
  draw();
  root.append(h('p.faint.story-src', '배너 그림·기간: Reverse: 1999 Wiki, 한국어 이름·픽업 출품작: 게임 데이터. 위키에 버전 문서가 있는 버전까지만 있어요.'));
}
