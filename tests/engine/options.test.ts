// 설정 검증, 대운수 반올림 설정, 세는 나이, 시간 모름 + 절입일 안내 데이터
import { describe, expect, it } from 'vitest';
import { NOTICE_MESSAGES } from '../../src/engine/notices';
import { computeDaewoonStart } from '../../src/engine/daewoon';
import { jieOfYear } from '../../src/engine/solarTerms';
import { chartOf, kstWall, solar } from './helpers';

describe('설정 검증', () => {
  it.each([
    [{ daewoonCount: -1 }, 'daewoonCount'],
    [{ daewoonCount: 0 }, 'daewoonCount'],
    [{ daewoonCount: 2.5 }, 'daewoonCount'],
    [{ defaultLongitude: 500 }, 'defaultLongitude'],
    [{ unknownTimeAssumption: { hour: 25, minute: 0 } }, 'unknownTimeAssumption'],
    [{ jasiMode: 'x' as never }, 'jasiMode'],
    [{ daewoonRounding: 'ceil' as never }, 'daewoonRounding'],
  ])('%o 거부', (settings, field) => {
    expect(() => chartOf(solar(1990, 5, 15, { hour: 14, minute: 30 }), settings)).toThrowError(field);
  });
});

describe('대운수 반올림 설정 (기본 버림)', () => {
  // 1995년(을해, 음년) 여자는 순행 → 다음 절입까지. 입하 359분 50초 전 출생을 직접 만든다
  const jie = jieOfYear(1995).find((j) => j.name === '입하')!.instantMs;
  const birthMs = jie - (359 * 60 + 50) * 1000;
  const yearStem = 1; // 을

  it('기본값은 floor', () => {
    expect(chartOf(solar(1995, 5, 1, null)).settings.daewoonRounding).toBe('floor');
  });

  it('floor: 359분 → 0년 0개월 29일', () => {
    expect(computeDaewoonStart(birthMs, yearStem, 'female', 'floor')).toMatchObject({ forward: true, years: 0, months: 0, days: 29, jieName: '입하' });
  });

  it('round: 360분 → 0년 1개월 0일', () => {
    expect(computeDaewoonStart(birthMs, yearStem, 'female', 'round')).toMatchObject({ forward: true, years: 0, months: 1, days: 0 });
  });

  it('buildChart가 설정을 전달한다', () => {
    const input = solar(1995, 5, 6, { hour: 3, minute: 0 }, { gender: 'female' });
    const a = chartOf(input, { daewoonRounding: 'floor' });
    const b = chartOf(input, { daewoonRounding: 'round' });
    expect(a.settings.daewoonRounding).toBe('floor');
    expect(b.settings.daewoonRounding).toBe('round');
    const minutes = (c: typeof a) => Math.abs(c.daewoonStart.jieInstantMs - c.time.instantMs) / 60_000;
    expect(a.daewoonStart.years * 4320 + a.daewoonStart.months * 360 + a.daewoonStart.days * 12).toBeLessThanOrEqual(Math.floor(minutes(a)));
  });
});

describe('대운 세는 나이', () => {
  it('세는 나이 = 대운 시작 연도 - 출생 연도 + 1, 10년씩 증가', () => {
    const c = chartOf(solar(1990, 5, 15, { hour: 14, minute: 30 }));
    for (const d of c.daewoon) expect(d.koreanAge).toBe(d.startYear - 1990 + 1);
    expect(c.daewoon[1]!.koreanAge - c.daewoon[0]!.koreanAge).toBe(10);
  });
});

describe('시간 모름 + 절입일 안내', () => {
  const ip = kstWall(jieOfYear(2024).find((j) => j.name === '입춘')!.instantMs, 540);
  const c = chartOf(solar(ip.year, ip.month, ip.day, null));

  it('경고와 함께 문구·절입 시각·전후 년월주를 제공', () => {
    expect(c.warnings).toEqual(['unknownTimeOnJieDay']);
    const n = c.notices[0]!;
    expect(n.code).toBe('unknownTimeOnJieDay');
    expect(n.message).toBe(NOTICE_MESSAGES.unknownTimeOnJieDay);
    expect(n.jie?.name).toBe('입춘');
    expect(n.jie?.localTime).toBe(`${ip.year}-02-${String(ip.day).padStart(2, '0')} ${String(ip.hour).padStart(2, '0')}:${String(ip.minute).padStart(2, '0')}`);
    expect(n.jie?.ifBefore.year).not.toEqual(n.jie?.ifAfter.year); // 입춘이라 년주도 바뀜
    expect(n.jie?.ifBefore.month).not.toEqual(n.jie?.ifAfter.month);
  });

  it('계산에 쓴 정오 결과는 전·후 둘 중 하나와 같다', () => {
    const n = c.notices[0]!.jie!;
    const used = { year: c.pillars.year, month: c.pillars.month };
    expect([n.ifBefore, n.ifAfter]).toContainEqual(used);
  });

  it('시간을 알면 경고가 없다', () => {
    expect(chartOf(solar(ip.year, ip.month, ip.day, { hour: 9, minute: 0 })).notices).toEqual([]);
  });

  it('서머타임 경고에도 문구가 붙는다', () => {
    const d = chartOf(solar(1987, 5, 10, { hour: 2, minute: 30 }));
    expect(d.notices).toEqual([{ code: 'nonexistentWallTime', message: NOTICE_MESSAGES.nonexistentWallTime }]);
  });
});
