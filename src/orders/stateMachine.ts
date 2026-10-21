// 주문 상태 머신 (SPEC Phase 4). 허용된 이동만 일어나게 한다.
// created → paid(결제 승인) → generating → done / failed → generating(재시도)
// 환불(refunded)은 운영자가 관리 스크립트로만 처리한다(자동 처리 없음, D-027).
import type { Order, OrderStatus } from '../store/types';

const ALLOWED: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = Object.freeze({
  created: ['paid'],
  paid: ['generating', 'refunded'],
  generating: ['done', 'failed'],
  failed: ['generating', 'refunded'],
  done: ['refunded'],
  refunded: [],
});

export class InvalidTransition extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`주문 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다`);
    this.name = 'InvalidTransition';
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** 상태를 바꾼 새 주문을 돌려준다. 허용되지 않은 이동이면 던진다 */
export function transition(o: Order, to: OrderStatus, patch: Partial<Order> = {}): Order {
  if (!canTransition(o.status, to)) throw new InvalidTransition(o.status, to);
  return { ...o, ...patch, status: to };
}
