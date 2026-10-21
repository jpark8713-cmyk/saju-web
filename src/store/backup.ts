// SQLite 백업·복원 (사업자 결정 2026-10-21, D-030). 절차: Docs/deploy.md 5장.
// - 백업: 서버가 돌고 있어도 SQLite 온라인 백업(node:sqlite backup)으로 일관된 사본을 만들고, 사본을 열어 무결성을 확인한다.
// - 복원: 백업 파일을 확인한 뒤 DB 자리에 바꿔 넣는다. 원래 파일은 옆에 남긴다. 웹 서버를 멈춘 상태에서만 한다.
import { chmodSync, copyFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

const REQUIRED_TABLES = ['orders', 'reports', 'refunds', 'issuances', 'issuance_events'];

export interface BackupCheck {
  ok: boolean;
  tables: Record<string, number>;
  problem: string | null;
}

/** 백업 파일을 읽기 전용으로 열어 무결성과 표를 확인한다 */
export function checkBackup(path: string): BackupCheck {
  if (!existsSync(path)) return { ok: false, tables: {}, problem: `파일이 없습니다: ${path}` };
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (e) {
    return { ok: false, tables: {}, problem: `열 수 없습니다: ${(e as Error).message}` };
  }
  try {
    const integrity = String((db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>).integrity_check);
    if (integrity !== 'ok') return { ok: false, tables: {}, problem: `무결성 검사 실패: ${integrity}` };
    const tables: Record<string, number> = {};
    for (const t of REQUIRED_TABLES) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
      if (!exists) return { ok: false, tables, problem: `표가 없습니다: ${t}` };
      tables[t] = Number((db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as Record<string, unknown>).n);
    }
    return { ok: true, tables, problem: null };
  } catch (e) {
    return { ok: false, tables: {}, problem: `SQLite 파일이 아닙니다: ${(e as Error).message}` };
  } finally {
    db.close();
  }
}

function removeSidecars(path: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
}

/** 운영 DB(dbPath)의 일관된 사본을 dest에 만든다. 서버가 쓰는 중이어도 된다 */
export async function backupDatabase(dbPath: string, dest: string): Promise<{ path: string; bytes: number; tables: Record<string, number> }> {
  if (!existsSync(dbPath)) throw new BackupError(`DB 파일이 없습니다: ${dbPath}`);
  const tmp = `${dest}.part`;
  rmSync(tmp, { force: true });
  const source = new DatabaseSync(dbPath);
  try {
    source.exec('PRAGMA busy_timeout = 5000');
    await backup(source, tmp);
  } catch (e) {
    rmSync(tmp, { force: true });
    removeSidecars(tmp);
    throw new BackupError(`온라인 백업에 실패했어요: ${(e as Error).message}`);
  } finally {
    source.close();
  }
  // 사본은 파일 하나로 끝나게 한다(WAL 부속 파일 없이 올리고 복원할 수 있게)
  const copy = new DatabaseSync(tmp);
  try {
    copy.exec('PRAGMA journal_mode = DELETE');
  } finally {
    copy.close();
  }
  const check = checkBackup(tmp);
  removeSidecars(tmp);
  if (!check.ok) {
    rmSync(tmp, { force: true });
    throw new BackupError(`백업 사본 확인 실패: ${check.problem}`);
  }
  renameSync(tmp, dest);
  // 사본은 소유자만 읽는다(개인정보가 들어 있다)
  chmodSync(dest, 0o600);
  return { path: dest, bytes: statSync(dest).size, tables: check.tables };
}

/** 파일 바꾸기에 쓰는 함수들 (테스트에서 도중 실패를 재현할 수 있게 바꿔 넣는다) */
export interface FileOps {
  copy: (from: string, to: string) => void;
  rename: (from: string, to: string) => void;
}
const realOps: FileOps = { copy: copyFileSync, rename: renameSync };

/** 원래 DB의 WAL 내용을 본 파일에 합친다(남겨 둘 사본이 파일 하나로 완전해지게). 실패해도 그대로 둔다 */
function checkpoint(dbPath: string): void {
  try {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA busy_timeout = 5000; PRAGMA wal_checkpoint(TRUNCATE);');
    } finally {
      db.close();
    }
  } catch {
    // 열 수 없는 DB면 WAL 파일을 짝 맞는 이름으로 함께 옮겨 남긴다
  }
}

/**
 * 백업 파일로 DB를 바꿔 넣는다. 웹 서버를 멈춘 뒤에 실행한다(D-031).
 * 1) 백업을 임시 파일(`<db>.restoring`)에 복사하고 그 파일을 검증한다. 여기까지 실패하면 원래 DB는 손대지 않는다.
 * 2) 원래 DB의 WAL을 본 파일에 합친 뒤, 원래 DB와 WAL·SHM을 짝이 맞는 이름(`<db>.before-restore-<시각>`, `...-wal`, `...-shm`)으로 옮겨 남긴다.
 * 3) 임시 파일을 DB 자리로 옮긴다. 이 단계가 실패하면 원래 DB를 제자리로 되돌린다.
 */
export function restoreDatabase(backupPath: string, dbPath: string, now = new Date(), ops: FileOps = realOps): { keptAs: string | null; tables: Record<string, number> } {
  const check = checkBackup(backupPath);
  removeSidecars(backupPath);
  if (!check.ok) throw new BackupError(`복원할 수 없는 백업입니다: ${check.problem}`);

  const tmp = `${dbPath}.restoring`;
  rmSync(tmp, { force: true });
  removeSidecars(tmp);
  try {
    ops.copy(backupPath, tmp);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new BackupError(`백업을 임시 파일로 복사하지 못했어요(원래 DB는 그대로예요): ${(e as Error).message}`);
  }
  const tmpCheck = checkBackup(tmp);
  removeSidecars(tmp);
  if (!tmpCheck.ok) {
    rmSync(tmp, { force: true });
    throw new BackupError(`복사한 임시 파일 확인에 실패했어요(원래 DB는 그대로예요): ${tmpCheck.problem}`);
  }

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  let keptAs: string | null = null;
  const moved: [string, string][] = [];
  try {
    // DB 본체가 없고 -wal·-shm만 남은 경우에도 옮긴다(옛 WAL이 새 DB에 섞이지 않게)
    if (['', '-wal', '-shm'].some((suffix) => existsSync(dbPath + suffix))) {
      if (existsSync(dbPath)) checkpoint(dbPath);
      keptAs = `${dbPath}.before-restore-${stamp}`;
      for (const suffix of ['', '-wal', '-shm']) {
        if (!existsSync(dbPath + suffix)) continue;
        ops.rename(dbPath + suffix, keptAs + suffix);
        moved.push([keptAs + suffix, dbPath + suffix]);
      }
    }
    ops.rename(tmp, dbPath);
  } catch (e) {
    // 바꿔 넣기 도중 실패: 옮긴 원래 파일을 제자리로 되돌린다
    for (const [from, to] of moved.reverse()) {
      try {
        renameSync(from, to);
      } catch {
        // 되돌리지 못한 파일은 이름(.before-restore-<시각>)으로 찾을 수 있다
      }
    }
    rmSync(tmp, { force: true });
    throw new BackupError(`DB를 바꿔 넣지 못해 원래 DB로 되돌렸어요: ${(e as Error).message}`);
  }
  return { keptAs, tables: tmpCheck.tables };
}
