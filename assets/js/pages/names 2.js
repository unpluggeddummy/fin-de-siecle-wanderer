// 다국어 이름표 (설정에서 켜면 메뉴에 나타남)
import { h, chip, downloadJSON } from '../ui.js';
import * as store from '../store.js';
import { afClass } from '../components.js';

const view = { q: '', unchecked: false };

export function render(root) {
  const editing = store.state.editing;
  const chars = store.state.game.characters;
  const tbody = h('tbody');
  const count = h('span.faint');
  const chipsBox = h('div.chips');

  function draw() {
    chipsBox.replaceChildren(chip('한국어 이름 미확인만', view.unchecked, () => { view.unchecked = !view.unchecked; draw(); }));
    const q = view.q.trim().toLowerCase();
    const list = chars.filter((c) => {
      if (view.unchecked && (c.nameChecked || store.state.user.roster.nameOverrides[c.id])) return false;
      if (q && ![store.charName(c), ...Object.values(c.name)].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    count.textContent = `${list.length}명`;
    tbody.replaceChildren(...list.map((c) => {
      const o = store.state.user.roster.nameOverrides[c.id];
      const unverified = !c.nameChecked && !o;
      const zh = c.name.zhCN || c.name.en;
      return h('tr',
        h('td.ko', editing
          ? h('input', { type: 'text', value: store.charName(c), 'aria-label': `${c.name.en} 한국어 이름`, onchange: (e) => store.update('roster', (s) => {
            const v = e.target.value.trim(); if (v && v !== c.name.ko) s.nameOverrides[c.id] = v; else delete s.nameOverrides[c.id];
          }, { silent: true }) })
          : [store.charName(c), unverified ? h('span.warn', '미확인') : null]),
        h('td', c.name.en), h('td', c.name.ja), h('td', c.name.zhCN), h('td', c.name.zhTW),
        h('td', `${c.rarity}성`),
        h('td', h('span.tag.af', { class: afClass(c) }, store.AFFLATUS[c.afflatus])),
        h('td', c.euphoria ? `${c.euphoria}종` : '—'),
        h('td', { style: { display: 'flex', gap: '8px' } },
          h('a', { href: `https://search.bilibili.com/all?keyword=${encodeURIComponent(zh + ' 重返未来')}`, target: '_blank', rel: 'noopener' }, 'B站'),
          h('a', { href: `https://bbs.nga.cn/thread.php?fid=-71960000&key=${encodeURIComponent(zh)}`, target: '_blank', rel: 'noopener' }, 'NGA'),
          h('a', { href: `https://arca.live/b/reverse1999?target=all&keyword=${encodeURIComponent(store.charName(c))}`, target: '_blank', rel: 'noopener' }, '아카'),
          h('a', { href: `https://reverse1999.fandom.com/wiki/${encodeURIComponent((c.name.en || '').replace(/ /g, '_'))}`, target: '_blank', rel: 'noopener' }, '위키')),
      );
    }));
  }

  root.append(
    h('div.page-head',
      h('div', h('h1', '다국어 이름표'), h('p', '한국어·영어·일본어·중국어(간체·번체) 이름과 커뮤니티 검색 링크. 중국 커뮤니티 공략을 찾을 때 쓰세요.')),
      h('div.toolbar', { style: { margin: 0 } },
        h('button.btn', { type: 'button', onclick: () => exportCSV(chars) }, 'CSV 내려받기'),
        h('button.btn', { type: 'button', onclick: () => downloadJSON('r1999-names.json', chars.map((c) => ({ id: c.id, ko: store.charName(c), ...c.name, rarity: c.rarity, afflatus: c.afflatus }))) }, 'JSON 내려받기'))),
    h('div.toolbar', h('div.grow', h('input', { type: 'search', placeholder: '어느 언어로든 검색', value: view.q, 'aria-label': '이름 검색', oninput: (e) => { view.q = e.target.value; draw(); } })), chipsBox, count),
    h('div.table-wrap', h('table',
      h('thead', h('tr', ['한국어', 'English', '日本語', '简体中文', '繁體中文', '성급', '영감', '광상', '검색'].map((t) => h('th', t)))),
      tbody)),
  );
  draw();
}

function exportCSV(chars) {
  const rows = [['id', 'ko', 'en', 'ja', 'zhCN', 'zhTW', 'rarity', 'afflatus', 'euphoria']];
  for (const c of chars) rows.push([c.id, store.charName(c), c.name.en, c.name.ja, c.name.zhCN, c.name.zhTW, c.rarity, store.AFFLATUS[c.afflatus], c.euphoria]);
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'r1999-names.csv' });
  document.body.append(a); a.click(); a.remove();
}
