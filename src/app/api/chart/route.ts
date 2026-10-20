// POST /api/chart: 입력 → 무료 미리보기(표지·차트·오행·총평 템플릿 문장 + 잠긴 섹션 제목). 결제 불필요, 유료 본문 없음.
import { buildPreview } from '../../../web/preview';
import { errorResponse, json, readJson } from '../../../web/http';

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await readJson(req)) as { birth?: unknown } | null;
    const result = buildPreview(body?.birth);
    return result.ok ? json({ preview: result.view }) : json({ errors: result.errors }, 400);
  } catch (e) {
    return errorResponse(e);
  }
}
