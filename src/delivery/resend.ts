// 링크 재발송 (화면 C, POST /api/delivery/resend, SPEC Phase 5).
// 이메일로 받기를 고른 주문만, 주문번호와 주문 때 이메일이 맞으면 새 토큰을 만들어 보낸다(이전 링크는 무효).
// 응답은 주문·이메일 일치 여부와 관계없이 같다. 횟수 제한(주문 1건당 시간당 3회, IP당 시간당 10회)은 주문을 찾기 전에 센다.
// 메일 발송은 응답을 보낸 뒤 이어서 한다(응답 시간으로 일치 여부가 드러나지 않게).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { RESEND_PER_IP, RESEND_PER_ORDER } from '../config/limits';
import { isValidEmail } from '../orders/create';
import { ORDER_ID_RE } from '../orders/ids';
import { RateLimited, type RateLimiter } from '../web/rateLimit';
import { isDeliverable, sendDownloadEmail, type DeliveryDeps } from './deliver';

export const RESEND_MESSAGE = '주문번호와 이메일이 일치하면 새 다운로드 링크를 보내 드려요. 몇 분 안에 메일이 오지 않으면 입력한 내용을 다시 확인해 주세요.';

export class ResendInputError extends Error {
  constructor(readonly errors: Partial<Record<'orderId' | 'email' | 'form', string>>) {
    super('재발송 입력 오류');
    this.name = 'ResendInputError';
  }
}

const schema = z.object({ orderId: z.string(), email: z.string() });

const sameText = (a: string, b: string) => timingSafeEqual(createHmac('sha256', 'cmp').update(a).digest(), createHmac('sha256', 'cmp').update(b).digest());

export interface ResendContext {
  deps: DeliveryDeps;
  limiter: RateLimiter;
  ip: string;
}

/** 응답 문구를 돌려준다. 실제 발송은 job으로 돌려준다(라우트는 기다리지 않는다) */
export async function requestResend(ctx: ResendContext, raw: unknown): Promise<{ message: string; job: Promise<boolean> | null }> {
  const p = schema.safeParse(raw);
  if (!p.success) throw new ResendInputError({ form: '입력 형식이 올바르지 않습니다.' });
  const orderId = p.data.orderId.trim();
  const email = p.data.email.trim();
  const errors: Partial<Record<'orderId' | 'email', string>> = {};
  if (!ORDER_ID_RE.test(orderId)) errors.orderId = '주문번호 형식이 올바르지 않습니다. (예: SJ20261020-ABCD2345)';
  if (!isValidEmail(email)) errors.email = '주문할 때 입력한 이메일 주소를 정확히 입력해 주세요.';
  if (Object.keys(errors).length) throw new ResendInputError(errors);

  const now = ctx.deps.now ? ctx.deps.now() : new Date();
  if (!ctx.limiter.hit(`resend:ip:${ctx.ip}`, RESEND_PER_IP, now.getTime())) throw new RateLimited();
  if (!ctx.limiter.hit(`resend:order:${orderId}`, RESEND_PER_ORDER, now.getTime())) throw new RateLimited();

  const order = await ctx.deps.store.getOrder(orderId);
  const matches =
    !!order && order.deliveryMethods.includes('email') && !!order.email && sameText(order.email.trim().toLowerCase(), email.toLowerCase()) && isDeliverable(order, now);
  return { message: RESEND_MESSAGE, job: matches ? sendDownloadEmail(ctx.deps, orderId, 'resend') : null };
}
