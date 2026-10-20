// POST /api/orders: 주문 생성. 금액은 서버가 계산한다(클라이언트가 보낸 금액은 무시).
import { createOrder } from '../../../orders/create';
import { getStore } from '../../../store/memory';
import { errorResponse, json, readJson } from '../../../web/http';

export async function POST(req: Request): Promise<Response> {
  try {
    const created = await createOrder(getStore(), await readJson(req));
    return json(created, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
