// API 라우트 공통: JSON 응답과 오류 변환. 오류 응답에 사용자 입력·내부 메시지를 담지 않는다.
import { AppOriginMissing } from '../config/origin';
import { SecretMissing } from '../config/secrets';
import { AccessDenied, ORDER_TOKEN_HEADER } from '../orders/access';
import { OrderInputError } from '../orders/create';
import { NotPaid, RetryLimitReached } from '../orders/generation';
import { AlreadyPaid, PaymentInProgress, PaymentRejected, PaymentUnavailable } from '../orders/payment';
import { RefundInputError } from '../orders/refund';
import { ReportExpired, ReportNotReady } from '../orders/reportAccess';
import { ResendInputError } from '../delivery/resend';
import { StoreMisconfigured } from '../store';
import { RateLimited } from './rateLimit';

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

export function tokenOf(req: Request): string | null {
  return req.headers.get(ORDER_TOKEN_HEADER);
}

/** 요청 본문 상한. 이 서비스의 요청은 모두 수 KB 이하다 */
export const MAX_JSON_BYTES = 64 * 1024;

/** JSON 본문을 읽는다. 형식이 틀리거나 상한을 넘으면 null. 길이 헤더가 없어도 읽는 도중 상한을 넘으면 멈춘다 */
export async function readJson(req: Request): Promise<unknown> {
  try {
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_JSON_BYTES || !req.body) return null;
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/** 알려진 오류를 HTTP 응답으로 바꾼다. 모르는 오류는 내용 없이 500 */
export function errorResponse(e: unknown): Response {
  if (e instanceof OrderInputError) return json({ errors: e.errors }, 400);
  if (e instanceof RefundInputError) return json({ errors: e.errors }, 400);
  if (e instanceof ResendInputError) return json({ errors: e.errors }, 400);
  if (e instanceof ReportExpired) return json({ error: 'expired' }, 410);
  if (e instanceof AccessDenied) return json({ error: 'not_found' }, 404);
  if (e instanceof NotPaid) return json({ error: 'not_paid' }, 409);
  if (e instanceof RetryLimitReached) return json({ error: 'retry_limit' }, 409);
  if (e instanceof ReportNotReady) return json({ error: 'not_ready' }, 409);
  if (e instanceof AlreadyPaid) return json({ error: 'already_paid' }, 409);
  if (e instanceof PaymentInProgress) return json({ error: 'payment_in_progress' }, 409);
  if (e instanceof PaymentRejected) return json({ error: 'payment_rejected', code: e.code }, 400);
  if (e instanceof PaymentUnavailable) return json({ error: 'payment_unavailable' }, 503);
  if (e instanceof RateLimited) return json({ error: 'rate_limited' }, 429);
  if (e instanceof AppOriginMissing || e instanceof SecretMissing || e instanceof StoreMisconfigured) return json({ error: 'server_misconfigured' }, 500);
  return json({ error: 'server_error' }, 500);
}
