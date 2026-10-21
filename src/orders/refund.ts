// 환불 요청 접수 (화면 D → E, POST /api/orders/:id/refund-request). 접수만 하고 결제 취소는 하지 않는다(D-027).
// 이름·생년월일·전화번호는 받지 않는다.
// 본인 확인(D-028): 이 브라우저의 주문 토큰(기기값)이 맞거나, 이메일로 받기 주문이면 주문 때 입력한 이메일이 맞아야 한다.
// 회신받을 이메일은 따로 받아 이 환불 건에만 저장한다. 주문에는 저장하지 않는다.
// 응답(D-028): 형식이 맞는 요청이면 주문이 있든 없든, 본인 확인이 되든 안 되든 같은 모양(202, 접수번호, 같은 문구)으로 답한다.
//   접수번호는 서버 비밀값 HMAC(주문번호, 확인 수단 값)으로 정해진다. 실제 접수가 이미 있으면 본인 확인이 된 요청에만 그 번호를 준다.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { REFUND_PER_IP, REFUND_PER_ORDER } from '../config/limits';
import { refundIdSecret } from '../config/secrets';
import type { Env } from '../config/flags';
import type { Order, RefundRequest, Store } from '../store/types';
import { RateLimited, type RateLimiter } from '../web/rateLimit';
import { isValidEmail } from './create';
import { ORDER_ID_RE, hashToken, tokenMatches } from './ids';
import { REFUND_ACK_MESSAGE, REFUND_DETAIL_MAX } from './refundForm';

export { REFUND_DETAIL_MAX, REFUND_REASONS } from './refundForm';

const schema = z.object({
  orderId: z.string(),
  reason: z.enum(['not_generated', 'duplicate', 'changed_mind', 'other']),
  detail: z.string().optional().nullable(),
  /** 회신받을 이메일 (필수) */
  email: z.string(),
  /** 주문할 때 입력한 이메일 (이메일로 받기 주문, 다른 기기에서 접수할 때) */
  orderEmail: z.string().optional().nullable(),
});

export type RefundField = 'orderId' | 'reason' | 'detail' | 'email' | 'orderEmail' | 'form';

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
  const orderEmail = (p.data.orderEmail ?? '').trim();
  if (orderEmail && !isValidEmail(orderEmail)) errors.orderEmail = '주문할 때 입력한 이메일 주소를 정확히 입력해 주세요.';
  if ((p.data.detail ?? '').length > REFUND_DETAIL_MAX) errors.detail = `상세 내용은 ${REFUND_DETAIL_MAX}자 이내로 적어 주세요.`;
  return errors;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** 본인 확인 수단: 이 브라우저의 주문 토큰, 주문 때 입력한 이메일. 둘 다 올 수도, 둘 다 없을 수도 있다 */
interface Proof {
  token: string | null;
  orderEmail: string | null;
}

function proofOf(token: string | null, orderEmail: string | null | undefined): Proof {
  const e = (orderEmail ?? '').trim();
  return { token: token || null, orderEmail: e ? normalizeEmail(e) : null };
}

/** 접수번호: RF + 주문번호의 날짜 + HMAC(주문번호, 확인 수단 값)에서 뽑은 8자리. 같은 입력이면 늘 같은 번호다 */
export function refundIdFor(orderId: string, proof: Proof, secret: string): string {
  const material = [orderId, `device:${proof.token ? hashToken(proof.token) : ''}`, `email:${proof.orderEmail ?? ''}`].join('\n');
  const mac = createHmac('sha256', secret).update(material).digest();
  const code = Array.from(mac.subarray(0, 8), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `RF${orderId.slice(2, 10)}-${code}`;
}

function sameText(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function verified(order: Order | null, proof: Proof): RefundRequest['verifiedBy'] | null {
  // 결제 전 주문은 환불할 것이 없다(없는 주문과 같게 다룬다)
  if (!order || order.status === 'created') return null;
  if (proof.token && tokenMatches(proof.token, order.accessTokenHash)) return 'device';
  if (proof.orderEmail && order.email && sameText(normalizeEmail(order.email), proof.orderEmail)) return 'orderEmail';
  return null;
}

export interface RefundAck {
  refundId: string;
  orderId: string;
  message: string;
}

export interface RefundContext {
  store: Store;
  limiter: RateLimiter;
  ip: string;
  /** 이 브라우저가 가진 주문 토큰 (x-order-token, 없으면 null) */
  token: string | null;
  env?: Env;
  now?: Date;
}

export async function requestRefund(ctx: RefundContext, pathOrderId: string, raw: unknown): Promise<RefundAck> {
  const errors = validateRefundForm(raw);
  if (Object.keys(errors).length) throw new RefundInputError(errors);
  const body = schema.parse(raw);
  const orderId = body.orderId.trim();
  if (orderId !== pathOrderId) throw new RefundInputError({ orderId: '주문번호가 일치하지 않습니다.' });

  const now = ctx.now ?? new Date();
  // IP당 한도를 먼저 센다. 넘으면 주문번호 키를 만들지 않는다(D-029)
  if (!ctx.limiter.hit(`refund:ip:${ctx.ip}`, REFUND_PER_IP, now.getTime())) throw new RateLimited();

  const proof = proofOf(ctx.token, body.orderEmail);
  const refundId = refundIdFor(orderId, proof, refundIdSecret(ctx.env));
  const ack = (id: string): RefundAck => ({ refundId: id, orderId, message: REFUND_ACK_MESSAGE });

  const order = await ctx.store.getOrder(orderId);
  // 주문번호당 한도(D-029·D-030): 본인 확인이 안 된 시도만 센다(없는 주문번호도 같다).
  // 한도를 넘긴 주문번호는 그 구간 동안 주문 이메일 대조를 하지 않는다(이메일 대입 방지). 기기값 확인은 그대로 받는다.
  // 한도를 넘겨도 429를 주지 않고 같은 접수 화면으로 답한다. 답이 갈리면 맞는 이메일을 알아낼 수 있기 때문이다.
  const orderKey = `refund:order:${orderId}`;
  const emailCheckOpen = ctx.limiter.count(orderKey, now.getTime()) < REFUND_PER_ORDER.max;
  const by = verified(order, emailCheckOpen ? proof : { ...proof, orderEmail: null });
  if (!by) {
    ctx.limiter.hit(orderKey, REFUND_PER_ORDER, now.getTime());
    return ack(refundId);
  }

  const refund: RefundRequest = {
    id: refundId,
    orderId,
    reason: body.reason,
    detail: body.detail?.trim() || null,
    email: body.email.trim(),
    verifiedBy: by,
    status: 'received',
    createdAt: now.toISOString(),
    processedAt: null,
    result: null,
  };
  // 주문당 접수는 하나다. 확인과 저장을 한 번에 해서 동시에 온 요청도 같은 접수번호를 받는다
  const saved = await ctx.store.createRefundIfAbsent(refund);
  return ack(saved.id);
}
