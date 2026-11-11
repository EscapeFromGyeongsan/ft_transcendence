# 2026-11-01 WSS 검증 증빙

## 최초 실행

- [wss-results.json](wss-results.json): WSS 기능 검사 14개 통과, 정상 idle 연결 약 85초.
- [heartbeat-timing.json](heartbeat-timing.json): 자동 pong을 끈 독립 연결이 30,002ms에 종료. 20초 목표 차이.
- 기존 테스트: 17개 파일·162개 통과. 최초 원시 로그는 로컬 증빙에 남겼으며 JSON은 비밀값 없이 보존했습니다.
- 대상 커밋과 연결 범위: [재현 안내](../../runtime-wss-validation.md).
- 최초 결과의 GitHub 게시: [#28](https://github.com/EscapeFromGyeongsan/ft_transcendence/issues/28#issuecomment-6552328302), [#50](https://github.com/EscapeFromGyeongsan/ft_transcendence/pull/50#issuecomment-6552329811).

## 팀원용 한 명령 재현

스크립트 자체의 실행 검증 결과는 reproduction-summary.json, reproduction-wss-results.json, reproduction-heartbeat-timing.json에 별도 저장합니다. 이 재현도 동일 작성자/에이전트 환경에서 수행하며 비작성자 재현을 대신하지 않습니다.

실행 명령:

```sh
bash scripts/check-wss-runtime.sh
```

전체 실행 소스는 고정 기준 커밋과 검증 fixture로 재구성하며, 팀원이 작성자의 /tmp 디렉터리나 소스 tar 파일에 접근할 필요가 없습니다.
