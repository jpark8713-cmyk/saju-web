// 리포트 생성 (POST /api/reports/generate). 결제(paid)된 주문만, 실패(failed)한 주문은 재시도로 허용한다.
// 생성은 백그라운드로 돌고 화면 6이 상태를 조회한다. 성공하면 출생 정보를 지운다(SPEC 1장 보관 정책).
import { buildChart } from '../engine/chart';
import { buildEvidence } from '../engine/evidence';
import { GenerationError, generateReport } from '../llm/generate';
import type { LlmRuntime } from '../llm/runtime';
import type { Order, Store } from '../store/types';
import { authorizedOrder } from './access';

export class NotPaid extends Error {
  constructor() {
    super('결제가 확인되지 않은 주문입니다');
    this.name = 'NotPaid';
  }
}

export interface OrderStatusView {
  orderId: string;
  status: Order['status'];
  /** 화면 6의 단계: 결제 확인 → 풀이 작성 → 완료 / 실패 */
  stage: 'payment' | 'writing' | 'done' | 'failed';
  runs: number;
  deliveryMethods: Order['deliveryMethods'];
}

export function statusView(o: Order): OrderStatusView {
  const stage = o.status === 'done' ? 'done' : o.status === 'failed' ? 'failed' : o.status === 'generating' ? 'writing' : 'payment';
  return { orderId: o.id, status: o.status, stage, runs: o.generation.runs, deliveryMethods: o.deliveryMethods };
}

async function run(store: Store, order: Order, runtime: LlmRuntime): Promise<void> {
  const birth = order.pendingBirth;
  try {
    if (!birth) throw new Error('출생 정보가 없습니다');
    const chart = buildChart(birth.input, { referenceYear: order.referenceYear });
    const evidence = buildEvidence(chart);
    const result = await generateReport({
      chart, evidence, topicIds: order.topicIds, referenceYear: order.referenceYear,
      transport: runtime.transport, moderator: runtime.moderator,
    });
    await store.saveReport({
      orderId: order.id, name: birth.name, birthLabel: birth.label, chart, evidence, body: result.body,
      createdAt: new Date().toISOString(),
    });
    await store.updateOrder(order.id, (o) => ({
      ...o, status: 'done', pendingBirth: null,
      generation: { ...o.generation, finishedAt: new Date().toISOString(), lastFailure: null },
    }));
  } catch (e) {
    // 실패 이유 코드만 남긴다(사용자 입력·문장 원문은 남기지 않는다)
    const lastFailure = e instanceof GenerationError ? (e.reason === 'validation' ? 'validation' : 'moderationUnavailable') : 'interrupted';
    // 실패하면 출생 정보는 재시도 동안만 남긴다
    await store.updateOrder(order.id, (o) => ({
      ...o, status: 'failed', generation: { ...o.generation, finishedAt: new Date().toISOString(), lastFailure },
    }));
  }
}

/**
 * 생성을 시작한다. 이미 생성 중이거나 끝났으면 다시 시작하지 않는다(같은 요청을 여러 번 보내도 한 번만 생성).
 * 반환값은 시작 직후 상태다. 실제 생성은 백그라운드에서 진행된다.
 */
export async function startGeneration(
  store: Store,
  orderId: string,
  token: string | null,
  runtimeFor: (order: Order) => LlmRuntime,
): Promise<{ status: OrderStatusView; job: Promise<void> | null }> {
  const order = await authorizedOrder(store, orderId, token);
  if (order.status === 'created' || order.status === 'refunded') throw new NotPaid();
  const flag = { started: false };
  const updated = await store.updateOrder(orderId, (o) => {
    if (o.status !== 'paid' && o.status !== 'failed') return o;
    flag.started = true;
    return { ...o, status: 'generating', generation: { ...o.generation, runs: o.generation.runs + 1, startedAt: new Date().toISOString(), finishedAt: null } };
  });
  const job = flag.started && updated ? run(store, updated, runtimeFor(updated)) : null;
  return { status: statusView(updated ?? order), job };
}
