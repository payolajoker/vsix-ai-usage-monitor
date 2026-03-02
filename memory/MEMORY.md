# AI Usage Monitor - Project Memory

## Project Overview
- VS Code Extension (v0.2.7) + Windows Tray App (v0.1.0)
- Repo: https://github.com/payolajoker/vsix-ai-usage-monitor.git
- Claude/Codex API 사용량 실시간 모니터링

## Key Files
- `src/extension.ts` - VS Code Extension 메인
- `tray-app/main.js` - Electron 트레이 앱 메인
- `tray-app/mini.html` - 트레이 위젯 UI (HTML+CSS+JS)
- `tray-app/package.json` - Electron 35.7.5, electron-builder 26.8.1
- `memory/tray-app-issues.md` - 트레이 앱 이슈/QA 기록

## Current Issue Status
- 트레이 앱 기존 미해결 10건 처리 완료 (2026-03-01)
- 보안 의존성 업그레이드 트랙 완료 (`electron-builder` 26.8.1, `electron` 35.7.5)
- 폰트 변경 후 UI 텍스트 잘림 이슈 대응 완료 (`mini.html` 레이아웃/ellipsis 보정)
- 하단 레이아웃 개편 완료 (footer 제거, 상태 텍스트 cat 하단 이동, 상세 패널 공통 헤더 구조)
- 스킨 UX 단순화 완료 (manual-only, 디테일 창 좌/우 변경만 허용)
- 7D reset 시간 포맷 개선 완료 (24h 초과 시 `d h`)
- 접힘/펼침 하단 여백 밸런스 재조정 완료 (`MINI_HEIGHT` 238, `MINI_HEIGHT_DETAILS` 500)
- Windows 알림 식별/타이틀 `AI USAGE`로 통일
- 흰 줄/토글 잔상 핫픽스 적용 (main authoritative detail toggle + resize repaint)
- 상세 내역 및 QA 결과: `memory/tray-app-issues.md`

## Completed Work
- 2026-03-01: Git 정리 (5커밋), 트레이 앱 안정화 (16개 수정)
- 2026-03-01: 트레이 앱 미해결 이슈 10건 반영 완료
  - 안정성: 렌더러 크래시 복구, 글로벌 unhandledRejection, 버전 하드코딩 제거
  - UI: 폰트 오프라인 번들, 상태 전환/패널 전환 애니메이션, error pixel bar 개선, footer 정렬
- 2026-03-01: 보안/빌드 트랙 완료
  - 의존성: `electron-builder` 26.8.1, `electron` 35.7.5
  - QA: `npm audit` 0건, `package:win`/`package:store` 빌드 성공
- 2026-03-01: UI QA 후속 수정
  - Playwright 기반 시각 검증으로 drawer 텍스트 잘림 재현/수정 확인
  - 긴 텍스트(리셋 시각/사용량) 주입 시 ellipsis 처리 정상 확인
- 2026-03-01: 하단 구조 리디자인
  - 요청 반영: `USED / RESET` 공통 헤더 + `CLAUDE/CODEX` 섹션형 상세 패널
  - footer(시계 행) 제거, 상태 텍스트를 고양이 아이콘 하단으로 이동
  - 확장 높이 증가(`MINI_HEIGHT_DETAILS` 620) 및 Playwright 시각 QA 완료
- 2026-03-01: 상세 UX 재조정
  - 스킨 자동 전환/AUTO-MANUAL 모드 제거, manual-only로 통일
  - 접힘 창 스킨 버튼 제거, 펼침 창에서 `<`/`>`로만 스킨 변경
  - 7D reset 포맷을 `d h`로 보강
  - 상단 흰 줄 아티팩트 대응(`zoom` 제거 + transparent/full-size 고정 + 즉시 리사이즈)
- 2026-03-01: 여백/알림명 조정
  - 접힘/펼침 하단 여백 균형화 (`238` / `500`)
  - 알림 AppUserModelId 및 Notification title을 `AI USAGE`로 변경
- 2026-03-01: 표시/토글 안정화 핫픽스
  - `mini-toggle-details`를 invoke/handle 기반으로 전환해 renderer-main 상태 불일치 감소
  - 리사이즈 직후 `webContents.invalidate()`로 repaint 강제
  - 투명 배경 alpha 보정(`backgroundColor: #01000000`)
