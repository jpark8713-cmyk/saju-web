// 분 모름: 그 시 안에서 결과가 바뀌는 분 구간 (D-039)
// 경계 분은 엔진이 분마다 계산한다. 여기서는 독립 공식으로 기대값을 따로 구해 맞춰 본다:
//   현지 평균태양시 = 벽시계 − (표준시 오프셋 − 경도×4)분 → 홀수 정시(시주 경계)에 닿는 첫 분 = ceil(오프셋 − 경도×4)
import { describe, expect, it } from 'vitest';
import { findRegion } from '../../src/config/regions';
import { minuteSegments } from '../../src/engine/minute';
import { ipchunOf } from '../../src/engine/solarTerms';
import { chartOf, solar } from './helpers';

/** 홀수 정시 시주 경계가 그 시 안에서 시작하는 분(독립 계산) */
const expectedBoundary = (utcOffsetMin: number, lon: number) => Math.ceil(utcOffsetMin - lon * 4 - 1e-9);

const lonOf = (regionId: string) => findRegion(regionId)!.longitude;
const at = (y: number, m: number, d: number, hour: number, regionId: string) => solar(y, m, d, { hour, minute: 0 }, { birthplaceLongitude: lonOf(regionId) });

describe('지역별 경계 분 (1990년, 표준시 UTC+9)', () => {
  it.each([
    ['서울 종로구', 'seoul:종로구'],
    ['광주 북구', 'gwangju:북구'],
    ['경기 광주시', 'gyeonggi:광주시'],
    ['부산 해운대구', 'busan:해운대구'],
    ['강원 고성군', 'gangwon:고성군'],
    ['경남 고성군', 'gyeongnam:고성군'],
    ['경북 울릉군', 'gyeongbuk:울릉군'],
    ['제주 제주시', 'jeju:제주시'],
  ])('%s: 13시는 공식대로 한 번 갈리고, 14시는 갈리지 않는다', (_name, id) => {
    const odd = minuteSegments(at(1990, 5, 15, 13, id));
    expect(odd).toHaveLength(2);
    expect(odd[1]!.fromMinute).toBe(expectedBoundary(540, lonOf(id)));
    expect(odd[0]!.pillars.hour!.branch).toBe(6); // 오시
    expect(odd[1]!.pillars.hour!.branch).toBe(7); // 미시
    expect(minuteSegments(at(1990, 5, 15, 14, id))).toHaveLength(1);
  });

  it('같은 이름 지역(광주)은 경계 분이 다르다. 고성은 경도 차이가 0.15°(약 36초)라 같은 분이다', () => {
    const gwangju = minuteSegments(at(1990, 5, 15, 13, 'gwangju:북구'))[1]!.fromMinute;
    const gyeonggi = minuteSegments(at(1990, 5, 15, 13, 'gyeonggi:광주시'))[1]!.fromMinute;
    expect([gwangju, gyeonggi]).toEqual([33, 31]);
    const gangwon = minuteSegments(at(1990, 5, 15, 13, 'gangwon:고성군'))[1]!.fromMinute;
    const gyeongnam = minuteSegments(at(1990, 5, 15, 13, 'gyeongnam:고성군'))[1]!.fromMinute;
    expect([gangwon, gyeongnam]).toEqual([27, 27]);
  });

  it('지역을 고르지 않으면(127°) 32분부터 바뀐다', () => {
    const segs = minuteSegments(solar(1990, 5, 15, { hour: 13, minute: 0 }));
    expect(segs.map((s) => s.fromMinute)).toEqual([0, expectedBoundary(540, 127)]);
    expect(expectedBoundary(540, 127)).toBe(32);
  });

  it('0시대: 33분부터 일주까지 바뀐다(야자시·조자시 구분)', () => {
    const segs = minuteSegments(at(1990, 5, 15, 0, 'seoul:종로구'));
    expect(segs).toHaveLength(2);
    expect(segs[1]!.fromMinute).toBe(33);
    expect(segs[0]!.pillars.day).not.toEqual(segs[1]!.pillars.day);
    // 시주 지지는 둘 다 자시
    expect(segs[0]!.pillars.hour!.branch).toBe(0);
    expect(segs[1]!.pillars.hour!.branch).toBe(0);
  });

  it('통자시로 바꾸면 23시대 경계에서 일주가 바뀐다', () => {
    const segs = minuteSegments(at(1990, 5, 15, 23, 'seoul:종로구'), { jasiMode: 'unified' });
    expect(segs[1]!.fromMinute).toBe(33);
    expect(segs[0]!.pillars.day).not.toEqual(segs[1]!.pillars.day);
  });
});

describe('연도별 경계 분 (서머타임·과거 표준시)', () => {
  it('1987년 서머타임(UTC+10): 짝수 시가 갈리고 홀수 시는 갈리지 않는다', () => {
    const even = minuteSegments(at(1987, 7, 15, 14, 'seoul:종로구'));
    expect(even.map((s) => s.fromMinute)).toEqual([0, expectedBoundary(600, 126.98) - 60]);
    expect(even[1]!.fromMinute).toBe(33);
    expect(minuteSegments(at(1987, 7, 15, 13, 'seoul:종로구'))).toHaveLength(1);
  });

  it('1958년 표준시 UTC+8:30: 홀수 시가 3분부터 바뀐다(00분과 거의 모든 분의 결과가 다르다)', () => {
    const segs = minuteSegments(at(1958, 3, 10, 13, 'seoul:종로구'));
    expect(segs.map((s) => s.fromMinute)).toEqual([0, expectedBoundary(510, 126.98)]);
    expect(segs[1]!.fromMinute).toBe(3);
  });

  it('1958년 부산은 경계가 그 시 안에 없다(오프셋 − 경도×4가 0 아래)', () => {
    // 510 − 129.08×4 = −6.3분: 홀수 정시 경계는 그 전 시 54분 무렵이라 13시 안에는 경계가 없다
    expect(minuteSegments(at(1958, 3, 10, 13, 'busan:해운대구'))).toHaveLength(1);
    const prev = minuteSegments(at(1958, 3, 10, 12, 'busan:해운대구'));
    expect(prev[1]!.fromMinute).toBe(60 + expectedBoundary(510, lonOf('busan:해운대구')));
  });
});

describe('절입이 그 시 안에 있으면 년·월주 경계도 잡는다', () => {
  it('2024년 입춘 시각의 시에는 년주가 바뀌는 구간이 있다', () => {
    const j = ipchunOf(2024);
    const wall = new Date(j + 9 * 3_600_000);
    const hour = wall.getUTCHours();
    const firstAfter = wall.getUTCMinutes() + (wall.getUTCSeconds() > 0 || wall.getUTCMilliseconds() > 0 ? 1 : 0);
    const segs = minuteSegments(solar(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(), { hour, minute: 0 }, { birthplaceLongitude: 126.98 }));
    const yearChange = segs.findIndex((s, i) => i > 0 && s.pillars.year.branch !== segs[i - 1]!.pillars.year.branch);
    expect(yearChange).toBeGreaterThan(0);
    expect(segs[yearChange]!.fromMinute).toBe(firstAfter);
  });
});

describe('구간과 차트 계산이 일치한다', () => {
  it.each([
    [1990, 5, 15, 13, 'seoul:종로구'],
    [1987, 7, 15, 14, 'busan:해운대구'],
    [1958, 3, 10, 13, 'jeju:제주시'],
  ] as const)('%i-%i-%i %i시 %s: 각 구간의 처음·끝 분으로 계산한 네 기둥이 구간 값과 같다', (y, m, d, h, id) => {
    for (const s of minuteSegments(at(y, m, d, h, id))) {
      for (const minute of [s.fromMinute, s.toMinute]) {
        expect(chartOf(solar(y, m, d, { hour: h, minute }, { birthplaceLongitude: lonOf(id) })).pillars).toEqual(s.pillars);
      }
    }
  });
});

describe('분 모름 + 경계 모름(hourOnly)', () => {
  const input = solar(1990, 5, 15, null, { hourOnly: 13, birthplaceLongitude: 126.98 });

  it('시주를 비우고 0분 기준 년·월·일주로 계산하며, 분 구간별 기둥을 안내한다', () => {
    const c = chartOf(input);
    expect(c.input.hasTime).toBe(false);
    expect(c.pillars.hour).toBeNull();
    const segs = minuteSegments({ ...input, time: { hour: 13, minute: 0 } });
    expect(c.pillars.day).toEqual(segs[0]!.pillars.day);
    expect(c.warnings).toContain('unknownMinuteOnBoundary');
    expect(c.warnings).not.toContain('unknownTimeOnJieDay');
    const n = c.notices.find((x) => x.code === 'unknownMinuteOnBoundary')!;
    expect(n.minute).toEqual({ hour: 13, segments: segs });
  });

  it('시간 모름(정오 가정)과 달리 그 시의 0분으로 년·월주와 대운을 계산한다', () => {
    expect(chartOf(input).time.localSolarTime.hour).toBe(12); // 13:00 → 서울 경도 보정 12:28
  });

  it('time과 함께 쓰거나 시 범위를 벗어나면 입력 오류다', () => {
    expect(() => chartOf(solar(1990, 5, 15, { hour: 13, minute: 0 }, { hourOnly: 13 }))).toThrow();
    expect(() => chartOf(solar(1990, 5, 15, null, { hourOnly: 24 }))).toThrow();
  });
});

describe('분 모름 + 통자시', () => {
  it('23시대 hourOnly 차트의 일주는 0분 구간의 일주와 같다', () => {
    const input = solar(2000, 12, 31, null, { hourOnly: 23, birthplaceLongitude: 126.98 });
    const segs = minuteSegments({ ...input, time: { hour: 23, minute: 0 } }, { jasiMode: 'unified' });
    expect(chartOf(input, { jasiMode: 'unified' }).pillars.day).toEqual(segs[0]!.pillars.day);
  });
});
