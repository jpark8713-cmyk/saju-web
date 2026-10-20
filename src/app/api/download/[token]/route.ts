// GET /api/download/:token: 이메일 링크로 PDF 다운로드(Phase 5에서 토큰 검증 구현).
// Phase 3에는 발급된 토큰이 없으므로 모든 토큰이 무효·만료로 처리되어 화면 C(링크 다시 받기)로 보낸다.
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest): Promise<Response> {
  return Response.redirect(new URL('/resend?reason=expired', req.nextUrl.origin), 302);
}
