# 이슈 #7 실행 환경 검증 기록

- 검증일: 2026-10-12, 약 17:20~17:35 KST (Asia/Seoul)
- 브랜치: `codex/full-app-containers`
- 동기화한 원격 커밋: `e8e515bea4a988ec424d9ba46ac9f7e88f4f8b38`
- 검증한 실행 코드: `9dc764ad5327a3de66bfe0186124a807519df8f5`
- 검증자: 이 대화의 Codex. 작성자 외 팀원 재현은 아직 없음
- 상태: 자체 실행·장애·데이터 보존 검증 통과. 팀원 재현·Windows 브라우저 신뢰 설정·실제 WSS는 대기
- 검증 단계에서는 master 병합·이슈 종료를 수행하지 않음. 구현·결과·남은 확인은 PR에서 리뷰
- [기계 판독 가능한 실제 결과와 이미지 ID](runtime-evidence/2026-10-12/results.json)

기존 기록은 원격 소스 검토와 V8 함수 확인만 다뤘다. 이번에는 로컬 동기화 후 Docker·Node·Vitest·Playwright·curl을 실제 실행했다. 아래 결과는 당시 작업 트리의 실행 코드와 동일한 위 로컬 구현 커밋에 해당한다. 이후 문서·증거 변경은 별도 커밋으로 기록한다.

## 실행 환경과 격리

| 항목 | 실제 값 |
|---|---|
| 운영체제 | Windows Codex 앱의 WSL Ubuntu 24.04 |
| Docker client / engine | 29.6.2 / 29.6.2 |
| Docker Compose | 5.3.1 |
| 호스트 Node / npm | 25.5.0 / 11.8.0 |
| 컨테이너 Node | 24.21.0 |
| 컨테이너 Nginx / PostgreSQL | 1.28.3 / 17.11 |
| Playwright Chromium | 153.0.8010.12 |
| 전체 앱 검증 프로젝트 | `cafe-env-check-20261012082027` |
| 공개 HTTP / HTTPS 포트 | 50043 / 47927, 모두 `127.0.0.1` |
| 추가 폐기용 프로젝트 | 위 이름에 `-migration-failure`, `-crlf`, `-dev`를 붙인 프로젝트 |

비밀번호·인증서·환경 파일은 검증 전용 `/tmp` 디렉터리에 생성했다. 기존 `.env`·`.env.full`을 만들거나 덮어쓰지 않았다. 기존 개발용 Compose와 공유 migration·잠금 파일은 수정하지 않았다.

기본 샌드박스 셸의 프로세스 생성 오류는 여전히 발생했다. 승인 검토를 거친 셸 실행은 가능했고 이를 사용했다. 중간에 자동 승인 서비스의 429 요청 제한으로 명령이 거부됐으나, 대기 후 재시도가 승인되어 검증을 완료했다. 승인 검토를 우회하지 않았다.

## 발견하고 수정한 오류

문서의 `--project-directory .`와 Compose의 `build.context: ..`를 함께 사용하면 빌드 context가 저장소 상위 폴더가 됐다. 첫 실행은 `lstat /home/dong-hki/42/infra: no such file or directory`로 실패했다.

server·web의 context를 `.`로 수정했다. 이후 저장소 루트를 프로젝트 디렉터리로 지정하는 동일 명령으로 이미지 빌드와 전체 기동이 성공했다. 실행 코드 변경은 이 두 경로 수정뿐이다.

## 실제 실행 결과

| 검사 | 실행 명령·방법 | 실제 결과 |
|---|---|---|
| 의존성 설치 | `npm ci` | 종료 0 |
| 호스트 단위 테스트 | `npm test` | 3개 파일, 27개 테스트 통과 |
| 타입 검사·웹 빌드 | `npm run build` | 종료 0, Vite 산출물 생성 |
| 컨테이너 Node 24 단위 테스트 | `dc exec -T -u 0 api npm test` | 동일한 27개 테스트 통과 |
| Compose 해석 | `dc config --quiet` | 종료 0 |
| 빈 DB 첫 기동 | `dc up --build -d --wait --wait-timeout 120` | 종료 0, DB 준비 → migration 종료 0 → API·web healthy |
| 실제 DB 비밀번호 | URL 예약 문자·달러 기호·공백이 있는 파일 사용 | API와 migration이 실제 PostgreSQL 연결에 성공 |
| CRLF 비밀번호 | 별도 빈 `-crlf` DB에서 `run --rm --no-deps migrate` | 실제 migration 종료 0 |
| Nginx 문법 | `dc exec -T web nginx -t` | 종료 0 |
| HTTPS 경로 | `curl --cacert <server.crt>` | 웹, health 2개, `/docs`, `/docs/`, `/docs/json`, Swagger CSS·JS 모두 200 |
| 인증서 SAN | localhost 및 127.0.0.1로 CA 지정 curl 요청 | 모두 성공 |
| HTTP 리다이렉트 | HTTP `/api/health?probe=1` 요청 | 308, HTTPS 47927로 경로·query 보존 |
| 공개 포트·권한 | Docker inspect 및 `id -u` | web만 loopback 포트 공개, API UID 1000, secret·TLS 연결 읽기 전용 |
| 인증서 재생성 방지 | 생성 스크립트 두 번째 실행·파일 hash 비교 | 종료 1, 기존 인증서·키 변경 없음 |
| 브라우저 기능 | desktop·Pixel 7 context에서 웹·DB health·Swagger | 화면·API·Swagger 2개 operation 정상, 콘솔·요청 오류 0 |
| API 재생성 | `dc up -d --force-recreate --wait api` | HTTPS DB health 200 복구 |
| 실제 IP 변경 후 DNS | 이전 API IP를 검증용 컨테이너가 점유한 뒤 API 재생성 | 172.22.0.2 → 172.22.0.4, Nginx를 통한 health 200 |
| DB 장애 | `dc stop db` 후 HTTPS 요청 | 준비 확인 503, 생존 확인 200 |
| DB 복구 | `dc start db` 후 요청 | 준비 확인 200 복구 |
| 정상 종료·재시작 | `dc stop`, `dc up -d --wait` | 네 서비스 종료 코드 0, 재시작 후 healthy |
| 개발 DB 회귀 | 별도 `-dev` DB에서 `npm run db:migrate`, `npm run db:check` | 모두 종료 0 |
| 기존 E2E | 비기본 PORT·E2E_PORT로 `npm run test:e2e` | desktop·mobile 2개 테스트 통과 |
| 개발 프록시·Ctrl+C | PORT 51821, 웹 55327, controller에 SIGINT | DB 요청 200, 종료 0, API·웹 포트 모두 해제 |
| preview 프록시·종료 | PORT 57629, preview 60711, SIGTERM | DB 요청 200, API 종료 0·Vite 종료 143, 두 포트 모두 해제 |
| 비밀 제외 | 실제 Docker context에 임시 dotenv·secret·key canary 생성 후 검사 | 모두 제외, node_modules·Git 제외, 예시 env 포함, canary 제거 |
| 최종 이미지 검사 | secret·TLS를 연결하지 않은 별도 image 실행 | 개인 env·Git·비밀번호 파일·개인키·인증서 없음 |

`dc`는 검증용 환경 파일·프로젝트 이름을 고정한 아래 명령의 축약이다. 기본 안내의 8080/8443 대신 위 격리 포트를 사용했다.

~~~sh
docker compose --env-file <검증용 runtime.env> --project-directory . \
  -p cafe-env-check-20261012082027 -f infra/compose.full.yaml <명령>
~~~

Node 24 단위 테스트의 최초 일반 사용자 실행은 Vite가 `/app/config`에 임시 config 파일을 쓰려다 EACCES로 실패했다. 테스트 명령만 root로 실행해 통과했으며 제품 API는 계속 일반 사용자 `node`로 실행했다. 테스트 실행을 위해 제품의 파일 권한을 넓히지 않았다.

preview 검증 스크립트의 최초 판정은 Vite도 종료 코드 0이어야 한다고 가정해 실패했다. 실제 Vite의 SIGTERM 종료는 143이며 API는 0이었다. 해당 정상 신호 종료와 포트 해제를 기준으로 수정하고 preview만 재검증했다. 기존 E2E에서는 API가 listen하기 전 일시적인 프록시 ECONNREFUSED 로그가 있었고, 준비 대기 후 두 테스트가 통과했다.

## 데이터 보존과 실패 차단 증거

`connection_probe`에 `runtime-persistence-probe` 행을 넣었다. `down`에는 `--volumes`를 사용하지 않았으며, 동일한 프로젝트로 다시 기동했다.

- 재생성 전후 같은 volume의 생성 시각이 유지됐다.
- 행 ID와 `created_at`이 모두 일치했다: `runtime-persistence-probe:2026-10-12 08:24:39.710792+00`.
- 조회 확인 후 검증 행을 삭제했다.
- 계정·경기 스키마는 아직 없으므로 해당 도메인의 데이터 보존은 검증 범위에 포함하지 않았다.

migration 실패는 별도의 빈 DB에 `CREATE VIEW connection_probe AS SELECT 1 AS incompatible`을 실행해 재현했다. 기존 SQL과 충돌한 migration은 종료 1, 전체 `up --wait`는 종료 1이었다. API·web은 Created 상태로 시작되지 않았다. 공유 migration을 수정하지 않았다.

DB 장애 시 공개 응답은 다음과 같았으며 내부 오류·접속 정보는 포함되지 않았다.

~~~json
{"error":{"code":"SERVICE_UNAVAILABLE","message":"Database is unavailable."}}
~~~

검증 종료 후 이번에 만든 네 프로젝트의 컨테이너·네트워크·볼륨만 제거했다. 기존 `ft-pr2-review_postgres_data`, `pr2-readme-repro_postgres_data`와 기존 중지된 DB 컨테이너 두 개는 그대로 유지됐다.

## 브라우저·의존성 검증의 한계

curl은 자체 서명 인증서를 `--cacert`로 명시적으로 신뢰해 TLS와 SAN을 검사했다. CA를 지정하지 않은 curl은 예상대로 종료 60이었다. 브라우저 기능 검사는 `ignoreHTTPSErrors=true`를 사용했다. Windows 브라우저의 신뢰 저장소 등록이나 경고 없는 실제 사용자 접속까지 완료한 결과는 아니다.

`npm audit --omit=dev` 결과는 취약점 0이었다. 전체 감사는 기존 잠금 파일 기준 moderate 4개·high 1개를 보고했다. 대상은 `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit`, `esbuild`, `source-map-js`다. server 이미지에는 migration 도구도 남아 있으므로 이 의존성들이 포함된다. 기존 의존성을 바꾸지 않는 계획에 따라 자동 업데이트를 하지 않았으며, 후속 도구 업데이트 때 검토할 실제 결과로 기록한다.

브라우저 화면 증거는 인증서 신뢰 검증의 한계를 전제로 확인한다.

- [데스크톱 웹](runtime-evidence/2026-10-12/home-desktop.png), [모바일 웹](runtime-evidence/2026-10-12/home-mobile.png)
- [데스크톱 Swagger](runtime-evidence/2026-10-12/swagger-desktop.png), [모바일 Swagger](runtime-evidence/2026-10-12/swagger-mobile.png)

## 남은 확인과 PR 판단

자체 검증 결과와 증거를 실행 환경 PR에서 리뷰한다. 작성자 외 팀원 재현과 Windows 브라우저 인증서 신뢰를 확인한 뒤 master 병합을 권장하며, 실제 WSS는 endpoint 인계 후 후속 통합 검증으로 진행할 수 있다.

1. 작성자 외 팀원이 README의 준비·기동 절차를 자기 환경에서 재현하고 명령·커밋·결과를 기록한다.
2. 실제 사용할 Windows 브라우저에 발급 CA를 신뢰하도록 설정한 뒤 경고 없는 HTTPS 접속을 확인한다.
3. 실제 WebSocket endpoint 인계 후 WSS 연결·메시지·종료·재접속을 통합 검증한다. 실행 환경 PR과 구분해 후속 작업으로 관리할 수 있다.

위 잔여 항목을 확인하지 않았으므로 이슈 전체 수용 기준을 완료로 표시하지 않는다. master 병합 후 공통 실행 기반으로 사용하되 이미지·환경 설정·migration·인증서 갱신은 계속 관리한다. [병합 후 사용하는 방법](runtime.md#master-병합-후-사용과-유지보수)을 참고한다.
