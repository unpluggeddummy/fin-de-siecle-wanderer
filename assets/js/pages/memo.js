// 메모장 — 주인만 쓰는 메모. 저장소가 공개라서 내용은 메모 비밀번호로 암호화(AES-GCM)해 저장한다.
// 비밀번호를 모르면 data/user/memo.json 을 열어도 읽을 수 없다.
import { h, toast, fill, debounce, uid } from '../ui.js';
import * as store from '../store.js';
import { rerender } from '../app.js';
import * as gate from '../owner.js';

const REMEMBER = 'r1999.memo.pass';
const session = { key: null, notes: null, current: null };

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pass, saltB64) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: 250000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptNotes(key, notes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(notes)));
  return { iv: b64(iv), data: b64(ct) };
}
async function decryptNotes(key, m) {
  if (!m.data) return [];
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, key, unb64(m.data));
  return JSON.parse(dec.decode(pt));
}

function rememberGet() { try { return localStorage.getItem(REMEMBER); } catch { return null; } }
function rememberSet(v) { try { v ? localStorage.setItem(REMEMBER, v) : localStorage.removeItem(REMEMBER); } catch { /* 무시 */ } }

async function persist() {
  if (!session.key) return;
  const box = await encryptNotes(session.key, session.notes);
  store.update('memo', (m) => { m.v = 1; m.iv = box.iv; m.data = box.data; }, { silent: true });
}
const persistSoon = debounce(persist, 600);

export function render(root) {
  if (!gate.isOwner()) {
    root.append(h('div.empty', h('p', '메모장은 사이트 주인만 볼 수 있어요.'), h('a.btn', { href: '#/settings' }, '관리자 확인')));
    return;
  }
  const m = store.state.user.memo;
  root.append(h('div.page-head', h('div', h('h1', h('span.en', 'Private Notes'), '메모장'),
    h('p', '나만 보는 메모예요. 내용은 메모 비밀번호로 잠가서 저장하기 때문에, 공개 저장소의 파일을 열어도 읽을 수 없어요.'))));
  const box = h('div');
  root.append(box);

  if (!m.salt) { setupForm(box); return; }
  if (!session.key) {
    const saved = rememberGet();
    if (saved) { unlockWith(saved, true).then((ok) => { if (ok) rerender(); else lockForm(box); }); box.append(h('p.muted', '여는 중…')); return; }
    lockForm(box); return;
  }
  editor(box);
}

async function unlockWith(pass, quiet) {
  const m = store.state.user.memo;
  try {
    const key = await deriveKey(pass, m.salt);
    session.notes = await decryptNotes(key, m);
    session.key = key;
    return true;
  } catch {
    if (!quiet) toast('메모 비밀번호가 맞지 않아요.', 'err');
    rememberSet(null);
    return false;
  }
}

function setupForm(box) {
  const p1 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '메모 비밀번호' });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '한 번 더' });
  const keep = h('input', { type: 'checkbox', checked: true });
  fill(box, h('section.panel.lock', { style: { maxWidth: '440px', margin: '0' } },
    h('h3', '메모 비밀번호 정하기'),
    h('p.muted', { style: { fontSize: '13.5px' } }, '이 비밀번호로 메모를 잠가요. 잊어버리면 메모를 되살릴 수 없어요. 설정 비밀번호(숫자 4자리)보다 길게, 8자 이상을 권해요.'),
    h('form', { style: { display: 'grid', gap: '8px' }, onsubmit: async (e) => {
      e.preventDefault();
      if (p1.value.length < 4) { toast('4자 이상으로 정해 주세요.', 'err'); return; }
      if (p1.value !== p2.value) { toast('두 비밀번호가 달라요.', 'err'); return; }
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      store.update('memo', (m) => { m.v = 1; m.salt = salt; m.iv = null; m.data = null; }, { silent: true });
      session.key = await deriveKey(p1.value, salt);
      session.notes = [{ id: uid(), title: '첫 메모', body: '', updated: new Date().toISOString() }];
      if (keep.checked) rememberSet(p1.value);
      await persist();
      rerender();
    } }, p1, p2, h('label.check', { style: { fontSize: '13px' } }, keep, '이 기기에서 기억하기'), h('button.btn.primary', { type: 'submit' }, '메모장 만들기'))));
}

function lockForm(box) {
  const p = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '메모 비밀번호' });
  const keep = h('input', { type: 'checkbox' });
  fill(box, h('section.panel', { style: { maxWidth: '440px' } },
    h('h3', '메모장 열기'),
    h('form', { style: { display: 'grid', gap: '8px' }, onsubmit: async (e) => {
      e.preventDefault();
      if (await unlockWith(p.value)) { if (keep.checked) rememberSet(p.value); rerender(); }
    } }, p, h('label.check', { style: { fontSize: '13px' } }, keep, '이 기기에서 기억하기'), h('button.btn.primary', { type: 'submit' }, '열기'))));
  setTimeout(() => p.focus(), 0);
}

function editor(box) {
  const notes = session.notes;
  if (!session.current || !notes.find((n) => n.id === session.current)) session.current = notes[0]?.id || null;
  const list = h('div.memo-list');
  const pane = h('div.memo-pane');
  const drawList = () => fill(list,
    h('button.btn.small.primary', { type: 'button', onclick: () => {
      const n = { id: uid(), title: '', body: '', updated: new Date().toISOString() };
      notes.unshift(n); session.current = n.id; persistSoon(); drawList(); drawPane();
    } }, '+ 새 메모'),
    [...notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.updated).localeCompare(String(a.updated))).map((n) => h('button.memo-item', {
      type: 'button', 'aria-pressed': String(n.id === session.current),
      onclick: () => { session.current = n.id; drawList(); drawPane(); },
    }, h('b', (n.pinned ? '📌 ' : '') + (n.title || '제목 없음')), h('span', (n.body || '').slice(0, 60) || '내용 없음'), h('small', new Date(n.updated).toLocaleString('ko-KR')))),
  );
  const drawPane = () => {
    const n = notes.find((x) => x.id === session.current);
    if (!n) { fill(pane, h('div.empty', h('p', '메모가 없어요.'))); return; }
    const touch = () => { n.updated = new Date().toISOString(); persistSoon(); };
    fill(pane,
      h('div.memo-tools',
        h('input.memo-title', { type: 'text', value: n.title, placeholder: '제목', oninput: (e) => { n.title = e.target.value; touch(); drawListSoon(); } }),
        h('button.btn.small', { type: 'button', 'aria-pressed': String(!!n.pinned), onclick: () => { n.pinned = !n.pinned; touch(); drawList(); drawPane(); } }, n.pinned ? '고정 풀기' : '고정'),
        h('button.btn.small.danger', { type: 'button', onclick: () => {
          if (!confirm('이 메모를 지울까요?')) return;
          notes.splice(notes.indexOf(n), 1); session.current = notes[0]?.id || null; persistSoon(); drawList(); drawPane();
        } }, '지우기')),
      h('textarea.memo-body', { placeholder: '자유롭게 적어 주세요.', oninput: (e) => { n.body = e.target.value; touch(); drawListSoon(); } }, n.body),
    );
  };
  const drawListSoon = debounce(drawList, 400);
  drawList(); drawPane();
  fill(box,
    h('div.memo', list, pane),
    h('div.toolbar', { style: { marginTop: '12px' } },
      h('span.faint', { style: { fontSize: '12.5px' } }, '고친 내용은 자동으로 잠가 두고, 오른쪽 위 저장 버튼을 누르면 저장소에 올라가요.'),
      h('span', { style: { flex: 1 } }),
      h('button.btn.small.ghost', { type: 'button', onclick: () => { session.key = null; session.notes = null; rememberSet(null); rerender(); } }, '메모장 잠그기')),
  );
}
