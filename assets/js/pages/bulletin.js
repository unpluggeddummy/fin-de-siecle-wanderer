// 갈기의 게시판 — 버전(시즌)별 보스 점수, 덱(덱 페이지와 연결), 메모, 출전 당시 육성 상태
import { h, img, fmt, drawer, field, toast, uid } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { teamView, teamEditor } from '../components.js';
import * as fx from '../fx.js';

const GRADES = ['', 'SSS+', 'SSS', 'SS', 'S', 'A', 'B', 'C'];

const view = { season: null };

/** 게임 데이터 시즌 + 내가 추가한 시즌 */
export function allSeasons() {
  const u = store.state.user.bulletin;
  const game = store.state.game.bulletin.map((s) => ({ ...s, custom: false }));
  const custom = (u.customSeasons || []).map((s) => ({ ...s, custom: true }));
  return [...game, ...custom];
}

function rec(seasonId, stage) {
  return store.state.user.bulletin.seasons?.[seasonId]?.bosses?.[stage] || null;
}

/** 시즌별 합계 (홈 화면에서도 쓴다) */
export function seasonTotals() {
  return allSeasons().map((s) => {
    const bosses = s.bosses.map((b) => ({ ...b, score: +(rec(s.id, b.stage)?.score || 0) }));
    return { id: s.id, version: s.version, bosses, total: bosses.reduce((a, b) => a + b.score, 0) };
  });
}

/** 같은 보스(유형)의 개인 최고 기록 */
const bossKey = (b) => b.name || `t:${b.type}`;

function bestOfType(key) {
  let best = null;
  for (const s of allSeasons()) {
    for (const b of s.bosses) {
      if (bossKey(b) !== key) continue;
      const r = rec(s.id, b.stage);
      if (r?.score && (!best || +r.score > best.score)) best = { score: +r.score, season: s, boss: b };
    }
  }
  return best;
}

// ── 덱 페이지와 연결: 저장 데이터는 그대로 두고, 출전 출품작 구성으로 덱을 찾는다 ──
const charSet = (members) => (members || []).map((m) => m?.char).filter(Boolean);
/** 기록의 출전 구성과 같은 덱(4명 같음) 또는 비슷한 덱(3명 같음) */
export function deckMatch(members) {
  const mine = charSet(members);
  if (!mine.length) return null;
  let best = null;
  for (const d of store.state.user.decks.decks) {
    const ds = charSet(d.members);
    const same = mine.filter((c) => ds.includes(c)).length;
    const exact = same === mine.length && same === ds.length;
    if (exact) return { deck: d, exact: true };
    if (same >= 3 && (!best || same > best.same)) best = { deck: d, exact: false, same };
  }
  return best;
}
/** 덱 하나에 연결되는 게시판 기록들 (덱 페이지에서 쓴다) */
export function recordsForDeck(deck) {
  const out = [];
  for (const s of allSeasons()) for (const b of s.bosses) {
    const r = rec(s.id, b.stage);
    if (!r?.score || !r.members?.length) continue;
    const m = deckMatch(r.members);
    if (m?.deck.id === deck.id) out.push({ season: s, boss: b, score: +r.score, exact: m.exact });
  }
  return out.sort((a, b) => b.score - a.score);
}
/** 출전 당시 육성 상태 (기록을 남길 때 찍어 둔다) */
function snap(m) {
  if (!m?.char || m.at) return m;
  const r = store.charRecord(m.char) || {};
  return { ...m, at: { p: r.portray || 0, e: (r.euphorias || (r.euphoria ? [r.euphoria] : [])).length ? 1 : 0, lv: r.level || 0, ins: r.insight || 0 } };
}
function growthLine(members) {
  const xs = (members || []).filter((m) => m?.char && m.at);
  if (!xs.length) return null;
  return h('div.boss-growth', xs.map((m) => h('span', `${store.charName(store.charById(m.char))} `, h('b', `P${m.at.p}`), m.at.e ? h('em', ' 광상') : null)));
}

export function render(root) {
  const seasons = allSeasons();
  const editing = store.state.editing;
  const totals = seasonTotals();
  if (!view.season || !seasons.find((s) => String(s.id) === String(view.season))) {
    const lastRec = [...totals].reverse().find((t) => t.total > 0);
    view.season = (lastRec || seasons[seasons.length - 1])?.id;
  }
  const season = seasons.find((s) => String(s.id) === String(view.season));

  const board = scoreBoard(seasons, totals, season);

  const t = totals.find((x) => x.id === season?.id);

  root.append(
    h('div.page-head',
      h('div', h('h1', h('span.en', 'Bulletin Board'), '갈기의 게시판'), h('p', '버전마다 바뀌는 보스와 내 점수, 그때 쓴 덱과 메모를 남깁니다.')),
      h('div.toolbar', { style: { margin: 0 } },
        h('button.btn.edit-only', { type: 'button', onclick: addSeason }, '새 시즌 추가'),
      ),
    ),
    board,
    season ? h('div',
      season.custom && editing ? h('div.toolbar', { style: { justifyContent: 'flex-end' } }, h('button.btn.small.danger', { type: 'button', onclick: () => removeSeason(season) }, '이 시즌 삭제')) : null,
      h('div.boss-grid', season.bosses.map((b) => bossCard(season, b))),
    ) : h('div.empty', h('p', '시즌 데이터가 없습니다.')),
    h('h2.section', '보스별 최고 기록'),
    bestList(),
    h('h2.section', '자주 쓴 출품작·의지'),
    usageStats(),
  );
}

/** 같은 보스: 이름까지 같아야 같은 보스 (Ⅰ형·Ⅱ형은 서로 다른 보스) */
const baseName = (n) => n || '';
const familyKey = (b) => b.name || `t:${b.type}`;
function family(b) {
  const out = [];
  for (const s of allSeasons()) for (const bb of s.bosses) {
    if (familyKey(bb) !== familyKey(b)) continue;
    out.push({ season: s, boss: bb, r: rec(s.id, bb.stage) });
  }
  return out;
}
function familyDrawer(b) {
  const list = family(b).filter((x) => x.r?.score).sort((x, y) => +y.r.score - +x.r.score);
  drawer({ title: `${baseName(b.name)} — 지난 기록 모아 보기`, wide: true,
    body: list.length ? list.map(({ season, boss, r }) => h('article.fam',
      h('div.fam-head', boss.image ? img(boss.image, '') : null,
        h('div', h('b', `${season.version} · ${boss.name}`), h('div', h('span.val', fmt(r.score)), r.grade ? h('span.grade', r.grade) : null))),
      r.members?.some((m) => m?.char) ? teamView(r.members) : null,
      growthLine(r.members),
      r.note ? h('p.boss-note', r.note) : null)) : h('p.muted', '같은 보스 기록이 없습니다.'),
    foot: [] });
}

function bossCard(season, b) {
  const r = rec(season.id, b.stage) || {};
  const best = bestOfType(bossKey(b));
  const isPB = best && r.score && +r.score === best.score && best.season.id === season.id;
  const prevBest = (() => {
    // 이 시즌 이전의 같은 보스 최고 기록
    let p = null;
    for (const s of allSeasons()) {
      if (s.id === season.id) break;
      for (const bb of s.bosses) {
        if (bossKey(bb) !== bossKey(b)) continue;
        const rr = rec(s.id, bb.stage);
        if (rr?.score && (!p || +rr.score > p)) p = +rr.score;
      }
    }
    return p;
  })();
  const diff = r.score && prevBest ? +r.score - prevBest : null;
  const dm = deckMatch(r.members);

  return h('article.boss',
    h('div.boss-top',
      b.image ? img(b.image, '') : null,
      h('div.bt', h('h3', b.name || `보스 ${b.stage}`), h('p', b.nameEn || '')),
      h('div.boss-score',
        r.score ? h('span.val', fmt(r.score)) : h('span.val.none', '기록 없음'),
        r.grade ? h('span.grade', r.grade) : null,
        isPB ? h('div.pb', '개인 최고 기록') : (diff !== null ? h('div.pb', { style: { color: diff >= 0 ? 'var(--teal)' : '#f0b4a5' } }, `이전 최고 대비 ${diff >= 0 ? '+' : ''}${fmt(diff)}`) : null),
      ),
    ),
    h('div.boss-body',
      r.members?.some((m) => m?.char) ? teamView(r.members) : null,
      growthLine(r.members),
      dm ? h('a.boss-deck', { href: '#/decks' }, dm.exact ? `덱 · ${dm.deck.name}` : `덱 · ${dm.deck.name} 변형`) : null,
      r.note ? h('p.boss-note', r.note) : null,
      (() => {  // 아직 기록이 없는 보스: 같은 보스의 내 최고 기록과 그때 덱을 미리 보기
        if (r.score) return null;
        const prev = family(b).filter((x) => x.r?.score && x.season.id !== season.id).sort((x, y) => +y.r.score - +x.r.score)[0];
        if (!prev) return null;
        return h('div.boss-prev',
          h('p.faint', `같은 보스 내 최고 · ${prev.season.version} ${prev.boss.name} ${fmt(prev.r.score)}점`),
          prev.r.members?.some((m) => m?.char) ? teamView(prev.r.members) : null,
          prev.r.note ? h('p.boss-note', prev.r.note) : null);
      })(),
      family(b).filter((x) => x.r?.score).length > (r.score ? 1 : 0) ? h('button.btn.small.ghost', { type: 'button', onclick: () => familyDrawer(b) }, '같은 보스 지난 기록') : null,
      h('button.btn.small.edit-only', { type: 'button', onclick: () => editBoss(season, b) }, r.score ? '기록 고치기' : '기록 남기기'),
    ),
  );
}

function editBoss(season, b) {
  const cur = JSON.parse(JSON.stringify(rec(season.id, b.stage) || { score: '', grade: '', members: [], note: '' }));
  const commit = () => store.update('bulletin', (s) => {
    cur.members = (cur.members || []).map(snap);
    s.seasons[season.id] ||= { bosses: {} };
    s.seasons[season.id].bosses[b.stage] = cur;
  }, { silent: true });

  const teamBox = h('div');
  const drawTeam = () => teamBox.replaceChildren(teamEditor(cur.members || [], (m) => { cur.members = m; commit(); drawTeam(); drawDeck?.(); }));
  drawTeam();

  const deckBox = h('div');
  const drawDeck = () => {
    const m = deckMatch(cur.members);
    deckBox.replaceChildren(
      m ? h('p.faint', { style: { margin: '0 0 6px', fontSize: '13px' } }, m.exact ? `덱 페이지의 「${m.deck.name}」과 같은 구성이에요. 덱 페이지에서도 이 기록이 보여요.` : `덱 페이지의 「${m.deck.name}」과 3명이 같아요 (변형).`) : null,
      h('div.toolbar', { style: { margin: 0 } },
        store.state.user.decks.decks.length ? h('select', { onchange: (e) => {
          const d = store.state.user.decks.decks.find((x) => x.id === e.target.value);
          if (d) { cur.members = JSON.parse(JSON.stringify(d.members)).map((x) => ({ char: x.char, psychube: x.psychube })); commit(); drawTeam(); drawDeck(); }
          e.target.value = '';
        } }, h('option', { value: '' }, '저장한 덱 불러오기'), store.state.user.decks.decks.map((d) => h('option', { value: d.id }, d.name))) : null,
        !m?.exact && charSet(cur.members).length ? h('button.btn.small', { type: 'button', onclick: () => {
          const name = prompt('덱 이름', m ? `${m.deck.name} 변형` : '');
          if (!name) return;
          store.update('decks', (u) => { u.decks.push({ id: uid(), name: name.trim(), tags: ['갈기의 게시판'], members: cur.members.map((x) => ({ char: x.char, psychube: x.psychube })), note: '' }); }, { silent: true });
          toast(`「${name.trim()}」 덱으로 저장했어요`);
          drawDeck();
        } }, '이 구성을 덱으로 저장') : null,
      ),
    );
  };
  drawDeck();

  const body = [
    b.image ? h('div', { style: { height: '120px', overflow: 'hidden', borderRadius: '8px', marginBottom: '14px', background: 'var(--night)' } },
      h('img', { src: b.image, alt: '', style: { height: '150px', marginLeft: 'auto' } })) : null,
    h('div.fields.form-row',
      field('점수', h('input', { type: 'number', min: 0, inputmode: 'numeric', value: cur.score || '',
        onchange: (e) => { cur.score = e.target.value ? +e.target.value : ''; commit(); } })),
      field('등급', h('select', { onchange: (e) => { cur.grade = e.target.value; commit(); } },
        GRADES.map((g) => h('option', { value: g, selected: (cur.grade || '') === g }, g || '—')))),
    ),
    h('div.form-row', h('div.lbl', h('span', '사용한 덱')), teamBox),
    h('div.form-row', h('div.lbl', h('span', '덱 페이지')), deckBox),
    h('p.faint', { style: { fontSize: '12.5px', margin: '-4px 0 12px' } }, '저장할 때 출전 출품작의 형상·광상을 함께 기록해 둬요 (나중에 육성해도 그때 상태가 남아요).'),
    h('div.fields.form-row',
      field('메모 (패턴, 실수한 점, 다음에 바꿀 것)', h('textarea', { rows: 4, onchange: (e) => { cur.note = e.target.value; commit(); } }, cur.note || ''), 'wide'),
    ),
  ];
  const foot = [
    h('button.btn.danger', { type: 'button', onclick: () => {
      if (!confirm('이 보스 기록을 지울까요?')) return;
      store.update('bulletin', (s) => { delete s.seasons[season.id]?.bosses?.[b.stage]; }, { silent: true });
      d.close();
    } }, '기록 지우기'),
    h('button.btn.primary', { type: 'button', onclick: () => d.close() }, '완료'),
  ];
  const d = drawer({ title: `${season.version} · ${b.name || '보스 ' + b.stage}`, body, foot, wide: true, onClose: () => rerender() });
}

function addSeason() {
  const last = allSeasons().slice(-1)[0];
  const version = prompt('새 시즌의 버전을 적어 주세요. (예: 4.0)', '');
  if (!version) return;
  const names = prompt('보스 이름을 쉼표로 구분해 적어 주세요.', last ? last.bosses.map((b) => b.name).join(', ') : '보스 1, 보스 2, 보스 3');
  if (names === null) return;
  const list = names.split(',').map((x) => x.trim()).filter(Boolean);
  const id = 'c-' + uid();
  store.update('bulletin', (s) => {
    s.customSeasons ||= [];
    s.customSeasons.push({ id, version: version.trim(), bosses: list.map((n, i) => {
      // 같은 이름(형태 접미사 제외)의 보스가 예전에 있으면 같은 유형으로 이어 준다
      const base = n.replace(/[·・\s]*[ⅠⅡⅢⅣⅤ]+형$/u, '');
      const prev = allSeasons().flatMap((ss) => ss.bosses).reverse().find((bb) => (bb.name || '').replace(/[·・\s]*[ⅠⅡⅢⅣⅤ]+형$/u, '') === base);
      return { stage: i + 1, type: prev?.type ?? null, name: n, nameEn: prev?.nameEn || '', image: prev?.image || null };
    }) });
  });
  view.season = id;
  rerender();
}

function removeSeason(season) {
  if (!confirm(`${season.version} 시즌과 그 기록을 모두 지울까요?`)) return;
  store.update('bulletin', (s) => {
    s.customSeasons = s.customSeasons.filter((x) => x.id !== season.id);
    delete s.seasons[season.id];
  });
  view.season = null;
}

/**
 * 점수판 — 고른 시즌 합계는 숫자 띠가 굴러가고, 시즌별 합계는 픽셀 블록 기둥이 한 칸씩 쌓인다.
 * 기둥을 누르면 그 시즌으로 바뀐다 (예전 시즌 상자 + 선 그래프 자리).
 */
let lastShown = 0;
function scoreBoard(seasons, totals, season) {
  const t = totals.find((x) => x.id === season?.id) || { total: 0, bosses: [] };
  const i = totals.findIndex((x) => x.id === season?.id);
  const prev = totals.slice(0, i).reverse().find((x) => x.total > 0);
  const best = Math.max(0, ...totals.map((x) => x.total));
  const max = best * 1.1 || 1;
  const colors = ['var(--brass-bright)', 'var(--brass)', '#8a6a35', '#5e4a2a'];
  const num = h('div.sb2-num');
  const dlt = t.total && prev ? t.total - prev.total : null;
  const label = (s) => store.COLLAB[s.version] ? `${s.version} · ${store.COLLAB[s.version]}` : s.version;

  const cols = seasons.map((s, k) => {
    const x = totals[k];
    const on = String(s.id) === String(season?.id);
    const pct = x.total ? Math.max(3, (x.total / max) * 100) : 0;
    let acc = 0;
    return h('button.sb2-col' + (on ? '.on' : '') + (x.total ? '' : '.empty') + (store.COLLAB[s.version] ? '.collab' : ''), {
      type: 'button', title: `${label(s)} · ${x.total ? fmt(x.total) + '점' : '기록 없음'}`, 'aria-pressed': String(on),
      style: { '--d': `${k * 45}ms` },
      onclick: () => { view.season = s.id; rerender(); },
    },
      h('span.sb2-bar', { style: { height: `${pct}%` } },
        x.bosses.filter((b) => b.score).map((b, j) => { const seg = h('i', { style: { height: `${(b.score / x.total) * 100}%`, background: colors[j % colors.length] }, title: `${b.name}: ${fmt(b.score)}` }); acc += b.score; return seg; }).reverse(),
        on && x.total ? h('em.sb2-tag', fmt(x.total)) : null),
      h('span.sb2-v', s.version));
  });
  const ticks = [1, 0.75, 0.5, 0.25].map((f) => h('span', { style: { bottom: `${(f * best / max) * 100}%` } }, best ? `${Math.round(f * best / 10000).toLocaleString('ko-KR')}만` : ''));

  const el = h('section.sb2',
    h('div.sb2-head',
      h('div',
        h('p.sb2-k', `SEASON ${season ? label(season) : '—'} // TOTAL SCORE`),
        num,
        h('p.sb2-sub',
          dlt == null ? (t.total ? '첫 기록' : '아직 기록이 없어요') : h('span' + (dlt >= 0 ? '.up' : '.down'), `${dlt >= 0 ? '▲' : '▼'} ${fmt(Math.abs(dlt))} (${dlt >= 0 ? '+' : ''}${(dlt / prev.total * 100).toFixed(1)}%)`),
          prev && dlt != null ? h('small', ` vs ${prev.version}`) : null)),
      h('ul.sb2-boss', t.bosses.map((b, j) => h('li',
        h('i', { style: { background: colors[j % colors.length] } }),
        h('span', b.name || `보스 ${j + 1}`),
        h('b', b.score ? fmt(b.score) : '—'),
        h('em', t.total && b.score ? `${Math.round(b.score / t.total * 100)}%` : ''))))),
    h('div.sb2-chart',
      h('div.sb2-y', ticks),
      h('div.sb2-cols', cols),
      h('i.sb2-scan')),
    h('p.sb2-foot', h('span', `BEST ${fmt(best)}`), h('span', `SEASONS ${totals.filter((x) => x.total).length}/${seasons.length}`), h('span', '기둥을 누르면 그 시즌으로')),
  );
  requestAnimationFrame(() => {
    fx.odometer(num, t.total, lastShown);
    lastShown = t.total;
    const wrap = el.querySelector('.sb2-cols');
    const cur = wrap.querySelector('.on');
    if (cur) wrap.scrollLeft = cur.offsetLeft - wrap.clientWidth + cur.offsetWidth * 3;
  });
  return el;
}

/** (예전) 시즌별 합계와 보스별 점수 막대·선 그래프 (SVG) — 쓰지 않음 */
function chart(totals) {
  const data = totals.filter((t) => t.total > 0);
  if (data.length < 1) return h('div.empty', h('p', '점수를 기록하면 시즌별 추이가 여기에 그려집니다.'));
  const W = Math.max(900, data.length * 64), H = 260, padL = 56, padR = 16, padT = 16, padB = 40;
  const max = Math.max(...data.map((d) => d.total)) * 1.08;
  const x = (i) => padL + (data.length === 1 ? (W - padL - padR) / 2 : i * ((W - padL - padR) / (data.length - 1)));
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': '시즌별 합계 점수 그래프' });
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    svg.append(el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': 1 }));
    svg.append(el('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end' }, v >= 10000 ? `${Math.round(v / 10000)}만` : Math.round(v).toLocaleString('ko-KR')));
  }
  const barW = Math.min(30, (W - padL - padR) / data.length * 0.5);
  const colors = ['var(--star)', 'var(--plant)', 'var(--beast)', 'var(--spirit)'];
  data.forEach((d, i) => {
    let acc = 0;
    d.bosses.forEach((b, j) => {
      if (!b.score) return;
      const y0 = y(acc), y1 = y(acc + b.score);
      const r = el('rect', { x: x(i) - barW / 2, y: y1, width: barW, height: Math.max(0, y0 - y1), fill: colors[j % colors.length], opacity: 0.75 });
      r.append(el('title', {}, `${d.version} ${b.name}: ${b.score.toLocaleString('ko-KR')}`));
      svg.append(r);
      acc += b.score;
    });
    svg.append(el('text', { x: x(i), y: H - padB + 18, 'text-anchor': 'middle' }, d.version));
  });
  if (data.length > 1) {
    svg.append(el('polyline', { points: data.map((d, i) => `${x(i)},${y(d.total)}`).join(' '), fill: 'none', stroke: 'var(--brass-bright)', 'stroke-width': 2 }));
  }
  data.forEach((d, i) => {
    const c = el('circle', { cx: x(i), cy: y(d.total), r: 4, fill: 'var(--brass-bright)' });
    c.append(el('title', {}, `${d.version} 합계 ${d.total.toLocaleString('ko-KR')}`));
    svg.append(c);
  });
  return h('div.panel',
    h('div.chart-wrap', svg),
    h('div.legend',
      h('span', h('i', { style: { background: 'var(--brass-bright)' } }), '시즌 합계'),
      ['첫째', '둘째', '셋째'].map((n, j) => h('span', h('i', { style: { background: colors[j] } }), `${n} 보스`)),
    ),
  );
}

function bestList() {
  const types = new Map();
  for (const s of allSeasons()) for (const b of s.bosses) {
    const key = bossKey(b);
    const r = rec(s.id, b.stage);
    if (!r?.score) continue;
    const cur = types.get(key);
    if (!cur || +r.score > cur.score) types.set(key, { score: +r.score, s, b });
  }
  if (!types.size) return h('p.muted', '아직 기록이 없습니다.');
  return h('div.best-list', [...types.values()].sort((a, b) => b.score - a.score).map(({ score, s, b }) =>
    h('button.best', { type: 'button', style: { textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }, onclick: () => { view.season = s.id; rerender(); } },
      h('div.bimg', img(b.image, '')),
      h('div', h('b', b.name), h('span', `${fmt(score)} · ${s.version} 시즌`)),
    )));
}

/** 모든 시즌 기록에서 많이 출전한 출품작·의지 */
function usageStats() {
  const cc = new Map(), pc = new Map();
  let n = 0;
  for (const s of allSeasons()) for (const b of s.bosses) {
    const r = rec(s.id, b.stage);
    if (!r?.members?.length) continue;
    n++;
    for (const m of r.members) {
      if (m?.char) cc.set(m.char, (cc.get(m.char) || 0) + 1);
      if (m?.psychube) pc.set(m.psychube, (pc.get(m.psychube) || 0) + 1);
    }
  }
  if (!n) return h('p.muted', '덱을 남긴 기록이 없습니다.');
  const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  return h('div.panel.usage',
    h('p.faint', { style: { margin: '0 0 10px', fontSize: '13px' } }, `덱을 남긴 기록 ${n}개 기준`),
    h('div.usage-row', top(cc, 12).map(([id, k]) => {
      const c = store.charById(id);
      return c ? h('a.usage-item', { href: `#/roster/${id}`, title: store.charName(c) }, img(store.charPortrait(c), ''), h('small', store.charName(c)), h('b', `${k}회`)) : null;
    })),
    h('div.usage-row.psy', top(pc, 8).map(([id, k]) => {
      const p = store.psyById(id);
      return p ? h('span.usage-item', { title: p.name.ko }, img(p.icon, ''), h('small', p.name.ko), h('b', `${k}회`)) : null;
    })),
  );
}
