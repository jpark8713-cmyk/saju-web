// 면책·계산 기준 문구(D-056): 경도 보정 설명과 예시 시각이 어긋나지 않는지, 서머타임·과거 표준시는 적용될 때만, 보정으로 기둥이 달라지면 한 줄
import { describe, expect, it } from 'vitest';
import { calcBasis } from '../../src/report/calcBasis';
import { chartOf, solar } from '../engine/helpers';

const SEOUL = { birthplaceLongitude: 126.98 };
const basisOf = (y: number, m: number, d: number, time: { hour: number; minute: number } | null, lon = 126.98, settings = {}) =>
  calcBasis(chartOf(solar(y, m, d, time, { birthplaceLongitude: lon }), settings));

describe('시간 보정 설명', () => {
  it('서울: 차이(32분 5초)와 예시(23:30 → 22:57:55)가 맞물린다. 분 미만 버림 설명은 싣지 않는다', () => {
    const b = basisOf(1999, 12, 31, { hour: 23, minute: 30 });
    expect(b.timeCorrection).toBe('출생지 경도(동경 126.98°)로 표준시보다 32분 5초 늦은 그 지역 시각을 써요. 태어난 시각 23:30 → 그 지역 시각 22:57:55');
  });

  it('초가 0이면 "22:58"처럼 분까지만 쓴다(지역 모름 = 동경 127°)', () => {
    expect(basisOf(1999, 12, 31, { hour: 23, minute: 30 }, 127).timeCorrection).toBe('출생지 경도(동경 127°)로 표준시보다 32분 늦은 그 지역 시각을 써요. 태어난 시각 23:30 → 그 지역 시각 22:58');
  });

  it('서머타임 출생은 1시간을 뺀 단계를 보여 준다', () => {
    const b = basisOf(1987, 7, 15, { hour: 10, minute: 20 });
    expect(b.timeCorrection).toContain('태어난 시각 10:20 → 서머타임 1시간을 빼 09:20 → 그 지역 시각 08:47:55');
  });

  it('UTC+8:30 시대는 당시 표준시 기준 차이(2분 5초)로 쓴다. 동쪽 지역은 "빠른"', () => {
    expect(basisOf(1958, 3, 1, { hour: 12, minute: 0 }).timeCorrection).toContain('표준시보다 2분 5초 늦은');
    expect(basisOf(1956, 11, 20, { hour: 12, minute: 0 }, 129.05).timeCorrection).toContain('표준시보다 6분 12초 빠른 그 지역 시각을 써요. 태어난 시각 12:00 → 그 지역 시각 12:06:12');
  });

  it('시간 모름이면 예시 없이 "시주 제외"를 붙인다', () => {
    expect(basisOf(2024, 2, 4, null).timeCorrection).toBe('출생지 경도(동경 126.98°)로 표준시보다 32분 5초 늦은 그 지역 시각을 써요. 태어난 시간 모름(시주 제외)');
  });

  it('경도 보정을 끄면 그렇게 밝힌다', () => {
    expect(basisOf(1999, 12, 31, { hour: 23, minute: 30 }, 126.98, { longitudeCorrection: false }).timeCorrection).toBe('경도 보정 없음(한국 표준시 그대로)');
  });
});

describe('서머타임·과거 표준시는 적용될 때만', () => {
  it('해당 없는 출생은 줄이 없다', () => {
    expect(basisOf(1999, 12, 31, { hour: 23, minute: 30 }).timezone).toBeNull();
  });
  it('서머타임, UTC+8:30, 1908년 전 지방시', () => {
    expect(basisOf(1987, 7, 15, { hour: 10, minute: 20 }).timezone).toBe('서머타임 기간이라 1시간을 빼서 계산했어요');
    expect(basisOf(1958, 3, 1, { hour: 12, minute: 0 }).timezone).toBe('당시 표준시 UTC+8:30(동경 127.5°)을 썼어요');
    expect(basisOf(1957, 7, 1, { hour: 12, minute: 0 }).timezone).toBe('서머타임 기간이라 1시간을 빼서 계산했어요. 당시 표준시 UTC+8:30(동경 127.5°)을 썼어요');
    expect(basisOf(1900, 1, 31, { hour: 12, minute: 0 }).timezone).toBe('1908년 4월 전이라 당시 서울 지방시(UTC+8:27:52)를 썼어요');
  });
  it('설정으로 끄면 그 사실을 보여 준다', () => {
    expect(basisOf(1987, 7, 15, { hour: 10, minute: 20 }, 126.98, { historicalTimezone: false }).timezone).toBe('서머타임·과거 표준시 반영 안 함(한국 표준시 UTC+9로 계산)');
  });
});

describe('보정으로 기둥이 달라질 때 한 줄', () => {
  it('서울 23:30: 시계 시각 그대로면 시주가 임자(壬子)', () => {
    expect(basisOf(1999, 12, 31, { hour: 23, minute: 30 }).clockDiff).toBe(
      '이 리포트는 경도 보정 시각으로 기둥을 정했어요. 보정 없이 시계 시각 그대로(23:30) 보는 만세력에서는 시주가 임자(壬子)로 다르게 나올 수 있어요',
    );
  });
  it('자정 직후는 일주가 달라진다(받침 ㄹ은 "로")', () => {
    expect(basisOf(1995, 8, 11, { hour: 0, minute: 20 }).clockDiff).toContain('일주가 갑술(甲戌)로 다르게');
  });
  it('받침이 있으면 "으로"', () => {
    expect(basisOf(1988, 10, 9, { hour: 2, minute: 30 }).clockDiff).toContain('시주가 신축(辛丑)으로 다르게');
  });
  it('기둥이 같으면 줄이 없다: 강릉 07:25, 시간 모름, 보정 끔', () => {
    expect(basisOf(2001, 3, 21, { hour: 7, minute: 25 }, 128.88).clockDiff).toBeNull();
    expect(basisOf(2024, 2, 4, null).clockDiff).toBeNull();
    expect(basisOf(1999, 12, 31, { hour: 23, minute: 30 }, 126.98, { longitudeCorrection: false }).clockDiff).toBeNull();
  });
});

describe('입춘일·시간 모름 안내(D-057)', () => {
  it('정오로 계산한 이 리포트가 절입 전·뒤 어느 쪽 기준인지 한 줄을 더한다', () => {
    const n = basisOf(2024, 2, 4, null).notices.find((x) => x.code === 'unknownTimeOnJieDay')!;
    expect(n.details).toHaveLength(3);
    expect(n.details[2]).toBe('이 리포트의 대운·10년 흐름 등 나머지 풀이도 입춘 전 출생(정오로 계산) 기준이에요.');
  });
  it('정오가 절입 뒤인 날은 "뒤"', () => {
    // 1990-02-04 입춘은 11:14(한국 시각)라 정오는 입춘 뒤
    const n = basisOf(1990, 2, 4, null).notices.find((x) => x.code === 'unknownTimeOnJieDay')!;
    expect(n.details[2]).toBe('이 리포트의 대운·10년 흐름 등 나머지 풀이도 입춘 뒤 출생(정오로 계산) 기준이에요.');
  });
});

describe('자시·달력', () => {
  it('야자시 처리와 절입 판정 기준(시계 시각)을 밝힌다', () => {
    const b = calcBasis(chartOf(solar(1990, 5, 15, { hour: 14, minute: 30 }, SEOUL)));
    expect(b.jasi).toBe('야자시·조자시 구분: 23시대는 일주를 그날로 두고, 시주는 다음 날 기준 자시로 봐요');
    expect(b.calendar).toContain('절입 전후는 경도 보정 없이 시계 시각(태어난 실제 순간)으로 판정');
  });
});
