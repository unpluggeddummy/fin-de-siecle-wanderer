// 모집 기록 — 천장 카운트, 재화, 배너별 투입량과 결과, 다음 위시리스트
import { h, fill, fmt, drawer, field, uid, toast } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { face, charSelect } from '../components.js';

const TYPES = ['한정', '상시', '복각', '신규 유저', '기타'];

export function render(root) {
  const g = store.state.user.gacha;
  g.wishlist ||= [];
  const editing = store.state.editing;
  const totalPulls = g.banners.reduce((a, b) => a + (+b.pulls || 0), 0);
  const sixes = g.banners.flatMap((b) => (b.results || []).filter((r) => (store.charById(r.char)?.rarity || r.rarity) === 6));
  const limit = g.pityLimit || 70;
  const set = (fn) => store.update('gacha', fn);

  root.append(
    h('div.page-head', h('div', h('h1', h('span.en', 'Summon Log'), '모집 기록'), h('p', '배너마다 몇 번 돌렸고 무엇이 나왔는지, 지금 천장까지 얼마나 남았는지 기록합니다.'))),
    h('section.panel',
      h('div.pity',
        h('div', h('div.faint', { style: { fontSize: '13px' } }, '현재 천장 카운트'),
          h('div.pity-num', g.pity || 0, h('small', ` / ${limit}`))),
        h('div.pity-bar',
          h('div.meter', h('i', { style: { width: `${Math.min(100, ((g.pity || 0) / limit) * 100)}%`, background: (g.pity || 0) >= 60 ? 'var(--rust)' : 'var(--brass)' } })),
          h('div.marks', h('span', '0'), h('span', '60 · 확률 상승'), h('span', `${limit} · 확정`)),
          h('div.muted', { style: { fontSize: '13px', marginTop: '6px' } }, `6성까지 최대 ${Math.max(0, limit - (g.pity || 0))}회`, g.guaranteed ? ' · 다음 6성은 픽업 확정' : '')),
        h('div.edit-only', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          h('button.btn.small', { type: 'button', onclick: () => set((s) => { s.pity = (s.pity || 0) + 1; }) }, '+1'),
          h('button.btn.small', { type: 'button', onclick: () => set((s) => { s.pity = (s.pity || 0) + 10; }) }, '+10'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => set((s) => { s.pity = 0; }) }, '0으로'),
          h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: !!g.guaranteed, onchange: (e) => set((s) => { s.guaranteed = e.target.checked; }) }), '픽업 확정'),
        ),
      ),
      editing ? h('div.fields', { style: { marginTop: '14px', maxWidth: '320px' } },
        field('천장 카운트', h('input', { type: 'number', min: 0, value: g.pity || 0, onchange: (e) => set((s) => { s.pity = Math.max(0, +e.target.value || 0); }) })),
        field('확정 횟수', h('input', { type: 'number', min: 1, value: limit, onchange: (e) => set((s) => { s.pityLimit = Math.max(1, +e.target.value || 70); }) }))) : null,
    ),
    h('section.panel',
      h('div.panel-head', h('h3', '모아 둔 재화'), h('button.btn.small.edit-only', { type: 'button', onclick: () => set((s) => { s.currencies.push({ name: '새 재화', amount: 0 }); }) }, '재화 추가')),
      h('div.currency', g.currencies.map((cu, i) => h('div.cur',
        editing ? h('input', { type: 'text', value: cu.name, 'aria-label': '재화 이름', onchange: (e) => store.update('gacha', (s) => { s.currencies[i].name = e.target.value; }, { silent: true }) }) : h('span', cu.name),
        editing ? h('input', { type: 'number', min: 0, value: cu.amount, 'aria-label': `${cu.name} 수량`, onchange: (e) => store.update('gacha', (s) => { s.currencies[i].amount = +e.target.value || 0; }, { silent: true }) }) : h('b', fmt(cu.amount)),
        editing ? h('button.btn.small.ghost', { type: 'button', onclick: () => set((s) => { s.currencies.splice(i, 1); }) }, '빼기') : null,
      ))),
      g.currencies.length ? h('p.faint', { style: { fontSize: '13px', margin: '10px 0 0' } }, `빗방울 기준 약 ${fmt(Math.floor(estimatePulls(g)))}회 모집 가능 (빗방울 180개 = 1회, 모노로그 1개 = 1회, 데카로그 1개 = 10회로 계산)`) : null,
    ),
    h('section.panel',
      h('div.panel-head', h('h3', '다음 픽업 위시리스트'), h('button.btn.small.edit-only', { type: 'button', onclick: () => editWish(null) }, '추가')),
      g.wishlist.length ? h('div', { style: { display: 'grid', gap: '8px' } }, g.wishlist.map((w, i) => h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
        face(w.char), h('div', { style: { flex: 1 } }, h('b', store.charName(store.charById(w.char))), h('div.faint', { style: { fontSize: '13px' } }, [w.when, w.goal, w.note].filter(Boolean).join(' · '))),
        h('button.btn.small.ghost.edit-only', { type: 'button', onclick: () => editWish(i) }, '고치기')))) : h('p.muted', { style: { margin: 0 } }, '비어 있습니다.'),
    ),
    h('h2.section', '배너 기록'),
    h('div.toolbar',
      h('span.muted', `총 ${fmt(totalPulls)}회 · 6성 ${sixes.length}명${sixes.length ? ` · 6성 1명당 평균 ${(totalPulls / sixes.length).toFixed(1)}회` : ''}`),
      h('span', { style: { flex: 1 } }),
      h('button.btn.primary.edit-only', { type: 'button', onclick: () => editBanner(null) }, '배너 추가'),
    ),
    g.banners.length ? h('div.banner-list', [...g.banners].reverse().map(bannerCard)) : h('div.empty', h('p', '아직 기록한 배너가 없습니다.')),
  );
}

function estimatePulls(g) {
  let n = 0;
  for (const c of g.currencies) {
    if (/데카로그|decalog/i.test(c.name)) n += (+c.amount || 0) * 10;
    else if (/모노로그|unilog|티켓/i.test(c.name)) n += +c.amount || 0;
    else if (/빗방울|rain/i.test(c.name)) n += (+c.amount || 0) / 180;
  }
  return n;
}

function bannerCard(b) {
  const res = b.results || [];
  const ref = b.ref && store.summonById(b.ref);
  return h('article.banner' + (ref?.banner ? '.has-img' : ''),
    ref?.banner ? h('a.banner-img', { href: `#/timeline/${ref.version}`, title: `${ref.version} 연대기에서 보기` }, h('img', { src: ref.banner, alt: '', loading: 'lazy' })) : null,
    h('div.banner-head',
      h('div', h('h3', b.name), h('div.faint', { style: { fontSize: '13px' } }, [b.type, b.start, b.version ? `${b.version} 버전` : null].filter(Boolean).join(' · '))),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
        h('b', { style: { fontFamily: 'var(--serif)', fontSize: '20px' } }, `${fmt(b.pulls || 0)}회`),
        h('button.btn.small.edit-only', { type: 'button', onclick: () => editBanner(b) }, '고치기'))),
    res.length ? h('div.pulls', res.map((r) => {
      const c = store.charById(r.char);
      return h('span.pull' + ((c?.rarity || r.rarity) === 6 ? '.r6' : ''), face(r.char), store.charName(c), r.at ? h('em', `${r.at}회째`) : null, r.lost ? h('em', '픽뚫') : null);
    })) : h('span.faint', { style: { fontSize: '13px' } }, '결과 없음'),
    b.note ? h('p.boss-note', b.note) : null,
  );
}

function editBanner(b) {
  const isNew = !b;
  const cur = b ? JSON.parse(JSON.stringify(b)) : { id: uid(), name: '', type: '한정', start: new Date().toISOString().slice(0, 10), version: '', pulls: 0, results: [], note: '' };
  const commit = () => store.update('gacha', (s) => { const i = s.banners.findIndex((x) => x.id === cur.id); if (i >= 0) s.banners[i] = cur; else s.banners.push(cur); }, { silent: true });
  const resBox = h('div');
  const drawRes = () => fill(resBox,
    ...cur.results.map((r, i) => h('div.slot-row', { style: { gridTemplateColumns: '1fr 90px auto auto', marginBottom: '6px' } },
      charSelect(r.char, (v) => { r.char = v; commit(); }, { ownedFirst: false, label: '나온 출품작' }),
      h('input', { type: 'number', min: 1, value: r.at || '', placeholder: '몇 회째', 'aria-label': '몇 회째에 나왔는지', onchange: (e) => { r.at = +e.target.value || null; commit(); } }),
      h('label.check', { style: { fontSize: '13px' } }, h('input', { type: 'checkbox', checked: !!r.lost, onchange: (e) => { r.lost = e.target.checked; commit(); } }), '픽뚫'),
      h('button.btn.small.ghost', { type: 'button', 'aria-label': '빼기', onclick: () => { cur.results.splice(i, 1); commit(); drawRes(); } }, '×'))),
    h('button.btn.small', { type: 'button', onclick: () => { cur.results.push({ char: null, at: null }); drawRes(); } }, '결과 추가'),
  );
  drawRes();
  const ref = cur.ref && store.summonById(cur.ref);
  const pickList = h('div.su-pick');
  const picker = h('details.form-row.su-picker', { ontoggle: (e) => { if (e.target.open && !pickList.childElementCount) drawPick(); } },
    h('summary', ref ? `배너: ${ref.name.ko || ref.name.en} (${ref.version}) — 바꾸기` : '배너 도감에서 고르기 (그림·픽업 출품작이 같이 붙어요)'), pickList);
  const drawPick = () => fill(pickList, [...(store.state.game.versions || [])].sort((a, b) => store.verNum(b.id) - store.verNum(a.id)).map((v) => {
    const l = v.summons.filter((x) => x.six.length);
    return l.length ? h('div.su-pick-ver', h('b', store.verLabel(v.id, true)), h('div', l.map((x) => h('button', { type: 'button', 'aria-pressed': String(cur.ref === x.id), title: x.name.ko || x.name.en,
      onclick: () => {
        cur.ref = x.id; cur.name = x.name.ko || x.name.en; cur.version = v.id; cur.type = x.rerun ? '복각' : ['ripples', 'select'].includes(x.kind) ? '상시' : '한정';
        commit(); d.close(); editBanner(store.state.user.gacha.banners.find((y) => y.id === cur.id));
      } }, x.banner ? h('img', { src: x.banner, alt: '', loading: 'lazy' }) : null, h('span', x.name.ko || x.name.en))))) : null;
  }));
  const body = [
    picker,
    h('div.fields.form-row',
      field('배너 이름', h('input', { type: 'text', value: cur.name, placeholder: '예: 미스 스트레인저 픽업', oninput: (e) => { cur.name = e.target.value; commit(); } }), 'wide'),
      field('종류', h('select', { onchange: (e) => { cur.type = e.target.value; commit(); } }, TYPES.map((t) => h('option', { selected: cur.type === t }, t)))),
      field('버전', h('input', { type: 'text', value: cur.version || '', placeholder: '3.9', onchange: (e) => { cur.version = e.target.value; commit(); } })),
      field('시작일', h('input', { type: 'date', value: cur.start || '', onchange: (e) => { cur.start = e.target.value; commit(); } })),
      field('투입 횟수', h('input', { type: 'number', min: 0, value: cur.pulls || 0, onchange: (e) => { cur.pulls = +e.target.value || 0; commit(); } })),
    ),
    h('div.form-row', h('div.lbl', h('span', '나온 5·6성'), h('span.faint', '몇 회째에 나왔는지 적으면 평균이 계산돼요')), resBox),
    h('div.fields.form-row', field('메모', h('textarea', { rows: 3, oninput: (e) => { cur.note = e.target.value; commit(); } }, cur.note || ''), 'wide')),
    isNew ? h('p.faint', { style: { fontSize: '13px' } }, '나온 출품작은 출품작 화면에서 보유로 자동 표시돼요.') : null,
  ];
  const foot = [
    isNew ? null : h('button.btn.danger', { type: 'button', onclick: () => { if (!confirm('이 배너 기록을 지울까요?')) return; store.update('gacha', (s) => { s.banners = s.banners.filter((x) => x.id !== cur.id); }, { silent: true }); d.close(); } }, '삭제'),
    h('button.btn.primary', { type: 'button', onclick: () => d.close() }, '완료'),
  ];
  if (isNew) cur.name = '새 배너';
  commit();
  const d = drawer({ title: isNew ? '배너 추가' : cur.name, body, foot, wide: true, onClose: () => {
    // 나온 캐릭터를 보유로 표시
    const newly = cur.results.filter((r) => r.char && !store.charRecord(r.char)?.owned);
    if (newly.length) {
      store.update('roster', () => { for (const r of newly) store.ensureChar(r.char).owned = true; }, { silent: true });
      toast(`${newly.map((r) => store.charName(store.charById(r.char))).join(', ')}을(를) 보유로 표시했어요.`);
    }
    rerender();
  } });
}

function editWish(i) {
  const g = store.state.user.gacha;
  const cur = i === null ? { char: null, when: '', goal: '', note: '' } : { ...g.wishlist[i] };
  const body = [h('div.fields',
    field('출품작', charSelect(cur.char, (v) => { cur.char = v; }, { ownedFirst: false }), 'wide'),
    field('예상 시기', h('input', { type: 'text', value: cur.when, placeholder: '예: 4.0 후반', oninput: (e) => { cur.when = e.target.value; } })),
    field('목표', h('input', { type: 'text', value: cur.goal, placeholder: '예: 명함, P2', oninput: (e) => { cur.goal = e.target.value; } })),
    field('메모', h('textarea', { rows: 2, oninput: (e) => { cur.note = e.target.value; } }, cur.note), 'wide'))];
  const save = () => {
    if (!cur.char) { toast('출품작을 골라 주세요.', 'err'); return; }
    store.update('gacha', (s) => { s.wishlist ||= []; if (i === null) s.wishlist.push(cur); else s.wishlist[i] = cur; }, { silent: true });
    d.close();
  };
  const foot = [
    i === null ? null : h('button.btn.danger', { type: 'button', onclick: () => { store.update('gacha', (s) => { s.wishlist.splice(i, 1); }, { silent: true }); d.close(); } }, '삭제'),
    h('button.btn.primary', { type: 'button', onclick: save }, '저장'),
  ];
  const d = drawer({ title: '위시리스트', body, foot, onClose: () => rerender() });
}
