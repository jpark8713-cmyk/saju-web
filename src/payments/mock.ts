// 목 결제 어댑터 (PG 계약 전, D-028). 개발·테스트 환경에서만 쓴다(src/payments/index.ts가 운영에서는 만들지 않는다).
// 실제 PG처럼 동작한다: 결제창(/dev/mock-pg)에서 인증한 금액을 기억하고, 승인 요청 금액이 다르면 거절한다.
// 결제창에서 금액을 바꿀 수 있게 해 두어, 클라이언트가 금액을 바꿔 보내는 경우를 재현한다.
import { randomBytes } from 'node:crypto';
import type { CancelInput, CancelResult, ConfirmInput, ConfirmResult, PaymentProvider, PrepareInput, PrepareResult } from './types';

/** 목 어댑터가 처리하는 수단 (테스트용으로 7개 모두). 실제 PG 어댑터는 자기 코드 표를 따로 둔다 */
const METHOD_CODES: Readonly<Record<string, string>> = Object.freeze({
  kakaopay: 'KAKAOPAY',
  tosspay: 'TOSSPAY',
  naverpay: 'NAVERPAY',
  payco: 'PAYCO',
  samsungpay: 'SAMSUNGPAY',
  card: 'CARD',
  transfer: 'TRANSFER',
});

export type MockOutcome = 'success' | 'fail' | 'success-genfail';

export interface MockSession {
  paymentKey: string;
  orderId: string;
  orderName: string;
  requestedAmount: number;
  methodCode: string;
  successUrl: string;
  failUrl: string;
  state: 'pending' | 'authorized' | 'approved' | 'failed' | 'cancelled';
  /** 결제창에서 인증한 금액 (클라이언트가 바꿀 수 있다) */
  authorizedAmount: number | null;
  transactionId: string | null;
  approvedAt: string | null;
  devGenFail: boolean;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly id = 'mock';
  private readonly sessions = new Map<string, MockSession>();
  /** 테스트에서 승인 호출 횟수를 센다 */
  confirmCalls = 0;

  supports(methodId: string): boolean {
    return methodId in METHOD_CODES;
  }

  async prepare(input: PrepareInput): Promise<PrepareResult> {
    const paymentKey = `mock_${randomBytes(16).toString('hex')}`;
    this.sessions.set(paymentKey, {
      paymentKey,
      orderId: input.orderId,
      orderName: input.orderName,
      requestedAmount: input.amount,
      methodCode: METHOD_CODES[input.methodId] ?? 'UNKNOWN',
      successUrl: input.successUrl,
      failUrl: input.failUrl,
      state: 'pending',
      authorizedAmount: null,
      transactionId: null,
      approvedAt: null,
      devGenFail: false,
    });
    return { paymentKey, redirectUrl: `/dev/mock-pg?paymentKey=${encodeURIComponent(paymentKey)}` };
  }

  session(paymentKey: string): MockSession | null {
    const s = this.sessions.get(paymentKey);
    return s ? { ...s } : null;
  }

  /** 결제창에서 고객이 인증(또는 취소)한다. 돌려보낼 주소를 돌려준다 */
  authorize(paymentKey: string, outcome: MockOutcome, amount: number): string | null {
    const s = this.sessions.get(paymentKey);
    if (!s || s.state !== 'pending') return null;
    if (outcome === 'fail') {
      this.sessions.set(paymentKey, { ...s, state: 'failed' });
      return withQuery(s.failUrl, { code: 'USER_CANCEL', orderId: s.orderId });
    }
    this.sessions.set(paymentKey, { ...s, state: 'authorized', authorizedAmount: amount, devGenFail: outcome === 'success-genfail' });
    return withQuery(s.successUrl, { paymentKey, orderId: s.orderId, amount: String(amount) });
  }

  async confirm(input: ConfirmInput): Promise<ConfirmResult> {
    this.confirmCalls += 1;
    const s = this.sessions.get(input.paymentKey);
    if (!s || s.orderId !== input.orderId) return { ok: false, code: 'NOT_FOUND_PAYMENT' };
    if (s.state === 'approved') {
      // 같은 승인 요청이 다시 오면 처음 승인 결과를 그대로 돌려준다
      return input.amount === s.authorizedAmount
        ? { ok: true, transactionId: s.transactionId!, approvedAmount: s.authorizedAmount!, approvedAt: s.approvedAt!, devForceGenerationFailure: s.devGenFail }
        : { ok: false, code: 'AMOUNT_MISMATCH' };
    }
    if (s.state === 'cancelled') return { ok: false, code: 'ALREADY_CANCELED' };
    if (s.state !== 'authorized') return { ok: false, code: 'NOT_AUTHORIZED' };
    if (input.amount !== s.authorizedAmount) return { ok: false, code: 'AMOUNT_MISMATCH' };
    const approved: MockSession = {
      ...s,
      state: 'approved',
      transactionId: `mocktx_${randomBytes(8).toString('hex')}`,
      approvedAt: new Date().toISOString(),
    };
    this.sessions.set(s.paymentKey, approved);
    return { ok: true, transactionId: approved.transactionId!, approvedAmount: approved.authorizedAmount!, approvedAt: approved.approvedAt!, devForceGenerationFailure: approved.devGenFail };
  }

  async cancel(input: CancelInput): Promise<CancelResult> {
    const s = this.sessions.get(input.paymentKey);
    if (!s || s.orderId !== input.orderId) return { ok: false, code: 'NOT_FOUND_PAYMENT' };
    if (s.state === 'cancelled') return { ok: false, code: 'ALREADY_CANCELED' };
    if (s.state !== 'approved') return { ok: false, code: 'NOT_APPROVED' };
    this.sessions.set(s.paymentKey, { ...s, state: 'cancelled' });
    return { ok: true, cancelledAt: new Date().toISOString(), cancelledAmount: s.authorizedAmount ?? input.amount };
  }
}

function withQuery(url: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return `${url}${url.includes('?') ? '&' : '?'}${q}`;
}
