// 만 나이 한 곳(D-057): 대운 시작 표기의 만 나이와 아이 리포트 판정의 만 나이가 같은 규칙인지
import { describe, expect, it } from 'vitest';
import { fullAge } from '../../src/engine/age';
import { daewoonStartAge } from '../../src/engine/daewoon';
import { SAMPLE_INPUTS } from '../../src/llm/samples';
import { fullAge as audienceFullAge } from '../../src/report/audience';
import { chartOf, solar } from './helpers';

describe('만 나이(fullAge)', () => {
  const birth = { year: 1956, month: 11, day: 8 };
  it.each([
    [{ year: 2026, month: 11, day: 7 }, 69],
    [{ year: 2026, month: 11, day: 8 }, 70], // 생일 당일은 지난 것으로 본다
    [{ year: 2026, month: 7, day: 20 }, 69],
    [{ year: 2026, month: 12, day: 1 }, 70],
  ])('1956-11-08생, %o → 만 %i세', (asOf, age) => {
    expect(fullAge(birth, asOf)).toBe(age);
  });
  it('2월 29일생은 평년 2월 28일에는 아직, 3월 1일에는 지난 것으로 본다', () => {
    const leap = { year: 2000, month: 2, day: 29 };
    expect(fullAge(leap, { year: 2021, month: 2, day: 28 })).toBe(20);
    expect(fullAge(leap, { year: 2021, month: 3, day: 1 })).toBe(21);
  });
  it('아이 리포트 판정 쪽(report/audience)은 같은 함수다', () => {
    expect(audienceFullAge).toBe(fullAge);
  });
});

describe('대운 시작 만 나이와 아이 판정 만 나이가 늘 같다', () => {
  // 샘플 입력 전부 + 생일·월말·윤일 경계가 걸리는 입력
  const inputs = [
    ...SAMPLE_INPUTS,
    solar(2000, 2, 29, { hour: 9, minute: 0 }),
    solar(1988, 12, 31, { hour: 23, minute: 50 }),
    solar(1970, 1, 1, { hour: 0, minute: 10 }, { gender: 'female' }),
    solar(2015, 8, 15, null),
  ];
  it.each(inputs.map((inp, i) => [i, inp] as const))('입력 %i', (_i, inp) => {
    const c = chartOf(inp);
    for (const d of c.daewoon) {
      const start = { year: d.startYear, month: d.startMonth, day: d.startDay };
      expect(daewoonStartAge(d, c.solarDate)).toBe(fullAge(c.solarDate, start));
      expect(daewoonStartAge(d, c.solarDate)).toBe(audienceFullAge(c.solarDate, start));
      // 대운이 시작되는 날의 만 나이는 대운수(만 기준 경과 년)보다 작지 않고 1을 넘게 크지 않다
      expect(daewoonStartAge(d, c.solarDate) - d.startOffset.years).toBeGreaterThanOrEqual(0);
      expect(daewoonStartAge(d, c.solarDate) - d.startOffset.years).toBeLessThanOrEqual(1);
    }
  });
});
