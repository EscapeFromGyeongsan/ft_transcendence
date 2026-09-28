# 사이버 보드게임 카페 문서화 명세서

## 1. 목적

본 문서화 체계는 상위 실행 계획인 **「사이버 보드게임 카페: 5인 실행 로드맵」**을 기준으로 프로젝트의 요구사항, 설계, 구현 계약, 테스트, 평가 증거와 팀별 기여를 일관되게 관리하기 위한 것이다.

문서화의 목적은 다음과 같다.

1. 팀원 5명이 동일한 요구사항과 게임 규칙을 기준으로 개발하도록 한다.
2. Backend, Game Engine, WebSocket, Frontend 간 계약을 명확하게 정의한다.
3. 구현 상태와 평가 가능한 상태를 구분한다.
4. 선택한 총 14점의 모듈이 실제 구현 및 평가 증거와 연결되도록 한다.
5. 타인이 README와 문서만 보고 프로젝트를 실행하고 핵심 시나리오를 재현할 수 있도록 한다.
6. 평가 시 각 팀원이 자신의 담당 영역뿐 아니라 관련 시스템 흐름을 설명할 수 있도록 한다.
7. 구현 변경 시 요구사항, 설계, 테스트, 증거 사이의 불일치를 추적할 수 있도록 한다.

문서 흐름:

```text
Requirement
    ↓
Design
    ↓
Implementation Contract
    ↓
Test Scenario
    ↓
Evidence
    ↓
Evaluation
```

---

## 2. 문서 우선순위

문서 간 내용이 충돌하면 다음 우선순위를 따른다.

1. 사이버 보드게임 카페: 5인 실행 로드맵
2. ft_transcendence v21.1 Subject
3. 추후 확인되는 학교 최신 Evaluation Sheet
4. SRS
5. SDS
6. 기타 상세 문서

학교 최신 Evaluation Sheet가 확인되어 상위 문서와 충돌하면 차이를 기록하고 상위 로드맵을 먼저 수정한 뒤 하위 문서를 갱신한다.

---

## 3. 공식 프로젝트 범위

기본 제품은 **오목 1개를 제공하는 턴제 온라인 보드게임 플랫폼**이다.

공통 기능:

- 회원가입 / 로그인
- 프로필 / 아바타
- 친구 / 온라인 상태
- 기본 1:1 채팅
- 게임 방
- 2인 오목
- WebSocket 실시간 동기화
- Disconnect / Reconnect
- 경기 저장
- 전적 / 통계
- 첫 승 업적
- 10경기 진행도
- 승수 리더보드

오목 규칙:

- 15×15
- 자유룰
- 5개 이상 연속 시 승리
- 금수 없음
- 무르기 없음

윷놀이는 기본 범위에 포함하지 않는다.

---

## 4. 공식 선택 모듈

| ID | 모듈 | 분류 | 점수 |
|---|---|---|---:|
| MOD-01 | Frontend + Backend Framework | Major | 2 |
| MOD-02 | Real-time Features | Major | 2 |
| MOD-03 | User Interaction | Major | 2 |
| MOD-04 | Standard User Management | Major | 2 |
| MOD-05 | Complete Web-based Game | Major | 2 |
| MOD-06 | Remote Players | Major | 2 |
| MOD-07 | ORM | Minor | 1 |
| MOD-08 | Game Statistics and Match History | Minor | 1 |
| | **총합** | | **14** |

현재 기본 점수 범위에서 제외:

- Public API
- SSR
- OAuth 2.0
- 2FA
- Tournament
- Spectator
- Gamification
- AI
- Multiplayer 3+
- Microservices
- Advanced Chat

---

## 5. 문서 구조

```text
README.md

Document/
├── roadmap.md
├── SRS.md
├── SDS.md
├── contracts.md
├── TEST_PLAN.md
├── GAME_RULES.md
├── CONTRIBUTIONS.md
├── REQUIREMENT_TRACEABILITY.md
│
├── diagrams/
│   ├── use-case.md
│   ├── class-diagram.md
│   ├── erd.md
│   ├── game-fsm.md
│   ├── move-sequence.md
│   ├── reconnect-sequence.md
│   └── deployment-diagram.md
│
└── evaluation/
    ├── module-matrix.md
    ├── mandatory-checklist.md
    └── school-evaluation-status.md

evidence/
└── <CARD-ID>/
    └── <YYYYMMDD-HHMM>/
        ├── run.md
        ├── test.log
        ├── screen.png 또는 demo.mp4
        └── changes.md
```

---

## 6. README.md

README는 프로젝트의 공식 진입점이다.

포함 내용:

1. Required First Line
2. Project Title
3. Description
4. Key Features
5. Game Rules
6. Team Information
7. Project Management
8. Technical Stack
9. System Architecture
10. Database Schema
11. Features List
12. Modules
13. Individual Contributions
14. Instructions
15. Environment Variables
16. How to Run
17. Documentation
18. Resources
19. AI Usage
20. Known Limitations

README는 영어로 작성한다.

---

## 7. SRS — Software Requirements Specification

SRS는 **무엇을 만들어야 하는가**를 정의한다.

### 기능 요구사항

#### Authentication
- 이메일/비밀번호 회원가입
- 로그인
- 중복 이메일 거절
- 로그아웃 후 보호 API 접근 차단

#### User
- 프로필 조회/수정
- 아바타 설정
- 기본 아바타

#### Friend
- 친구 요청
- 수락
- 삭제
- 목록
- 온라인 상태

#### Chat
- 인증된 1:1 메시지 송수신
- 최근 메시지 조회
- 비참가자 대화 접근 차단

#### Game
- 방 생성
- 방 참가
- 2인 게임
- 서버 권위형 상태 관리
- 턴 검증
- 중복 착수 방지
- 승리 판정
- 종료 후 행동 차단

#### Remote / Reconnect
- 서로 다른 PC에서 대전
- Disconnect 감지
- 게임 일시정지
- 60초 내 재접속 시 복원
- 60초 초과 시 패배
- 양쪽 미복귀 시 무효

#### Statistics
- 승패 저장
- 상대/날짜/결과 전적
- 승률
- 첫 승 업적
- 10경기 진행도
- 승수 리더보드

### 비기능 요구사항

- Password Hash + Salt
- HTTPS / WSS
- Frontend/Backend 입력 검증
- Race Condition 방지
- commandId 기반 중복 방지
- stateVersion 기반 충돌 감지
- 경기 결과 단일 저장
- 최신 Chrome 지원
- Responsive UI
- Keyboard 사용 가능
- Docker 기반 실행
- 단일 명령 기동
- Browser Console Warning/Error 제거

---

## 8. Use Case Diagram

Actor:

- Guest
- Authenticated User
- Player
- Friend

Use Case:

- Register
- Login
- Logout
- View/Edit Profile
- Upload Avatar
- Send/Accept/Remove Friend
- View Friend List
- View Online Status
- Send Message
- View Recent Messages
- Create Room
- Join Room
- Ready
- Play Omok
- Resign
- Reconnect
- View Match History
- View Statistics
- View Achievement
- View Leaderboard

---

## 9. GAME_RULES.md

기본 규칙:

- Board Size: 15×15
- Black First
- Black / White Alternate
- 가로/세로/대각선 5개 이상 연속 시 승리
- Forbidden Moves 없음
- Undo 없음

종료 유형:

- WIN
- RESIGN
- DISCONNECT_FORFEIT
- DRAW
- INVALIDATED

통계 정책:

- 무효 경기는 승률/진행도/리더보드에서 제외
- 무승부는 완료 경기 수에 포함
- 승률 = wins / completed_games
- 리더보드 = 승수 기준
- 동률: nickname → userId 순

---

## 10. SDS — Software Design Specification

SDS는 **어떻게 구현할 것인가**를 정의한다.

구성:

1. System Architecture
2. Frontend Architecture
3. Backend Architecture
4. Domain Boundary
5. Database Design
6. Class Design
7. Game FSM
8. API Contract
9. WebSocket Contract
10. Command / Version Model
11. Authentication Design
12. Concurrency Design
13. Reconnection Design
14. Statistics Design
15. Security Design
16. Deployment Design
17. Technical Decisions

---

## 11. System Architecture

```text
Browser
   │
 HTTPS / WSS
   │
 Nginx
  /   \
Frontend Backend
          │
         ORM
          │
     PostgreSQL
```

---

## 12. 플랫폼 경계

### B
- Authentication
- User Identification
- DB Schema
- Transaction
- commandId duplicate prevention
- stateVersion conflict detection
- Result single finalization
- Statistics API

### C
- Game Initial State
- Game Rule
- Move Validation
- State Transition
- Public Game State
- Game Result

### D
- Authenticated Room Subscription
- Command Ordering
- Game Execution
- Persistence Call
- Broadcast after Commit
- Reconnect Snapshot
- Connection State

### E
- Friend
- Chat
- Initial Runtime Environment

### A
- Common UI
- Profile UI
- Statistics UI
- Documentation / Evaluation Integration

---

## 13. contracts.md

공식 팀 간 계약:

- Game Command
- Game State
- Game Result
- Error
- WebSocket Event
- REST Request/Response
- stateVersion
- commandId
- gameType
- rulesVersion

예시:

```json
{
  "type": "PLACE_STONE",
  "matchId": 42,
  "commandId": "uuid",
  "expectedVersion": 15,
  "payload": {
    "row": 8,
    "column": 4
  }
}
```

---

## 14. ER Diagram

최소 검토 Entity:

- User
- Session
- Friendship
- ChatConversation
- ChatParticipant
- ChatMessage
- Game
- GamePlayer
- Move
- GameCommand
- Achievement / Progress

표시 항목:

- PK
- FK
- UNIQUE
- NULLABLE
- Data Type
- Cardinality

---

## 15. Class Diagram

핵심 관계만 표시한다.

```text
AuthRouter
   ↓
AuthService
   ↓
UserRepository

GameWebSocketHandler
   ↓
GameSessionManager
   ↓
GameService
   ├── GameEngine
   ├── GameRepository
   └── CommandRepository

StatisticsRouter
   ↓
StatisticsService
   ↓
GameRepository
```

모든 DTO나 Utility는 넣지 않는다.

---

## 16. Game FSM

```text
WAITING
   │ opponent joins
   ▼
READY
   │ start
   ▼
PLAYING
   │
   ├── win / draw / resign ──────▶ FINISHED
   │
   └── disconnect
          ▼
      PAUSED
       │    │
       │    └── timeout ─────────▶ FINISHED
       │
       └── reconnect
              ▼
           PLAYING
```

각 Transition:

- Current State
- Event
- Guard Condition
- Next State
- Server Action
- Persistence
- Broadcast

---

## 17. Sequence Diagram

최소 2개 작성한다.

### 정상 착수

```text
Player
→ Frontend
→ WebSocket
→ Game Session
→ Game Service
→ Game Engine
→ Repository
→ DB
→ Broadcast
→ Both Players
```

처리 원칙:

```text
Client Request
→ Server Validation
→ State Transition
→ DB Commit
→ Broadcast
```

### Disconnect / Reconnect

```text
Connection Lost
→ Detect Disconnect
→ Pause
→ Start Timeout
→ Notify Opponent
→ Reconnect
→ Authenticate
→ Validate Participant
→ Restore Subscription
→ Load Snapshot
→ Sync stateVersion
→ Resume
```

---

## 18. 동시성 설계

### commandId
동일 요청 재전송 시 한 번만 처리한다.

### stateVersion

```text
expectedVersion == currentVersion
→ 처리 가능

expectedVersion != currentVersion
→ Conflict
→ 최신 상태 반환
```

### Result Finalization
경기 결과는 Transaction 안에서 한 번만 확정한다.

---

## 19. WebSocket Specification

Client → Server:

- SUBSCRIBE_ROOM
- READY
- PLACE_STONE
- RESIGN
- RECONNECT

Server → Client:

- ROOM_STATE
- GAME_STARTED
- GAME_STATE
- STONE_PLACED
- PLAYER_DISCONNECTED
- PLAYER_RECONNECTED
- GAME_PAUSED
- GAME_FINISHED
- ERROR

각 Event:

- Event Name
- Direction
- Authentication
- Payload
- Validation
- Server Action
- Success Response
- Error

---

## 20. Deployment Diagram

```text
Client Browser
      │
 HTTPS / WSS
      │
    Nginx
    /   \
Frontend Backend
            │
        PostgreSQL
```

Docker Compose:

- frontend
- backend
- nginx
- database

각 Container:

- Role
- Internal Port
- Exposed Port
- Network
- Volume
- Environment Variable
- Health Check

DB Port는 외부 비공개를 기본으로 한다.

---

## 21. TEST_PLAN.md

테스트 단계:

- Unit Test
- Integration Test
- System / E2E Test

### Unit
- 정상 착수
- 차례 위반
- 중복 위치
- 가로/세로/대각 승리
- 종료 판정
- 통계 계산

### Integration
- Authentication → DB
- Game Command → Engine → Persistence
- WebSocket → Broadcast
- Game Result → Statistics

### 공식 시스템 테스트

상위 로드맵의 ID를 그대로 사용한다.

- T00 실행
- T01 인증
- T02 프로필
- T03 한 판
- T04 복구·지연
- T05 경합·격리
- T06 소셜
- T07 종료 예외
- T08 통계
- T09 필수 UI
- T10 이해·문서

각 Test 기록:

- Test ID
- Requirement ID
- Module ID
- Precondition
- Accounts
- Input
- Steps
- Expected
- Actual
- Evidence
- Tester
- Reviewer
- Date
- Commit SHA
- Result

---

## 22. REQUIREMENT_TRACEABILITY.md

요구사항부터 평가 증거까지 연결한다.

```text
Subject Requirement
↓
SRS Requirement
↓
Module
↓
Implementation
↓
Test Scenario
↓
Evidence
```

예:

| Requirement | Module | Implementation | Test | Evidence |
|---|---|---|---|---|
| FR-GAME 착수 검증 | MOD-05 | GameEngine | T03/T05 | evidence/... |
| FR-REMOTE 재접속 | MOD-06 | ReconnectHandler | T04 | evidence/... |
| FR-STAT 승률 | MOD-08 | StatisticsService | T08 | evidence/... |

---

## 23. Module Matrix

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

---

## 24. Evidence 규격

경로:

```text
evidence/<ID>/<YYYYMMDD-HHMM>/
```

파일:

- run.md
- test.log
- screen.png 또는 demo.mp4
- changes.md

### run.md
- Date
- Card/Test ID
- Tester
- Evaluator
- Server URL
- Commit SHA
- Account Alias
- userId
- matchId
- roomId
- Preconditions
- Steps
- Expected
- Actual
- Result

### test.log
- Scenario ID
- Input Summary
- State Version
- Command ID
- DB Record Count
- Expected
- Actual
- Result

### changes.md
- Related Issue
- Pull Request
- Commit SHA
- Files Changed
- Author
- Reviewer
- Reason

---

## 25. CONTRIBUTIONS.md

각 팀원별:

- Role
- Assigned Cards
- Implemented Features
- Implemented Modules
- Reviewed PRs
- Technical Decisions
- Problems
- Solutions
- Tests Performed
- Evidence Produced
- Backup Area

---

## 26. Project Management 문서

### Issue
- ID
- Title
- Owner
- Backup
- Deadline
- Dependency
- Module
- Requirement
- Acceptance Criteria
- Status

### PR
- Related Issue
- Implementation Summary
- Affected Requirements
- Affected Contracts
- Test Result
- Documentation Change
- Reviewer

Schema, Contract, Auth, Game State가 바뀌면 관련 문서도 같은 PR에서 수정한다.

---

## 27. 기술 결정

다음 선택은 SDS에 이유를 기록한다.

- Backend Framework
- Frontend Framework
- Database
- ORM
- WebSocket
- Authentication
- Password Hashing
- Server-authoritative Game State
- commandId
- stateVersion
- Reconnect Policy
- Result Finalization

---

## 28. 환경 설정

`.env.example` 제공.

예:

```text
DATABASE_URL=
SECRET_KEY=
ACCESS_TOKEN_EXPIRE=
FRONTEND_ORIGIN=
```

실제 Password / Token / Secret은 포함하지 않는다.

---

## 29. Privacy Policy / Terms of Service

실제 기능과 일치하게 작성한다.

최소 반영:

- Account Information
- Profile / Avatar
- Friend Information
- Chat
- Game Records
- Statistics
- Data Usage
- Storage
- User Rights

---

## 30. 학교 평가표 상태

학교 최신 Evaluation Sheet가 확인되기 전까지:

- v21.1 기준 확인
- 학교 기준 미확인
- 공식 통과 표현 금지

별도 `school-evaluation-status.md`로 관리한다.

---

## 31. 문서 작성 시점

### 9/21~9/23
- README Skeleton
- SRS v0.1
- GAME_RULES
- Use Case Diagram
- ERD Draft
- Architecture Draft
- contracts.md

### 9/24~9/27
- SDS v0.1
- Class Diagram
- FSM
- Deployment Diagram
- Authentication Design
- Test Plan Draft

### 9/28~10/04
- ERD Update
- contracts Update
- Move Sequence
- Module Matrix
- T00~T06

### 10/05~10/11
- Reconnect Sequence
- Statistics Design
- T07/T08
- Contributions
- Requirement Traceability

### 10/12~10/18
- Mandatory Checklist
- Module Matrix Final
- T00~T10 Result
- Evidence Mapping
- README
- SRS/SDS Synchronization

### 10/19 이후
새 문서를 늘리기보다 구현과 문서의 차이를 수정한다.

---

## 32. 문서별 책임

| 문서 | 주 책임 | 기술 검토 |
|---|---|---|
| README | A | 전원 |
| SRS | A | B/C/D/E |
| SDS | B | C/D/E |
| GAME_RULES | C | B |
| contracts.md | B/C/D | 상호 리뷰 |
| ERD | B | D |
| Class Diagram | B | D |
| FSM | D/C | B |
| Sequence Diagram | D | B/C |
| Deployment Diagram | E | A/B |
| TEST_PLAN | 영역별 작성, A 취합 | 비작성자 |
| CONTRIBUTIONS | 각 개인 | A 취합 |
| Requirement Traceability | A/B | 전원 |
| Module Matrix | A/B | 담당자 |
| Evaluation Status | B | A |

---

## 33. 문서 갱신 규칙

다음이 바뀌면 관련 문서를 같이 수정한다.

- DB Schema
- API Contract
- WebSocket Event
- Game Rule
- FSM
- Command Format
- State Version Logic
- Reconnect Policy
- Statistics Rule
- Deployment Structure
- Module Scope

---

## 34. 상태 정의

- 계획
- 작업 중
- 구현됨
- 평가 가능
- 내부 검증 실패
- 학교 기준 확인 대기

### 구현됨
- Code Review
- Integration
- 실제 계정
- 실제 Server
- 실제 DB
- 정상 흐름 확인

### 평가 가능
추가로:
- 비작성자 재현
- T 시나리오 통과
- Failure Path 확인
- Evidence 생성
- PR/Commit 확인

---

## 35. 평가 질문과 문서 대응

| 질문 | 문서 |
|---|---|
| 무엇을 만들었나? | README / SRS |
| 왜 이런 기능이 있나? | SRS |
| 전체 구조는? | SDS / Architecture |
| DB 관계는? | ERD |
| 코드 구조는? | Class Diagram |
| 게임 상태는? | FSM |
| 착수 처리 흐름은? | Move Sequence |
| 재접속은? | Reconnect Sequence + FSM |
| 동시 요청은? | SDS Concurrency |
| 중복 요청은? | commandId |
| 상태 충돌은? | stateVersion |
| WebSocket 메시지는? | contracts.md |
| 게임 규칙은? | GAME_RULES |
| 통계 모듈은? | Module Matrix + T08 |
| 어떻게 검증했나? | TEST_PLAN + Evidence |
| 누가 구현했나? | CONTRIBUTIONS |
| 왜 14점인가? | Module Matrix |

---

## 36. 최종 공식 산출물

### 대표 문서
- README.md
- roadmap.md

### 요구사항
- SRS.md
- GAME_RULES.md
- use-case.md

### 설계
- SDS.md
- contracts.md
- class-diagram.md
- erd.md
- game-fsm.md
- move-sequence.md
- reconnect-sequence.md
- deployment-diagram.md

### 검증
- TEST_PLAN.md
- REQUIREMENT_TRACEABILITY.md
- mandatory-checklist.md
- module-matrix.md
- school-evaluation-status.md

### 팀 및 평가 증거
- CONTRIBUTIONS.md
- evidence/

---

## 37. 최종 성공 기준

문서 개수가 많은 것이 목표가 아니다.

다음 질문에 명확하게 답할 수 있어야 한다.

- 무엇을 만들어야 하는가? → SRS
- 게임 규칙은 무엇인가? → GAME_RULES
- 어떻게 설계했는가? → SDS
- 팀 간 데이터 계약은 무엇인가? → contracts
- DB는 어떻게 연결되는가? → ERD
- 코드 구조는 어떻게 되는가? → Class Diagram
- 게임 상태는 어떻게 변하는가? → FSM
- 한 번의 착수는 어떻게 처리되는가? → Sequence Diagram
- 재접속은 어떻게 되는가? → Reconnect Sequence
- 실행 환경은 어떻게 구성되는가? → Deployment Diagram
- 요구사항은 어떻게 검증되는가? → TEST_PLAN
- 어떤 모듈로 14점을 구성하는가? → Module Matrix
- 실제로 평가 가능한가? → Evidence
- 누가 무엇을 구현했는가? → CONTRIBUTIONS

핵심은 **요구사항 → 설계 → 구현 → 테스트 → 증거가 서로 추적 가능한 상태를 만드는 것**이다.
