// GET /api/reports/:orderId/pdf: 주문 소유 확인 후 리포트 PDF(A4)를 내려준다.
// 다운로드 토큰·이메일 링크(GET /api/download/:token)는 Phase 5에서 이 생성기를 그대로 쓴다.
// 생성기가 여는 주소는 APP_ORIGIN 고정값이다(운영에서 Host 헤더를 믿지 않는다). 내려주면 발급 기록에 다운로드 시각을 덧붙인다.
import type { NextRequest } from 'next/server';
import { appOrigin } from '../../../../../config/origin';
import { recordIssuanceEvent } from '../../../../../orders/issuance';
import { reportViewFor } from '../../../../../orders/reportAccess';
import { renderReportPdf } from '../../../../../report/pdf';
import { getStore } from '../../../../../store';
import { errorResponse, tokenOf } from '../../../../../web/http';

export async function GET(req: NextRequest, ctx: RouteContext<'/api/reports/[orderId]/pdf'>): Promise<Response> {
  try {
    const { orderId } = await ctx.params;
    const token = tokenOf(req);
    await reportViewFor(getStore(), orderId, token); // 소유·생성 완료 확인
    const pdf = await renderReportPdf(appOrigin(req.nextUrl.origin), orderId, token!);
    await recordIssuanceEvent(getStore(), orderId, 'pdf_download');
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
