// 주인 확인 — 설정 화면과 편집 버튼은 비밀번호를 넣은 기기에서만 보인다.
// 공개 사이트라 이 확인은 '가리개'일 뿐이고, 실제로 기록을 바꿀 수 있는 건 GitHub 토큰을 넣은 브라우저뿐이다.
import * as gh from './github.js';

const KEY = 'r1999.owner';
const SALT = 'fin-de-siecle-wanderer:';
// 비밀번호의 SHA-256 해시 (비밀번호를 바꾸려면 이 값을 바꾼다)
const PASS_HASH = 'b35a06c6c6f60b370494ca7ce04a15f96d3cf0bdf6124a88d3f0db383d03ba71';

function get() { try { return localStorage.getItem(KEY); } catch { return null; } }
function set(v) { try { v === null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v); } catch { /* 저장 불가 */ } }

export function isOwner() { return get() === PASS_HASH || gh.hasToken(); }

export async function unlock(password) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SALT + String(password).trim()));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== PASS_HASH) return false;
  set(PASS_HASH);
  apply();
  return true;
}

export function lock() { set(null); gh.clearToken(); apply(); }

export function apply() { document.body.classList.toggle('owner', isOwner()); }
