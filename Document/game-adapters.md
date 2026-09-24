# Game Adapter / Registry 프로토타입

`codex/online-omok`에서 기존 온라인 오목을 유지하면서 다음 게임을 위한 경계를 검증한다. React + Fastify + PostgreSQL modular monolith를 유지하며 별도 서버 프로세스나 동적 플러그인 로딩은 도입하지 않는다.

## 실제 코드의 책임 분석

| 위치 | 기존 결합 | 변경 후 책임 |
| --- | --- | --- |
| `packages/games/omok/src/index.ts` | `OmokState`, `OmokAction`, 돌·차례·승리 판정 | 그대로 유지. 오목 순수 엔진에 필요한 의존성이다. |
| `apps/server/src/rooms.ts` | 오목 초기 상태/액션 함수 직접 호출, 흑백과 두 좌석 가정 | 계정 좌석, Ready/Start/Rematch, 방 revision, match ID, 상태 버전 검사. 게임 선택과 실행은 registry에 위임한다. |
| `apps/server/src/app.ts` | `PLACE_STONE` / `RESIGN` 허용 목록 | 인증·origin 검증, HTTP/WS 전송, 방별 명령 직렬화, DB 저장 후 상태 공개. 액션 내용은 adapter가 검증한다. |
| `apps/server/src/history.ts` | 흑백 참가자·오목 결과 직접 해석 | 게임 종류, 좌석별 승패, 공통 결과를 저장한다. |
| `apps/web/src/online/*` | 오목 상태/액션 타입, 보드와 흑백 표시 | 공통 방 UI, 연결·재접속, snapshot과 명령 envelope 처리. |
| `apps/web/src/games/omok/OnlineOmokGame.tsx` | 기존 온라인 방에서 추출 | 오목 보드, 차례, 착수/기권, 흑백 표시. 여기에 오목 의존성은 필요하다. |
| `apps/web/src/games/registry.ts` | 표시용 게임 카탈로그 | 표시 메타데이터와 온라인 게임 renderer 선택. 서버 규칙의 권위는 갖지 않는다. |

로컬 한 화면 모드와 오목 엔진은 변경하지 않았다. 서버 registry의 기본값 `omok`, 오목 adapter의 `createInitialState()`/`applyAction()`, 오목 renderer의 `PLACE_STONE`/`RESIGN`은 올바른 조립 지점 또는 게임 내부의 의존성이다. 이를 없애기 위한 추가 framework는 필요하지 않다.

## 최소 계약

`games/definition.ts`의 `GameDefinition<State, Action>`은 다음만 요구한다.

- `gameType`, `playerCount`: 정적 게임 식별자와 정원.
- `createInitialState()`: 게임별 초기 상태.
- `isState()`, `parseAction()`: adapter 경계의 상태 식별과 신뢰할 수 없는 액션 검증.
- `applyAction(state, { seat }, action)`: 검증된 참가자 좌석을 받아 순수 상태 전이.
- `getResult(state)`: `kind`, `winnerSeats`, `reason`, 선택적 수치인 `moveCount`로 결과 정규화.

공통 상태는 기존 동시성 검사에 필요한 `stateVersion`만 요구한다. 엔진 성공 액션은 입력을 변경하지 않고 버전이 증가한 새 상태를 반환해야 한다. 상태는 snapshot으로 보낼 수 있는 JSON 값이어야 한다. actor는 클라이언트가 지정하지 않는다. 플랫폼이 세션에서 확인한 참가자의 좌석을 전달하고, 오목 adapter가 0→흑, 1→백으로 변환한다. 차례·승리·합법 액션은 각 게임이 결정한다.

서로 다른 State/Action을 하나의 registry에 보관하는 경계는 `adaptGame()` 한 곳에 둔다. `unknown` 액션을 각 adapter가 파싱하며 `any` 기반 공통 엔진을 만들지 않는다. `isState()`는 서버가 생성한 상태의 게임/버전 식별용이며 외부 저장 데이터를 완전히 검증하는 복원 스키마가 아니다.

`@cafe/game-contracts`는 공통 RoomSnapshot, 참가자, 액션 envelope, 정규화 결과 타입만 공유한다. React나 엔진, 서버 런타임을 공유 패키지에 넣지 않는다.

```text
공통 OnlineRoom → HTTP / WebSocket → 인증 및 방별 명령 직렬화
                                         ↓
                                    RoomStore
                                         ↓
                               정적 GameRegistry
                                         ↓
                                  Omok adapter
                                         ↓
                                순수 @cafe/omok

완료 액션 → 공통 결과 DB 저장 → live state commit → snapshot broadcast
```

서버 registry와 UI registry는 역할이 다르다. 전자는 실행 가능한 규칙과 정원을, 후자는 렌더러와 문구를 정적으로 등록한다. `/api/games`는 서버 등록 목록을 제공한다. 현재 UI의 게임 선택 목록은 프론트 registry에서 가져오므로 새 게임 출시 시 양쪽에 등록해야 한다.

## 전적과 호환성

`003-game-results.sql`은 `game_matches`와 `game_match_players`를 추가한다. 기존 `matches`의 흑백 데이터를 오목의 0/1 좌석으로 옮기며 재실행 시 중복 삽입하지 않는다. 기존 테이블과 계정/세션은 유지한다. 새 결과는 공통 테이블에만 기록하므로 구버전 코드로 되돌리면 새 결과는 구버전 전적 화면에 나오지 않는다.

완료 시 하나의 SQL CTE 문장으로 경기와 모든 참가자를 원자적으로 저장한다. 참가자 저장 실패 시 경기 삽입도 취소된다. 중복 match ID는 다시 집계하지 않는다. DB 오류 시 live state는 이전 상태를 유지하여 재시도할 수 있다. 전적은 기존 2인 상대 이름 표시를 유지하고 여러 상대는 좌석 순으로 나열한다.

기존 방 생성 요청에서 gameType 생략은 오목으로 처리한다. 알 수 없는 gameType은 거절한다. Ready·계정 좌석·관전·재접속·snapshot·상태 버전·재대결 정책은 유지한다. API 프로세스는 소스 감시가 없으므로 변경 적용에 재시작이 필요하며, 기존처럼 메모리의 진행 중 방은 재시작 시 사라진다.

## 새 게임 추가 순서와 범위

1. 브라우저/DB/네트워크에 의존하지 않는 엔진과 규칙 테스트를 작성한다.
2. 액션 파서, 좌석 매핑, 결과 변환을 포함하는 adapter를 만들고 서버 registry에 등록한다.
3. 온라인 renderer와 표시 정보를 프론트 registry에 등록한다.
4. 권한·잘못된 액션·완료·저장·재대결·브라우저 흐름을 테스트한다.

현재 계약은 게임별 고정 정원, 모든 참가자 Ready, 0번 좌석 방장, 공개 snapshot, 승리/무승부 결과를 지원한다. 윷놀이의 난수, 부루마블의 숨겨진 정보가 필요한 변형, 가변 인원, 순위/점수 체계, 서버 재시작 후 미완료 경기 복원은 별도 설계가 필요하다. 이 변경만으로 해당 게임들이 구현된 것은 아니다.

## 검증

- 기존 오목 규칙·계정·WebSocket·완료 결과·저장 실패 재시도 테스트 유지.
- 테스트 전용 3인 counter: 보드와 흑백 없이 같은 플레이어의 연속 액션, 빈 좌석 재입장, 방 격리, 완료, 재대결, 실제 WS 전달, 다인 전적 저장 검증. 운영 registry에는 등록하지 않는다.
- 기존 DB 전적 migration과 재시작 후 중복 방지 검증.
- 브라우저 테스트는 `/api/rooms` 응답까지 기다려 프론트만 먼저 준비되는 시작 경쟁을 방지한다.
- `npm run build`, Vitest 34개, 데스크톱·모바일 Playwright 14개 통과. DB 테스트는 PGlite 기준이며 외부 PostgreSQL 서비스 실행 검증은 하지 않았다.
