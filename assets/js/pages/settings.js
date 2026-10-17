// 설정 — GitHub 연결(사이트에서 바로 저장), 사이트 이름, 다국어 이름표, 백업, 게임 데이터 갱신
import { h, field, toast, downloadJSON, pickFile, readFileText } from '../ui.js';
import * as store from '../store.js';
import * as gh from '../github.js';
import { rerender } from '../app.js';

export function render(root) {
  const cfg = gh.getConfig();
  const s = store.state.user.settings;
  const editing = store.state.editing;
  const status = h('div.status', gh.hasToken() ? '이 브라우저는 GitHub에 연결되어 있습니다.' : '아직 연결하지 않았습니다. 방문자는 기록을 볼 수만 있고, 연결한 브라우저에서만 편집·저장할 수 있어요.');
  if (gh.hasToken()) status.classList.add('ok');

  const owner = h('input', { type: 'text', value: cfg.owner, placeholder: 'GitHub 계정명', autocomplete: 'off' });
  const repo = h('input', { type: 'text', value: cfg.repo, placeholder: '저장소 이름', autocomplete: 'off' });
  const branch = h('input', { type: 'text', value: cfg.branch, placeholder: 'main', autocomplete: 'off' });
  const token = h('input', { type: 'password', value: cfg.token, placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: false });

  async function connect() {
    gh.setConfig({ owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() || 'main', token: token.value.trim() });
    status.className = 'status'; status.textContent = '확인 중…';
    try {
      const r = await gh.testConnection();
      if (!r.canPush) throw new Error('이 토큰으로는 저장소에 쓸 수 없습니다. Contents 권한을 "Read and write"로 주세요.');
      if (!r.branchOk) throw new Error(`'${gh.getConfig().branch}' 브랜치가 없습니다. 기본 브랜치는 '${r.defaultBranch}'입니다.`);
      status.className = 'status ok';
      status.textContent = `${r.fullName}에 연결했습니다. 이제 편집 모드에서 바꾼 내용을 저장할 수 있어요.`;
      if (!store.hasChanges()) await store.loadUser();
      store.setEditing(true);
      toast('GitHub에 연결했습니다.');
    } catch (e) {
      status.className = 'status err';
      status.textContent = e.message;
    }
  }

  function disconnect() {
    if (store.hasChanges() && !confirm('저장하지 않은 변경 사항이 있습니다. 그래도 연결을 끊을까요? (변경 사항은 이 브라우저에 남아 있어요)')) return;
    gh.clearToken();
    store.setEditing(false);
    toast('이 브라우저에서 토큰을 지웠습니다.');
    rerender();
  }

  const upd = (fn) => store.update('settings', fn, { silent: true });
  const runBtn = h('button.btn', { type: 'button', disabled: !gh.hasToken(), onclick: async () => {
    try {
      await gh.runWorkflow('update-game-data.yml', { force_images: 'false' });
      toast('게임 데이터 갱신을 시작했습니다. 5~10분 뒤 새로 고침하면 반영돼요.');
    } catch (e) { toast(e.message, 'err'); }
  } }, '지금 게임 데이터 갱신');

  const actionsURL = cfg.owner && cfg.repo ? `https://github.com/${cfg.owner}/${cfg.repo}/actions` : null;
  const tokenURL = 'https://github.com/settings/personal-access-tokens/new';

  root.append(
    h('div.page-head', h('div', h('h1', h('span.en', 'Settings'), '설정'))),
    h('div.settings',
      h('section.panel',
        h('h3', 'GitHub 연결 (사이트에서 바로 저장)'),
        h('p.muted', { style: { marginTop: 0, fontSize: '14px' } }, '저장 버튼을 누르면 이 사이트가 저장소의 data/user 폴더에 직접 커밋합니다. 토큰은 이 브라우저에만 보관되고 저장소에는 올라가지 않아요.'),
        h('ol.steps-list',
          h('li', h('a', { href: tokenURL, target: '_blank', rel: 'noopener' }, 'Fine-grained 토큰 만들기'), ' 페이지를 엽니다.'),
          h('li', 'Repository access: ', h('b', 'Only select repositories'), ' → 이 사이트 저장소 하나만 고릅니다.'),
          h('li', 'Permissions → Repository permissions: ', h('b', 'Contents: Read and write'), ', ', h('b', 'Actions: Read and write'), ' (게임 데이터 갱신 버튼용).'),
          h('li', '만료 기간은 원하는 대로 정하고, 만든 토큰을 아래에 붙여 넣습니다.'),
        ),
        h('div.fields', { style: { marginTop: '14px' } },
          field('계정명', owner), field('저장소', repo), field('브랜치', branch), field('토큰', token, 'wide')),
        h('div.toolbar', { style: { marginTop: '12px', marginBottom: '10px' } },
          h('button.btn.primary', { type: 'button', onclick: connect }, gh.hasToken() ? '다시 확인' : '연결'),
          gh.hasToken() ? h('button.btn.danger', { type: 'button', onclick: disconnect }, '이 브라우저에서 연결 끊기') : null),
        status,
        h('p.faint', { style: { fontSize: '13px', marginBottom: 0 } }, '공용 컴퓨터에서는 쓰고 나서 꼭 연결을 끊어 주세요. 다른 기기에서도 같은 토큰을 넣으면 그 기기에서 편집할 수 있어요.'),
      ),
      h('section.panel',
        h('h3', '사이트'),
        h('div.fields',
          field('영문 제목', h('input', { type: 'text', value: s.titleEn || 'Fin de Siècle Wanderer', disabled: !editing, onchange: (e) => store.update('settings', (x) => { x.titleEn = e.target.value; }) })),
          field('한국어 제목', h('input', { type: 'text', value: s.title || '', disabled: !editing, onchange: (e) => store.update('settings', (x) => { x.title = e.target.value; }) })),
          field('윗줄 문구', h('input', { type: 'text', value: s.subtitle || '', disabled: !editing, onchange: (e) => store.update('settings', (x) => { x.subtitle = e.target.value; }) })),
          field('서버', h('select', { disabled: !editing, onchange: (e) => upd((x) => { x.server = e.target.value; }) },
            ['한섭', '글로벌', '중섭', '일섭'].map((v) => h('option', { selected: s.server === v }, v))))),
        h('div', { style: { marginTop: '12px' } },
          h('label.check', h('input', { type: 'checkbox', checked: !!s.showNames, disabled: !editing,
            onchange: (e) => store.update('settings', (x) => { x.showNames = e.target.checked; }) }), '메뉴에 다국어 이름표 보이기')),
        h('p.faint', { style: { fontSize: '13px', marginBottom: 0 } }, '숨겨 두어도 ', h('a', { href: '#/names' }, '#/names'), ' 주소로는 들어갈 수 있어요.', editing ? '' : ' (바꾸려면 편집 모드를 켜세요)'),
      ),
      h('section.panel',
        h('h3', '게임 데이터 (출품작·스킨·의지·보스 이미지)'),
        h('p.muted', { style: { marginTop: 0, fontSize: '14px' } },
          '깃허브 액션이 매주 월요일 새벽에 게임 데이터와 이미지를 받아 저장소에 커밋합니다. 새 출품작이나 스킨이 나왔을 때 바로 갱신하려면 아래 버튼을 누르세요. 내 기록(data/user)은 건드리지 않아요.'),
        h('p.faint', { style: { fontSize: '13px' } }, `마지막 갱신: ${new Date(store.state.game.meta.updatedAt).toLocaleString('ko-KR')}`),
        h('div.toolbar', { style: { margin: 0 } }, runBtn, actionsURL ? h('a.btn.ghost', { href: actionsURL, target: '_blank', rel: 'noopener' }, '실행 기록 보기') : null),
      ),
      h('section.panel',
        h('h3', '백업'),
        h('p.muted', { style: { marginTop: 0, fontSize: '14px' } }, '모든 기록을 JSON 파일 하나로 내려받거나, 백업 파일로 되돌립니다. 저장소에도 커밋 기록이 남아 있어서 예전 상태로 돌아갈 수 있어요.'),
        h('div.toolbar', { style: { margin: 0 } },
          h('button.btn', { type: 'button', onclick: () => downloadJSON(`r1999-backup-${new Date().toISOString().slice(0, 10)}.json`, { version: 1, exportedAt: new Date().toISOString(), ...store.state.user }) }, '전체 기록 내려받기'),
          h('button.btn.edit-only', { type: 'button', onclick: restore }, '백업에서 되돌리기'),
          store.hasChanges() ? h('button.btn.danger.edit-only', { type: 'button', onclick: () => {
            if (!confirm('저장하지 않은 변경 사항을 모두 버리고 저장소의 기록을 다시 불러올까요?')) return;
            store.discardDrafts(); store.loadUser().then(() => toast('변경 사항을 버렸습니다.'));
          } }, '저장 안 한 변경 버리기') : null),
      ),
    ),
  );
}

async function restore() {
  const f = await pickFile('application/json,.json');
  if (!f) return;
  try {
    const data = JSON.parse(await readFileText(f));
    if (!data.roster && !data.bulletin) throw new Error('이 사이트의 백업 파일이 아닙니다.');
    if (!confirm('지금 기록을 백업 파일 내용으로 바꿀까요? 저장 버튼을 눌러야 저장소에 반영돼요.')) return;
    store.replaceAll(data);
    toast('백업을 불러왔습니다. 확인 후 저장해 주세요.');
  } catch (e) { toast(`불러오지 못했습니다: ${e.message}`, 'err'); }
}
