// Phase 3 서버 로직: 입력 검증, 주문 생성(서버 계산 금액), 생성 후 출생 정보 삭제, 리포트 뷰, 미리보기
// 결제(목 어댑터)·환불·발급 기록 등 Phase 4는 payments.test.ts·refunds.test.ts, 결과물 전달(Phase 5)은 delivery.test.ts에 있다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFakeLlmEnabled, isMockPaymentAllowed } from '../../src/config/flags';
import { toLunar } from '../../src/engine/calendar';
import { LUNAR_SUPPORTED_END } from '../../src/engine/settings';
import { PRICES, priceFor } from '../../src/config/prices';
import { createOrder, OrderInputError } from '../../src/orders/create';
import { NotPaid, startGeneration } from '../../src/orders/generation';
import { reportViewFor } from '../../src/orders/reportAccess';
import { MemoryStore } from '../../src/store/memory';
import { validateBirthForm } from '../../src/web/birthForm';
import { buildPreview } from '../../src/web/preview';
import { BIRTH, ORDER, paidOrder, runtime } from './helpers';

afterEach(() => vi.unstubAllEnvs());

describe('정보 입력 검증 (화면 2와 서버 공통)', () => {
  it('필수값이 비면 칸별 한국어 문구를 돌려준다', () => {
    const r = validateBirthForm({ calendar: 'solar', isLeapMonth: false, timeUnknown: false, consent: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      date: '생년월일을 입력해 주세요.',
      time: '태어난 시간을 입력하거나 "모름"을 선택해 주세요.',
      gender: '성별을 선택해 주세요.',
      consent: '개인정보 수집·이용 동의가 필요해요.',
    });
  });

  it('연도가 지원 범위 밖이면 월·일이 비어 있어도 범위 문구를 먼저 보여 준다', () => {
    const r = validateBirthForm({ ...BIRTH, year: 1800, month: undefined, day: undefined });
    expect(!r.ok && r.errors.date).toBe('1900~2050년 사이로 입력해 주세요.');
  });

  it('시간 모름이면 시·분 없이 통과하고 시주를 빼고 계산한다', () => {
    const r = validateBirthForm({ ...BIRTH, timeUnknown: true, hour: undefined, minute: undefined });
    expect(r.ok && r.value.input.time).toBeNull();
  });

  it('윤달은 음력일 때만 반영하고, 존재하지 않는 양력 날짜는 거부한다', () => {
    const solar = validateBirthForm({ ...BIRTH, isLeapMonth: true });
    expect(solar.ok && solar.value.input.isLeapMonth).toBe(false);
    const bad = validateBirthForm({ ...BIRTH, month: 2, day: 30 });
    expect(!bad.ok && bad.errors.date).toBe('존재하지 않는 날짜입니다.');
  });

  it('윤달이 없는 해의 음력 윤달은 서버(엔진) 검증에서 거부한다', () => {
    // 2023년은 윤2월만 있다. 윤5월은 없다
    const r = buildPreview({ ...BIRTH, calendar: 'lunar', isLeapMonth: true, year: 2023, month: 5, day: 1 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.date).toContain('음력');
  });
});

describe('지원 범위 끝 (양력 2050-12-31까지)', () => {
  const lunar = (month: number, day: number) => buildPreview({ ...BIRTH, calendar: 'lunar', isLeapMonth: false, year: 2050, month, day });
  it('양력으로 2050-12-31인 음력 2050-11-18은 받고, 그 다음 날부터는 음력 마지막 날짜를 알려 주며 거부한다', () => {
    expect(toLunar({ year: 2050, month: 12, day: 31 })).toMatchObject({ ...LUNAR_SUPPORTED_END, isLeapMonth: false });
    expect(lunar(11, 18).ok).toBe(true);
    for (const [m, d] of [[11, 19], [11, 20], [11, 29], [12, 1], [12, 30]] as const) {
      const r = lunar(m, d);
      expect(!r.ok && r.errors.date).toBe('음력으로는 2050년 11월 18일(양력 2050년 12월 31일)까지만 계산할 수 있어요. 그 전 날짜로 입력해 주세요.');
    }
  });

  it('없는 날(31일)은 범위 밖이 아니라 없는 날짜로 거부한다', () => {
    const r = lunar(11, 31);
    expect(!r.ok && r.errors.date).toMatch(/^존재하지 않는/);
  });
});

describe('가격과 주문 생성', () => {
  it('합계 = 기본가 + 주제 가격, 꺼진·없는 주제는 계산하지 않는다', () => {
    expect(priceFor(['wealth', 'love']).total).toBe(PRICES.base + 2 * PRICES.perTopic);
    expect(priceFor(['nope']).total).toBe(PRICES.base);
  });

  it('클라이언트가 보낸 금액은 무시하고 서버가 계산한다', async () => {
    const store = new MemoryStore();
    const o = await createOrder(store, { ...ORDER(), amount: 1, total: 1 });
    expect(o.amount).toBe(PRICES.base + PRICES.perTopic);
    expect((await store.getOrder(o.orderId))!.amount).toBe(o.amount);
  });

  it('잘못된 주제·빈 받는 방법·이메일 누락·꺼진 결제 수단을 거부한다', async () => {
    const store = new MemoryStore();
    const errorsOf = async (over: Record<string, unknown>) => {
      try {
        await createOrder(store, ORDER(over));
        return {};
      } catch (e) {
        expect(e).toBeInstanceOf(OrderInputError);
        return (e as OrderInputError).errors;
      }
    };
    expect(await errorsOf({ topicIds: ['nope'] })).toHaveProperty('topics');
    expect(await errorsOf({ deliveryMethods: [] })).toHaveProperty('delivery');
    expect(await errorsOf({ deliveryMethods: ['email'], email: 'not-an-email' })).toHaveProperty('email');
    expect(await errorsOf({ paymentMethod: 'tosspay' })).toHaveProperty('payment');
  });

  it('이메일은 이메일 받기를 골랐을 때만 저장하고, 토큰은 해시만 저장한다', async () => {
    const store = new MemoryStore();
    const o = await createOrder(store, ORDER({ email: 'a@example.com' }));
    const saved = (await store.getOrder(o.orderId))!;
    expect(saved.email).toBeNull();
    expect(JSON.stringify(saved)).not.toContain(o.accessToken);
  });
});

describe('개발 전용 스위치', () => {
  it('NODE_ENV=production이면 환경변수를 켜도 목 결제·가짜 LLM이 꺼진다', () => {
    expect(isMockPaymentAllowed({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' })).toBe(false);
    expect(isFakeLlmEnabled({ NODE_ENV: 'production', ENABLE_FAKE_LLM: 'true' })).toBe(false);
  });

  it('development·test가 아닌 NODE_ENV(비어 있음, staging)에서도 꺼진다', () => {
    for (const NODE_ENV of [undefined, '', 'staging', 'Production']) {
      expect(isMockPaymentAllowed({ NODE_ENV, PAYMENT_PROVIDER: 'mock' })).toBe(false);
      expect(isFakeLlmEnabled({ NODE_ENV, ENABLE_FAKE_LLM: 'true' })).toBe(false);
    }
    expect(isMockPaymentAllowed({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock' })).toBe(true);
  });
});

describe('리포트 생성', () => {
  it('결제 전에는 생성을 시작하지 않는다', async () => {
    const store = new MemoryStore();
    const o = await createOrder(store, ORDER());
    await expect(startGeneration(store, o.orderId, o.accessToken, runtime())).rejects.toBeInstanceOf(NotPaid);
  });

  it('성공하면 출생 정보를 지우고, 같은 요청을 다시 보내도 한 번만 생성한다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    const first = await startGeneration(store, o.orderId, o.accessToken, runtime());
    const second = await startGeneration(store, o.orderId, o.accessToken, runtime());
    expect(second.job).toBeNull();
    await first.job;
    const saved = (await store.getOrder(o.orderId))!;
    expect(saved.status).toBe('done');
    expect(saved.generation.runs).toBe(1);
    expect(saved.pendingBirth).toBeNull();
    expect(JSON.stringify(saved)).not.toContain('홍길동');
  });

  it('실패하면 재시도를 위해 출생 정보를 남기고 다시 시작할 수 있다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    await (await startGeneration(store, o.orderId, o.accessToken, runtime('fail'))).job;
    const failed = (await store.getOrder(o.orderId))!;
    expect(failed.status).toBe('failed');
    expect(failed.pendingBirth).not.toBeNull();
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    expect((await store.getOrder(o.orderId))!.status).toBe('done');
  });
});

describe('리포트 뷰 (화면·PDF 공통)', () => {
  it('근거 번호는 목록 순서대로 1부터이고(D-041), 문장이 가리키는 번호는 모두 목록에 있다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { topicIds: ['wealth'] });
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    const view = await reportViewFor(store, o.orderId, o.accessToken);
    expect(view.sections.map((s) => s.id)).toEqual(['summary', 'traits', 'topics', 'daewoon', 'yearly']);
    const refs = new Set(view.sections.flatMap((s) => s.groups.flatMap((g) => g.sentences.flatMap((x) => x.refs))));
    expect(view.evidence.map((e) => e.n)).toEqual(view.evidence.map((_, i) => i + 1));
    expect([...refs].sort((a, b) => a - b)).toEqual(view.evidence.map((e) => e.n));
    expect(view.sections.every((s) => s.groups.every((g) => g.sentences.every((x) => x.refs.length > 0)))).toBe(true);
  });

  it('고르지 않은 주제는 화면에도 근거 목록에도 없다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { topicIds: ['wealth'] });
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    const view = await reportViewFor(store, o.orderId, o.accessToken);
    const topics = view.sections.find((s) => s.id === 'topics')!;
    expect(topics.groups.map((g) => g.subtitle)).toEqual(['재물']);
    // 근거 목록은 화면에 나온 문장이 가리키는 근거뿐이다
    const used = new Set(view.sections.flatMap((s) => s.groups.flatMap((g) => g.sentences.flatMap((x) => x.refs))));
    expect(view.evidence.every((e) => used.has(e.n))).toBe(true);
  });

  it('다른 토큰으로는 리포트를 볼 수 없다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    await expect(reportViewFor(store, o.orderId, 'wrong')).rejects.toThrow();
  });
});

describe('무료 미리보기 응답', () => {
  it('잠긴 섹션은 제목만 있고 대운·세운 목록과 유료 본문이 없다', () => {
    const r = buildPreview(BIRTH);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.view;
    expect(v.locked.map((l) => Object.keys(l).sort())).toEqual(Array(4).fill(['id', 'title']));
    expect(v.chart.daewoon).toEqual([]);
    expect(v.chart.seun).toEqual([]);
    expect(Object.keys(v).sort()).toEqual(['basis', 'chart', 'child', 'cover', 'evidence', 'kind', 'locked', 'summary']);
    expect(v.summary.length).toBeGreaterThan(0);
    expect(v.summary.every((s) => s.refs.length > 0)).toBe(true);
  });
});
