// 저장소 계약 테스트: 메모리·SQLite 두 구현이 같은 동작을 하는지(D-030), SQLite 백업·복원, 운영 저장소 설정 검사
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startGeneration } from '../../src/orders/generation';
import { requestRefund } from '../../src/orders/refund';
import { transition } from '../../src/orders/stateMachine';
import { runStartupChecks } from '../../src/startup';
import { assertOnVolume, assertPrivateDir, createStore, parseMountInfo, sqlitePathOf, StoreMisconfigured } from '../../src/store';
import { backupDatabase, BackupError, checkBackup, restoreDatabase } from '../../src/store/backup';
import { MemoryStore } from '../../src/store/memory';
import { pruneLocalCopies } from '../../src/store/prune';
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
      // 덮어쓰기(INSERT OR REPLACE)도 막힌다
      expect(() => raw.prepare("INSERT OR REPLACE INTO issuances (order_id, data) VALUES (?, '{}')").run(o.orderId)).toThrow(/immutable/);
      expect(() => raw.prepare("REPLACE INTO issuance_events (seq, order_id, type, at) VALUES (1, ?, 'pdf_download', 'x')").run(o.orderId)).toThrow(/immutable/);
      expect(raw.prepare('SELECT count(*) AS n FROM issuance_events').get()).toMatchObject({ n: 1 });
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

  it('남겨 둔 원래 DB에는 WAL에만 있던 최근 기록도 들어 있다', async () => {
    const dir = tempDir();
    const live = join(dir, 'live.db');
    const store = sqlite(live);
    const { o } = await populated(store);
    const backupPath = join(dir, 'backup.db');
    await backupDatabase(live, backupPath);
    // 백업 뒤의 주문이 WAL에만 남은 채 서버가 멈춘 상태를 만든다(체크포인트를 끄고 쓴 뒤, 연결을 연 채로 파일을 복사)
    store.handle.exec('PRAGMA wal_autocheckpoint = 0');
    const after = await paidOrder(store);
    const crashed = join(dir, 'saju.db');
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(live + suffix)) copyFileSync(live + suffix, crashed + suffix);
    expect(existsSync(`${crashed}-wal`)).toBe(true);

    const r = restoreDatabase(backupPath, crashed, new Date('2026-10-21T04:00:00Z'));
    const kept = sqlite(r.keptAs!);
    expect((await kept.getOrder(after.orderId))!.status).toBe('paid');
    expect((await kept.getOrder(o.orderId))!.status).toBe('done');
    // 복원한 DB에는 백업 시점까지만 있다
    const restored = sqlite(crashed);
    expect(await restored.getOrder(after.orderId)).toBeNull();
  });

  it('DB 본체 없이 -wal·-shm만 남아 있으면 그것도 옮겨 새 DB에 섞이지 않게 한다', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'saju.db');
    const store = sqlite(join(dir, 'src.db'));
    const { o } = await populated(store);
    await backupDatabase(join(dir, 'src.db'), join(dir, 'backup.db'));
    writeFileSync(`${dbPath}-wal`, 'stale wal');
    writeFileSync(`${dbPath}-shm`, 'stale shm');
    const r = restoreDatabase(join(dir, 'backup.db'), dbPath, new Date('2026-10-21T05:00:00Z'));
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${r.keptAs}-wal`)).toBe(true);
    expect((await sqlite(dbPath).getOrder(o.orderId))!.status).toBe('done');
  });

  it('임시 파일 복사가 실패하면 원래 DB를 건드리지 않는다', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'saju.db');
    const store = sqlite(dbPath);
    const { o } = await populated(store);
    await backupDatabase(dbPath, join(dir, 'backup.db'));
    store.close();
    const failCopy = { copy: () => { throw new Error('디스크 부족'); }, rename: renameSync };
    expect(() => restoreDatabase(join(dir, 'backup.db'), dbPath, new Date(), failCopy)).toThrow(/원래 DB는 그대로/);
    expect(existsSync(`${dbPath}.restoring`)).toBe(false);
    expect((await sqlite(dbPath).getOrder(o.orderId))!.status).toBe('done');
  });

  it('바꿔 넣는 마지막 단계가 실패하면 원래 DB를 제자리로 되돌린다', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'saju.db');
    const store = sqlite(dbPath);
    const { o } = await populated(store);
    await backupDatabase(dbPath, join(dir, 'backup.db'));
    const later = await paidOrder(store);
    store.close();
    const failSwap = {
      copy: copyFileSync,
      rename: (from: string, to: string) => {
        if (from.endsWith('.restoring')) throw new Error('권한 없음');
        renameSync(from, to);
      },
    };
    expect(() => restoreDatabase(join(dir, 'backup.db'), dbPath, new Date(), failSwap)).toThrow(/원래 DB로 되돌렸어요/);
    const back = sqlite(dbPath);
    expect((await back.getOrder(o.orderId))!.status).toBe('done');
    expect((await back.getOrder(later.orderId))!.status).toBe('paid');
    expect(existsSync(`${dbPath}.restoring`)).toBe(false);
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

  it('볼륨을 요구하면, /data에 이름 지정 볼륨이나 서버 경로가 연결돼 있어야 시작한다', () => {
    const root = '22 1 0:21 / / rw,relatime - overlay overlay rw';
    const info = (...lines: string[]) => () => [root, ...lines].join('\n');
    const bind = '35 22 252:1 /srv/saju/data /data rw,relatime - ext4 /dev/vda1 rw';
    const named = '35 22 252:1 /var/lib/docker/volumes/saju-data/_data /data rw,relatime - ext4 /dev/vda1 rw';
    const anon = `35 22 252:1 /var/lib/docker/volumes/${'a1'.repeat(32)}/_data /data rw,relatime - ext4 /dev/vda1 rw`;
    const tmpfs = '35 22 0:50 / /data rw,nosuid - tmpfs tmpfs rw';
    const spaced = String.raw`35 22 252:1 /srv/my\040data /data rw - ext4 /dev/vda1 rw`;
    expect(() => assertOnVolume('/data/saju.db', info(bind))).not.toThrow();
    expect(() => assertOnVolume('/data/saju.db', info(named))).not.toThrow();
    expect(() => assertOnVolume('/data/saju.db', info(spaced))).not.toThrow();
    // -v 없이 띄움(연결 없음), 이름 없는 볼륨, 메모리
    expect(() => assertOnVolume('/data/saju.db', info())).toThrow(/볼륨이 연결되지 않았습니다/);
    expect(() => assertOnVolume('/data/saju.db', info(anon))).toThrow(/이름 없는 볼륨/);
    expect(() => assertOnVolume('/data/saju.db', info(tmpfs))).toThrow(/메모리/);
    // 다른 폴더에만 연결된 경우, 같은 자리에 나중에 덮어 마운트된 경우
    expect(() => assertOnVolume('/data/saju.db', info('35 22 252:1 /srv/x /other rw - ext4 /dev/vda1 rw'))).toThrow(/연결되지 않았습니다/);
    expect(() => assertOnVolume('/data/saju.db', info(bind, '36 35 0:51 / /data rw - tmpfs tmpfs rw'))).toThrow(/메모리/);
    expect(() => assertOnVolume('/data/saju.db', () => { throw new Error('no proc'); })).toThrow(/확인하지 못했습니다/);
    expect(() => createStore({ NODE_ENV: 'production', DATABASE_URL: 'file:/data/saju.db', DB_REQUIRE_VOLUME: 'true' }, info())).toThrow(StoreMisconfigured);
    expect(parseMountInfo(spaced)[0]!.root).toBe('/srv/my data');
  });

  it('DB가 볼륨의 하위 폴더에 있어도 볼륨 연결을 알아보고, 루트(/)만 있으면 거부한다', () => {
    const root = '22 1 0:21 / / rw - overlay overlay rw';
    const bind = '35 22 252:1 /srv/saju/data /data rw - ext4 /dev/vda1 rw';
    const info = (...lines: string[]) => () => [root, ...lines].join('\n');
    expect(() => assertOnVolume('/data/db/saju.db', info(bind))).not.toThrow();
    expect(() => assertOnVolume('/data/db/saju.db', info())).toThrow(/연결되지 않았습니다/);
    // /database처럼 이름만 비슷한 마운트는 /data를 담지 않는다
    expect(() => assertOnVolume('/data/saju.db', info('35 22 252:1 /srv/x /database rw - ext4 /dev/vda1 rw'))).toThrow(/연결되지 않았습니다/);
    // 볼륨 안의 하위 폴더에 메모리가 덮여 있으면 그것을 본다
    expect(() => assertOnVolume('/data/db/saju.db', info(bind, '36 35 0:51 / /data/db rw - tmpfs tmpfs rw'))).toThrow(/메모리/);
  });

  it('DB 폴더 권한이 700이 아니면(그룹·다른 사용자 권한이 있으면) 시작하지 않는다', () => {
    expect(() => assertPrivateDir('/data/saju.db', () => 0o40700)).not.toThrow();
    expect(() => assertPrivateDir('/data/saju.db', () => 0o40755)).toThrow(/755/);
    expect(() => assertPrivateDir('/data/saju.db', () => 0o40770)).toThrow(StoreMisconfigured);
    // 운영(리눅스)에서는 /data, 이 테스트를 돌리는 윈도에서는 C:/data처럼 해석되므로 해석된 경로로 마운트 목록을 만든다
    const dataDir = sqlitePathOf('file:/data/saju.db')!.replace(/\\/g, '/').replace(/\/saju\.db$/, '');
    const bindInfo = () => ['22 1 0:21 / / rw - overlay overlay rw', `35 22 252:1 /srv/saju/data ${dataDir} rw - ext4 /dev/vda1 rw`].join('\n');
    expect(() => createStore({ NODE_ENV: 'production', DATABASE_URL: 'file:/data/saju.db', DB_REQUIRE_VOLUME: 'true' }, bindInfo, () => 0o40755)).toThrow(/권한/);
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

describe('서버 사본 정리 (db:prune)', () => {
  it('백업 사본은 이름의 시각 순으로 최근 N개만 남기고, 실패한 조각을 지운다', () => {
    const dir = tempDir();
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    const names = ['saju-20261001T000000Z.db', 'saju-20261003T000000Z.db', 'saju-20261002T000000Z.db', 'saju-20261004T000000Z.db'];
    for (const n of names) writeFileSync(join(backups, n), 'x');
    writeFileSync(join(backups, 'saju-20261005T000000Z.db.part'), 'x');
    writeFileSync(join(backups, 'saju-20261005T000000Z.db.part-wal'), 'x');
    writeFileSync(join(backups, 'notes.txt'), 'x');
    const r = pruneLocalCopies(dir, { keep: 2, retentionDays: 7 });
    expect(readdirSync(backups).sort()).toEqual(['notes.txt', 'saju-20261003T000000Z.db', 'saju-20261004T000000Z.db']);
    expect(r.removed).toHaveLength(4);
  });

  it('복원 때 남긴 원래 DB는 파일 수정 시각이 아니라 이름의 시각으로 보관 기간을 센다', () => {
    const dir = tempDir();
    const now = new Date('2026-10-21T12:00:00Z');
    const fresh = 'saju.db.before-restore-2026-10-21T03-00-00-000Z';
    const old = 'saju.db.before-restore-2026-10-10T03-00-00-000Z';
    for (const n of [fresh, `${fresh}-wal`, old, `${old}-shm`, 'saju.db']) writeFileSync(join(dir, n), 'x');
    // 옮긴 파일은 수정 시각이 옛날 그대로일 수 있다(30일 전) → 그래도 이름 기준으로 남긴다
    const longAgo = new Date('2026-09-21T00:00:00Z');
    utimesSync(join(dir, fresh), longAgo, longAgo);
    pruneLocalCopies(dir, { keep: 24, retentionDays: 7, now });
    expect(readdirSync(dir).sort()).toEqual(['saju.db', fresh, `${fresh}-wal`].sort());
  });

  it('심볼릭 링크는 따라가지 않는다(링크만 지우고 링크 대상은 그대로)', () => {
    const dir = tempDir();
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    const outside = join(tempDir(), 'important.txt');
    writeFileSync(outside, 'keep me');
    try {
      symlinkSync(outside, join(backups, 'saju-20260101T000000Z.db'));
    } catch {
      return; // 이 환경(윈도 권한)에서 링크를 만들 수 없으면 건너뛴다. 운영(리눅스)에서는 lstat으로 링크를 구분한다
    }
    for (const n of ['saju-20261001T000000Z.db', 'saju-20261002T000000Z.db']) writeFileSync(join(backups, n), 'x');
    pruneLocalCopies(dir, { keep: 2, retentionDays: 7 });
    expect(readFileSync(outside, 'utf8')).toBe('keep me');
    expect(readdirSync(backups).sort()).toEqual(['saju-20261001T000000Z.db', 'saju-20261002T000000Z.db']);
  });

  it('백업 사본은 소유자만 읽고 쓸 수 있다(권한 600, 리눅스)', async () => {
    const dir = tempDir();
    const store = sqlite(join(dir, 'saju.db'));
    await populated(store);
    const r = await backupDatabase(join(dir, 'saju.db'), join(dir, 'b.db'));
    if (process.platform !== 'win32') expect(statSync(r.path).mode & 0o777).toBe(0o600);
  });
});
