// 운영자 환불 조회·처리 (서버에서 실행하는 관리 스크립트용, D-028). 웹으로는 열지 않는다.
// 환불은 운영자가 이 기능으로 처리할 때만 일어난다. 접수 API는 결제를 취소하지 않는다(D-027).
// 처리 일시와 결과를 환불 건에 기록하고, 처리가 끝나면 회신 이메일을 지운다(SPEC Phase 4).
import type { PaymentProvider } from '../payments/types';
import { canTransition, transition } from '../orders/stateMachine';
import type { IssuanceRecord, Order, RefundRequest, RefundStatus, Store } from '../store/types';

export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminError';
  }
}

export interface RefundRow {
  refundId: string;
  orderId: string;
  status: RefundStatus;
  reason: RefundRequest['reason'];
  verifiedBy: RefundRequest['verifiedBy'];
  createdAt: string;
  orderStatus: Order['status'] | null;
}

export async function listRefundRows(store: Store, status?: RefundStatus): Promise<RefundRow[]> {
  const refunds = await store.listRefunds(status);
  const rows: RefundRow[] = [];
  for (const r of refunds) {
    const o = await store.getOrder(r.orderId);
    rows.push({ refundId: r.id, orderId: r.orderId, status: r.status, reason: r.reason, verifiedBy: r.verifiedBy, createdAt: r.createdAt, orderStatus: o?.status ?? null });
  }
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface RefundDetail {
  refund: RefundRequest;
  order: Pick<Order, 'id' | 'status' | 'amount' | 'topicIds' | 'deliveryMethods' | 'paymentMethod' | 'paidAt' | 'createdAt'> & {
    payment: Order['payment'];
    generation: Order['generation'];
  } | null;
  /** 해당 주문의 발급 기록 (리포트가 만들어졌는지 판단 근거) */
  issuance: IssuanceRecord | null;
  /**
   * 회신 이메일이 주문 때 이메일과 같은지(이메일로 받기 주문만, 아니면 null). 주문 이메일 원문은 보여 주지 않는다.
   * false면 다른 사람이 먼저 접수했을 수 있으니, 결과를 회신하기 전에 주문 이메일로도 확인한다(D-029)
   */
  replyMatchesOrderEmail: boolean | null;
}

export async function showRefund(store: Store, refundId: string): Promise<RefundDetail> {
  const refund = await store.getRefund(refundId);
  if (!refund) throw new AdminError(`접수번호 ${refundId}를 찾을 수 없어요`);
  const o = await store.getOrder(refund.orderId);
  // 주문 정보에서 이메일·출생 정보·토큰 해시는 보여 주지 않는다
  const order = o
    ? { id: o.id, status: o.status, amount: o.amount, topicIds: o.topicIds, deliveryMethods: o.deliveryMethods, paymentMethod: o.paymentMethod, paidAt: o.paidAt, createdAt: o.createdAt, payment: o.payment, generation: o.generation }
    : null;
  const replyMatchesOrderEmail = o?.email && refund.email ? o.email.trim().toLowerCase() === refund.email.trim().toLowerCase() : null;
  return { refund, order, issuance: await store.getIssuance(refund.orderId), replyMatchesOrderEmail };
}

export interface ProcessInput {
  outcome: 'refunded' | 'rejected';
  note: string | null;
  /** PG 관리 화면에서 이미 직접 취소했으면 true: 결제 어댑터를 부르지 않고 기록만 한다 */
  cancelledExternally?: boolean;
}

async function cancelPayment(store: Store, provider: PaymentProvider | null, order: Order, input: ProcessInput, now: Date): Promise<number> {
  if (!canTransition(order.status, 'refunded')) throw new AdminError(`주문 상태가 ${order.status}라 환불 처리할 수 없어요`);
  const p = order.payment;
  if (p.stage !== 'approved' || !p.paymentKey || p.approvedAmount === null) throw new AdminError('승인된 결제가 없는 주문이에요');
  let cancelledAt = now.toISOString();
  let cancelledAmount = p.approvedAmount;
  if (!input.cancelledExternally) {
    if (!provider || provider.id !== p.provider) throw new AdminError('이 주문의 결제 어댑터를 쓸 수 없어요. PG 관리 화면에서 취소한 뒤 --cancelled-externally로 기록하세요');
    const res = await provider.cancel({ paymentKey: p.paymentKey, orderId: order.id, amount: p.approvedAmount, reason: '환불 요청 승인' });
    if (!res.ok) throw new AdminError(`결제 취소에 실패했어요 (${res.code}). 아무것도 바꾸지 않았어요`);
    cancelledAt = res.cancelledAt;
    cancelledAmount = res.cancelledAmount;
  }
  await store.updateOrder(order.id, (o) =>
    canTransition(o.status, 'refunded')
      ? transition(o, 'refunded', { pendingBirth: null, payment: { ...o.payment, stage: 'cancelled', cancelledAt } })
      : o,
  );
  return cancelledAmount;
}

export async function processRefund(store: Store, provider: PaymentProvider | null, refundId: string, input: ProcessInput, now = new Date()): Promise<RefundRequest> {
  const refund = await store.getRefund(refundId);
  if (!refund) throw new AdminError(`접수번호 ${refundId}를 찾을 수 없어요`);
  if (refund.status !== 'received' && refund.status !== 'approved') throw new AdminError(`이미 처리된 접수예요 (${refund.status}, ${refund.processedAt ?? '-'})`);
  let cancelledAmount: number | null = null;
  if (input.outcome === 'refunded') {
    const order = await store.getOrder(refund.orderId);
    if (!order) throw new AdminError('주문을 찾을 수 없어요');
    cancelledAmount = await cancelPayment(store, provider, order, input, now);
  }
  const updated = await store.updateRefund(refundId, (r) => ({
    ...r,
    status: input.outcome,
    processedAt: now.toISOString(),
    result: { outcome: input.outcome, note: input.note, cancelledAmount },
    // 처리가 끝나면 회신 이메일을 지운다
    email: null,
  }));
  if (!updated) throw new AdminError('접수 기록을 저장하지 못했어요');
  return updated;
}
