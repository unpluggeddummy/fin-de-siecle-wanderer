import { h, img, fmt } from '../ui.js';
import * as store from '../store.js';
import { face, teamView } from '../components.js';
import { seasonTotals } from './bulletin.js';

export function render(root) {
  const g = store.state.game;
  const u = store.state.user;
  const chars = u.roster.chars;
  const released = g.characters.filter((c) => c.released);
  const owned = g.characters.filter((c) => chars[c.id]?.owned);
  const six = owned.filter((c) => c.rarity === 6);
  const p5 = owned.filter((c) => (chars[c.id].portray || 0) >= 5);
  const ins3 = owned.filter((c) => (chars[c.id].insight || 0) >= 3);
  const euph = owned.filter((c) => (chars[c.id].euphoria || 0) > 0);

  const costumes = g.skins.filter((s) => ['shop', 'shop-art', 'event'].includes(s.type) && store.charById(s.char)?.released);
  const skinOwned = costumes.filter((s) => u.skins.items[s.id]?.owned).length;
  const skinWish = costumes.filter((s) => u.skins.items[s.id]?.wish && !u.skins.items[s.id]?.owned);
  const psyOwned = Object.values(u.psychubes.items).filter((x) => x.owned).length;

  const totals = seasonTotals();
  const lastSeason = [...totals].reverse().find((t) => t.total > 0);
  const best = totals.reduce((m, t) => (t.total > (m?.total || 0) ? t : m), null);

  const activePlans = u.plans.plans.filter((p) => !p.done);
  const recentGacha = u.gacha.banners.slice(-1)[0];

  // 가장 많이 키운 캐릭터 (형상·통찰·공명)
  const top = [...owned].sort((a, b) => score(chars[b.id], b) - score(chars[a.id], a)).slice(0, 12);

  const intro = owned.length
    ? h('p.home-intro',
      '지금까지 ', h('b', `${owned.length}명`), '의 신비학자와 함께했고, 그중 ', h('b', `${six.length}명`), '이 6성입니다. ',
      lastSeason ? ['가장 최근 갈기의 게시판은 ', h('b', `${lastSeason.version}`), ` 시즌, 합계 ${fmt(lastSeason.total)}점.`] : '')
    : h('p.home-intro', '아직 기록이 없습니다. ', h('a', { href: '#/roster' }, '캐릭터'), '에서 보유한 신비학자부터 표시해 보세요.');

  root.append(
    intro,
    h('div.home-grid',
      h('section.panel.span-7',
        h('div.panel-head', h('h3', '가장 많이 키운 신비학자'), h('a', { href: '#/roster' }, '캐릭터 전체 보기')),
        top.length ? h('div.faces', { style: { gap: '10px' } }, top.map((c) => h('a', { href: `#/roster/${c.id}`, title: store.charName(c), style: { textDecoration: 'none' } },
          h('span.face', { style: { width: '62px', height: '62px' } }, img(store.charPortrait(c), store.charName(c))),
        ))) : h('p.muted', '보유 캐릭터를 표시하면 여기에 나타납니다.'),
        h('dl.ledger', { style: { marginTop: '16px' } },
          h('dt', '보유'), h('dd', `${owned.length} / ${released.length}`),
          h('dt', '6성'), h('dd', `${six.length} / ${released.filter((c) => c.rarity === 6).length}`),
          h('dt', '통찰 Ⅲ'), h('dd', ins3.length),
          h('dt', '형상 P5'), h('dd', p5.length),
          h('dt', '광상 해금'), h('dd', euph.length),
          h('dt', '보유 의지'), h('dd', psyOwned),
        ),
      ),
      h('section.panel.span-5',
        h('div.panel-head', h('h3', '갈기의 게시판'), h('a', { href: '#/bulletin' }, '기록 보기')),
        lastSeason ? [
          h('p', { style: { margin: '0 0 6px' } }, `${lastSeason.version} 시즌 합계 `, h('b', { style: { fontFamily: 'var(--serif)', fontSize: '22px' } }, fmt(lastSeason.total))),
          best && best !== lastSeason ? h('p.muted', { style: { margin: '0 0 10px', fontSize: '13.5px' } }, `최고 기록은 ${best.version} 시즌 ${fmt(best.total)}점`) : null,
          h('dl.ledger', lastSeason.bosses.map((b) => [h('dt', b.name), h('dd', fmt(b.score))])),
        ] : h('p.muted', '아직 기록한 시즌이 없습니다.'),
      ),
      h('section.panel.span-4',
        h('div.panel-head', h('h3', '스킨'), h('a', { href: '#/skins' }, '갤러리')),
        h('p', { style: { margin: 0 } }, `${skinOwned} / ${costumes.length} 보유`),
        h('div.meter', h('i', { style: { width: `${costumes.length ? (skinOwned / costumes.length) * 100 : 0}%` } })),
        skinWish.length ? h('p.muted', { style: { fontSize: '13.5px', marginBottom: 0 } }, `갖고 싶은 스킨 ${skinWish.length}개: ${skinWish.slice(0, 3).map((s) => s.name).join(', ')}${skinWish.length > 3 ? ' 외' : ''}`) : null,
      ),
      h('section.panel.span-4',
        h('div.panel-head', h('h3', '육성 계획'), h('a', { href: '#/plans' }, '계획 보기')),
        activePlans.length
          ? h('div.faces', activePlans.slice(0, 8).map((p) => face(p.char)))
          : h('p.muted', { style: { margin: 0 } }, '진행 중인 계획이 없습니다.'),
        activePlans.length ? h('p.muted', { style: { fontSize: '13.5px', marginBottom: 0 } }, `진행 중 ${activePlans.length}건`) : null,
      ),
      h('section.panel.span-4',
        h('div.panel-head', h('h3', '모집'), h('a', { href: '#/gacha' }, '모집 기록')),
        h('p', { style: { margin: 0 } }, '현재 천장 카운트 ', h('b', { style: { fontFamily: 'var(--serif)', fontSize: '22px' } }, u.gacha.pity || 0), h('span.faint', ` / ${u.gacha.pityLimit || 70}`)),
        recentGacha ? h('p.muted', { style: { fontSize: '13.5px', marginBottom: 0 } }, `최근 배너: ${recentGacha.name} (${recentGacha.pulls || 0}회)`) : null,
      ),
      u.decks.decks.length ? h('section.panel.span-12',
        h('div.panel-head', h('h3', `덱 · ${u.decks.decks[0].name}`), h('a', { href: '#/decks' }, '덱 전체')),
        h('div', { style: { maxWidth: '420px' } }, teamView(u.decks.decks[0].members)),
      ) : null,
    ),
  );
}

function score(r, c) {
  return (c.rarity * 1000) + (r.insight || 0) * 200 + (r.portray || 0) * 30 + (r.resonance || 0) * 5 + (r.euphoria ? 50 : 0);
}
