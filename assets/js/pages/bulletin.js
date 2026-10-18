// 갈기의 게시판 — 버전(시즌)별 보스 점수, 덱, 메모, 스크린샷
import { h, fill, img, fmt, drawer, field, toast, lightbox, pickFile, shrinkImage, uid } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { teamView, teamEditor } from '../components.js';

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

export function render(root) {
  const seasons = allSeasons();
  const editing = store.state.editing;
  const totals = seasonTotals();
  if (!view.season || !seasons.find((s) => String(s.id) === String(view.season))) {
    const lastRec = [...totals].reverse().find((t) => t.total > 0);
    view.season = (lastRec || seasons[seasons.length - 1])?.id;
  }
  const season = seasons.find((s) => String(s.id) === String(view.season));

  const bar = h('div.season-bar', { role: 'group', 'aria-label': '시즌 선택' },
    [...seasons].reverse().map((s) => {
      const t = totals.find((x) => x.id === s.id);
      return h('button' + (t.total ? '.has-record' : '') + (store.COLLAB[s.version] ? '.collab' : ''), { title: store.verLabel(s.version),
        type: 'button', 'aria-pressed': String(String(s.id) === String(view.season)),
        onclick: () => { view.season = s.id; rerender(); },
      }, store.COLLAB[s.version] ? [s.version, h('em.collab-name', store.COLLAB[s.version])] : `${s.version}`, h('small', t.total ? fmt(t.total) : '기록 없음'));
    }),
  );

  const t = totals.find((x) => x.id === season?.id);

  root.append(
    h('div.page-head',
      h('div', h('h1', h('span.en', 'Bulletin Board'), '갈기의 게시판'), h('p', '버전마다 바뀌는 보스와 내 점수, 그때 쓴 덱과 메모를 남깁니다.')),
      h('div.toolbar', { style: { margin: 0 } },
        h('button.btn.edit-only', { type: 'button', onclick: addSeason }, '새 시즌 추가'),
      ),
    ),
    bar,
    season ? h('div',
      h('div.toolbar', { style: { justifyContent: 'space-between' } },
        h('h2', { style: { fontSize: '22px' } }, store.COLLAB[season.version] ? `${season.version} · ${store.COLLAB[season.version]} 콜라보 시즌` : `${season.version} 시즌`,
          h('span.muted', { style: { fontFamily: 'var(--sans)', fontSize: '15px', fontWeight: 400, marginLeft: '12px' } }, `합계 ${fmt(t.total)}점`)),
        season.custom && editing ? h('button.btn.small.danger', { type: 'button', onclick: () => removeSeason(season) }, '이 시즌 삭제') : null,
      ),
      h('div.boss-grid', season.bosses.map((b) => bossCard(season, b))),
    ) : h('div.empty', h('p', '시즌 데이터가 없습니다.')),
    h('h2.section', '점수 추이'),
    chart(totals),
    h('h2.section', '보스별 최고 기록'),
    bestList(),
  );
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
  const shot = r.shot ? store.fileURL(r.shot) : null;

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
      r.note ? h('p.boss-note', r.note) : null,
      shot ? h('div.shot', { onclick: () => lightbox(shot, `${season.version} ${b.name}`) }, img(shot, '결과 스크린샷')) : null,
      h('button.btn.small.edit-only', { type: 'button', onclick: () => editBoss(season, b) }, r.score ? '기록 고치기' : '기록 남기기'),
    ),
  );
}

function editBoss(season, b) {
  const cur = JSON.parse(JSON.stringify(rec(season.id, b.stage) || { score: '', grade: '', members: [], note: '', shot: null }));
  const commit = () => store.update('bulletin', (s) => {
    s.seasons[season.id] ||= { bosses: {} };
    s.seasons[season.id].bosses[b.stage] = cur;
  }, { silent: true });

  const teamBox = h('div');
  const drawTeam = () => teamBox.replaceChildren(teamEditor(cur.members || [], (m) => { cur.members = m; commit(); drawTeam(); }));
  drawTeam();

  const shotBox = h('div');
  const drawShot = () => {
    const u = cur.shot ? store.fileURL(cur.shot) : null;
    fill(shotBox,
      u ? h('div.shot', { style: { marginBottom: '8px' } }, img(u, '결과 스크린샷')) : null,
      h('div.toolbar', { style: { margin: 0 } },
        h('button.btn.small', { type: 'button', onclick: async () => {
          const f = await pickFile('image/*');
          if (!f) return;
          try {
            const data = await shrinkImage(f);
            const ext = data.startsWith('data:image/webp') ? 'webp' : 'jpg';
            const path = `data/user/shots/bulletin-${season.id}-${b.stage}-${uid()}.${ext}`;
            store.addPendingFile(path, data);
            cur.shot = path; commit(); drawShot();
          } catch (e) { toast(`이미지를 읽지 못했습니다: ${e.message}`, 'err'); }
        } }, cur.shot ? '스크린샷 바꾸기' : '스크린샷 첨부'),
        cur.shot ? h('button.btn.small.ghost', { type: 'button', onclick: () => { cur.shot = null; commit(); drawShot(); } }, '빼기') : null,
      ),
    );
  };
  drawShot();

  const body = [
    b.image ? h('div', { style: { height: '120px', overflow: 'hidden', borderRadius: '8px', marginBottom: '14px', background: '#0b1714' } },
      h('img', { src: b.image, alt: '', style: { height: '150px', marginLeft: 'auto' } })) : null,
    h('div.fields.form-row',
      field('점수', h('input', { type: 'number', min: 0, inputmode: 'numeric', value: cur.score || '',
        onchange: (e) => { cur.score = e.target.value ? +e.target.value : ''; commit(); } })),
      field('등급', h('select', { onchange: (e) => { cur.grade = e.target.value; commit(); } },
        GRADES.map((g) => h('option', { value: g, selected: (cur.grade || '') === g }, g || '—')))),
      field('기록한 날', h('input', { type: 'date', value: cur.date || '', onchange: (e) => { cur.date = e.target.value; commit(); } })),
    ),
    h('div.form-row', h('div.lbl', h('span', '사용한 덱')), teamBox),
    h('div.fields.form-row',
      field('메모 (패턴, 실수한 점, 다음에 바꿀 것)', h('textarea', { rows: 4, onchange: (e) => { cur.note = e.target.value; commit(); } }, cur.note || ''), 'wide'),
    ),
    h('div.form-row', h('div.lbl', h('span', '결과 스크린샷')), shotBox),
    store.state.user.decks.decks.length ? h('div.form-row',
      h('div.lbl', h('span', '저장한 덱 불러오기')),
      h('select', { onchange: (e) => {
        const d = store.state.user.decks.decks.find((x) => x.id === e.target.value);
        if (d) { cur.members = JSON.parse(JSON.stringify(d.members)); commit(); drawTeam(); }
        e.target.value = '';
      } }, h('option', { value: '' }, '— 덱 고르기 —'), store.state.user.decks.decks.map((d) => h('option', { value: d.id }, d.name))),
    ) : null,
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

/** 시즌별 합계와 보스별 점수 막대·선 그래프 (SVG) */
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
