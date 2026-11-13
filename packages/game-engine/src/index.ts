/**
 * @fileoverview `@cafe/game-engine` 패키지의 최상위 엔트리포인트.
 *
 * 이 패키지는 42 ft_transcendence 프로젝트의 두 보드게임인 **오목(`gomoku`)**과 **오델로(`othello`)**의
 * 순수 게임 규칙(Rule Engine)과 상태 전이 로직을 제공합니다.
 *
 * ## 아키텍처 및 설계 원칙
 * 1. **순수 함수형 상태 머신 (Pure Functional State Machine)**:
 *    - 게임 엔진 내부에는 전역 상태나 부수 효과(I/O, 네트워크, 타이머, DB 접근)가 전혀 존재하지 않습니다.
 *    - 모든 상태 전이는 불변(Immutable) 객체 복제를 통해 이루어지며, 동일한 입력에 대해 항상 동일한 결과를 보환합니다.
 * 2. **엄격한 에러 경계 분리 (IF-01 / IF-04)**:
 *    - 엔진은 순수 보드 규칙 위반(`INVALID_ACTION`)과 종료 후 착수(`GAME_FINISHED`) 두 가지 오류만 반환합니다.
 *    - 네트워크 오류, 세션 만료, 권한 검증, 동시성 충돌(`VERSION_CONFLICT`), 재접속 타임아웃 등은 상위 계층(서버)에서 전담합니다.
 * 3. **서버 등록 규격 (IF-04 `RegisteredRules`)**:
 *    - 각 모듈은 서버 `GameCommandService`에 `{ version, rules, board }` 형태로 주입되어 스냅샷 생성 및 착수 검증에 사용됩니다.
 *
 * @see {@link gomoku} - 15×15 자유룰 오목 엔진
 * @see {@link othello} - 8×8 표준 오델로 엔진
 */

export * as gomoku from "./gomoku/index.ts";
export * as othello from "./othello/index.ts";
