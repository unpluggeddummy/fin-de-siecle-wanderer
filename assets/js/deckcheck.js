// 덱 분석 — 스킬 설명(한국어 게임 데이터)에서 출품작마다 '하는 일'을 뽑아 내고,
// 그걸로 덱의 시너지·충돌을 짚어 주거나(검사), 보유 출품작으로 조합을 골라 준다(추천).
// 규칙 기반이라 정답은 아니고 '눈여겨볼 점'을 알려 주는 정도. 숫자 계산(딜량)은 하지 않는다.
// 이 파일은 store에 기대지 않는 순수 함수들이라 node에서도 시험할 수 있다.

export const AF_KO = { star: '천체', mineral: '암석', plant: '나무', beast: '야수', spirit: '영혼', intellect: '지능' };
const KO_AF = Object.fromEntries(Object.entries(AF_KO).map(([k, v]) => [v, k]));
// 영감 상성: 야수 → 나무 → 천체 → 암석 → 야수, 영혼 ↔ 지능
const BEATS = { beast: ['plant'], plant: ['star'], star: ['mineral'], mineral: ['beast'], spirit: ['intellect'], intellect: ['spirit'] };
const afList = (a) => (a === 'mineral-star' ? ['mineral', 'star'] : [a]);
/** 내 출품작이 보스(영감)에게: 1 유리 / -1 불리 / 0 보통 */
export function afVs(mine, boss) {
  if (!boss || !mine) return 0;
  const m = afList(mine);
  if (m.some((a) => BEATS[a]?.includes(boss))) return 1;
  if (m.some((a) => BEATS[boss]?.includes(a))) return -1;
  return 0;
}

const CONTROL = new Set(['기절', '석화', '빙결', '침묵', '매혹', '공포', '혼란', '수면', '봉인', '무장 해제', '악몽', '속박', '죽음의 공포']);
const AF_WORD = '(?:천체|암석|나무|야수|영혼|지능)';

/** 이 출품작 스킬 설명 모음 (마지막 단계 주문 + 최종 술식 + 통찰) */
function texts(sk) {
  const t = [];
  for (const s of sk.skills || []) if (s.levels?.length) t.push(s.levels[s.levels.length - 1]);
  if (sk.ultimate?.desc) t.push(sk.ultimate.desc);
  for (const p of sk.insight || []) t.push(p.desc);
  return t.filter(Boolean);
}
const sentences = (t) => t.split(/(?<=[.。])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const terms = (s) => [...s.matchAll(/\[([^\]]{1,20})\]/g)].map((m) => m[1].trim());

const cache = new Map();
/** 출품작 하나가 하는 일 */
export function traits(c, skills) {
  if (!c) return null;
  const key = c.id;
  if (cache.has(key) && cache.get(key).src === skills) return cache.get(key).t;
  const sk = skills?.chars?.[c.id];
  const kinds = skills?.kinds || {};
  const t = {
    id: c.id, role: c.role || '', af: c.afflatus, dmg: c.dmg, known: !!sk,
    heal: false, healAll: false, minorHeal: false, selfHeal: false, shield: false, teamBuff: false, debuff: false, moxie: false, crit: false,
    extra: false, control: [], zone: null, field: false, hpLossTeam: false, hpLossSelf: false, likesHpLoss: false,
    applies: new Set(), uses: new Set(), gives: new Set(), usesDebuff: false, usesControl: false,
    wantsAf: [], wantsDmg: null, notes: [],
  };
  if (sk) {
    for (const s of texts(sk).flatMap(sentences)) {
      const ally = /(모든 아군|아군 단일|아군 1명|다른 아군|아군 캐릭터|아군이|아군에게|아군의|아군 전체|가장 낮은 아군)/.test(s);
      const enemy = /(적군|목표|대상|적에게|적의)/.test(s);
      // 회복
      if (/(HP[^.]{0,14}회복|치료|회복량)/.test(s) && !/(열정|신기한 빛)[^.]{0,4}회복/.test(s)) {
        if (ally || /(광역 치료|단일 치료|치료율)/.test(s)) { t.heal = true; if (/(모든 아군|광역 치료|아군 전체)/.test(s)) t.healAll = true; }
        else t.selfHeal = true;
      }
      if (/흡혈/.test(s)) t.selfHeal = true;
      if (/보호막/.test(s) && (ally || /광역|아군/.test(s))) t.shield = true;
      // 아군 강화
      if (ally && /(증가|획득|부여|강화)/.test(s) && !/(HP[^.]{0,10}잃|열정)/.test(s.replace(/[^.]*?(증가|획득)/, '$1'))) t.teamBuff = true;
      if (/광역 강화|단일 강화/.test(s) && ally) t.teamBuff = true;
      if (ally && /치명타/.test(s) && /증가/.test(s)) t.crit = true;
      // 적 약화
      if (/(광역 약화|단일 약화|광역 디버프)/.test(s) || (/(모든 적군|목표|대상|적군)[^.]{0,25}(받는 [^.]{0,8}피해|방어|저항|공격)[^.]{0,12}(증가|감소)/.test(s) && !/자신/.test(s.slice(0, 6)))) t.debuff = true;
      // 열정 나눠 주기
      if (/(모든 아군|아군 단일|아군 1명|다른 아군|아군 캐릭터|아군이|아군에게)[^.]{0,25}열정\s*(\+|\d|획득|회복)/.test(s)) t.moxie = true;
      if (/(추가 행동|연속 행동|행동 횟수 \+)/.test(s)) t.extra = true;
      // 술진·역장
      const z = s.match(/술진\s*\[([^\]]+)\]|\[([^\]]+)\]\s*술진/);
      if (z && /설치|전개/.test(s)) t.zone = (z[1] || z[2]).trim();
      if (/역장/.test(s) && /(획득|설치|전개)/.test(s)) t.field = true;
      // HP 깎기
      if (/모든 아군이 현재 HP[^.]{0,8}잃/.test(s)) t.hpLossTeam = true;
      else if (/HP[^.]{0,10}잃/.test(s) && !/(아군이 행동|임의의 캐릭터)/.test(s)) t.hpLossSelf = true;
      if (/(HP를 1회 잃을 때마다|HP를 잃을 때마다)/.test(s)) t.likesHpLoss = true;
      // 상태: 거는 것 / 활용하는 것
      for (const n of terms(s)) {
        const kind = kinds[n];
        const re = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const usedHere = new RegExp(`\\[${re}\\]\\s*(상태(인|라면|일|의|에 있는|에 빠진)|을 보유|를 보유|보유|스택(당|에 따라|마다)|일 경우|상태일)`).test(s)
          || new RegExp(`(목표|대상|적군|적)[^.]{0,6}(가|이)\\s*\\[${re}\\]`).test(s);
        const putHere = new RegExp(`\\[${re}\\][^.]{0,14}(부여|빠짐|빠지|상태 부여)`).test(s) || new RegExp(`(부여|빠짐)[^.]{0,4}\\[${re}\\]`).test(s);
        if (kind === 'debuff' && putHere && (enemy || /적군|목표|대상/.test(s))) {
          t.applies.add(n);
          if (CONTROL.has(n)) t.control.push(n);
          t.debuff ||= !CONTROL.has(n);
        }
        if (kind === 'buff' && putHere && ally) t.gives.add(n);
        if (usedHere && !(putHere && !/(라면|일 경우|상태인|상태의)/.test(s))) t.uses.add(n);
      }
      if (/(디버프|상태 이상|부정 효과|약화 상태)[^.]{0,8}(상태인|보유|있는|개수|1개당)/.test(s)) t.usesDebuff = true;
      if (/제어[^.]{0,8}(상태|당하|받은)/.test(s)) t.usesControl = true;
      // 같이 있으면 좋은 영감/피해 유형
      const wa = s.match(new RegExp(`(?:다른 )?아군[^.]{0,20}?(${AF_WORD}(?:\\s*[,·/와과]\\s*${AF_WORD})*)\\s*영감`));
      if (wa) for (const w of wa[1].match(new RegExp(AF_WORD, 'g'))) if (!t.wantsAf.includes(KO_AF[w])) t.wantsAf.push(KO_AF[w]);
      const wd = s.match(/(\d)명 이상의 (현실|정신) 피해/);
      if (wd) t.wantsDmg = { n: +wd[1], type: wd[2] === '현실' ? 'reality' : 'mental' };
    }
    t.control = [...new Set(t.control)];
    // 공격형의 곁다리 회복(가장 낮은 아군 조금 회복 등)은 '회복 담당'으로 치지 않는다
    if (t.heal && t.role === '공격' && !t.healAll) { t.heal = false; t.minorHeal = true; }
    // 자기가 걸고 자기가 쓰는 건 '활용'에서 뺀다 (짝 찾기용)
    for (const n of t.applies) t.uses.delete(n) && t.notes.push(`스스로 거는 [${n}]를 활용`);
  }
  cache.set(key, { src: skills, t });
  return t;
}

const isDps = (t) => t.role === '공격' || (t.role === '밸런스' && !t.heal && !t.shield);
const isSupport = (t) => t.teamBuff || t.debuff || t.moxie || t.role === '보조';
const sustain = (t) => t.heal || t.shield;

/**
 * 덱 검사. members: [{char, psychube}] (1~4 모두 출전)
 * ctx: { skills, chars(id→c), record(id), current(verNum), verNum(fn), name(c), boss, maxInsight(rarity) }
 * 돌려줌: [{ lv: 'good'|'warn'|'bad'|'info', text }]
 */
export function check(members, ctx) {
  const out = [];
  const add = (lv, text) => out.push({ lv, text });
  const N = (c) => ctx.name(c);
  const slots = [0, 1, 2, 3].map((i) => members?.[i]?.char ? ctx.chars(members[i].char) : null);
  const act = slots.filter(Boolean);
  if (!act.length) return [{ lv: 'info', text: '1~4번 자리에 출품작을 넣으면 분석해 줘요.' }];
  const T = act.map((c) => traits(c, ctx.skills));

  // 같은 출품작 두 번
  const ids = slots.filter(Boolean).map((c) => c.id);
  if (new Set(ids).size !== ids.length) add('bad', '같은 출품작이 두 번 들어 있어요.');
  if (act.length < 4) add('info', `출전 자리가 ${4 - act.length}칸 비었어요.`);

  // 한섭 출시·보유
  for (const c of slots.filter(Boolean)) {
    if (ctx.verNum(c.version) > ctx.current) add('warn', `${N(c)}: 한섭에 아직 없는 출품작이에요 (${c.version}).`);
    else if (!ctx.record(c.id)?.owned) add('info', `${N(c)}: 아직 보유하지 않은 출품작이에요.`);
  }
  if (T.some((t) => !t.known)) add('info', `스킬 정보가 없는 출품작이 있어 그 출품작은 분석에서 빠졌어요: ${act.filter((c, i) => !T[i].known).map(N).join(', ')}`);

  // 술진·역장
  const zones = act.map((c, i) => [c, T[i].zone]).filter(([, z]) => z);
  if (zones.length >= 2) add('bad', `술진은 한 번에 하나만 남아요 — ${zones.map(([c, z]) => `${N(c)} [${z}]`).join(', ')}. 나중에 깐 술진이 앞의 것을 덮어써요.`);
  else if (zones.length === 1) add('info', `술진: ${N(zones[0][0])}의 [${zones[0][1]}].`);
  const fields = act.filter((c, i) => T[i].field);
  if (fields.length >= 2) add('warn', `역장을 쓰는 출품작이 둘이에요 (${fields.map(N).join(', ')}). 서로 덮어쓰는지 확인해 보세요.`);
  if (fields.length && zones.length) add('info', `역장(${fields.map(N).join(', ')})과 술진(${N(zones[0][0])})이 함께 있어요. 둘은 따로 유지돼요.`);

  // 버티기
  const healers = act.filter((c, i) => T[i].heal);
  const shields = act.filter((c, i) => T[i].shield);
  const selfs = act.filter((c, i) => T[i].selfHeal);
  const hpLoss = act.filter((c, i) => T[i].hpLossTeam);
  if (healers.length) add('good', `회복: ${healers.map(N).join(', ')}${healers.length >= 3 ? ' (회복 담당이 셋이라 공격 쪽이 약할 수 있어요)' : ''}`);
  else if (shields.length) add('warn', `회복 담당은 없고 보호막만 있어요 (${shields.map(N).join(', ')}). 긴 전투에서는 버티기 어려울 수 있어요.`);
  else if (selfs.length) add('warn', `팀 회복이 없어요. 자기 회복(흡혈 등)만 있어요: ${selfs.map(N).join(', ')}.`);
  else add('warn', '회복·보호막 담당이 없어요. 짧게 끝내는 고득점 덱이 아니라면 회복 출품작을 넣어 보세요.');
  if (shields.length && healers.length) add('good', `보호막: ${shields.map(N).join(', ')}`);
  if (hpLoss.length) add(healers.length ? 'good' : 'bad', `${hpLoss.map(N).join(', ')}가 아군 HP를 깎아요 → ${healers.length ? `${healers.map(N).join(', ')}의 회복과 잘 맞아요` : '회복 담당이 꼭 필요해요'}.`);
  const likes = act.filter((c, i) => T[i].likesHpLoss);
  const losers = act.filter((c, i) => T[i].hpLossSelf || T[i].hpLossTeam);
  for (const c of likes) { const o = losers.filter((x) => x !== c); if (o.length) add('good', `${N(c)}는 HP를 잃는 행동으로 강해지는데, ${o.map(N).join(', ')}가 HP를 깎아 줘요.`); }
  if (healers.length === 1) add('info', `회복은 ${N(healers[0])} 혼자예요. ${N(healers[0])}가 쓰러지면 회복이 끊겨요.`);

  // 역할
  const dps = act.filter((c, i) => isDps(T[i]));
  const sup = act.filter((c, i) => isSupport(T[i]) && !isDps(T[i]));
  if (!dps.length) add('warn', '딜을 맡을 공격형 출품작이 없어요.');
  if (dps.length >= 3) add('info', `공격형이 ${dps.length}명이에요. 버프·회복이 적은 짧게 끝내는 덱이에요.`);
  const buffers = act.filter((c, i) => T[i].teamBuff);
  const debuffers = act.filter((c, i) => T[i].debuff);
  if (buffers.length) add('good', `아군 강화: ${buffers.map(N).join(', ')}`);
  if (debuffers.length) add('good', `적 약화: ${debuffers.map(N).join(', ')}`);
  const moxie = act.filter((c, i) => T[i].moxie);
  if (moxie.length) add('good', `열정 지원: ${moxie.map(N).join(', ')} → 최종 술식이 빨리 돌아요.`);
  const ctrl = [...new Set(T.flatMap((t) => t.control))];
  if (ctrl.length) add('info', `제어(${ctrl.join(', ')})를 걸 수 있어요. 제어 면역 보스에게는 효과가 없어요.`);

  // 거는 상태 → 활용하는 상태
  const pairs = [];
  act.forEach((a, i) => act.forEach((b, j) => {
    if (i === j) return;
    const x = [...T[i].applies].filter((n) => T[j].uses.has(n));
    if (x.length) pairs.push([a, b, x]);
    if (T[j].usesDebuff && T[i].applies.size && !x.length) pairs.push([a, b, null]);
    if (T[j].usesControl && T[i].control.length) pairs.push([a, b, T[i].control]);
  }));
  for (const [a, b, x] of pairs) add('good', x ? `${N(a)}가 거는 ${x.map((n) => `[${n}]`).join(' ')}를 ${N(b)}가 활용해요.` : `${N(b)}는 적의 해로운 상태 수로 강해지는데, ${N(a)}가 상태를 걸어 줘요.`);
  act.forEach((c, i) => {
    const miss = [...T[i].uses].filter((n) => (ctx.skills.kinds?.[n] === 'debuff') && !T.some((o, j) => j !== i && o.applies.has(n)));
    const ownSrc = T[i].applies;
    const need = miss.filter((n) => !ownSrc.has(n));
    if (need.length && need.length <= 2) add('info', `${N(c)}는 ${need.map((n) => `[${n}]`).join(' ')} 상태인 적에게 더 강해요. 이 덱에는 그걸 거는 출품작이 없어요.`);
  });

  // 영감·피해 유형 조건
  act.forEach((c, i) => {
    const t = T[i];
    if (t.wantsAf.length) {
      const others = act.filter((x) => x !== c);
      const hit = others.filter((o) => afList(o.afflatus).some((a) => t.wantsAf.includes(a)));
      const want = t.wantsAf.map((a) => AF_KO[a]).join('·');
      if (hit.length) add('good', `${N(c)}: 다른 아군 중 ${want} 영감(${hit.map(N).join(', ')})이 있어 패시브가 켜져요.`);
      else add('info', `${N(c)}: 다른 아군에 ${want} 영감이 있으면 패시브가 켜져요.`);
    }
    if (t.wantsDmg) {
      const n = act.filter((o) => o.dmg === t.wantsDmg.type).length;
      const ty = t.wantsDmg.type === 'reality' ? '현실' : '정신';
      add(n >= t.wantsDmg.n ? 'good' : 'info', `${N(c)}: ${ty} 피해 출품작 ${t.wantsDmg.n}명 이상이면 패시브 발동 — 지금 ${n}명.`);
    }
  });
  const dm = { reality: act.filter((c) => c.dmg === 'reality').length, mental: act.filter((c) => c.dmg === 'mental').length };
  add('info', `피해 유형: 현실 ${dm.reality} · 정신 ${dm.mental}`);

  // 보스 영감
  if (ctx.boss) {
    const good = act.filter((c) => afVs(c.afflatus, ctx.boss) > 0);
    const bad = act.filter((c) => afVs(c.afflatus, ctx.boss) < 0);
    if (good.length) add('good', `${AF_KO[ctx.boss]} 보스에게 유리: ${good.map(N).join(', ')}`);
    if (bad.length) add('warn', `${AF_KO[ctx.boss]} 보스에게 불리: ${bad.map(N).join(', ')} (주는 피해↓ 받는 피해↑)`);
  }

  // 육성
  act.forEach((c, i) => {
    const r = ctx.record(c.id);
    if (!r?.owned) return;
    const mi = ctx.maxInsight(c.rarity);
    const lack = [];
    if ((r.insight || 0) < Math.min(2, mi)) lack.push(`통찰 ${r.insight || 0}`);
    if (!members[i]?.psychube) lack.push('의지 없음');
    if (lack.length) add('info', `${N(c)}: ${lack.join(' · ')}`);
  });

  const order = { bad: 0, warn: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.lv] - order[b.lv]);
}

/** 육성 점수 0~1 (희귀도·통찰·레벨·형상) */
export function invest(c, r, ctx) {
  const rar = { 6: 1, 5: 0.8, 4: 0.55 }[c.rarity] ?? 0.4;
  if (!r?.owned) return rar * 0.3;
  const mi = ctx.maxInsight(c.rarity) || 3;
  const ins = Math.min(1, (r.insight || 0) / mi);
  const lvMax = ctx.maxLevel(c.rarity, r.insight || 0) || 60;
  const lv = Math.min(1, (r.level || 1) / lvMax);
  const por = Math.min(1, (r.portray || 0) / 5);
  return rar * (0.45 + 0.35 * ins + 0.12 * lv + 0.08 * por);
}

/**
 * 추천: 조건에 맞는 4인 출전 조합을 고른다.
 * opt: { core: [id...](최대 2), boss, dmg: ''|'reality'|'mental', mode: 'balanced'|'burst', pool: [c...] }
 * 돌려줌: [{ members:[c,c,c,c], score }]
 */
export function recommend(opt, ctx) {
  const pool = opt.pool.filter((c) => ctx.skills.chars?.[c.id]);
  const core = (opt.core || []).map((id) => pool.find((c) => c.id === id) || ctx.chars(id)).filter(Boolean);
  const rest = pool.filter((c) => !core.some((k) => k.id === c.id));
  const T = new Map([...core, ...rest].map((c) => [c.id, traits(c, ctx.skills)]));
  const inv = new Map([...core, ...rest].map((c) => [c.id, invest(c, ctx.record(c.id), ctx)]));
  const burst = opt.mode === 'burst';

  // 둘 사이 시너지 (미리 계산)
  const pairKey = (a, b) => a.id + ':' + b.id;
  const pairMemo = new Map();
  const pair = (a, b) => {
    const k = pairKey(a, b);
    if (pairMemo.has(k)) return pairMemo.get(k);
    const ta = T.get(a.id), tb = T.get(b.id);
    let s = 0;
    for (const n of ta.applies) if (tb.uses.has(n)) s += 2.2;
    for (const n of tb.applies) if (ta.uses.has(n)) s += 2.2;
    if (tb.usesDebuff && ta.applies.size) s += 0.8;
    if (ta.usesDebuff && tb.applies.size) s += 0.8;
    if (ta.wantsAf.length && afList(b.afflatus).some((x) => ta.wantsAf.includes(x))) s += 1;
    if (tb.wantsAf.length && afList(a.afflatus).some((x) => tb.wantsAf.includes(x))) s += 1;
    if (ta.zone && tb.zone) s -= 6;
    if (ta.field && tb.field) s -= 1.5;
    if ((ta.likesHpLoss && (tb.hpLossSelf || tb.hpLossTeam)) || (tb.likesHpLoss && (ta.hpLossSelf || ta.hpLossTeam))) s += 1;
    if ((ta.hpLossTeam && tb.heal) || (tb.hpLossTeam && ta.heal)) s += 1.2;
    pairMemo.set(k, s);
    return s;
  };

  const score = (team) => {
    const ts = team.map((c) => T.get(c.id));
    let s = 0;
    for (const c of team) s += 4 * inv.get(c.id) + 1.3 * afVs(c.afflatus, opt.boss);
    for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) s += pair(team[i], team[j]);
    const heal = ts.filter((t) => t.heal).length;
    const shield = ts.some((t) => t.shield);
    if (burst) s += heal ? -0.6 * heal : 0.5;
    else s += heal ? (heal === 1 ? 3 : heal === 2 ? 2.6 : 0.5) : shield ? 0.8 : -4;
    if (ts.some((t) => t.hpLossTeam) && !heal) s -= 3;
    const dps = ts.filter(isDps).length;
    s += dps === 0 ? -4 : dps === 1 ? (burst ? 0.3 : 1.2) : dps === 2 ? (burst ? 1.8 : 1.6) : dps === 3 ? (burst ? 1.5 : -0.5) : -2.5;
    const sup = ts.filter((t) => t.teamBuff).length + ts.filter((t) => t.debuff).length * 0.8 + ts.filter((t) => t.moxie).length * 0.6;
    s += Math.min(4, sup * (dps ? 1 : 0.4));
    if (ts.filter((t) => t.role === '방어').length >= 3) s -= 1.5;
    if (opt.dmg) s += team.filter((c) => c.dmg === opt.dmg).length * 0.9 - team.filter((c) => c.dmg && c.dmg !== opt.dmg).length * 0.6;
    for (const t of ts) if (t.wantsDmg) s += team.filter((c) => c.dmg === t.wantsDmg.type).length >= t.wantsDmg.n ? 1.2 : -0.3;
    return s;
  };

  const need = 4 - core.length;
  if (need < 0) return [];
  // 경우의 수가 너무 많아지지 않게, 육성 점수 상위 몇 명만 (4명 고를 땐 약 40명)
  const comb = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; };
  let cap = rest.length;
  while (cap > need && comb(cap, need) > 120000) cap--;
  const cand = [...rest].sort((a, b) => inv.get(b.id) - inv.get(a.id)).slice(0, cap);
  const results = [];
  const pick = (start, chosen) => {
    if (chosen.length === need) {
      const team = [...core, ...chosen];
      results.push({ team, score: score(team) });
      return;
    }
    for (let i = start; i < cand.length; i++) { chosen.push(cand[i]); pick(i + 1, chosen); chosen.pop(); }
  };
  pick(0, []);
  results.sort((a, b) => b.score - a.score);

  // 서로 달라 보이게: 핵심 외 출품작이 2명 이상 겹치면 건너뜀
  const top = [];
  for (const r of results) {
    if (top.length >= 3) break;
    const ids = r.team.filter((c) => !core.includes(c)).map((c) => c.id);
    if (top.some((t) => t.team.filter((c) => ids.includes(c.id)).length >= Math.max(1, Math.min(2, need)))) continue;
    top.push(r);
  }
  if (top.length < 3) for (const r of results) { if (top.length >= 3) break; if (!top.includes(r)) top.push(r); }
  return top.map((r) => ({ members: r.team, score: r.score }));
}
