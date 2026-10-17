// 다른 도구에서 내보낸 로스터 JSON 가져오기
// reverse1999-simulator.com 캐릭터 메모장 등 형식이 정해지지 않은 JSON도 최대한 알아서 맞춘다.
import * as store from './store.js';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[\s\-_·.'’"()[\]:]/g, '');

const KEYS = {
  name: ['nameko', 'name_ko', 'koname', 'korean', 'ko', 'name', 'charname', 'charactername', 'character', 'slug', 'nameen', 'name_en', 'en', 'key', 'title'],
  id: ['id', 'charid', 'characterid', 'heroid', 'baseid', 'skinid'],
  level: ['level', 'lv', 'lvl', '레벨'],
  insight: ['insight', 'insightlevel', 'ascension', 'awaken', 'awakening', '통찰'],
  resonance: ['resonance', 'reso', 'resonancelevel', 'res', '공명'],
  portray: ['portray', 'portrait', 'portrayal', 'portraylevel', 'dupes', 'dupe', 'constellation', 'eidolon', '형상'],
  euphoria: ['euphoria', 'euphorialevel', '광상'],
  owned: ['owned', 'have', 'isowned', 'own', 'hold', '보유'],
};

let nameIndex = null;
function buildIndex() {
  nameIndex = new Map();
  for (const c of store.state.game.characters) {
    const add = (s) => { if (s) nameIndex.set(norm(s), c); };
    Object.values(c.name).forEach(add);
    add(store.charName(c));
    add(c.kb);
    add(String(c.id));
    c.skins.forEach((sid) => add(String(sid)));
    if (c.name.en) add(c.name.en.replace(/\s+/g, '-'));
  }
}

function pick(obj, list) {
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [norm(k), v]));
  for (const k of list) if (lower[norm(k)] !== undefined && lower[norm(k)] !== null && lower[norm(k)] !== '') return lower[norm(k)];
  return undefined;
}

function looksLikeEntry(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  return ['level', 'insight', 'resonance', 'portray', 'euphoria', 'owned'].some((k) => pick(o, KEYS[k]) !== undefined);
}

function findChar(o, hintKey) {
  for (const v of [pick(o, KEYS.name), pick(o, KEYS.id), hintKey]) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') {
      const inner = pick(v, ['ko', 'ko-KR', 'en', 'en-US']) ?? Object.values(v)[0];
      const c = nameIndex.get(norm(inner));
      if (c) return c;
      continue;
    }
    const c = nameIndex.get(norm(v));
    if (c) return c;
  }
  return null;
}

function num(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') { const m = v.match(/\d+/); return m ? +m[0] : undefined; }
  return Number.isFinite(+v) ? +v : undefined;
}

export function importRosterJSON(json) {
  buildIndex();
  const entries = [];
  (function walk(node, key) {
    if (Array.isArray(node)) { node.forEach((n) => walk(n, null)); return; }
    if (!node || typeof node !== 'object') return;
    if (looksLikeEntry(node)) { entries.push([node, key]); return; }
    for (const [k, v] of Object.entries(node)) walk(v, k);
  })(json, null);

  if (!entries.length) throw new Error('캐릭터 육성 정보(레벨·통찰·공명·형상)를 찾지 못했습니다.');

  let matched = 0;
  const unmatched = [];
  store.update('roster', () => {
    for (const [o, key] of entries) {
      const c = findChar(o, key);
      if (!c) { unmatched.push(String(pick(o, KEYS.name) ?? key ?? '?')); continue; }
      const r = store.ensureChar(c.id);
      const owned = pick(o, KEYS.owned);
      r.owned = owned === undefined ? true : !!owned && owned !== 'false';
      const lv = num(pick(o, KEYS.level)); if (lv) r.level = lv;
      const ins = num(pick(o, KEYS.insight)); if (ins !== undefined) r.insight = Math.min(ins, store.maxInsight(c.rarity));
      const res = num(pick(o, KEYS.resonance)); if (res) r.resonance = res;
      const p = num(pick(o, KEYS.portray)); if (p !== undefined) r.portray = Math.min(5, p);
      const eu = num(pick(o, KEYS.euphoria)); if (eu !== undefined && c.euphoria) r.euphoria = Math.min(c.euphoria, eu);
      matched++;
    }
  });
  return { matched, unmatched };
}
