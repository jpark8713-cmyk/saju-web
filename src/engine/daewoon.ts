// 대운: 양년생 남자·음년생 여자는 순행(다음 절입까지), 그 외는 역행(이전 절입부터).
// 대운수는 3일=1년, 1일=4개월, 1시간=5일로 환산해 년·개월까지 쓴다(나머지는 버림).
// 출생~절입 시간의 초 단위는 설정 daewoonRounding(기본 버림)으로 분에 맞춘다(Docs/decisions.md D-005).
import { cycleIndex, pillarFromCycle, stemYinYang } from './constants';
import { nextJie, prevJie } from './solarTerms';
import type { CalcSettings, DaewoonEntry, DaewoonStart, Gender, Pillar, SeunEntry } from './types';

const MINUTES_PER_YEAR = 3 * 24 * 60; // 3일
const MINUTES_PER_MONTH = 6 * 60; // 6시간 (1일 = 4개월)
const MINUTES_PER_DAY = 12; // 12분 (1시간 = 5일)

export function isForward(yearStem: number, gender: Gender): boolean {
  const yang = stemYinYang(yearStem) === 'yang';
  return (yang && gender === 'male') || (!yang && gender === 'female');
}

export function computeDaewoonStart(
  birthMs: number,
  yearStem: number,
  gender: Gender,
  rounding: CalcSettings['daewoonRounding'] = 'floor',
): DaewoonStart {
  const forward = isForward(yearStem, gender);
  const jie = forward ? nextJie(birthMs) : prevJie(birthMs);
  const toMinutes = rounding === 'round' ? Math.round : Math.floor;
  const minutes = toMinutes(Math.abs(jie.instantMs - birthMs) / 60_000);
  const years = Math.floor(minutes / MINUTES_PER_YEAR);
  const afterYears = minutes - years * MINUTES_PER_YEAR;
  const months = Math.floor(afterYears / MINUTES_PER_MONTH);
  const days = Math.floor((afterYears - months * MINUTES_PER_MONTH) / MINUTES_PER_DAY);
  return { years, months, days, forward, jieInstantMs: jie.instantMs, jieName: jie.name };
}

function addMonths(year: number, month: number, add: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + add;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** 월주에서 한 칸씩 순행·역행한 대운 목록 */
export function computeDaewoon(
  monthPillar: Pillar,
  start: DaewoonStart,
  birth: { year: number; month: number },
  count: number,
): DaewoonEntry[] {
  const base = cycleIndex(monthPillar);
  const step = start.forward ? 1 : -1;
  return Array.from({ length: count }, (_, i) => {
    const offsetMonths = start.years * 12 + start.months + i * 120;
    const at = addMonths(birth.year, birth.month, offsetMonths);
    return {
      index: i,
      pillar: pillarFromCycle(base + step * (i + 1)),
      startOffset: { years: Math.floor(offsetMonths / 12), months: offsetMonths % 12 },
      startYear: at.year,
      startMonth: at.month,
      koreanAge: at.year - birth.year + 1,
    };
  });
}

/** 세운: 해당 연도(입춘 이후 기준)의 년주 */
export function computeSeun(years: readonly number[]): SeunEntry[] {
  return years.map((year) => ({ year, pillar: pillarFromCycle(year - 4) }));
}
