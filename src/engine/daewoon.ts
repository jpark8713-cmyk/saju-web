// 대운: 양년생 남자·음년생 여자는 순행(다음 절입까지), 그 외는 역행(이전 절입부터).
// 대운수는 3일=1년, 1일=4개월, 1시간=5일로 환산해 년·개월까지 쓴다(나머지는 버림).
// 출생~절입 시간의 초 단위는 설정 daewoonRounding(기본 버림)으로 분에 맞춘다(Docs/decisions.md D-005).
import { fullAge } from './age';
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
  const afterMonths = afterYears - months * MINUTES_PER_MONTH;
  const days = Math.floor(afterMonths / MINUTES_PER_DAY);
  // 남은 분(0~11분)은 1분 = 2시간으로 환산한다 (1일 = 12분 = 24시간)
  const hours = (afterMonths - days * MINUTES_PER_DAY) * 2;
  return { years, months, days, hours, forward, jieInstantMs: jie.instantMs, jieName: jie.name };
}

interface YMD {
  year: number;
  month: number;
  day: number;
}

/** 출생 벽시계 시각 (한국 시각). 시간 모름이면 계산에 쓴 가정 시각 */
interface BirthDateTime extends YMD {
  hour: number;
  minute: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 날짜 + 년 → 개월 → 일 순서로 더한다. 더한 달에 그날이 없으면 그달 말일로 맞춘다(예: 2월 29일 + 1년 → 2월 28일).
 * lunar-javascript Yun.getStartSolar()와 같은 순서다(D-005).
 */
export function addYearsMonthsDays(d: YMD, years: number, months: number, days: number): YMD {
  const y1 = d.year + years;
  const day1 = Math.min(d.day, daysInMonth(y1, d.month));
  const totalMonths = y1 * 12 + (d.month - 1) + months;
  const y2 = Math.floor(totalMonths / 12);
  const m2 = (totalMonths % 12) + 1;
  const day2 = Math.min(day1, daysInMonth(y2, m2));
  const t = new Date(Date.UTC(y2, m2 - 1, day2) + days * 86_400_000);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 출생 시각 + 대운수(년·개월·일·시)의 날짜. lunar-javascript getStartSolar()와 같은 순서(년→개월→일→시) */
export function daewoonStartDate(birth: BirthDateTime, start: Pick<DaewoonStart, 'years' | 'months' | 'days' | 'hours'>, extraYears = 0): YMD {
  const ymd = addYearsMonthsDays(birth, start.years + extraYears, start.months, start.days);
  const t = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day, birth.hour, birth.minute) + start.hours * 3_600_000);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/**
 * 월주에서 한 칸씩 순행·역행한 대운 목록.
 * 시작일은 출생 시각(입력한 양력 날짜·한국 시각) + 대운수(년·개월·일·시) + 10년×순번이다(D-022).
 */
export function computeDaewoon(monthPillar: Pillar, start: DaewoonStart, birth: BirthDateTime, count: number): DaewoonEntry[] {
  const base = cycleIndex(monthPillar);
  const step = start.forward ? 1 : -1;
  return Array.from({ length: count }, (_, i) => {
    const offsetMonths = start.years * 12 + start.months + i * 120;
    const at = daewoonStartDate(birth, start, i * 10);
    return {
      index: i,
      pillar: pillarFromCycle(base + step * (i + 1)),
      startOffset: { years: Math.floor(offsetMonths / 12), months: offsetMonths % 12 },
      startYear: at.year,
      startMonth: at.month,
      startDay: at.day,
      koreanAge: at.year - birth.year + 1,
    };
  });
}

/** 대운 시작 시점의 표준 표기. 근거 문구와 풀이 문장에 이 표기만 쓴다(D-022) */
export function daewoonStartLabel(
  d: Pick<DaewoonEntry, 'koreanAge' | 'startYear' | 'startMonth' | 'startDay'>,
  birth: { year: number; month: number; day: number },
): string {
  return `${d.koreanAge}세(만 ${daewoonStartAge(d, birth)}세, ${d.startYear}년 ${d.startMonth}월)`;
}

/** 대운이 시작되는 날의 만 나이(아이 리포트 판정과 같은 fullAge). 저장된 예전 차트에도 쓰도록 엔트리에 저장하지 않고 계산한다 */
export function daewoonStartAge(
  d: Pick<DaewoonEntry, 'startYear' | 'startMonth' | 'startDay'>,
  birth: { year: number; month: number; day: number },
): number {
  return fullAge(birth, { year: d.startYear, month: d.startMonth, day: d.startDay });
}

/** 세운: 해당 연도(입춘 이후 기준)의 년주 */
export function computeSeun(years: readonly number[]): SeunEntry[] {
  return years.map((year) => ({ year, pillar: pillarFromCycle(year - 4) }));
}
