// API 라우트 공통: JSON 응답과 오류 변환. 오류 응답에 사용자 입력·내부 메시지를 담지 않는다.
import { AccessDenied, ORDER_TOKEN_HEADER } from '../orders/access';
import { OrderInputError } from '../orders/create';
import { FakePaymentDisabled } from '../orders/fakePayment';
import { NotPaid } from '../orders/generation';
import { RefundInputError } from '../orders/refund';
import { ReportNotReady } from '../orders/reportAccess';

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

export function tokenOf(req: Request): string | null {
  return req.headers.get(ORDER_TOKEN_HEADER);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** 알려진 오류를 HTTP 응답으로 바꾼다. 모르는 오류는 내용 없이 500 */
export function errorResponse(e: unknown): Response {
  if (e instanceof OrderInputError) return json({ errors: e.errors }, 400);
  if (e instanceof RefundInputError) return json({ errors: e.errors }, 400);
  if (e instanceof AccessDenied || e instanceof FakePaymentDisabled) return json({ error: 'not_found' }, 404);
  if (e instanceof NotPaid) return json({ error: 'not_paid' }, 409);
  if (e instanceof ReportNotReady) return json({ error: 'not_ready' }, 409);
  return json({ error: 'server_error' }, 500);
}
