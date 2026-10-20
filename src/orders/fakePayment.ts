// 개발 전용 가짜 결제(D-025). 운영 환경에서는 isFakePaymentEnabled()가 항상 false라 동작하지 않는다.
// Phase 4에서 결제 어댑터(PaymentProvider, 목 구현)와 서버 승인 검증으로 바뀐다.
import { isFakePaymentEnabled } from '../config/flags';
import type { Store } from '../store/types';
import { authorizedOrder } from './access';

export type FakeOutcome = 'success' | 'fail' | 'success-genfail';

export class FakePaymentDisabled extends Error {
  constructor() {
    super('가짜 결제는 개발 환경에서만 쓸 수 있습니다');
    this.name = 'FakePaymentDisabled';
  }
}

export interface FakePaymentResult {
  paid: boolean;
  /** 실패일 때 화면 A에 보여 줄 사유 */
  failureReason: string | null;
}

export async function fakePay(store: Store, orderId: string, token: string | null, outcome: FakeOutcome, now = new Date()): Promise<FakePaymentResult> {
  if (!isFakePaymentEnabled()) throw new FakePaymentDisabled();
  const order = await authorizedOrder(store, orderId, token);
  if (outcome === 'fail') return { paid: false, failureReason: '결제가 승인되지 않았습니다(개발용 가짜 실패).' };
  if (order.status !== 'created') return { paid: order.status !== 'refunded', failureReason: null };
  await store.updateOrder(orderId, (o) =>
    o.status === 'created'
      ? { ...o, status: 'paid', paidAt: now.toISOString(), devForceGenerationFailure: outcome === 'success-genfail' }
      : o,
  );
  return { paid: true, failureReason: null };
}
