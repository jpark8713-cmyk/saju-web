// SQLite 복원 (D-030). 웹 서버(컨테이너)를 멈춘 뒤 실행한다. 절차: Docs/deploy.md 5장, deploy/restore.sh.
// 실행: npm run db:restore -- <백업 파일> [--check-only]
import { BackupError, checkBackup, restoreDatabase } from '../src/store/backup';
import { sqlitePathOf } from '../src/store';

const [file, flag] = process.argv.slice(2);
const dbPath = sqlitePathOf(process.env.DATABASE_URL);
if (!file || !dbPath) {
  console.error('사용법: DATABASE_URL=file:/data/saju.db npm run db:restore -- <백업 파일> [--check-only]');
  process.exit(2);
}
if (flag === '--check-only') {
  const check = checkBackup(file);
  console.log(JSON.stringify(check));
  process.exit(check.ok ? 0 : 1);
}
try {
  console.log(JSON.stringify(restoreDatabase(file, dbPath)));
} catch (e) {
  if (!(e instanceof BackupError)) throw e;
  console.error(`복원하지 않았어요: ${e.message}`);
  process.exit(1);
}
