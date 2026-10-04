# GAME_RULES

## 1. 오목 기본 규칙

- Board Size: 15×15
- 자유룰
- Black First
- Black / White Alternate
- 가로/세로/대각선 5개 이상 연속 시 승리
- Forbidden Moves(금수) 없음
- Undo(무르기) 없음
- 엔진·API·DB 좌표는 0..14이며 `(0, 0)`은 좌상단이다. API는 `row/col`, DB는 `row_idx/col_idx`를 사용한다. 화면과 T03 시나리오의 1..15 표기는 입력 시 변환한다.

## 2. 종료 유형

- WIN
- RESIGN
- DISCONNECT_FORFEIT
- DRAW
- INVALIDATED

계약 제안: 위 값은 종료 사유(`resultType`)이고 승자는 `winnerUserId`로 별도 전달한다. WIN·RESIGN·DISCONNECT_FORFEIT에는 승리한 참가자의 ID, DRAW·INVALIDATED에는 null을 사용한다. DB·API 형식은 SRS 작성 이후 상세 계약을 작성할 때 C·B·D가 검토한다.

## 3. 연결 끊김

- 게임 중 한 플레이어가 끊기면 일시정지하고 복귀 시 재개한다.
- 60초 내 재접속 시 복원한다.
- 60초 초과 시 패배한다.
- 양쪽 모두 미복귀 시 무효(INVALIDATED)로 처리한다.

## 4. 통계 정책

- 무효 경기는 승률/진행도/리더보드에서 제외
- 무승부는 완료 경기 수에 포함
- 승률 = wins / completed_games
- 리더보드 = 승수 기준
- 동률: nickname → userId 순

## 5. 업적·진행도

- Achievement: First Win
- Progression: 10 Games Played

연결 유예 60초·10경기 등은 팀의 검증 조건이며 과제 문서의 지정 수치가 아니다.
