# Product Spec Plan (Draft)

Updated: 2026-03-04

## 1) Purpose

이 문서는 AI Usage Monitor의 다음 릴리즈 스펙을 정의한다.
목표는 기능 추가보다 "품질 기준과 배포 기준"을 먼저 고정하는 것이다.

## 2) Product Boundary

- Products:
  - VS Code Extension: `ai-usage-statusbar` (`0.2.7`)
  - Electron Tray App: `ai-usage-tray` (`0.3.6`)
- Runtime rule:
  - Provider adapter는 앱별 런타임에 유지한다.
  - Extension: `src/provider-adapter.ts`
  - Tray: `tray-app/provider-adapter.js`
  - 동일 계약(intent): `getClaudeUsage()`, `getCodexUsage()`

## 3) Milestone A (Quality Baseline)

Target release:
- Extension `0.2.8`
- Tray `0.3.7`

### Scope A1: Tray IPC/Renderer Smoke Tests

요구사항:
- 최소 핵심 IPC 경로 자동 검증
- 대상 이벤트/핸들러:
  - `mini-toggle-details`
  - `mini-inline-expand`
  - `game-pet-click`
  - `game-set-skin`
  - `game-set-sound`

수용 기준:
- 로컬에서 단일 명령으로 스모크 테스트 실행 가능
- 실패 시 어떤 IPC 경로가 실패했는지 로그로 식별 가능
- 테스트가 `main.js`의 현재 이벤트 이름과 불일치하면 실패

### Scope A2: Release Checklist Automation

요구사항:
- 릴리즈 전 필수 검증을 스크립트화
- 최소 검증 항목:
  - 루트 `npm run compile`
  - `node --check tray-app/main.js`
  - `node --check tray-app/provider-adapter.js`
  - 산출물/문서 동기화 점검

수용 기준:
- 단일 스크립트 실행 결과로 pass/fail 판단 가능
- 실패 시 종료 코드가 0이 아니어야 함
- 결과 요약이 사람이 읽을 수 있는 텍스트로 출력

### Scope A3: Game Logic Unit Tests

요구사항:
- 순수 로직 중심 단위 테스트 추가
- 우선 대상:
  - `tray-app/game-engine.js` (`processRefresh`, 미션/업적 진척)
  - `tray-app/game-store.js` (일/주 롤오버)

수용 기준:
- 시간/난수 의존 로직이 재현 가능한 방식으로 테스트됨
- 핵심 회귀 시나리오(레벨업, 미션 완료, 롤오버) 검증 포함
- 테스트가 CI 없이 로컬에서도 재현 가능

## 4) Milestone B (Product Polish)

Target release:
- Extension `0.3.0`
- Tray `0.4.0`

### Scope B1: Data Freshness/Source UX

요구사항:
- 사용자에게 데이터 신선도와 소스를 명확히 표시
- 표시 항목:
  - 마지막 성공 시각
  - 현재 데이터 소스(app-server/sessions/error)
  - stale 상태 기준과 이유

수용 기준:
- stale/error 오인 가능성이 줄어드는 UI 문구 제공
- app-server 실패 후 sessions fallback 시 출처 식별 가능

### Scope B2: Window Position Robustness

요구사항:
- 다중 모니터/해상도 변경 시 mini window 위치 안정성 강화

수용 기준:
- 디스플레이 추가/제거/해상도 변경 후 화면 밖 유실 없음
- 기존 저장 위치가 유효하면 우선 복원

### Scope B3: Diagnostics for Supportability

요구사항:
- 문제 재현을 위한 최소 진단 정보 제공
- 후보:
  - 최근 오류 요약
  - provider 상태 요약
  - 버전/환경 요약

수용 기준:
- 사용자가 이슈 등록 시 진단 정보 복사 가능
- 민감정보(토큰/개인식별) 노출 금지

## 5) Out of Scope (This Plan)

- 신규 게임 콘텐츠 대규모 확장
- 플랫폼 확장(macOS/Linux 트레이 앱 배포)
- 외부 서버 백엔드 도입

## 6) Definition of Done (Release Gate)

모든 릴리즈는 아래를 만족해야 한다.

1. 빌드/문법 검증 통과
2. 새 테스트(스모크/유닛) 통과
3. 문서 업데이트 완료 (`README.md`, `PROJECT_ANALYSIS.md`, `SESSION_HANDOFF.md` 필요 시)
4. 아티팩트/버전 정보 일관성 확인

## 7) Open Questions

1. 테스트 러너 표준은 무엇으로 통일할지 (`node:test` vs Jest/Vitest)
2. Windows 패키징 검증을 로컬 기준으로만 볼지, CI로 옮길지
3. Extension과 Tray의 버전 정책을 독립 유지할지(현재) 또는 릴리즈 묶음을 도입할지
