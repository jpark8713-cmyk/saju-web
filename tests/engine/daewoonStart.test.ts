// 대운 시작일: 출생 시각(한국 벽시계) + 대운수(년·개월·일·시). lunar-javascript getStartSolar()와 대조한다(D-022).
import lunarJs from 'lunar-javascript';
import { describe, expect, it } from 'vitest';
import { addYearsMonthsDays, daewoonStartLabel } from '../../src/engine/daewoon';
import { buildEvidence } from '../../src/engine/evidence';
import { chartOf, solar } from './helpers';

describe('addYearsMonthsDays (년 → 개월 → 일 순서, 말일 맞춤)', () => {
  it.each([
    [{ year: 1992, month: 2, day: 29 }, 1, 0, 0, { year: 1993, month: 2, day: 28 }],
    [{ year: 1992, month: 2, day: 29 }, 1, 1, 0, { year: 1993, month: 3, day: 28 }], // 년 먼저 맞춘 뒤 개월
    [{ year: 1990, month: 1, day: 31 }, 0, 1, 0, { year: 1990, month: 2, day: 28 }],
    [{ year: 1990, month: 5, day: 15 }, 7, 2, 20, { year: 1997, month: 8, day: 4 }],
    [{ year: 1999, month: 12, day: 25 }, 0, 0, 10, { year: 2000, month: 1, day: 4 }],
  ])('%o + %i년 %i개월 %i일', (d, y, m, dd, expected) => {
    expect(addYearsMonthsDays(d, y, m, dd)).toEqual(expected);
  });
});

describe('첫 대운 시작일이 lunar-javascript와 같다', () => {
  it('1902~2048년 표본 (대운수가 같은 경우)', { timeout: 120_000 }, () => {
    let compared = 0;
    const mismatches: string[] = [];
    for (let t = Date.UTC(1902, 0, 3); t < Date.UTC(2049, 0, 1); t += 23 * 86_400_000 + 5 * 3_600_000 + 7 * 60_000) {
      const d = new Date(t);
      const [hour, minute] = [d.getUTCHours(), d.getUTCMinutes()];
      // 한국 00시대 출생은 라이브러리 기준(베이징, 한국 -1시간)으로 전날이라 말일 맞춤이 갈릴 수 있어 뺀다
      if (hour === 0) continue;
      for (const gender of ['male', 'female'] as const) {
        const c = chartOf(solar(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), { hour, minute }, { gender }), {
          historicalTimezone: false,
        });
        const bj = new Date(c.time.instantMs + 8 * 3_600_000);
        const yun = lunarJs.Solar.fromYmdHms(
          bj.getUTCFullYear(), bj.getUTCMonth() + 1, bj.getUTCDate(), bj.getUTCHours(), bj.getUTCMinutes(), bj.getUTCSeconds(),
        ).getLunar().getEightChar().getYun(gender === 'male' ? 1 : 0, 2);
        const s = c.daewoonStart;
        // 대운수 환산의 초 처리 차이(D-005)로 년·개월·일·시가 다르면 시작일 비교 대상이 아니다
        if (yun.getStartYear() !== s.years || yun.getStartMonth() !== s.months || yun.getStartDay() !== s.days || yun.getStartHour() !== s.hours) continue;
        if ((hour + s.hours) % 24 === 0) continue; // 더한 결과가 정확히 자정이면 기준 시각 차이로 날짜가 갈린다
        compared++;
        const ls = yun.getStartSolar();
        const d0 = c.daewoon[0]!;
        if (ls.getYear() !== d0.startYear || ls.getMonth() !== d0.startMonth || ls.getDay() !== d0.startDay) {
          mismatches.push(`${d.toISOString()} ${gender}`);
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
    expect(mismatches).toEqual([]);
  });
});

describe('근거 문구의 대운 시작 표기', () => {
  it('대운 근거와 방향 근거는 표준 표기 "K세(YYYY년 M월)" 하나만 쓴다', () => {
    const c = chartOf(solar(1990, 5, 15, { hour: 14, minute: 30 }));
    const ev = buildEvidence(c);
    for (const d of c.daewoon) {
      const e = ev.find((x) => x.id === `daewoon[${d.index}]`)!;
      expect(e.content).toContain(daewoonStartLabel(d));
      expect(e.content).not.toMatch(/출생 후|개월/);
    }
    const dir = ev.find((x) => x.id === 'daewoon.direction')!;
    expect(dir.content).toContain(daewoonStartLabel(c.daewoon[0]!));
    expect(dir.content).not.toMatch(/출생 후|개월/);
  });

  it('세는 나이는 시작 연도 - 출생 연도 + 1', () => {
    const c = chartOf(solar(1990, 5, 15, { hour: 14, minute: 30 }));
    for (const d of c.daewoon) expect(d.koreanAge).toBe(d.startYear - 1990 + 1);
  });
});
