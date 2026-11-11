# 인증 웹 회귀 검증

## 범위

PR #55의 IF-02 토큰 보관을 확인한다. access token은 페이지 메모리에만 두고, refresh token은 로그인 유지 선택에 따라 `localStorage` 또는 `sessionStorage`에 보관한다. 이전 토큰 쌍은 refresh만 이전하며, 새로고침 뒤 서버 refresh로 access token을 복원한다.

동일 origin의 로그인 유지 탭은 Web Locks로 갱신을 직렬화한다. 로그인 표식은 회전 중 유지되고 새 로그인에서 바뀐다. 이전 계정 요청이나 늦은 응답이 새 계정 토큰을 사용·덮어쓰기·삭제하지 않는지도 단위 회귀로 확인한다.

## 실행

- 환경: macOS, Node.js 22.23.2, npm 10.9.8, PostgreSQL 17, Google Chrome 157.0.8103.50
- 기존 개발 DB와 분리된 단위 테스트 DB와 E2E DB를 사용한다. `TEST_DATABASE_URL`의 DB 이름은 `_test`로 끝나야 한다.
- 테스트 DB에서 migration을 적용한 뒤 실행한다. 실제 비밀번호와 환경 파일을 검증 기록에 포함하지 않는다.

```sh
TEST_DATABASE_URL='<단위 테스트 DB URL>' npm test
npm run build
DATABASE_URL='<E2E DB URL>' npm run db:migrate
DATABASE_URL='<E2E DB URL>' npm run test:e2e -- tests/auth.spec.ts --project=desktop --workers=1 --retries=0
DATABASE_URL='<E2E DB URL>' npm run test:e2e -- tests/auth.spec.ts --project=mobile --workers=1 --retries=0
```

서버에는 `JWT_SECRET`과 `TWO_FACTOR_KEY`도 설정한다. 인증 경로의 IP별 분당 제한을 유지하기 위해 두 브라우저 프로젝트는 각각 새 개발 서버에서 실행한다. 기본 Playwright 브라우저가 설치되지 않은 검증 환경에서는 임시 설정의 `use.channel`을 `chrome`으로 지정했다. 이 임시 설정은 제품 설정 변경에 포함하지 않는다.

## 시나리오와 증거 경계

- `apps/web/src/api/auth-storage.test.ts`: 토큰 보관·이전·저장소 접근 실패, 새로고침, 동시 갱신, 계정 전환과 늦은 응답 회귀
- `apps/web/src/api/auth-client.test.ts`: 기존 로그인·401 한 번 재시도·오류 응답 회귀
- `tests/auth.spec.ts`: 실제 HTTP API·PostgreSQL·Chrome으로 로그인 유지 선택 두 가지, 저장된 access token 부재, 새로고침, 로그아웃, 두 탭의 순차 수동 갱신 및 동시 새로고침, 이전 저장 형식의 두 탭 동시 이전을 확인한다. HTTP/WS 응답을 대체하지 않는다.

2026-11-12, master `6965b9c`를 병합한 최종 코드에서 다음 결과를 확인했다. 실행은 커밋 직전 동일 코드의 작업 트리에서 수행했으며 게시 기록에 최종 커밋을 연결한다.

| 실행                                             | 결과                                    |
| ------------------------------------------------ | --------------------------------------- |
| 전체 단위·PostgreSQL 회귀                        | 24파일·244개 통과, skip 없음            |
| 인증 클라이언트·저장소 회귀                      | 2파일·36개 통과(전체 회귀에 포함)       |
| 실제 Chrome E2E                                  | desktop 4개·mobile 4개 통과, retry 없음 |
| `npm run build`                                  | TypeScript 검사·Vite 빌드 통과          |
| 변경 코드·검증 문서 Prettier, `git diff --check` | 통과                                    |

독립 검토에서는 초기 복원 중 다른 탭의 회전과 세션 표식 경합을 재현한 뒤 수정 여부를 확인했다. 표식 없는 복원 중 로그아웃·새 로그인·늦은 성공·실패도 읽기 전용 동적 검사 20개에서 통과했다. 이는 전체 보안 감사나 아래 미검증 범위를 완료했다는 의미가 아니다.

## 남은 범위

Web Locks가 제공되는 Chrome의 HTTPS·localhost 환경을 대상으로 한다. Web Locks 미지원 환경의 공유 토큰 동시 갱신, 브라우저의 탭 복제·opener가 복사한 `sessionStorage` 간 동기화, 실제 42 OAuth·2FA 전체 흐름, 서로 다른 PC와 부하는 이 검증에 포함하지 않는다. 원격 HTTP origin에서는 Web Locks를 사용할 수 없으므로 HTTPS 실행 환경에서 최종 통합 검증이 필요하다.
