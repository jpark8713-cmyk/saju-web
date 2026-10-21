// SQLite 저장소 (사업자 결정 2026-10-21, D-030). Node 내장 node:sqlite를 쓴다(추가 의존성 없음).
// 한 서버에서 웹 서버와 관리 스크립트가 같은 파일을 쓴다(WAL 모드). 모든 쿼리는 동기라 갱신 함수 안의 확인과 저장이 끼어들기 없이 한 번에 일어난다.
// 발급 기록은 DB 트리거로도 고치기·지우기·덮어쓰기(INSERT OR REPLACE)를 막고, 사건은 별도 표에 덧붙이기만 한다(D-031).
// 관리형 PostgreSQL로 옮길 때는 같은 Store 인터페이스로 구현을 하나 더 만든다(옮기는 기준: Docs/deploy.md).
import { DatabaseSync } from 'node:sqlite';
import {
  IssuanceImmutable,
  type DeliveryLog,
  type DeliveryState,
  type DownloadToken,
  type IssuanceEventType,
  type IssuanceRecord,
  type Order,
  type RefundRequest,
  type RefundStatus,
  type Report,
  type Store,
} from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS reports (
  order_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS issuances (
  order_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS issuance_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES issuances(order_id),
  type TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS download_tokens (
  token_hash TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS download_tokens_order ON download_tokens(order_id);
CREATE TABLE IF NOT EXISTS delivery_logs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS delivery_logs_order ON delivery_logs(order_id);
CREATE TRIGGER IF NOT EXISTS issuances_no_update BEFORE UPDATE ON issuances BEGIN SELECT RAISE(ABORT, 'issuance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS issuances_no_replace BEFORE INSERT ON issuances WHEN EXISTS (SELECT 1 FROM issuances WHERE order_id = NEW.order_id) BEGIN SELECT RAISE(ABORT, 'issuance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS issuance_events_no_replace BEFORE INSERT ON issuance_events WHEN NEW.seq IS NOT NULL AND EXISTS (SELECT 1 FROM issuance_events WHERE seq = NEW.seq) BEGIN SELECT RAISE(ABORT, 'issuance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS issuances_no_delete BEFORE DELETE ON issuances BEGIN SELECT RAISE(ABORT, 'issuance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS issuance_events_no_update BEFORE UPDATE ON issuance_events BEGIN SELECT RAISE(ABORT, 'issuance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS issuance_events_no_delete BEFORE DELETE ON issuance_events BEGIN SELECT RAISE(ABORT, 'issuance is immutable'); END;
`;

type Row = Record<string, unknown>;
const parse = <T>(row: Row | undefined): T | null => (row ? (JSON.parse(String(row.data)) as T) : null);

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(readonly path: string) {
    this.db = new DatabaseSync(path);
    // 쓰기 잠금을 기다리는 시간(관리 스크립트와 웹 서버가 동시에 쓸 때)
    // recursive_triggers: REPLACE가 지우는 행에도 삭제 트리거가 돌게 한다(덮어쓰기 차단을 한 겹 더)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA recursive_triggers = ON;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** 백업용 (src/store/backup.ts) */
  get handle(): DatabaseSync {
    return this.db;
  }

  /** 동기 작업을 쓰기 트랜잭션으로 묶는다 */
  private tx<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = work();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async createOrder(order: Order): Promise<void> {
    this.db.prepare('INSERT INTO orders (id, status, data) VALUES (?, ?, ?)').run(order.id, order.status, JSON.stringify(order));
  }

  async getOrder(id: string): Promise<Order | null> {
    return parse<Order>(this.db.prepare('SELECT data FROM orders WHERE id = ?').get(id) as Row | undefined);
  }

  async updateOrder(id: string, update: (o: Order) => Order): Promise<Order | null> {
    return this.tx(() => {
      const current = parse<Order>(this.db.prepare('SELECT data FROM orders WHERE id = ?').get(id) as Row | undefined);
      if (!current) return null;
      const next = update(current);
      this.db.prepare('UPDATE orders SET status = ?, data = ? WHERE id = ?').run(next.status, JSON.stringify(next), id);
      return structuredClone(next);
    });
  }

  async listOrdersByStatus(status: Order['status']): Promise<Order[]> {
    return (this.db.prepare('SELECT data FROM orders WHERE status = ?').all(status) as Row[]).map((r) => parse<Order>(r)!);
  }

  async saveReport(report: Report): Promise<void> {
    this.db.prepare('INSERT INTO reports (order_id, data) VALUES (?, ?) ON CONFLICT(order_id) DO UPDATE SET data = excluded.data').run(report.orderId, JSON.stringify(report));
  }

  async getReport(orderId: string): Promise<Report | null> {
    return parse<Report>(this.db.prepare('SELECT data FROM reports WHERE order_id = ?').get(orderId) as Row | undefined);
  }

  async deleteReport(orderId: string): Promise<void> {
    this.db.prepare('DELETE FROM reports WHERE order_id = ?').run(orderId);
  }

  async listOrdersToPurge(now: Date): Promise<Order[]> {
    const rows = this.db
      .prepare(
        `SELECT data FROM orders o WHERE json_extract(data, '$.delivery.expiresAt') IS NOT NULL AND json_extract(data, '$.delivery.expiresAt') <= ?
           AND (json_extract(data, '$.delivery.purgedAt') IS NULL OR json_extract(data, '$.email') IS NOT NULL
                OR json_extract(data, '$.pendingBirth') IS NOT NULL OR EXISTS (SELECT 1 FROM reports r WHERE r.order_id = o.id))`,
      )
      .all(now.toISOString()) as Row[];
    return rows.map((r) => parse<Order>(r)!);
  }

  async listOrdersWithEmailStatus(status: DeliveryState['email']['status']): Promise<Order[]> {
    return (this.db.prepare("SELECT data FROM orders WHERE json_extract(data, '$.delivery.email.status') = ?").all(status) as Row[]).map((r) => parse<Order>(r)!);
  }

  async createDownloadToken(token: DownloadToken): Promise<void> {
    this.db.prepare('INSERT INTO download_tokens (token_hash, order_id, data) VALUES (?, ?, ?)').run(token.tokenHash, token.orderId, JSON.stringify(token));
  }

  async findDownloadToken(tokenHash: string): Promise<DownloadToken | null> {
    return parse<DownloadToken>(this.db.prepare('SELECT data FROM download_tokens WHERE token_hash = ?').get(tokenHash) as Row | undefined);
  }

  async revokeDownloadTokens(orderId: string, at: string, exceptHash?: string): Promise<number> {
    return this.tx(() => {
      const rows = this.db.prepare('SELECT token_hash, data FROM download_tokens WHERE order_id = ?').all(orderId) as Row[];
      let n = 0;
      for (const r of rows) {
        const t = parse<DownloadToken>(r)!;
        if (t.revokedAt || String(r.token_hash) === exceptHash) continue;
        this.db.prepare('UPDATE download_tokens SET data = ? WHERE token_hash = ?').run(JSON.stringify({ ...t, revokedAt: at }), String(r.token_hash));
        n += 1;
      }
      return n;
    });
  }

  async revokeDownloadToken(tokenHash: string, at: string): Promise<void> {
    this.tx(() => {
      const t = parse<DownloadToken>(this.db.prepare('SELECT data FROM download_tokens WHERE token_hash = ?').get(tokenHash) as Row | undefined);
      if (t && !t.revokedAt) this.db.prepare('UPDATE download_tokens SET data = ? WHERE token_hash = ?').run(JSON.stringify({ ...t, revokedAt: at }), tokenHash);
    });
  }

  async listUnfinishedOrdersWithEmail(createdBefore: Date): Promise<Order[]> {
    const rows = this.db
      .prepare("SELECT data FROM orders WHERE status <> 'done' AND json_extract(data, '$.email') IS NOT NULL AND json_extract(data, '$.email') <> '' AND json_extract(data, '$.createdAt') <= ?")
      .all(createdBefore.toISOString()) as Row[];
    return rows.map((r) => parse<Order>(r)!);
  }

  async appendDeliveryLog(log: DeliveryLog): Promise<void> {
    this.db.prepare('INSERT INTO delivery_logs (order_id, data) VALUES (?, ?)').run(log.orderId, JSON.stringify(log));
  }

  async listDeliveryLogs(orderId: string): Promise<DeliveryLog[]> {
    return (this.db.prepare('SELECT data FROM delivery_logs WHERE order_id = ? ORDER BY seq').all(orderId) as Row[]).map((r) => parse<DeliveryLog>(r)!);
  }

  async findRefundByOrder(orderId: string): Promise<RefundRequest | null> {
    return parse<RefundRequest>(this.db.prepare('SELECT data FROM refunds WHERE order_id = ?').get(orderId) as Row | undefined);
  }

  async getRefund(id: string): Promise<RefundRequest | null> {
    return parse<RefundRequest>(this.db.prepare('SELECT data FROM refunds WHERE id = ?').get(id) as Row | undefined);
  }

  async listRefunds(status?: RefundStatus): Promise<RefundRequest[]> {
    const rows = status
      ? this.db.prepare('SELECT data FROM refunds WHERE status = ? ORDER BY created_at').all(status)
      : this.db.prepare('SELECT data FROM refunds ORDER BY created_at').all();
    return (rows as Row[]).map((r) => parse<RefundRequest>(r)!);
  }

  async createRefundIfAbsent(refund: RefundRequest): Promise<RefundRequest> {
    return this.tx(() => {
      // 주문번호 유니크 제약: 같은 주문의 접수가 이미 있으면 넣지 않고 그것을 돌려준다
      this.db
        .prepare('INSERT INTO refunds (id, order_id, status, created_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(order_id) DO NOTHING')
        .run(refund.id, refund.orderId, refund.status, refund.createdAt, JSON.stringify(refund));
      return parse<RefundRequest>(this.db.prepare('SELECT data FROM refunds WHERE order_id = ?').get(refund.orderId) as Row | undefined)!;
    });
  }

  async updateRefund(id: string, update: (r: RefundRequest) => RefundRequest): Promise<RefundRequest | null> {
    return this.tx(() => {
      const current = parse<RefundRequest>(this.db.prepare('SELECT data FROM refunds WHERE id = ?').get(id) as Row | undefined);
      if (!current) return null;
      const next = update(current);
      this.db.prepare('UPDATE refunds SET status = ?, data = ? WHERE id = ?').run(next.status, JSON.stringify(next), id);
      return structuredClone(next);
    });
  }

  async createIssuance(record: IssuanceRecord): Promise<void> {
    const { events, ...rest } = record;
    try {
      this.tx(() => {
        this.db.prepare('INSERT INTO issuances (order_id, data) VALUES (?, ?)').run(record.orderId, JSON.stringify(rest));
        for (const e of events) this.db.prepare('INSERT INTO issuance_events (order_id, type, at) VALUES (?, ?, ?)').run(record.orderId, e.type, e.at);
      });
    } catch (e) {
      if (e instanceof Error && /UNIQUE|PRIMARY KEY|constraint|immutable/i.test(e.message)) throw new IssuanceImmutable();
      throw e;
    }
  }

  async getIssuance(orderId: string): Promise<IssuanceRecord | null> {
    const base = parse<Omit<IssuanceRecord, 'events'>>(this.db.prepare('SELECT data FROM issuances WHERE order_id = ?').get(orderId) as Row | undefined);
    if (!base) return null;
    const events = (this.db.prepare('SELECT type, at FROM issuance_events WHERE order_id = ? ORDER BY seq').all(orderId) as Row[]).map((r) => ({
      type: String(r.type) as IssuanceEventType,
      at: String(r.at),
    }));
    return { ...base, events };
  }

  async appendIssuanceEvent(orderId: string, event: { type: IssuanceEventType; at: string }): Promise<boolean> {
    return this.tx(() => {
      if (!this.db.prepare('SELECT 1 FROM issuances WHERE order_id = ?').get(orderId)) return false;
      this.db.prepare('INSERT INTO issuance_events (order_id, type, at) VALUES (?, ?, ?)').run(orderId, event.type, event.at);
      return true;
    });
  }
}
