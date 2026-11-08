# Nginx 경유 WSS 검증과 재현

검증 대상: #28 / PR #40 실행 환경. 실행일: 2026-11-01 KST.

## 현재 결과

- 실제 Nginx를 경유한 WSS 기능 검사 **14개 통과**.
- 별도 테스트 DB의 기존 테스트 **17개 파일·162개 통과**, 타입 검사·웹 빌드 통과.
- 앱 메시지를 보내지 않은 정상 WSS가 **85초** 유지되고 서버 ping 8회 수신.
- 실제 오목 엔진으로 매칭·착수·snapshot·중복 명령·버전 충돌·재접속·이탈 종료 검증.
- 무응답 감지는 **약 30초**에 발생해 20초 목표와 차이가 남음. [#50에 보고](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/50#issuecomment-6552329811).
- B의 리뷰 및 작성자 외 재현은 대기. 실제 브라우저·두 PC 인수는 별도.

이 문서는 실행 환경 검증을 기록합니다. PR #40 단독 브랜치에 게임·실시간 기능이 모두 포함됐다는 의미는 아닙니다.

## 한 명령 재현

필요 도구: Linux/WSL의 Bash, Git, Docker Engine와 Compose v2+, 호스트 Node.js 22+, Python 3.12+, OpenSSL. Docker 데몬 접근 권한과 첫 이미지/패키지 빌드의 네트워크 접근이 필요합니다.

저장소를 정상 clone했다면 아래 명령으로 시작합니다.

```sh
bash scripts/check-wss-runtime.sh
```

얕은 clone 등으로 고정 기준 커밋이 없으면 스크립트가 명령을 안내하고 종료합니다. 먼저 다음 브랜치를 가져온 후 재실행합니다.

```sh
git fetch origin codex/runtime-issue-28-validation
bash scripts/check-wss-runtime.sh
```

스크립트는 Git fetch·checkout·reset을 실행하지 않습니다. 기존 작업 디렉터리를 수정하지 않고 Git 객체에서 소스를 읽어 새 /tmp 디렉터리에 복원합니다. 새 DB·volume·프로젝트 이름·loopback 포트·JWT·비밀번호·인증서를 생성합니다. 현재 .env나 기존 개발 계정은 읽지 않습니다.

인증서는 SAN localhost/127.0.0.1을 가지며 클라이언트가 해당 인증서를 명시적으로 신뢰합니다. TLS 검증은 켜져 있습니다. API는 일반 사용자 uid 1000(node)로 실행하고, 테스트 프로세스만 테스트 도구의 쓰기 권한 때문에 root로 실행합니다.

스크립트는 완료·실패 시 검증용 Compose의 컨테이너·volume·네트워크·이미지 태그와 임시 비밀값을 정리합니다. 명령 마지막에 비밀값을 제외한 결과 디렉터리를 출력합니다. Docker 정리가 실패하면 종료 코드 1과 cleanup.log 위치를 출력합니다.

## 결과 해석

실행에는 이미지 빌드와 실제 기본 시간 설정을 사용한 검사 시간이 포함됩니다. WSS 정상 유지 검사만 최소 85초이며 시간을 줄이지 않습니다.

- 종료 코드 0: 실행과 결과 수집 완료.
- summary.json의 status=pass: 기능 검사 및 heartbeat 시간 목표 통과.
- summary.json의 status=follow_up_required: 기능 검사는 통과했지만 heartbeat 시간 목표 차이 존재.
- 그 외 명령 실패는 종료 코드가 0이 아니며 남은 로그 디렉터리를 확인합니다.

**종료 코드 0만으로 전체 수용 기준 통과로 해석하지 않습니다.** 현재 고정 소스는 20초 목표와 약 30초 감지 차이가 있어 follow_up_required가 예상됩니다. 시간 측정에는 1초의 클라이언트 측 허용 오차를 둡니다. 40초 watchdog이 발동하거나 인증/close code가 잘못되면 검사 자체가 실패합니다.

| 파일                  | 내용                                          |
| --------------------- | --------------------------------------------- |
| summary.json          | 테스트 수와 기능 검사 수, 감지 시간 목표 판정 |
| wss-results.json      | 14개 기능 검사와 서버 이벤트·최종 snapshot    |
| heartbeat-timing.json | 독립 무응답 측정, 20초 목표와 비교            |
| persisted-game.txt    | 실제 DB의 경기 결과·버전·착수                 |
| unit-check.log        | 별도 테스트 DB의 Vitest 실행 결과             |
| compose-up.log        | 실제 Compose 기동·타입 검사·웹 빌드           |
| nginx-effective.conf  | 실제 적용된 Nginx upgrade·75초 timeout 설정   |
| source-manifest.json  | 고정 커밋·검증 패치·복원 파일의 해시          |
| cleanup.log           | 검증용 자원 정리 결과                         |

## 고정 소스와 패치 범위

| 소스                            | 커밋                                     |
| ------------------------------- | ---------------------------------------- |
| 실행 설정 PR #40                | 341c851e5c41d15c5a309444230ffb6288af6501 |
| 기존 통합 기준(#10/#11/#15/#40) | 9b5e7c7113531a126c4bc626bda72b67b6712d1a |
| 실시간 PR #50 및 그 선행 구현   | 3dd6be23aa5d258f67293a0b8f4e438f8680d4de |
| 실제 오목 엔진 PR #45           | 6538712f6f41154c77b7d77ea512f074b4a8cbba |

검증용 [source-overlay.patch](../scripts/wss-validation/source-overlay.patch)는 기존 통합 기준에 #50의 변경 파일 25개와 #45 엔진 소스 7개를 연결합니다. 이 중 index.ts는 readListenOptions와 실제 엔진의 buildApp 6번째 인자 등록을 함께 유지하고, package-lock.json에는 엔진 workspace 링크를 추가합니다. 별도 소스 압축본 없이 고정 기준 커밋과 텍스트 패치로 복원합니다.

이 패치는 검증 fixture이며 다른 담당자의 코드가 현재 앱 실행 경로에 병합되는 변경이 아닙니다. 정식 통합은 #27에서 진행합니다. [manifest](../scripts/wss-validation/source-manifest.json)의 SHA-256으로 텍스트 패치와 복원 소스 **135개 파일 전체**를 검사합니다. 불일치 시 Docker 기동 전에 종료합니다. PR head가 갱신돼도 이 기록의 고정 소스는 바뀌지 않습니다.

## 보존한 검증 기록

[2026-11-01 증빙](runtime-evidence/2026-11-01-wss/README.md)에 최초 실행과 팀원용 명령 재현 결과를 구분해 보관합니다.

최초 실행 환경은 Docker 29.6.2 / Compose 5.3.1 / API Node.js 24.22.2 / npm 11.19.1 / Nginx 1.28.3 / PostgreSQL 17.11입니다.

확인한 흐름은 HTTPS 가입·로그인, WSS 101/인증/오류 코드, 실제 오목 매칭·구독·착수, 양쪽 같은 snapshot, 중복 명령, VERSION_CONFLICT 후 복구, 무응답 종료, 재인증·재구독, 누적 이탈 예산 보존, disconnect_timeout 결과 저장, 정상 idle 연결 85초 유지, 로그아웃에 따른 열린 연결 종료·폐기 토큰 거절입니다.

## B 리뷰와 후속 인수

B는 #40의 JWT·선택 OAuth/2FA 환경 전달, TRUST_PROXY와 전달 IP 교체, API 사용자/아바타 volume 권한을 검토하고 위 명령을 새 환경에서 재현합니다. 실제 실행 커밋과 환경, summary.json 및 실패 로그 여부를 리뷰에 기록합니다.

다음 항목은 별도로 남습니다.

- D: #50의 기본 무응답 감지 최대 시간에 대한 구현/계약 정리.
- B·D: 이탈 시 paused 저장, refresh 재사용으로 세션 폐기 시 소켓 알림 연결.
- #27 통합: listen 옵션, 인증·아바타 설정, 재시작 무효 처리와 실제 엔진 등록 보존.
- 실제 브라우저·다른 PC 두 대·공인 인증서와 실제 OAuth 제공자 인수.

#28의 [게시된 결과](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/28#issuecomment-6552328302)와 #50의 확인 요청을 함께 추적합니다.

검증 연결·스크립트·문서 정리에 Codex의 도움을 받았습니다.
