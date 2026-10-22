// POST /api/time-boundary: "분 모름"을 고른 시 안에서 결과가 바뀌는 분 구간(D-039). 계산만 하고 아무것도 저장하지 않는다.
import { errorResponse, json, readJson } from '../../../web/http';
import { minuteRangesFor } from '../../../web/birthServer';

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await readJson(req)) as { birth?: unknown } | null;
    return json({ ranges: minuteRangesFor(body?.birth) });
  } catch (e) {
    return errorResponse(e);
  }
}
