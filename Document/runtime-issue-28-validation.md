# #28 실행 환경 보완 검증

실행일: 2026-10-29 (KST). 환경: WSL / Docker 29.6.2 / Compose 5.3.1 / API Node.js 24.22.2 / PostgreSQL 17-alpine / Nginx 1.28-alpine.

## 검증 소스와 PR 범위

| 소스 | 커밋 |
|---|---|
| PR #10 전체 실행 구성 | `afeb74a42fa1dfe7d34c779bc8bcaa577f5d0ac6` |
| PR #11 서버·인증·경기 저장 | `fbd32d49cbdbf54b180eac68be410ab9e3f4dad6` |
| PR #15 아바타 API | `7e21ce7daec4536a785d4bd341662e3349265023` |
| 시작 코드 충돌을 정리한 로컬 통합 기준 | `8d23d6cc7ecd04e5cc0f549dcc942c727146a3ea` |

통합 기준 위에 이 PR의 실행 환경 보완을 적용해 검증했다. PR #10만의 소스에는 인증·아바타 API가 없으므로 이 결과를 해당 단독 소스의 기능 검증으로 해석하지 않는다. 실제 병합 때는 #11·#15의 코드와 #10의 `readListenOptions`를 함께 보존해야 한다(#27).

수정 PR은 #10의 `codex/full-app-containers`를 대상으로 실행 설정·문서 변경만 제안한다. `codex/runtime-issue-28-validation`은 서버·아바타와 시작 코드 충돌 해결까지 포함한 검증용 소스다. 정식 `master` 병합이나 다른 담당자의 PR 승인을 대신하지 않는다.

## 재현 구성

임시 환경 파일·비밀번호·localhost 인증서를 생성하고 새 프로젝트 이름과 loopback 포트를 선택했다. 실제 `infra/compose.full.yaml`만 사용했으며 Compose override, 임시 Nginx template, 수동 volume 소유권 수정은 사용하지 않았다.

주요 명령은 다음과 같다. 테스트 DB 이름은 `_test`로 끝나는 별도 검증 DB를 사용했다. 아래 `TEST_DATABASE_URL`은 그 DB를 가리키는 비공개 프로세스 환경 변수다.

~~~sh
docker compose --env-file <검증용 env> --project-directory . \
  -p <검증용 프로젝트> -f infra/compose.full.yaml \
  up --build -d --wait --wait-timeout 120

docker compose --env-file <검증용 env> --project-directory . \
  -p <검증용 프로젝트> -f infra/compose.full.yaml \
  run --rm --no-deps --user 0 --entrypoint npm -e TEST_DATABASE_URL \
  api test -- --testTimeout=15000
~~~

`web-build`에서 `npm run build`로 타입 검사·웹 빌드를 수행했다. API 실행 사용자는 `node`를 유지했다. 테스트 컨테이너만 테스트 도구의 임시 파일 기록을 위해 root로 실행했다.

## 확인 결과

| 항목 | 실제 결과 |
|---|---|
| JWT_SECRET이 비어 있는 설정 | Compose config가 종료 1로 거절, DB 기동 전 설정 오류 확인 |
| 전체 앱 `up --build --wait` | 종료 0, migration 성공, DB·API·웹 준비 완료 |
| HTTPS DB health | 200, 새 CA 파일로 인증서 검증 |
| 새 아바타 volume | API UID 1000, 디렉터리 소유자 UID 1000, 권한 0750 |
| 기존 Vitest 테스트 | 파일 13개·테스트 104개 통과 |
| HTTPS 회원가입·로그인 | 201·200 |
| 비어 있는 선택 2FA 키 | API 기동·로그인은 정상, 2FA endpoint만 503 |
| 실제 768×512 PNG 업로드·제공 | 1,180,586바이트 업로드 200, 제공 파일 바이트 일치 |
| 실제 1024×768 PNG, 2 MiB 초과 | 2,360,847바이트에 API가 413 PAYLOAD_TOO_LARGE JSON 반환 |
| 클라이언트 X-Forwarded-For를 바꾼 로그인 요청 | 같은 클라이언트의 요청 제한이 유지되어 429 반환 |
| API 강제 재생성 | 기존 아바타 200·바이트 일치, 기존 세션의 내 정보 200 |
| volume을 유지한 전체 down/up | 기존 아바타·세션 유지, 내 정보 200 |
| 유효한 2FA 키를 전달한 API 재생성 | 2FA endpoint 200 |

필요한 환경 변수만 api.environment에 전달했고, `.env.full` 전체를 모든 서비스에 주입하지 않았다. 아바타 volume은 API에만 연결한다. 새 volume의 소유권은 이미지의 디렉터리에서 상속하며 런타임 API를 root로 실행하지 않는다.

[비밀값을 제외한 결과 JSON](runtime-evidence/2026-10-29-issue28/results.json)에 실행 결과와 소스 식별 정보를 기록했다.

## 남은 인수와 정리

- D의 실제 `/api/ws` endpoint 인계 후 WSS 인증·메시지·heartbeat·재접속 확인.
- 실제 42 OAuth 제공자와 화면·두 기기 원격 경기 인수.
- 작성자 외 팀원의 Compose 실행 재현과 실제 브라우저 인증서 신뢰 확인.

위 항목은 이번 검증의 통과 범위가 아니다. 특히 실제 WSS 검증이 남아 있어 #28을 자동 종료하는 문구를 사용하지 않는다.

검증용 프로젝트만 `down --volumes`로 정리했다. 기존 서비스·데이터는 사용하거나 삭제하지 않았다. 임시 비밀번호·인증서·환경 파일과 이번 빌드 이미지 태그를 정리했으며, 비밀값·토큰·개인키는 저장소에 포함하지 않았다.
