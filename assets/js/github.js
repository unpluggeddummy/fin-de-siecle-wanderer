// GitHub API — 사이트에서 바로 저장(커밋)하기
// 토큰은 이 브라우저의 localStorage 에만 저장되고 저장소에는 절대 올라가지 않는다.

const KEY = 'r1999.github';

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } }

/** 현재 주소에서 owner/repo 를 추측한다 (owner.github.io/repo 형태) */
export function guessRepo() {
  const host = location.hostname;
  const m = host.match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return { owner: '', repo: '' };
  const owner = m[1];
  const seg = location.pathname.split('/').filter(Boolean)[0];
  const repo = seg && !seg.includes('.') ? seg : `${owner}.github.io`;
  return { owner, repo };
}

export function getConfig() {
  let c = {};
  try { c = JSON.parse(safeGet(KEY) || '{}'); } catch { c = {}; }
  const g = guessRepo();
  return { owner: c.owner || g.owner, repo: c.repo || g.repo, branch: c.branch || 'main', token: c.token || '' };
}

export function setConfig(patch) {
  const next = { ...getConfig(), ...patch };
  safeSet(KEY, JSON.stringify(next));
  return next;
}

export function clearToken() { setConfig({ token: '' }); }
export function hasToken() { const c = getConfig(); return !!(c.token && c.owner && c.repo); }

async function api(path, { method = 'GET', body, raw } = {}) {
  const c = getConfig();
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      Authorization: `Bearer ${c.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.message || msg; } catch { /* 본문 없음 */ }
    const err = new Error(explain(res.status, msg));
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return raw ? res.text() : res.json();
}

function explain(status, msg) {
  if (status === 401) return '토큰이 올바르지 않거나 만료됐습니다. 설정에서 새 토큰을 넣어 주세요.';
  if (status === 403) return `권한이 부족합니다. 토큰에 이 저장소의 Contents 읽기·쓰기 권한이 있는지 확인해 주세요. (${msg})`;
  if (status === 404) return '저장소나 브랜치를 찾을 수 없습니다. 설정의 계정명·저장소명·브랜치를 확인해 주세요.';
  if (status === 409 || status === 422) return `저장 중 충돌이 생겼습니다. 잠시 후 다시 저장해 주세요. (${msg})`;
  return `GitHub 요청 실패: ${msg}`;
}

const repoPath = () => { const c = getConfig(); return `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`; };

/** 연결 확인: 저장소에 쓰기 권한이 있는지 */
export async function testConnection() {
  const c = getConfig();
  const info = await api(repoPath());
  const canPush = !!(info.permissions && (info.permissions.push || info.permissions.admin));
  let branchOk = true;
  try { await api(`${repoPath()}/branches/${encodeURIComponent(c.branch)}`); } catch { branchOk = false; }
  return { fullName: info.full_name, canPush, branchOk, defaultBranch: info.default_branch, pages: info.has_pages };
}

/** 파일 내용(문자열)과 sha 를 읽는다. 없으면 null */
export async function readText(path) {
  const c = getConfig();
  try {
    const meta = await api(`${repoPath()}/contents/${path}?ref=${encodeURIComponent(c.branch)}`);
    if (Array.isArray(meta)) return null;
    let text;
    if (meta.content && meta.encoding === 'base64') text = b64decode(meta.content);
    else text = await api(`${repoPath()}/git/blobs/${meta.sha}`, { raw: true });
    return { text, sha: meta.sha };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/**
 * 여러 파일을 커밋 하나로 저장한다.
 * files: [{ path, text } | { path, base64 }]
 */
export async function commitFiles(files, message) {
  const c = getConfig();
  const rp = repoPath();
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = await api(`${rp}/git/ref/heads/${encodeURIComponent(c.branch)}`);
    const headSha = ref.object.sha;
    const head = await api(`${rp}/git/commits/${headSha}`);
    const tree = [];
    for (const f of files) {
      const blob = await api(`${rp}/git/blobs`, {
        method: 'POST',
        body: f.base64 !== undefined ? { content: f.base64, encoding: 'base64' } : { content: f.text, encoding: 'utf-8' },
      });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await api(`${rp}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree } });
    const commit = await api(`${rp}/git/commits`, { method: 'POST', body: { message, tree: newTree.sha, parents: [headSha] } });
    try {
      await api(`${rp}/git/refs/heads/${encodeURIComponent(c.branch)}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
      return commit.sha;
    } catch (e) {
      // 그사이 다른 커밋(예: 깃허브 액션)이 들어오면 최신 커밋 위에서 다시 시도
      if ((e.status === 422 || e.status === 409) && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error('저장에 여러 번 실패했습니다. 잠시 후 다시 시도해 주세요.');
}

/** 워크플로 실행 (게임 데이터 업데이트) */
export async function runWorkflow(file, inputs = {}) {
  const c = getConfig();
  await api(`${repoPath()}/actions/workflows/${file}/dispatches`, { method: 'POST', body: { ref: c.branch, inputs } });
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
