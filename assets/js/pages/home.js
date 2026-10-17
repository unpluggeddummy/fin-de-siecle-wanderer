import { h, img, fmt } from '../ui.js';
import * as store from '../store.js';
import { face, teamView, afClass } from '../components.js';
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
  const lastBossImg = lastSeason && g.bulletin.find((s) => s.id === lastSeason.id)?.bosses?.[0]?.image;

  const activePlans = u.plans.plans.filter((p) => !p.done);
  const recentGacha = u.gacha.banners.slice(-1)[0];
  const top = [...owned].sort((a, b) => score(chars[b.id], b) - score(chars[a.id], a)).slice(0, 10);

  const intro = owned.length
    ? h('p.home-intro',
      '지금까지 모은 출품작은 ', h('b', `${owned.length}점`), ', 그중 6성은 ', h('b', `${six.length}점`), '입니다. ',
      lastSeason ? ['가장 최근 갈기의 게시판은 ', h('b', `${lastSeason.version}`), ` 시즌, 합계 ${fmt(lastSeason.total)}점.`] : '')
    : h('p.home-intro', '폭풍이 지나간 자리에서, 기록을 시작합니다. ', h('a', { href: '#/roster' }, '출품작'), '에서 함께하는 이들부터 표시해 보세요.');

  root.append(
    h('section.home-hero',
      h('div', h('p.home-kicker', 'Timekeeper’s Ledger'), intro),
      h('div.stat-strip',
        stat(owned.length, `/ ${released.length}`, '보유 출품작'),
        stat(six.length, null, '6성'),
        stat(p5.length, null, '형상 P5'),
        stat(skinOwned, `/ ${costumes.length}`, '스킨'),
      ),
    ),
    h('div.home-grid',
      h('section.panel.span-8',
        h('div.panel-head', h('h3', '가장 많이 키운 출품작', h('span.en', 'Exhibits')), h('a', { href: '#/roster' }, '전체 보기 →')),
        top.length
          ? h('div.top-cards', top.map((c) => h('a', { href: `#/roster/${c.id}`, class: afClass(c), title: store.charName(c) },
            img(store.charPortrait(c), ''), h('span', store.charName(c)))))
          : h('p.muted', { style: { margin: 0 } }, '보유 출품작을 표시하면 여기에 나타납니다.'),
      ),
      h('section.panel.span-4',
        h('div.panel-head', h('h3', '육성 현황', h('span.en', 'Ledger'))),
        h('dl.ledger',
          h('dt', '보유'), h('dd', `${owned.length} / ${released.length}`),
          h('dt', '6성'), h('dd', `${six.length} / ${released.filter((c) => c.rarity === 6).length}`),
          h('dt', '통찰 Ⅲ'), h('dd', ins3.length),
          h('dt', '형상 P5'), h('dd', p5.length),
          h('dt', '광상 해금'), h('dd', euph.length),
          h('dt', '보유 의지'), h('dd', psyOwned),
        ),
      ),
      h('section.panel.span-6.home-boss',
        lastBossImg ? h('img.bg', { src: lastBossImg, alt: '' }) : null,
        h('div.panel-head', h('h3', '갈기의 게시판', h('span.en', 'Bulletin')), h('a', { href: '#/bulletin' }, '기록 보기 →')),
        lastSeason ? [
          h('p', { style: { margin: '0 0 2px' } }, h('span.muted', `${lastSeason.version} 시즌 합계`)),
          h('div.big-num', fmt(lastSeason.total)),
          best && best !== lastSeason ? h('p.muted', { style: { margin: '6px 0 10px', fontSize: '13.5px' } }, `최고 기록 ${best.version} 시즌 ${fmt(best.total)}점`) : h('div', { style: { height: '10px' } }),
          h('dl.ledger', { style: { maxWidth: '360px' } }, lastSeason.bosses.map((b) => [h('dt', b.name), h('dd', fmt(b.score))])),
        ] : h('p.muted', { style: { margin: 0 } }, '아직 기록한 시즌이 없습니다.'),
      ),
      h('section.panel.span-6',
        h('div.panel-head', h('h3', '모집', h('span.en', 'Summons')), h('a', { href: '#/gacha' }, '모집 기록 →')),
        h('p', { style: { margin: '0 0 2px' } }, h('span.muted', '현재 천장 카운트')),
        h('div.big-num', u.gacha.pity || 0, h('span.faint', { style: { fontSize: '20px' } }, ` / ${u.gacha.pityLimit || 70}`)),
        h('div.meter', h('i', { style: { width: `${Math.min(100, ((u.gacha.pity || 0) / (u.gacha.pityLimit || 70)) * 100)}%` } })),
        recentGacha ? h('p.muted', { style: { fontSize: '13.5px', margin: '10px 0 0' } }, `최근 배너: ${recentGacha.name} (${recentGacha.pulls || 0}회)`) : null,
        u.gacha.wishlist?.length ? h('div', { style: { marginTop: '12px' } }, h('span.faint', { style: { fontSize: '12.5px' } }, '다음 픽업 위시리스트'),
          h('div.faces', { style: { marginTop: '6px' } }, u.gacha.wishlist.slice(0, 8).map((w) => face(w.char)))) : null,
      ),
      h('section.panel.span-6',
        h('div.panel-head', h('h3', '스킨', h('span.en', 'Wardrobe')), h('a', { href: '#/skins' }, '갤러리 →')),
        h('p', { style: { margin: 0 } }, `${skinOwned} / ${costumes.length} 보유`),
        h('div.meter', h('i', { style: { width: `${costumes.length ? (skinOwned / costumes.length) * 100 : 0}%` } })),
        skinWish.length ? h('p.muted', { style: { fontSize: '13.5px', margin: '10px 0 0' } }, `갖고 싶은 스킨 ${skinWish.length}개: ${skinWish.slice(0, 3).map((s) => s.name).join(', ')}${skinWish.length > 3 ? ' 외' : ''}`) : null,
      ),
      h('section.panel.span-6',
        h('div.panel-head', h('h3', '육성 계획', h('span.en', 'Planner')), h('a', { href: '#/plans' }, '계획 보기 →')),
        activePlans.length
          ? [h('div.faces', activePlans.slice(0, 8).map((p) => face(p.char))), h('p.muted', { style: { fontSize: '13.5px', margin: '10px 0 0' } }, `진행 중 ${activePlans.length}건`)]
          : h('p.muted', { style: { margin: 0 } }, '진행 중인 계획이 없습니다.'),
      ),
      u.decks.decks.length ? h('section.panel.span-12',
        h('div.panel-head', h('h3', u.decks.decks[0].name, h('span.en', 'Main Team')), h('a', { href: '#/decks' }, '덱 전체 →')),
        h('div', { style: { maxWidth: '440px' } }, teamView(u.decks.decks[0].members)),
      ) : null,
    ),
  );
}

function stat(n, sub, label) {
  return h('div', h('b', fmt(n), sub ? h('small', ` ${sub}`) : null), h('span', label));
}

function score(r, c) {
  return (c.rarity * 1000) + (r.insight || 0) * 200 + (r.portray || 0) * 30 + (r.resonance || 0) * 5 + (r.euphoria ? 50 : 0);
}
