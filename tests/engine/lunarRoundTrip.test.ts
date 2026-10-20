// 양력 → 음력 → 양력 왕복: 지원 범위의 모든 양력 날짜가 같은 날로 돌아와야 한다.
// 라이브러리의 음력→양력 조회가 다음 해 1~2월로 넘어가는 음력 11·12월을 못 찾던 문제(D-026)의 회귀 테스트.
import { describe, expect, it } from 'vitest';
import { toLunar, toSolar, type SolarDate } from '../../src/engine/calendar';

const DAY_MS = 86_400_000;

describe('음력 변환 왕복', () => {
  it('1900-02-01 ~ 2050-12-31의 모든 날짜가 왕복된다', () => {
    const failures: string[] = [];
    // 1900년 1월은 음력 1899년이라 범위 밖이므로 2월부터 본다
    for (let t = Date.UTC(1900, 1, 1); t <= Date.UTC(2050, 11, 31); t += DAY_MS) {
      const d = new Date(t);
      const s: SolarDate = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
      const l = toLunar(s);
      if (l.year < 1900) continue;
      try {
        const back = toSolar(l);
        if (back.year !== s.year || back.month !== s.month || back.day !== s.day) failures.push(`${JSON.stringify(s)} → ${JSON.stringify(back)}`);
      } catch (e) {
        failures.push(`${JSON.stringify(s)} (${JSON.stringify(l)}): ${(e as Error).message}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  }, 120_000);

  it('리뷰에서 재현된 음력 12월 날짜를 변환한다', () => {
    expect(toSolar({ year: 1990, month: 12, day: 10, isLeapMonth: false })).toEqual({ year: 1991, month: 1, day: 25 });
  });

  it('없는 날짜·없는 윤달은 여전히 거부한다', () => {
    expect(() => toSolar({ year: 1990, month: 12, day: 31, isLeapMonth: false })).toThrow();
    expect(() => toSolar({ year: 2023, month: 12, day: 10, isLeapMonth: true })).toThrow();
  });
});
