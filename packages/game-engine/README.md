# Game Engine

게임별 규칙을 처리하는 npm workspace 패키지.

## 오목 초기 상태

```ts
import { gomoku } from "@cafe/game-engine";

const state = gomoku.createInitialState();
```

`state.board`는 15×15 크기의 독립된 배열이며 빈칸은 `null`이다. `state.currentPlayerColor`는 `"black"`으로 시작한다.

`GomokuState`는 게임 규칙 상태이며, 전송용 `GomokuSnapshot`과 역할을 구분한다. 상위 경기 관리 계층에서 `currentPlayerColor`를 배정된 `players.black/white`의 사용자 ID에 연결하고 경기 ID·규칙 버전·상태 버전·진행 상태·결과를 붙여 snapshot을 구성한다.

현재 초기 상태 생성만 구현했다. 착수 검사·반영과 승패 판정은 후속 작업이다. 인증·명령 중복 처리·버전 관리·저장·전송은 상위 경기 관리 계층에서 담당한다.

## 검증

저장소 루트에서 실행한다.

```bash
npm test
npm run build
```
