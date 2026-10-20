// 주문 소유 확인. 주문을 만든 브라우저만 가진 토큰(x-order-token 헤더)으로 확인한다.
import type { Order, Store } from '../store/types';
import { ORDER_ID_RE, tokenMatches } from './ids';

export class AccessDenied extends Error {
  constructor() {
    super('주문을 찾을 수 없거나 접근할 수 없습니다');
    this.name = 'AccessDenied';
  }
}

export const ORDER_TOKEN_HEADER = 'x-order-token';

/** 주문이 없거나 토큰이 틀리면 같은 오류를 낸다(주문 존재 여부를 드러내지 않는다) */
export async function authorizedOrder(store: Store, orderId: string, token: string | null): Promise<Order> {
  if (!ORDER_ID_RE.test(orderId)) throw new AccessDenied();
  const order = await store.getOrder(orderId);
  if (!order || !tokenMatches(token, order.accessTokenHash)) throw new AccessDenied();
  return order;
}
