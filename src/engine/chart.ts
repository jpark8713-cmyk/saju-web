// 입력 → SajuChart. 엔진의 진입점.
import { CalendarInputError, toLunar, toSolar, type SolarDate } from './calendar';
import { computeDaewoon, computeDaewoonStart, computeSeun } from './daewoon';
import { computeElements } from './elements';
import { buildNotices } from './notices';
import { computePillars } from './pillars';
import { computeRelations } from './relations';
import { DEFAULT_SETTINGS, LONGITUDE_RANGE, isValidClock, validateSettings } from './settings';
import { jieOfYear, type JieInstant } from './solarTerms';
import { computeTenGods } from './tenGods';
import { resolveBirthTime, resolveSeoulWallTime } from './time';
import type { CalcSettings, ChartWarning, SajuChart, SajuInput } from './types';

export interface ChartOptions {
  /** "올해"로 볼 연도. 엔진을 순수하게 유지하려고 현재 시각 대신 인자로 받는다 */
  referenceYear: number;
  settings?: Partial<CalcSettings>;
}

const KST_STANDARD_MS = 9 * 3_600_000;

function validateInput(input: SajuInput): void {
  if (input.gender !== 'male' && input.gender !== 'female') {
    throw new CalendarInputError('invalidInput', '성별 값이 올바르지 않습니다');
  }
  if (input.time !== null && !isValidClock(input.time)) {
    throw new CalendarInputError('invalidInput', '태어난 시각 형식이 올바르지 않습니다');
  }
  const lon = input.birthplaceLongitude;
  if (lon !== undefined && (!Number.isFinite(lon) || lon < LONGITUDE_RANGE.min || lon > LONGITUDE_RANGE.max)) {
    throw new CalendarInputError('invalidInput', `출생지 경도는 동경 ${LONGITUDE_RANGE.min}~${LONGITUDE_RANGE.max}도 범위여야 합니다`);
  }
}

function resolveSolarDate(input: SajuInput): SolarDate {
  const date = { year: input.year, month: input.month, day: input.day };
  if (input.calendar === 'lunar') return toSolar({ ...date, isLeapMonth: input.isLeapMonth });
  toLunar(date); // 범위·유효성 검사
  return date;
}

/** 그날(한국 벽시계 00:00~24:00) 안의 절입. 시간 모름이면 년·월주가 바뀔 수 있다 */
function jieOnDay(d: SolarDate, historicalTimezone: boolean): JieInstant | null {
  const start = historicalTimezone
    ? resolveSeoulWallTime({ ...d, hour: 0, minute: 0 }).instantMs
    : Date.UTC(d.year, d.month - 1, d.day) - KST_STANDARD_MS;
  const end = start + 86_400_000;
  return jieOfYear(d.year).find((j) => j.instantMs >= start && j.instantMs < end) ?? null;
}

export function buildChart(input: SajuInput, options: ChartOptions): SajuChart {
  validateInput(input);
  const settings: CalcSettings = { ...DEFAULT_SETTINGS, ...options.settings };
  validateSettings(settings);
  const solarDate = resolveSolarDate(input);
  const lunarDate = toLunar(solarDate);
  const hasTime = input.time !== null;
  const clock = input.time ?? settings.unknownTimeAssumption;
  const longitudeUsed = input.birthplaceLongitude ?? settings.defaultLongitude;
  const time = resolveBirthTime({ ...solarDate, ...clock }, settings, longitudeUsed);

  const pillars = computePillars({ instantMs: time.instantMs, local: time.localSolarTime, hasTime, jasiMode: settings.jasiMode });
  const daewoonStart = computeDaewoonStart(time.instantMs, pillars.year.stem, input.gender, settings.daewoonRounding);
  const daewoon = computeDaewoon(pillars.month, daewoonStart, { ...solarDate, ...clock }, settings.daewoonCount);

  const dayJie = hasTime ? null : jieOnDay(solarDate, settings.historicalTimezone);
  const warnings: ChartWarning[] = [
    ...(dayJie ? (['unknownTimeOnJieDay'] as const) : []),
    ...(time.nonexistentWallTime ? (['nonexistentWallTime'] as const) : []),
    ...(time.ambiguousWallTime ? (['ambiguousWallTime'] as const) : []),
  ];

  return {
    input: { calendar: input.calendar, hasTime, gender: input.gender },
    solarDate,
    lunarDate,
    pillars,
    elements: computeElements(pillars),
    tenGods: computeTenGods(pillars),
    relations: computeRelations(pillars),
    daewoonStart,
    daewoon,
    seun: computeSeun([options.referenceYear, options.referenceYear + 1]),
    settings: { ...settings, longitudeUsed },
    time,
    warnings,
    notices: buildNotices(warnings, dayJie, settings.historicalTimezone),
  };
}
