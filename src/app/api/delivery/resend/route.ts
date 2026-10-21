// POST /api/delivery/resend: 링크 재발송(화면 C, D-033). 주문·이메일 일치 여부와 관계없이 같은 응답을 준다.
// 발송은 응답 뒤에 이어서 한다. 요청 내용(주문번호·이메일)은 기록하지 않는다.
import type { NextRequest } from 'next/server';
import { requestResend } from '../../../../delivery/resend';
import { deliveryDeps } from '../../../../delivery/runtime';
import { clientIp } from '../../../../web/clientIp';
import { errorResponse, json, readJson } from '../../../../web/http';
import { sharedRateLimiter } from '../../../../web/rateLimit';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { message, job } = await requestResend({ deps: deliveryDeps(req.nextUrl.origin), limiter: sharedRateLimiter(), ip: clientIp(req) }, await readJson(req));
    void job?.catch(() => undefined);
    return json({ message });
  } catch (e) {
    return errorResponse(e);
  }
}
