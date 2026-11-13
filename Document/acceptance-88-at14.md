# #88 AT-14 개발 실행·종료·프록시 검증

- 결과: **6개 시나리오 통과**. 제품 파일 변경 없음.
- 실행: 2026-11-12 13:33:38–13:33:46 UTC (22:33:38–22:33:46 JST).
- 환경: macOS, Node v22.23.2, Vite 8.3.0, 자체 임시 PostgreSQL 17 컨테이너.
- 검증자: Codex `acceptance_development`. 별도 사람 리뷰는 미실시.
- 대상: `/private/tmp/ft-transcendence-acceptance-88`의 현재 서버·개발 실행 코드.

## 격리 조건

후보 디렉터리의 `.env` 부재와 실행 환경의 `DATABASE_URL` 부재를 확인했다. `DATABASE_URL`, `PORT`, JWT·2FA·OAuth 설정을 제거한 하위 프로세스 환경에서 시작했다. root 작업 공간의 `.env`, 기존 DB·컨테이너·실행 프로세스는 읽거나 수정하지 않았다.

임시 mirror에 `scripts/dev.mjs`, `apps/web/vite.config.ts`, package·HTML을 원본 그대로 복사했다. 실제 서버 소스, 웹 소스·dist, 설치된 node_modules는 후보 디렉터리로 연결했다. API는 실제 `apps/server/src/index.ts`를 실행했고 실제 `/api/health/db`와 `/api/ws`를 사용했다. 가짜 upstream·가짜 DB 응답은 사용하지 않았다.

정상 시작 시나리오는 자체 임시 PostgreSQL 컨테이너에 후보의 migration 0000–0006을 적용한 뒤 실행했다. 임시 root `.env`에만 임시 DB 접속 정보, 임의 JWT 키, 비기본 API `PORT=55984`를 기록했다. 이 값들을 프로세스 환경으로 별도 주입하지 않았으므로 API와 Vite dev/preview 모두 root `.env`에서 포트를 읽은 결과이다. 자격증명은 문서·로그 요약에 포함하지 않았으며 임시 `.env`는 검증 후 제거했다.

## 시나리오와 실제 결과

| ID      | 사전 조건·입력·절차                                                                                            | 기대 결과                                                 | 실제 결과                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| AT14-01 | DB URL 없는 격리 환경에서 `node scripts/dev.mjs --port 55959 --strictPort` 실행. API용 비기본 PORT 55958 지정. | 설정 오류를 알리고 API·Vite 모두 종료. 두 포트 잔류 없음. | `Set DATABASE_URL` 오류, 자연 종료 exit 1. API 55958·Vite 55959 모두 닫힘. 통과.                                                       |
| AT14-02 | URL은 있지만 연결할 DB가 없는 loopback 포트로 같은 실제 dev 실행.                                              | DB 상태 검사 실패로 기동 중단. API·Vite 포트 잔류 없음.   | `Database is unavailable.` 오류, 자연 종료 exit 1. API 55968·Vite 55969 모두 닫힘. 통과.                                               |
| AT14-03 | 정상 임시 DB와 root `.env`의 PORT 55984로 dev 55985·preview 55986 실행. 각 `/api/health/db` 및 `/api/ws` 호출. | dev·preview가 같은 비기본 API로 REST·WS 요청 전달.        | API 직접·dev·preview 모두 HTTP 200, DB health JSON 일치. dev·preview WS 모두 HTTP 101 upgrade. preview SIGINT 후 해당 포트 닫힘. 통과. |
| AT14-04 | 정상 실행된 dev 부모 프로세스에만 SIGINT 전송.                                                                 | 부모가 API·Vite 자식을 종료하고 포트 반환.                | dev exit 0. API 55984·Vite 55985 모두 닫힘. 통과.                                                                                      |
| AT14-05 | 종료한 dev를 같은 API·Vite 포트로 다시 실행하고 health·WS 호출 후 SIGINT.                                      | 포트 충돌 없이 재기동되고 종료 시 정리.                   | health HTTP 200·WS HTTP 101, dev exit 0, 두 포트 닫힘. 통과.                                                                           |
| AT14-06 | 자체 listener로 새 Vite 포트를 점유한 상태에서 `--strictPort` dev 실행.                                        | Vite 시작 실패가 API 자식도 종료시킴.                     | 자연 종료 exit 1. API 포트 닫힘. 점유 listener는 검증자가 별도로 닫음. 통과.                                                           |

포트가 닫혔는지는 각 실행의 자연 종료 또는 SIGINT 종료 뒤 loopback TCP 연결로 확인했다. 실패 실행의 상태는 강제 정리 전에 측정했다. preview의 SIGINT 종료는 Python에서 `-2`로 관찰되며, 이는 정상적인 OS signal 종료이다. 실제 dev wrapper는 SIGINT 처리 후 exit 0이었다.

## 증거와 재현

실행 도구: `/private/tmp/check-acceptance-88-at14.py`.

최종 결과 JSON과 원시 로그: `/var/folders/rz/hqqvp3bn2k53jvxjn8dbfkkw0000gn/T/ft-at14-r4f5z5jh/`의 `results.json`, `missing-database-url.log`, `unreachable-database.log`, `dev-root-env.log`, `preview-root-env.log`, `dev-restart.log`, `vite-port-conflict.log`, `migrate.log`. 로컬 임시 증거이며 Git 추적 대상은 아니다.

검증 도구의 첫 실행은 preview의 SIGINT(-2)를 실패로 판정하고 TIME_WAIT 포트를 충돌 재현에 재사용하여 중단했다. 정상 signal을 허용하고 충돌 재현용 새 포트를 확보한 뒤 위 최종 실행 6개를 통과했다. 제품 수정은 없었다.

대상 파일 SHA-256:

| 파일                       | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `scripts/dev.mjs`          | `4fdaa8acc3de9248050528bbf115bb9b43fe97763781f222aed65e8abf70e0fe` |
| `apps/server/src/index.ts` | `b00703a12c659b6fa73cedfb18f6b39006f1b5c36ba8a7d133cad6928fdf3e4e` |
| `apps/web/vite.config.ts`  | `dca113299ed9419d6aa0d57e56efa4672b00a74db3042376588a7708da6025e1` |

## 정리와 검증 한계

자신이 생성한 프로세스 그룹만 정리했고, 전용 임시 DB 컨테이너도 제거했다. 기존 DB·볼륨·컨테이너·프로세스는 유지했다.

이 결과는 개발 실행·종료와 root `.env` 포트 프록시 계약을 검증한다. WS는 실제 서버의 upgrade 경로까지 확인했으며 인증 후 게임 메시지는 이 시나리오 범위에 없다. HTTPS/WSS·Chrome 화면·최종 사용자 데이터 동작은 #88의 별도 브라우저 인수 결과로 판단한다. JWT·OAuth 설정 오류의 모든 조합, 다른 OS·Node 버전, 장애 도중 실제 진행 경기의 처리, 타 팀원의 README 재현은 확인하지 않았다.
