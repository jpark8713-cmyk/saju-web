// 전달 상태 초기값과 읽기 도우미 (Phase 5 이전에 만든 주문에는 delivery가 없을 수 있다)
import type { DeliveryState, Order } from '../store/types';

export const EMPTY_DELIVERY: Readonly<DeliveryState> = Object.freeze({
  expiresAt: null,
  pdf: Object.freeze({ stored: false, sha256: null, createdAt: null, lastError: null }),
  email: Object.freeze({ status: 'none' as const, attempts: 0, sentAt: null, lastError: null }),
  renderToken: null,
  purgedAt: null,
});

export function deliveryOf(o: Order): DeliveryState {
  return structuredClone(o.delivery ?? EMPTY_DELIVERY) as DeliveryState;
}

/** 전달 상태 일부만 바꾼 새 주문 */
export function withDelivery(o: Order, patch: (d: DeliveryState) => DeliveryState): Order {
  return { ...o, delivery: patch(deliveryOf(o)) };
}
