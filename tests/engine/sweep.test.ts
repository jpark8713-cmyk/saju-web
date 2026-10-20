// 1900~2050년 전체 날짜 교차검증 (매일 한국 표준시 12:00).
// - 엔진 4주(시주 포함) == lunar-javascript
// - 일주 == manseryeok 일진
// - 년·월주 == manseryeok, 단 manseryeok은 하루 단위 데이터라 절입일은 제외하고, 깨진 날짜는 목록으로 고정(Docs/decisions.md D-004)
import { getGapja } from '@fullstackfamily/manseryeok';
import { describe, expect, it } from 'vitest';
import { pillarHanja } from '../../src/engine/constants';
import { jieOfYear } from '../../src/engine/solarTerms';
import { enginePillars, lunarJsPillars } from './crossCheck';
import { chartOf, solar } from './helpers';

/** manseryeok 1.0.8 데이터 결함 (절입일이 아닌데 년·월주가 틀린 날) */
const MANSERYEOK_BROKEN_DAYS = [
  '1908-12-31', '1912-12-31', '1948-12-31', '1949-12-31', '1950-12-31', '1951-12-31',
  '1955-12-31', '1957-12-31', '1958-12-31', '1959-12-31', '1960-12-31', '1961-12-31',
];
/** manseryeok 1.0.8에 데이터가 없는 날 */
const MANSERYEOK_MISSING_DAYS = ['1956-12-31'];

/** manseryeok 1.0.8에서 절입 전날·다음날 년·월주가 하루 어긋나는 날 수 */
const NEAR_JIE_MISMATCH_COUNT = 245;

const DAY_MS = 86_400_000;
const KST_MS = 9 * 3_600_000;

/** 그날(한국 표준시) 기준 앞뒤 spanDays일 안에 절입이 있는지 */
function hasJieWithin(year: number, month: number, day: number, spanDays: number): boolean {
  const start = Date.UTC(year, month - 1, day) - KST_MS - spanDays * DAY_MS;
  const end = Date.UTC(year, month - 1, day) - KST_MS + (spanDays + 1) * DAY_MS;
  return [year - 1, year, year + 1]
    .flatMap((y) => jieOfYear(y))
    .some((j) => j.instantMs >= start && j.instantMs < end);
}

describe('1900~2050 전체 날짜 교차검증', () => {
  it('엔진·lunar-javascript·manseryeok', { timeout: 600_000 }, () => {
    const libMismatch: string[] = [];
    const dayMismatch: string[] = [];
    const ymMismatch: string[] = [];
    const nearJieMismatch: string[] = [];
    const missing: string[] = [];
    let jieDays = 0;
    let days = 0;
    // 서머타임 영향을 빼고 날짜 단위 비교만 하려고 표준시(UTC+9) 기준으로 본다
    const settings = { historicalTimezone: false } as const;
    for (let t = Date.UTC(1900, 0, 1); t <= Date.UTC(2050, 11, 31); t += DAY_MS) {
      const d = new Date(t);
      const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
      const key = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      const chart = chartOf(solar(y, m, dd, { hour: 12, minute: 0 }), settings);
      days++;
      const mine = enginePillars(chart);
      const lib = lunarJsPillars(chart);
      if (JSON.stringify(mine) !== JSON.stringify(lib)) libMismatch.push(`${key} ${JSON.stringify(mine)} ${JSON.stringify(lib)}`);

      let g;
      try {
        g = getGapja(y, m, dd);
      } catch {
        missing.push(key);
        continue;
      }
      if (g.dayPillarHanja !== mine.day) dayMismatch.push(key);
      if (hasJieWithin(y, m, dd, 0)) {
        jieDays++;
        continue;
      }
      if (g.yearPillarHanja === pillarHanja(chart.pillars.year) && g.monthPillarHanja === mine.month) continue;
      // 절입 다음날·전날: manseryeok은 하루 단위로 월을 바꾸면서 하루 어긋나는 경우가 있다
      if (hasJieWithin(y, m, dd, 1)) nearJieMismatch.push(key);
      else ymMismatch.push(key);
    }
    expect(days).toBe(55152);
    expect(libMismatch).toEqual([]);
    expect(dayMismatch).toEqual([]);
    expect(missing).toEqual(MANSERYEOK_MISSING_DAYS);
    expect(ymMismatch).toEqual(MANSERYEOK_BROKEN_DAYS);
    expect(jieDays).toBeGreaterThan(1800); // 12절 × 151년
    // 결정 기록(D-004)에 적은 건수. 라이브러리 버전이 바뀌면 다시 확인한다
    expect(nearJieMismatch.length).toBe(NEAR_JIE_MISMATCH_COUNT);
  });
});
