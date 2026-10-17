// 덱 프리셋 — 자주 쓰는 조합 저장 (갈기의 게시판에서 불러올 수 있음)
import { h, drawer, field, uid, chip } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { teamView, teamEditor } from '../components.js';

const TAGS = ['고득점', '갈기의 게시판', '심층', '한계 돌파', '스토리', '현실', '정신', '연습용'];
const view = { tag: null };

export function render(root) {
  const decks = store.state.user.decks.decks;
  const tags = [...new Set(decks.flatMap((d) => d.tags || []))];
  const list = decks.filter((d) => !view.tag || (d.tags || []).includes(view.tag));
  root.append(
    h('div.page-head',
      h('div', h('h1', '덱'), h('p', '자주 쓰는 조합을 저장해 두고, 갈기의 게시판 기록을 남길 때 그대로 불러옵니다.')),
      h('button.btn.primary.edit-only', { type: 'button', onclick: () => edit(null) }, '새 덱'),
    ),
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
  );
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
  const drawTeam = () => teamBox.replaceChildren(teamEditor(cur.members, (m) => { cur.members = m; commit(); drawTeam(); }));
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
