# Tray App 이슈 상태 (업데이트: 2026-03-02)

## 상태 요약
- 기존 미해결 안정화/UI 이슈 10건: **완료**
- 보안/의존성 업그레이드 트랙: **완료**
- 게임화 시스템(0.3.x) 통합: **완료**
- 코드 문법 이슈(`game-store.js`): **완료**

## 반영 완료 항목
1. `electron-builder` `24.x -> 26.8.1`
2. `electron` `34.x -> 35.7.5`
3. 렌더러 크래시 복구 (`render-process-gone` + mini window recreate)
4. 글로벌 `unhandledRejection` 핸들러
5. JSON-RPC `clientInfo.version` 하드코딩 제거
6. `window-all-closed` 불필요 경로 단순화
7. `Press Start 2P` 폰트 오프라인 번들 적용
8. 상태 전환 시각 효과 개선 (`box-shadow`, `filter`)
9. 디테일 패널 전환/토글 UX 안정화
10. 에러 상태 pixel bar 표현 개선
11. footer/spacing 정렬 개선
12. 긴 텍스트 ellipsis/레이아웃 안정화
13. 상세 패널 구조 재배치 (`USED/RESET` 공통 헤더 + `CLAUDE/CODEX`)
14. 스킨 UX 단순화 (manual-only, detail view 좌/우 변경)
15. 창 높이/여백 재조정 (`MINI_HEIGHT=238`, `MINI_HEIGHT_DETAILS=500`)
16. 알림 identity/title `AI USAGE` 통일
17. 토글 authoritative path 적용 (`ipcRenderer.invoke('mini-toggle-details', ...)`)
18. 리사이즈 후 repaint 강제 (`webContents.invalidate()`)
19. 게임화 모듈 추가:
   - `game-config.js`, `game-engine.js`, `game-store.js`
   - XP/level/rebirth
   - 35 achievements + badges
   - daily/weekly quest
   - sound toggle/SFX
20. `game-store.js` 문법 복구:
   - `createDefaultData()` 객체 종료 누락 수정
   - 주석에 붙어 실행 누락된 `const dir = path.dirname(_dataPath);` 복구
   - `totalHeartbeats` 필드 복구

## QA / 검증 결과
- `npm run compile` (repo root): 성공
- `node --check tray-app/main.js`: 성공
- `node --check tray-app/game-config.js`: 성공
- `node --check tray-app/game-engine.js`: 성공
- `node --check tray-app/game-store.js`: 성공
- Playwright UI 시각 QA 증적:
  - `output/playwright/uiqa-before-text-fix.png`
  - `output/playwright/uiqa-after-text-fix.png`
  - `output/playwright/uiqa-after-longtext.png`
  - `output/playwright/uiqa-layout-collapsed-v3.png`
  - `output/playwright/uiqa-layout-expanded-v3.png`
  - `output/playwright/uiqa-layout-expanded-long-v3.png`
  - `output/playwright/uiqa-v4-collapsed.png`
  - `output/playwright/uiqa-v4-expanded.png`
  - `output/playwright/uiqa-v5-collapsed-spacing.png`
  - `output/playwright/uiqa-v5-expanded-spacing.png`
- 빌드 산출물 확인:
  - `tray-app/dist/AI Usage Tray 0.3.6.exe`
  - `tray-app/dist/ai-usage-tray-0.3.6-x64.nsis.7z`
  - `tray-app/dist/AI Usage Tray 0.3.6.appx`

## 참고 메모
- 자동화 환경에서 `npm run package:win`은 장시간 실행 후 타임아웃될 수 있으나,
  산출물 타임스탬프 기준으로 패키징 결과물은 갱신됨.
- `npm run package:store` 재실행 성공 (`AI Usage Tray 0.3.6.appx` 생성).

## 잔여 이슈
- 코드/문법/정적 검증 기준 잔여 미해결 항목 없음
- 수동 체감 QA(애니메이션, 실제 작업 환경 배치)는 추가 확인 권장
