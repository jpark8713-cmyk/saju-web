// 양력·음력 변환. 한국 음력(윤달 위치)은 한국천문연구원 데이터 기반인 manseryeok을 쓴다.
import { InvalidDateError, OutOfRangeError, lunarToSolar, solarToLunar } from '@fullstackfamily/manseryeok';
import { SUPPORTED_RANGE } from './settings';

export interface SolarDate {
  year: number;
  month: number;
  day: number;
}

export interface LunarDate extends SolarDate {
  isLeapMonth: boolean;
}

export class CalendarInputError extends Error {
  constructor(
    readonly code: 'outOfRange' | 'invalidSolarDate' | 'invalidLunarDate' | 'invalidInput',
    message: string,
  ) {
    super(message);
    this.name = 'CalendarInputError';
  }
}

const DAY_MS = 86_400_000;

function addDays(d: SolarDate, days: number): SolarDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day) + days * DAY_MS);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function isValidSolarDate(d: SolarDate): boolean {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return t.getUTCFullYear() === d.year && t.getUTCMonth() + 1 === d.month && t.getUTCDate() === d.day;
}

function assertInRange(year: number): void {
  if (year < SUPPORTED_RANGE.minYear || year > SUPPORTED_RANGE.maxYear) {
    throw new CalendarInputError(
      'outOfRange',
      `${SUPPORTED_RANGE.minYear}~${SUPPORTED_RANGE.maxYear}년만 지원합니다`,
    );
  }
}

function isLibraryDateError(e: unknown): boolean {
  return e instanceof InvalidDateError || e instanceof OutOfRangeError;
}

/** 양력 → 음력. 라이브러리 데이터가 빠진 날(1956-12-31)은 전날 음력 + 1일로 메운다 */
export function toLunar(d: SolarDate): LunarDate {
  assertInRange(d.year);
  if (!isValidSolarDate(d)) {
    throw new CalendarInputError('invalidSolarDate', '존재하지 않는 양력 날짜입니다');
  }
  try {
    const r = solarToLunar(d.year, d.month, d.day);
    return { ...r.lunar };
  } catch (e) {
    if (!isLibraryDateError(e)) throw e;
    const prev = solarToLunar(...ymd(addDays(d, -1)));
    return { ...prev.lunar, day: prev.lunar.day + 1 };
  }
}

function ymd(d: SolarDate): [number, number, number] {
  return [d.year, d.month, d.day];
}

/**
 * 음력 → 양력. 윤달이 없는 달에 윤달을 지정하면 거부한다.
 * 지원 범위는 양력 기준이다: 변환한 양력이 범위 밖(예: 음력 2050-11-19 이후 → 양력 2051년)이면 범위 밖으로 거부한다(D-028).
 */
export function toSolar(d: LunarDate): SolarDate {
  assertInRange(d.year);
  let solar: SolarDate | null;
  try {
    solar = { ...lunarToSolar(d.year, d.month, d.day, d.isLeapMonth).solar };
  } catch (e) {
    if (!isLibraryDateError(e)) throw e;
    solar = fillLunarHole(d) ?? findInNextSolarYear(d);
  }
  // 라이브러리 자료는 양력 2051-01-01에서 끝난다. 음력 2050년 11·12월인데 양력 2050년 안에서 못 찾았으면 양력 2051년 이후다
  if (!solar && d.year === SUPPORTED_RANGE.maxYear && d.month >= 11 && d.day <= 30) assertInRange(SUPPORTED_RANGE.maxYear + 1);
  if (!solar) throw new CalendarInputError('invalidLunarDate', '존재하지 않는 음력 날짜입니다(윤달 여부를 확인해 주세요)');
  assertInRange(solar.year);
  return solar;
}

/**
 * 라이브러리의 lunarToSolar는 음력 연도와 같은 양력 연도 안에서만 찾는다(1.0.8).
 * 그래서 양력으로 다음 해 1~2월에 오는 음력 11·12월 날짜를 못 찾는다(D-026).
 * 다음 해 1월 1일~3월 1일을 양력→음력으로 훑어 같은 음력 날짜를 찾는다.
 */
function findInNextSolarYear(d: LunarDate): SolarDate | null {
  if (d.month < 11) return null;
  const start: SolarDate = { year: d.year + 1, month: 1, day: 1 };
  for (let i = 0; i <= 60; i++) {
    const s = addDays(start, i);
    // 지원 범위 다음 해(2051년)도 찾는다. 찾으면 toSolar가 범위 밖으로 거부한다
    const l = s.year > SUPPORTED_RANGE.maxYear ? rawLunar(s) : toLunar(s);
    if (!l) return null;
    if (l.year === d.year && l.month === d.month && l.day === d.day && l.isLeapMonth === d.isLeapMonth) return s;
  }
  return null;
}

/** 범위 검사 없이 라이브러리로 양력 → 음력 (라이브러리에 자료가 없으면 null) */
function rawLunar(s: SolarDate): LunarDate | null {
  try {
    return { ...solarToLunar(...ymd(s)).lunar };
  } catch (e) {
    if (isLibraryDateError(e)) return null;
    throw e;
  }
}

/** 라이브러리 데이터 구멍에 해당하는 음력 날짜인지 확인하고 양력을 돌려준다 */
function fillLunarHole(d: LunarDate): SolarDate | null {
  if (d.day < 2) return null;
  let prev: SolarDate;
  try {
    prev = lunarToSolar(d.year, d.month, d.day - 1, d.isLeapMonth).solar;
  } catch (e) {
    if (isLibraryDateError(e)) return null;
    throw e;
  }
  const candidate = addDays(prev, 1);
  try {
    solarToLunar(...ymd(candidate));
    return null; // 다음 날 데이터가 있으면 구멍이 아니다 → 원래 날짜가 존재하지 않음
  } catch (e) {
    if (!isLibraryDateError(e)) throw e;
    return candidate;
  }
}

/** 입력 날짜(양력 또는 음력) → 양력 날짜. 범위·유효성을 함께 검사한다 */
export function resolveSolarDate(input: { calendar: 'solar' | 'lunar'; isLeapMonth: boolean; year: number; month: number; day: number }): SolarDate {
  const date = { year: input.year, month: input.month, day: input.day };
  if (input.calendar === 'lunar') return toSolar({ ...date, isLeapMonth: input.isLeapMonth });
  toLunar(date); // 범위·유효성 검사
  return date;
}
