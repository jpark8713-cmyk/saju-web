// POST /api/payments/confirm: 결제창에서 돌아온 뒤 서버가 PG에 승인을 요청한다. 금액은 서버 계산 금액으로만 승인한다.
import { confirmPayment } from '../../../../orders/payment';
import { getPaymentProvider } from '../../../../payments';
import { getStore } from '../../../../store';
import { errorResponse, json, readJson, tokenOf } from '../../../../web/http';

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await readJson(req)) as { orderId?: unknown; paymentKey?: unknown; amount?: unknown } | null;
    if (typeof body?.orderId !== 'string') return json({ error: 'bad_request' }, 400);
    const result = await confirmPayment(getStore(), getPaymentProvider(), {
      orderId: body.orderId,
      token: tokenOf(req),
      paymentKey: body.paymentKey,
      amount: body.amount,
    });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
