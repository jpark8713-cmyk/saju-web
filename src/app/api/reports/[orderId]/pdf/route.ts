// GET /api/reports/:orderId/pdf: 주문 소유 확인 후 리포트 PDF(A4)를 내려준다.
// 다운로드 토큰·이메일 링크(GET /api/download/:token)는 Phase 5에서 이 생성기를 그대로 쓴다.
import type { NextRequest } from 'next/server';
import { reportViewFor } from '../../../../../orders/reportAccess';
import { renderReportPdf } from '../../../../../report/pdf';
import { getStore } from '../../../../../store/memory';
import { errorResponse, tokenOf } from '../../../../../web/http';

export async function GET(req: NextRequest, ctx: RouteContext<'/api/reports/[orderId]/pdf'>): Promise<Response> {
  try {
    const { orderId } = await ctx.params;
    const token = tokenOf(req);
    await reportViewFor(getStore(), orderId, token); // 소유·생성 완료 확인
    const pdf = await renderReportPdf(req.nextUrl.origin, orderId, token!);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="saju-report-${orderId}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
