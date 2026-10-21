// SQLite 온라인 백업 (D-030). 매시간 예약 작업(deploy/backup-hourly.sh)이 컨테이너 안에서 부른다.
// 실행: npm run db:backup -- <사본 경로>   (DB 위치는 DATABASE_URL=file:/data/saju.db)
import { BackupError, backupDatabase } from '../src/store/backup';
import { sqlitePathOf } from '../src/store';

const dest = process.argv[2];
const dbPath = sqlitePathOf(process.env.DATABASE_URL);
if (!dest || !dbPath) {
  console.error('사용법: DATABASE_URL=file:/data/saju.db npm run db:backup -- /data/backups/saju-backup.db');
  process.exit(2);
}
try {
  // 경로·크기·표별 건수만 출력한다(내용은 출력하지 않는다)
  console.log(JSON.stringify(await backupDatabase(dbPath, dest)));
} catch (e) {
  if (!(e instanceof BackupError)) throw e;
  console.error(`백업 실패: ${e.message}`);
  process.exit(1);
}
