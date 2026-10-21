// POST /api/reports/generate: 결제된 주문만 생성 시작(실패한 주문은 시도 횟수 안에서 재시도). 생성은 백그라운드로 돈다.
// 완성되면 받는 방법대로 PDF 저장·메일 발송을 이어서 한다(D-033).
import type { NextRequest } from 'next/server';
import { isMockPaymentAllowed } from '../../../../config/flags';
import { deliverOnDone } from '../../../../delivery/deliver';
import { deliveryDeps } from '../../../../delivery/runtime';
import { llmRuntime } from '../../../../llm/runtime';
import { startGeneration } from '../../../../orders/generation';
import { getStore } from '../../../../store';
import { errorResponse, json, readJson, tokenOf } from '../../../../web/http';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await readJson(req)) as { orderId?: unknown } | null;
    if (typeof body?.orderId !== 'string') return json({ error: 'bad_request' }, 400);
    const deps = deliveryDeps(req.nextUrl.origin);
    const { status } = await startGeneration(
      getStore(),
      body.orderId,
      tokenOf(req),
      // 생성 실패 재현은 목 결제창에서 고른 주문만(운영에서는 목 결제가 꺼져 있어 항상 false)
      (order) => llmRuntime({ forceFailure: isMockPaymentAllowed() && order.devForceGenerationFailure }),
      new Date(),
      (orderId) => deliverOnDone(deps, orderId),
    );
    return json(status, 202);
  } catch (e) {
    return errorResponse(e);
  }
}
