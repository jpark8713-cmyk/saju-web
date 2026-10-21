// 서버 사본 정리 (D-031). 백업 스크립트가 컨테이너 안에서 부른다: npm run db:prune -- --keep 24 --retention-days 7
// DB 폴더는 DATABASE_URL(file:/data/saju.db)의 폴더다. 지운 파일 수만 출력한다.
import { dirname } from 'node:path';
import { sqlitePathOf } from '../src/store';
import { pruneLocalCopies } from '../src/store/prune';

const args = process.argv.slice(2);
const num = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  const v = i >= 0 ? Number(args[i + 1]) : fallback;
  if (!Number.isInteger(v) || v < 1) {
    console.error(`${name}는 1 이상의 정수여야 해요`);
    process.exit(2);
  }
  return v;
};
const dbPath = sqlitePathOf(process.env.DATABASE_URL);
if (!dbPath) {
  console.error('DATABASE_URL(file:/data/saju.db)이 필요해요');
  process.exit(2);
}
const r = pruneLocalCopies(dirname(dbPath), { keep: num('--keep', 24), retentionDays: num('--retention-days', 7) });
console.log(JSON.stringify({ removed: r.removed.length, kept: r.kept.length }));
