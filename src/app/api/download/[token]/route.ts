// GET /api/download/:token: 이메일 링크로 PDF 받기(D-033). 토큰은 해시로만 찾는다.
// 토큰이 없거나·무효(재발송으로 바뀜)·만료이거나 보관 기간이 지났으면 화면 C(링크 다시 받기, 만료 안내)로 보낸다.
// 토큰은 기록하지 않는다.
import type { NextRequest } from 'next/server';
import { pdfForDownloadToken } from '../../../../delivery/deliver';
import { deliveryDeps } from '../../../../delivery/runtime';
import { pdfResponse } from '../../../../web/pdfResponse';

export async function GET(req: NextRequest, ctx: RouteContext<'/api/download/[token]'>): Promise<Response> {
  const { token } = await ctx.params;
  const found = await pdfForDownloadToken(deliveryDeps(req.nextUrl.origin), token).catch(() => null);
  if (!found) return Response.redirect(new URL('/resend?reason=expired', req.nextUrl.origin), 302);
  return pdfResponse(found.orderId, found.pdf);
}
