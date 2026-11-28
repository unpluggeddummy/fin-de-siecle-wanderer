// 갈기의 게시판 · 특별 관찰 — 공동 보도(괴이체 3명 점수 합산, 보스마다 8명: 조사 4 + 협동 4) 기록
import { h, img, fmt, drawer, field } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { teamView, teamEditor, charSelect } from '../components.js';
import { scoreBoard } from './bulletin.js';

const GRADES = ['', 'SSS+', 'SSS', 'SS', 'S', 'A', 'B', 'C'];
const view = { season: null, allBonds: false };

const seasons = () => store.state.game.observe || [];
const srec = (id) => store.state.user.observe?.seasons?.[id] || null;
const rec = (id, stage) => srec(id)?.bosses?.[stage] || null;
const total = (s) => s.bosses.reduce((a, b) => a + (+(rec(s.id, b.stage)?.score) || 0), 0);
const bestTotal = (s) => Math.max(total(s), +(srec(s.id)?.best) || 0);
const ids = (xs) => (xs || []).map((m) => m?.char).filter(Boolean);

/** 8명 구성에서 켜지는 협동 스킬 */
export function bondsFor(season, chars) {
  const tags = store.state.game.charTags || {};
  const uniq = [...new Set(chars)];
  return season.bonds.map((g) => {
    const who = uniq.filter((c) => {
      const t = tags[c] || {};
      return g.type === '영감' ? g.tags.includes(t.career) : (t.tags || []).some((x) => g.tags.includes(x));
    });
    const lv = [...g.levels].reverse().find((l) => who.length >= l.need) || null;
    const next = g.levels.find((l) => who.length < l.need) || null;
    return { g, who, lv, next };
  });
}
const clean = (s) => (s || '').replace(/<[^>]+>/g, '');

function bondChips(season, chars, { near = false } = {}) {
  const list = bondsFor(season, chars);
  const on = list.filter((x) => x.lv).sort((a, b) => b.lv.level - a.lv.level || b.who.length - a.who.length);
  const close = near ? list.filter((x) => !x.lv && x.who.length && x.next && x.next.need - x.who.length === 1) : [];
  if (!on.length && !close.length) return h('p.faint.obs-none', '켜진 협동 스킬 없음');
  return h('div.obs-bonds',
    on.map(({ g, who, lv }) => h('span.obs-bond', { title: `${g.name} ${lv.level}단계 (${who.length}명)\n${clean(lv.desc)}\n${who.map((c) => store.charName(store.charById(c))).join(', ')}` },
      h('b', g.name), h('em', `Lv.${lv.level}`), h('small', `${who.length}명`))),
    close.map(({ g, who, next }) => h('span.obs-bond.near', { title: `${g.name}: ${next.need}명이면 켜져요 (지금 ${who.length}명)\n${who.map((c) => store.charName(store.charById(c))).join(', ')}` },
      h('b', g.name), h('small', `1명 더`))));
}

/** 이 시즌에서 다른 보스에 협동으로 이미 쓴 출품작 (협동 캐릭터는 한 번만 출전) */
function coopUsedElsewhere(season, stage) {
  const m = new Map();
  for (const b of season.bosses) {
    if (b.stage === stage) continue;
    for (const c of ids(rec(season.id, b.stage)?.coop)) m.set(c, b);
  }
  return m;
}

function warnings(season, b, r) {
  const out = [];
  const eight = [...ids(r.members), ...ids(r.coop)];
  const dup = eight.filter((c, i) => eight.indexOf(c) !== i);
  if (dup.length) out.push(`같은 출품작이 두 번 들어갔어요: ${[...new Set(dup)].map((c) => store.charName(store.charById(c))).join(', ')}`);
  const used = coopUsedElsewhere(season, b.stage);
  const clash = ids(r.coop).filter((c) => used.has(c));
  if (clash.length) out.push(`다른 보스에서 이미 협동으로 쓴 출품작: ${clash.map((c) => `${store.charName(store.charById(c))}(${used.get(c).name})`).join(', ')}`);
  return out;
}

export function render(root) {
  const list = seasons();
  if (!list.length) {
    root.append(head(), h('div.empty', h('p', '아직 특별 관찰 시즌이 없어요. 게임에 열리면 자동으로 생겨요.')));
    return;
  }
  if (!view.season || !list.find((s) => String(s.id) === String(view.season))) view.season = list[list.length - 1].id;
  const season = list.find((s) => String(s.id) === String(view.season));

  root.append(
    head(),
    // 갈기의 게시판과 같은 점수판: 특별 관찰 시즌마다 기둥 하나 (기둥을 누르면 그 시즌으로)
    scoreBoard(list, list.map((x) => {
      const bosses = x.bosses.map((b) => ({ ...b, score: +(rec(x.id, b.stage)?.score) || 0 }));
      return { id: x.id, version: x.version, bosses, total: bosses.reduce((a, b) => a + b.score, 0) };
    }), season, (x) => { view.season = x.id; rerender(); }),
    summary(season),
    h('div.boss-grid', season.bosses.map((b) => bossCard(season, b))),
    rules(),
    h('details.obs-all', h('summary', h('h2.section', '이번 시즌 협동 스킬', h('small', '눌러서 펼치기'))), bondTable(season)),
  );
}

function head() {
  return h('div.page-head',
    h('div', h('h1', h('span.en', 'Special Observation'), '특별 관찰'),
      h('p', '갈기의 게시판 특별 관찰(공동 보도) 기록. 괴이체 셋의 점수를 합친 총점과, 보스마다 쓴 조사·협동 8명을 남깁니다.')));
}

function summary(season) {
  const best = bestTotal(season);
  return h('section.obs-sum',
    h('div.obs-tot',
      h('div', h('small', `${season.version} ${season.label} · 역대 최고 총점 (괴이체를 초기화하기 전 최고)`), h('b.obs-best', best ? fmt(best) : '—'),
        h('button.btn.small.ghost.edit-only', { type: 'button', onclick: () => editBest(season) }, '고치기'))),
  );
}

function editBest(season) {
  const v = prompt('역대 최고 총점 (게임 화면의 숫자)', srec(season.id)?.best || bestTotal(season) || '');
  if (v === null) return;
  store.update('observe', (u) => { u.seasons ||= {}; u.seasons[season.id] ||= { bosses: {} }; u.seasons[season.id].best = v.replace(/[^\d]/g, '') ? +v.replace(/[^\d]/g, '') : ''; });
}

function bossCard(season, b) {
  const r = rec(season.id, b.stage) || {};
  const has = ids(r.members).length || ids(r.coop).length;
  const warn = warnings(season, b, r);
  return h('article.boss.obs-boss',
    h('div.boss-top',
      b.image ? img(b.image, '') : null,
      h('div.bt', h('h3', b.name || `괴이체 ${b.stage}`), h('p', b.nameEn || '')),
      h('div.boss-score', r.score ? h('span.val', fmt(r.score)) : h('span.val.none', '기록 없음'), r.grade ? h('span.grade', r.grade) : null)),
    h('div.boss-body',
      has ? h('div.obs-team', h('p.obs-lbl', '조사'), teamView(r.members || [])) : null,
      has ? h('div.obs-team.coop', h('p.obs-lbl', '협동'), teamView((r.coop || []).map((m) => (m?.char ? { char: m.char } : null)))) : null,
      r.friend ? h('p.faint.obs-friend', `친구에게 빌린 출품작 · ${store.charName(store.charById(r.friend))}`) : null,
      has ? bondChips(season, [...ids(r.members), ...ids(r.coop)]) : null,
      warn.map((w) => h('p.obs-warn', w)),
      r.note ? h('p.boss-note', r.note) : null,
      h('button.btn.small.edit-only', { type: 'button', onclick: () => editBoss(season, b) }, r.score || has ? '기록 고치기' : '기록 남기기'),
    ));
}

function editBoss(season, b) {
  const cur = JSON.parse(JSON.stringify(rec(season.id, b.stage) || { score: '', grade: '', members: [], coop: [], friend: null, note: '' }));
  cur.coop ||= [];
  const commit = () => store.update('observe', (u) => {
    u.seasons ||= {};
    const s = (u.seasons[season.id] ||= { bosses: {} });
    s.bosses ||= {};
    cur.date ||= new Date().toISOString().slice(0, 10);
    s.bosses[b.stage] = cur;
    const t = season.bosses.reduce((a, bb) => a + (+(s.bosses[bb.stage]?.score) || 0), 0);
    if (t > (+s.best || 0)) s.best = t;   // 현재 총점이 최고 기록을 넘으면 역대 최고도 바뀐다
  }, { silent: true });

  const teamBox = h('div');
  const coopBox = h('div');
  const friendBox = h('div');
  const bondBox = h('div');
  const warnBox = h('div');
  const refresh = () => {
    bondBox.replaceChildren(bondChips(season, [...ids(cur.members), ...ids(cur.coop)], { near: true }));
    warnBox.replaceChildren(...warnings(season, b, cur).map((w) => h('p.obs-warn', w)));
    const eight = [...new Set([...ids(cur.members), ...ids(cur.coop)])];
    if (cur.friend && !eight.includes(cur.friend)) cur.friend = null;
    friendBox.replaceChildren(h('select', { onchange: (e) => { cur.friend = e.target.value ? +e.target.value : null; commit(); } },
      h('option', { value: '' }, '없음'),
      eight.map((c) => h('option', { value: c, selected: cur.friend === c }, store.charName(store.charById(c))))));
  };
  const drawTeam = () => teamBox.replaceChildren(teamEditor(cur.members || [], (m) => { cur.members = m; commit(); drawTeam(); refresh(); }));
  const used = coopUsedElsewhere(season, b.stage);
  const drawCoop = () => coopBox.replaceChildren(h('div.slot-edit',
    h('p.faint', { style: { margin: 0, fontSize: '12.5px' } }, '협동 출품작은 육성하지 않아도 협동 스킬만 더해 줘요. 한 시즌에 한 번만 쓸 수 있어요.'),
    [0, 1, 2, 3].map((i) => {
      const m = cur.coop[i] || {};
      return h('div.slot-row',
        h('div.mini', m.char ? img(store.charPortrait(store.charById(m.char)), '') : null),
        charSelect(m.char, (v) => { cur.coop[i] = v ? { char: v } : null; commit(); drawCoop(); refresh(); }, { label: `협동 ${i + 1}` }),
        m.char && used.has(m.char) ? h('small.obs-warn', `${used.get(m.char).name}에서 사용`) : h('span'));
    })));
  drawTeam(); drawCoop(); refresh();

  const body = [
    h('div.fields.form-row',
      field('점수', h('input', { type: 'number', min: 0, inputmode: 'numeric', value: cur.score || '', onchange: (e) => { cur.score = e.target.value ? +e.target.value : ''; commit(); } })),
      field('등급', h('select', { onchange: (e) => { cur.grade = e.target.value; commit(); } }, GRADES.map((g) => h('option', { value: g, selected: (cur.grade || '') === g }, g || '—'))))),
    h('div.form-row', h('div.lbl', h('span', '조사 출품작 (의지 장착)')), teamBox),
    h('div.form-row', h('div.lbl', h('span', '협동 출품작')), coopBox),
    h('div.form-row', h('div.lbl', h('span', '켜진 협동 스킬')), bondBox, warnBox),
    h('div.form-row', h('div.lbl', h('span', '친구에게 빌린 출품작')), friendBox),
    h('div.fields.form-row', field('메모 (패턴, 순서, 다음에 바꿀 것)', h('textarea', { rows: 4, onchange: (e) => { cur.note = e.target.value; commit(); } }, cur.note || ''), 'wide')),
  ];
  const d = drawer({ title: `${season.version} 특별 관찰 · ${b.name}`, wide: true, body, onClose: () => rerender(),
    foot: [
      h('button.btn.danger', { type: 'button', onclick: () => {
        if (!confirm('이 괴이체 기록을 지울까요?')) return;
        store.update('observe', (u) => { delete u.seasons?.[season.id]?.bosses?.[b.stage]; }, { silent: true });
        d.close();
      } }, '기록 지우기'),
      h('button.btn.primary', { type: 'button', onclick: () => d.close() }, '완료')] });
}

function rules() {
  return h('details.panel.obs-rules',
    h('summary', '특별 관찰 규칙 요약'),
    h('ul',
      h('li', '공동 보도는 괴이체 세 명의 점수를 더한 값이 현재 총점이에요. 현재 총점이 최고를 넘으면 역대 최고 총점이 바뀌어요.'),
      h('li', '괴이체마다 서로 다른 8명을 써요. 조사 출품작 4명이 의지를 끼고 싸우고, 협동 출품작 4명은 협동 스킬만 더해 줘요.'),
      h('li', '협동 출품작은 육성이 필요 없지만, 한 괴이체에 쓰면 잠겨서 다른 괴이체에는 못 써요. 그 괴이체 기록을 초기화하면 풀리는 대신 점수가 0이 돼요.'),
      h('li', '협동 스킬은 8명 전원의 영감·빌드 태그로 켜지고, 같은 태그가 많을수록 단계가 올라가요.'),
      h('li', '친구 출품작 1명을 빌려 조사나 협동에 쓸 수 있어요.'),
      h('li', '일반 보도는 지금까지의 갈기의 게시판과 같아서, 그 기록은 갈기의 게시판 메뉴에 남겨요.')));
}

function bondTable(season) {
  if (!season.bonds.length) return h('p.muted', '협동 스킬 자료가 없어요.');
  const types = ['영감', '빌드', '특수'];
  return h('div.obs-table', types.map((t) => {
    const gs = season.bonds.filter((g) => g.type === t);
    if (!gs.length) return null;
    return h('div.panel',
      h('h3', t === '영감' ? '영감 협동' : t === '빌드' ? '빌드 협동' : '특수 협동'),
      h('dl', gs.map((g) => [h('dt', g.name), h('dd', g.levels.map((l) => h('div', h('b', `${l.need}명`), ' ', clean(l.desc))))])));
  }));
}
