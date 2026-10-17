// Reverse: 1999 팬덤 위키(영문)의 모든 문서 원문(wikitext)을 MediaWiki API로 받아
// data/raw/fandom/pages-XX.json 에 나눠 저장한다. 출품작·스킨 출시 버전 등을 찾을 때 쓴다.
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'data/raw/fandom';
const API = 'https://reverse1999.fandom.com/api.php';
const UA = { 'User-Agent': 'fin-de-siecle-wanderer personal fan archive (GitHub Actions)' };
fs.mkdirSync(OUT, { recursive: true });

let cont = {};
let batch = [];
let file = 0;
let total = 0;
const flush = () => {
  if (!batch.length) return;
  fs.writeFileSync(path.join(OUT, `pages-${String(file).padStart(2, '0')}.json`), JSON.stringify(batch, null, 0));
  file++; batch = [];
};
for (let guard = 0; guard < 400; guard++) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2',
    generator: 'allpages', gapnamespace: '0', gaplimit: '50', gapfilterredir: 'nonredirects',
    prop: 'revisions', rvprop: 'content|timestamp', rvslots: 'main', ...cont,
  });
  const res = await fetch(`${API}?${params}`, { headers: UA });
  if (!res.ok) { console.error('요청 실패', res.status); break; }
  const j = await res.json();
  for (const pg of j.query?.pages || []) {
    const rev = pg.revisions?.[0];
    batch.push({ title: pg.title, ts: rev?.timestamp, text: rev?.slots?.main?.content || '' });
    total++;
  }
  if (batch.length >= 200) flush();
  if (!j.continue) break;
  cont = j.continue;
  await new Promise((r) => setTimeout(r, 300));
}
flush();
console.log(`위키 문서 ${total}개 저장`);
