// 홈 — 진열관: 소개 카드(프로필·최애·CP·진열장) + 기록 현황
import { h, img, fmt, pickFile, shrinkImage, uid, lightbox, toast, readFileDataURL } from '../ui.js';
import * as store from '../store.js';
import { teamView, afClass, charPicker } from '../components.js';
import { seasonTotals, allSeasons } from './bulletin.js';
import { nextPickupInfo } from './gacha.js';
import { skinInfo } from './skins.js';
import * as timeline from './timeline.js';
import * as codex from './codex.js';
import * as fx from '../fx.js';

let heroFx = null;
export function cleanup() { heroFx?.destroy(); heroFx = null; }

const P = () => store.state.user.profile;

/** 진열장에 걸 그림: 고른 스킨 > 출품작에 설정한 스킨 > 통찰 스킨 > 기본 */
function showcaseSkin(slot) {
  const c = store.charById(slot.char);
  if (!c) return null;
  if (c.npc) return { art: c.art, portrait: c.portrait, type: 'npc', name: 'NPC' };
  const rec = store.charRecord(c.id) || {};
  const sid = slot.skin || rec.skin || c.insightSkin || c.defaultSkin;
  return store.skinById(sid) || store.skinById(c.defaultSkin);
}

function avatarSrc(p) {
  const a = p.avatar || {};
  if (a.type === 'file' && a.file) return store.fileURL(a.file);
  const c = store.charById(a.char);
  return c ? store.charPortrait(c) : null;
}

/** 홈 = 대표 화면 하나 */
export function render(root) {
  cleanup();
  root.append(hero(P(), store.state.editing));
}

/** 타임키퍼 메뉴 = 예전 홈 (소개 카드·진열장·기록) */
export function renderKeeper(root) {
  cleanup();
  const p = P();
  const editing = store.state.editing;
  root.append(
    profileSection(p, editing),
  );
  // 기록 숫자 굴러 올라오기
  root.querySelectorAll('[data-count]').forEach((el) => fx.counter(el, +el.dataset.count));
}

// ── 소개 카드 (편집 모드에서는 그 자리에서 고친다) ─────────────
const save = (fn, silent = false) => store.update('profile', fn, { silent });

/** 편집 모드면 눌러서 바로 고치는 글자, 아니면 그냥 글자 */
function editable(tag, text, onSave, { multiline = false, placeholder = '' } = {}) {
  if (!store.state.editing) return text ? h(tag, text) : null;
  const el = h(tag + '.ed', { contenteditable: 'true', spellcheck: 'false', 'data-ph': placeholder, role: 'textbox', 'aria-multiline': String(multiline), 'aria-label': placeholder || '고치기' }, text || '');
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.textContent = text || ''; el.blur(); }
  });
  el.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
  el.addEventListener('blur', () => { const v = el.innerText.replace(/\u00a0/g, ' ').replace(/\n$/, ''); if (v !== (text || '')) save((p) => onSave(p, v.trim() ? v : ''), true); });
  return el;
}
const xBtn = (label, fn) => h('button.x-btn', { type: 'button', 'aria-label': label, title: label, onclick: fn }, '×');
const addBtn = (label, fn) => h('button.add-btn', { type: 'button', onclick: fn }, '+ ', label);

function cpMembers(cp) { return cp.members || [cp.a, cp.b].filter(Boolean); }

function profileSection(p, editing) {
  const chip = (cid, onRemove) => {
    const c = store.charById(cid);
    if (!c) return null;
    return h('span.fav-chip', { class: afClass(c) },
      c.npc ? h('span.fav-link', { title: c.name.en }, h('span.face', img(store.charPortrait(c), '')), store.charName(c))
        : h('a', { href: `#/roster/${cid}` }, h('span.face', img(store.charPortrait(c), '')), store.charName(c)),
      editing ? xBtn(`${store.charName(c)} 빼기`, onRemove) : null);
  };

  // 프로필 그림
  const avatar = h('div.prof-avatar', img(avatarSrc(p), p.nickname || ''));
  if (editing) {
    avatar.classList.add('can-edit');
    avatar.append(h('div.avatar-menu',
      h('button', { type: 'button', onclick: () => charPicker({ npc: true, title: '프로필 출품작 고르기', onDone: ([id]) => save((x) => { x.avatar = { type: 'char', char: id, file: null }; }) }) }, '출품작 얼굴'),
      h('button', { type: 'button', onclick: async () => {
        const f = await pickFile('image/*'); if (!f) return;
        const data = await shrinkImage(f, 400, 0.88);
        const path = `data/user/shots/avatar-${uid()}.${data.startsWith('data:image/webp') ? 'webp' : 'jpg'}`;
        store.addPendingFile(path, data);
        save((x) => { x.avatar = { type: 'file', char: x.avatar?.char || null, file: path }; });
      } }, '그림 올리기')));
  }

  const lines = p.lines || [];
  const left = h('div.prof-left',
    h('div.prof-head',
      avatar,
      h('div',
        h('p.prof-kicker', 'Timekeeper’s Profile'),
        editable('h1.prof-name', p.nickname, (x, v) => { x.nickname = v; }, { placeholder: '닉네임' }),
        editing
          ? editable('div.prof-line', lines.join('\n'), (x, v) => { x.lines = v.split('\n'); }, { multiline: true, placeholder: '소개 줄 (줄바꿈으로 여러 줄)' })
          : lines.filter(Boolean).map((l) => h('p.prof-line', l)),
      ),
    ),
    (editing || (p.favorites || []).some((f) => f.chars?.length)) ? h('div.prof-block',
      (p.favorites || []).map((f, i) => h('div.fav-row',
        editable('span.fav-label', f.label, (x, v) => { x.favorites[i].label = v; }, { placeholder: '이름 (예: 최애)' }),
        h('div.fav-chars',
          (f.chars || []).map((cid) => chip(cid, () => save((x) => { x.favorites[i].chars = x.favorites[i].chars.filter((y) => y !== cid); }))),
          editing ? addBtn('출품작', () => charPicker({ npc: true, title: `${f.label || '최애'} 고르기`, multi: true, selected: f.chars || [], min: 0, onDone: (ids) => save((x) => { x.favorites[i].chars = ids; }) })) : null,
          editing ? xBtn('이 줄 지우기', () => save((x) => { x.favorites.splice(i, 1); })) : null),
      )),
      editing ? addBtn('최애 줄 추가', () => save((x) => { (x.favorites ||= []).push({ label: '', chars: [] }); })) : null,
    ) : null,
    (editing || p.intro) ? h('div.prof-block.prof-intro', editable('div', p.intro, (x, v) => { x.intro = v; }, { multiline: true, placeholder: '하고 싶은 말' })) : null,
    (editing || (p.notes || []).some((n) => n.label || n.text)) ? h('div.prof-notes-wrap',
      h('dl.prof-notes', (p.notes || []).map((n, i) => [
        editable('dt', n.label, (x, v) => { x.notes[i].label = v; }, { placeholder: '항목' }),
        h('dd', editable('span', n.text, (x, v) => { x.notes[i].text = v; }, { placeholder: '내용' }), editing ? xBtn('이 안내 지우기', () => save((x) => { x.notes.splice(i, 1); })) : null),
      ])),
      editing ? addBtn('안내 추가', () => save((x) => { (x.notes ||= []).push({ label: '', text: '' }); })) : null,
    ) : null,
    (editing || (p.cps || []).length) ? h('div.prof-block',
      h('p.prof-sub', h('span.cp-mark', 'Ⓒ_Ⓟ'), ' 커플링'),
      h('div.cp-grid', (p.cps || []).map((cp, i) => {
        const mem = cpMembers(cp).map((id) => store.charById(id)).filter(Boolean);
        const names = mem.map((c) => store.charName(c)).join(' × ');
        const faces = h('div.cp-faces', mem.map((c) => h('span.face', img(store.charPortrait(c), ''))));
        return h('div.cp', { title: names },
          editing ? h('button.cp-faces-btn', { type: 'button', title: '멤버 바꾸기', onclick: () => charPicker({ npc: true, title: 'CP 멤버 바꾸기', multi: true, min: 2, selected: cpMembers(cp), onDone: (ids) => save((x) => { x.cps[i].members = ids; delete x.cps[i].a; delete x.cps[i].b; }) }) }, faces) : faces,
          editable('b', cp.name, (x, v) => { x.cps[i].name = v; }, { placeholder: names || 'CP 이름' }) || h('b', names),
          h('span', names),
          editable('span.faint', cp.note, (x, v) => { x.cps[i].note = v; }, { placeholder: '메모' }),
          editing ? xBtn('이 CP 지우기', () => save((x) => { x.cps.splice(i, 1); })) : null);
      }),
      editing ? h('button.cp.cp-add', { type: 'button', onclick: () => charPicker({ npc: true, title: 'CP 추가 — 두 명 이상 고르기', multi: true, min: 2, onDone: (ids) => save((x) => { (x.cps ||= []).push({ name: '', members: ids, note: '' }); }) }) }, h('span', '+'), 'CP 추가') : null),
    ) : null,
  );

  const shows = (p.showcase || []).map((slot, i) => ({ slot, i, s: showcaseSkin(slot) }));
  const right = h('div.showcase',
    shows.map(({ slot, i, s }) => {
      const c = store.charById(slot.char);
      if (!s) return null;
      return h('div.show-item', { class: afClass(c) },
        h('button.show-art', { type: 'button', 'aria-label': `${store.charName(c)} 크게 보기`, onclick: (e) => { lightbox(s.art || s.portrait, `${store.charName(c)} — ${s.name}`); } }, img(s.art || s.portrait, '')),
        h('span.show-cap', h('b', store.charName(c)), h('small', s.type === 'default' ? '기본' : s.type === 'insight' ? '통찰' : s.name)),
        editing ? h('div.show-tools',
          c.npc ? null : h('select', { 'aria-label': '걸 스킨', onchange: (e) => save((x) => { x.showcase[i].skin = e.target.value ? +e.target.value : null; }) },
            h('option', { value: '' }, '스킨: 자동'),
            c.skins.map((sid) => { const sk = store.skinById(sid); return h('option', { value: sid, selected: slot.skin === sid }, sk?.type === 'default' ? '기본' : sk?.type === 'insight' ? '통찰' : sk?.name); })),
          h('button', { type: 'button', onclick: () => charPicker({ npc: true, title: '진열할 출품작 바꾸기', onDone: ([id]) => save((x) => { x.showcase[i] = { char: id, skin: null }; }) }) }, '바꾸기'),
          xBtn('진열장에서 빼기', () => save((x) => { x.showcase.splice(i, 1); }))) : null);
    }),
    editing ? h('button.show-add', { type: 'button', onclick: () => charPicker({ npc: true, title: '진열장에 걸 출품작', onDone: ([id]) => save((x) => { (x.showcase ||= []).push({ char: id, skin: null }); }) }) }, h('span', '+'), '진열 추가')
      : (shows.some((x) => x.s) ? null : h('div.empty', h('p', '진열장이 비어 있어요.'))),
  );
  return h('section.prof' + (editing ? '.editing' : ''), left, h('div.prof-right', right, sideCards(p, editing)));
}

// ── 진열장 아래 카드: 현재 버전 · 다가오는 생일 · 스토리 후기 ─────────
const SIDE = [['version', '현재 버전'], ['records', '기록 현황'], ['bulletin', '갈기의 게시판'], ['pickup', '다음 픽업']];
function sideCards(p, editing) {
  const hidden = new Set(p.hiddenCards || []);
  const toggle = (k) => save((x) => { const s = new Set(x.hiddenCards || []); s.has(k) ? s.delete(k) : s.add(k); x.hiddenCards = [...s]; });
  const wrap = (k, title, en, link, body) => (hidden.has(k) || !body ? null : h('section.side-card',
    h('header', h('span.en', en), h('h3', title), link ? h('a.more', { href: link }, '더 보기 →') : null, editing ? xBtn(`${title} 카드 숨기기`, () => toggle(k)) : null),
    body));
  const cards = [
    hidden.has('records') ? null : h('section.side-card.rec-slim', recordsCard(), editing ? xBtn('기록 현황 숨기기', () => toggle('records')) : null),
    wrap('version', '현재 버전 · 한섭', 'Now', '#/timeline', versionCard()),
    wrap('bulletin', '갈기의 게시판', 'Bulletin', '#/bulletin', bulletinCard()),
    wrap('pickup', '다음 한섭 픽업', 'Next Summon', '#/gacha', pickupCard()),
  ];
  return h('div.side-cards', cards,
    editing && hidden.size ? h('div.side-restore', SIDE.filter(([k]) => hidden.has(k)).map(([k, l]) => addBtn(`${l} 카드 다시 보기`, () => toggle(k)))) : null);
}

/** 이번 시즌 갈기의 게시판: 보스 3명과 내 점수, 기록 없는 보스는 같은 보스의 내 최고 */
function bulletinCard() {
  const seasons = allSeasons();
  const cur = store.currentVersion();
  const se = [...seasons].reverse().find((x) => x.version === cur) || seasons[seasons.length - 1];
  if (!se) return null;
  const recs = store.state.user.bulletin.seasons || {};
  const rec = (sid, st) => recs[sid]?.bosses?.[st] || null;
  const totals = seasonTotals();
  const t = totals.find((x) => x.id === se.id);
  const i = totals.findIndex((x) => x.id === se.id);
  const prev = totals.slice(0, i).reverse().find((x) => x.total > 0);
  const best = (b) => {
    let m = null;
    for (const s of seasons) for (const bb of s.bosses) {
      if ((bb.name || `t:${bb.type}`) !== (b.name || `t:${b.type}`) || s.id === se.id) continue;
      const r = rec(s.id, bb.stage);
      if (r?.score && (!m || +r.score > m)) m = +r.score;
    }
    return m;
  };
  return h('div.side-bul',
    se.bosses.map((b) => {
      const r = rec(se.id, b.stage);
      const pb = r?.score ? null : best(b);
      return h('div.sb-row',
        b.image ? h('span.sb-img', img(b.image, '')) : null,
        h('span.sb-name', b.name),
        r?.score ? h('b.sb-score', fmt(r.score), r.grade ? h('small', ` ${r.grade}`) : null)
          : h('span.sb-none', pb ? `최고 ${fmt(pb)}` : '기록 없음'));
    }),
    h('div.sb-total', h('span', `${se.version} 합계`), h('b', t?.total ? fmt(t.total) : '—'),
      t?.total && prev ? h('small', { style: { color: t.total >= prev.total ? 'var(--teal)' : '#f0b4a5' } }, ` ${t.total >= prev.total ? '+' : ''}${((t.total - prev.total) / prev.total * 100).toFixed(1)}%`) : null));
}

/** 다음 한섭 한정 픽업: 배너 · D-day · 지금 재화로 · 확정까지 */
function pickupCard() {
  const n = nextPickupInfo();
  if (!n) return null;
  const short = n.worst - n.have;
  return h('a.side-pick', { href: '#/gacha' },
    n.s.banner ? h('span.sp-img' + (n.s.bannerSrc === 'kr' ? '.kr' : ''), n.s.bannerSrc === 'kr' ? null : h('img.fillbg', { src: n.s.banner, alt: '' }), img(n.s.banner, '')) : null,
    h('span.sp-head', h('b', n.name), h('em', `D-${n.days}`)),
    h('span.sp-sub', `${n.v.id} · ${n.start} 시작`),
    h('span.sp-nums',
      h('span', h('small', '지금 재화'), h('b', `${fmt(n.have)}회`)),
      h('span', h('small', '확정까지'), h('b', { style: { color: short > 0 ? '#f0b4a5' : 'var(--teal)' } }, short > 0 ? `−${fmt(short)}회` : '충분'))));
}

function versionCard() {
  if (!timeline) return null;
  // 한섭 기준 현재 버전 (설정에서 바꿀 수 있음)
  const cur = store.currentVersion();
  const v = timeline.allVersions().find((x) => x.id === cur) || timeline.allVersions().find((x) => store.verNum(x.id) <= store.verNum(cur));
  if (!v) return null;
  const banner = v.key || v.strip;
  const title = v.title?.ko || v.stories.find((s) => s.cat === 'mainevent' || s.cat === 'main')?.name.ko || '';
  return h('a.side-ver', { href: `#/timeline/${v.id}` },
    banner ? h('span.side-ver-img', img(banner, '')) : null,
    h('span.side-ver-txt', h('b', store.verLabel(v.id)), title ? h('span', title) : null),
    v.chars.length ? h('span.side-faces', v.chars.map((c) => h('span.face', { class: afClass(c), title: store.charName(c) }, img(store.charPortrait(c), '')))) : null);
}

function birthdayCard() {
  if (!codex) return null;
  const up = codex.upcomingBirthdays(5);
  if (!up.length) return null;
  return h('div.side-bdays', up.map(({ c, b, days }) => h('button.side-bday', { type: 'button', class: afClass(c) + (days === 0 ? ' today' : ''), onclick: () => codex.openProfile(c) },
    h('span.face', img(store.charPortrait(c), '')), h('b', store.charName(c)), h('small', days === 0 ? '오늘 생일!' : `${b.m}월 ${b.d}일 · D-${days}`))));
}

function storyCard() {
  const g = store.state.game.stories || [];
  if (!g.length) return null;
  const u = store.state.user.stories || {};
  const read = Object.keys(u.read || {}).length;
  const posts = [...(u.posts || [])].sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 3);
  return h('div.side-stories',
    h('div.side-progress', h('span', `읽은 스토리 ${read} / ${g.length}`), h('div.meter', h('i', { style: { width: `${(read / g.length) * 100}%` } }))),
    posts.length ? h('ul', posts.map((p) => { const st = store.storyById(p.story); return st ? h('li', h('a', { href: `#/stories/${st.id}` }, st.banner ? img(st.banner, '') : null, h('span', h('b', p.title || '제목 없음'), h('small', st.name.ko)))) : null; }))
      : h('p.faint', { style: { margin: '6px 0 0', fontSize: '13px' } }, '아직 쓴 후기가 없어요.'));
}

/** 기록 현황 — 촘촘한 세로선 계기 (진열장 아래) */
function recordsCard() {
  const g = store.state.game;
  const u = store.state.user;
  const chars = u.roster.chars;
  const released = g.characters.filter((c) => c.released);
  const owned = g.characters.filter((c) => chars[c.id]?.owned);
  const six = released.filter((c) => c.rarity === 6);
  const sixOwned = owned.filter((c) => c.rarity === 6);
  const p5 = owned.filter((c) => (chars[c.id].portray || 0) >= 5);
  const costumes = g.skins.filter((s) => !['default', 'insight'].includes(skinInfo(s).cat) && store.charById(s.char)?.released);
  const skinOwned = costumes.filter((s) => u.skins.items[s.id]?.owned).length;
  const psy = g.psychubes.filter((x) => !x.refine);
  const psyOwned = psy.filter((x) => u.psychubes.items[x.id]?.owned).length;
  const row = (label, a, b, href) => {
    const pct = b ? (a / b) * 100 : 0;
    return h('a.rec-row', { href },
      h('span.rec-top', h('span', label), h('span.rec-v', h('span', { 'data-count': a }, '0'), h('small', ` / ${fmt(b)} · ${pct.toFixed(1)}%`))),
      h('span.rec-bars', h('i', { style: { width: `${pct}%` } })));
  };
  return h('div.rec-meas',
    row('보유 출품작', owned.length, released.length, '#/roster'),
    row('스킨', skinOwned, costumes.length, '#/skins'));
}

// ── 기록 현황 ───────────────────────────────────────────────
function statsSection() {
  const g = store.state.game;
  const u = store.state.user;
  const chars = u.roster.chars;
  const released = g.characters.filter((c) => c.released);
  const owned = g.characters.filter((c) => chars[c.id]?.owned);
  const six = owned.filter((c) => c.rarity === 6);
  const p5 = owned.filter((c) => (chars[c.id].portray || 0) >= 5);
  const costumes = g.skins.filter((s) => !['default', 'insight'].includes(skinInfo(s).cat) && store.charById(s.char)?.released);
  const skinOwned = costumes.filter((s) => u.skins.items[s.id]?.owned).length;
  const psy = g.psychubes.filter((x) => !x.refine);
  const psyOwned = psy.filter((x) => u.psychubes.items[x.id]?.owned).length;
  const totals = seasonTotals();
  const lastSeason = [...totals].reverse().find((t) => t.total > 0);
  const best = totals.reduce((m, t) => (t.total > (m?.total || 0) ? t : m), null);
  const lastBossImg = lastSeason && g.bulletin.find((s) => s.id === lastSeason.id)?.bosses?.[0]?.image;
  const recentGacha = u.gacha.banners.slice(-1)[0];
  const top = [...owned].sort((a, b) => score(chars[b.id], b) - score(chars[a.id], a)).slice(0, 10);
  const stat = (n, sub, label, href) => h('a.stat', { href }, h('b', fmt(n), sub ? h('small', ` ${sub}`) : null), h('span', label));

  return h('section.home-records',
    h('h2.section', '기록 현황'),
    h('div.stat-strip.five',
      stat(owned.length, `/ ${released.length}`, '보유 출품작', '#/roster'),
      stat(six.length, null, '6성', '#/roster'),
      stat(p5.length, null, '형상 P5', '#/roster'),
      stat(psyOwned, `/ ${psy.length}`, '의지', '#/psychubes'),
      stat(skinOwned, `/ ${costumes.length}`, '스킨', '#/skins'),
    )
  );
}

function score(r, c) {
  return (c.rarity * 1000) + (r.insight || 0) * 200 + (r.portray || 0) * 30 + (r.resonance || 0) * 5 + (r.euphoria ? 50 : 0);
}


// ── 첫 화면: 연구 대상 기록 (Ethiack Hackian 구성을 라플라스 톤으로) ──────────
// 대표 그림은 편집 모드에서 바꾼다 → data/user/hero/ 에 저장, 설정(settings.hero)에 경로를 적는다
const HERO_DEFAULT = { src: 'assets/img/hero/hero.webp', type: 'image' };
const HERO_MAX_MB = 20;

function heroMedia() {
  const x = store.state.user.settings?.hero;
  const fit = x?.fit || 'cover';
  if (!x?.file) return { ...HERO_DEFAULT, block: x?.block, keyBlack: false, fit };
  return { src: store.fileURL(x.file), type: x.type || 'image', keyBlack: !!x.keyBlack, block: x.block, fit };
}
const saveHero = (fn) => store.update('settings', (s) => { s.hero ||= {}; fn(s.hero); });

async function uploadHero() {
  const f = await pickFile('image/png,image/webp,image/jpeg,image/gif,video/mp4,video/webm');
  if (!f) return;
  const mb = f.size / 1048576;
  if (mb > HERO_MAX_MB) { toast(`파일이 ${mb.toFixed(1)}MB예요. ${HERO_MAX_MB}MB 아래로 줄여 주세요.`); return; }
  const type = f.type.startsWith('video/') ? 'video' : f.type === 'image/gif' ? 'gif' : 'image';
  let data, ext;
  if (type === 'image') { // 그림은 높이 1600 안쪽 webp 로 (투명 배경 유지)
    data = await shrinkImage(f, 2400, 0.9);
    ext = data.startsWith('data:image/webp') ? 'webp' : 'jpg';
  } else {
    data = await readFileDataURL(f);
    ext = type === 'gif' ? 'gif' : (f.type === 'video/webm' ? 'webm' : 'mp4');
  }
  const path = `data/user/hero/hero-${uid()}.${ext}`;
  store.addPendingFile(path, data);
  saveHero((x) => { x.file = path; x.type = type; x.keyBlack = type === 'video'; });
  if (mb > 8) toast('파일이 커서 첫 화면이 늦게 뜰 수 있어요 (8MB 아래 권장).');
}

/** 대표 화면 박스 글: 편집 모드에서 그 자리에서 고친다. 비워 두면 그 박스는 숨김, 손대지 않으면 기본 글 */
function heroText(tag, key, def, { multiline = false, ...attrs } = {}) {
  const saved = store.state.user.settings?.hero?.text?.[key];
  const text = saved ?? def;
  if (!store.state.editing) return text ? h(tag, attrs, text) : null;
  const el = h(tag + '.ed', { contenteditable: 'true', spellcheck: 'false', 'data-ph': '비우면 숨김', title: '눌러서 고치기 · 비우면 이 박스는 숨겨져요' }, text);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.textContent = text; el.blur(); }
  });
  el.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
  el.addEventListener('blur', () => {
    const v = el.innerText.replace(/ /g, ' ').replace(/\n$/, '').trim();
    if (v === text) return;
    store.update('settings', (x) => { x.hero ||= {}; x.hero.text ||= {}; x.hero.text[key] = v; }, { silent: true });
  });
  return el;
}

function heroEditor(m) {
  const x = store.state.user.settings?.hero || {};
  return h('div.hero-edit',
    h('b', '대표 화면'),
    h('button.btn.small', { type: 'button', onclick: uploadHero }, '그림 · GIF · 영상 올리기'),
    h('label', '맞춤 ', h('select', { onchange: (e) => saveHero((y) => { y.fit = e.target.value; }) },
      h('option', { value: 'cover', selected: (x.fit || 'cover') === 'cover' }, '화면 꽉 채우기 (가운데 기준)'),
      h('option', { value: 'contain', selected: x.fit === 'contain' }, '전체 보이기'))),
    h('label', h('input', { type: 'checkbox', checked: !!x.keyBlack, onchange: (e) => saveHero((y) => { y.keyBlack = e.target.checked; }) }), ' 검은 배경 지우기'),
    h('label', '모자이크 ', h('input', { type: 'range', min: 5, max: 24, value: m.block || 10, onchange: (e) => saveHero((y) => { y.block = +e.target.value; }) })),
    h('label', '박스 글씨 ', h('input', { type: 'range', min: 70, max: 200, step: 5, value: Math.round((x.scale || 1) * 100),
      oninput: (e) => { const sec = e.target.closest('.hero'); sec?.style.setProperty('--hs', e.target.value / 100); e.target.nextSibling.textContent = ` ${e.target.value}%`; },
      onchange: (e) => store.update('settings', (s) => { s.hero ||= {}; s.hero.scale = +e.target.value / 100; }, { silent: true }) }), h('span.hero-pct', ` ${Math.round((x.scale || 1) * 100)}%`)),
    h('div.hero-edit-row',
      x.file ? h('button.btn.small', { type: 'button', onclick: () => saveHero((y) => { delete y.file; delete y.type; delete y.keyBlack; }) }, '기본 그림으로') : null,
      x.text ? h('button.btn.small', { type: 'button', onclick: () => saveHero((y) => { delete y.text; }) }, '박스 글 처음대로') : null,
      x.pos ? h('button.btn.small', { type: 'button', onclick: () => saveHero((y) => { delete y.pos; }) }, '박스 자리 처음대로') : null,
      (x.size && Object.keys(x.size).length) || (x.scale && x.scale !== 1) ? h('button.btn.small', { type: 'button', onclick: () => saveHero((y) => { delete y.size; delete y.scale; }) }, '글씨 크기 처음대로') : null),
    h('small', '박스 글은 눌러서 바로 고쳐요(비우면 숨김). ⠿ 를 끌면 박스가 옮겨지고, − + 로 그 박스 글씨만 줄이고 키워요. 전체 크기는 위 슬라이더로.'),
    h('small', '권장: 투명 배경 PNG·WebP 세로 1600~2400px · GIF 세로 720px·5MB 이하 · 영상 MP4/WebM 1080p 5~10초 8MB 이하'),
  );
}

/** 박스 하나의 글씨 크기 −/+ (0.6배 ~ 2.5배) */
function sizeBtn(el, key, dir) {
  return h('button', { type: 'button', title: dir > 0 ? '이 박스 글씨 키우기' : '이 박스 글씨 줄이기', 'aria-label': dir > 0 ? '글씨 키우기' : '글씨 줄이기',
    onclick: (e) => {
      e.preventDefault();
      const cur = +(el.style.getPropertyValue('--bs') || 1);
      const v = Math.round(Math.min(2.5, Math.max(0.6, cur + dir * 0.1)) * 10) / 10;
      el.style.setProperty('--bs', v);
      store.update('settings', (s) => { s.hero ||= {}; s.hero.size ||= {}; if (v === 1) delete s.hero.size[key]; else s.hero.size[key] = v; }, { silent: true });
    } }, dir > 0 ? '+' : '−');
}

/** 박스를 끌어서 옮기는 손잡이 — 놓으면 화면 대비 % 로 저장 (화면 크기가 바뀌어도 비슷한 자리) */
function dragHandle(el, key) {
  const hd = h('span.hero-drag', { title: '끌어서 옮기기', 'aria-label': '박스 옮기기' }, '⠿');
  hd.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const sec = el.closest('.hero'), R = sec.getBoundingClientRect(), r = el.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    hd.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    let x = 0, y = 0;
    const move = (ev) => {
      x = Math.min(Math.max(0, ev.clientX - R.left - ox), R.width - r.width) / R.width * 100;
      y = Math.min(Math.max(0, ev.clientY - R.top - oy), R.height - r.height) / R.height * 100;
      Object.assign(el.style, { left: `${x}%`, top: `${y}%`, right: 'auto', bottom: 'auto', transform: el.classList.contains('hero-chip') ? 'rotate(-3deg)' : '' });
    };
    const up = () => {
      hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up);
      el.classList.remove('dragging');
      store.update('settings', (s) => { s.hero ||= {}; s.hero.pos ||= {}; s.hero.pos[key] = { x: +x.toFixed(2), y: +y.toFixed(2) }; }, { silent: true });
    };
    hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up);
  });
  return hd;
}

function hero(p, editing) {
  const m = heroMedia();
  const c = store.charById(p.avatar?.char || (p.showcase || [])[0]?.char);
  const name = c ? store.charName(c) : '';
  const fig = h('div.hero-fig');
  const grid = h('div.hero-grid', [...Array(4)].map(() => h('i.hx')));
  const pos = store.state.user.settings?.hero?.pos || {};
  const size = store.state.user.settings?.hero?.size || {};
  // 박스: 저장한 자리(%)가 있으면 그 자리에, 편집 모드에서는 손잡이(⠿)로 끌어서 옮긴다
  const box = (cls, key, ...kids) => {
    if (!kids.some(Boolean) && !editing) return null;
    const el = h(cls, { 'data-k': key }, ...kids);
    const at = pos[key];
    if (at) Object.assign(el.style, { left: `${at.x}%`, top: `${at.y}%`, right: 'auto', bottom: 'auto' });
    if (size[key]) el.style.setProperty('--bs', size[key]);
    if (editing) el.prepend(h('span.hero-tools', dragHandle(el, key), sizeBtn(el, key, -1), sizeBtn(el, key, 1)));
    return el;
  };
  const go = heroText(editing ? 'span.hero-go' : 'a.hero-go', 'go', '> timekeeper.open()', { href: '#/timekeeper' });
  const hs = store.state.user.settings?.hero?.scale || 1;
  const sec = h('section.hero', { style: { '--hs': hs } },
    grid, fig,
    box('div.hero-note', 'note', heroText('pre', 'note1', 'HELLO,\nI AM\nTHE\nWANDERER.', { multiline: true }), heroText('pre.b', 'note2', 'THE\nTIMEKEEPER’S\nARCHIVE\nSINCE 1999', { multiline: true })),
    box('div.hero-chip', 'chip', h('i'), heroText('span', 'chip', `laplace.observe(${(c?.name?.en || 'arcanist').replace(/\s+/g, '')});`)),
    box('div.hero-side', 'side', heroText('b', 'sideTitle', '⌘ Fin de Siècle'), heroText('p', 'side', '기록한다.\n측정한다.\n계속한다.', { multiline: true }), go),
    box('div.hero-tag.t1', 't1', heroText('span', 't1', `■ 관측 대상 · ${name}`)),
    box('div.hero-tag.t2', 't2', heroText('span', 't2', '■ STORM 1999.12.31')),
    box('div.hero-tag.t3', 't3', heroText('span', 't3', '■ 감응 확인')),
    editing ? heroEditor(m) : null,
  );
  // 그림 전체를 모자이크로 (가운데가 선명해지는 효과 없음)
  requestAnimationFrame(() => { heroFx = fx.mosaic(fig, m, { block: m.block || 10, radius: 0, fit: m.fit, bottomFade: m.fit === 'cover' ? 0 : 0.28 }); });
  return sec;
}
