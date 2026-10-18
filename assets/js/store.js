// 데이터 저장소: 게임 데이터(data/game) + 내 기록(data/user)
import * as gh from './github.js';

export const SECTIONS = {
  roster:    { file: 'data/user/roster.json',    label: '출품작',       def: () => ({ chars: {}, nameOverrides: {} }) },
  psychubes: { file: 'data/user/psychubes.json', label: '의지',         def: () => ({ items: {} }) },
  bulletin:  { file: 'data/user/bulletin.json',  label: '갈기의 게시판', def: () => ({ seasons: {}, customSeasons: [] }) },
  skins:     { file: 'data/user/skins.json',     label: '스킨',         def: () => ({ items: {} }) },
  decks:     { file: 'data/user/decks.json',     label: '덱',           def: () => ({ decks: [] }) },
  plans:     { file: 'data/user/plans.json',     label: '육성 계획',     def: () => ({ plans: [], inventory: {}, materialNames: {} }) },
  gacha:     { file: 'data/user/gacha.json',     label: '모집 기록',     def: () => ({ pity: 0, pityLimit: 70, guaranteed: false, currencies: [{ name: '순결의 빗방울', amount: 0 }, { name: '순수의 빗방울', amount: 0 }, { name: '모노로그', amount: 0 }, { name: '데카로그', amount: 0 }], banners: [], wishlist: [] }) },
  stories:   { file: 'data/user/stories.json',   label: '스토리 후기',   def: () => ({ posts: [], ratings: {}, read: {} }) },
  profile:   { file: 'data/user/profile.json',   label: '소개',         def: () => defaultProfile() },
  settings:  { file: 'data/user/settings.json',  label: '설정',         def: () => ({ title: '세기말의 방랑자', titleEn: 'Fin de Siècle Wanderer', subtitle: '리버스: 1999 개인 기록', showNames: false, server: '한섭', currentVersion: '3.8' }) },
};

const DRAFT = 'r1999.draft.';

/** 처음 쓰는 소개 기본값 (트위터 소개 카드 내용 중 게임 관련 부분) — 이름으로 출품작을 찾는다 */
function defaultProfile() {
  const id = (ko) => state.game?.characters.find((c) => c.name.ko === ko)?.id || null;
  const ids = (...names) => names.map(id).filter(Boolean);
  return {
    nickname: '빈',
    avatar: { type: 'char', char: id('미스 스트레인저'), file: null },
    lines: ['파사 / ID : 701088348 / KR', '게임 스토리 + 엔드컨텐츠 위주'],
    favorites: [
      { label: '하늘이 내려준 사랑', chars: ids('미스 스트레인저', '윌로우') },
      { label: '운명이 내려준 사랑', chars: ids('베릴', '루시') },
    ],
    intro: '최애캐 다수 / 버틴 애호 / 라플라스 애호',
    notes: [
      { label: '지뢰', text: '알아서 피해 갑니다 ~' },
      { label: '스포', text: '게임 정보는 중섭발 미래시 언급 / 스토리는 한섭 기준' },
    ],
    cps: [
      { name: '윈빌', a: id('윈드송'), b: id('빌라'), note: '' },
      { name: '카졸데', a: id('카론'), b: id('이졸데'), note: '' },
    ],
    showcase: ids('미스 스트레인저', '윌로우', '베릴', '루시').map((c) => ({ char: c, skin: null })),
  };
}
const listeners = new Set();
export const state = {
  game: null,          // { characters, skins, psychubes, materials, bulletin, meta }
  user: {},            // 섹션별 기록
  sha: {},             // 불러올 때의 파일 sha (충돌 감지용)
  dirty: new Set(),
  pendingFiles: [],    // [{ path, base64, preview }]
  editing: false,
  loadedFrom: 'site',
};

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(kind) { for (const fn of listeners) fn(kind); }

function draftGet(k) { try { return localStorage.getItem(DRAFT + k); } catch { return null; } }
function draftSet(k, v) { try { v === null ? localStorage.removeItem(DRAFT + k) : localStorage.setItem(DRAFT + k, v); } catch { /* 무시 */ } }

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  return res.json();
}

export async function loadAll() {
  const [characters, skins, psychubes, materials, bulletin, meta] = await Promise.all(
    ['characters', 'skins', 'psychubes', 'materials', 'bulletin', 'meta'].map((n) => getJSON(`data/game/${n}.json`)),
  );
  // 위키에서 가져온 자료 (없어도 사이트는 돌아가게)
  const [npcs, stories, versions, profiles, versionArt] = await Promise.all(['npcs', 'stories', 'versions', 'profiles', 'version-art'].map((n) => getJSON(`data/game/${n}.json`).catch(() => (n === 'profiles' || n === 'version-art' ? {} : []))));
  state.game = { characters, skins, psychubes, materials, bulletin, meta, npcs, stories, versions, profiles, versionArt };
  indexGame();
  await loadUser();
}

export async function loadUser() {
  const useApi = gh.hasToken();
  state.loadedFrom = useApi ? 'api' : 'site';
  const stamp = Date.now();
  await Promise.all(Object.entries(SECTIONS).map(async ([key, sec]) => {
    let data = null;
    try {
      if (useApi) {
        const f = await gh.readText(sec.file);
        if (f) { data = JSON.parse(f.text); state.sha[key] = f.sha; }
      } else {
        const res = await fetch(`${sec.file}?v=${stamp}`, { cache: 'no-store' });
        if (res.ok) data = await res.json();
      }
    } catch (e) {
      console.warn('기록 불러오기 실패', key, e);
      if (useApi) {
        // API 실패 시 사이트 파일로 대체
        try { const res = await fetch(`${sec.file}?v=${stamp}`); if (res.ok) data = await res.json(); } catch { /* 없음 */ }
      }
    }
    state.user[key] = { ...sec.def(), ...(data || {}) };
  }));
  // 저장하지 않은 변경 사항 복구
  let restored = 0;
  for (const key of Object.keys(SECTIONS)) {
    const raw = draftGet(key);
    if (!raw) continue;
    try {
      const d = JSON.parse(raw);
      state.user[key] = { ...SECTIONS[key].def(), ...d.data };
      state.dirty.add(key);
      restored++;
    } catch { draftSet(key, null); }
  }
  emit('load');
  return restored;
}

/** 기록 수정. fn(section) 이 섹션 객체를 직접 바꾼다. */
export function update(key, fn, { silent } = {}) {
  fn(state.user[key]);
  state.dirty.add(key);
  draftSet(key, JSON.stringify({ at: Date.now(), data: state.user[key] }));
  if (!silent) emit('change');
  else emit('dirty');
}

export function addPendingFile(path, dataURL) {
  const base64 = dataURL.split(',')[1];
  state.pendingFiles = state.pendingFiles.filter((f) => f.path !== path);
  state.pendingFiles.push({ path, base64, preview: dataURL });
  emit('dirty');
}

/** 이미지 경로를 화면에 표시할 주소로 (아직 저장 전이면 미리보기) */
export function fileURL(path) {
  if (!path) return null;
  const p = state.pendingFiles.find((f) => f.path === path);
  return p ? p.preview : path;
}

export function hasChanges() { return state.dirty.size > 0 || state.pendingFiles.length > 0; }

export async function save() {
  if (!hasChanges()) return null;
  if (!gh.hasToken()) throw new Error('저장하려면 설정에서 GitHub 연결을 먼저 해 주세요.');
  const keys = [...state.dirty];
  const files = keys.map((k) => ({ path: SECTIONS[k].file, text: JSON.stringify(state.user[k], null, 1) + '\n' }));
  for (const f of state.pendingFiles) files.push({ path: f.path, base64: f.base64 });
  const labels = keys.map((k) => SECTIONS[k].label);
  if (state.pendingFiles.length) labels.push(`이미지 ${state.pendingFiles.length}장`);
  const msg = `기록 갱신: ${labels.join(', ')}`;
  const sha = await gh.commitFiles(files, msg);
  for (const k of keys) draftSet(k, null);
  state.dirty.clear();
  state.pendingFiles = [];
  emit('saved');
  return sha;
}

export function discardDrafts() {
  for (const k of Object.keys(SECTIONS)) draftSet(k, null);
  state.dirty.clear();
  state.pendingFiles = [];
}

export function replaceAll(data) {
  for (const [k, sec] of Object.entries(SECTIONS)) {
    if (data[k]) update(k, (s) => { for (const kk of Object.keys(s)) delete s[kk]; Object.assign(s, sec.def(), data[k]); }, { silent: true });
  }
  emit('change');
}

export function setEditing(v) { state.editing = v; document.body.classList.toggle('editing', v); emit('mode'); }

// ── 게임 데이터 색인과 도우미 ──────────────────────────────
const idx = { char: new Map(), skin: new Map(), psy: new Map(), npc: new Map(), story: new Map() };
function indexGame() {
  for (const c of state.game.characters) idx.char.set(c.id, c);
  for (const s of state.game.skins) idx.skin.set(s.id, s);
  for (const p of state.game.psychubes) idx.psy.set(p.id, p);
  // NPC는 출품작처럼 다룰 수 있게 같은 모양으로 만들어 둔다 (id가 'npc-'로 시작)
  for (const n of state.game.npcs || []) {
    idx.npc.set(n.id, { ...n, npc: true, released: true, rarity: 0, skins: [], portrait: n.icon || n.art, art: n.art || n.icon });
  }
  for (const st of state.game.stories || []) idx.story.set(st.id, st);
}
export const isNpcId = (id) => typeof id === 'string' && id.startsWith('npc-');
export const charById = (id) => (isNpcId(id) ? idx.npc.get(id) : idx.char.get(+id));
export const npcList = () => [...idx.npc.values()];
export const storyById = (id) => idx.story.get(id);
/** 지금 한섭 버전 (설정에서 바꿀 수 있음) */
export const currentVersion = () => state.user.settings?.currentVersion || '3.8';
export const profileOf = (id) => state.game.profiles?.[id] || null;
/** 모집 배너(위키) id → { banner, version } */
export function summonById(id) {
  for (const v of state.game.versions || []) { const s = v.summons.find((x) => x.id === id); if (s) return { ...s, version: v.id }; }
  return null;
}
/** 생일 'MM-DD' → { m, d } */
export function birthdayOf(id) {
  const b = profileOf(id)?.birthday;
  if (!b) return null;
  const [m, d] = b.split('-').map(Number);
  return { m, d };
}
export const skinById = (id) => idx.skin.get(+id);
export const psyById = (id) => idx.psy.get(+id);

// 콜라보 버전: S01은 2.7과 2.8 사이, S02는 3.6과 3.7 사이
export const COLLAB = { S01: '어쌔신 크리드', S02: '아토믹 하트' };
const COLLAB_AT = { S01: 207.5, S02: 306.5 };
export function verNum(v) {
  if (!v) return -1;
  if (COLLAB_AT[v]) return COLLAB_AT[v];
  if (/^\d/.test(v)) return String(v).split('.').reduce((a, x) => a * 100 + (+x || 0), 0);
  return v === '콜라보' ? 0.5 : -1;
}
export function verLabel(v, short) {
  if (!v) return '';
  if (COLLAB[v]) return short ? `${v} · ${COLLAB[v]}` : `${v} · ${COLLAB[v]} 콜라보`;
  if (v === '콜라보') return '콜라보';
  return `${v} 버전`;
}

export const AFFLATUS = {
  star: '천체', mineral: '암석', plant: '나무', beast: '야수', spirit: '영혼', intellect: '지능', 'mineral-star': '암석·천체', unknown: '미상',
};
/** 영감 고유 그림 */
export const afIcon = (key) => (AFFLATUS[key] && key !== 'unknown' ? `assets/img/afflatus/${key}.webp` : null);
/** 장착한 의지 목록 (예전 한 개짜리 기록 호환) */
export const psyList = (r) => (r?.psychubes?.length ? r.psychubes : (r?.psychube ? [r.psychube] : []));
export const DMG = { reality: '현실', mental: '정신', unknown: '' };

export function charName(c) {
  if (!c) return '';
  const o = state.user.roster?.nameOverrides?.[c.id];
  return o || c.name.ko || c.name.en;
}

export function charRecord(id) {
  return state.user.roster.chars[id] || null;
}

export function ensureChar(id) {
  const r = state.user.roster.chars;
  if (!r[id]) r[id] = { owned: false, level: 1, insight: 0, resonance: 1, portray: 0, euphoria: 0, euphorias: [], euphoriaLevel: 0, tuning: null, tunings: [], psychubes: [], skin: null, spectrum: '', note: '' };
  return r[id];
}

/** 캐릭터 대표 이미지: 내가 고른 스킨 > 통찰 스킨(통찰 2 이상) > 기본 */
export function charPortrait(c, skinId) {
  if (!c) return null;
  if (c.npc) return c.portrait;
  const rec = charRecord(c.id);
  const sid = skinId || rec?.skin || ((rec?.insight >= 2 && c.insightSkin) ? c.insightSkin : c.defaultSkin);
  return (skinById(sid) || skinById(c.defaultSkin))?.portrait || null;
}

export function maxLevel(rarity, insight) {
  const lv = state.game.materials.levels;
  if (!lv) return 60;
  const row = lv.find((r) => r.Rarity.includes(rarity) && r.Insight === insight);
  if (!row) return 60;
  return Math.max(...Object.keys(row.Levels).map(Number));
}
export function maxInsight(rarity) {
  const lv = state.game.materials.levels;
  if (!lv) return rarity >= 5 ? 3 : 2;
  const rows = lv.filter((r) => r.Rarity.includes(rarity));
  return rows.length ? Math.max(...rows.map((r) => r.Insight)) : 2;
}

export function materialName(en) {
  const o = state.user.plans?.materialNames?.[en];
  return o || state.game.materials.items[en]?.ko || en;
}
