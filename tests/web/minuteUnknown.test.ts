// 분 모름 (D-039): 서버 검증, 미리보기 안내, 주문·생성까지
import { describe, expect, it } from 'vitest';
import { startGeneration } from '../../src/orders/generation';
import { reportViewFor } from '../../src/orders/reportAccess';
import { MemoryStore } from '../../src/store/memory';
import { validateBirthForm } from '../../src/web/birthForm';
import { minuteRangesFor, validateBirthFormOnServer } from '../../src/web/birthServer';
import { buildPreview } from '../../src/web/preview';
import { BIRTH, paidOrder, runtime } from './helpers';

// 서울 종로구(126.98°), 1990-05-15: 13시는 33분부터 미시, 14시는 경계 없음
const B = (over: Record<string, unknown> = {}) => ({ ...BIRTH, regionId: 'seoul:종로구', hour: 13, minute: undefined, minuteUnknown: true, ...over });

describe('서버 검증', () => {
  it('경계가 없는 시(14시)는 묻지 않고 0분으로 계산한다', () => {
    const r = validateBirthFormOnServer(B({ hour: 14 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.input.time).toEqual({ hour: 14, minute: 0 });
      expect(r.value.timeText).toBe('14시경(분 모름)');
    }
  });

  it('경계가 있는 시(13시)에 답이 없으면 "13시 33분 이전인지 이후인지" 묻는다', () => {
    const r = validateBirthFormOnServer(B());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.time).toBe("태어난 시각이 13시 33분 이전인지 이후인지 골라 주세요. 모르면 '모름'을 골라 주세요.");
  });

  it.each([
    [0, { hour: 13, minute: 0 }, '13:00~13:32(분 모름)'],
    [33, { hour: 13, minute: 33 }, '13:33~13:59(분 모름)'],
  ])('구간 %i분을 고르면 그 구간의 시작 분으로 계산한다', (segment, time, text) => {
    const r = validateBirthFormOnServer(B({ minuteSegment: segment }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.input.time).toEqual(time);
      expect(r.value.timeText).toBe(text);
    }
  });

  it("'모름'이면 시주 없이(hourOnly) 계산한다", () => {
    const r = validateBirthFormOnServer(B({ minuteSegment: 'unknown' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.input.time).toBeNull();
      expect(r.value.input.hourOnly).toBe(13);
      expect(r.value.timeText).toBe('13시대(분 모름, 시주 제외)');
    }
  });

  it('실제 구간 시작이 아닌 분(20분)이나 지역이 바뀌어 맞지 않는 답은 다시 묻는다', () => {
    expect(validateBirthFormOnServer(B({ minuteSegment: 20 })).ok).toBe(false);
    // 부산이면 경계가 24분이라 33분 답은 맞지 않는다
    const r = validateBirthFormOnServer(B({ regionId: 'busan:해운대구', minuteSegment: 33 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.time).toContain('13시 24분');
  });

  it('분을 입력하면 기존대로 계산한다(구간 답은 무시)', () => {
    const r = validateBirthFormOnServer(B({ minuteUnknown: false, minute: 40, minuteSegment: 0 }));
    expect(r.ok && r.value.input.time).toEqual({ hour: 13, minute: 40 });
  });

  it('화면 검증(구간 계산 없음)은 분 모름만으로 통과시키고, 구간 판단은 서버에 맡긴다', () => {
    expect(validateBirthForm(B()).ok).toBe(true);
    expect(validateBirthForm(B({ hour: undefined })).ok).toBe(false);
  });
});

describe('구간 조회 (/api/time-boundary)', () => {
  it('날짜·시·지역만 있으면 구간을 준다(성별·동의는 아직 없어도 된다)', () => {
    expect(minuteRangesFor({ ...B(), gender: undefined, consent: false })).toEqual([
      { fromMinute: 0, toMinute: 32 },
      { fromMinute: 33, toMinute: 59 },
    ]);
    expect(minuteRangesFor(B({ hour: 14 }))).toEqual([{ fromMinute: 0, toMinute: 59 }]);
  });

  it('입력이 덜 됐거나 형식이 틀리면 null', () => {
    expect(minuteRangesFor(B({ hour: undefined }))).toBeNull();
    expect(minuteRangesFor(B({ year: undefined }))).toBeNull();
    expect(minuteRangesFor('x')).toBeNull();
    expect(minuteRangesFor(null)).toBeNull();
  });
});

describe('미리보기와 리포트', () => {
  it("'모름'이면 시주가 비고, 차트 아래 안내에 분 구간별 시주가 나온다", () => {
    const r = buildPreview(B({ minuteSegment: 'unknown' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.chart.hasTime).toBe(false);
    expect(r.view.cover.birthLabel).toContain('13시대(분 모름, 시주 제외)');
    expect(r.view.basis.timeCorrection).toContain('태어난 분 모름(시주 제외)');
    const n = r.view.basis.notices.find((x) => x.code === 'unknownMinuteOnBoundary')!;
    expect(n.details).toHaveLength(2);
    expect(n.details[0]).toMatch(/^13:00~13:32 출생: 시주 .*\(.*午\)/);
    expect(n.details[1]).toMatch(/^13:33~13:59 출생: 시주 .*\(.*未\)/);
  });

  it('구간을 고르면 시주가 있고 안내는 없다', () => {
    const r = buildPreview(B({ minuteSegment: 33 }));
    expect(r.ok && r.view.chart.hasTime).toBe(true);
    expect(r.ok && r.view.basis.notices).toEqual([]);
  });

  it("'모름'으로 주문해도 결제 뒤 리포트가 만들어지고 같은 안내가 리포트에도 나온다", async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { birth: B({ minuteSegment: 'unknown' }) });
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    expect((await store.getOrder(o.orderId))!.status).toBe('done');
    const view = await reportViewFor(store, o.orderId, o.accessToken);
    expect(view.chart.hasTime).toBe(false);
    expect(view.cover.birthLabel).toContain('13시대(분 모름, 시주 제외)');
    expect(view.basis.notices.map((n) => n.code)).toContain('unknownMinuteOnBoundary');
  });
});

describe('계산 오류 사례(가상 데이터)와 비슷한 조합 (음력 1967-07-01 08시 분 모름, 경남 남해군, 남)', () => {
  const REPORTED = { name: '', calendar: 'lunar', isLeapMonth: false, year: 1967, month: 7, day: 1, timeUnknown: false, hour: 8, minuteUnknown: true, gender: 'male', regionId: 'gyeongnam:남해군', consent: true };

  it('이 사례는 경계가 없는 시라 바로 미리보기가 나온다', () => {
    expect(minuteRangesFor(REPORTED)).toEqual([{ fromMinute: 0, toMinute: 59 }]);
    const r = buildPreview(REPORTED);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.cover.birthLabel).toBe('음력 1967년 7월 1일 08시경(분 모름) · 남');
      expect(r.view.basis.timeCorrection).toContain('동경 127.89°');
    }
  });

  it('음력 날짜·윤달·시·지역·분 모름 답을 섞어도 서버가 예외를 던지지 않고, 실패는 고칠 칸을 알려 준다', { timeout: 60_000 }, async () => {
    const { DISTRICTS } = await import('../../src/config/regions');
    let k = 0;
    for (let year = 1900; year <= 2050; year += 3) {
      for (const month of [1, 7, 11, 12]) {
        for (const day of [1, 10, 29, 30]) {
          for (const isLeapMonth of [false, true]) {
            k += 1;
            const base = { ...REPORTED, year, month, day, isLeapMonth, hour: k % 24, regionId: DISTRICTS[(k * 13) % DISTRICTS.length]!.id };
            const ranges = minuteRangesFor(base);
            const answers = ranges && ranges.length > 1 ? [ranges[0]!.fromMinute, ranges[ranges.length - 1]!.fromMinute, 'unknown' as const] : [undefined];
            for (const minuteSegment of answers) {
              const r = buildPreview({ ...base, minuteSegment });
              if (!r.ok) expect(Object.keys(r.errors)).toEqual(['date']);
            }
          }
        }
      }
    }
  });

  it('음력 2050년 끝 무렵(양력 2051년)은 범위 문구 대신 양력 기준으로 고치라고 알려 준다', () => {
    const r = buildPreview({ ...REPORTED, year: 2050, month: 12, day: 15 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.date).toBe('음력으로는 2050년 11월 18일(양력 2050년 12월 31일)까지만 계산할 수 있어요. 그 전 날짜로 입력해 주세요.');
    // 연도 자체가 범위 밖이면 기존 문구
    const out = buildPreview({ ...REPORTED, calendar: 'solar', year: 2051, month: 1, day: 1 });
    if (!out.ok) expect(out.errors.date).toBe('1900~2050년 사이로 입력해 주세요.');
  });
});
