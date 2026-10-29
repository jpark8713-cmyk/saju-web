// 입력 → SajuChart. 엔진의 진입점.
import { CalendarInputError, resolveSolarDate, toLunar, type SolarDate } from './calendar';
import { minuteSegments } from './minute';
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
  if (input.hourOnly !== undefined && (input.time !== null || !isValidClock({ hour: input.hourOnly, minute: 0 }))) {
    throw new CalendarInputError('invalidInput', '분 모름 시각 형식이 올바르지 않습니다');
  }
  const lon = input.birthplaceLongitude;
  if (lon !== undefined && (!Number.isFinite(lon) || lon < LONGITUDE_RANGE.min || lon > LONGITUDE_RANGE.max)) {
    throw new CalendarInputError('invalidInput', `출생지 경도는 동경 ${LONGITUDE_RANGE.min}~${LONGITUDE_RANGE.max}도 범위여야 합니다`);
  }
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
  // 분을 몰라 경계 전후를 정하지 못했으면(D-039) 그 시의 0분으로 년·월·일주와 대운을 계산하고 시주는 비운다
  const hourOnly = input.time === null ? input.hourOnly : undefined;
  const clock = input.time ?? (hourOnly !== undefined ? { hour: hourOnly, minute: 0 } : settings.unknownTimeAssumption);
  const longitudeUsed = input.birthplaceLongitude ?? settings.defaultLongitude;
  const time = resolveBirthTime({ ...solarDate, ...clock }, settings, longitudeUsed);

  const segments = hourOnly !== undefined ? minuteSegments({ ...input, time: { hour: hourOnly, minute: 0 } }, settings) : [];
  const computed = computePillars({ instantMs: time.instantMs, local: time.localSolarTime, hasTime, jasiMode: settings.jasiMode });
  // 분 모름: 일주도 0분 구간의 값으로 맞춘다(통자시에서 23시대는 시를 알아야 다음 날 일주가 되므로 시주 없는 계산과 갈린다)
  const pillars = segments[0] ? { ...computed, day: segments[0].pillars.day } : computed;
  const daewoonStart = computeDaewoonStart(time.instantMs, pillars.year.stem, input.gender, settings.daewoonRounding);
  const daewoon = computeDaewoon(pillars.month, daewoonStart, { ...solarDate, ...clock }, settings.daewoonCount);

  // 시를 알면 그날 다른 시각의 절입은 상관없다(그 시 안의 절입은 분 구간이 잡는다)
  const dayJie = hasTime || hourOnly !== undefined ? null : jieOnDay(solarDate, settings.historicalTimezone);
  const warnings: ChartWarning[] = [
    ...(dayJie ? (['unknownTimeOnJieDay'] as const) : []),
    ...(segments.length > 1 ? (['unknownMinuteOnBoundary'] as const) : []),
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
    // 두 번 있는 시각의 앞 순간이 UTC+9면 서머타임 종료가 아니라 1954-03-21 표준시 변경으로 생긴 겹침이다(서머타임 중에는 UTC+10·UTC+9:30)
    notices: buildNotices(
      warnings,
      dayJie,
      settings.historicalTimezone,
      hourOnly !== undefined ? { hour: hourOnly, segments } : null,
      time.ambiguousWallTime && time.utcOffsetMinutes === 540 ? 'standardChange' : 'dst',
    ),
  };
}
