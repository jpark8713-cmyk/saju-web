// POST /api/orders/:id/refund-request: 환불 요청 접수(주문번호 + 사유 + 상세(선택) + 결과 안내 이메일). 접수번호 반환.
import { requestRefund } from '../../../../../orders/refund';
import { getStore } from '../../../../../store/memory';
import { errorResponse, json, readJson } from '../../../../../web/http';

export async function POST(req: Request, ctx: RouteContext<'/api/orders/[id]/refund-request'>): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return json(await requestRefund(getStore(), id, await readJson(req)), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
