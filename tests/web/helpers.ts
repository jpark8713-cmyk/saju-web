// 서버 로직 테스트 공통: 주문 입력값, 목 결제로 결제까지 진행
import { vi } from 'vitest';
import { DevFakeTransport, DevPassModerator } from '../../src/llm/devFake';
import { createOrder } from '../../src/orders/create';
import { confirmPayment, preparePayment } from '../../src/orders/payment';
import { MockPaymentProvider, type MockOutcome } from '../../src/payments/mock';
import type { Store } from '../../src/store/types';

export const BIRTH = {
  name: '홍길동', calendar: 'solar', isLeapMonth: false, year: 1990, month: 5, day: 15,
  timeUnknown: false, hour: 14, minute: 30, gender: 'female', regionId: 'busan', consent: true,
};

export const ORDER = (over: Record<string, unknown> = {}) => ({
  birth: BIRTH, topicIds: ['wealth'], deliveryMethods: ['pdf'], email: null, paymentMethod: 'kakaopay', ...over,
});

/** 목 결제가 켜지는 환경 (vitest의 NODE_ENV는 test) */
export const mockEnv = () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('PAYMENT_PROVIDER', 'mock');
};

export const runtime = (mode: 'ok' | 'fail' = 'ok') => () => ({ transport: new DevFakeTransport(mode), moderator: new DevPassModerator() });

/** 결제창을 열고(prepare) 인증까지 한 뒤 결제 키·복귀 금액을 돌려준다 */
export async function authorizeViaMock(store: Store, provider: MockPaymentProvider, o: { orderId: string; accessToken: string }, outcome: MockOutcome = 'success', amount?: number) {
  const { redirectUrl } = await preparePayment(store, provider, { orderId: o.orderId, token: o.accessToken, methodId: 'kakaopay', origin: () => 'http://x' });
  const paymentKey = new URL(redirectUrl, 'http://x').searchParams.get('paymentKey')!;
  const order = (await store.getOrder(o.orderId))!;
  const to = provider.authorize(paymentKey, outcome, amount ?? order.amount)!;
  const back = new URL(to);
  return { paymentKey, returnedAmount: Number(back.searchParams.get('amount')), back };
}

/** 주문을 만들고 목 결제로 결제(paid)까지 */
export async function paidOrder(store: Store, over: Record<string, unknown> = {}, provider = new MockPaymentProvider()) {
  mockEnv();
  const o = await createOrder(store, ORDER(over));
  const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
  await confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount });
  return { ...o, provider, paymentKey };
}
