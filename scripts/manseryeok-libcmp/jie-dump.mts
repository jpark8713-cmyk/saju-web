import { writeFileSync } from 'node:fs';
// 우리 절입 순간(1900~2050)을 JSON으로 뽑는다. 실행: npx tsx scripts/manseryeok-libcmp/jie-dump.mts <출력 파일>
const { jieOfYear } = await import(new URL('../../src/engine/solarTerms.ts', import.meta.url).href);
const out: any[] = [];
for (let y = 1900; y <= 2050; y++) for (const j of jieOfYear(y)) out.push({ y, name: j.name, branch: j.branch, ms: j.instantMs });
const file = process.argv[2];
if (!file) throw new Error('출력 파일을 인자로 주세요');
writeFileSync(file, JSON.stringify(out));
