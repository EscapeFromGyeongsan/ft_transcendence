# NFR-PERF-01 측정 기록

DEC-10 승인 전이라 합격 판정 없이 수치만 기록한다. 측정 도구와 절차는 `scripts/measure-perf.mjs`(`npm run test:perf`)를 따른다.

## 2026-11-13, master `531f8a1`

- 환경: `infra/compose.full.yaml` 전체 컨테이너(Nginx HTTPS/WSS, API, PostgreSQL 17), 자체 서명 인증서, 같은 장비 loopback(`https://localhost:8643`)
- 장비: Apple M2 8코어, 16 GiB, macOS(darwin 27.0.0 arm64), Node v24.3.0
- 부하: SRS 제안 기본값, 20명, 오목 10경기 동시, 300초, 착수 간격 1초, REST 간격 1초
- 측정 스크립트 커밋 `8fd513e`, 시간 2026-11-13 02:47:26~02:52:27 UTC
- 원본: [`nfr-perf-01-531f8a1.json`](nfr-perf-01-531f8a1.json)

| 지표 | 표본 | p50 | p95 | max (ms) |
|---|---|---|---|---|
| `GET /api/users/me` | 1500 | 4.8 | 14.4 | 58.5 |
| `GET /api/users/:userId` | 1500 | 4.6 | 10.6 | 35.1 |
| `GET /api/users/:userId/stats` | 1480 | 7.0 | 20.7 | 121.5 |
| `GET /api/leaderboard` | 1480 | 6.1 | 14.4 | 23.5 |
| `queue.join` → `queue.matched` | 68 | 3.3 | 35.6 | 36.0 |
| `game.command` → `game.ack` | 2893 | 7.7 | 15.3 | 44.1 |
| `game.command` → 상대 `game.updated` | 2893 | 9.9 | 17.6 | 66.8 |

- 실패 0. 측정 뒤 DB의 경기 34개 모두 `finished`, `playing`·`paused`로 남은 경기 없음.
- 마지막 지표는 같은 측정 프로세스에서 잰 발신부터 상대 수신까지의 종단 지연이다. 서버 확정 이후만의 전달 지연과 다르다(SDS 4.3).
- loopback 측정이라 실제 네트워크 RTT·손실은 포함하지 않는다.
