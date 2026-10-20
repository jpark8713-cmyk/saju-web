// SPEC 7장 경계 케이스. 기대값은 임의로 만들지 않고, 엔진 결과가 교차검증 라이브러리와 일치하는지 본다.
// (시중 만세력 앱 기대값은 TODO(owner)가 제공하면 추가)
import { describe, expect, it } from 'vitest';
import { CalendarInputError } from '../../src/engine/calendar';
import { pillarHanja as enginePillarHanja } from '../../src/engine/constants';
import { jieOfYear } from '../../src/engine/solarTerms';
import { enginePillars, lunarJsDaewoon, lunarJsPillars } from './crossCheck';
import { chartOf, kstWall, solar } from './helpers';
import type { CalcSettings, SajuChart, SajuInput } from '../../src/engine/types';

function expectLibrariesAgree(chart: SajuChart): void {
  expect(enginePillars(chart)).toEqual(lunarJsPillars(chart));
}

function jieInstant(year: number, name: string): number {
  const j = jieOfYear(year).find((x) => x.name === name);
  if (!j) throw new Error(`${year} ${name} 없음`);
  return j.instantMs;
}

/** 절입 순간 ±deltaMin 분의 한국 표준시 입력 (서머타임이 없는 해에만 사용) */
function aroundJie(year: number, name: string, deltaMin: number): SajuInput {
  const w = kstWall(jieInstant(year, name) + deltaMin * 60_000, 540);
  return solar(w.year, w.month, w.day, { hour: w.hour, minute: w.minute });
}

describe('1. 입춘 직전·직후 (년주·월주가 함께 바뀜)', () => {
  it.each([2024, 1990, 1950])('%i년 입춘 ±2분', (year) => {
    const before = chartOf(aroundJie(year, '입춘', -2));
    const after = chartOf(aroundJie(year, '입춘', 2));
    expectLibrariesAgree(before);
    expectLibrariesAgree(after);
    expect(before.pillars.year).not.toEqual(after.pillars.year);
    expect(before.pillars.month.branch).toBe(1); // 축월
    expect(after.pillars.month.branch).toBe(2); // 인월
  });
});

describe('2. 절기 시각 직전·직후 (월주만 바뀜)', () => {
  it.each([
    [2024, '경칩'],
    [2001, '입하'],
    [1977, '대설'],
  ] as const)('%i년 %s ±2분', (year, name) => {
    const before = chartOf(aroundJie(year, name, -2));
    const after = chartOf(aroundJie(year, name, 2));
    expectLibrariesAgree(before);
    expectLibrariesAgree(after);
    expect(before.pillars.year).toEqual(after.pillars.year);
    expect(before.pillars.month).not.toEqual(after.pillars.month);
  });
});

describe('3. 입춘 전 1월·2월 출생 (전년 년주)', () => {
  it.each([
    [1990, 1, 20],
    [1990, 2, 2],
    [2000, 1, 31],
  ] as const)('%i-%i-%i', (y, m, d) => {
    const chart = chartOf(solar(y, m, d, { hour: 10, minute: 0 }));
    expectLibrariesAgree(chart);
    const prevYearPillar = chartOf(solar(y - 1, 7, 1, { hour: 10, minute: 0 })).pillars.year;
    expect(chart.pillars.year).toEqual(prevYearPillar);
  });
});

describe('4. 자시 (야자시/조자시 설정)', () => {
  // 서울 경도 보정(-32분) 후 23:18 → 야자시, 다음날 00:20 → 보정 후 전날 23:48 (야자시)
  const late = solar(1995, 8, 10, { hour: 23, minute: 50 });
  const early = solar(1995, 8, 11, { hour: 0, minute: 20 });
  const afterMidnight = solar(1995, 8, 11, { hour: 0, minute: 50 }); // 보정 후 00:18 → 조자시

  it.each(['split', 'unified'] as const)('%s 모드에서 교차검증 일치', (jasiMode) => {
    for (const input of [late, early, afterMidnight]) expectLibrariesAgree(chartOf(input, { jasiMode }));
  });

  it('split: 23시대는 당일 일주, unified: 다음날 일주', () => {
    const split = chartOf(late, { jasiMode: 'split' });
    const unified = chartOf(late, { jasiMode: 'unified' });
    const nextDay = chartOf(afterMidnight, { jasiMode: 'split' });
    expect(split.pillars.hour?.branch).toBe(0);
    expect(unified.pillars.day).toEqual(nextDay.pillars.day);
    expect(split.pillars.day).not.toEqual(unified.pillars.day);
    expect(split.pillars.hour).toEqual(unified.pillars.hour); // 시주는 두 방식이 같다
  });

  it('00:20 출생은 경도 보정 후 전날 야자시가 된다', () => {
    const c = chartOf(early);
    expect(c.time.localSolarTime).toMatchObject({ day: 10, hour: 23, minute: 48 });
    expect(c.pillars.day).toEqual(chartOf(late).pillars.day);
  });
});

describe('5. 음력 윤달', () => {
  it.each([
    [2020, 4, 15],
    [1987, 6, 5],
    [2023, 2, 10],
  ] as const)('%i년 윤%i월 %i일', (y, m, d) => {
    const leap = chartOf({ ...solar(y, m, d, { hour: 9, minute: 0 }), calendar: 'lunar', isLeapMonth: true });
    const plain = chartOf({ ...solar(y, m, d, { hour: 9, minute: 0 }), calendar: 'lunar', isLeapMonth: false });
    expect(leap.lunarDate).toEqual({ year: y, month: m, day: d, isLeapMonth: true });
    expect(leap.solarDate).not.toEqual(plain.solarDate);
    expectLibrariesAgree(leap);
  });

  it('윤달이 없는 달에 윤달을 지정하면 거부', () => {
    const input = { ...solar(2024, 5, 1, null), calendar: 'lunar' as const, isLeapMonth: true };
    expect(() => chartOf(input)).toThrowError(CalendarInputError);
  });

  it('한국·중국 윤달 위치가 다른 해(2017년 한국 윤5월)는 한국 기준(manseryeok)으로 변환', () => {
    const c = chartOf({ ...solar(2017, 5, 10, null), calendar: 'lunar', isLeapMonth: true });
    expect(c.solarDate).toEqual({ year: 2017, month: 7, day: 3 });
  });
});

describe('6. 시간 모름 (3주)', () => {
  it('시주가 null이고 오행은 6글자 기준', () => {
    const c = chartOf(solar(1988, 9, 17, null));
    expect(c.pillars.hour).toBeNull();
    expect(c.elements.total).toBe(6);
    expectLibrariesAgree(c);
  });

  it('절입일에 시간 모름이면 경고를 남긴다', () => {
    const ip = kstWall(jieInstant(2024, '입춘'), 540);
    const c = chartOf(solar(ip.year, ip.month, ip.day, null));
    expect(c.warnings).toContain('unknownTimeOnJieDay');
    expect(chartOf(solar(2024, 2, 10, null)).warnings).not.toContain('unknownTimeOnJieDay');
  });
});

describe('7. 지원 범위 끝 (1900~2050)', () => {
  it.each([
    solar(1900, 1, 1, { hour: 0, minute: 10 }),
    solar(1900, 1, 1, { hour: 12, minute: 0 }),
    solar(1900, 2, 4, null),
    solar(2050, 12, 31, { hour: 23, minute: 59 }),
    solar(2050, 6, 15, { hour: 6, minute: 0 }),
  ])('$year-$month-$day 교차검증 일치', (input) => {
    expectLibrariesAgree(chartOf(input));
  });

  it.each([
    solar(1899, 12, 31, null),
    solar(2051, 1, 1, null),
  ])('범위 밖 $year 거부', (input) => {
    expect(() => chartOf(input)).toThrowError(CalendarInputError);
  });

  it('1908년 이전은 tzdb상 서울 지방평균시(+8:27:52)라 경도 보정 폭이 거의 없다', () => {
    const c = chartOf(solar(1900, 1, 1, { hour: 0, minute: 10 }));
    expect(c.time.localSolarTime).toMatchObject({ year: 1900, hour: 0, minute: 10 });
  });

  it('UTC+9로 보면 1900-01-01 00:10이 경도 보정 후 1899-12-31 야자시가 되어도 계산된다', () => {
    const c = chartOf(solar(1900, 1, 1, { hour: 0, minute: 10 }), { historicalTimezone: false });
    expect(c.time.localSolarTime).toMatchObject({ year: 1899, month: 12, day: 31, hour: 23 });
    expectLibrariesAgree(c);
  });
});

describe('8. 남녀에 따른 대운 순행/역행', () => {
  it.each([
    solar(1990, 5, 15, { hour: 14, minute: 30 }), // 경오년(양)
    solar(1991, 11, 3, { hour: 7, minute: 5 }), // 신미년(음)
    solar(1987, 7, 15, { hour: 10, minute: 20 }), // 서머타임 기간
  ])('$year-$month-$day 남녀 방향 반대, 대운수·대운이 교차검증과 일치', (input) => {
    const male = chartOf({ ...input, gender: 'male' });
    const female = chartOf({ ...input, gender: 'female' });
    expect(male.daewoonStart.forward).toBe(!female.daewoonStart.forward);
    for (const c of [male, female]) {
      const lib = lunarJsDaewoon(c);
      expect(c.daewoonStart).toMatchObject({ years: lib.years, months: lib.months, forward: lib.forward });
      expect(c.daewoon.map((d) => enginePillarHanja(d.pillar))).toEqual(lib.pillars);
    }
  });
});

describe('9. 태양시(경도) 보정 사용/미사용', () => {
  const input = solar(1993, 3, 20, { hour: 13, minute: 10 }, { birthplaceLongitude: 126.98 });
  it.each([true, false])('longitudeCorrection=%s 교차검증 일치', (longitudeCorrection) => {
    expectLibrariesAgree(chartOf(input, { longitudeCorrection }));
  });

  it('13:10 서울 출생: 보정하면 오시(12:38), 안 하면 미시', () => {
    expect(chartOf(input, { longitudeCorrection: true }).pillars.hour?.branch).toBe(6);
    expect(chartOf(input, { longitudeCorrection: false }).pillars.hour?.branch).toBe(7);
  });

  it('부산(129°)은 서울보다 보정 폭이 작다', () => {
    const busan = chartOf({ ...input, birthplaceLongitude: 129 });
    expect(busan.time.localSolarTime).toMatchObject({ hour: 12, minute: 46 });
  });
});

describe('10. 서머타임·과거 표준시 (tzdb Asia/Seoul)', () => {
  const settingsBoth: Partial<CalcSettings> = { historicalTimezone: true };
  it('1987-07-15 10:20 (서머타임 UTC+10) → 순간은 UTC 00:20', () => {
    const c = chartOf(solar(1987, 7, 15, { hour: 10, minute: 20 }), settingsBoth);
    expect(c.time.utcOffsetMinutes).toBe(600);
    expect(new Date(c.time.instantMs).toISOString()).toBe('1987-07-15T00:20:00.000Z');
    expectLibrariesAgree(c);
  });

  it('1955-12-01 (UTC+8:30 기간)', () => {
    const c = chartOf(solar(1955, 12, 1, { hour: 8, minute: 0 }), settingsBoth);
    expect(c.time.utcOffsetMinutes).toBe(510);
    expectLibrariesAgree(c);
  });

  it('서머타임 보정을 끄면 UTC+9로 본다', () => {
    const c = chartOf(solar(1987, 7, 15, { hour: 10, minute: 20 }), { historicalTimezone: false });
    expect(c.time.utcOffsetMinutes).toBe(540);
  });

  it('서머타임 시작 때 없는 시각(1987-05-10 02:30)은 표시하고 표준시로 해석', () => {
    const c = chartOf(solar(1987, 5, 10, { hour: 2, minute: 30 }));
    expect(c.warnings).toContain('nonexistentWallTime');
    expect(c.time.utcOffsetMinutes).toBe(540);
  });

  it('서머타임 종료 때 두 번 있는 시각(1987-10-11 02:30)은 표시하고 앞 순간을 택함', () => {
    const c = chartOf(solar(1987, 10, 11, { hour: 2, minute: 30 }));
    expect(c.warnings).toContain('ambiguousWallTime');
    expect(c.time.utcOffsetMinutes).toBe(600);
  });
});
