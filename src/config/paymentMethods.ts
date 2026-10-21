// 결제 수단 목록 (SPEC 1-1장 화면 5). 1차 출시는 카카오페이만 켠다.
// 켜는 수단은 환경변수 PAYMENT_METHODS_ENABLED(쉼표로 구분, 기본 kakaopay)로 정한다.
// 수단을 열 때는 이 값에 id를 더하고, 결제 어댑터의 수단 코드 표(src/payments)에 그 수단을 더한다.
// 브라우저 코드에서는 이 모듈의 함수 대신 서버가 넘겨 준 목록을 쓴다(환경변수는 서버에만 있다).
import type { Env } from './flags';

export interface PaymentMethod {
  id: string;
  name: string;
  group: 'easy' | 'other';
  enabled: boolean;
}

const CATALOG: readonly Omit<PaymentMethod, 'enabled'>[] = Object.freeze([
  { id: 'kakaopay', name: '카카오페이', group: 'easy' },
  { id: 'tosspay', name: '토스페이', group: 'easy' },
  { id: 'naverpay', name: '네이버페이', group: 'easy' },
  { id: 'payco', name: '페이코', group: 'easy' },
  { id: 'samsungpay', name: '삼성페이', group: 'easy' },
  { id: 'card', name: '신용·체크카드', group: 'other' },
  { id: 'transfer', name: '계좌이체', group: 'other' },
]);

export const DEFAULT_ENABLED_METHODS = 'kakaopay';

export function paymentMethods(env: Env = process.env): PaymentMethod[] {
  const raw = env.PAYMENT_METHODS_ENABLED?.trim() || DEFAULT_ENABLED_METHODS;
  const enabled = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  return CATALOG.map((m) => ({ ...m, enabled: enabled.has(m.id) }));
}

export function findPaymentMethod(id: string, env: Env = process.env): PaymentMethod | undefined {
  return paymentMethods(env).find((m) => m.id === id);
}

/** 주문 때 수단을 보내지 않으면 쓰는 기본 수단 (켜진 것 중 첫째) */
export function defaultPaymentMethod(env: Env = process.env): PaymentMethod | undefined {
  return paymentMethods(env).find((m) => m.enabled);
}
