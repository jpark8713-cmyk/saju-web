// 결제 준비·승인 (POST /api/payments/prepare, /api/payments/confirm). SPEC Phase 4.
// - 금액은 서버가 계산한 주문 금액만 쓴다. 클라이언트가 보낸 금액이 다르면 PG에 승인을 요청하지 않고 거부한다.
// - PG가 승인한 금액이 주문 금액과 다르면 그 결제를 바로 취소하고 거부한다.
// - 같은 승인 요청이 두 번 와도 결제·생성은 한 번만 일어난다(승인 중 잠금 + 승인된 결제 키 재확인).
// - 승인에 실패하면 주문은 created에 머문다. 생성은 paid부터 시작하므로 리포트가 만들어지지 않는다.
import { findPaymentMethod } from '../config/paymentMethods';
import { isMockPaymentAllowed, type Env } from '../config/flags';
import type { PaymentProvider } from '../payments/types';
import type { Order, PaymentState, Store } from '../store/types';
import { authorizedOrder } from './access';
import { OrderInputError } from './create';
import { EMPTY_PAYMENT } from './paymentState';
import { canTransition, transition } from './stateMachine';

export class PaymentUnavailable extends Error {
  constructor() {
    super('결제를 처리할 수 없는 환경입니다');
    this.name = 'PaymentUnavailable';
  }
}

export class PaymentInProgress extends Error {
  constructor() {
    super('결제 승인을 처리하고 있습니다');
    this.name = 'PaymentInProgress';
  }
}

export class AlreadyPaid extends Error {
  constructor() {
    super('이미 결제된 주문입니다');
    this.name = 'AlreadyPaid';
  }
}

/** 승인 거부. code는 화면 A가 문구로 바꾼다(사용자 입력은 담지 않는다) */
export class PaymentRejected extends Error {
  constructor(readonly code: string) {
    super(`결제 승인 거부: ${code}`);
    this.name = 'PaymentRejected';
  }
}

function orderName(o: Order): string {
  return o.breakdown.topics.length ? `사주 리포트 + 주제 ${o.breakdown.topics.length}개` : '사주 리포트';
}

export interface PrepareRequest {
  orderId: string;
  token: string | null;
  methodId: string;
  /** 결제창이 돌아올 주소의 기준 (config/origin.ts). 어댑터·주문 확인이 끝난 뒤에 계산한다 */
  origin: () => string;
}

export async function preparePayment(store: Store, provider: PaymentProvider | null, req: PrepareRequest, env: Env = process.env): Promise<{ redirectUrl: string }> {
  if (!provider) throw new PaymentUnavailable();
  const order = await authorizedOrder(store, req.orderId, req.token);
  if (order.status !== 'created') throw new AlreadyPaid();
  if (order.payment.stage === 'confirming') throw new PaymentInProgress();
  const method = findPaymentMethod(req.methodId, env);
  if (!method?.enabled || !provider.supports(method.id)) throw new OrderInputError({ payment: '선택할 수 없는 결제 수단입니다.' });

  const origin = req.origin();
  const prepared = await provider.prepare({
    orderId: order.id,
    amount: order.amount,
    orderName: orderName(order),
    methodId: method.id,
    successUrl: `${origin}/checkout/complete`,
    failUrl: `${origin}/checkout/failed`,
  });
  const flag = { saved: false };
  await store.updateOrder(order.id, (o) => {
    if (o.status !== 'created' || o.payment.stage === 'confirming') return o;
    flag.saved = true;
    // 결제창을 열 때마다 새 결제 키로 바꾼다. 이전 결제 키로 온 승인 요청은 거부된다
    return { ...o, paymentMethod: method.id, payment: { ...EMPTY_PAYMENT, provider: provider.id, paymentKey: prepared.paymentKey, stage: 'ready' } };
  });
  if (!flag.saved) throw new PaymentInProgress();
  return { redirectUrl: prepared.redirectUrl };
}

export interface ConfirmRequest {
  orderId: string;
  token: string | null;
  paymentKey: unknown;
  /** 결제창이 돌려준 금액. 서버 계산 금액과 비교만 하고 승인 요청에는 쓰지 않는다 */
  amount: unknown;
}

export interface ConfirmOutcome {
  paid: true;
  /** 이미 승인된 결제에 대한 같은 요청이었는지 */
  alreadyConfirmed: boolean;
}

/**
 * (사업자 확정 2026-10-21, D-030)
 * 승인 중 잠금이 이보다 오래되면(승인 도중 서버가 멈춘 경우) 같은 결제 키로 다시 승인을 요청할 수 있다(D-029).
 * PG 승인은 결제 키 기준으로 멱등이라, 이미 승인됐다면 같은 승인 결과를 돌려받는다.
 */
export const CONFIRM_LOCK_STALE_MS = 2 * 60_000;

const lockIsStale = (p: PaymentState, now: Date) => p.stage === 'confirming' && (!p.confirmingAt || now.getTime() - Date.parse(p.confirmingAt) > CONFIRM_LOCK_STALE_MS);

/** 내가 잡은 잠금(잡은 시각이 같을 때)만 푼다. 오래된 잠금을 다른 요청이 다시 잡았으면 건드리지 않는다 */
async function releaseLock(store: Store, orderId: string, paymentKey: string, lockedAt: string, stage: PaymentState['stage'], lastError: string): Promise<void> {
  await store.updateOrder(orderId, (o) =>
    o.status === 'created' && o.payment.paymentKey === paymentKey && o.payment.stage === 'confirming' && o.payment.confirmingAt === lockedAt
      ? { ...o, payment: { ...o.payment, stage, confirmingAt: null, lastError } }
      : o,
  );
}

async function rejectWith(store: Store, orderId: string, paymentKey: string, lockedAt: string, stage: PaymentState['stage'], code: string): Promise<never> {
  await releaseLock(store, orderId, paymentKey, lockedAt, stage, code);
  throw new PaymentRejected(code);
}

export async function confirmPayment(store: Store, provider: PaymentProvider | null, req: ConfirmRequest, env: Env = process.env, now = new Date()): Promise<ConfirmOutcome> {
  if (!provider) throw new PaymentUnavailable();
  const order = await authorizedOrder(store, req.orderId, req.token);
  if (typeof req.paymentKey !== 'string' || !req.paymentKey) throw new PaymentRejected('BAD_REQUEST');
  const paymentKey = req.paymentKey;

  if (order.status !== 'created') {
    // 같은 결제의 승인 요청이 다시 온 경우: 아무것도 하지 않고 성공으로 답한다
    if (order.payment.stage === 'approved' && order.payment.paymentKey === paymentKey) return { paid: true, alreadyConfirmed: true };
    throw new PaymentRejected('ALREADY_PROCESSED');
  }
  const canTake = (p: PaymentState) => p.paymentKey === paymentKey && (p.stage === 'ready' || lockIsStale(p, now));
  if (order.payment.stage === 'confirming' && order.payment.paymentKey === paymentKey && !lockIsStale(order.payment, now)) throw new PaymentInProgress();
  if (!canTake(order.payment) || order.payment.provider !== provider.id) {
    throw new PaymentRejected('UNKNOWN_PAYMENT');
  }
  if (!findPaymentMethod(order.paymentMethod, env)?.enabled || !provider.supports(order.paymentMethod)) {
    throw new PaymentRejected('METHOD_DISABLED');
  }
  if (typeof req.amount !== 'number' && typeof req.amount !== 'string') throw new PaymentRejected('AMOUNT_MISMATCH');
  if (Number(req.amount) !== order.amount) {
    // 결제창이 돌려준 금액이 서버 금액과 다르다: PG에 승인을 요청하지 않는다
    await store.updateOrder(order.id, (o) => (o.status === 'created' && canTake(o.payment) ? { ...o, payment: { ...o.payment, stage: 'none', confirmingAt: null, lastError: 'AMOUNT_MISMATCH' } } : o));
    throw new PaymentRejected('AMOUNT_MISMATCH');
  }

  // 승인 중 잠금: 같은 결제 키로 동시에 온 요청 중 하나만 PG에 승인을 요청한다
  const lock = { taken: false };
  const lockedAt = now.toISOString();
  await store.updateOrder(order.id, (o) => {
    if (o.status !== 'created' || !canTake(o.payment)) return o;
    lock.taken = true;
    return { ...o, payment: { ...o.payment, stage: 'confirming', confirmingAt: lockedAt, lastError: null } };
  });
  if (!lock.taken) throw new PaymentInProgress();

  let result;
  try {
    result = await provider.confirm({ paymentKey, orderId: order.id, amount: order.amount });
  } catch {
    // 연결 오류: 승인 여부를 모르므로 같은 결제 키로 다시 요청할 수 있게 둔다(PG 승인은 결제 키 기준 멱등)
    return rejectWith(store, order.id, paymentKey, lockedAt, 'ready', 'PG_UNREACHABLE');
  }
  if (!result.ok) return rejectWith(store, order.id, paymentKey, lockedAt, 'none', result.code);

  if (result.approvedAmount !== order.amount) {
    // PG가 승인한 금액이 주문 금액과 다르다: 그 결제를 바로 취소하고 거부한다
    const cancelled = await provider.cancel({ paymentKey, orderId: order.id, amount: result.approvedAmount, reason: '승인 금액 불일치' }).catch(() => ({ ok: false as const, code: 'PG_UNREACHABLE' }));
    await store.updateOrder(order.id, (o) =>
      o.payment.paymentKey === paymentKey
        ? {
            ...o,
            payment: {
              ...o.payment,
              stage: cancelled.ok ? 'cancelled' : 'none',
              confirmingAt: null,
              transactionId: result.transactionId,
              approvedAmount: result.approvedAmount,
              approvedAt: result.approvedAt,
              cancelledAt: cancelled.ok ? cancelled.cancelledAt : null,
              // 취소까지 실패하면 운영자가 확인해야 한다
              lastError: cancelled.ok ? 'APPROVED_AMOUNT_MISMATCH' : 'APPROVED_AMOUNT_MISMATCH_CANCEL_FAILED',
            },
          }
        : o,
    );
    throw new PaymentRejected('APPROVED_AMOUNT_MISMATCH');
  }

  const devFail = isMockPaymentAllowed(env) && provider.id === 'mock' && !!result.devForceGenerationFailure;
  const after = await store.updateOrder(order.id, (o) => {
    if (o.payment.paymentKey !== paymentKey || o.payment.stage !== 'confirming' || !canTransition(o.status, 'paid')) return o;
    return transition(o, 'paid', {
      paidAt: now.toISOString(),
      devForceGenerationFailure: devFail,
      payment: { ...o.payment, stage: 'approved', confirmingAt: null, transactionId: result.transactionId, approvedAmount: result.approvedAmount, approvedAt: result.approvedAt, lastError: null },
    });
  });
  // 잠금을 다시 잡은 다른 요청이 먼저 반영했으면 그 결과를 따른다
  if (after?.status === 'created' || after?.payment.paymentKey !== paymentKey) throw new PaymentInProgress();
  return { paid: true, alreadyConfirmed: false };
}
