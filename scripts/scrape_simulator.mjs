// reverse1999-simulator.com 의 출품작·스킨 목록을 실제 브라우저로 열어,
// 페이지가 불러오는 JSON 응답과 화면 글자를 그대로 data/raw/simulator/ 에 저장한다.
// (사이트가 화면을 그린 뒤 데이터를 불러오는 방식이라 일반 다운로드로는 내용을 얻을 수 없다)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'data/raw/simulator';
const PAGES = [
  ['character', 'https://www.reverse1999-simulator.com/ko/character'],
  ['skin', 'https://www.reverse1999-simulator.com/ko/skin'],
];
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const summary = [];
for (const [name, url] of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const jsons = [];
  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      const u = res.url();
      if (ct.includes('json') || /\.json(\?|$)/.test(u)) {
        const body = await res.text();
        if (body.length > 200) jsons.push({ url: u, body });
      }
    } catch { /* 무시 */ }
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  // 끝까지 스크롤해 지연 로딩되는 항목까지 불러온다
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(400); }
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  const html = await page.content();
  fs.writeFileSync(path.join(OUT, `${name}.txt`), text);
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  jsons.forEach((j, i) => fs.writeFileSync(path.join(OUT, `${name}-${String(i).padStart(2, '0')}.json`), j.body));
  fs.writeFileSync(path.join(OUT, `${name}-urls.txt`), jsons.map((j) => j.url).join('\n'));
  summary.push(`${name}: 글자 ${text.length}자, JSON ${jsons.length}개`);
  await page.close();
}
await browser.close();
console.log(summary.join('\n'));
