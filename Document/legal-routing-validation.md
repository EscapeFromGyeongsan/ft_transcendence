# 약관 라우팅 브라우저 회귀 검증

대상: `tests/legal-routing-regression.spec.ts`. 2026-11-12, #55 인증 수정과 #99·#100, #77의 탐색·푸터 수정을 통합한 작업본에서 검증했다.

## 검증 범위

실제 Vite 앱을 Playwright 브라우저에서 실행하되, `/api/` HTTP 요청과 `/api/ws` WebSocket 응답은 테스트에서 대체한다. 인증 복구·현재 사용자·활성 오목 대국 snapshot을 고정하여 화면 전환과 브라우저 history를 검사한다. Vite의 `/src/api/` 모듈 요청은 대체하지 않는다.

브라우저 저장소에는 `sessionStorage`의 `cbc.auth.refreshToken`만 넣는다. access token은 모형 refresh 응답에서 받으며, 이전 token pair 저장 형식은 사용하지 않는다. 이 테스트는 실제 인증 서버의 token 검증이나 실제 대국 서버·DB 연결을 증명하지 않는다.

| 사례                          | 확인 내용                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/terms` 직접 접근·새로고침   | 활성 대국 snapshot을 받아도 주소와 이용약관 화면 유지                                                                 |
| `/privacy` 직접 접근·새로고침 | 활성 대국 snapshot을 받아도 주소와 개인정보 화면 유지                                                                 |
| 대국 → 약관 → 개인정보        | 약관 열람 중 새 snapshot은 판 상태만 갱신하고, Back/Forward로 대국·약관·개인정보 복원. 대국 복귀 시 새 돌 확인        |
| 서로 다른 대국의 Back/Forward | 42 → 로비 → 43 → Back 42 → Forward 43에서 주소·판·구독을 함께 전환하고, 복원 후 착수 명령의 matchId·stateVersion 확인 |
| 360×800 개인정보 화면         | 문서의 가로 넘침이 없고 푸터 이용약관 링크를 일반 클릭으로 이동 가능                                                  |

기본 Playwright 설정의 `desktop`·`mobile` 프로젝트에서 각각 다섯 사례를 실행한다. 마지막 사례는 두 프로젝트 모두 화면을 360×800으로 고정한다. 모바일은 브라우저 장치 에뮬레이션이며 실제 휴대전화 검증은 포함하지 않는다.

## 실행 방법

저장소 루트에서 의존성과 Playwright Chromium이 준비되어 있어야 한다. 기본 E2E 설정이 API와 Vite를 함께 실행하므로 migration을 적용한 별도 로컬 테스트 DB도 필요하다. 개발·운영 DB를 사용하지 않는다.

```bash
DATABASE_URL='<격리 테스트 DB URL>' \
JWT_SECRET='<테스트용 32자 이상 문자열>' \
TWO_FACTOR_KEY='<테스트용 32자 이상 문자열>' \
PORT=5302 E2E_PORT=5374 CI=1 \
  npm run test:e2e -- tests/legal-routing-regression.spec.ts \
  --workers=1 --retries=0 --reporter=line --timeout=30000

npx vitest run --config=config/vitest.config.ts apps/web
npx tsc --noEmit
git diff --check
```

모바일 푸터 사례만 다시 실행할 때는 E2E 명령 뒤에 `--project=mobile --grep '360px'`를 추가한다. 설치된 Google Chrome을 사용하는 로컬 검증에서는 별도 설정에서 프로젝트의 `use.channel`을 `chrome`으로 지정하고, 실행 결과에 사용한 설정과 브라우저를 기록한다. 실패 trace는 `test-results/`에 남는다.

## 최종 통합 검증 결과

제품 코드 기준은 `47cf038`이다. 여기에 이 문서와 회귀 테스트만 추가했다. Node.js 22.23.2, PostgreSQL 17의 별도 테스트 DB를 사용했다.

| 항목                        | 결과                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 검증일·제품 코드            | 2026-11-12, `47cf038` (#55 `b431f05` 포함)                                                                                                      |
| 브라우저·실행 설정          | Google Chrome 157.0.8103.50, 로컬 `playwright.review.config.ts`의 `channel: "chrome"`; 프로젝트별 별도 서버, workers 1, retries 0, timeout 30초 |
| 법률 라우팅                 | desktop 5 + mobile 5 = 10개 통과                                                                                                                |
| 같은 통합본의 실제 인증 E2E | `tests/auth.spec.ts`: desktop 4 + mobile 4 = 8개 통과; 실제 API·PostgreSQL 사용                                                                 |
| 전체 단위·DB 테스트         | `TEST_DATABASE_URL=... npm test`: 28개 파일, 278개 통과, skip 0                                                                                 |
| 웹 단위 테스트              | 6개 파일, 70개 통과 (전체 278개에 포함)                                                                                                         |
| 타입 검사·빌드              | `npm run build`의 TypeScript·Vite 통과                                                                                                          |
| 형식·공백                   | 새 회귀 테스트 Prettier, `git diff --check` 통과                                                                                                |

대국 간 복원 회귀는 수정 전 popstate 동작에서 42번 재구독이 일어나지 않아 실패하고, 수정 후 두 프로젝트에서 통과함을 확인했다.

인증 E2E까지 함께 실행할 때는 위 명령에 `tests/auth.spec.ts`를 추가하고 `--project=desktop`, `--project=mobile`을 별도 실행했다. 로컬 Chrome 설정은 기본 설정을 가져와 프로젝트의 channel만 바꾸는 임시 파일이며 커밋하지 않는다.

개인정보의 탈퇴 설명은 #100의 #89 기준 문구를 보존했다. 현재 통합본에는 탈퇴 API #89와 화면 #85가 포함되지 않으므로, 배포 전에 이 기능들이 포함된 후보에서 정책과 실제 삭제 동작을 대조해야 한다.

실제 서버와 두 사용자 간 대국, 운영 환경의 HTTPS/WSS, 개인정보 문구와 삭제 기능의 동작 일치 여부는 이 브라우저 회귀의 범위 밖이다.
