// 결제 수단 목록 (SPEC 1-1장 화면 5). 1차 출시는 카카오페이만 켠다.
// 수단을 열 때는 enabled를 true로 바꾸고 해당 PG 어댑터 설정만 더한다(어댑터는 Phase 4).

export interface PaymentMethod {
  id: string;
  name: string;
  group: 'easy' | 'other';
  enabled: boolean;
}

export const PAYMENT_METHODS: readonly PaymentMethod[] = Object.freeze([
  { id: 'kakaopay', name: '카카오페이', group: 'easy', enabled: true },
  { id: 'tosspay', name: '토스페이', group: 'easy', enabled: false },
  { id: 'naverpay', name: '네이버페이', group: 'easy', enabled: false },
  { id: 'payco', name: '페이코', group: 'easy', enabled: false },
  { id: 'samsungpay', name: '삼성페이', group: 'easy', enabled: false },
  { id: 'card', name: '신용·체크카드', group: 'other', enabled: false },
  { id: 'transfer', name: '계좌이체', group: 'other', enabled: false },
]);

export function findPaymentMethod(id: string): PaymentMethod | undefined {
  return PAYMENT_METHODS.find((m) => m.id === id);
}
