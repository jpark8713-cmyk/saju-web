// 저장소 계약 테스트: 메모리·SQLite 두 구현이 같은 동작을 하는지(D-030), SQLite 백업·복원, 운영 저장소 설정 검사
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startGeneration } from '../../src/orders/generation';
import { requestRefund } from '../../src/orders/refund';
import { transition } from '../../src/orders/stateMachine';
import { runStartupChecks } from '../../src/startup';
import { assertOnVolume, createStore, sqlitePathOf, StoreMisconfigured } from '../../src/store';
import { backupDatabase, BackupError, checkBackup, restoreDatabase } from '../../src/store/backup';
import { MemoryStore } from '../../src/store/memory';
import { SqliteStore } from '../../src/store/sqlite';
import { IssuanceImmutable, type Store } from '../../src/store/types';
import { RateLimiter } from '../../src/web/rateLimit';
import { paidOrder, runtime } from './helpers';

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'saju-store-'));
  dirs.push(d);
  return d;
};
const opened: SqliteStore[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const s of opened.splice(0)) {
    try {
      s.close();
    } catch {
      // 이미 닫힘
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sqlite = (path = join(tempDir(), 'saju.db')) => {
  const s = new SqliteStore(path);
  opened.push(s);
  return s;
};

const SECRET = 'test-secret-0123456789-0123456789-abcdef';
const refundCtx = (store: Store, token: string | null) => ({ store, limiter: new RateLimiter(), ip: '203.0.113.7', token, env: { NODE_ENV: 'test', REFUND_ID_SECRET: SECRET } });
const refundBody = (orderId: string) => ({ orderId, reason: 'not_generated', detail: null, email: 'reply@example.com' });

/** 결제 → 생성 → 환불 접수 → PDF 다운로드 사건까지 만든 저장소 */
async function populated(store: Store) {
  const o = await paidOrder(store);
  await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
  const ack = await requestRefund(refundCtx(store, o.accessToken), o.orderId, refundBody(o.orderId));
  await store.appendIssuanceEvent(o.orderId, { type: 'pdf_download', at: '2026-10-21T01:00:00.000Z' });
  return { o, refundId: ack.refundId };
}

describe.each([
  ['메모리', () => new MemoryStore() as Store],
  ['SQLite', () => sqlite() as Store],
])('저장소 계약 (%s)', (_name, make) => {
  it('주문 → 결제 → 생성 → 발급 기록 → 환불 접수가 같은 결과를 낸다', async () => {
    const store = make();
    const { o, refundId } = await populated(store);
    const order = (await store.getOrder(o.orderId))!;
    expect(order.status).toBe('done');
    expect(order.pendingBirth).toBeNull();
    expect((await store.getReport(o.orderId))!.orderId).toBe(o.orderId);
    expect((await store.listOrdersByStatus('done')).map((x) => x.id)).toEqual([o.orderId]);
    const issuance = (await store.getIssuance(o.orderId))!;
    expect(issuance.events).toEqual([{ type: 'pdf_download', at: '2026-10-21T01:00:00.000Z' }]);
    expect((await store.getRefund(refundId))!.orderId).toBe(o.orderId);
    expect((await store.listRefunds('received')).map((r) => r.id)).toEqual([refundId]);
  });

  it('발급 기록은 다시 만들 수 없고, 사건만 덧붙는다', async () => {
    const store = make();
    const { o } = await populated(store);
    const rec = (await store.getIssuance(o.orderId))!;
    await expect(store.createIssuance({ ...rec, contentHash: 'x' })).rejects.toBeInstanceOf(IssuanceImmutable);
    expect(await store.appendIssuanceEvent('SJ20261021-AAAAAAAA', { type: 'pdf_download', at: 'x' })).toBe(false);
    expect((await store.getIssuance(o.orderId))!.contentHash).toBe(rec.contentHash);
  });

  it('같은 주문의 환불 접수는 하나뿐이다(동시 요청 포함)', async () => {
    const store = make();
    const o = await paidOrder(store);
    const [a, b] = await Promise.all([
      requestRefund(refundCtx(store, o.accessToken), o.orderId, refundBody(o.orderId)),
      requestRefund(refundCtx(store, o.accessToken), o.orderId, refundBody(o.orderId)),
    ]);
    expect(a.refundId).toBe(b.refundId);
    expect(await store.listRefunds()).toHaveLength(1);
  });

  it('갱신 함수가 던지면 아무것도 바꾸지 않는다', async () => {
    const store = make();
    const o = await paidOrder(store);
    await expect(store.updateOrder(o.orderId, () => { throw new Error('중단'); })).rejects.toThrow('중단');
    expect((await store.getOrder(o.orderId))!.status).toBe('paid');
    expect(await store.updateOrder('SJ20261021-AAAAAAAA', (x) => x)).toBeNull();
  });
});

describe('SQLite만의 보장', () => {
  it('발급 기록은 DB에서 직접 고치거나 지워도 거부된다(트리거)', async () => {
    const path = join(tempDir(), 'saju.db');
    const store = sqlite(path);
    const { o } = await populated(store);
    const raw = new DatabaseSync(path);
    try {
      expect(() => raw.prepare("UPDATE issuances SET data = '{}' WHERE order_id = ?").run(o.orderId)).toThrow(/immutable/);
      expect(() => raw.prepare('DELETE FROM issuances WHERE order_id = ?').run(o.orderId)).toThrow(/immutable/);
      expect(() => raw.prepare('DELETE FROM issuance_events').run()).toThrow(/immutable/);
    } finally {
      raw.close();
    }
  });

  it('다시 열어도(서버 재시작) 데이터가 남는다', async () => {
    const path = join(tempDir(), 'saju.db');
    const first = sqlite(path);
    const { o, refundId } = await populated(first);
    first.close();
    const again = sqlite(path);
    expect((await again.getOrder(o.orderId))!.status).toBe('done');
    expect((await again.getRefund(refundId))!.status).toBe('received');
  });

  it('관리 스크립트처럼 다른 연결에서 연 저장소도 같은 데이터를 본다', async () => {
    const path = join(tempDir(), 'saju.db');
    const web = sqlite(path);
    const { refundId } = await populated(web);
    const admin = sqlite(path);
    expect((await admin.getRefund(refundId))!.status).toBe('received');
    await admin.updateRefund(refundId, (r) => ({ ...r, status: 'rejected', email: null }));
    expect((await web.getRefund(refundId))!).toMatchObject({ status: 'rejected', email: null });
  });
});

describe('백업과 복원', () => {
  it('서버가 쓰는 중에 백업하고, DB를 잃은 뒤 백업으로 복원하면 모든 기록이 돌아온다', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'saju.db');
    const store = sqlite(dbPath);
    const { o, refundId } = await populated(store);
    // 마지막 쓰기가 아직 WAL에만 있는 상태에서 백업한다
    await store.appendIssuanceEvent(o.orderId, { type: 'pdf_download', at: '2026-10-21T02:00:00.000Z' });
    const backupPath = join(dir, 'backup.db');
    const result = await backupDatabase(dbPath, backupPath);
    expect(result.tables).toMatchObject({ orders: 1, reports: 1, refunds: 1, issuances: 1, issuance_events: 2 });
    expect(result.bytes).toBeGreaterThan(0);
    // 사본은 파일 하나다(WAL 부속 파일이 남지 않는다)
    for (const suffix of ['-wal', '-shm', '.part', '.part-wal', '.part-shm']) expect(existsSync(backupPath + suffix)).toBe(false);

    // 사고: 백업 뒤에 들어온 주문은 복원하면 사라진다(최대 1시간분, 매시간 백업 기준)
    const later = await paidOrder(store);
    store.close();
    rmSync(dbPath);
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    const restored = restoreDatabase(backupPath, dbPath, new Date('2026-10-21T03:00:00Z'));
    expect(restored.keptAs).toBeNull();
    const back = sqlite(dbPath);
    expect((await back.getOrder(o.orderId))!.status).toBe('done');
    expect((await back.getRefund(refundId))!.email).toBe('reply@example.com');
    expect((await back.getIssuance(o.orderId))!.events).toHaveLength(2);
    expect(await back.getOrder(later.orderId)).toBeNull();
    // 복원한 DB도 발급 기록 보호(트리거)가 살아 있다
    const raw = new DatabaseSync(dbPath);
    try {
      expect(() => raw.prepare('DELETE FROM issuances').run()).toThrow(/immutable/);
    } finally {
      raw.close();
    }
  });

  it('복원하면 원래 DB를 옆에 남긴다', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'saju.db');
    const store = sqlite(dbPath);
    await populated(store);
    await backupDatabase(dbPath, join(dir, 'backup.db'));
    store.close();
    const r = restoreDatabase(join(dir, 'backup.db'), dbPath, new Date('2026-10-21T03:00:00Z'));
    expect(r.keptAs).toBe(`${dbPath}.before-restore-2026-10-21T03-00-00-000Z`);
    expect(existsSync(r.keptAs!)).toBe(true);
    expect(checkBackup(dbPath).ok).toBe(true);
  });

  it('깨진 백업·빈 파일·다른 DB로는 복원하지 않고 원래 DB를 건드리지 않는다', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'saju.db');
    const store = sqlite(dbPath);
    const { o } = await populated(store);
    store.close();
    const broken = join(dir, 'broken.db');
    writeFileSync(broken, 'not a database');
    expect(() => restoreDatabase(broken, dbPath)).toThrow(BackupError);
    expect(checkBackup(broken)).toMatchObject({ ok: false, problem: expect.stringContaining('SQLite 파일이 아닙니다') });
    const other = join(dir, 'other.db');
    new DatabaseSync(other).close();
    expect(() => restoreDatabase(other, dbPath)).toThrow(BackupError);
    expect(() => restoreDatabase(join(dir, 'missing.db'), dbPath)).toThrow(BackupError);
    const still = sqlite(dbPath);
    expect((await still.getOrder(o.orderId))!.status).toBe('done');
  });

  it('DB 파일이 없으면 백업하지 않는다', async () => {
    await expect(backupDatabase(join(tempDir(), 'nope.db'), join(tempDir(), 'b.db'))).rejects.toBeInstanceOf(BackupError);
  });
});

describe('운영 저장소 설정', () => {
  it('운영에서 DATABASE_URL이 없으면 메모리 저장소로 시작하지 않는다', () => {
    expect(() => createStore({ NODE_ENV: 'production' })).toThrow(StoreMisconfigured);
    expect(createStore({ NODE_ENV: 'test' })).toBeInstanceOf(MemoryStore);
  });

  it('DATABASE_URL은 file: 형식만 받는다', () => {
    expect(() => sqlitePathOf('postgres://x')).toThrow(StoreMisconfigured);
    expect(sqlitePathOf('')).toBeNull();
  });

  it('볼륨을 요구하면, DB 폴더가 루트와 같은 파일 시스템일 때 시작하지 않는다', () => {
    const sameDevice = () => ({ dev: 1 });
    expect(() => assertOnVolume('/data/saju.db', sameDevice)).toThrow(/볼륨이 아닙니다/);
    const mounted = (p: string) => ({ dev: p === '/' ? 1 : 2 });
    expect(() => assertOnVolume('/data/saju.db', mounted)).not.toThrow();
    expect(() => createStore({ NODE_ENV: 'production', DATABASE_URL: 'file:/data/saju.db', DB_REQUIRE_VOLUME: 'true' }, sameDevice)).toThrow(StoreMisconfigured);
  });

  it('SQLite 주소가 있으면 SQLite 저장소를 연다', () => {
    const store = createStore({ NODE_ENV: 'production', DATABASE_URL: `file:${join(tempDir(), 'saju.db')}` });
    expect(store).toBeInstanceOf(SqliteStore);
    opened.push(store as SqliteStore);
  });
});

describe('서버 시작 점검', () => {
  it('운영에서 APP_ORIGIN이나 REFUND_ID_SECRET이 없으면 시작하지 않는다', async () => {
    const store = () => new MemoryStore();
    await expect(runStartupChecks({ NODE_ENV: 'production', REFUND_ID_SECRET: SECRET }, store)).rejects.toThrow(/APP_ORIGIN/);
    await expect(runStartupChecks({ NODE_ENV: 'production', APP_ORIGIN: 'https://example.com' }, store)).rejects.toThrow(/REFUND_ID_SECRET/);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ok = await runStartupChecks({ NODE_ENV: 'production', APP_ORIGIN: 'https://example.com', REFUND_ID_SECRET: SECRET }, store);
    expect(ok.warnings.join(' ')).toContain('TRUST_PROXY');
  });

  it('서버를 켤 때 남아 있는 "생성 중" 주문은 모두 실패로 바꾼다(방금 시작한 것도)', async () => {
    const store = sqlite();
    const o = await paidOrder(store);
    await store.updateOrder(o.orderId, (x) => transition(x, 'generating', { generation: { ...x.generation, runs: 1, startedAt: new Date().toISOString() } }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await runStartupChecks({ NODE_ENV: 'test' }, () => store);
    expect(r.recovered).toBe(1);
    expect((await store.getOrder(o.orderId))!).toMatchObject({ status: 'failed', generation: { lastFailure: 'interrupted' } });
  });
});
