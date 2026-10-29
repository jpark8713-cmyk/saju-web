// 한국 표준시·서머타임 전환표(Docs/TIMEZONE_HISTORY.md). 런타임 tzdb가 바뀌거나(2019c 전 버전이면 1948~1951 서머타임이 빠짐)
// 1954-03-21 원문 보정(D-056)이 깨지면 여기서 잡는다.
import { describe, expect, it } from 'vitest';
import { AMBIGUOUS_STANDARD_CHANGE_MESSAGE, NOTICE_MESSAGES } from '../../src/engine/notices';
import { resolveSeoulWallTime, seoulOffsetMinutes } from '../../src/engine/time';
import { chartOf, solar } from './helpers';

const LMT = 507 + 52 / 60; // 서울 지방시 UTC+8:27:52

/** [전환 순간(UTC), 전 오프셋(분), 후 오프셋(분)] */
const TRANSITIONS: [string, number, number][] = [
  ['1908-03-31T15:32:08Z', LMT, 510],
  ['1911-12-31T15:30:00Z', 510, 540],
  ['1948-05-31T15:00:00Z', 540, 600],
  ['1948-09-12T14:00:00Z', 600, 540],
  ['1949-04-02T15:00:00Z', 540, 600],
  ['1949-09-10T14:00:00Z', 600, 540],
  ['1950-03-31T15:00:00Z', 540, 600],
  // 1950 종료일은 KISTI 연혁(9월 10일 24시)과 하루 다르다. 국가기록원 원문을 찾지 못해 tzdb를 그대로 둔다(LAUNCH_CHECKLIST 1-15)
  ['1950-09-09T14:00:00Z', 600, 540],
  ['1951-05-05T15:00:00Z', 540, 600],
  ['1951-09-08T14:00:00Z', 600, 540],
  // 대통령령 제876호 원문: 3월 21일 오전 0시 30분부터(tzdb는 0시, 15:00Z)
  ['1954-03-20T15:30:00Z', 540, 510],
  ['1955-05-04T15:30:00Z', 510, 570],
  ['1955-09-08T14:30:00Z', 570, 510],
  ['1956-05-19T15:30:00Z', 510, 570],
  ['1956-09-29T14:30:00Z', 570, 510],
  ['1957-05-04T15:30:00Z', 510, 570],
  ['1957-09-21T14:30:00Z', 570, 510],
  ['1958-05-03T15:30:00Z', 510, 570],
  ['1958-09-20T14:30:00Z', 570, 510],
  ['1959-05-02T15:30:00Z', 510, 570],
  ['1959-09-19T14:30:00Z', 570, 510],
  ['1960-04-30T15:30:00Z', 510, 570],
  ['1960-09-17T14:30:00Z', 570, 510],
  ['1961-08-09T15:30:00Z', 510, 540],
  ['1987-05-09T17:00:00Z', 540, 600],
  ['1987-10-10T17:00:00Z', 600, 540],
  ['1988-05-07T17:00:00Z', 540, 600],
  ['1988-10-08T17:00:00Z', 600, 540],
];

describe('한국 표준시·서머타임 전환표', () => {
  it.each(TRANSITIONS)('%s: %d → %d', (iso, before, after) => {
    const t = Date.parse(iso);
    expect(seoulOffsetMinutes(t - 1000)).toBeCloseTo(before, 6);
    expect(seoulOffsetMinutes(t)).toBeCloseTo(after, 6);
  });

  it('전환 사이에는 오프셋이 그대로다(구간 가운데 표본)', () => {
    for (let i = 0; i + 1 < TRANSITIONS.length; i++) {
      const [a, , after] = TRANSITIONS[i]!;
      const [b] = TRANSITIONS[i + 1]!;
      const mid = (Date.parse(a) + Date.parse(b)) / 2;
      expect(seoulOffsetMinutes(mid)).toBeCloseTo(after, 6);
    }
    expect(seoulOffsetMinutes(Date.parse('2026-07-01T00:00:00Z'))).toBe(540);
  });
});

describe('1954-03-21 표준시 변경(대통령령 제876호, D-056)', () => {
  const wall = (day: number, hour: number, minute: number) => resolveSeoulWallTime({ year: 1954, month: 3, day, hour, minute });

  it('03-21 00:00~00:29는 두 번 있는 시각이고 앞의 순간(UTC+9)을 택한다', () => {
    for (const minute of [0, 10, 29]) {
      const r = wall(21, 0, minute);
      expect(r.ambiguous).toBe(true);
      expect(r.offsetMinutes).toBe(540);
      expect(r.instantMs).toBe(Date.UTC(1954, 2, 20, 15, minute));
    }
  });

  it('03-20 23:30~23:59는 한 번만 있고(UTC+9), 03-21 00:30부터는 UTC+8:30이다', () => {
    for (const minute of [30, 59]) {
      const r = wall(20, 23, minute);
      expect(r).toMatchObject({ ambiguous: false, nonexistent: false, offsetMinutes: 540 });
    }
    const after = wall(21, 0, 30);
    expect(after).toMatchObject({ ambiguous: false, nonexistent: false, offsetMinutes: 510 });
    expect(after.instantMs).toBe(Date.UTC(1954, 2, 20, 16, 0));
  });

  it('안내는 서머타임 종료가 아니라 표준시 변경 문구로 나온다', () => {
    const c = chartOf(solar(1954, 3, 21, { hour: 0, minute: 10 }, { birthplaceLongitude: 126.98 }));
    expect(c.warnings).toContain('ambiguousWallTime');
    expect(c.notices.find((n) => n.code === 'ambiguousWallTime')?.message).toBe(AMBIGUOUS_STANDARD_CHANGE_MESSAGE);
    // 앞의 순간(UTC 15:10) + 경도 보정 → 03-20 23:37, 야자시라 일주는 03-20
    expect(c.time.localSolarTime).toMatchObject({ month: 3, day: 20, hour: 23, minute: 37 });
  });

  it('1988 서머타임 종료의 두 번 있는 시각은 기존 문구 그대로다', () => {
    const c = chartOf(solar(1988, 10, 9, { hour: 2, minute: 30 }));
    expect(c.notices.find((n) => n.code === 'ambiguousWallTime')?.message).toBe(NOTICE_MESSAGES.ambiguousWallTime);
  });
});
