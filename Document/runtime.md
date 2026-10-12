# 이슈 #7 전체 앱 실행 안내

상태: 구현 초안. Docker·빌드·브라우저·통합 검증과 작성자 외 팀원의 재현은 대기 중이다. PR은 생성하지 않았다. [작업 계획](runtime-plan.md)과 [검증 기록](runtime-validation.md)을 함께 확인한다.

## 구성과 책임 범위

~~~mermaid
flowchart LR
    browser["브라우저"] -->|"HTTPS / 인계 후 WSS"| web["web: Nginx"]
    web -->|"정적 HTML / JavaScript / CSS"| browser
    web -->|"내부 HTTP, URI 보존"| api["api: Fastify"]
    api -->|"SQL, db:5432"| db["db: PostgreSQL"]
    migrate["migrate: 기존 Drizzle Kit migration"] -->|SQL| db
    db --- volume[("postgres_data")]
~~~

~~~mermaid
flowchart LR
    db["DB health 성공"] --> migrate["migration 종료 코드 0"]
    migrate --> api["API 시작 및 DB 준비 확인 성공"]
    api --> web["HTTPS 진입점 시작"]
~~~

호스트 포트를 공개하는 서비스는 `web`뿐이다. API는 listen 주소를 설정할 수 있지만 호스트 포트를 연결하지 않는다. `data` 네트워크는 내부 전용이며 DB와 migration이 사용한다. API는 `data`·`edge`에, Nginx는 `edge`에 연결한다. 따라서 DB는 공개 포트뿐 아니라 Nginx와도 네트워크를 분리한다. 다만 Docker 관리자는 컨테이너를 제어하고 접근할 수 있으므로 호스트 관리자에 대한 접근 차단 수단은 아니다.

기존 개발용 진입점은 `infra/compose.yaml`이며 프로젝트 이름은 `cyber-board-cafe`다. 전체 앱 실행은 `infra/compose.full.yaml`과 `cyber-board-cafe-full` 프로젝트를 사용하고, 별도의 기본 named volume에 데이터를 저장한다. 검증에는 이름이 다른 추가 프로젝트를 사용한다. 개발 환경과 공유하는 외부 볼륨이나 고정 볼륨 이름을 지정하지 않는다.

이번 작업에서는 도메인 스키마, 게임·인증·소셜 코드, 실제 WebSocket endpoint를 추가하지 않는다. 현재 DB에는 연결 확인용 `connection_probe` 테이블만 구현돼 있다.

## 실행 전 준비

명령은 저장소 루트에서 WSL·Linux 등의 POSIX 셸로 실행한다.

- Docker engine과 Docker Compose v2가 필요하다. health 의존 조건과 `bind.create_host_path`를 지원해야 한다.
- 첫 빌드에서는 이미지와 npm 의존성을 내려받을 인터넷 연결이 필요하다.
- Node/npm은 이미지 안에 있으므로 전체 앱 기동에 호스트 Node/npm 설치가 필요하지 않다.
- 인증서·개인키 쌍을 직접 준비하거나, 포함된 로컬 생성 스크립트를 위해 OpenSSL 1.1.1 이상을 준비한다. 브라우저 신뢰 설정은 별도 작업이다.
- 아래 검증 명령에는 `curl`이 필요하다.
- 이미지 태그는 Node 24/bookworm-slim, Nginx 1.28/alpine, PostgreSQL 17/alpine을 사용한다. digest로 고정하지 않았으므로 검증할 때 실제 이미지 ID·digest와 Docker engine·Compose 버전을 기록한다.

`.env.full`이 없으면 `.env.full.example`을 복사한다. 기존 파일이 있으면 보존한다.

~~~sh
cp -n .env.full.example .env.full
chmod 600 .env.full
~~~

비밀번호 파일이 없으면 별도로 생성한다.

~~~sh
umask 077
mkdir -p infra/secrets
chmod 700 infra/secrets
if [ ! -e infra/secrets/postgres-password ]; then
  openssl rand -hex 32 > infra/secrets/postgres-password
fi
chmod 444 infra/secrets/postgres-password
~~~

디렉터리는 호스트 소유자만 접근할 수 있도록 설정한다. 컨테이너에 연결되는 파일은 API·migration 컨테이너의 일반 권한 `node` 사용자도 읽을 수 있어야 한다. 읽기 전용 secret은 API·migration·DB에만 전달한다. 로컬 Compose의 파일 기반 secret은 암호화된 비밀 저장소가 아니다. 파일 내용을 출력하거나 커밋하지 않으며, 생성된 `DATABASE_URL`도 검증 증거에 남기지 않는다.

비밀번호 파일은 무시 대상인 `infra/secrets` 아래나 저장소·빌드 context 밖에 둔다. 경로를 바꾸면 `.gitignore`와 `.dockerignore`도 확인한다. 파일은 비어 있지 않은 한 줄이어야 하며 끝의 LF·CRLF 개행 하나는 허용한다. 공백은 비밀번호의 일부로 보존하고, 중간 개행·NUL 문자는 거부한다. API·migration 시작 스크립트가 URL 예약 문자와 달러 기호를 인코딩하므로, 비밀번호 자체는 Compose 변수 치환을 거치지 않는다.

PostgreSQL 초기 설정은 데이터 디렉터리가 비어 있을 때 적용된다. 비밀번호 파일이나 사용자·DB 변수만 바꿔도 기존 DB의 설정이 갱신되지는 않는다. 비밀번호 변경은 SQL과 서비스 설정을 함께 조정해서 진행하며, 변경을 쉽게 하려고 기존 볼륨을 삭제하지 않는다.

## 인증서와 신뢰 설정

Nginx는 `CERT_DIR` 안의 `server.crt`와 `server.key`를 읽는다. 두 파일은 읽기 전용으로 연결하며 이미지에 포함하지 않는다.

CLI 확인용 자체 서명 localhost 인증서는 다음과 같이 준비한다.

~~~sh
sh infra/generate-local-cert.sh
curl --cacert infra/certs/server.crt https://localhost:8443/api/health
~~~

위 `curl` 명령은 서비스를 기동한 뒤 실행한다. 생성 스크립트는 `localhost`·`127.0.0.1`·`::1`을 subject alternative name(SAN)으로 포함하는 30일 인증서를 만든다. 기존 인증서·개인키 쌍은 덮어쓰지 않는다. 브라우저 신뢰 설정을 설치하지 않으므로, 이 절차만으로 브라우저에서 경고 없이 접속할 수 있다고 판단하지 않는다.

브라우저가 신뢰하는 로컬 인증서를 준비하는 한 가지 방법은 이미 설치된 `mkcert`를 사용하는 것이다. 이 경우 자체 서명 생성 스크립트 대신 다음 절차로 인증서·개인키 쌍을 만든다.

~~~sh
umask 077
mkdir -p infra/certs
# 기존 인증서·개인키 쌍이 있으면 먼저 보존하거나 명시적으로 다른 위치로 옮긴다.
mkcert -install
mkcert -cert-file infra/certs/server.crt -key-file infra/certs/server.key \
  localhost 127.0.0.1 ::1
~~~

`mkcert -install`은 해당 컴퓨터의 신뢰 저장소를 변경하며 운영체제 승인이 필요할 수 있다. 재현에 사용하는 각 브라우저·클라이언트에서 신뢰를 설정한다. WSL 신뢰 저장소를 바꿨다고 Windows Chrome의 신뢰 저장소까지 바뀌는 것은 아니다. 다른 클라이언트에는 인증서를 발급한 CA의 `rootCA.pem`을 신뢰하도록 설정해야 한다. 그 컴퓨터에서 무관한 다른 CA를 만들고 설치해도 이 서버 인증서를 검증할 수 없다. 로컬 CA 개인키도 비공개로 보관한다. `mkcert`를 사용한 경우 `curl`의 신뢰 파일은 서버 인증서 `server.crt`가 아니라 발급 CA의 `rootCA.pem`이다.

LAN 접속에서는 다른 컴퓨터가 실제로 사용하는 IP·DNS 이름이 인증서에 포함돼야 한다. OpenSSL 생성 스크립트는 `LOCAL_CERT_SAN`으로 다른 SAN 목록을 받을 수 있다. `BIND_ADDRESS`를 명시적으로 바꾸고(예: `0.0.0.0`), 상대 클라이언트의 신뢰 설정과 호스트 방화벽 접근을 확인한다. 신뢰 설정을 위해 서버 개인키나 로컬 CA 개인키를 클라이언트에 전달하지 않는다.

## 단일 명령 기동

사전 준비를 마친 뒤 실행한다.

~~~sh
docker compose --env-file .env.full --project-directory . \
  -p cyber-board-cafe-full -f infra/compose.full.yaml up --build -d --wait
~~~

| 예시 포트 기준 공개 URL | 기대 동작 |
|---|---|
| https://localhost:8443/ | 빌드된 웹 화면 |
| https://localhost:8443/api/health | API 생존 확인, 200 |
| https://localhost:8443/api/health/db | DB·테이블 준비 확인, 200 또는 일반 오류 응답 503 |
| https://localhost:8443/docs/ | Swagger UI와 관련 정적 파일 |
| https://localhost:8443/docs/json | OpenAPI JSON |
| http://localhost:8080/ | HTTPS 포트 8443으로 308 리다이렉트 |

첫 빌드는 의존성 설치, 이미지 제공 여부, 도구·실행 버전 호환 문제로 실패할 수 있다. 이 세션에서는 실행하지 못했다. 설정 파일 작성만으로 기동이 검증됐다고 판단하지 않는다.

workspace 이미지는 커밋된 루트 잠금 파일을 기준으로 `npm ci`를 수행한다. `web-build` 단계는 기존 타입 검사와 Vite 빌드를 실행한다. 최종 `web` 이미지에는 Nginx와 웹 빌드 결과가 들어간다. `server` 이미지는 기존 Node TypeScript 실행 방식을 유지하며 migration 도구도 포함한다. 실행에 불필요한 의존성을 제거하는 최적화는 후속 작업으로 남긴다. 두 이미지 모두 호스트의 `node_modules`에 의존하지 않는다.

## 환경 변수 우선순위와 내부 주소

| 설정 | 입력 위치·동작 |
|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | 필수. 셸 환경 변수가 Compose `--env-file`의 값보다 우선함 |
| `POSTGRES_PASSWORD_FILE` | Compose secret에 사용할 호스트 파일 경로. 컨테이너에는 `/run/secrets/postgres_password`로 전달 |
| `CERT_DIR` | Nginx에 읽기 전용으로 연결할 호스트 디렉터리 |
| `BIND_ADDRESS` / `HTTP_PORT` / `HTTPS_PORT` | Compose 변수 치환에 사용. 기본값은 `127.0.0.1` / `8080` / `8443` |
| 전체 앱 API의 `API_HOST` / `PORT` | 서비스 설정에서 `0.0.0.0` / `3001`로 명시 |
| 전체 앱 API·migration의 `DATABASE_URL` | 비밀번호 파일과 DB 초기 설정으로 생성. 주소는 항상 `db:5432` |
| 로컬 개발의 `API_HOST` | 선택 사항. 기본값은 `127.0.0.1` |
| 로컬 개발·preview의 `PORT` | 기존 루트 `.env`·프로세스 환경과 Vite 프록시 동작을 유지 |

문서의 기동·종료 명령은 `-p cyber-board-cafe-full`을 명시한다. 셸에서 상속된 `COMPOSE_PROJECT_NAME` 때문에 개발용 프로젝트가 선택되는 일을 방지하기 위해서다. 검증 명령에서는 별도 폐기 가능한 프로젝트를 명시적으로 선택한다.

Compose의 `--env-file`은 설정값을 치환하는 입력이다. 모든 변수를 모든 컨테이너에 자동으로 전달하는 기능이 아니다. 각 서비스의 `environment` 설정에서 전달할 값을 명시한다. 전체 앱 Compose 명령은 개발용 루트 `.env`를 읽지 않으며, 해당 파일은 이미지에서도 제외한다. `.env.full`을 셸 스크립트처럼 `source`하지 않는다.

내부 `DATABASE_URL`을 생성하기 전에 사용자명·비밀번호·DB 이름을 URI 인코딩한다. 브라우저는 같은 origin의 `/api` 경로로 요청한다. 내부 서비스 이름인 `api`·`db`를 브라우저에서 조회하려고 하면 안 된다. 컨테이너 내부에서 `0.0.0.0`에 listen하는 것 자체가 호스트 포트를 공개하는 것은 아니다.

Nginx 템플릿에서는 `PUBLIC_HTTPS_PORT`만 치환한다. `$host`·`$request_uri`·`$http_upgrade` 같은 Nginx 변수는 그대로 남긴다. `/api`·`/docs`는 접두어를 제거하지 않고 전달한다. 변수 기반 upstream에서 Docker DNS를 조회하므로 API 컨테이너가 교체된 뒤에도 주소를 다시 찾을 수 있도록 구성한다.

## 준비 상태·migration·기동과 종료

DB 준비 상태는 `pg_isready`로 확인한다. migration은 기존 설정과 SQL 파일을 사용하는 Drizzle Kit 명령을 실행한다. migration의 성공 종료가 API 시작 조건이다. API는 listen 전에 기존 DB·테이블 준비 확인 경로를 추가로 검사한다. 웹은 API health가 성공한 뒤 시작한다.

migration·DB 실패 시 새 API가 정상 준비 상태가 되지 않아야 한다. `up --wait`가 0이 아닌 종료 코드를 반환하면 성공으로 취급하지 않는다. health 의존 조건은 기동 시점에 적용된다. 실행 중 DB 장애는 준비 상태를 비정상으로 표시하지만, 자동으로 전체 복구를 조율하거나 다른 모든 컨테이너를 멈추지는 않는다.

~~~sh
docker compose --env-file .env.full --project-directory . \
  -p cyber-board-cafe-full -f infra/compose.full.yaml ps -a

docker compose --env-file .env.full --project-directory . \
  -p cyber-board-cafe-full -f infra/compose.full.yaml logs --tail=100 db migrate api web
~~~

증거로 첨부하기 전에 로그를 확인하고, 예상치 못한 비밀값이 있으면 제거한다. 비밀번호 파일, 개인 `.env`, 개인키, 프로세스 환경 변수 전체를 첨부하지 않는다.

정상 종료 명령은 다음과 같다.

~~~sh
docker compose --env-file .env.full --project-directory . \
  -p cyber-board-cafe-full -f infra/compose.full.yaml stop
~~~

정상 종료 후에는 동일한 기동 명령과 프로젝트 이름으로 다시 실행한다. named DB volume을 보존하면서 컨테이너·네트워크를 제거하려면 `--volumes` 없이 `down`을 사용한다. 실제 전체 앱·개발 프로젝트에는 `down -v`를 사용하지 않는다.

스키마를 변경하는 배포에서는 웹·API를 먼저 멈추고 migration 성공 후에 재생성한다. 새 migration이 실패해도 이미 실행 중인 API가 자동으로 종료되지는 않는다. 실행 중인 서비스에 `up`을 적용하는 것만으로 배포 전체가 하나의 트랜잭션처럼 처리된다고 가정하지 않는다.

API 시작 스크립트는 같은 Node 프로세스에서 기존 서버를 import하므로 `SIGTERM`이 Fastify 종료 핸들러에 전달되도록 구성한다. `init: true`는 자식 프로세스를 정리하고, migration 시작 스크립트는 `SIGINT`·`SIGTERM`을 Drizzle 프로세스에 전달한다. 정상 종료 여부도 실제 실행으로 검증해야 한다.

## WebSocket 인계 조건

`/api/` 아래 경로에는 `Upgrade`·`Connection` 헤더 전달 설정을 준비했다. upstream 유휴 제한 시간은 75초이므로 실제 endpoint의 heartbeat 정책과 조율해야 한다. 담당자에게 실제 endpoint 경로를 확인한다. `/api/` 밖에 있으면 해당 프록시 경로를 명시적으로 추가하고 검증한다.

인계 대기 항목은 endpoint 경로, 인증·origin 처리, heartbeat 주기, 연결 종료 동작, 연결·메시지·재접속 검증이다. 인계 전까지 실제 WSS 검증은 대기로 둔다. 임시 echo endpoint만 추가하고 제품의 실시간 통합이 완료됐다고 기록하지 않는다.

## 격리된 수용 기준 검증

고유한 프로젝트 이름과 사용하지 않는 포트를 선택한다. 아래 명령은 기존 개발용·전체 앱 데이터 볼륨을 대상으로 하지 않는다.

~~~sh
export HTTP_PORT=18080
export HTTPS_PORT=18443
export BIND_ADDRESS=127.0.0.1
VERIFY_PROJECT="cafe-env-check-$(date +%s)"
dc() {
  docker compose --env-file .env.full --project-directory . \
    -p "$VERIFY_PROJECT" -f infra/compose.full.yaml "$@"
}
dc config --quiet
dc up --build -d --wait
dc ps -a
~~~

인증서 준비 방식에 맞는 신뢰 파일을 사용한다.

~~~sh
# 자체 서명 생성 스크립트 기준 경로. mkcert를 사용했다면 해당 CA의 rootCA.pem으로 바꾼다.
TRUST_FILE=infra/certs/server.crt
curl --fail --cacert "$TRUST_FILE" https://localhost:18443/
curl --fail --cacert "$TRUST_FILE" https://localhost:18443/api/health
curl --fail --cacert "$TRUST_FILE" https://localhost:18443/api/health/db
curl --fail --cacert "$TRUST_FILE" https://localhost:18443/docs/
curl --fail --cacert "$TRUST_FILE" https://localhost:18443/docs/json
curl -sS -D - -o /dev/null http://localhost:18080/api/health
~~~

기대 결과는 health 경로의 200 응답, Swagger 경로·정적 파일 정상 로딩, HTTP의 308 응답과 `Location: https://localhost:18443/api/health`다. 인증서 신뢰를 설정한 브라우저에서 웹 화면·Swagger를 열고 콘솔 출력을 기록한다. `curl -k`나 Nginx 내부 healthcheck는 인증서 신뢰 검증을 대신하지 않는다.

공개 포트 연결은 `web`에만 있는지 확인한다. `dc up -d --force-recreate api`로 API를 교체한 뒤 DNS 캐시 만료 후 HTTPS health URL을 다시 요청한다. 일시적인 실패가 있으면 함께 기록한다.

컨테이너·네트워크 재생성 후에도 연결 확인용 행 하나가 보존되는지 확인한다.

~~~sh
dc exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
INSERT INTO connection_probe (id) VALUES ('runtime-persistence-probe');
SQL
dc down
dc up -d --wait
dc exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT id FROM connection_probe WHERE id = 'runtime-persistence-probe';
DELETE FROM connection_probe WHERE id = 'runtime-persistence-probe';
SQL
~~~

기대 결과는 동일한 행이 조회되는 것이다. 이는 연결 확인 테이블의 데이터 보존만 확인하며, 계정·경기 기록 보존 검증을 의미하지 않는다.

실행 중 DB 장애는 `dc stop db` 후 `/api/health/db`가 일반 오류 응답 503을 반환하는지 확인한다. 이때 API 생존 확인은 200을 유지할 수 있다. DB를 다시 시작한 뒤 준비 상태가 복구되는지 확인한다. 전체 서비스 종료 시 종료 코드·종료 동작도 기록한다.

migration 실패는 별도의 빈 프로젝트에서 충돌하는 view를 만들어 검증한다. 기존 migration SQL을 그대로 사용하며, 이미 적용된 migration 파일을 수정하지 않는다.

~~~sh
FAILURE_PROJECT="$VERIFY_PROJECT-migration-failure"
failure_dc() {
  docker compose --env-file .env.full --project-directory . \
    -p "$FAILURE_PROJECT" -f infra/compose.full.yaml "$@"
}
failure_dc up -d --wait db
failure_dc exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
CREATE VIEW connection_probe AS SELECT 1 AS incompatible;
SQL
failure_dc up --build -d --wait
failure_dc ps -a
failure_dc logs --tail=100 migrate
~~~

기대 결과는 기존 view와 migration의 `CREATE TABLE`이 충돌해 migration이 0이 아닌 종료 코드로 끝나고, 새 API·웹이 준비 상태가 되지 않는 것이다. 뒤의 셸 명령을 계속 실행하면서 기동 명령의 실패 코드를 놓치지 말고 기록한다. 새로 만든 빈 실패 검증용 프로젝트에서만 수행한다. view 생성이 실패하면 계속 진행하지 말고 해당 프로젝트를 확인한다.

증거 기록 후에는 폐기 가능한 검증용 프로젝트만 정리한다. 출력된 프로젝트 이름이 `cyber-board-cafe`·`cyber-board-cafe-full`이 아니라 이번에 만든 고유 검증 이름인지 확인한다.

~~~sh
printf '%s\n' "$VERIFY_PROJECT" "$FAILURE_PROJECT"
dc down --volumes
failure_dc down --volumes
~~~

기존 호스트 개발 흐름의 회귀 검증은 다음과 같다. 이 검증에만 호스트 Node/npm이 필요하다.

~~~sh
npm ci
npm test
npm run build
npm run db:up
npm run db:migrate
npm run test:e2e
~~~

기본값과 다른 `PORT`, 개발·preview API 프록시, Ctrl+C 종료도 확인한다. 일반 개발 DB에 보존할 데이터가 있다면 별도의 로컬 검증용 DB를 사용한다.

기록에는 한국 시간 기준 날짜·시각, 검증자, 커밋 SHA, Docker engine·Compose·Node·브라우저 버전, 이미지 ID, 명령, 종료 코드, 비밀값을 제거한 로그, HTTPS·브라우저 증거, 데이터 보존 결과, 실패 검증 결과, WSS 대기 상태를 포함한다. 이슈 #7을 수용하려면 작성자 외 팀원이 README 절차를 재현해야 한다.

## 참고 자료

- [Docker 기동 의존 조건](https://docs.docker.com/compose/how-tos/startup-order/)
- [Docker 네트워크 이름과 포트](https://docs.docker.com/compose/how-tos/networking/)
- [Compose 환경 변수 설정](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)
- [Nginx WebSocket 전달 설정](https://nginx.org/en/docs/http/websocket.html)
- [Node TypeScript 실행](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
- [mkcert](https://github.com/FiloSottile/mkcert)

계획·구현·소스 수준 검토에 Codex의 도움을 받았다. 이 문서 자체는 실제 실행 결과나 학교 평가 통과의 증거가 아니다.
