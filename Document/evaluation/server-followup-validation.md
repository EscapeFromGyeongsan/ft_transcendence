# 서버 평가 후속 검증 (2026-11-13)

- 관련: #132, #133, #88, #120. 기준 후보는 #145 `b9112b8406061faf60ab11f87f50f4b6eba644ab`이다.
- B의 #133 HEAD `4b8a3bb54088ba43d3383bf1de7a51db9f68a9bd`를 이력 보존 merge `b390c3507e21fa1834157d6f1e123b174116d27a`로 합쳤다. 기존 contracts의 본문 해석 규칙과 친구 응답 Swagger 설명을 유지해 충돌을 해결했다. #144의 비공개 `oauth42Linked` 계약도 유지했다.
- 최종 제품 코드와 회귀 테스트: `5eb78e9e536a5ff704ba76fb9d7ed15a29edf158`. 뒤의 검증 문서·JSON 커밋은 제품 코드를 바꾸지 않는다.
- [구조화된 결과](server-followup-evidence.json). 아래 테스트는 Windows, Node.js 26.13.0/npm 11.20.0, PostgreSQL 17.11에서 실행했다. 테스트용 새 PostgreSQL 인스턴스(loopback 55433, UTF8, locale C)와 DB를 사용했으며 기존 개발·배포 DB에 적용하지 않았다.

## 발견한 업그레이드 결함과 수정

새 DB에서 새 입력끼리 비교하는 #133의 테스트는 통과하지만, 기존 데이터의 정규화 형태는 바뀌지 않는다. 기존 `0006`까지의 API(#145)에서 분해형 `가나`로 가입하면 201이고, #133의 `0007`을 적용한 뒤 다른 이메일로 조합형 `가나`를 가입해도 201이다. `lower(nickname)` index는 두 저장값을 서로 다른 이름으로 허용한다. 별도 업그레이드 DB에서 이전·새 API를 차례로 실행해 재현했다.

후속 `0008_normalized_nickname.sql`은 `users_nickname_unique`를 `lower(normalize(nickname, NFC))` UNIQUE index로 교체한다. 기존 migration은 고치지 않았으며 Drizzle 스키마·snapshot·journal도 함께 생성했다. 새 입력의 NFC 저장과 기존 409 `NICKNAME_TAKEN` 분기를 그대로 사용한다. 기존 사용자 행·로그인 수단·닉네임·경기 스냅샷을 개명하거나 삭제하지 않는다. SQL의 대소문자 비교는 DB locale의 `lower` 규칙을 따른다.

이미 충돌하는 두 계정이 있는 DB에서는 UNIQUE index 생성이 실패한다. 이는 자동으로 사용자 데이터를 고르는 처리로 우회하지 않는다. 실제 Drizzle migration 실패 후 두 계정, 기존 index와 migration journal이 유지되는 것을 확인했다. 배포 담당자는 #96의 migration 순서를 확정하고 적용 전에 다음과 같은 충돌 조회를 수행해야 한다.

```sql
SELECT lower(normalize(nickname, NFC)) AS comparison_key,
       array_agg(id ORDER BY id) AS user_ids
FROM users
GROUP BY lower(normalize(nickname, NFC))
HAVING count(*) > 1;
```

결과가 있으면 담당자의 사용자 식별·닉네임 처리 결정을 먼저 해야 한다. 충돌한 사용자 중 누구를 유지하거나 개명할지는 이 변경이 결정하지 않는다.

## 실행한 테스트

1. #133을 합친 `b390c35`에서 새 API 회귀 테스트 두 개를 먼저 실행했다. 기존 NFD 닉네임과 같은 NFC 이름으로 **가입과 프로필 수정이 모두 성공해**, 기대한 409와 달라 두 테스트가 실패했다. `-t '#133 upgrade'`로 선택한 결과이며 다른 테스트의 필터링은 전체 시험 결과와 구분했다.
2. 수정 후 관련 API·migration 테스트 24개가 통과했다. SQL migration은 임시 스키마에서 기존 unique constraint → `0007` → `0008` 순서로 실행하며 공유 테스트 표를 건드리지 않는다. 기존 닉네임 보존과 이미 충돌하는 경우의 실패·롤백도 확인한다.
3. 깨끗한 별도 DB에서 `0000`~`0008`을 적용하고 전체 **47 files / 535 passed / 0 failed / 0 skipped**를 확인했다. 앞선 실패 재현이 중복 계정을 남긴 DB는 유지하고 별도 DB를 만들었다.
4. 실제 이전 API로 단일 NFD 계정을 만든 새 DB를 `0008`까지 올렸다. 동일 이름의 새 가입은 **409 `NICKNAME_TAKEN`**, 기존 계정 로그인은 **200**, 기존 ID와 저장된 닉네임은 같았다.
5. `npm run build`의 TypeScript·Vite 빌드가 통과했다. 최종 스키마로 Drizzle generate를 다시 실행한 결과 `No schema changes, nothing to migrate`였다.

```text
npm test -- apps/server/src/api/auth-routes.test.ts apps/server/src/api/user-routes.test.ts apps/server/src/db/nickname-migration.test.ts
npm test
npm run build
npm run db:generate -- --name=normalized_nickname_check
```

DB 테스트에는 `TEST_DATABASE_URL`을 별도 `_test` DB로 지정해야 한다. `db:generate`에는 `DATABASE_URL`도 지정했다. OAuth 테스트는 가짜 제공자와 실제 PostgreSQL을 사용하며, 실제 42 계정의 브라우저 인증을 검증한 결과로 세지 않는다.

## #120 데모 스크립트 검증

원본 HEAD `12af5a9408d2cf7550afd12c9b760e92f40a6820`의 `scripts/seed-demo.mjs`를 그대로 꺼내 실행했다. 실행 파일과 원본 git blob은 모두 `08202483bd2216d9ef0eac898a7af0f20fc5acf7`이다. 이 후속 브랜치에는 #120의 npm 명령이나 스크립트를 병합하지 않았다.

위 제품 코드의 두 게임 엔진을 등록한 실제 Fastify HTTPS/WSS 서버와 별도 DB를 사용했다. `DEMO_BASE_URL=https://127.0.0.1:31433`, 별도 `DEMO_PASSWORD`, `NODE_EXTRA_CA_CERTS=<테스트 인증서>`를 지정하고 `node .validation/demo-seed-120.mjs`로 실행했다. TLS 검증을 끄지 않았다. Nginx/컨테이너가 아닌 native HTTPS이며, 브라우저가 없는 Node 클라이언트 검증이다.

- 종료 코드 0; 오목 12판(오목 완성 11, 기권 1)·오델로 3판(돌 수 판정) 모두 종료.
- DB 집계에서 15판 모두 `finished`; 미완료 경기 없음.
- 출력 리더보드와 실제 stats API에서 Alice의 오목 10판·7승·승률 0.7을 확인.
- 실제 stats 응답의 `achievements.firstWin=true`, `progress.current=10`, `progress.target=10` 확인.
- 원본 스크립트의 반복 실행은 경기를 더 만든다. 이번 검증은 새 DB에서 한 번 실행한 결과이며 기존 데이터 보존·반복 실행·장애 복구 시험을 뜻하지 않는다.

## 후속 상태

#133의 정상 새 DB 수정은 이력과 함께 통합했고, 기존 DB 업그레이드 결함의 후속안을 준비했다. Schema/Auth/Contract 변경이므로 B의 검토가 필요하다. #132의 전체 종료, master 병합·배포, #88의 전체 브라우저 수용·독립 재현 완료를 선언하지 않는다. Docker/Nginx와 실제 42 제공자, 전체 브라우저 시험은 이번 변경에서 다시 실행하지 않았다.
