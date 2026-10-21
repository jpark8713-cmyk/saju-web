// POST /api/orders/:id/refund-request: 환불 요청 접수. 접수만 하고 결제를 취소하지 않는다(D-027).
// 형식이 맞는 요청이면 주문 유무·본인 확인 결과와 관계없이 같은 모양(202, 접수번호, 같은 문구)으로 답한다(D-028).
// 요청 내용(주문번호·이메일)은 기록하지 않는다.
import { requestRefund } from '../../../../../orders/refund';
import { getStore } from '../../../../../store';
import { clientIp } from '../../../../../web/clientIp';
import { errorResponse, json, readJson, tokenOf } from '../../../../../web/http';
import { sharedRateLimiter } from '../../../../../web/rateLimit';

export async function POST(req: Request, ctx: RouteContext<'/api/orders/[id]/refund-request'>): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const ack = await requestRefund({ store: getStore(), limiter: sharedRateLimiter(), ip: clientIp(req), token: tokenOf(req) }, id, await readJson(req));
    return json(ack, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
