import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { connectionProbe } from "./schema/connection-probe.ts";

export type Database = NodePgDatabase;
/**
 * 풀 기반 DB 또는 열린 트랜잭션입니다.
 *
 * @remarks
 * repository 함수가 이 타입을 받으므로 한 작업의 모든 단계가 같은 트랜잭션을 공유할 수 있습니다.
 */
export type Executor = Pick<
  Database,
  "select" | "insert" | "update" | "delete" | "execute"
>;

/**
 * PostgreSQL 연결 풀과 Drizzle 인스턴스를 만듭니다.
 *
 * @param onPoolError - 요청 밖에서 idle 연결이 오류를 낼 때 호출. 자격 증명·SQL을 기록하지 않도록 오류 객체를 넘기지 않습니다.
 *
 * @remarks
 * 풀 최대 5개, 연결 대기 3초, 쿼리 `statement_timeout` 3초입니다.
 * `check()`는 `connection_probe` 테이블을 읽으므로 migration 적용 여부도 함께 확인합니다.
 */
export function createDatabase(
  connectionString: string,
  onPoolError: () => void = () => {
    console.error("Database pool connection lost.");
  },
) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 3000,
  });
  // Idle clients can emit errors outside a request. Never log credentials/SQL.
  pool.on("error", onPoolError);
  const db = drizzle(pool);

  return {
    db,
    async check() {
      // An empty result is healthy: this also checks that migration was applied.
      await db
        .select({ id: connectionProbe.id })
        .from(connectionProbe)
        .limit(1);
    },
    close: () => pool.end(),
  };
}
