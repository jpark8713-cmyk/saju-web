// POST /api/dev/mock-pg: 목 결제창의 "인증" 버튼(개발·테스트 전용, D-028). 운영 환경에서는 항상 404다.
// 결제창 폼(HTML form)이 보낸 값으로 목 어댑터의 결제를 인증하고, PG처럼 복귀 주소로 보낸다(303).
import type { NextRequest } from 'next/server';
import { isMockPaymentAllowed } from '../../../../config/flags';
import { sharedMockProvider } from '../../../../payments';
import type { MockOutcome } from '../../../../payments/mock';
import { json } from '../../../../web/http';

const OUTCOMES: readonly MockOutcome[] = ['success', 'fail', 'success-genfail'];

export async function POST(req: NextRequest): Promise<Response> {
  if (!isMockPaymentAllowed()) return json({ error: 'not_found' }, 404);
  const form = await req.formData().catch(() => null);
  const paymentKey = form?.get('paymentKey');
  const outcome = form?.get('outcome');
  const amount = Number(form?.get('amount'));
  if (typeof paymentKey !== 'string' || typeof outcome !== 'string' || !OUTCOMES.includes(outcome as MockOutcome) || !Number.isInteger(amount) || amount < 0) {
    return json({ error: 'bad_request' }, 400);
  }
  const to = sharedMockProvider().authorize(paymentKey, outcome as MockOutcome, amount);
  if (!to) return json({ error: 'not_found' }, 404);
  return Response.redirect(new URL(to, req.nextUrl.origin), 303);
}
