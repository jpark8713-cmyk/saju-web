// POST /api/reports/generate: 결제된 주문만 생성 시작(실패한 주문은 시도 횟수 안에서 재시도). 생성은 백그라운드로 돈다.
import { isMockPaymentAllowed } from '../../../../config/flags';
import { llmRuntime } from '../../../../llm/runtime';
import { startGeneration } from '../../../../orders/generation';
import { getStore } from '../../../../store';
import { errorResponse, json, readJson, tokenOf } from '../../../../web/http';

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await readJson(req)) as { orderId?: unknown } | null;
    if (typeof body?.orderId !== 'string') return json({ error: 'bad_request' }, 400);
    const { status } = await startGeneration(getStore(), body.orderId, tokenOf(req), (order) =>
      // 생성 실패 재현은 목 결제창에서 고른 주문만(운영에서는 목 결제가 꺼져 있어 항상 false)
      llmRuntime({ forceFailure: isMockPaymentAllowed() && order.devForceGenerationFailure }),
    );
    return json(status, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
