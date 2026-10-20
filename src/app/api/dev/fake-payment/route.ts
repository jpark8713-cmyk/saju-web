// POST /api/dev/fake-payment: 개발 전용 가짜 결제(D-025). 운영 환경에서는 항상 404이며 아무것도 바꾸지 않는다.
import { isFakePaymentEnabled } from '../../../../config/flags';
import { fakePay } from '../../../../orders/fakePayment';
import { getStore } from '../../../../store/memory';
import { errorResponse, json, readJson, tokenOf } from '../../../../web/http';

export async function POST(req: Request): Promise<Response> {
  if (!isFakePaymentEnabled()) return json({ error: 'not_found' }, 404);
  try {
    const body = (await readJson(req)) as { orderId?: unknown; outcome?: unknown } | null;
    const outcome = body?.outcome;
    if (typeof body?.orderId !== 'string' || (outcome !== 'success' && outcome !== 'fail' && outcome !== 'success-genfail')) {
      return json({ error: 'bad_request' }, 400);
    }
    return json(await fakePay(getStore(), body.orderId, tokenOf(req), outcome));
  } catch (e) {
    return errorResponse(e);
  }
}
