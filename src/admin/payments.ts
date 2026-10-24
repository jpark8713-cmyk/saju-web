// 승인 여부를 모르는 결제 확인 (D-054, LAUNCH_CHECKLIST 2-8). 운영자가 PG 관리자 화면에서 결제 키의 승인 여부를 본 뒤 결과를 기록한다.
// 기록하면 그 결제 키는 "승인 여부 모름" 칸에서 빠지고, 남은 키가 없으면 보관 기간 정리의 경고 로그·출생 정보 보류도 끝난다.
// 승인돼 있던 결제를 취소하거나 결제 완료로 처리하는 일 자체는 PG 관리자 화면에서 한다(실제 PG 어댑터가 붙으면 2-9 복구 명령으로 옮긴다).
import type { Order, PaymentState, Store } from '../store/types';
import { AdminError } from './refunds';

export type UncertainCheck = 'not-approved' | 'approved-cancelled' | 'approved-kept';
export const UNCERTAIN_CHECKS: readonly UncertainCheck[] = ['not-approved', 'approved-cancelled', 'approved-kept'];

export interface UncertainRow {
  orderId: string;
  status: Order['status'];
  since: string | null;
  paymentKeys: string[];
  lastError: string | null;
}

/** 예전 기록(전용 칸 없이 lastError만 남은 주문)도 함께 보인다 */
const LEGACY_UNCERTAIN = new Set(['PG_UNREACHABLE', 'ORDER_EXPIRED_AFTER_PG_UNREACHABLE']);

export async function listUncertainPayments(store: Store): Promise<UncertainRow[]> {
  return (await store.listOrdersWithUncertainPayment()).map((o) => ({
    orderId: o.id,
    status: o.status,
    since: o.payment.uncertain?.since ?? null,
    paymentKeys: o.payment.uncertain?.paymentKeys ?? [],
    lastError: o.payment.lastError,
  }));
}

/**
 * 확인 결과를 기록한다. paymentKey를 주면 그 키만, 주지 않으면 그 주문의 승인 여부 모름 표시를 모두 끝낸다(예전 기록 포함).
 * 기록은 payment.uncertainChecks에 남는다(누가 봤는지는 남기지 않는다. 메모에 개인정보를 적지 않는다)
 */
export async function resolveUncertainPayment(
  store: Store,
  orderId: string,
  input: { result: UncertainCheck; paymentKey?: string; note: string | null },
  now = new Date(),
): Promise<Order> {
  const before = await store.getOrder(orderId);
  if (!before) throw new AdminError('주문이 없어요');
  const keys = before.payment.uncertain?.paymentKeys ?? [];
  const legacy = before.payment.lastError !== null && LEGACY_UNCERTAIN.has(before.payment.lastError);
  if (input.paymentKey && !keys.includes(input.paymentKey)) throw new AdminError('이 주문의 승인 여부 모름 칸에 그 결제 키가 없어요');
  if (!keys.length && !legacy) throw new AdminError('이 주문에는 승인 여부를 모르는 결제가 없어요');
  const at = now.toISOString();
  const updated = await store.updateOrder(orderId, (o) => {
    const p: PaymentState = o.payment;
    const current = p.uncertain?.paymentKeys ?? [];
    const done = input.paymentKey ? [input.paymentKey] : current;
    const rest = current.filter((k) => !done.includes(k));
    const checks = [...(p.uncertainChecks ?? []), ...(done.length ? done : [null]).map((paymentKey) => ({ paymentKey, result: input.result, at, note: input.note }))];
    return {
      ...o,
      payment: {
        ...p,
        uncertain: rest.length ? { ...p.uncertain!, paymentKeys: rest } : null,
        // 모두 끝났으면 예전 기록의 표시도 지운다(경고 로그 대상에서 빠진다)
        lastError: !rest.length && p.lastError !== null && LEGACY_UNCERTAIN.has(p.lastError) ? 'UNCERTAIN_CHECKED' : p.lastError,
        uncertainChecks: checks,
      },
    };
  });
  if (!updated) throw new AdminError('주문이 없어요');
  return updated;
}
