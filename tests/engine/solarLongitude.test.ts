// 천문연 대조가 없는 구간(1900~1999, 2029~2050)의 절입 시각을 태양 황경 독립 계산과 비교한다.
// 엔진(jieOfYear)과 lunar-javascript 절기표를 각각 따로 비교한다(Docs/decisions.md D-012).
import lunarJs from 'lunar-javascript';
import { describe, expect, it } from 'vitest';
import { JIE_TERMS, jieOfYear } from '../../src/engine/solarTerms';
import { JIE_LONGITUDE, solveSolarLongitude } from './sunLongitude';

const TOLERANCE_MIN = 15;
const BEIJING_MS = 8 * 3_600_000;

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** lunar-javascript 절기표를 엔진을 거치지 않고 직접 읽는다 */
function lunarJsJie(year: number, key: string): number {
  const s = lunarJs.Solar.fromYmd(year, 6, 1).getLunar().getJieQiTable()[key];
  if (!s) throw new Error(`${year} ${key} 없음`);
  return Date.UTC(s.getYear(), s.getMonth() - 1, s.getDay(), s.getHour(), s.getMinute(), s.getSecond()) - BEIJING_MS;
}

const YEARS = [...range(1900, 1999), ...range(2029, 2050)];

describe('태양 황경 독립 계산과 절입 시각 비교 (±15분)', () => {
  it.each(YEARS)('%i년 12절', (year) => {
    const errors: string[] = [];
    let maxDiff = 0;
    for (const t of JIE_TERMS) {
      const target = JIE_LONGITUDE[t.ko]!;
      const engine = jieOfYear(year).find((j) => j.name === t.ko)!.instantMs;
      const lib = lunarJsJie(year, t.key);
      const independent = solveSolarLongitude(target, engine);
      for (const [label, ms] of [['엔진', engine], ['lunar-javascript', lib]] as const) {
        const diff = Math.abs(ms - independent) / 60_000;
        maxDiff = Math.max(maxDiff, diff);
        if (diff > TOLERANCE_MIN) errors.push(`${t.ko} ${label} ${diff.toFixed(1)}분`);
      }
    }
    expect(errors).toEqual([]);
    expect(maxDiff).toBeLessThanOrEqual(TOLERANCE_MIN);
  });
});
