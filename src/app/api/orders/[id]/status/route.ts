// GET /api/orders/:id/status: 주문 상태와 단계(화면 6의 상태 조회). 주문 소유 확인 필요.
import { authorizedOrder } from '../../../../../orders/access';
import { statusView } from '../../../../../orders/generation';
import { getStore } from '../../../../../store/memory';
import { errorResponse, json, tokenOf } from '../../../../../web/http';

export async function GET(req: Request, ctx: RouteContext<'/api/orders/[id]/status'>): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return json(statusView(await authorizedOrder(getStore(), id, tokenOf(req))));
  } catch (e) {
    return errorResponse(e);
  }
}
