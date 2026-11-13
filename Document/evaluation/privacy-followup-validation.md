# 개인정보 고지 후속 검증 (2026-11-13)

- 기준 후보: #144 `c4ef0e4968b06cbe3f7d60db8e75b65f48bdf34f`.
- 병합한 B 수정: #117 `3b8061272a9353c441b778276ea9c6181c140d1c`, #127 `e140ab9fb0ebe9ccf2573ea6dcf64f050374eaca`.
- 검증한 제품 코드: `a41418d091a68452e8c458257981580304b09054` (위 두 이력을 보존한 merge commit).
- 관련: #64, #111, #71. 이 문서는 고지 문구와 화면 검증 기록이며, 배포 완료 또는 전체 개인정보 요구사항 승인 기록이 아니다.

## 실제 코드와 대조한 내용

| 고지 | 확인한 구현 |
| --- | --- |
| 비밀번호 8~128자 | `apps/server/src/api/auth-routes.ts`의 가입 스키마 |
| 첫 42 가입의 이메일 저장·로그인 아이디로 닉네임 결정, 액세스 토큰 미보관 | `apps/server/src/services/oauth-service.ts` |
| 로그인 시점부터 7일인 세션 만료, 회전 시 미연장 | `apps/server/src/services/auth-service.ts`의 세션 생성·`refresh`와 기본 설정 |
| 로그아웃은 세션을 revoke하며 세션 행·리프레시 토큰 해시는 남음 | 같은 파일의 `logout`, `repositories/auth-repository.ts`의 `revokeSession` |
| 아바타 파일 삭제 실패를 무시하며 남은 파일은 기존 URL로 조회 가능 | `services/avatar-service.ts`의 `removeQuietly`, `removeFile`, `read` |
| 탈퇴 시 본인 확인·미완료 경기 거절, 인증 자료·친구 관계 삭제, 세션 행과 사용자 행 보존 | `services/account-service.ts`, `repositories/account-repository.ts`, `db/schema/users.ts` |
| 전적은 경기 당시 닉네임 뒤에 탈퇴 표시를 붙이고 프로필 링크를 제공하지 않음 | `apps/web/src/profile/account-deletion.ts`의 `describeOpponent` |

기존 통합 후보의 상세 탈퇴 설명과 전적 비공개 설명을 유지했다. 친구 관계 삭제, 남는 세션 필드, 닉네임 표시를 보완했고, 사용자 행의 이메일·닉네임을 치환해도 과거 닉네임이 전적에 남는다는 점을 명확히 했다. 서버의 삭제·인증 동작과 DB 스키마는 변경하지 않았다.

## 실행 결과

환경: Windows, Node.js 26.13.0, npm 11.20.0, Chrome 158.0.8127.37. 새 worktree에서 `npm ci --no-audit --no-fund` 후 실행했다.

```text
npm test -- apps/web/src/legal/legal-routing.test.ts apps/web/src/profile/account-deletion.test.ts
  2 files, 28 passed, 0 failed/skipped
npm run build
  TypeScript + Vite build passed
node node_modules/@playwright/test/cli.js test --config=.validation/playwright.config.ts tests/legal.spec.ts --grep "legal pages support|signup policy links" --reporter=line
  6 passed, 0 failed/skipped/retried
```

브라우저는 실제 production build의 HTTPS preview(`127.0.0.1:54464`)를 사용했다. 로컬 설정은 설치된 Chrome과 인증서 SPKI pin을 지정했으며 `ignoreHTTPSErrors: false`였다. 뷰포트는 desktop 1440×900, tablet 768×1024, mobile 360×800이다. 기존 두 시나리오는 직접 접근·새로고침·Back/Forward·404 복구, 미완료 가입 폼의 정책 페이지 왕복을 각 크기에서 검증했다. API/DB를 시작하거나 응답을 mock하지 않았으며 로그인·탈퇴 요청 자체는 이번 화면 검사에 포함하지 않았다.

추가 브라우저 점검 3/3 통과: `/privacy` 직접 접근, OAuth 수집 설명, 로그아웃/세션 만료, 아바타 삭제 실패, 탈퇴/닉네임 보존 문구, 문의 주소, 키보드 문서 탭 전환, `/terms`의 비밀번호 길이, 브라우저 Back을 각 크기에서 확인했다. 가로 넘침과 콘솔/페이지 오류는 모두 0이었다. 최초 sandbox 실행에서는 기존 Google Fonts 요청이 `ERR_NETWORK_ACCESS_DENIED`로 차단되어 오류 없는 결과로 세지 않았고, 네트워크 허용 실행에서 다시 확인했다.

- [점검 결과 JSON](privacy-followup-evidence/summary.json)
- [데스크톱 캡처](privacy-followup-evidence/desktop-privacy.png)
- [태블릿 캡처](privacy-followup-evidence/tablet-privacy.png)
- [모바일 캡처](privacy-followup-evidence/mobile-privacy.png)

동일한 기존 브라우저 시나리오는 접근 가능한 실행 서버를 준비한 뒤 `E2E_BASE_URL`을 지정하고 `npm run test:e2e -- tests/legal.spec.ts --grep "legal pages support|signup policy links"`로 재현할 수 있다. 저장소 기본 설정은 desktop/mobile 두 프로젝트이며 이번 로컬 설정은 tablet을 추가했다. 자체 인증서를 쓸 때는 브라우저의 신뢰 설정도 별도로 준비해야 한다.

## 남은 확인

- 비작성자 리뷰 및 #143 → #144 → 후속 PR의 통합/배포 순서 확정.
- 실제 배포 환경의 개인정보 문의 주소와 시행일 최종 확인.
- 아바타 파일 삭제 실패 시 잔존 파일을 확실히 제거하는 서버 개선은 이 문구 수정에 포함하지 않는다. 파일이 반드시 즉시 사라진다고 고지하지 않았다.
- 전체 브라우저 수용 시험, 실제 42 제공자, Docker/Nginx 및 독립 재현은 이번 변경으로 재검증하지 않았다. #143/#144의 기존 결과와 미완료 항목을 그대로 참조한다.
