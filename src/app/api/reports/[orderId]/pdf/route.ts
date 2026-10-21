// GET /api/reports/:orderId/pdf: 주문 소유 확인 후 저장된 리포트 PDF(A4)를 내려준다. 없으면 만들어 저장한다(D-033).
// 내려주면 발급 기록에 다운로드 시각을 덧붙인다.
import type { NextRequest } from 'next/server';
import { ensureStoredPdf } from '../../../../../delivery/deliver';
import { deliveryDeps } from '../../../../../delivery/runtime';
import { recordIssuanceEvent } from '../../../../../orders/issuance';
import { reportViewFor } from '../../../../../orders/reportAccess';
import { getStore } from '../../../../../store';
import { errorResponse, tokenOf } from '../../../../../web/http';
import { pdfResponse } from '../../../../../web/pdfResponse';

export async function GET(req: NextRequest, ctx: RouteContext<'/api/reports/[orderId]/pdf'>): Promise<Response> {
  try {
    const { orderId } = await ctx.params;
    await reportViewFor(getStore(), orderId, tokenOf(req)); // 소유·생성 완료·보관 기간 확인
    const pdf = await ensureStoredPdf(deliveryDeps(req.nextUrl.origin), orderId);
    await recordIssuanceEvent(getStore(), orderId, 'pdf_download');
    return pdfResponse(orderId, pdf);
  } catch (e) {
    return errorResponse(e);
  }
}
