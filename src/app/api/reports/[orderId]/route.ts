// GET /api/reports/:orderId: 주문 소유 확인 후 리포트(화면과 PDF가 같이 쓰는 데이터) 반환.
import { reportViewFor } from '../../../../orders/reportAccess';
import { getStore } from '../../../../store';
import { errorResponse, json, tokenOf } from '../../../../web/http';

export async function GET(req: Request, ctx: RouteContext<'/api/reports/[orderId]'>): Promise<Response> {
  try {
    const { orderId } = await ctx.params;
    return json({ report: await reportViewFor(getStore(), orderId, tokenOf(req)) });
  } catch (e) {
    return errorResponse(e);
  }
}
