# GAME_RULES

## 1. 게임 기본 규칙 (`@cafe/game-engine`)

### 1.1 오목 (`gomoku`, `gomoku-freestyle-v1`)

- **Board Size**: 15×15 (`row`, `col` `0..14`, `(0, 0)`은 좌상단)
- **규칙**: 자유룰 (Forbidden Moves/금수 없음, Undo/무르기 없음)
- **차례**: 흑(`black`) 선공, 흑/백 교대 착수
- **승패 및 무승부 판정**:
  - 가로·세로·양대각선(4축) 중 한 방향으로 같은 색 돌이 **5개 이상 연속**되면 즉시 승리 (`outcome: "win"`, `reason: "five_in_row"`).
  - 마지막 225번째 빈칸에 착수하여 5목이 완성된 경우 승리 판정이 무승부보다 우선한다.
  - 5목 없이 225칸이 모두 차면 무승부 (`outcome: "draw"`, `reason: "draw"`).
- **좌표 변환**: 엔진·API(`row/col`)·DB(`row_idx/col_idx`)는 `0..14` 정수를 사용하며, 화면 및 테스트 시나리오의 `1..15` 표기는 입출력 시 변환한다.

### 1.2 오델로 (`othello`, `othello-standard-v1`)

- **Board Size**: 8×8 (`row`, `col` `0..7`, `(0, 0)`은 좌상단)
- **초기 배치**: 중앙 4칸 교차 배치 — `(3, 3)=white`, `(3, 4)=black`, `(4, 3)=black`, `(4, 4)=white`
- **차례 및 합법 착수**:
  - 흑(`black`) 선공.
  - 빈칸 중 가로·세로·대각선 **8방향**에서 상대 돌을 1개 이상 연속으로 사이에 끼우고 그 끝이 자신의 돌로 닫히는 위치에만 착수할 수 있으며, 끼워진 모든 방향의 상대 돌을 동시에 자신의 색으로 뒤집는다.
- **자동 패스 (Auto-Pass)**:
  - 착수 및 뒤집기 적용 후 상대방에게 합법 착수 위치가 하나도 없고 현재 플레이어에게 합법 수가 남아 있으면, 별도의 패스 명령 없이 현재 플레이어의 차례(`nextTurn`)를 그대로 유지한다.
  - 착수 이력 복원(`restoreState`, `board`) 시에는 자동 패스로 인한 연속 착수를 정확히 재생하기 위해 저장된 `stone` 색상을 그대로 사용한다.
- **종료 및 승패 판정**:
  - 양쪽 플레이어 모두 합법 착수 위치가 없거나(조기 전멸·양쪽 연속 패스 포함) 64칸이 모두 채워지면 즉시 종료한다.
  - 보드 위의 흑돌·백돌 개수를 비교하여 더 많은 쪽이 승리(`outcome: "win"`, `reason: "disc_count"`)하고, 돌 수가 같으면 무승부(`outcome: "draw"`, `reason: "draw"`)로 처리한다.

## 2. 종료 결과 및 오류 코드 계약 (`IF-01`, `IF-04`)

- **종료 결과 (`GameResult`)**:
  - `outcome: "win"` (`winnerId`: 승자 사용자 ID, `reason`: `"five_in_row"` | `"disc_count"` | `"resign"` | `"disconnect_timeout"`)
  - `outcome: "draw"` (`winnerId: null`, `reason: "draw"`)
  - `outcome: "void"` (`winnerId: null`, `reason`: `"disconnect_timeout"` | `"server_restart"`)
- **거절 오류 코드 (`GameError["code"]`)**:
  - 게임 엔진(C)은 순수 규칙 위반만 판정하며 **`INVALID_ACTION`**(좌표 범위 초과, 이미 놓인 칸, 오델로에서 뒤집을 돌 없음, 차례 위반 등)과 **`GAME_FINISHED`**(이미 종료된 경기) 두 코드만 반환한다.
  - 경기 상태·권한·버전·멱등성 오류(`NOT_FOUND`, `NOT_PARTICIPANT`, `COMMAND_ID_CONFLICT`, `GAME_NOT_ACTIVE`, `VERSION_CONFLICT`, `NOT_YOUR_TURN`) 및 기권(`resign`)·이탈 만료(`finishBySystem`)는 서버(`GameCommandService`)가 처리한다.

## 3. 연결 끊김 및 재접속 정책 (`DEC-03`, `DEC-07`)

- 대국 중 참가자의 연결이 끊기면 경기를 일시정지(`paused`) 상태로 전환한다. 두 참가자가 모두 이탈한 뒤 한 사람만 복귀한 경우 경기는 계속 일시정지(`paused`) 상태를 유지하며, **양쪽 참가자의 경기 연결이 모두 복구되었을 때** 최신 스냅샷(`match.snapshot`)으로 복원하여 경기(`playing`)를 재개한다.
- **경기당 개인별 누적 부재 시간 60초 예산(`DEC-03`)**:
  - 한 경기 안에서 플레이어별로 연결이 끊긴 시간을 누적 추적한다.
  - 누적 부재 시간이 60초에 도달했을 때 한 명만 부재 상태이면 남아 있는 상대방의 승리(`outcome: "win"`, `reason: "disconnect_timeout"`)로 종료한다.
  - 만료 시점에 양쪽 플레이어가 모두 부재 상태이면 무효(`outcome: "void"`, `reason: "disconnect_timeout"`)로 처리한다.
- 서버 재시작 시 끝나지 않은 진행 중(`playing`/`paused`) 경기는 모두 무효(`outcome: "void"`, `reason: "server_restart"`, `DEC-07`)로 종료한다.

## 4. 통계 및 리더보드 정책 (`DEC-08`)

- 통계와 리더보드는 게임 종류(`gomoku`, `othello`)별로 분리하여 집계한다.
- 무효(`void`) 경기는 승·패·무, 완료 경기 수(`played`), 승률, 진행도, 리더보드에서 제외한다.
- 무승부(`draw`)는 완료 경기 수(`played`)에 포함한다.
- 승률 비율(`winRate`) = `wins / played` (서버 순위 정렬은 반올림 전 실수 비율을 기준으로 수행하며, 퍼센트 반올림은 화면 표시 단계에 적용된다)
- **리더보드 정렬 기준 (`DEC-08`)**: **승수(`wins`) 내림차순 → 승률 비율(`winRate`) 내림차순 → 사용자 ID(`userId`) 오름차순**

## 5. 업적·진행도

- **Achievement**: First Win (첫 1승 달성)
- **Progression**: 10 Games Played (완료 경기 10판 달성)

연결 유예 누적 60초·10경기 등은 팀의 검증 조건이며 과제 문서의 지정 수치가 아니다.
