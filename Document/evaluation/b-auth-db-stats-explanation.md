# B 평가 설명 (인증·DB·통계)

코드 위치는 master 기준(`apps/server/src/` 생략 표기). `#115`, `D`(feat/account-deletion)는 아직 merge 전.

## 1. 비밀번호 해싱
- 질문 예: "비밀번호 어떻게 저장하나요? salt는?"
- 답: Argon2id. `memoryCost 19456`(19 MiB), `timeCost 2`, `parallelism 1`. salt는 해시 문자열 안에 같이 저장(라이브러리가 랜덤 생성).
- 계정 없는 이메일로 로그인해도 dummy hash로 verify를 돌려 응답 시간으로 계정 존재 여부를 알 수 없게 함.
- 위치: `core/password.ts:5-10`(옵션), `:13-15` hash, `:22-28` verify, `:38-41` dummy. 호출 `services/auth-service.ts:152`(가입), `:189-190`(로그인)
- 시연: `psql`에서 `select password_hash from users limit 1;` → `$argon2id$v=19$m=19456,t=2,p=1$...`

## 2. 로그인 토큰 (JWT)
- access token: HS256 JWT, 30분(`auth-service.ts:83`). claim `sub`(user), `sid`(session), `iat`, `exp`.
- 헤더가 정확히 `{"alg":"HS256","typ":"JWT"}`일 때만 허용 → `alg: none` 공격 차단. 서명 비교는 `timingSafeEqual`.
- 매 요청마다 session이 revoke 안 됐는지 DB 확인 → 로그아웃하면 access token도 즉시 무효.
- `JWT_SECRET`은 env, 32자 미만이면 서버가 시작 안 함(`index.ts:12-17`).
- 위치: `core/tokens.ts:12-14`, `:28-45` sign, `:56-84` verify, `auth-service.ts:289-299` authenticate, `api/auth-routes.ts:84-99` requireAuth

## 3. Refresh token 회전과 재사용 감지
- refresh token: 랜덤 32 bytes, DB에는 SHA-256 hash만 저장(`core/tokens.ts:92-99`, 테이블 `refresh_tokens`).
- refresh할 때마다 새 토큰 발급, 이전 토큰은 `used_at` 기록. 7일(`auth-service.ts:84`).
- 이미 쓴 토큰이 다시 오면 탈취로 보고 그 session 전체 revoke + 해당 session의 WebSocket 연결 종료.
- 동시 refresh 경쟁은 `SELECT ... FOR UPDATE`로 막음.
- 위치: `auth-service.ts:244-275`, `repositories/auth-repository.ts:116-135`, `app.ts:127-135`(WS close), route `auth-routes.ts:192-227`

## 4. 2FA (TOTP)
- 표준 TOTP: HMAC-SHA1, 6자리, 30초, 앞뒤 1 step 허용. 같은 step 코드 재사용 차단(`lastUsedStep`). `core/totp.ts:4-5`, `:76-89`
- TOTP secret은 AES-256-GCM으로 암호화 저장. 키는 `TWO_FACTOR_KEY` env에서 HKDF-SHA256으로 유도, IV 12 bytes 랜덤. `core/secret-box.ts:17-44`. 키 없으면 2FA route 503(`app.ts:113-123`).
- 켜기: setup(`otpauthUrl`·secret 반환, 다시 호출하면 secret 바뀜) → 코드 1회 확인해야 enable → recovery code 10개(`ABCD-EFGH`) 발급, DB에는 SHA-256 hash, 한 번 쓰면 소진. `services/two-factor-service.ts:13-30`, `:88-162`, `repositories/two-factor-repository.ts:101-118`
- 로그인: 비밀번호 OK → 5분짜리 challenge 발급 → 코드 검증 후 토큰 발급. 5번 틀리면 challenge 폐기. `auth-service.ts:67-68`, `:124-139`, `:206-233`, route `api/two-factor-routes.ts:48-90`
- 시연: 휴대폰 OTP 앱에 secret 등록 → 로그아웃 → 로그인 시 코드 요구 확인.

## 5. 42 OAuth
- Authorization code flow, scope `public`. `core/oauth-42.ts:57-66`(authorize URL), `:76-110`(code 교환, `/v2/me`)
- CSRF 방지: `state`와 브라우저 쪽 `flowToken` 둘 다 32 bytes 랜덤, hash로 저장, 10분, 한 번만 사용(UPDATE 한 번으로 소진). `services/oauth-service.ts:17`, `:59-75`, `repositories/oauth-repository.ts:29-53`
- 처음 로그인이면 새 계정(`passwordHash: null`). 같은 이메일 로컬 계정이 있으면 자동 연결 안 함(`EMAIL_TAKEN`) → 계정 탈취 방지. 연결은 로그인한 상태에서 "계정 연결"로만. `oauth-service.ts:77-122`, `:173-213`
- OAuth 로그인도 2FA 켜져 있으면 2FA 거침(`oauth-service.ts:229`).
- 비밀값 `FT_OAUTH_*`는 env, 전부 있거나 전부 없어야 시작(`index.ts:24-38`).

## 6. DB와 ORM
- PostgreSQL 17 + Drizzle ORM. 스키마 `db/schema/users.ts`, `external-auth.ts`, `games.ts`. ER 다이어그램은 README `Database schema`(#118).
- 마이그레이션 `apps/server/drizzle/0000~0003`, 명령 `npm run db:generate`, `npm run db:migrate`(`package.json:15-16`, `config/drizzle.config.ts`). 컨테이너 기동 시 migrate 컨테이너가 먼저 실행.
- 상태값은 text + CHECK 제약(예: `oauth_states.mode`). 핵심 unique: `refresh_tokens.token_hash`, `oauth_accounts`(provider+providerUserId, user+provider).
- DB 연결 안 되면 서버 시작 시 `/api/health/db` 확인 후 안내(`index.ts:52-61`).

## 7. 입력 검증 (backend)
- Fastify JSON Schema, `additionalProperties: false`. 가입: email format·최대 254, password 8~128, nickname `^[\p{L}\p{N}_-]{2,32}$`. `api/auth-routes.ts:20-24`, `:49-52`, `:112-127`
- 이메일은 소문자로 정규화(`auth-service.ts:155`, `:185`).
- 검증 실패 → 422 `VALIDATION_ERROR`, 그 외 400/413/415 매핑(`app.ts:197-231`).
- frontend 검증 빈 곳은 #121(A)로 넘김.

## 8. 환경 변수와 비밀값
- `.env`, `.env.*`는 `.gitignore`(`:3-5`, `:15`), 예시 `.env.example`, `.env.full.example`만 커밋.
- `make`가 없는 비밀값만 생성: `JWT_SECRET`, `TWO_FACTOR_KEY`(`openssl rand -hex 32`), DB 비밀번호 파일, 자체 서명 인증서. 기존 값은 안 바꿈(`infra/prepare-full.sh`, #123).
- DB 비밀번호는 Docker secret 파일(`POSTGRES_PASSWORD_FILE`).

## 9. 통계·전적·리더보드
- 결과는 `game_players.result`(win/loss/draw, void 제외)에서 집계. 따로 카운터 테이블 없음 → 저장된 경기와 항상 일치. `repositories/stats-repository.ts:13-28`
- 승률 = wins / played(0판이면 0). 업적: 첫 승, 10판 진행도. `services/stats-service.ts:16-40`
- 전적: 끝난 경기만, 최신순, cursor(`before`) 페이지네이션. `stats-repository.ts:38-74`
- 리더보드: 승수 → 승률 → user id 순, 1판 이상만, `limit` 기본 10 최대 100. `stats-repository.ts:83-104`, `api/stats-routes.ts:198-248`
- #115: 전적 비공개(`records_public`) 시 403 `RECORDS_PRIVATE`, 탈퇴 사용자 리더보드 제외.
- 시연 데이터: `npm run demo:seed`(#120)로 실제 WebSocket 경기 15판 생성.

## 10. Rate limit, 상태 코드, Swagger
- 인증 관련 route에 IP당 1분 10회(`auth-routes.ts:75-76`): 가입, 로그인, refresh, 2FA verify/enable/disable, OAuth login/callback. 초과 → 429(`app.ts:212-216`). 프록시 뒤라 `TRUST_PROXY`로 실제 IP 사용.
- 모든 route가 상태 코드별 `schema.response` 선언 → Swagger `/docs`(`app.ts:256-266`), `Document/contracts.md`에도 기록.

## 11. 계정 삭제 (D 브랜치, merge 전)
- `DELETE /api/users/me` → 204. 비밀번호, 또는 2FA 코드, 또는 10분 내 로그인 필요(403 `RECENT_LOGIN_REQUIRED`). 진행 중 경기 있으면 409 `ACTIVE_MATCH`.
- 행은 지우지 않고 익명화: email/nickname `deleted:<id>`, 비밀번호·아바타 null, refresh token·OAuth·2FA 행 삭제, session revoke. 경기 기록 참조는 유지.
- 위치(D): `services/account-service.ts:48-100`, `repositories/account-repository.ts:33-92`
- 공개 프로필은 `id`, `nickname`, `avatarUrl`만, email 비노출(`api/user-routes.ts:17-25`).
