// 환불 요청 접수 (화면 D → E, POST /api/orders/:id/refund-request).
// 이름·생년월일·전화번호는 받지 않는다. 같은 주문을 다시 접수하면 기존 접수번호를 돌려준다(SPEC 5장).
// Phase 3은 접수까지만 한다. 운영자 심사·발행 증빙 조회·실제 취소는 Phase 4다.
import { z } from 'zod';
import type { RefundRequest, Store } from '../store/types';
import { isValidEmail } from './create';
import { ORDER_ID_RE, newRefundId } from './ids';
import { REFUND_DETAIL_MAX } from './refundForm';

export { REFUND_DETAIL_MAX, REFUND_REASONS } from './refundForm';

const schema = z.object({
  orderId: z.string(),
  reason: z.enum(['not_generated', 'duplicate', 'changed_mind', 'other']),
  detail: z.string().optional().nullable(),
  email: z.string(),
});

export type RefundField = 'orderId' | 'reason' | 'detail' | 'email' | 'form';

export class RefundInputError extends Error {
  constructor(readonly errors: Partial<Record<RefundField, string>>) {
    super('환불 요청 입력 오류');
    this.name = 'RefundInputError';
  }
}

export function validateRefundForm(raw: unknown): Partial<Record<RefundField, string>> {
  const p = schema.safeParse(raw);
  if (!p.success) return { form: '입력 형식이 올바르지 않습니다.' };
  const errors: Partial<Record<RefundField, string>> = {};
  if (!ORDER_ID_RE.test(p.data.orderId.trim())) errors.orderId = '주문번호 형식이 올바르지 않습니다. (예: SJ20261020-ABCD2345)';
  if (!isValidEmail(p.data.email.trim())) errors.email = '처리 결과를 받을 이메일 주소를 정확히 입력해 주세요.';
  if ((p.data.detail ?? '').length > REFUND_DETAIL_MAX) errors.detail = `상세 내용은 ${REFUND_DETAIL_MAX}자 이내로 적어 주세요.`;
  return errors;
}

export async function requestRefund(store: Store, pathOrderId: string, raw: unknown, now = new Date()): Promise<{ refundId: string; orderId: string; duplicate: boolean }> {
  const errors = validateRefundForm(raw);
  if (Object.keys(errors).length) throw new RefundInputError(errors);
  const body = schema.parse(raw);
  const orderId = body.orderId.trim();
  if (orderId !== pathOrderId) throw new RefundInputError({ orderId: '주문번호가 일치하지 않습니다.' });
  const order = await store.getOrder(orderId);
  // 결제 전 주문은 환불할 것이 없다. 없는 주문과 같은 문구로 답한다(D-026)
  if (!order || order.status === 'created') throw new RefundInputError({ orderId: '주문번호를 다시 확인해 주세요.' });
  const existing = await store.findRefundByOrder(orderId);
  if (existing) return { refundId: existing.id, orderId, duplicate: true };
  const refund: RefundRequest = {
    id: newRefundId(now),
    orderId,
    reason: body.reason,
    detail: body.detail?.trim() || null,
    email: body.email.trim(),
    status: 'received',
    createdAt: now.toISOString(),
  };
  await store.createRefund(refund);
  return { refundId: refund.id, orderId, duplicate: false };
}
