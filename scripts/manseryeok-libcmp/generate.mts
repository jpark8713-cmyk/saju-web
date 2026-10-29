// 우리 엔진 vs lunar-javascript EightChar 비교 + sxtwl(파이썬)용 입력 JSON 생성. 가상 입력만 쓴다.
// 실행: npx tsx scripts/manseryeok-libcmp/generate.mts <출력 폴더>  (Docs/MANSERYEOK_LIBCOMPARE.md)
import { writeFileSync } from 'node:fs';
const R = new URL('../../src', import.meta.url).href;
const { buildChart } = await import(`${R}/engine/chart.ts`);
const { jieOfYear } = await import(`${R}/engine/solarTerms.ts`);
// 프로젝트의 타입 선언은 Solar만 다루므로 Lunar·EightChar는 any로 쓴다
const lunarJs: any = (await import('lunar-javascript')).default;

const DIR = process.argv[2];
if (!DIR) throw new Error('출력 폴더를 인자로 주세요');
const STEMS = '甲乙丙丁戊己庚辛壬癸', BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const gz = (p: any) => (p ? STEMS.charAt(p.stem) + BRANCHES.charAt(p.branch) : null);
const KST = 9 * 3_600_000, BJ = 8 * 3_600_000;
const civil = (ms: number) => { const d = new Date(ms); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }; };

/** lunar-javascript 팔자(晚子时 일주 당일 = sect 2, 라이브러리 기본값) */
function lunarEc(t: { y: number; m: number; d: number; h: number; mi: number; s?: number }) {
  const ec = lunarJs.Solar.fromYmdHms(t.y, t.m, t.d, t.h, t.mi, t.s ?? 0).getLunar().getEightChar();
  ec.setSect(2);
  return { year: ec.getYear(), month: ec.getMonth(), day: ec.getDay(), hour: ec.getTime() };
}

/** 가장 가까운 절입까지 시간(시간 단위, 부호 있음) */
function jieDistHours(instantMs: number, year: number) {
  const all = [...jieOfYear(Math.max(1900, year - 1)), ...jieOfYear(year), ...jieOfYear(Math.min(2050, year + 1))];
  return all.map((j) => (instantMs - j.instantMs) / 3_600_000).sort((a, b) => Math.abs(a) - Math.abs(b))[0]!;
}

function row(id: string, input: any) {
  const ch = buildChart(input, { referenceYear: 2026 });
  const p = ch.pillars;
  const hasTime = input.time !== null;
  const clock = input.time ?? (input.hourOnly !== undefined ? { hour: input.hourOnly, minute: 0 } : { hour: 12, minute: 0 });
  const sd = ch.solarDate;
  // 라이브러리 기본: 입력한 벽시계 시각을 그대로(서머타임·UTC+8:30·경도 보정 없음). 음력 입력은 라이브러리의 (중국) 음력으로 변환
  let entered = { y: sd.year, m: sd.month, d: sd.day, h: clock.hour, mi: clock.minute };
  if (input.calendar === 'lunar') {
    const s = lunarJs.Lunar.fromYmdHms(input.year, input.isLeapMonth ? -input.month : input.month, input.day, clock.hour, clock.minute, 0).getSolar();
    entered = { y: s.getYear(), m: s.getMonth(), d: s.getDay(), h: clock.hour, mi: clock.minute };
  }
  const bj = civil(ch.time.instantMs + BJ);
  const lst = ch.time.localSolarTime;
  const local = { y: lst.year, m: lst.month, d: lst.day, h: lst.hour, mi: lst.minute };
  const def = lunarEc(entered);
  const ym = lunarEc(bj), dh = lunarEc(local);
  const aligned = { year: ym.year, month: ym.month, day: dh.day, hour: dh.hour };
  const ld = ch.lunarDate;
  return {
    id, calendar: input.calendar, hasTime, hourKnown: hasTime,
    ours: { year: gz(p.year), month: gz(p.month), day: gz(p.day), hour: gz(p.hour) },
    ourSolar: { y: sd.year, m: sd.month, d: sd.day },
    ourLunar: { y: ld.year, m: ld.month, d: ld.day, leap: ld.isLeapMonth },
    entered, bj, local, offsetMin: ch.time.utcOffsetMinutes,
    lunarDefault: def, lunarAligned: aligned,
    jieHours: jieDistHours(ch.time.instantMs, sd.year),
  };
}

// 1) 점검표 30건(입력은 Docs/MANSERYEOK_CHECK.md와 같다)
const S = (y: number, m: number, d: number, h: number | null, mi = 0) => ({ calendar: 'solar', isLeapMonth: false, year: y, month: m, day: d, time: h === null ? null : { hour: h, minute: mi } });
const L = (y: number, m: number, d: number, leap: boolean, h: number | null, mi = 0) => ({ calendar: 'lunar', isLeapMonth: leap, year: y, month: m, day: d, time: h === null ? null : { hour: h, minute: mi } });
const seoul = { birthplaceLongitude: 126.98 }, busan = { birthplaceLongitude: 129.05 }, gangneung = { birthplaceLongitude: 128.88 }, namhae = { birthplaceLongitude: 127.89 };
function aroundJie(year: number, name: string, minutes: number) {
  const j = jieOfYear(year).find((x: any) => x.name === name)!;
  const c = civil(j.instantMs + KST + minutes * 60_000);
  return { year: c.y, month: c.m, day: c.d, time: { hour: c.h, minute: c.mi } };
}
const cases: [string, any][] = [];
for (const [year, name, gender, place] of [[2024, '입춘', 'male', seoul], [1990, '입춘', 'female', seoul], [1997, '망종', 'male', busan]] as const)
  for (const m of [-10, 10]) cases.push([String(cases.length + 1), { calendar: 'solar', isLeapMonth: false, ...aroundJie(year, name, m), gender, ...place }]);
const more: any[] = [
  { ...S(2024, 2, 4, null), gender: 'male', ...seoul },
  { ...S(1995, 8, 10, 23, 50), gender: 'male', ...seoul },
  { ...S(1995, 8, 11, 0, 20), gender: 'male', ...seoul },
  { ...S(1999, 12, 31, 23, 30), gender: 'female', ...seoul },
  { ...S(2001, 3, 21, 7, 25), gender: 'female', ...seoul },
  { ...S(2001, 3, 21, 7, 25), gender: 'female', ...gangneung },
  { ...S(1987, 7, 15, 10, 20), gender: 'female', ...seoul },
  { ...S(1988, 5, 8, 2, 30), gender: 'male', ...seoul },
  { ...S(1988, 10, 9, 2, 30), gender: 'male', ...seoul },
  { ...S(1958, 3, 1, 12, 0), gender: 'male', ...seoul },
  { ...S(1956, 11, 20, 12, 0), gender: 'male', ...busan },
  { ...L(2020, 4, 15, true, 9, 0), gender: 'female', ...seoul },
  { ...L(1984, 10, 5, true, 15, 0), gender: 'male', ...seoul },
  { calendar: 'lunar', isLeapMonth: false, year: 1967, month: 7, day: 1, time: null, hourOnly: 8, gender: 'male', ...namhae },
  { ...L(2050, 11, 18, false, 12, 0), gender: 'female', ...seoul },
  { ...S(1900, 1, 31, 12, 0), gender: 'male', ...seoul },
  { ...S(1993, 11, 21, 12, 0), gender: 'male', ...seoul },
  { ...S(1993, 11, 21, 12, 0), gender: 'female', ...seoul },
  { ...S(1979, 3, 20, 5, 30), gender: 'male', ...seoul },
  { ...S(1990, 5, 15, 14, 30), gender: 'male', ...seoul },
  { ...S(2010, 7, 20, 7, 7), gender: 'male', ...seoul },
  { ...S(1988, 9, 17, null), gender: 'female', ...seoul },
  { ...S(1979, 3, 20, 5, 30), gender: 'male', ...seoul },
  { ...S(1956, 11, 20, 12, 0), gender: 'male', birthplaceLongitude: 129.05 },
];
for (const inp of more) cases.push([String(cases.length + 1), inp]);
const caseRows = cases.map(([id, inp]) => row(id, inp));

// 2) 무작위 출생(재현 가능한 시드). 일반 표본 + 절입 ±1일 집중 표본
let seed = 20261029;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const LONS = [126.98, 129.05, 128.88, 126.85, 126.53, 127.39, 128.6]; // 서울·부산·강릉·광주·제주·대전·대구
const START = Date.UTC(1900, 0, 1), END = Date.UTC(2050, 11, 31);
const sweep: any[] = [];
const push = (tag: string, wallMs: number) => {
  const c = civil(wallMs);
  const hour = Math.floor(rnd() * 24), minute = rnd() < 0.3 ? 0 : Math.floor(rnd() * 60);
  const input = { calendar: 'solar', isLeapMonth: false, year: c.y, month: c.m, day: c.d, time: { hour, minute }, gender: rnd() < 0.5 ? 'male' : 'female', birthplaceLongitude: LONS[Math.floor(rnd() * LONS.length)] };
  try { sweep.push({ tag, ...row(`${tag}${sweep.length}`, input) }); } catch (e: any) { sweep.push({ tag, id: `${tag}${sweep.length}`, error: String(e?.message ?? e), input }); }
};
for (let i = 0; i < 5000; i++) push('R', START + Math.floor(rnd() * ((END - START) / 86_400_000 + 1)) * 86_400_000);
for (let i = 0; i < 2000; i++) {
  const y = 1900 + Math.floor(rnd() * 151);
  const j = jieOfYear(y)[Math.floor(rnd() * 12)]!;
  const wall = j.instantMs + KST + Math.floor((rnd() * 2 - 1) * 86_400_000);
  if (wall < START || wall >= END + 86_400_000) continue;
  push('J', Math.floor(wall / 86_400_000) * 86_400_000);
}
writeFileSync(`${DIR}/libcmp-data.json`, JSON.stringify({ cases: caseRows, sweep }), 'utf8');
console.log('cases', caseRows.length, 'sweep', sweep.length, 'errors', sweep.filter((s) => s.error).length);
