# Tray App 미해결 이슈

## 기능/안정성 이슈

### 1. electron-builder 호환성 (중간)
- `electron-builder` 24.x가 Electron 34와 호환성 문제 가능
- 패키징(`npm run package:win`) 시 실패할 수 있음
- **수정**: `electron-builder`를 25.x로 업그레이드

### 2. 렌더러 크래시 복구 없음 (중간)
- `render-process-gone` 이벤트 미처리
- 렌더러 크래시 시 미니 윈도우가 먹통 → 수동 재시작 필요
- **수정**: `main.js`에 `webContents.on('render-process-gone')` 핸들러 추가 → `createMiniWindow()` 재호출

### 3. 글로벌 unhandledRejection 핸들러 없음 (낮음)
- `refreshNow()`는 try-catch 추가됨, 하지만 다른 경로의 미처리 rejection은 앱 크래시 가능
- **수정**: `process.on('unhandledRejection', ...)` 추가

### 4. JSONRPC clientInfo 버전 하드코딩 (낮음)
- `main.js:967` — `version: '0.1.0'` 하드코딩
- **수정**: `require('./package.json').version` 사용

### 5. window-all-closed 불필요한 preventDefault (낮음)
- `main.js:49` — `event.preventDefault()` 불필요 (핸들러 존재만으로 충분)
- **수정**: `app.on('window-all-closed', () => {})` 로 단순화

---

## UI/심미적 이슈

### 6. "Press Start 2P" 폰트 미번들 (높음)
- **파일**: `mini.html:33`
- **문제**: Google Font "Press Start 2P"가 `font-family`에 지정되어 있으나:
  - `@import`나 `<link>` 태그 없음
  - 로컬 폰트 파일(`assets/fonts/`) 없음
  - 사용자 PC에 미설치 시 Consolas로 폴백 → 픽셀아트 감성 완전 소실
- **수정 옵션**:
  - A) Google Fonts CDN `<link>` 추가 (네트워크 필요)
  - B) `.woff2` 파일 번들 + `@font-face` 선언 (오프라인 지원, 권장)
  - 파일 위치: `tray-app/assets/fonts/PressStart2P-Regular.woff2`

### 7. 상태 전환 애니메이션 없음 (중간)
- **파일**: `mini.html` CSS
- **문제**: `state-calm` → `state-watch` → `state-high` 등 클래스 전환 시:
  - `box-shadow` 변화가 즉각적 (뚝뚝 끊김)
  - `filter` (saturate, brightness) 변화도 즉각적
- **수정**: `.widget`에 `transition: box-shadow 0.3s ease, filter 0.3s ease` 추가
- **주의**: `state-error`의 `glitch` 애니메이션과 충돌하지 않게 처리

### 8. 디테일 패널 열림/닫힘 전환 없음 (중간)
- **파일**: `mini.html` CSS + `main.js`
- **문제**: 미니 윈도우 높이가 228px ↔ 560px로 즉시 변경 (팍 바뀜)
- **수정**: CSS `transition` 또는 JS 애니메이션 추가
- **제약**: Electron `BrowserWindow.setSize()`도 연동 필요 → JS 측 단계적 리사이즈

### 9. 에러 상태 pixel bar (낮음)
- **파일**: `mini.html:279-282`
- **문제**: `.usage-row.error .pixel` 스타일이 전체 블록에 동일한 분홍색 적용
  - "on" 블록 구분 없이 전부 같은 색 → 정보 전달력 약함
- **수정**: 에러 시 블록을 비활성(회색)으로 표시하거나, 깜빡임 애니메이션 추가

### 10. footer 좌우 패딩 비대칭 (낮음)
- **파일**: `mini.html:356-358`
- **문제**: `padding-left: 2px` vs `padding-right: 8px`
- 의도적일 수 있으나, 시각적으로 미세하게 어색
- **수정**: 좌우 동일하게 `padding: 4px 6px` 등으로 통일

---

## 완료된 안정화 작업 (2026-03-01)
1. 단일 인스턴스 락 (`requestSingleInstanceLock`)
2. `refreshNow()` 이중 try-catch
3. `killChildProcess()` + Windows taskkill 폴백
4. 종료 중 트레이 클릭/리프레시 차단
5. 디스플레이 리스너 정리
6. `positionMiniWindow()` try-catch + 다중 모니터 지원
7. `updateMiniWindow()` IPC send try-catch
8. 자격증명 원자적 쓰기 (tmp + rename)
9. Codex 세션 파일 정렬 안전화 (statSync 폴백)
10. HTTP 응답 소켓 에러 핸들링
11. JSON-RPC 메시지 타입 검증
12. 탭 애니메이션 `document.hidden` 가드
13. `localStorage.setItem` try-catch
