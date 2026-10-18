// 스토리 후기 — 스토리 배너를 눌러 들어가서 후기를 쓰고 읽는 게시판
// 목록: #/stories   스토리 한 편: #/stories/<스토리 id>
import { h, img, chip, fill, uid, lightbox } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';

const CATS = [['main', '메인 스토리', 'Main Story'], ['mainevent', '버전 이벤트', 'Version Event'], ['char', '캐릭터 스토리', 'Character Story'], ['anec', '일화', 'Anecdote']];
const CAT_NAME = Object.fromEntries(CATS.map(([k, ko]) => [k, ko]));
const view = { cat: 'all', q: '', only: false, sort: 'old' };
const openSpoilers = new Set();
let composing = null; // 쓰는 중인 글 { id?, title, body, spoiler, tags }

const U = () => store.state.user.stories;
const posts = (sid) => (U().posts || []).filter((p) => p.story === sid).sort((a, b) => String(b.created).localeCompare(String(a.created)));
const rating = (sid) => U().ratings?.[sid] || 0;
const isRead = (sid) => !!U().read?.[sid];
const save = (fn) => store.update('stories', fn);
const dateStr = (iso) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function chapter(st) {
  if (st.cat !== 'main' || !st.abbr) return '';
  if (/SP$/.test(st.abbr)) return ' · 특별편';
  const n = parseInt(st.abbr, 10);
  return Number.isNaN(n) ? '' : n ? ` · 제${n}장` : ' · 서장';
}
function storyTitle(st) { return st.name.ko || st.name.en; }
function verText(st) {
  if (!st.version) return '버전 미상';
  const part = st.part && st.part.split('.')[1];
  return store.verLabel(st.version, true) + (part ? ` · ${part}부` : '');
}

export function render(root, { arg } = {}) {
  const list = store.state.game.stories || [];
  if (!list.length) {
    root.append(h('div.empty', h('p', '스토리 목록이 아직 없어요. scripts/import_wiki.py 로 위키 자료를 넣어 주세요.')));
    return;
  }
  const st = arg && store.storyById(decodeURIComponent(arg));
  if (st) { detail(root, st, list); return; }
  index(root, list);
}

// ── 목록 ────────────────────────────────────────────────
function index(root, list) {
  const allPosts = U().posts || [];
  root.append(h('div.page-head', h('div', h('h1', h('span.en', 'Story Archive'), '스토리 후기'),
    h('p', '배너를 누르면 그 스토리로 들어가요. 별점·읽음 표시·후기를 남길 수 있어요.')),
  h('div.stat-mini', h('span', h('b', allPosts.length), '편의 후기'), h('span', h('b', Object.keys(U().read || {}).length), '/', list.length, ' 읽음'))));

  const recent = [...allPosts].sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 4);
  if (recent.length) {
    root.append(h('section.panel.story-recent', h('h3', '최근 후기'),
      h('ul', recent.map((p) => {
        const st = store.storyById(p.story);
        return st ? h('li', h('a', { href: `#/stories/${st.id}` }, h('b', p.title || '제목 없음'), h('span', storyTitle(st)), h('small', dateStr(p.created)))) : null;
      }))));
  }

  const counts = Object.fromEntries(CATS.map(([k]) => [k, list.filter((s) => s.cat === k).length]));
  root.append(h('div.toolbar',
    h('div.chips',
      chip('전체', view.cat === 'all', () => { view.cat = 'all'; rerender(); }),
      CATS.map(([k, ko]) => chip(`${ko} ${counts[k]}`, view.cat === k, () => { view.cat = k; rerender(); }))),
    h('div.grow', h('input', { type: 'search', placeholder: '제목·출품작 검색', value: view.q, 'aria-label': '스토리 검색',
      oninput: (e) => { view.q = e.target.value; drawGrid(); } })),
    h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: view.only, onchange: (e) => { view.only = e.target.checked; drawGrid(); } }), '후기 있는 것만'),
    h('select', { 'aria-label': '정렬', onchange: (e) => { view.sort = e.target.value; drawGrid(); } },
      [['old', '오래된 순'], ['new', '최신 순'], ['rating', '별점 높은 순']].map(([v, t]) => h('option', { value: v, selected: view.sort === v }, t)))));

  const grid = h('div.story-sections');
  root.append(grid);
  function drawGrid() {
    const q = view.q.trim().toLowerCase();
    const match = (s) => {
      if (view.cat !== 'all' && s.cat !== view.cat) return false;
      if (view.only && !posts(s.id).length) return false;
      if (!q) return true;
      const c = s.char && store.charById(s.char);
      return [s.name.ko, s.name.en, c ? store.charName(c) : s.charEn].join(' ').toLowerCase().includes(q);
    };
    const order = (a, b) => {
      if (view.sort === 'rating') return rating(b.id) - rating(a.id) || a.order - b.order;
      const d = store.verNum(a.version) - store.verNum(b.version);
      // 메인 스토리는 장 순서가 곧 시간 순서
      const base = a.cat === 'main' && b.cat === 'main' ? a.order - b.order : (d || a.order - b.order);
      return view.sort === 'new' ? -base : base;
    };
    const groups = CATS.filter(([k]) => view.cat === 'all' || view.cat === k)
      .map(([k, ko, en]) => [ko, en, list.filter((s) => s.cat === k && match(s)).sort(order)])
      .filter(([, , l]) => l.length);
    fill(grid, groups.length ? groups.map(([ko, en, l]) => h('section.story-group',
      h('h2.group-head', h('span.en', en), ko, h('small', `${l.length}편`)),
      h('div.story-grid', l.map(card)))) : h('div.empty', h('p', '조건에 맞는 스토리가 없어요.')));
  }
  drawGrid();
}

function card(st) {
  const n = posts(st.id).length;
  const r = rating(st.id);
  const c = st.char && store.charById(st.char);
  return h('a.story-card', { href: `#/stories/${st.id}`, class: isRead(st.id) ? 'read' : '' },
    st.banner ? h('span.story-banner', img(st.banner, '')) : h('span.story-banner.no-img', h('span', st.name.en)),
    h('span.story-cap',
      h('b', storyTitle(st)),
      h('small', [verText(st), c ? store.charName(c) : null].filter(Boolean).join(' · ')),
      h('span.story-meta',
        r ? h('span.stars', { title: `별점 ${r}` }, stars(r)) : null,
        n ? h('span.cnt', `후기 ${n}`) : null,
        isRead(st.id) ? h('span.read-mark', '읽음') : null)));
}

// ── 스토리 한 편 ─────────────────────────────────────────
function detail(root, st, list) {
  const editing = store.state.editing;
  const c = st.char && store.charById(st.char);
  const same = list.filter((s) => s.cat === st.cat).sort((a, b) => (st.cat === 'main' ? a.order - b.order : store.verNum(a.version) - store.verNum(b.version) || a.order - b.order));
  const i = same.indexOf(st);
  const prev = same[i - 1];
  const next = same[i + 1];
  const r = rating(st.id);

  root.append(
    h('div.toolbar', { style: { marginBottom: '10px' } },
      h('a.btn.small.ghost', { href: '#/stories' }, '← 스토리 목록'),
      h('span', { style: { flex: 1 } }),
      prev ? h('a.btn.small.ghost', { href: `#/stories/${prev.id}`, title: storyTitle(prev) }, '‹ 이전') : null,
      next ? h('a.btn.small.ghost', { href: `#/stories/${next.id}`, title: storyTitle(next) }, '다음 ›') : null),
    h('section.story-hero',
      st.banner ? h('button.story-hero-img', { type: 'button', onclick: () => lightbox(st.banner, storyTitle(st)), 'aria-label': '배너 크게 보기' }, img(st.banner, '')) : null,
      h('div.story-hero-text',
        h('p.code', `${CAT_NAME[st.cat]} · ${verText(st)}${chapter(st)}`),
        h('h1', storyTitle(st)),
        st.name.ko !== st.name.en ? h('p.en-title', st.name.en) : null,
        h('div.story-hero-row',
          c ? h('a.fav-chip', { href: `#/roster/${c.id}` }, h('span.face', img(store.charPortrait(c), '')), store.charName(c)) : (st.charEn ? h('span.tag', st.charEn) : null),
          h('div.rate', { role: editing ? 'radiogroup' : null, 'aria-label': '별점' },
            [1, 2, 3, 4, 5].map((k) => editing
              ? h('button', { type: 'button', 'aria-label': `${k}점`, 'aria-pressed': String(k <= r), onclick: () => save((u) => { (u.ratings ||= {})[st.id] = r === k ? 0 : k; if (!u.ratings[st.id]) delete u.ratings[st.id]; }) }, k <= r ? '★' : '☆')
              : h('span', { 'aria-hidden': 'true' }, k <= r ? '★' : '☆')),
            !editing && !r ? h('small.faint', ' 별점 없음') : null),
          editing
            ? h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: isRead(st.id), onchange: (e) => save((u) => { u.read ||= {}; if (e.target.checked) u.read[st.id] = new Date().toISOString().slice(0, 10); else delete u.read[st.id]; }) }), '다 읽었어요')
            : isRead(st.id) ? h('span.read-mark', `읽음 · ${U().read[st.id]}`) : null),
      )),
  );

  if (st.stages?.length) {
    root.append(h('details.panel.story-stages', h('summary', `스테이지 ${st.stages.length}개`),
      h('ol', st.stages.map((s) => h('li', h('span.code', s.n), s.ko || s.en, s.ko && s.en ? h('small.faint', ` ${s.en}`) : null)))));
  }

  const ps = posts(st.id);
  const box = h('section.story-posts');
  root.append(h('div.group-head-row', h('h2.group-head', h('span.en', 'Reviews'), '후기', h('small', `${ps.length}편`)),
    editing && !composing ? h('button.btn.primary.small', { type: 'button', onclick: () => { composing = { story: st.id, title: '', body: '', spoiler: true, tags: '' }; rerender(); } }, '+ 후기 쓰기') : null), box);

  if (editing && composing && composing.story === st.id && !composing.id) box.append(editor(st));
  if (!ps.length && !(editing && composing)) box.append(h('div.empty', h('p', editing ? '아직 후기가 없어요. 위의 ‘후기 쓰기’로 첫 글을 남겨 보세요.' : '아직 후기가 없어요.')));
  for (const p of ps) box.append(editing && composing && composing.id === p.id ? editor(st) : post(p));

  root.append(h('p.faint.story-src', '스토리 정보·배너: ', st.wiki ? h('a', { href: st.wiki, target: '_blank', rel: 'noopener' }, 'Reverse: 1999 Wiki') : 'Reverse: 1999 Wiki', ' (CC BY-SA 3.0)'));
}

function post(p) {
  const editing = store.state.editing;
  const hidden = p.spoiler && !openSpoilers.has(p.id);
  return h('article.story-post',
    h('header',
      h('h3', p.title || '제목 없음'),
      h('small.faint', dateStr(p.created), p.updated && p.updated !== p.created ? ` · 고침 ${dateStr(p.updated)}` : ''),
      p.spoiler ? h('span.tag.spoil', '스포일러') : null,
      (p.tags || []).map((t) => h('span.tag', `#${t}`)),
      editing ? h('span.post-tools',
        h('button.btn.small.ghost', { type: 'button', onclick: () => { composing = { ...p, tags: (p.tags || []).join(', ') }; rerender(); } }, '고치기'),
        h('button.btn.small.danger', { type: 'button', onclick: () => {
          if (!confirm('이 후기를 지울까요?')) return;
          save((u) => { u.posts = u.posts.filter((x) => x.id !== p.id); });
        } }, '지우기')) : null),
    hidden
      ? h('button.spoiler-cover', { type: 'button', onclick: () => { openSpoilers.add(p.id); rerender(); } }, '스포일러가 있는 후기예요. 눌러서 보기')
      : h('div.post-body', p.body || ''));
}

function editor(st) {
  const d = composing;
  const title = h('input', { type: 'text', value: d.title, placeholder: '제목', 'aria-label': '제목', oninput: (e) => { d.title = e.target.value; } });
  const body = h('textarea', { placeholder: '감상을 자유롭게 적어 주세요.', 'aria-label': '내용', rows: 10, oninput: (e) => { d.body = e.target.value; } }, d.body);
  const tags = h('input', { type: 'text', value: d.tags, placeholder: '태그 (쉼표로 구분, 예: 최애, 눈물)', 'aria-label': '태그', oninput: (e) => { d.tags = e.target.value; } });
  const spoil = h('input', { type: 'checkbox', checked: d.spoiler, onchange: (e) => { d.spoiler = e.target.checked; } });
  setTimeout(() => (d.id ? body : title).focus(), 0);
  return h('form.story-editor', { onsubmit: (e) => {
    e.preventDefault();
    if (!d.title.trim() && !d.body.trim()) { title.focus(); return; }
    const now = new Date().toISOString();
    const rec = { id: d.id || uid(), story: st.id, title: d.title.trim(), body: d.body.replace(/\s+$/, ''), spoiler: !!d.spoiler,
      tags: d.tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean), created: d.created || now, updated: now };
    composing = null;
    save((u) => { u.posts ||= []; const k = u.posts.findIndex((x) => x.id === rec.id); if (k >= 0) u.posts[k] = rec; else u.posts.push(rec); });
  } },
  title, body, tags,
  h('div.toolbar', { style: { margin: 0 } },
    h('label.check', { style: { fontSize: '13px' } }, spoil, '스포일러 가리기'),
    h('span', { style: { flex: 1 } }),
    h('button.btn.small', { type: 'button', onclick: () => { composing = null; rerender(); } }, '취소'),
    h('button.btn.small.primary', { type: 'submit' }, d.id ? '고친 내용 반영' : '올리기')),
  h('p.faint', { style: { fontSize: '12.5px', margin: 0 } }, '올린 뒤 오른쪽 위 저장 버튼을 눌러야 저장소에 들어가요.'));
}
