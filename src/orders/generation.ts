// 리포트 생성 (POST /api/reports/generate). 결제(paid)된 주문만, 실패(failed)한 주문은 재시도로 허용한다.
// 생성은 백그라운드로 돌고 화면 6이 상태를 조회한다. 성공하면 출생 정보를 지우고 발급 기록을 만든다(SPEC 1장·Phase 4).
// 서버가 생성 도중 멈춰 "생성 중"에 오래 머문 주문은 실패로 바꿔 재시도나 환불로 이어지게 한다(D-027, D-028).
import { MAX_GENERATION_RUNS, STALE_GENERATION_MS } from '../config/generation';
import { GENERATION } from '../config/report';
import { expiryFrom } from '../delivery/deliver';
import { deliveryOf, withDelivery } from '../delivery/state';
import { buildChart } from '../engine/chart';
import { buildEvidence } from '../engine/evidence';
import { isChildChart } from '../report/audience';
import { GenerationError, generateReport } from '../llm/generate';
import type { LlmRuntime } from '../llm/runtime';
import { IssuanceImmutable, type GenerationProgress, type Order, type Store } from '../store/types';
import { findTopic } from '../config/topics';
import { authorizedOrder } from './access';
import { buildIssuance } from './issuance';
import { canTransition, transition } from './stateMachine';

export class NotPaid extends Error {
  constructor() {
    super('결제가 확인되지 않은 주문입니다');
    this.name = 'NotPaid';
  }
}

export class RetryLimitReached extends Error {
  constructor() {
    super('생성 시도 횟수를 모두 썼습니다');
    this.name = 'RetryLimitReached';
  }
}

export interface OrderStatusView {
  orderId: string;
  status: Order['status'];
  /** 화면 6의 단계: 결제 확인 → 풀이 작성 → 완료 / 실패, 환불됨, 보관 기간 지남 */
  stage: 'payment' | 'writing' | 'done' | 'failed' | 'refunded' | 'expired';
  runs: number;
  /** 실패했을 때 다시 시도할 수 있는지 */
  canRetry: boolean;
  deliveryMethods: Order['deliveryMethods'];
  /** PDF·링크를 받을 수 있는 마지막 시각(완성 후 정해진다) */
  expiresAt: string | null;
  /** 이메일 발송 상태 (이메일로 받기를 고른 주문) */
  emailStatus: 'none' | 'sending' | 'sent' | 'failed';
  /** 생성 중 칸별 진행 상태(D-052). 생성 중이 아니면 빈 목록 */
  progress: GenerationProgress[];
}

export function statusView(o: Order): OrderStatusView {
  const d = deliveryOf(o);
  const stage = d.purgedAt || (d.expiresAt && Date.parse(d.expiresAt) <= Date.now())
    ? 'expired'
    : o.status === 'done' ? 'done' : o.status === 'failed' ? 'failed' : o.status === 'generating' ? 'writing' : o.status === 'refunded' ? 'refunded' : 'payment';
  return {
    orderId: o.id,
    status: o.status,
    stage,
    runs: o.generation.runs,
    canRetry: o.status === 'failed' && o.generation.runs < MAX_GENERATION_RUNS,
    deliveryMethods: o.deliveryMethods,
    expiresAt: d.expiresAt,
    emailStatus: d.email.status,
    progress: o.status === 'generating' ? (o.generation.progress ?? []) : [],
  };
}

function isStale(o: Order, now: Date, staleMs: number): boolean {
  if (o.status !== 'generating' || !o.generation.startedAt) return false;
  return now.getTime() - Date.parse(o.generation.startedAt) > staleMs;
}

/** 오래 멈춘 "생성 중" 주문이면 실패(interrupted)로 바꾼다. 바뀐(또는 그대로인) 주문을 돌려준다 */
export async function recoverIfStale(store: Store, order: Order, now = new Date(), staleMs = STALE_GENERATION_MS): Promise<Order> {
  if (!isStale(order, now, staleMs)) return order;
  const updated = await store.updateOrder(order.id, (o) =>
    isStale(o, now, staleMs) ? transition(o, 'failed', { generation: { ...o.generation, finishedAt: now.toISOString(), lastFailure: 'interrupted' } }) : o,
  );
  return updated ?? order;
}

/**
 * 멈춘 생성 주문을 모두 찾아 실패로 바꾼다. 바꾼 주문번호를 돌려준다.
 * 관리 스크립트는 기본 기준(10분)을 쓰고, 서버 시작 때는 staleMs=-1로 "생성 중" 전부를 바꾼다
 * (서버 한 대에서 생성은 서버 프로세스 안에서만 돌므로, 켜는 순간 남아 있는 "생성 중"은 모두 죽은 실행이다).
 */
export async function recoverStuckOrders(store: Store, now = new Date(), staleMs = STALE_GENERATION_MS): Promise<string[]> {
  const recovered: string[] = [];
  for (const o of await store.listOrdersByStatus('generating')) {
    const after = await recoverIfStale(store, o, now, staleMs);
    if (after.status === 'failed') recovered.push(o.id);
  }
  return recovered;
}

/** 이 실행이 아직 주문의 현재 실행인지 (멈춘 것으로 처리된 뒤 늦게 끝난 실행은 결과를 버린다) */
const isCurrentRun = (o: Order | null, run: number): o is Order => !!o && o.status === 'generating' && o.generation.runs === run;

/** 리포트가 완성된 뒤 할 일(결과물 전달, D-033). 실패해도 생성 결과에는 영향이 없다 */
export type OnDone = (orderId: string) => Promise<void>;

async function run(store: Store, order: Order, runtime: LlmRuntime, onDone?: OnDone): Promise<void> {
  const birth = order.pendingBirth;
  const myRun = order.generation.runs;
  try {
    if (!birth) throw new Error('출생 정보가 없습니다');
    const chart = buildChart(birth.input, { referenceYear: order.referenceYear });
    const child = isChildChart(chart, new Date(order.createdAt));
    // 아이 리포트는 근거 문구도 아이 호칭으로 저장한다(사실 카드 "자세히"에 보인다, D-051)
    const evidence = buildEvidence(chart, { child });
    const progress = progressWriter(store, order, myRun, child);
    const result = await generateReport({
      chart, evidence, topicIds: order.topicIds, referenceYear: order.referenceYear,
      transport: runtime.transport, moderator: runtime.moderator,
      // 아이 리포트 판정(만 나이)과 월별 흐름의 첫 달은 주문 시각 기준이다. 미리보기도 같은 시점에 보였다(D-044, D-052)
      asOf: new Date(order.createdAt),
      onProgress: progress.update,
    });
    await progress.flush();
    // D-050·D-052: 검증·검수를 끝내 통과하지 못했거나 시간 상한에 닿아 사실 문장으로 바꾼 문장 수를 남긴다(문장 원문은 남기지 않는다).
    // 알림 기준은 AI에게 쓰라고 요청한 문장 수(대체 전)의 10% 초과다
    const replaced = result.body.templatedSentences ?? 0;
    const requested = result.body.requestedSentences ?? 0;
    const where = `칸: ${result.body.templated?.join(', ')}`;
    if (replaced > requested * GENERATION.templateAlertRatio) {
      console.warn(`[생성 알림] 주문 ${order.id}: 사실 문장으로 바꾼 문장 ${replaced}개 / 요청 ${requested}개(기준 ${Math.round(GENERATION.templateAlertRatio * 100)}% 초과, ${where})`);
    } else if (replaced > 0) {
      console.info(`[생성] 주문 ${order.id}: 사실 문장으로 바꾼 문장 ${replaced}개 / 요청 ${requested}개(${where})`);
    }
    const generatedAt = new Date().toISOString();
    // 월별·10년 흐름 근거(month[i]·year[i])도 함께 저장한다(사실 카드, D-052)
    const content = { chart, evidence: [...evidence, ...result.periodEvidence], body: result.body };
    // 리포트 저장과 완성 표시(보관 기간)는 한 번에 한다. 이 실행이 더는 현재 실행이 아니면 둘 다 하지 않는다(D-036)
    const done = await store.saveReportWith({ orderId: order.id, name: birth.name, birthLabel: birth.label, ...content, createdAt: generatedAt }, (o) =>
      isCurrentRun(o, myRun)
        ? withDelivery(transition(o, 'done', { pendingBirth: null, generation: { ...o.generation, finishedAt: generatedAt, lastFailure: null } }), (d) => ({
            ...d,
            // 보관 기간은 완성 시각부터 센다(다운로드 링크 만료와 같다)
            expiresAt: expiryFrom(generatedAt),
          }))
        : null,
    );
    if (!done) return;
    try {
      await store.createIssuance(buildIssuance(done, content, generatedAt));
    } catch (e) {
      if (!(e instanceof IssuanceImmutable)) throw e;
    }
    if (onDone) await onDone(order.id).catch(() => undefined);
  } catch (e) {
    // 실패 이유 코드만 남긴다(사용자 입력·문장 원문은 남기지 않는다)
    const lastFailure = e instanceof GenerationError ? (e.reason === 'validation' ? 'validation' : 'moderationUnavailable') : 'interrupted';
    // 실패하면 출생 정보는 재시도 동안만 남긴다
    await store.updateOrder(order.id, (o) =>
      isCurrentRun(o, myRun) ? transition(o, 'failed', { generation: { ...o.generation, finishedAt: new Date().toISOString(), lastFailure } }) : o,
    );
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
  now = new Date(),
  onDone?: OnDone,
): Promise<{ status: OrderStatusView; job: Promise<void> | null }> {
  const order = await recoverIfStale(store, await authorizedOrder(store, orderId, token), now);
  if (order.status === 'created' || order.status === 'refunded') throw new NotPaid();
  if (order.status === 'failed' && order.generation.runs >= MAX_GENERATION_RUNS) throw new RetryLimitReached();
  const flag = { started: false };
  const updated = await store.updateOrder(orderId, (o) => {
    if ((o.status !== 'paid' && o.status !== 'failed') || !canTransition(o.status, 'generating')) return o;
    if (o.generation.runs >= MAX_GENERATION_RUNS) return o;
    flag.started = true;
    // 새 실행은 칸별 진행 표시를 처음부터 다시 쓴다(D-052)
    return transition(o, 'generating', { generation: { ...o.generation, runs: o.generation.runs + 1, startedAt: now.toISOString(), finishedAt: null, progress: [] } });
  });
  const job = flag.started && updated ? run(store, updated, runtimeFor(updated), onDone) : null;
  return { status: statusView(updated ?? order), job };
}

const JOB_NAMES: Record<string, string> = { base: '기본 풀이', monthly: '월별 흐름', decade: '10년 흐름', 'periods:child': '계절·10년 흐름' };

/**
 * 칸별 진행 상태를 주문에 남긴다(D-052). 상태가 바뀔 때마다 차례로 저장하고(앞 저장이 끝난 뒤), 이 실행이 아직 현재 실행일 때만 쓴다.
 * 반복 줄이기 다시 만들기(:repeat)는 따로 보여 주지 않는다
 */
function progressWriter(store: Store, order: Order, myRun: number, child: boolean): { update: (label: string, state: GenerationProgress['state']) => void; flush: () => Promise<void> } {
  const nameOf = (label: string) => {
    if (JOB_NAMES[label]) return JOB_NAMES[label]!;
    const t = findTopic(label.replace(/^topic:/u, ''));
    return t ? (child ? t.childLabel : t.label) : label;
  };
  let list: GenerationProgress[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  return {
    update: (label, state) => {
      if (label.endsWith(':repeat')) return;
      const i = list.findIndex((p) => p.label === label);
      const entry = { label, name: nameOf(label), state };
      list = i < 0 ? [...list, entry] : list.map((p, k) => (k === i ? entry : p));
      const snapshot = list;
      chain = chain
        .then(() => store.updateOrder(order.id, (o) => (isCurrentRun(o, myRun) ? { ...o, generation: { ...o.generation, progress: snapshot } } : o)))
        .catch(() => undefined);
    },
    flush: () => chain.then(() => undefined),
  };
}

/** 상태 조회 (화면 6). 멈춘 생성이면 실패로 바꿔서 보여 준다 */
export async function orderStatus(store: Store, orderId: string, token: string | null, now = new Date()): Promise<OrderStatusView> {
  return statusView(await recoverIfStale(store, await authorizedOrder(store, orderId, token), now));
}
