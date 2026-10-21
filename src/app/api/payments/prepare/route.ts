// POST /api/payments/prepare: 결제창 주소 받기. 주문 소유 확인, 결제 수단이 켜져 있는지 서버가 다시 검증한다.
import type { NextRequest } from 'next/server';
import { appOrigin } from '../../../../config/origin';
import { preparePayment } from '../../../../orders/payment';
import { getPaymentProvider } from '../../../../payments';
import { getStore } from '../../../../store';
import { errorResponse, json, readJson, tokenOf } from '../../../../web/http';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await readJson(req)) as { orderId?: unknown; paymentMethod?: unknown } | null;
    if (typeof body?.orderId !== 'string' || typeof body.paymentMethod !== 'string') return json({ error: 'bad_request' }, 400);
    const result = await preparePayment(getStore(), getPaymentProvider(), {
      orderId: body.orderId,
      token: tokenOf(req),
      methodId: body.paymentMethod,
      origin: () => appOrigin(req.nextUrl.origin),
    });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
