# 1999 기록실

리버스: 1999 개인 기록 사이트. 캐릭터 육성 상태, 갈기의 게시판 점수, 스킨, 의지, 덱, 육성 계획, 모집 기록을 한곳에 남깁니다.
GitHub Pages로 공개되고, 주인은 사이트에서 바로 편집·저장합니다.

## 처음 한 번만 하는 설정

1. **Pages 켜기** — 저장소 Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)` → Save.
   1~2분 뒤 `https://<계정명>.github.io/<저장소>/` 에서 열립니다.
2. **Actions 쓰기 권한** — Settings → Actions → General → Workflow permissions: `Read and write permissions` → Save.
3. **토큰 만들기** — [Fine-grained token](https://github.com/settings/personal-access-tokens/new)
   - Repository access: Only select repositories → 이 저장소
   - Permissions: `Contents` Read and write, `Actions` Read and write
4. 사이트의 **설정** 탭에 계정명·저장소·토큰을 넣고 **연결**. 이제 오른쪽 위 **편집**을 켜고 고친 뒤 **저장**하면 커밋됩니다.

토큰은 그 브라우저의 localStorage에만 남고 저장소에는 올라가지 않습니다. 방문자는 기록을 보기만 할 수 있어요.

## 폴더

| 경로 | 내용 |
| --- | --- |
| `data/user/*.json` | 내 기록 (사이트에서 저장하면 여기에 커밋됨) |
| `data/user/shots/` | 갈기의 게시판 결과 스크린샷 |
| `data/game/*.json` | 게임 데이터 (캐릭터·스킨·의지·재료·게시판 보스) — 액션이 자동 갱신 |
| `assets/img/` | 캐릭터·스킨·의지·재료·보스 이미지 — 액션이 자동 갱신 |
| `scripts/` | 게임 데이터 갱신 스크립트 |

## 게임 데이터 갱신

`.github/workflows/update-game-data.yml` 이 매주 월요일 새벽(한국 시간)에 돌고, 사이트 설정 화면의 **지금 게임 데이터 갱신** 버튼이나 Actions 탭에서 바로 실행할 수 있습니다.

데이터와 이미지 출처:
[re1999-data-global](https://github.com/St-Pavlov-Foundation/re1999-data-global) (공식 글로벌 클라이언트 데이터, 한국어 이름 포함),
[Reverse-1999-CN-Asset](https://github.com/myssal/Reverse-1999-CN-Asset) (스킨·의지·보스 그림),
[Kornblume](https://github.com/windbow27/kornblume) (육성 재료),
[r1999-roster](https://github.com/UnderLotus/r1999-roster) (신규 캐릭터 초상),
[Reverse: 1999 Wiki](https://reverse1999.fandom.com) (게임 에셋에 없는 스킨 그림 보충).

## 다른 도구에서 가져오기

캐릭터 탭의 **시뮬레이터 JSON 가져오기**로 [버틴의 여행가방 캐릭터 메모장](https://www.reverse1999-simulator.com/ko/roster) 등에서 내보낸 JSON을 읽습니다. 이름(한·영·중·일)이나 캐릭터 id로 맞춥니다.

---

팬이 만든 비공식 사이트입니다. 게임 이미지와 데이터의 권리는 Bluepoch에 있습니다.
