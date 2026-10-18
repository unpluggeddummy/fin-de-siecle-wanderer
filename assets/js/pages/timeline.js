// 버전 연대기 — 버전마다 배너, 기간, 새 출품작, 이벤트, 모집 배너, 의상, 그리고 내 기록(스토리 후기·갈기의 게시판·모집)
// 목록: #/timeline   한 버전: #/timeline/<버전>
import { h, img, chip, lightbox, toast, uid } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import { afClass } from '../components.js';

const view = { order: 'new' };

/** 위키 버전 + 출품작·스토리에만 있는 버전(1.0, 3.8 이후 등)을 합친 목록 */
export function allVersions() {
  const g = store.state.game;
  const wiki = new Map((g.versions || []).map((v) => [v.id, v]));
  const ids = new Set([...wiki.keys()]);
  for (const c of g.characters) if (c.released && c.version) ids.add(c.version);
  for (const s of g.stories || []) if (s.version) ids.add(s.version);
  return [...ids].filter((v) => store.verNum(v) > 0).map((id) => {
    const w = wiki.get(id) || { id, title: {}, periods: {}, newChars: [], events: [], summons: [], garments: [] };
    const chars = g.characters.filter((c) => c.released && c.version === id);
    return { ...w, chars, stories: (g.stories || []).filter((s) => s.version === id), wiki: wiki.has(id) };
  }).sort((a, b) => store.verNum(b.id) - store.verNum(a.id));
}

const face = (c) => h('a.tl-face', { href: `#/roster/${c.id}`, class: afClass(c), title: store.charName(c) }, img(store.charPortrait(c), store.charName(c)));
const vTitle = (v) => v.title?.ko || v.title?.en || (v.stories.find((s) => s.cat === 'mainevent' || s.cat === 'main')?.name.ko) || '';

export function render(root, { arg } = {}) {
  const list = allVersions();
  const v = arg && list.find((x) => x.id === decodeURIComponent(arg));
  if (v) { detail(root, v, list); return; }

  root.append(h('div.page-head', h('div', h('h1', h('span.en', 'Version Timeline'), '버전 연대기'),
    h('p', '버전마다 새 출품작, 이벤트, 모집 배너, 의상을 모아 두었어요. 카드를 누르면 자세히 볼 수 있어요.'))),
  h('div.toolbar', h('div.chips',
    chip('최신 버전부터', view.order === 'new', () => { view.order = 'new'; rerender(); }),
    chip('1.0부터', view.order === 'old', () => { view.order = 'old'; rerender(); })),
    h('a.btn.small.ghost', { href: '#/timeline', onclick: (e) => { e.preventDefault(); document.getElementById('tl-now')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, `지금 한섭 버전(${store.currentVersion()})으로`)));

  const items = view.order === 'new' ? list : [...list].reverse();
  const cur = store.verNum(store.currentVersion());
  root.append(h('ol.timeline', items.map((x) => {
    const n = store.verNum(x.id);
    const state = n === cur ? 'now' : n > cur ? 'future' : '';
    const reviews = (store.state.user.stories?.posts || []).filter((p) => x.stories.some((s) => s.id === p.story)).length;
    const banner = x.banner || x.stories.find((s) => s.cat === 'mainevent' && s.banner)?.banner || x.stories.find((s) => s.banner)?.banner;
    return h('li.tl-item', { class: [store.COLLAB[x.id] ? 'collab' : '', state].join(' '), id: state === 'now' ? 'tl-now' : null },
      h('div.tl-dot', h('span', x.id)),
      h('a.tl-card', { href: `#/timeline/${x.id}` },
        banner ? h('span.tl-banner', img(banner, '')) : null,
        h('span.tl-body',
          h('span.code', store.verLabel(x.id), state === 'now' ? h('em.tl-badge.now', '지금 한섭') : state === 'future' ? h('em.tl-badge', '한섭 예정 · 중섭 선행') : null),
          h('b', vTitle(x) || '—'),
          x.title?.ko && x.title?.en ? h('small.en', x.title.en) : null,
          x.periods?.global || x.periods?.cn ? h('small.faint', x.periods.cn ? `중섭 ${x.periods.cn}` : '', x.periods.cn && x.periods.global ? ' · ' : '', x.periods.global ? `글로벌 ${x.periods.global}` : '') : null,
          x.chars.length ? h('span.tl-faces', x.chars.map((c) => h('span.tl-face', { class: afClass(c), title: store.charName(c) }, img(store.charPortrait(c), '')))) : null,
          h('span.tl-stats',
            x.summons.length ? h('span', `모집 ${x.summons.length}`) : null,
            x.events.length ? h('span', `이벤트 ${x.events.length}`) : null,
            x.garments.length ? h('span', `의상 ${x.garments.length}`) : null,
            reviews ? h('span.mine', `내 후기 ${reviews}`) : null,
            !x.wiki ? h('span.faint', '위키 정보 없음') : null))));
  })));
}

function section(en, ko, kids, extra) {
  const k = [].concat(kids).filter(Boolean);
  if (!k.length) return null;
  return h('section.tl-sec', h('h2.group-head', h('span.en', en), ko, extra ? h('small', extra) : null), ...k);
}

function detail(root, v, list) {
  const i = list.indexOf(v);
  const newer = list[i - 1];
  const older = list[i + 1];
  const editing = store.state.editing;
  const u = store.state.user;
  const myBanners = (u.gacha?.banners || []);
  const bulletin = store.state.game.bulletin?.find?.((s) => s.version === v.id);

  root.append(
    h('div.toolbar', { style: { marginBottom: '10px' } },
      h('a.btn.small.ghost', { href: '#/timeline' }, '← 연대기'),
      h('span', { style: { flex: 1 } }),
      older ? h('a.btn.small.ghost', { href: `#/timeline/${older.id}` }, `‹ ${older.id}`) : null,
      newer ? h('a.btn.small.ghost', { href: `#/timeline/${newer.id}` }, `${newer.id} ›`) : null),
    h('section.story-hero.tl-hero',
      v.banner ? h('button.story-hero-img.tl-hero-img', { type: 'button', onclick: () => lightbox(v.banner, vTitle(v)) }, img(v.banner, '')) : null,
      h('div.tl-hero-grid',
        h('div.story-hero-text',
          h('p.code', store.verLabel(v.id),
            store.verNum(v.id) === store.verNum(store.currentVersion()) ? h('em.tl-badge.now', '지금 한섭') : store.verNum(v.id) > store.verNum(store.currentVersion()) ? h('em.tl-badge', '한섭 예정 · 중섭 선행') : null),
          h('h1', vTitle(v) || `${v.id} 버전`),
          v.title?.ko && v.title?.en ? h('p.en-title', v.title.en) : null,
          v.periods?.cn ? h('p.faint', { style: { margin: 0, fontSize: '13px' } }, `중섭 ${v.periods.cn}`) : null,
          v.periods?.global ? h('p.faint', { style: { margin: 0, fontSize: '13px' } }, `글로벌 ${v.periods.global}`) : null,
          v.quote ? h('blockquote.tl-quote', v.quote.split(' / ').map((l) => h('span', l))) : null,
          v.tagline ? h('p.muted', { style: { margin: 0, fontSize: '13.5px' } }, v.tagline) : null,
          !v.wiki ? h('p.faint', { style: { fontSize: '13px' } }, '이 버전은 위키에 아직 버전 문서가 없어서, 출품작·스토리 정보만 보여요.') : null),
        v.poster ? h('button.tl-poster', { type: 'button', onclick: () => lightbox(v.poster, `${v.id} 포스터`), 'aria-label': '포스터 크게 보기' }, img(v.poster, '')) : null)),
  );

  // 새 출품작: 위키 포스터가 있으면 포스터, 없으면 얼굴
  const posters = v.newChars.filter((n) => n.poster);
  const shown = new Set(posters.map((n) => n.char).filter(Boolean));
  root.append(section('New Arcanists', '새 출품작', [
    posters.length ? h('div.tl-posters', posters.map((n) => {
      const c = n.char && store.charById(n.char);
      return h(c ? 'a.tl-pcard' : 'div.tl-pcard', c ? { href: `#/roster/${c.id}` } : {}, img(n.poster, ''), h('span', c ? store.charName(c) : n.en));
    })) : null,
    v.chars.filter((c) => !shown.has(c.id)).length ? h('div.tl-faces.big', v.chars.filter((c) => !shown.has(c.id)).map((c) => h('span.tl-namedface', face(c), h('small', store.charName(c))))) : null,
  ]));

  root.append(section('Stories', '스토리', v.stories.length ? h('div.story-grid', v.stories.map((st) => {
    const n = (u.stories?.posts || []).filter((p) => p.story === st.id).length;
    const r = u.stories?.ratings?.[st.id];
    return h('a.story-card', { href: `#/stories/${st.id}` },
      st.banner ? h('span.story-banner', img(st.banner, '')) : h('span.story-banner.no-img', h('span', st.name.en)),
      h('span.story-cap', h('b', st.name.ko), h('span.story-meta', r ? h('span.stars', '★'.repeat(r)) : null, n ? h('span.cnt', `후기 ${n}`) : h('small.faint', '후기 쓰기 →'))));
  })) : null));

  root.append(section('Summons', '모집 배너', v.summons.length ? h('div.tl-summons', v.summons.map((s) => summonCard(s, v, myBanners, editing))) : null));

  const evs = v.events.filter((e) => !e.story || !v.stories.some((s) => s.id === e.story));
  root.append(section('Events', '이벤트', evs.length ? h('div.tl-events', evs.map((e) => h(e.story ? 'a.tl-ev' : 'div.tl-ev', e.story ? { href: `#/stories/${e.story}` } : {},
    e.banner ? img(e.banner, '') : null,
    h('span', h('b', e.name.ko || e.name.en), e.name.ko ? h('small.en', e.name.en) : null, e.time ? h('small.faint', e.time) : null)))) : null));

  root.append(section('Garments', '새 의상', v.garments.length ? h('div.tl-garments', v.garments.map((gm) => {
    const c = gm.char && store.charById(gm.char);
    const sk = gm.skin && store.skinById(gm.skin);
    const owned = gm.skin && u.skins?.items?.[gm.skin]?.owned;
    return h('button.tl-gm', { type: 'button', onclick: () => lightbox(gm.poster, `${c ? store.charName(c) : ''} — ${sk?.name || gm.en}`) },
      gm.poster ? img(gm.poster, '') : null,
      h('span', h('b', sk?.name || gm.en), h('small', c ? store.charName(c) : ''), owned ? h('em.owned', '보유') : null));
  })) : null));

  if (bulletin) {
    const rec = u.bulletin?.seasons?.[bulletin.id]?.bosses || {};
    root.append(section('Bulletin', '갈기의 게시판', h('a.tl-bosses', { href: '#/bulletin' }, bulletin.bosses.map((b) => h('span.tl-boss',
      b.image ? img(b.image, '') : null, h('b', b.name), h('small', rec[b.stage]?.score ? `${(+rec[b.stage].score).toLocaleString('ko-KR')}점` : '기록 없음'))))));
  }
  root.append(h('p.faint.story-src', '버전 정보·그림: Reverse: 1999 Wiki (CC BY-SA 3.0), 모집 배너 이름·픽업 출품작: 게임 데이터'));
}

/** 모집 배너 카드 — 도감과 연대기에서 같이 쓴다 */
export function summonCard(s, v, myBanners = store.state.user.gacha?.banners || [], editing = store.state.editing) {
  const mine = myBanners.filter((b) => b.ref === s.id);
  const pulls = mine.reduce((a, b) => a + (+b.pulls || 0), 0);
  const six = s.six.map((id) => store.charById(id)).filter(Boolean);
  const five = s.five.map((id) => store.charById(id)).filter(Boolean);
  return h('article.tl-su',
    s.banner ? h('button.tl-su-img', { type: 'button', onclick: () => lightbox(s.banner, s.name.ko || s.name.en) }, img(s.banner, '')) : null,
    h('div.tl-su-body',
      h('b', s.name.ko || s.name.en), s.name.ko ? h('small.en', s.name.en) : null,
      s.time ? h('small.faint', s.time) : null,
      six.length || five.length ? h('div.tl-su-ups',
        six.map((c) => h('span.up6', face(c))), five.map((c) => h('span.up5', face(c)))) : null,
      h('div.tl-su-foot',
        mine.length ? h('a.mine', { href: '#/gacha' }, `내 기록 ${pulls}회`) : null,
        editing && !mine.length ? h('button.btn.small', { type: 'button', onclick: () => addToGacha(s, v) }, '모집 기록에 추가') : null)));
}

export function addToGacha(s, v) {
  store.update('gacha', (g) => {
    g.banners.push({ id: uid(), ref: s.id, name: s.name.ko || s.name.en, type: s.rerun ? '복각' : (s.six.length ? '한정' : '기타'),
      start: '', version: v.id || v, pulls: 0, results: [], note: '' });
  });
  toast('모집 기록에 배너를 추가했어요. 모집 기록 화면에서 횟수와 결과를 적어 주세요.');
}
