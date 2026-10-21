// 결제 어댑터 고르기. PAYMENT_PROVIDER 환경변수로 정한다.
// - mock: 개발·테스트 환경에서만 만든다. 운영에서는 값이 mock이어도 어댑터가 없는 것으로 보고 결제를 막는다(D-025·D-028).
// - 실제 PG 어댑터는 사업자 등록·PG 계약 뒤 별도 Phase에서 더한다(SPEC Phase 4 마지막 항목).
import { isMockPaymentAllowed, type Env } from '../config/flags';
import { MockPaymentProvider } from './mock';
import type { PaymentProvider } from './types';

const KEY = Symbol.for('saju.mockPaymentProvider');
type WithMock = typeof globalThis & { [KEY]?: MockPaymentProvider };

/** 개발 서버가 모듈을 다시 불러와도 결제창과 승인 요청이 같은 목 어댑터를 쓰게 한다 */
export function sharedMockProvider(): MockPaymentProvider {
  const g = globalThis as WithMock;
  g[KEY] ??= new MockPaymentProvider();
  return g[KEY];
}

export function getPaymentProvider(env: Env = process.env): PaymentProvider | null {
  if (env.PAYMENT_PROVIDER === 'mock') return isMockPaymentAllowed(env) ? sharedMockProvider() : null;
  return null;
}
