// 육성 계획 — 목표 통찰·레벨·공명·광상까지 필요한 재료 계산 (kornblume 데이터 기반)
import { h, fill, img, fmt, drawer, field, stepper, uid, toast } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { charSelect, ROMAN } from '../components.js';

const view = { showDone: false };

function levelRow(rarity, insight) {
  return store.state.game.materials.levels?.find((r) => r.Rarity.includes(rarity) && r.Insight === insight);
}

/** 계획 하나에 필요한 재료 { 영문 재료명: 수량 } */
export function planCost(p) {
  const c = store.charById(p.char);
  const g = store.state.game.materials.growth[p.char];
  const out = {};
  const add = (name, q) => { if (q) out[name] = (out[name] || 0) + q; };
  if (!c) return out;
  const f = p.from, t = p.to;
  // 레벨 (통찰 단계별로 나눠 계산)
  for (let ins = f.insight; ins <= t.insight; ins++) {
    const row = levelRow(c.rarity, ins);
    if (!row) continue;
    const lvMax = Math.max(...Object.keys(row.Levels).map(Number));
    const start = ins === f.insight ? f.level + 1 : 2;
    const end = ins === t.insight ? t.level : lvMax;
    for (let lv = start; lv <= end; lv++) for (const [m, q] of Object.entries(row.Levels[lv] || {})) add(m, q);
  }
  if (g) {
    for (const s of g.insight || []) if (s.Id > f.insight && s.Id <= t.insight) s.Material.forEach((m, i) => add(m, s.Quantity[i]));
    for (const s of g.resonance || []) if (s.Id > f.resonance && s.Id <= t.resonance) s.Material.forEach((m, i) => add(m, s.Quantity[i]));
    for (const s of g.euphoria || []) if ((t.euphoria || []).includes(s.Id) && !(f.euphoria || []).includes(s.Id)) s.Material.forEach((m, i) => add(m, s.Quantity[i]));
  }
  return out;
}

const RAR = (en) => store.state.game.materials.items[en]?.rarity || 0;

export function render(root, { arg }) {
  const u = store.state.user.plans;
  const editing = store.state.editing;
  const active = u.plans.filter((p) => !p.done);
  const shown = view.showDone ? u.plans : active;

  const totals = {};
  for (const p of active) if (!p.paused) for (const [m, q] of Object.entries(planCost(p))) totals[m] = (totals[m] || 0) + q;
  const mats = Object.entries(totals).sort((a, b) => {
    const order = (n) => (n === 'Sharpodonty' ? -2 : n === 'Dust' ? -1 : 0);
    return order(a[0]) - order(b[0]) || RAR(b[0]) - RAR(a[0]) || store.materialName(a[0]).localeCompare(store.materialName(b[0]), 'ko');
  });
  const shortCount = mats.filter(([m, q]) => (u.inventory[m] || 0) < q).length;

  root.append(
    h('div.page-head',
      h('div', h('h1', h('span.en', 'Growth Planner'), '육성 계획'), h('p', '목표를 정하면 필요한 재료를 모두 더해 보여 줍니다. 오른쪽 칸에 가진 재료 수를 적으면 부족한 양을 알 수 있어요.')),
      h('div.toolbar', { style: { margin: 0 } },
        h('label.check', h('input', { type: 'checkbox', checked: view.showDone, onchange: (e) => { view.showDone = e.target.checked; rerender(); } }), '완료한 계획도 보기'),
        h('button.btn.primary.edit-only', { type: 'button', onclick: () => edit(null) }, '새 계획')),
    ),
    h('div.plan-layout',
      h('div', shown.length ? shown.map(planRow) : h('div.empty', h('p', '진행 중인 계획이 없습니다.'),
        h('p.faint', '출품작 화면에서 "육성 계획 만들기"를 눌러도 시작할 수 있어요.'))),
      h('aside.panel.mat-sticky',
        h('div.panel-head', h('h3', '필요한 재료 합계'), mats.length ? h('span.faint', { style: { fontSize: '13px' } }, shortCount ? `부족 ${shortCount}종` : '모두 충분') : null),
        mats.length ? h('div.mats', mats.map(([m, q]) => matRow(m, q, editing))) : h('p.muted', { style: { margin: 0 } }, '계획을 추가하면 여기에 재료가 쌓입니다.'),
      ),
    ),
  );

  if (arg && arg.startsWith('new/') && editing) {
    const cid = +arg.split('/')[1];
    history.replaceState(null, '', '#/plans');
    setTimeout(() => edit(null, cid), 0);
  }
}

function matRow(m, need, editing) {
  const it = store.state.game.materials.items[m];
  const have = store.state.user.plans.inventory[m] || 0;
  const short = need - have;
  return h('div.mat',
    h('div.mi', it?.icon ? img(it.icon, '') : null),
    h('div', h('div', store.materialName(m)),
      editing ? h('input', { type: 'number', min: 0, value: have || '', placeholder: '보유', 'aria-label': `${store.materialName(m)} 보유 수`,
        onchange: (e) => store.update('plans', (s) => { const v = Math.max(0, +e.target.value || 0); if (v) s.inventory[m] = v; else delete s.inventory[m]; }) })
        : (have ? h('small.faint', `보유 ${fmt(have)}`) : null)),
    h('div.q' + (short > 0 ? '.short' : '.ok'), fmt(need), h('small', short > 0 ? `${fmt(short)} 부족` : '충분')),
  );
}

function describe(p) {
  const f = p.from, t = p.to, bits = [];
  if (f.insight !== t.insight || f.level !== t.level) bits.push(`통찰 ${ROMAN[f.insight]}·${f.level} → ${ROMAN[t.insight]}·${t.level}`);
  if (f.resonance !== t.resonance) bits.push(`공명 ${f.resonance} → ${t.resonance}`);
  const eu = (t.euphoria || []).filter((x) => !(f.euphoria || []).includes(x));
  if (eu.length) bits.push(`광상 ${eu.map((x) => ROMAN[x]).join('·')} 해금`);
  return bits.join(' · ') || '목표 없음';
}

function planRow(p) {
  const c = store.charById(p.char);
  const cost = planCost(p);
  const sharp = cost.Sharpodonty || 0;
  return h('div.plan' + (p.done ? '.done' : ''),
    h('div.mini', img(store.charPortrait(c), '')),
    h('div', h('b', store.charName(c)), p.paused ? h('span.tag', { style: { marginLeft: '8px' } }, '보류') : null,
      h('div.steps', describe(p)),
      h('div.steps', { style: { color: 'var(--paper-faint)' } }, `재료 ${Object.keys(cost).length}종${sharp ? ` · ${store.materialName('Sharpodonty')} ${fmt(sharp)}` : ''}`),
      p.note ? h('div.steps', p.note) : null),
    h('div.edit-only', { style: { display: 'grid', gap: '4px' } },
      p.done ? null : h('button.btn.small', { type: 'button', onclick: () => finish(p) }, '완료'),
      h('button.btn.small.ghost', { type: 'button', onclick: () => edit(p) }, '고치기')),
  );
}

function finish(p) {
  const apply = confirm(`${store.charName(store.charById(p.char))}의 계획을 완료로 표시합니다.\n출품작 육성 상태도 목표값으로 바꿀까요? (취소를 누르면 계획만 완료 처리)`);
  store.update('plans', (s) => { const x = s.plans.find((y) => y.id === p.id); x.done = true; x.doneAt = new Date().toISOString().slice(0, 10); }, { silent: true });
  if (apply) {
    store.update('roster', () => {
      const r = store.ensureChar(p.char);
      r.owned = true; r.insight = p.to.insight; r.level = p.to.level; r.resonance = p.to.resonance;
      const set = new Set([...(r.euphorias || (r.euphoria ? [r.euphoria] : [])), ...(p.to.euphoria || [])]);
      r.euphorias = [...set].sort();
      if (!r.euphoria && r.euphorias.length) r.euphoria = r.euphorias[0];
    }, { silent: true });
  }
  rerender();
  toast('계획을 완료했습니다.');
}

function edit(plan, presetChar) {
  const isNew = !plan;
  const fromRec = (cid) => {
    const r = store.charRecord(cid) || {};
    return { insight: r.insight || 0, level: r.level || 1, resonance: r.resonance || 1, euphoria: r.euphorias || (r.euphoria ? [r.euphoria] : []) };
  };
  const cur = plan ? JSON.parse(JSON.stringify(plan)) : { id: uid(), char: presetChar || null, from: fromRec(presetChar), to: null, note: '', done: false };
  if (!cur.to && cur.char) {
    const c = store.charById(cur.char);
    const mi = store.maxInsight(c.rarity);
    cur.to = { insight: mi, level: store.maxLevel(c.rarity, mi), resonance: Math.max(cur.from.resonance, Math.min(10, maxRes(c))), euphoria: [...cur.from.euphoria] };
  }
  const box = h('div');
  const summary = h('div');
  const commit = () => {
    if (!cur.char) return;
    store.update('plans', (s) => { const i = s.plans.findIndex((x) => x.id === cur.id); if (i >= 0) s.plans[i] = cur; else s.plans.push(cur); }, { silent: true });
    drawSummary();
  };

  function drawSummary() {
    if (!cur.char) { summary.replaceChildren(); return; }
    const cost = Object.entries(planCost(cur)).sort((a, b) => RAR(b[0]) - RAR(a[0]));
    summary.replaceChildren(h('div.panel', { style: { marginTop: '6px' } },
      h('h3', { style: { fontSize: '15px' } }, '이 계획에 필요한 재료'),
      cost.length ? h('div.mats', cost.map(([m, q]) => matRow(m, q, false))) : h('p.muted', { style: { margin: 0 } }, '현재와 목표가 같습니다.')));
  }

  function draw() {
    const c = cur.char && store.charById(cur.char);
    const parts = [h('div.fields.form-row', field('출품작', charSelect(cur.char, (v) => {
      cur.char = v; cur.from = fromRec(v); cur.to = null;
      if (v) { const cc = store.charById(v); const mi = store.maxInsight(cc.rarity); cur.to = { insight: mi, level: store.maxLevel(cc.rarity, mi), resonance: Math.max(cur.from.resonance, Math.min(10, maxRes(cc))), euphoria: [...cur.from.euphoria] }; }
      commit(); draw();
    }, { allowEmpty: true }), 'wide'))];
    if (c) {
      const mi = store.maxInsight(c.rarity);
      const side = (key, label) => {
        const s = cur[key];
        const lv = h('input', { type: 'number', min: 1, max: store.maxLevel(c.rarity, s.insight), value: s.level, 'aria-label': `${label} 레벨`,
          onchange: (e) => { s.level = Math.max(1, Math.min(store.maxLevel(c.rarity, s.insight), +e.target.value || 1)); e.target.value = s.level; commit(); } });
        return h('div.panel', { style: { padding: '12px', marginTop: 0 } },
          h('h3', { style: { fontSize: '15px' } }, label),
          h('div.form-row', h('div.lbl', h('span', '통찰')), stepper(Array.from({ length: mi + 1 }, (_, i) => i), s.insight, (v) => {
            s.insight = v; const mx = store.maxLevel(c.rarity, v); lv.max = mx; if (s.level > mx) { s.level = mx; lv.value = mx; } commit();
          }, (v) => ROMAN[v])),
          h('div.fields', field('레벨', lv),
            field('공명', h('select', { onchange: (e) => { s.resonance = +e.target.value; commit(); } },
              Array.from({ length: maxRes(c) }, (_, i) => i + 1).map((v) => h('option', { value: v, selected: s.resonance === v }, v))))),
          c.euphoria ? h('div.form-row', { style: { marginTop: '10px', marginBottom: 0 } }, h('div.lbl', h('span', '광상 해금')),
            h('div.chips', Array.from({ length: c.euphoria }, (_, i) => i + 1).map((n) => h('button.chip', { type: 'button', 'aria-pressed': String(s.euphoria.includes(n)),
              onclick: (e) => { s.euphoria = s.euphoria.includes(n) ? s.euphoria.filter((x) => x !== n) : [...s.euphoria, n]; e.currentTarget.setAttribute('aria-pressed', String(s.euphoria.includes(n))); commit(); } }, `광상 ${ROMAN[n]}`)))) : null,
        );
      };
      parts.push(
        h('div', { style: { display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: '14px' } }, side('from', '현재'), side('to', '목표')),
        h('div.form-row', h('label.check', h('input', { type: 'checkbox', checked: !!cur.paused, onchange: (e) => { cur.paused = e.target.checked; commit(); } }), '보류 (합계에서 빼기)')),
        h('div.fields.form-row', field('메모', h('textarea', { rows: 2, oninput: (e) => { cur.note = e.target.value; commit(); } }, cur.note || ''), 'wide')),
        store.state.game.materials.growth[c.id] ? null : h('p.status.err', '이 출품작은 아직 재료 데이터가 없어 레벨 비용만 계산됩니다.'),
      );
    }
    fill(box, parts);
    drawSummary();
  }
  draw();
  commit();
  const foot = [
    isNew ? null : h('button.btn.danger', { type: 'button', onclick: () => {
      if (!confirm('이 계획을 지울까요?')) return;
      store.update('plans', (s) => { s.plans = s.plans.filter((x) => x.id !== cur.id); }, { silent: true }); d.close();
    } }, '삭제'),
    plan?.done ? h('button.btn', { type: 'button', onclick: () => { cur.done = false; commit(); d.close(); } }, '다시 진행') : null,
    h('button.btn.primary', { type: 'button', onclick: () => d.close() }, '완료'),
  ];
  const d = drawer({ title: isNew ? '새 육성 계획' : `${store.charName(store.charById(cur.char))} 계획`, body: [box, summary], foot, wide: true, onClose: () => rerender() });
}

function maxRes(c) {
  const g = store.state.game.materials.growth[c.id];
  return g?.resonance?.length ? Math.max(...g.resonance.map((x) => x.Id)) : (c.rarity >= 6 ? 15 : 10);
}
