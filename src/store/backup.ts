// SQLite 백업·복원 (사업자 결정 2026-10-21, D-030). 절차: Docs/deploy.md 5장.
// - 백업: 서버가 돌고 있어도 SQLite 온라인 백업(node:sqlite backup)으로 일관된 사본을 만들고, 사본을 열어 무결성을 확인한다.
// - 복원: 백업 파일을 확인한 뒤 DB 자리에 바꿔 넣는다. 원래 파일은 옆에 남긴다. 웹 서버를 멈춘 상태에서만 한다.
import { copyFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
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
  return { path: dest, bytes: statSync(dest).size, tables: check.tables };
}

/**
 * 백업 파일로 DB를 바꿔 넣는다. 웹 서버를 멈춘 뒤에 실행한다.
 * 원래 DB(와 WAL 파일)는 `<db>.before-restore-<시각>`으로 옮겨 남긴다. 돌려준 값은 남긴 파일 경로다.
 */
export function restoreDatabase(backupPath: string, dbPath: string, now = new Date()): { keptAs: string | null; tables: Record<string, number> } {
  const check = checkBackup(backupPath);
  if (!check.ok) throw new BackupError(`복원할 수 없는 백업입니다: ${check.problem}`);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  let keptAs: string | null = null;
  if (existsSync(dbPath)) {
    keptAs = `${dbPath}.before-restore-${stamp}`;
    renameSync(dbPath, keptAs);
  }
  // 이전 DB의 WAL·SHM 파일이 새 DB에 섞이지 않게 함께 옮긴다
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, `${keptAs ?? dbPath}${suffix}.before-restore-${stamp}`);
  }
  const tmp = `${dbPath}.restoring`;
  copyFileSync(backupPath, tmp);
  renameSync(tmp, dbPath);
  removeSidecars(backupPath);
  return { keptAs, tables: checkBackup(dbPath).tables };
}
