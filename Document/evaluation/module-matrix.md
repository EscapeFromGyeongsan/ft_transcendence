# Module Matrix

## 1. 기본 14점과 증빙 책임

| ID | 모듈 | 점수 | 책임자 | 실제 서버 시나리오 | 내부 평가 목표 |
|---|---|---:|---|---|---|
| MOD-01 | 프런트·백 프레임워크 | 2 | B | T01 가입·로그인 화면→API→DB, 구조·의존성 설명 | 10/01 |
| MOD-02 | 실시간 기능 | 2 | D | T03 방 준비·참가 갱신, T04 접속/해제·방별 전송 | 10/18 |
| MOD-03 | 사용자 교류 | 2 | E | T06 기본 채팅·프로필 조회·친구 추가/삭제/목록 | 10/11 |
| MOD-04 | 표준 사용자 관리 | 2 | B | T02 프로필 수정·아바타/기본 이미지, T06 친구 온라인 상태 | 10/18 |
| MOD-05 | 완전한 웹 게임 | 2 | C | T03 실제 오목 완주·승패·규칙, T07 종료 예외 | 10/18 |
| MOD-06 | 원격 플레이 | 2 | D | T04 다른 PC 2대의 대전·지연·재접속 | 10/18 |
| MOD-07 | ORM | 1 | B | T01/T03 실제 데이터 쓰기·읽기와 ORM 경로 설명 | 10/04 |
| MOD-08 | 통계·전적 | 1 | B | T08 통계·기록·업적/진행도·리더보드 | 10/18 |
| 합계 | Major 6개 + Minor 2개 | **14** | | 현재는 모두 계획이며 인정 점수 확정 아님 | |

- MOD-01에 프런트·백 Minor를 다시 더하지 않는다.
- MOD-03/04의 프로필·친구 구현은 공유하되 각 전체 요구를 별도로 확인한다.
- MOD-02는 로비·방·접속 상태, MOD-06은 실제 원격 경기·복구로 구분해 증명한다. 중첩 인정의 로컬 해석은 REQ-00에서 확인한다.
- 업적 한 개로 별도 Gamification, 아바타만으로 File upload, 게임별 폴더로 Microservices 점수를 주장하지 않는다.

## 2. 모듈 조건 대조 (v21.1)

| 항목 | v21.1 근거 | 구분 | 최소 구현/시연 | 학교 평가표 |
|---|---|---|---|---|
| 최소 14점, Major 2·Minor 1 | IV p.10–11 | 필수 모듈 합계 | 완성된 6 Major + 2 Minor, 미완성 0점 | 미확인 |
| 통계·전적 | IV.3 p.14 | 선택 Minor의 필수 조건 | 승패·승률, 날짜·상대·결과 목록 | 미확인 |
| 업적·진행도 | IV.3 p.14 | 위 Minor 선택 시 필수 조건 | 첫 승 업적, 10경기 참여 진행도 | 미확인 |
| 리더보드 통합 | IV.3 p.14 | 위 Minor 선택 시 필수 조건 | 승수 순위, 사용자 프로필 연결 | 미확인 |
| 14점 초과 모듈, 최대 5점 | VII p.30 | 보너스 | 기본 14점 충족 후 완성된 추가 모듈만 | 미확인 |

업적·리더보드는 모든 프로젝트의 공통 필수가 아니다. 이번 계획에서 통계 Minor를 선택했기 때문에 빠뜨릴 수 없다. 승수·승률과 아래의 최소 업적/진행도 범위는 팀 제안이며, 학교 평가표가 더 구체적인 조건을 요구하면 수정한다.

## 3. 모듈별 세부 조건

### MOD-03 User Interaction
- Basic Chat
- Profile Viewing
- Add Friend
- Remove Friend
- Friends List

### MOD-04 Standard User Management
- Profile Update
- Avatar Upload
- Default Avatar
- Friend Management
- Friend Online Status
- Profile Page

### MOD-08 Game Statistics
- Wins
- Losses
- Win Rate
- Match History
- Date
- Result
- Opponent
- Achievement
- Progression
- Leaderboard Integration

최소 구현:

- Achievement: First Win
- Progression: 10 Games Played
- Leaderboard: Number of Wins
