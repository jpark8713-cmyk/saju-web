// Phase 3 서버 로직: 입력 검증, 주문 생성(서버 계산 금액), 가짜 결제(개발 전용), 생성 후 출생 정보 삭제, 리포트 뷰, 미리보기
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as fakePaymentRoute } from '../../src/app/api/dev/fake-payment/route';
import { POST as resendRoute, RESEND_MESSAGE } from '../../src/app/api/delivery/resend/route';
import { isFakeLlmEnabled, isFakePaymentEnabled } from '../../src/config/flags';
import { PRICES, priceFor } from '../../src/config/prices';
import { DevFakeTransport, DevPassModerator } from '../../src/llm/devFake';
import { createOrder, OrderInputError } from '../../src/orders/create';
import { fakePay, FakePaymentDisabled } from '../../src/orders/fakePayment';
import { NotPaid, startGeneration } from '../../src/orders/generation';
import { requestRefund } from '../../src/orders/refund';
import { reportViewFor } from '../../src/orders/reportAccess';
import { MemoryStore } from '../../src/store/memory';
import { validateBirthForm } from '../../src/web/birthForm';
import { buildPreview } from '../../src/web/preview';

const BIRTH = {
  name: '홍길동', calendar: 'solar', isLeapMonth: false, year: 1990, month: 5, day: 15,
  timeUnknown: false, hour: 14, minute: 30, gender: 'female', regionId: 'busan', consent: true,
};
const ORDER = (over: Record<string, unknown> = {}) => ({
  birth: BIRTH, topicIds: ['wealth'], deliveryMethods: ['pdf'], email: null, paymentMethod: 'kakaopay', ...over,
});
const devEnv = () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('ENABLE_FAKE_PAYMENT', 'true');
};
const runtime = (mode: 'ok' | 'fail' = 'ok') => () => ({ transport: new DevFakeTransport(mode), moderator: new DevPassModerator() });

afterEach(() => vi.unstubAllEnvs());

async function paidOrder(store: MemoryStore, over: Record<string, unknown> = {}) {
  devEnv();
  const o = await createOrder(store, ORDER(over));
  await fakePay(store, o.orderId, o.accessToken, 'success');
  return o;
}

describe('정보 입력 검증 (화면 2와 서버 공통)', () => {
  it('필수값이 비면 칸별 한국어 문구를 돌려준다', () => {
    const r = validateBirthForm({ calendar: 'solar', isLeapMonth: false, timeUnknown: false, consent: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      date: '생년월일을 입력해 주세요.',
      time: '태어난 시간을 입력하거나 "모름"을 선택해 주세요.',
      gender: '성별을 선택해 주세요.',
      consent: '개인정보 수집·이용에 동의해 주세요.',
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

describe('가짜 결제는 개발 환경에서만', () => {
  it('NODE_ENV=production이면 환경변수를 켜도 꺼진다', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_FAKE_PAYMENT', 'true');
    vi.stubEnv('ENABLE_FAKE_LLM', 'true');
    expect(isFakePaymentEnabled()).toBe(false);
    expect(isFakeLlmEnabled()).toBe(false);
  });

  it('development·test가 아닌 NODE_ENV(비어 있음, staging)에서도 꺼진다', () => {
    for (const NODE_ENV of [undefined, '', 'staging', 'Production']) {
      expect(isFakePaymentEnabled({ NODE_ENV, ENABLE_FAKE_PAYMENT: 'true' })).toBe(false);
      expect(isFakeLlmEnabled({ NODE_ENV, ENABLE_FAKE_LLM: 'true' })).toBe(false);
    }
    expect(isFakePaymentEnabled({ NODE_ENV: 'development', ENABLE_FAKE_PAYMENT: 'true' })).toBe(true);
  });

  it('운영 환경에서 가짜 결제 API는 404이고 주문을 바꾸지 않는다', async () => {
    const store = new MemoryStore();
    const o = await createOrder(store, ORDER());
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_FAKE_PAYMENT', 'true');
    const res = await fakePaymentRoute(
      new Request('http://x/api/dev/fake-payment', {
        method: 'POST', headers: { 'x-order-token': o.accessToken }, body: JSON.stringify({ orderId: o.orderId, outcome: 'success' }),
      }),
    );
    expect(res.status).toBe(404);
    await expect(fakePay(store, o.orderId, o.accessToken, 'success')).rejects.toBeInstanceOf(FakePaymentDisabled);
    expect((await store.getOrder(o.orderId))!.status).toBe('created');
  });

  it('토큰이 틀리면 결제할 수 없다', async () => {
    const store = new MemoryStore();
    const o = await createOrder(store, ORDER());
    devEnv();
    await expect(fakePay(store, o.orderId, 'wrong', 'success')).rejects.toThrow();
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
  it('근거 번호는 1부터 처음 나온 순서이고, 문장마다 근거가 있다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { topicIds: ['wealth'] });
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    const view = await reportViewFor(store, o.orderId, o.accessToken);
    expect(view.sections.map((s) => s.id)).toEqual(['summary', 'traits', 'topics', 'daewoon', 'yearly']);
    const refs = view.sections.flatMap((s) => s.groups.flatMap((g) => g.sentences.flatMap((x) => x.refs)));
    const firstSeen = [...new Set(refs)];
    expect(firstSeen).toEqual(firstSeen.map((_, i) => i + 1));
    expect(view.evidence.map((e) => e.n)).toEqual(firstSeen);
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
    expect(Object.keys(v).sort()).toEqual(['basis', 'chart', 'cover', 'evidence', 'kind', 'locked', 'summary']);
    expect(v.summary.length).toBeGreaterThan(0);
    expect(v.summary.every((s) => s.refs.length > 0)).toBe(true);
  });
});

describe('환불 요청과 재발송', () => {
  it('결제 전 주문은 없는 주문과 같은 문구로 거부한다', async () => {
    const store = new MemoryStore();
    const o = await createOrder(store, ORDER());
    const body = { orderId: o.orderId, reason: 'other', email: 'a@example.com' };
    await expect(requestRefund(store, o.orderId, body)).rejects.toMatchObject({ errors: { orderId: '주문번호를 다시 확인해 주세요.' } });
  });

  it('같은 주문을 다시 접수하면 기존 접수번호를 돌려준다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    const body = { orderId: o.orderId, reason: 'not_generated', email: 'a@example.com' };
    const a = await requestRefund(store, o.orderId, body);
    const b = await requestRefund(store, o.orderId, body);
    expect(b).toEqual({ ...a, duplicate: true });
  });

  it('재발송 응답은 입력과 관계없이 같다', async () => {
    const res = await resendRoute();
    expect(await res.json()).toEqual({ message: RESEND_MESSAGE });
  });
});
