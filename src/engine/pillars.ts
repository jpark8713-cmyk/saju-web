// 4주 계산. 시간 모름이면 시주는 null(3주).
// 년주: 입춘 순간 기준, 월주: 직전 절입 순간 기준, 일주·시주: 경도 보정 현지 시각 기준.
import { mod, pillarFromCycle } from './constants';
import { ipchunOf, prevJie } from './solarTerms';
import type { CivilDateTime, JasiMode, Pillar, PillarSet } from './types';

const DAY_MS = 86_400_000;
const UNIX_EPOCH_JDN = 2_440_588;

/** 율리우스 적일(정오 기준 정수) */
export function julianDayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS) + UNIX_EPOCH_JDN;
}

/** 해당 양력 날짜의 일진 (60갑자는 날마다 하나씩 순환한다) */
export function dayPillarOfDate(year: number, month: number, day: number): Pillar {
  return pillarFromCycle(julianDayNumber(year, month, day) + 49);
}

/** 년주: 입춘 이전이면 전년 */
export function yearPillarAt(instantMs: number): { pillar: Pillar; sajuYear: number } {
  const civilYear = new Date(instantMs).getUTCFullYear();
  const sajuYear = instantMs >= ipchunOf(civilYear) ? civilYear : civilYear - 1;
  return { pillar: pillarFromCycle(sajuYear - 4), sajuYear };
}

/** 월주: 월지는 직전 절입, 월간은 년간 기준 오호둔법(갑기년 병인월 시작) */
export function monthPillarAt(instantMs: number, yearStem: number): Pillar {
  const branch = prevJie(instantMs).branch;
  const inStemOfYear = mod((yearStem % 5) * 2 + 2, 10);
  // 인월이 첫 달이고 자·축월은 그 해의 11·12번째 달이다
  return { stem: mod(inStemOfYear + mod(branch - 2, 12), 10), branch };
}

/** 시지: 23~01시 자, 01~03시 축 ... */
export function hourBranchOf(hour: number): number {
  return Math.floor((hour + 1) / 2) % 12;
}

/** 시간: 일간 기준 오자시두법(갑기일 갑자시 시작) */
export function hourStemOf(dayStem: number, hourBranch: number): number {
  return mod((dayStem % 5) * 2 + hourBranch, 10);
}

function nextDay(dt: CivilDateTime): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(dt.year, dt.month - 1, dt.day) + DAY_MS);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/**
 * 일주·시주. local은 경도 보정이 반영된 현지 시각.
 * - split(야자시/조자시): 23시대는 일주는 당일, 시주는 다음날 일간 기준 자시
 * - unified(통자시): 23시부터 일주가 다음날로 넘어간다
 */
export function dayAndHourPillars(
  local: CivilDateTime,
  jasiMode: JasiMode,
  hasTime: boolean,
): { day: Pillar; hour: Pillar | null } {
  const today = dayPillarOfDate(local.year, local.month, local.day);
  if (!hasTime) return { day: today, hour: null };
  const isLateJasi = local.hour === 23;
  const tomorrowDate = nextDay(local);
  const tomorrow = dayPillarOfDate(tomorrowDate.year, tomorrowDate.month, tomorrowDate.day);
  const day = isLateJasi && jasiMode === 'unified' ? tomorrow : today;
  const stemBase = isLateJasi ? tomorrow : today;
  const branch = hourBranchOf(local.hour);
  return { day, hour: { stem: hourStemOf(stemBase.stem, branch), branch } };
}

export interface PillarCalc {
  instantMs: number;
  local: CivilDateTime;
  hasTime: boolean;
  jasiMode: JasiMode;
}

export function computePillars(c: PillarCalc): PillarSet {
  const { pillar: year } = yearPillarAt(c.instantMs);
  const month = monthPillarAt(c.instantMs, year.stem);
  const { day, hour } = dayAndHourPillars(c.local, c.jasiMode, c.hasTime);
  return { year, month, day, hour };
}
