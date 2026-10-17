// 홈 — 진열관: 소개 카드(프로필·최애·CP·진열장) + 기록 현황
import { h, img, fmt, pickFile, shrinkImage, uid, lightbox } from '../ui.js';
import * as store from '../store.js';
import { teamView, afClass, charPicker } from '../components.js';
import { seasonTotals } from './bulletin.js';
import { skinInfo } from './skins.js';

const P = () => store.state.user.profile;

/** 진열장에 걸 그림: 고른 스킨 > 출품작에 설정한 스킨 > 통찰 스킨 > 기본 */
function showcaseSkin(slot) {
  const c = store.charById(slot.char);
  if (!c) return null;
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

export function render(root) {
  const p = P();
  const editing = store.state.editing;
  root.append(
    profileSection(p, editing),
    statsSection(),
  );
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
      h('a', { href: `#/roster/${cid}` }, h('span.face', img(store.charPortrait(c), '')), store.charName(c)),
      editing ? xBtn(`${store.charName(c)} 빼기`, onRemove) : null);
  };

  // 프로필 그림
  const avatar = h('div.prof-avatar', img(avatarSrc(p), p.nickname || ''));
  if (editing) {
    avatar.classList.add('can-edit');
    avatar.append(h('div.avatar-menu',
      h('button', { type: 'button', onclick: () => charPicker({ title: '프로필 출품작 고르기', onDone: ([id]) => save((x) => { x.avatar = { type: 'char', char: id, file: null }; }) }) }, '출품작 얼굴'),
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
          editing ? addBtn('출품작', () => charPicker({ title: `${f.label || '최애'} 고르기`, multi: true, selected: f.chars || [], min: 0, onDone: (ids) => save((x) => { x.favorites[i].chars = ids; }) })) : null,
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
          editing ? h('button.cp-faces-btn', { type: 'button', title: '멤버 바꾸기', onclick: () => charPicker({ title: 'CP 멤버 바꾸기', multi: true, min: 2, selected: cpMembers(cp), onDone: (ids) => save((x) => { x.cps[i].members = ids; delete x.cps[i].a; delete x.cps[i].b; }) }) }, faces) : faces,
          editable('b', cp.name, (x, v) => { x.cps[i].name = v; }, { placeholder: names || 'CP 이름' }) || h('b', names),
          h('span', names),
          editable('span.faint', cp.note, (x, v) => { x.cps[i].note = v; }, { placeholder: '메모' }),
          editing ? xBtn('이 CP 지우기', () => save((x) => { x.cps.splice(i, 1); })) : null);
      }),
      editing ? h('button.cp.cp-add', { type: 'button', onclick: () => charPicker({ title: 'CP 추가 — 두 명 이상 고르기', multi: true, min: 2, onDone: (ids) => save((x) => { (x.cps ||= []).push({ name: '', members: ids, note: '' }); }) }) }, h('span', '+'), 'CP 추가') : null),
    ) : null,
  );

  const shows = (p.showcase || []).map((slot, i) => ({ slot, i, s: showcaseSkin(slot) }));
  const right = h('div.showcase',
    shows.map(({ slot, i, s }) => {
      const c = store.charById(slot.char);
      if (!s) return null;
      return h('div.show-item', { class: afClass(c) },
        h('button.show-art', { type: 'button', 'aria-label': `${store.charName(c)} 크게 보기`, onclick: () => lightbox(s.art || s.portrait, `${store.charName(c)} — ${s.name}`) }, img(s.art || s.portrait, '')),
        h('span.show-cap', h('b', store.charName(c)), h('small', s.type === 'default' ? '기본' : s.type === 'insight' ? '통찰' : s.name)),
        editing ? h('div.show-tools',
          h('select', { 'aria-label': '걸 스킨', onchange: (e) => save((x) => { x.showcase[i].skin = e.target.value ? +e.target.value : null; }) },
            h('option', { value: '' }, '스킨: 자동'),
            c.skins.map((sid) => { const sk = store.skinById(sid); return h('option', { value: sid, selected: slot.skin === sid }, sk?.type === 'default' ? '기본' : sk?.type === 'insight' ? '통찰' : sk?.name); })),
          h('button', { type: 'button', onclick: () => charPicker({ title: '진열할 출품작 바꾸기', onDone: ([id]) => save((x) => { x.showcase[i] = { char: id, skin: null }; }) }) }, '바꾸기'),
          xBtn('진열장에서 빼기', () => save((x) => { x.showcase.splice(i, 1); }))) : null);
    }),
    editing ? h('button.show-add', { type: 'button', onclick: () => charPicker({ title: '진열장에 걸 출품작', onDone: ([id]) => save((x) => { (x.showcase ||= []).push({ char: id, skin: null }); }) }) }, h('span', '+'), '진열 추가')
      : (shows.some((x) => x.s) ? null : h('div.empty', h('p', '진열장이 비어 있어요.'))),
  );
  return h('section.prof' + (editing ? '.editing' : ''), left, right);
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

