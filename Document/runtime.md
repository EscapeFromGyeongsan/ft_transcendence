# 이슈 #7 전체 앱 실행 안내

PR #10의 전체 실행 구성과 #28의 서버·아바타 연결 설정을 설명한다. 기존 실행 검증은 [검증 기록](runtime-validation.md), #11·#15 통합 시의 추가 검증은 [#28 검증 기록](runtime-issue-28-validation.md)을 확인한다. 작성자 외 팀원의 재현과 실제 WSS 검증은 별도로 필요하다.

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

인증·아바타 API는 별도 PR #11·#15가 제공한다. 이 문서의 연결 설정을 사용하려면 해당 서버 코드가 작업 사본에 함께 있어야 한다. 실행 환경 보완에서는 도메인 스키마, 게임·인증·소셜 코드, 실제 WebSocket endpoint를 추가하지 않는다.

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

`.env.full`의 `JWT_SECRET`에는 `openssl rand -hex 32` 등으로 생성한 32자 이상의 개인 값을 설정한다. 빈 값이면 Compose가 기동 전에 오류를 반환한다. 값을 교체하면 기존 access token 검증에 영향을 주므로 매번 새로 생성하지 않는다.

`TWO_FACTOR_KEY`는 선택 사항이다. 빈 값이면 컨테이너 시작 스크립트가 미설정으로 처리하고, 서버의 2FA 기능만 비활성화한다. 설정할 때는 32자 이상이어야 하며 기존 키를 바꾸면 저장된 2FA 설정을 복호화할 수 없다. `FT_OAUTH_CLIENT_ID`, `FT_OAUTH_CLIENT_SECRET`, `FT_OAUTH_REDIRECT_URI`는 세 값을 모두 설정하거나 모두 비워 둔다. 이 설정도 호스트 파일·로그·검증 증거에서 비공개로 관리한다.

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

저장소 루트에서 `make` 하나로 준비와 기동을 함께 실행한다(#130). `make`는 다른 컴퓨터도 접속할 수 있게 이 컴퓨터의 IP로 열고, `make HOST=<IP>`는 주소를 직접 정하며, `make local`은 `https://localhost`에서만 연다. 세 target 모두 먼저 `infra/prepare-full.sh`로 없는 것만 만든다. `.env.full`이 없으면 `.env.full.example`을 복사하고, 비어 있는 `JWT_SECRET`·`TWO_FACTOR_KEY`를 `openssl rand -hex 32`로 채운다. DB 비밀번호 파일이 없으면 만들고, `server.crt`·`server.key`가 둘 다 없으면 `infra/generate-local-cert.sh`를 실행한다. 이미 있는 값·파일은 바꾸지 않는다. 비밀번호 파일은 API·migration 컨테이너가 non-root `node` 사용자로 읽으므로, 스크립트가 그룹·다른 사용자 모두 들어갈 수 없는 디렉터리에 새로 만든 경우에만 `0444`로 둔다. 기존 파일은 권한을 바꾸지 않고, 그 밖의 디렉터리(권한을 확인할 수 없는 경우 포함)의 새 파일은 `0600`으로 두며, 두 경우 모두 안내를 출력한다. 키를 바꾸면 발급된 토큰·저장된 2FA 설정·기존 DB 접속이 깨지기 때문이다. 인증서·개인키 중 하나만 있으면 멈춘다.

`infra/start-full.sh`가 준비 뒤 실행 값을 정해 compose에 넘긴다. `.env.full`은 바꾸지 않으므로 다음 실행은 다시 정한다.

| target | 바인딩 | 인증서 | 접속 주소 | 42 redirect URI (`FT_OAUTH_CLIENT_ID`가 있을 때) |
|---|---|---|---|---|
| `make` | `0.0.0.0` | `infra/certs/lan`, SAN에 IP 포함. 주소가 바뀌면 다시 생성 | `https://<IP>:8443/` | `https://<IP>:8443/oauth/42/callback` |
| `make HOST=<IP>` | `0.0.0.0` | 위와 같음 | `https://<IP>:8443/` | 위와 같음 |
| `make local` | `127.0.0.1` | `infra/certs` (localhost) | `https://localhost:8443/` | `.env.full` 값, 비어 있으면 `https://localhost:8443/oauth/42/callback` |

IP는 macOS에서 `ipconfig getifaddr en0`·`en1`, Linux에서 `hostname -I`의 첫 값으로 찾는다. 찾지 못하면 `make HOST=<IP>`를 쓰라고 안내하고 멈춘다. 두 컴퓨터로 시연할 때는 서버 컴퓨터를 포함한 모든 브라우저가 출력된 IP 주소를 쓴다. 42 redirect URI가 한 origin에만 맞기 때문이다. 다른 컴퓨터에서 먼저 `https://<IP>:8443/api/health`로 방화벽을 확인하고, 각 브라우저에서 자체 서명 인증서 경고를 한 번 수락한다.

~~~sh
make        # 준비 후 이 컴퓨터의 IP로 compose up
make local  # 준비 후 localhost로만 compose up
make down   # 컨테이너 종료, DB·아바타 볼륨 보존
make logs
make ps
~~~

위 "실행 전 준비"와 "인증서와 신뢰 설정"을 직접 마쳤다면 `make`는 그 값을 그대로 쓴다. `make` 없이 실행할 때는 사전 준비를 마친 뒤 다음 명령을 쓴다.

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

2026-10-12 WSL/Docker 환경에서 위 명령의 첫 빌드·기동을 실행해 통과했다. 검증에서는 포트·프로젝트·환경 파일만 격리용 값으로 바꿨다. 실제 환경·이미지 ID·실패/복구 결과와 남은 확인은 [검증 기록](runtime-validation.md)에 있다.

명령은 저장소 루트에서 `--project-directory .`를 지정해 실행한다. Compose의 `build.context: .`는 이 프로젝트 디렉터리를 기준으로 하며 Dockerfile은 `infra/Dockerfile`이다.

workspace 이미지는 커밋된 루트 잠금 파일을 기준으로 `npm ci`를 수행한다. `web-build` 단계는 기존 타입 검사와 Vite 빌드를 실행한다. 최종 `web` 이미지에는 Nginx와 웹 빌드 결과가 들어간다. `server` 이미지는 기존 Node TypeScript 실행 방식을 유지하며 migration 도구도 포함한다. 실행에 불필요한 의존성을 제거하는 최적화는 후속 작업으로 남긴다. 두 이미지 모두 호스트의 `node_modules`에 의존하지 않는다.

## master 병합 후 사용과 유지보수

이 브랜치를 master에 병합하면 팀이 같은 Compose·Dockerfile·프록시·실행 안내를 공통 기반으로 계속 사용한다. 매번 실행 환경 브랜치를 새로 만들 필요는 없다. 각 컴퓨터에서는 처음 사용할 때 환경 파일·비밀번호·인증서를 별도로 준비한다. 개인 설정과 비밀값은 Git으로 배포되지 않는다.

기동할 때마다 migration 서비스가 기존 Drizzle 이력을 확인하고 미적용 migration을 적용한다. 적용된 migration을 다시 적용하거나 DB를 초기화하는 과정은 아니다. 이번 검증에서 동일한 프로젝트와 volume의 반복 기동·재생성 후 행 보존을 확인했다.

| 변경·작업 | 계속 관리할 내용 |
|---|---|
| 평소 기동·중지 | 같은 프로젝트 이름으로 `up`·`stop` 또는 volume을 유지한 `down` 사용 |
| 웹·API 코드 변경 | 최신 코드를 받아 `up --build -d --wait`로 이미지 갱신 |
| DB 스키마 변경 | 새 migration을 검토·커밋하고 웹·API를 중지한 뒤 migration 성공 후 다시 기동 |
| API·WebSocket 경로 변경 | Nginx 프록시 경로·heartbeat 설정과 실제 HTTPS/WSS 통합 검증 갱신 |
| 환경 변수·비밀번호 변경 | 예시·안내·서비스 설정 갱신. 기존 DB 비밀번호는 SQL 변경과 함께 조정 |
| 인증서 | 유효기간·접속 주소·클라이언트 신뢰 관리. 포함된 자체 서명 인증서는 30일 뒤 갱신 필요 |
| 도구·이미지 업데이트 | 의존성·이미지 버전과 보안 업데이트 검토 후 회귀 검증 |

데이터 보존은 같은 Docker volume을 유지하는 조건이다. 프로젝트 이름·volume 매핑을 바꾸면 다른 DB를 선택할 수 있으므로 변경 시 데이터 인계를 함께 계획한다. DB 백업·복원은 별도로 관리한다.

### 아바타 저장소

전체 실행 API는 `AVATAR_DIR=/data/avatars`로 고정하고 프로젝트별 named volume `avatars`를 같은 경로에 연결한다. 이미지가 해당 디렉터리를 `node` 소유, 권한 `0750`으로 미리 생성하므로 새 volume은 쓰기 가능한 소유권을 상속한다. API 실행 사용자는 계속 `node`다. Nginx에는 이 volume을 연결하지 않으며 파일은 API의 `/api/media/avatars/` 경로로 제공한다(PR #15).

이전에 수동 생성해 권한이 다른 volume을 연결했다면 기존 파일을 지우지 말고 디렉터리 권한을 확인한다. 같은 프로젝트·환경 파일을 선택해 API를 중지한 뒤 다음과 같이 디렉터리 소유권만 바로잡을 수 있다.

~~~sh
docker compose --env-file .env.full --project-directory . \
  -p cyber-board-cafe-full -f infra/compose.full.yaml stop api
docker compose --env-file .env.full --project-directory . \
  -p cyber-board-cafe-full -f infra/compose.full.yaml run --rm --no-deps \
  --user root --entrypoint sh api -c 'chown node:node /data/avatars'
~~~

그 뒤 평소 `up -d --wait` 명령으로 기동한다. 이 일회성 명령은 해당 아바타 volume의 디렉터리에만 적용한다. 파일 자체의 권한이 다른 경우에는 파일 보존 상태를 확인한 뒤 따로 조정한다. 기존 파일·volume을 삭제해 해결하지 않는다.

`down`·API 재생성 시 DB와 아바타 volume을 함께 유지한다. `down -v`는 두 volume을 모두 삭제하므로 실제 데이터가 있는 프로젝트에서 사용하지 않는다. Nginx의 `/api/` 본문 제한은 multipart 여유를 둔 `3m`이며, 파일 자체의 2 MiB 제한은 API가 검사한다.

자체 검증 결과는 PR 리뷰를 받을 단계다. 작성자 외 팀원의 재현과 실제 클라이언트 인증서 신뢰 확인 후 병합을 권장한다. 실제 WSS는 endpoint 제공 후 후속 통합 검증으로 진행한다.

## 환경 변수 우선순위와 내부 주소

| 설정 | 입력 위치·동작 |
|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` | 필수. 셸 환경 변수가 Compose `--env-file`의 값보다 우선함 |
| `POSTGRES_PASSWORD_FILE` | Compose secret에 사용할 호스트 파일 경로. 컨테이너에는 `/run/secrets/postgres_password`로 전달 |
| `CERT_DIR` | Nginx에 읽기 전용으로 연결할 호스트 디렉터리 |
| `BIND_ADDRESS` / `HTTP_PORT` / `HTTPS_PORT` | Compose 변수 치환에 사용. 기본값은 `127.0.0.1` / `8080` / `8443` |
| 전체 앱 API의 `API_HOST` / `PORT` | 서비스 설정에서 `0.0.0.0` / `3001`로 명시 |
| 전체 앱 API·migration의 `DATABASE_URL` | 비밀번호 파일과 DB 초기 설정으로 생성. 주소는 항상 `db:5432` |
| 전체 앱 API의 `JWT_SECRET` | 필수. `.env.full`·셸에서 Compose의 api 환경으로 전달. 32자 이상 |
| `TWO_FACTOR_KEY` / `FT_OAUTH_*` | 선택. 2FA 키의 빈 값은 컨테이너에서 미설정으로 정규화. OAuth 세 값은 모두 설정하거나 모두 비움 |
| 전체 앱 API의 `TRUST_PROXY` | 기본 `uniquelocal`. Nginx가 클라이언트의 `X-Forwarded-For`를 버리고 직접 연결된 주소로 덮어쓴 뒤 전달 |
| 전체 앱 API의 `AVATAR_DIR` | `/data/avatars`로 고정. `avatars` volume의 target과 함께 관리 |
| 로컬 개발의 `API_HOST` | 선택 사항. 기본값은 `127.0.0.1` |
| 로컬 개발·preview의 `PORT` | 기존 루트 `.env`·프로세스 환경과 Vite 프록시 동작을 유지 |

문서의 기동·종료 명령은 `-p cyber-board-cafe-full`을 명시한다. 셸에서 상속된 `COMPOSE_PROJECT_NAME` 때문에 개발용 프로젝트가 선택되는 일을 방지하기 위해서다. 검증 명령에서는 별도 폐기 가능한 프로젝트를 명시적으로 선택한다.

Compose의 `--env-file`은 설정값을 치환하는 입력이다. 모든 변수를 모든 컨테이너에 자동으로 전달하는 기능이 아니다. 각 서비스의 `environment` 설정에서 전달할 값을 명시한다. 전체 앱 Compose 명령은 개발용 루트 `.env`를 읽지 않으며, 해당 파일은 이미지에서도 제외한다. `.env.full`을 셸 스크립트처럼 `source`하지 않는다.

내부 `DATABASE_URL`을 생성하기 전에 사용자명·비밀번호·DB 이름을 URI 인코딩한다. 브라우저는 같은 origin의 `/api` 경로로 요청한다. 내부 서비스 이름인 `api`·`db`를 브라우저에서 조회하려고 하면 안 된다. 컨테이너 내부에서 `0.0.0.0`에 listen하는 것 자체가 호스트 포트를 공개하는 것은 아니다.

Nginx 템플릿에서는 `PUBLIC_HTTPS_PORT`만 치환한다. `$host`·`$request_uri`·`$http_upgrade` 같은 Nginx 변수는 그대로 남긴다. `/api`·`/docs`는 접두어를 제거하지 않고 전달한다. 변수 기반 upstream에서 Docker DNS를 조회하므로 API 컨테이너가 교체된 뒤에도 주소를 다시 찾을 수 있도록 구성한다.

공개 진입점은 이 Nginx 하나이므로 클라이언트가 보낸 `X-Forwarded-For` 체인을 신뢰하지 않고 `$remote_addr`로 교체한다. Docker의 사설 Nginx 주소를 신뢰하도록 API를 설정해도 외부 클라이언트가 임의의 IP를 전달해 요청 제한을 우회하지 않도록 하기 위한 설정이다. 외부 프록시를 추가하는 경우에는 해당 프록시의 주소와 실제 클라이언트 IP 전달 정책을 함께 재검토한다.

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

계획·구현·실행 검증에 Codex의 도움을 받았다. 실제 실행 증거는 별도의 [검증 기록](runtime-validation.md)에 있으며, 프로젝트 전체의 기능 인수나 학교 평가 통과를 의미하지 않는다.
