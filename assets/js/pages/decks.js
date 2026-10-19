// 덱 프리셋 — 자주 쓰는 조합 저장 (갈기의 게시판에서 불러올 수 있음)
import { h, drawer, field, uid, chip, fill, toast } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { teamView, teamEditor, charSelect, afImg } from '../components.js';
import { check, recommend, AF_KO } from '../deckcheck.js';

const TAGS = ['고득점', '갈기의 게시판', '심층', '한계 돌파', '스토리', '현실', '정신', '연습용'];
const view = { tag: null, recOpen: false, rec: { core: [null, null], boss: '', dmg: '', mode: 'balanced' }, results: null };
const LV = { bad: '✕', warn: '!', good: '✓', info: '·' };

/** 분석에 쓰는 정보 묶음 */
function ctx(boss) {
  return {
    skills: store.state.game.skills || { chars: {}, glossary: {}, kinds: {} },
    chars: (id) => store.charById(id), record: (id) => store.charRecord(id), name: (c) => store.charName(c),
    current: store.verNum(store.currentVersion()), verNum: store.verNum, boss: boss || null,
    maxInsight: store.maxInsight, maxLevel: store.maxLevel,
  };
}
/** 한섭에 나온 보유 출품작 */
function pool() {
  const cur = store.verNum(store.currentVersion());
  return store.state.game.characters.filter((c) => store.charRecord(c.id)?.owned && store.verNum(c.version) <= cur);
}

/** 검사 결과 목록 */
function checkList(members, boss, { brief } = {}) {
  const l = check(members, ctx(boss));
  const shown = brief ? l.filter((x) => x.lv !== 'info') : l;
  return h('ul.dc-list', shown.map((x) => h('li', { class: 'dc-' + x.lv }, h('span.dc-ico', { 'aria-hidden': 'true' }, LV[x.lv]), h('span', x.text))));
}
function checkSummary(members, boss) {
  const l = check(members, ctx(boss));
  const n = (lv) => l.filter((x) => x.lv === lv).length;
  return h('span.dc-sum', n('bad') ? h('b.dc-bad', `✕ ${n('bad')}`) : null, n('warn') ? h('b.dc-warn', `! ${n('warn')}`) : null, h('b.dc-good', `✓ ${n('good')}`));
}
function bossChips(value, onPick) {
  return h('div.chips.dc-boss', chip('상관없음', !value, () => onPick('')),
    Object.entries(AF_KO).map(([k, ko]) => chip([afImg(k), ko], value === k, () => onPick(k))));
}

export function render(root) {
  const decks = store.state.user.decks.decks;
  const tags = [...new Set(decks.flatMap((d) => d.tags || []))];
  const list = decks.filter((d) => !view.tag || (d.tags || []).includes(view.tag));
  if (!store.state.game.skills) { store.loadSkills().then(() => rerender()); }
  root.append(
    h('div.page-head',
      h('div', h('h1', h('span.en', 'Teams'), '덱'), h('p', '자주 쓰는 조합을 저장해 두고, 갈기의 게시판 기록을 남길 때 그대로 불러옵니다.')),
      h('button.btn.primary.edit-only', { type: 'button', onclick: () => edit(null) }, '새 덱'),
    ),
    recPanel(),
    tags.length ? h('div.toolbar', h('div.chips', chip('전체', !view.tag, () => { view.tag = null; rerender(); }),
      tags.map((t) => chip(t, view.tag === t, () => { view.tag = t; rerender(); })))) : null,
    list.length ? h('div.deck-list', list.map(deckCard)) : h('div.empty', h('p', '저장한 덱이 없습니다.'),
      h('p.faint', { class: 'view-only' }, '편집 모드에서 덱을 만들 수 있어요.')),
  );
}

function deckCard(d) {
  const i = store.state.user.decks.decks.indexOf(d);
  return h('article.deck',
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' } },
      h('h3', d.name),
      h('div.edit-only', { style: { display: 'flex', gap: '4px' } },
        h('button.btn.small.ghost', { type: 'button', 'aria-label': '위로', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
        h('button.btn.small', { type: 'button', onclick: () => edit(d) }, '고치기'))),
    d.tags?.length ? h('div.tagline', d.tags.map((t) => h('span.tag', t))) : null,
    teamView(d.members),
    d.note ? h('p.boss-note', d.note) : null,
    store.state.game.skills && d.members?.some((m) => m?.char) ? h('details.dc-details',
      h('summary', '덱 분석 ', d.boss ? h('small.faint', `${AF_KO[d.boss]} 보스 기준 `) : null, checkSummary(d.members, d.boss)),
      checkList(d.members, d.boss)) : null,
  );
}

// ── 추천 덱 ─────────────────────────────────────────────
function recPanel() {
  const r = view.rec;
  const out = h('div.dc-results');
  const owned = pool();
  const run = () => {
    if (!store.state.game.skills) { fill(out, h('p.faint', '스킬 정보를 불러오는 중이에요…')); return; }
    if (owned.length < 3) { fill(out, h('p.muted', '보유한 출품작이 3명 이상이어야 추천할 수 있어요. 출품작 메뉴에서 보유 표시를 해 주세요.')); return; }
    fill(out, h('p.faint', '조합을 따져 보는 중…'));
    setTimeout(() => {
      const core = r.core.filter(Boolean).map(Number);
      view.results = recommend({ core, boss: r.boss || null, dmg: r.dmg, mode: r.mode, pool: owned }, ctx(r.boss));
      drawResults();
    }, 20);
  };
  const drawResults = () => {
    const res = view.results;
    if (!res) { fill(out); return; }
    if (!res.length) { fill(out, h('p.muted', '조건에 맞는 조합을 찾지 못했어요.')); return; }
    fill(out, res.map((x, i) => {
      const members = x.members.map((c) => (c ? { char: c.id, psychube: store.psyList(store.charRecord(c.id))[0] || null } : { char: null, psychube: null }));
      const names = x.members.filter(Boolean).map((c) => store.charName(c));
      return h('article.deck.dc-rec',
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' } },
          h('h3', `추천 ${i + 1}`), h('small.faint', `점수 ${x.score.toFixed(1)}`)),
        teamView(members),
        checkList(members, r.boss, { brief: true }),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          h('button.btn.small.primary.edit-only', { type: 'button', onclick: () => {
            const deck = { id: uid(), name: names.join(' + '), tags: ['추천'], members, boss: r.boss || '', note: '' };
            store.update('decks', (s) => { s.decks.push(deck); });
            toast('덱으로 저장했어요');
          } }, '덱으로 저장'),
          h('span.faint.view-only', { style: { fontSize: '12px' } }, '편집 모드에서 덱으로 저장할 수 있어요.')));
    }));
  };
  const coreSel = (i) => charSelect(r.core[i], (v) => { r.core[i] = v; }, { label: `핵심 출품작 ${i + 1}` });
  const body = h('div.dc-rec-body',
    h('p.faint', { style: { margin: '0 0 10px', fontSize: '13px' } },
      `한섭 ${store.currentVersion()} 버전까지 나온 보유 출품작 ${owned.length}명 중에서, 스킬 설명을 바탕으로 시너지·회복·상성·육성 상태를 따져 출전 4명을 골라요. 딜 계산이 아니라 규칙으로 고르는 거라 참고용이에요.`),
    h('div.dc-form',
      h('div', h('div.lbl', h('span', '꼭 넣을 출품작 (선택)')), h('div.dc-core', coreSel(0), coreSel(1))),
      h('div', h('div.lbl', h('span', '보스 영감')), bossChips(r.boss, (k) => { r.boss = k; rerender(); })),
      h('div', h('div.lbl', h('span', '피해 유형')), h('div.chips',
        [['', '상관없음'], ['reality', '현실'], ['mental', '정신']].map(([k, l]) => chip(l, r.dmg === k, () => { r.dmg = k; rerender(); })))),
      h('div', h('div.lbl', h('span', '운용')), h('div.chips',
        [['balanced', '오래 버티기 (회복 중시)'], ['burst', '짧게 고득점 (딜 중시)']].map(([k, l]) => chip(l, r.mode === k, () => { r.mode = k; rerender(); }))))),
    h('div', { style: { margin: '12px 0' } }, h('button.btn.primary', { type: 'button', onclick: run }, '추천 받기')),
    out);
  drawResults();
  const det = h('details.panel.dc-panel', { open: view.recOpen, ontoggle: (e) => { view.recOpen = e.target.open; } },
    h('summary', h('b', '추천 덱 만들기'), h('small.faint', ' 보유 출품작으로 조합 골라 보기')), body);
  return det;
}

function move(i, dir) {
  store.update('decks', (s) => { const [x] = s.decks.splice(i, 1); s.decks.splice(i + dir, 0, x); });
}

function edit(deck) {
  const isNew = !deck;
  const cur = deck ? JSON.parse(JSON.stringify(deck)) : { id: uid(), name: '', tags: [], members: [], note: '' };
  const commit = () => store.update('decks', (s) => {
    const i = s.decks.findIndex((x) => x.id === cur.id);
    if (i >= 0) s.decks[i] = cur; else s.decks.push(cur);
  }, { silent: true });
  const teamBox = h('div');
  const anaBox = h('div.dc-live');
  const drawAna = () => fill(anaBox, store.state.game.skills ? checkList(cur.members, cur.boss) : h('p.faint', '스킬 정보를 불러오는 중…'));
  if (!store.state.game.skills) store.loadSkills().then(drawAna);
  const drawTeam = () => { teamBox.replaceChildren(teamEditor(cur.members, (m) => { cur.members = m; commit(); drawTeam(); })); drawAna(); };
  const bossBox = h('div');
  const drawBoss = () => fill(bossBox, bossChips(cur.boss || '', (k) => { cur.boss = k; commit(); drawBoss(); drawAna(); }));
  drawBoss();
  drawTeam();
  const tagBox = h('div.chips');
  const drawTags = () => tagBox.replaceChildren(...[...new Set([...TAGS, ...cur.tags])].map((t) => chip(t, cur.tags.includes(t), () => {
    cur.tags = cur.tags.includes(t) ? cur.tags.filter((x) => x !== t) : [...cur.tags, t]; commit(); drawTags();
  })));
  drawTags();
  const body = [
    h('div.fields.form-row', field('덱 이름', h('input', { type: 'text', value: cur.name, placeholder: '예: 레콜레타 + 미스 스트레인저',
      oninput: (e) => { cur.name = e.target.value; commit(); } }), 'wide')),
    h('div.form-row', h('div.lbl', h('span', '구성')), teamBox),
    h('div.form-row', h('div.lbl', h('span', '덱 분석')), h('div', { style: { marginBottom: '8px' } }, h('small.faint', '상대 보스 영감 (상성 확인용)'), bossBox), anaBox),
    h('div.form-row', h('div.lbl', h('span', '태그')), tagBox,
      h('div', { style: { marginTop: '6px' } }, h('input', { type: 'text', placeholder: '새 태그 입력 후 Enter', onkeydown: (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) { cur.tags.push(e.target.value.trim()); e.target.value = ''; commit(); drawTags(); }
      } }))),
    h('div.fields.form-row', field('메모 (운용법, 스킬 순서 등)', h('textarea', { rows: 4, oninput: (e) => { cur.note = e.target.value; commit(); } }, cur.note), 'wide')),
  ];
  if (isNew) cur.name = cur.name || '새 덱';
  const foot = [
    isNew ? null : h('button.btn.danger', { type: 'button', onclick: () => {
      if (!confirm(`'${cur.name}' 덱을 지울까요?`)) return;
      store.update('decks', (s) => { s.decks = s.decks.filter((x) => x.id !== cur.id); }, { silent: true });
      d.close();
    } }, '삭제'),
    h('button.btn', { type: 'button', onclick: () => {
      const copy = { ...JSON.parse(JSON.stringify(cur)), id: uid(), name: `${cur.name} (복사)` };
      store.update('decks', (s) => { s.decks.push(copy); }, { silent: true });
      d.close();
    } }, '복제'),
    h('button.btn.primary', { type: 'button', onclick: () => d.close() }, '완료'),
  ];
  commit();
  const d = drawer({ title: isNew ? '새 덱' : cur.name, body, foot, wide: true, onClose: () => rerender() });
}
