// 서버 사본 정리 (D-031). 백업 스크립트가 컨테이너 안에서 앱 사용자 권한으로 부른다(root로 데이터 폴더를 만지지 않게).
// - backups/의 saju-<시각>.db는 이름의 시각 순으로 최근 keep개만 남긴다. 실패한 조각(.part, .part-wal, .part-shm)은 지운다.
// - 복원 때 남긴 saju.db.before-restore-<시각>(와 -wal·-shm)은 이름의 시각 기준으로 보관 기간이 지나면 지운다.
//   파일 수정 시각(mtime)은 옮겨도 그대로라 복원 직후 바로 지워질 수 있어 쓰지 않는다.
// 심볼릭 링크는 따라가지 않는다(링크 자체만 지운다). 일반 파일이 아닌 것은 건드리지 않는다.
import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface PruneResult {
  removed: string[];
  kept: string[];
}

const BACKUP_RE = /^saju-(\d{8}T\d{6}Z)\.db$/;
const PART_RE = /^saju-\d{8}T\d{6}Z\.db\.part(-wal|-shm)?$/;
const KEPT_RE = /^saju\.db\.before-restore-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(-wal|-shm)?$/;

function isRemovable(path: string): boolean {
  const st = lstatSync(path);
  return st.isFile() || st.isSymbolicLink();
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function pruneLocalCopies(dataDir: string, opts: { keep: number; retentionDays: number; now?: Date }): PruneResult {
  const removed: string[] = [];
  const kept: string[] = [];
  const remove = (path: string) => {
    if (!isRemovable(path)) return;
    unlinkSync(path);
    removed.push(path);
  };

  const backups = join(dataDir, 'backups');
  const names = list(backups);
  for (const n of names) if (PART_RE.test(n)) remove(join(backups, n));
  const copies = names.filter((n) => BACKUP_RE.test(n)).sort().reverse();
  copies.forEach((n, i) => (i < opts.keep ? kept.push(join(backups, n)) : remove(join(backups, n))));

  const cutoff = (opts.now ?? new Date()).getTime() - opts.retentionDays * 86_400_000;
  for (const n of list(dataDir)) {
    const m = KEPT_RE.exec(n);
    if (!m) continue;
    const at = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, +m[7]!);
    if (at < cutoff) remove(join(dataDir, n));
    else kept.push(join(dataDir, n));
  }
  return { removed, kept };
}
