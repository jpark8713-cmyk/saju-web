// GET /api/orders/:id/status: 주문 상태와 단계(화면 6의 상태 조회). 주문 소유 확인 필요.
// 생성 중에 서버가 멈춰 오래 머문 주문은 여기서 실패로 바뀌어 재시도·환불 안내로 이어진다.
import { orderStatus } from '../../../../../orders/generation';
import { getStore } from '../../../../../store';
import { errorResponse, json, tokenOf } from '../../../../../web/http';

export async function GET(req: Request, ctx: RouteContext<'/api/orders/[id]/status'>): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return json(await orderStatus(getStore(), id, tokenOf(req)));
  } catch (e) {
    return errorResponse(e);
  }
}
