# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code(및 기여자)를 위한 가이드다.

## 프로젝트 개요
**모카 스트리트** — Three.js(r158, 로컬 `three.min.js`)로 만든 1인칭 커피숍 운영 시뮬레이터. **빌드 단계가 없다.** 정적 파일을 브라우저에서 바로 실행한다.

## 실행 / 확인
빌드·번들러·패키지 매니저 없음. 로컬 정적 서버로 폴더를 서빙하고 `index.html`을 연다(포인터 락 사용).
```
npx serve .        # 또는: python -m http.server
```
- **JS 문법 검사**: `node --check js/<파일>.js` (테스트 스위트는 없음)
- **밸런스 분석**: `node tools/balance-sim.js` (게임플레이 변경 없는 순수 계산 도구)

## 아키텍처 (모듈 = 전역 IIFE)
각 `js/*.js`는 `const X = (() => { ... return {...}; })()` 형태의 전역 모듈이고, `index.html`이 `<script>`로 **아래 순서대로** 로드한다. 빌드/임포트 없음 → **모듈 간 통신은 전역 객체**로 한다: `Game`, `DATA`, `AudioFX`, `Effects`, `UI`, `Tutorial`, `World`/`env`, `Customers`, `Player`, `Editor`.

로드 순서(의존성 순): `audio → data → textures → world → customers → player → effects → ui → tutorial → game → editor → main`

| 파일 | 전역 | 역할 | 줄수(대략) |
|---|---|---|---|
| `js/audio.js` | `AudioFX` | WebAudio 사운드(샷·스팀·딩·캐시 등) | ~290 |
| `js/data.js` | `DATA` | **게임/경제 상수 단일 출처** — `RECIPES`·`DESSERTS`·`LEVEL_XP`·`UPGRADES`·`EQUIPMENT`·`RESTOCK`·`RENT_*`·`rentFor`·`dailyGoalFor`·`DAY_LEN`·`SAVE_KEY`·`BANKRUPT_LIMIT` | ~80 |
| `js/textures.js` | `TEX` | 프로시저럴 캔버스 텍스처(마루/대리석/벽돌/칠판/거리) | ~400 |
| `js/world.js` | `World`/`env` | 카페 인테리어·머신 모델·조명·충돌·`env`(좌표/머신/스팟) 정의 | ~1070 |
| `js/customers.js` | `Customers` | 손님 모델·대기열 AI·인내심·픽업 이동 | ~340 |
| `js/player.js` | `Player` | 1인칭 컨트롤러·상호작용 레이캐스트 | ~120 |
| `js/effects.js` | `Effects` | 파티클·서빙 연출 등 시각 효과 | ~150 |
| `js/ui.js` | `UI` | HUD(`UI.hud`)·시계(`UI.clock`)·패널 등 DOM/UI | ~290 |
| `js/tutorial.js` | `Tutorial` | 신규 게임 인터랙티브 튜토리얼 | ~80 |
| `js/game.js` | `Game` | **핵심**: 주문·경제·하루 사이클·머신 작업·입력·`toast()`·`save()` | ~1400 |
| `js/editor.js` | `Editor` | `[B]` 기구 편집 모드(들기/회전/설치·레이아웃 저장 `mochaLayout_v1`) | ~270 |
| `js/main.js` | — | 렌더러(ACES 톤매핑·소프트 섀도)·증기 파티클·메인 루프·포인터락 | ~205 |
| `index.html` | — | DOM/HUD/CSS + 스크립트 로드 | ~370 |

> 참고: game.js는 과거 단일 거대 파일이었으나 audio/data/effects/ui/tutorial 모듈로 분리됐다. **상수를 바꾸려면 `data.js`를 본다.**

## 핵심 시스템 (수정 시 주의점)
- **하루 사이클**: `prep`(준비, 시간정지) → `playing`(영업, `DAY_LEN=300s`) → `dayEnd`(정산). 상태는 `mode` 변수. 영업 시작=`beginOpen()`, 마감=`endDay()`.
- **상태 저장**: 단일 객체 `S`(money/day/rep/level/xp/stocks/upgrades/equip…)를 `localStorage`(`SAVE_KEY`)에 JSON 직렬화. `save()`는 `endDay`와 **구매·재고보충 시 즉시** 호출(정책 일관성 유지할 것).
- **머신 작업은 모두 비동기**: 그라인더·에스프레소·스티머·온수기는 "올려두고 다른 일 → 프로그레스 바 완료 시 회수" 구조. `updateSlots`/`updateJobs`가 시간 진행. 업그레이드가 소요시간을 바꿈(`fastShot`/`fastSteam` 등).
- **포터필터 라이프사이클**: 빈상태→원두→탬핑→사용가루 순환(영구 도구, 버릴 수 없음). 탬핑은 `[E]` 홀드 미니게임(`useDown`, 퍼펙트 존 → 팁 보너스). 포커스/포인터락 상실 시 `useDown`을 강제 해제한다.
- **레시피 매칭**: `matchesRecipe`가 주문 `target`과 들고 있는 음료의 정규화 상태를 비교(여분 필드 `perfect` 등은 매칭에 영향 없음). 레시피엔 `seq`/`steps`(제조순서)도 있어 순서 보너스에 쓰인다.
- **경제 상수**(`data.js`): **밸런스 수치는 여기 단일 출처** — 바꾸면 `tools/balance-sim.js`의 복제 상수도 함께 갱신할 것.
- **좌표/스팟**: `world.js`의 `env`에 `queueSpots`·`pickupSpots`·`spawnPos` 등. **`pickupSpots` 수는 `queueSpots`(5)와 맞춰야** 손님 픽업 겹침이 없다.

## 코드 컨벤션
- 주석·UI 텍스트·커밋 메시지는 **한국어**. 코드 스타일은 주변 코드를 따른다(2-스페이스, 세미콜론, `const`/`let`, 화살표 함수, 간결한 인라인 주석).
- 외부 의존성 추가 금지(빌드리스 유지). Three.js는 로컬 `three.min.js` 전역.
- DOM 접근은 `$()` 헬퍼, 토스트는 `toast()`, 사운드는 `AudioFX.*`, HUD 갱신은 `UI.hud()`.

## Git
- 개발 브랜치에서 작업하고 커밋·푸시(필요 시 PR). 기본 브랜치는 `main`.
- 커밋 메시지: 한국어 요약 + 필요한 본문.

## 문서
- `README.md` — 플레이어/기능 설명
- `docs/balance-report.md` — 경제 밸런스 분석(난이도 곡선 진단)
- `docs/code-review-notes.md` — 알려진 버그/수정 이력
