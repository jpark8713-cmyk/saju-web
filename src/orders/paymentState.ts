// 결제 상태 초기값 (주문 생성·결제 준비가 같이 쓴다)
import type { PaymentState } from '../store/types';

export const EMPTY_PAYMENT: Readonly<PaymentState> = Object.freeze({
  provider: null,
  paymentKey: null,
  stage: 'none',
  confirmingAt: null,
  transactionId: null,
  approvedAmount: null,
  approvedAt: null,
  cancelledAt: null,
  lastError: null,
});
