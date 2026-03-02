# Tray App 이슈 상태 (업데이트: 2026-03-01)

## 이번 배치 처리 결과
- 상태: **기존 미해결 10건 + 보안 의존성 트랙 반영 완료**
- 기준 문서: `memory/tray-app-issues.md`의 기존 1~10번 항목 + 후속 보안 작업

## 반영 완료 항목
1. `electron-builder` 24.x -> 25.x -> **26.8.1** 업그레이드 (`tray-app/package.json`, `tray-app/package-lock.json`)
2. `electron` 34.x -> **35.7.5** 업그레이드 (`tray-app/package.json`, `tray-app/package-lock.json`)
3. 렌더러 크래시 복구 추가 (`webContents.on('render-process-gone')` + `recreateMiniWindow()`)
4. 글로벌 `unhandledRejection` 핸들러 추가
5. JSON-RPC `clientInfo.version` 하드코딩 제거 (`require('./package.json').version`)
6. `window-all-closed` 핸들러 단순화 (`preventDefault` 제거)
7. `Press Start 2P` 폰트 오프라인 번들 적용 (`tray-app/assets/fonts/PressStart2P-Regular.woff2`, `@font-face`)
8. 상태 전환 트랜지션 추가 (`box-shadow`, `filter`)
9. 디테일 패널 전환 개선
10. 에러 상태 pixel bar 시각 개선 (분홍 단색 제거, 비활성 톤 + 가변 opacity)
11. footer 좌우 패딩 대칭화
12. 폰트 적용 후 텍스트 잘림 대응 (`mini.html`)
  - `.hline`을 `flex` -> `grid`로 변경하고 좌/우 텍스트에 `ellipsis` 적용
  - `.info` 고정 row 템플릿 제거(`grid-auto-rows`)로 drawer/row 배치 안정화
  - 브라우저 QA용 `ipcRenderer` 안전 가드 추가 (`require` 부재 시 no-op)
13. 상세 패널 하단 구조 개편 (`mini.html`, `main.js`)
  - footer(시계 행) 제거
  - 상태 텍스트(`HIGH/CALM`)를 고양이 아이콘 하단으로 이동
  - 상세 블록을 공통 구조로 재배치:
    - `USED / RESET` 공통 헤더
    - `CLAUDE` 섹션 (`5H`, `7D`)
    - `CODEX` 섹션 (`5H`, `7D`)
  - 확장 높이 상향 (`MINI_HEIGHT_DETAILS: 560 -> 620`)
14. 상세 UX 규칙 재정의 (`mini.html`, `main.js`)
  - 7D reset 포맷 규칙 변경: 24h 초과 시 `d h` 표기 (예: `2d 1h`)
  - 스킨 시스템을 **manual-only**로 단순화
    - 상태 기반 자동 스킨 전환 제거
    - `AUTO/MANUAL` 모드 제거
  - 기본(접힘) 창에서 스킨 제어 제거 (상단 SKIN 버튼 삭제)
  - 디테일 창에서만 스킨 좌/우 변경 허용 (`<`, `>`)
  - 상단 흰 줄 아티팩트 대응:
    - `body zoom` 제거 후 `transform scale`로 전환
    - `html/body` transparent + full-size 고정
    - 디테일 패널 높이 변경을 단계 애니메이션 -> 즉시 리사이즈로 변경
15. 여백/알림명 추가 조정 (`main.js`)
  - 창 높이 재조정으로 접힘/펼침 하단 여백 밸런스 조정:
    - `MINI_HEIGHT: 228 -> 238`
    - `MINI_HEIGHT_DETAILS: 620 -> 500`
  - Windows 알림 식별/타이틀을 `AI USAGE` 기준으로 변경:
    - `app.setAppUserModelId('AI USAGE')`
    - Notification title: `AI USAGE`
16. 흰 줄/접힘 잔여창 핫픽스 (`main.js`, `mini.html`)
  - 상세 토글을 `renderer local toggle` -> `main process authoritative`로 변경
    - `ipcRenderer.invoke('mini-toggle-details', next)` 사용
    - `ipcMain.handle('mini-toggle-details', ...)`에서 최종 상태 반환
  - 리사이즈 직후 `webContents.invalidate()`로 강제 repaint
  - 투명 배경 플래시/잔상 완화를 위해 window background alpha 조정 (`#00000000 -> #01000000`)
  - Windows compositor 타이밍 이슈 대비: 높이 적용 후 bounds 재검증 + 2차 강제 setBounds

## QA 실행 결과 (2026-03-01)
- `npm run compile` (repo root): 성공
- `node --check tray-app/main.js`: 성공
- `npm run start` 스모크(10초): 프로세스 생존 확인 후 종료
- `npm run package:win` (`tray-app`): 성공
  - 산출물: `tray-app/dist/AI Usage Tray 0.1.0.exe`
- `npm run package:store` (`tray-app`): 성공
  - 산출물: `tray-app/dist/AI Usage Tray 0.1.0.appx`
- `npm audit --json` (`tray-app`): **취약점 0건**
- Playwright UI QA (`mini.html`, local server):
  - 재현: 폰트 변경 후 drawer 텍스트 우측 잘림(ellipsis 미적용)
  - 수정 후 확인: 긴 텍스트는 `...`로 축약되며 레이아웃 겹침/잘림 없음
  - 정량 확인: `scrollWidth > clientWidth` 이면서 `text-overflow != ellipsis`인 텍스트 요소 0건 (`[]`)
  - 증적 스크린샷:
    - 수정 전: `output/playwright/uiqa-before-text-fix.png`
    - 수정 후: `output/playwright/uiqa-after-text-fix.png`
    - 긴 텍스트 주입 검증: `output/playwright/uiqa-after-longtext.png`
- Playwright UI QA v3 (하단 구조 개편):
  - 접힘 상태: footer 제거 + 상태 텍스트가 고양이 하단에 노출됨
  - 펼침 상태: `USED / RESET` 공통 헤더 + `CLAUDE/CODEX` 섹션 구조 확인
  - 긴 리셋 문자열 주입 시 detail value 칼럼에서 ellipsis로 안정적으로 축약됨
  - 증적 스크린샷:
    - 접힘: `output/playwright/uiqa-layout-collapsed-v3.png`
    - 펼침: `output/playwright/uiqa-layout-expanded-v3.png`
    - 펼침(긴 값): `output/playwright/uiqa-layout-expanded-long-v3.png`
- Playwright UI QA v4 (요청 4건 반영):
  - 접힘 상태: 상단 SKIN 버튼 제거, 상태 텍스트 cat 하단 유지
  - 펼침 상태: 스킨 좌/우 버튼만 노출 (모드 버튼 없음)
  - 7D 포맷 로직 확인: 24h 초과 케이스에서 `d h` 계산 결과 확인
  - 상단 흰 줄 아티팩트 미재현
  - 증적 스크린샷:
    - 접힘: `output/playwright/uiqa-v4-collapsed.png`
    - 펼침: `output/playwright/uiqa-v4-expanded.png`
- Playwright UI QA v5 (여백 재조정):
  - 접힘 하단 여백: `18px -> 28px`
  - 펼침 하단 여백: `157px -> 37px`
  - 증적 스크린샷:
    - 접힘: `output/playwright/uiqa-v5-collapsed-spacing.png`
    - 펼침: `output/playwright/uiqa-v5-expanded-spacing.png`
- 런타임 핫픽스 검증:
  - `npm run start` 스모크(12초): 기동 정상
  - 토글 경로 코드 검증:
    - `ipcMain.handle('mini-toggle-details')` 존재
    - renderer `ipcRenderer.invoke('mini-toggle-details', next)` 존재
    - 리사이즈 후 `webContents.invalidate()` 호출 확인

## 잔여 이슈
- 코드/패키징/보안 감사 기준 잔여 미해결 항목 없음
- 수동 UI 시각 QA(실기기 화면/애니메이션 체감)는 별도 확인 권장
