// Phase 4: 결제 어댑터(목), 승인 멱등, 금액 검증, 상태 머신, 생성 실패·멈춤 복구, 발급 기록, 결제 수단 설정
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as mockPgRoute } from '../../src/app/api/dev/mock-pg/route';
import { appOrigin, AppOriginMissing } from '../../src/config/origin';
import { MAX_GENERATION_RUNS, STALE_GENERATION_MS } from '../../src/config/generation';
import { paymentMethods } from '../../src/config/paymentMethods';
import { DevFakeTransport, DevPassModerator } from '../../src/llm/devFake';
import type { LlmRequest } from '../../src/llm/transport';
import { createOrder, OrderInputError } from '../../src/orders/create';
import { NotPaid, orderStatus, recoverStuckOrders, RetryLimitReached, startGeneration } from '../../src/orders/generation';
import { recordIssuanceEvent, reportContentHash } from '../../src/orders/issuance';
import { CONFIRM_LOCK_STALE_MS, confirmPayment, PaymentInProgress, PaymentRejected, PaymentUnavailable, preparePayment } from '../../src/orders/payment';
import { runAdmin } from '../../src/admin/cli';
import { MAX_JSON_BYTES, readJson } from '../../src/web/http';
import { payFailureMessage } from '../../src/web/paymentMessages';
import { canTransition, InvalidTransition, transition } from '../../src/orders/stateMachine';
import { getPaymentProvider } from '../../src/payments';
import { MockPaymentProvider } from '../../src/payments/mock';
import type { ConfirmInput, ConfirmResult } from '../../src/payments/types';
import { MemoryStore } from '../../src/store/memory';
import { IssuanceImmutable } from '../../src/store/types';
import { authorizeViaMock, BIRTH, mockEnv, ORDER, paidOrder, runtime } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function newOrder(store: MemoryStore, over: Record<string, unknown> = {}) {
  mockEnv();
  return createOrder(store, ORDER(over));
}

describe('목 결제로 전 과정', () => {
  it('created → paid → generating → done을 거치고 발급 기록이 만들어진다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    expect((await store.getOrder(o.orderId))!.status).toBe('created');
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    await confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount });
    const paid = (await store.getOrder(o.orderId))!;
    expect(paid.status).toBe('paid');
    expect(paid.payment).toMatchObject({ stage: 'approved', provider: 'mock', approvedAmount: o.amount });
    const started = await startGeneration(store, o.orderId, o.accessToken, runtime());
    expect(started.status.status).toBe('generating');
    await started.job;
    const done = (await store.getOrder(o.orderId))!;
    expect(done.status).toBe('done');
    const issuance = (await store.getIssuance(o.orderId))!;
    const report = (await store.getReport(o.orderId))!;
    expect(issuance.payment).toEqual({ provider: 'mock', method: 'kakaopay', transactionId: paid.payment.transactionId, approvedAmount: o.amount, approvedAt: paid.payment.approvedAt });
    expect(issuance.generatedAt).toBe(done.generation.finishedAt);
    expect(issuance.contentHash).toBe(reportContentHash(report, done.topicIds));
  });
});

describe('승인 멱등', () => {
  it('같은 승인 요청을 두 번 보내도 PG 승인 1번, 리포트 생성 1번', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    const req = { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount };
    const first = await confirmPayment(store, provider, req);
    const second = await confirmPayment(store, provider, req);
    expect(first.alreadyConfirmed).toBe(false);
    expect(second.alreadyConfirmed).toBe(true);
    expect(provider.confirmCalls).toBe(1);

    const calls: LlmRequest[] = [];
    const counting = () => {
      const t = new DevFakeTransport('ok');
      return { transport: { model: t.model, complete: (r: LlmRequest) => (calls.push(r), t.complete(r)) }, moderator: new DevPassModerator() };
    };
    const g1 = await startGeneration(store, o.orderId, o.accessToken, counting);
    const g2 = await startGeneration(store, o.orderId, o.accessToken, counting);
    expect(g2.job).toBeNull();
    await g1.job;
    expect(calls.filter((c) => c.label === 'base')).toHaveLength(1);
    expect((await store.getOrder(o.orderId))!.generation.runs).toBe(1);
  });

  it('동시에 온 승인 요청도 PG에는 한 번만 간다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    const req = { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount };
    const results = await Promise.allSettled([confirmPayment(store, provider, req), confirmPayment(store, provider, req), confirmPayment(store, provider, req)]);
    expect(provider.confirmCalls).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).not.toHaveLength(0);
    expect((await store.getOrder(o.orderId))!.status).toBe('paid');
  });
});

describe('승인 검증 실패', () => {
  it('결제창에서 취소했거나 인증 전이면 created에 머물고 생성이 시작되지 않는다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    // 인증 전 결제 키로 승인 요청
    const { redirectUrl } = await preparePayment(store, provider, { orderId: o.orderId, token: o.accessToken, methodId: 'kakaopay', origin: () => 'http://x' });
    const paymentKey = new URL(redirectUrl, 'http://x').searchParams.get('paymentKey')!;
    await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: o.amount })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect((await store.getOrder(o.orderId))!.status).toBe('created');
    await expect(startGeneration(store, o.orderId, o.accessToken, runtime())).rejects.toBeInstanceOf(NotPaid);
    expect((await store.getOrder(o.orderId))!.status).toBe('created');
  });

  it('다른 주문의 결제 키, 이전 결제창의 결제 키, 틀린 토큰은 거부한다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const a = await newOrder(store);
    const b = await newOrder(store);
    const ka = await authorizeViaMock(store, provider, a);
    await expect(confirmPayment(store, provider, { orderId: b.orderId, token: b.accessToken, paymentKey: ka.paymentKey, amount: b.amount })).rejects.toMatchObject({ code: 'UNKNOWN_PAYMENT' });
    // 결제창을 다시 열면 이전 결제 키는 쓸 수 없다
    await authorizeViaMock(store, provider, a);
    await expect(confirmPayment(store, provider, { orderId: a.orderId, token: a.accessToken, paymentKey: ka.paymentKey, amount: a.amount })).rejects.toMatchObject({ code: 'UNKNOWN_PAYMENT' });
    await expect(confirmPayment(store, provider, { orderId: a.orderId, token: 'wrong', paymentKey: ka.paymentKey, amount: a.amount })).rejects.toThrow();
    expect(provider.confirmCalls).toBe(0);
  });
});

describe('금액 검증', () => {
  it('클라이언트가 승인 요청 금액을 바꿔 보내면 PG에 승인을 요청하지 않고 거부한다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey } = await authorizeViaMock(store, provider, o);
    for (const amount of [100, o.amount + 1, '100', null, undefined]) {
      await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount })).rejects.toMatchObject({ code: expect.stringMatching(/AMOUNT_MISMATCH|UNKNOWN_PAYMENT/) });
    }
    expect(provider.confirmCalls).toBe(0);
    expect((await store.getOrder(o.orderId))!.status).toBe('created');
  });

  it('결제창에서 금액을 바꿔 인증하고 그 금액을 그대로 보내도 거부한다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o, 'success', 100);
    expect(returnedAmount).toBe(100);
    await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount })).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
    expect(provider.confirmCalls).toBe(0);
    expect((await store.getOrder(o.orderId))!.status).toBe('created');
  });

  it('서버 금액으로만 승인을 요청하고, PG 승인 금액이 다르면 그 결제를 취소하고 거부한다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey } = await authorizeViaMock(store, provider, o);
    const seen: ConfirmInput[] = [];
    vi.spyOn(provider, 'confirm').mockImplementation(async (input): Promise<ConfirmResult> => {
      seen.push(input);
      return { ok: true, transactionId: 'tx1', approvedAmount: input.amount - 1000, approvedAt: new Date().toISOString() };
    });
    const cancel = vi.spyOn(provider, 'cancel').mockResolvedValue({ ok: true, cancelledAt: new Date().toISOString(), cancelledAmount: o.amount - 1000 });
    await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: o.amount })).rejects.toMatchObject({ code: 'APPROVED_AMOUNT_MISMATCH' });
    expect(seen[0]!.amount).toBe(o.amount);
    expect(cancel).toHaveBeenCalledTimes(1);
    const after = (await store.getOrder(o.orderId))!;
    expect(after.status).toBe('created');
    expect(after.payment.stage).toBe('cancelled');
    await expect(startGeneration(store, o.orderId, o.accessToken, runtime())).rejects.toBeInstanceOf(NotPaid);
  });

  it('PG 연결 오류면 같은 결제 키로 다시 승인을 요청할 수 있다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    const real = provider.confirm.bind(provider);
    const spy = vi.spyOn(provider, 'confirm').mockRejectedValueOnce(new Error('network'));
    const req = { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount };
    await expect(confirmPayment(store, provider, req)).rejects.toMatchObject({ code: 'PG_UNREACHABLE' });
    spy.mockImplementation(real);
    await confirmPayment(store, provider, req);
    expect((await store.getOrder(o.orderId))!.status).toBe('paid');
  });
});

describe('승인 중 잠금 복구', () => {
  it('승인 도중 멈춰 잠금이 오래되면 같은 결제 키로 다시 승인할 수 있고, 잠금이 새것이면 기다리게 한다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    const t0 = new Date('2026-10-21T00:00:00Z');
    // 잠금을 잡은 채 서버가 멈춘 상황
    await store.updateOrder(o.orderId, (x) => ({ ...x, payment: { ...x.payment, stage: 'confirming', confirmingAt: t0.toISOString() } }));
    const req = { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount };
    await expect(confirmPayment(store, provider, req, process.env, new Date(t0.getTime() + 1000))).rejects.toBeInstanceOf(PaymentInProgress);
    await expect(preparePayment(store, provider, { orderId: o.orderId, token: o.accessToken, methodId: 'kakaopay', origin: () => 'http://x' })).rejects.toBeInstanceOf(PaymentInProgress);
    const r = await confirmPayment(store, provider, req, process.env, new Date(t0.getTime() + CONFIRM_LOCK_STALE_MS + 1));
    expect(r.paid).toBe(true);
    expect((await store.getOrder(o.orderId))!).toMatchObject({ status: 'paid', payment: { stage: 'approved', confirmingAt: null } });
  });
});

describe('승인 잠금은 잡은 요청만 푼다', () => {
  it('승인 도중 다른 요청이 오래된 잠금을 다시 잡았으면, 먼저 요청의 실패가 그 잠금을 풀지 않는다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    const other = '2026-10-21T09:00:00.000Z';
    vi.spyOn(provider, 'confirm').mockImplementation(async () => {
      // 이 요청이 PG를 기다리는 동안 다른 요청이 잠금을 다시 잡았다
      await store.updateOrder(o.orderId, (x) => ({ ...x, payment: { ...x.payment, confirmingAt: other } }));
      return { ok: false, code: 'PG_DECLINED' };
    });
    await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount })).rejects.toMatchObject({ code: 'PG_DECLINED' });
    expect((await store.getOrder(o.orderId))!.payment).toMatchObject({ stage: 'confirming', confirmingAt: other });
  });
});

describe('환불된 주문의 상태', () => {
  it('환불된 주문은 상태 조회에서 refunded 단계로 보인다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    await store.updateOrder(o.orderId, (x) => transition(x, 'refunded'));
    expect((await orderStatus(store, o.orderId, o.accessToken)).stage).toBe('refunded');
  });
});

describe('요청 본문 상한', () => {
  it('64KB를 넘는 JSON은 읽지 않는다', async () => {
    const big = JSON.stringify({ orderId: 'x', pad: 'a'.repeat(MAX_JSON_BYTES) });
    expect(await readJson(new Request('http://x', { method: 'POST', body: big }))).toBeNull();
    expect(await readJson(new Request('http://x', { method: 'POST', body: '{"a":1}' }))).toEqual({ a: 1 });
    // 길이 헤더 없이 조각으로 오는 본문도 상한을 넘는 순간 멈춘다
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1;
        if (pulled > 1000) return c.close();
        c.enqueue(new Uint8Array(16 * 1024).fill(32));
      },
    });
    expect(await readJson(new Request('http://x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit))).toBeNull();
    expect(pulled).toBeLessThan(10);
  });
});

describe('선택한 주제만 생성', () => {
  it('고른 주제만 AI에 요청하고 리포트에 담는다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { topicIds: ['wealth'] });
    const labels: string[] = [];
    const counting = () => {
      const t = new DevFakeTransport('ok');
      return { transport: { model: t.model, complete: (r: LlmRequest) => (labels.push(r.label), t.complete(r)) }, moderator: new DevPassModerator() };
    };
    await (await startGeneration(store, o.orderId, o.accessToken, counting)).job;
    const topicCalls = labels.filter((l) => l.startsWith('topic'));
    expect(topicCalls.length).toBeGreaterThan(0);
    expect(topicCalls.every((l) => l.includes('wealth'))).toBe(true);
    expect(Object.keys((await store.getReport(o.orderId))!.body.topics)).toEqual(['wealth']);
  });
});

describe('생성 실패와 복구', () => {
  it('실패하면 failed가 되고 다시 시도할 수 있으며, 시도 횟수를 다 쓰면 재시도를 막는다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    for (let i = 1; i <= MAX_GENERATION_RUNS; i++) {
      await (await startGeneration(store, o.orderId, o.accessToken, runtime('fail'))).job;
      const v = await orderStatus(store, o.orderId, o.accessToken);
      expect(v).toMatchObject({ status: 'failed', stage: 'failed', runs: i, canRetry: i < MAX_GENERATION_RUNS });
    }
    await expect(startGeneration(store, o.orderId, o.accessToken, runtime())).rejects.toBeInstanceOf(RetryLimitReached);
    expect((await store.getOrder(o.orderId))!.pendingBirth).not.toBeNull();
  });

  it('실패한 뒤 다시 시도해 성공하면 done', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    await (await startGeneration(store, o.orderId, o.accessToken, runtime('fail'))).job;
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    expect((await store.getOrder(o.orderId))!.status).toBe('done');
  });

  it('생성 중에 서버가 멈춰 오래 머문 주문은 상태 조회 때 interrupted 실패로 바뀌어 재시도할 수 있다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    // 생성을 시작했지만 결과를 쓰지 못한 채 서버가 멈춘 상황
    const started = new Date('2026-10-21T00:00:00Z');
    await store.updateOrder(o.orderId, (x) => transition(x, 'generating', { generation: { ...x.generation, runs: 1, startedAt: started.toISOString() } }));
    const early = await orderStatus(store, o.orderId, o.accessToken, new Date(started.getTime() + STALE_GENERATION_MS - 1));
    expect(early.status).toBe('generating');
    const late = await orderStatus(store, o.orderId, o.accessToken, new Date(started.getTime() + STALE_GENERATION_MS + 1));
    expect(late).toMatchObject({ status: 'failed', canRetry: true });
    expect((await store.getOrder(o.orderId))!.generation.lastFailure).toBe('interrupted');
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    expect((await store.getOrder(o.orderId))!.status).toBe('done');
  });

  it('관리 스크립트의 일괄 복구는 오래된 생성 주문만 바꾼다', async () => {
    const store = new MemoryStore();
    const a = await paidOrder(store);
    const b = await paidOrder(store);
    const now = new Date('2026-10-21T01:00:00Z');
    await store.updateOrder(a.orderId, (x) => transition(x, 'generating', { generation: { ...x.generation, runs: 1, startedAt: new Date(now.getTime() - STALE_GENERATION_MS - 1).toISOString() } }));
    await store.updateOrder(b.orderId, (x) => transition(x, 'generating', { generation: { ...x.generation, runs: 1, startedAt: new Date(now.getTime() - 1000).toISOString() } }));
    expect(await recoverStuckOrders(store, now)).toEqual([a.orderId]);
    expect((await store.getOrder(b.orderId))!.status).toBe('generating');
  });

  it('멈춘 것으로 처리된 뒤 늦게 끝난 실행의 결과는 버린다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    let open = () => {};
    const gate = new Promise<void>((res) => (open = res));
    const slow = () => {
      const t = new DevFakeTransport('ok');
      return {
        // 늦은 실행은 다른 문장을 만든다(덮어쓰면 내용 해시가 달라지게)
        transport: {
          model: t.model,
          complete: async (r: LlmRequest) => {
            await gate;
            const res = await t.complete(r);
            return { ...res, text: (res.text ?? '').replaceAll('풀이 문장', '늦은 실행 문장') };
          },
        },
        moderator: new DevPassModerator(),
      };
    };
    const first = await startGeneration(store, o.orderId, o.accessToken, slow);
    // 멈춘 것으로 보고 실패 처리 → 다시 시도해 성공
    const later = new Date(Date.now() + STALE_GENERATION_MS + 1000);
    await orderStatus(store, o.orderId, o.accessToken, later);
    await (await startGeneration(store, o.orderId, o.accessToken, runtime(), later)).job;
    const done = (await store.getOrder(o.orderId))!;
    const hash = (await store.getIssuance(o.orderId))!.contentHash;
    open();
    await first.job;
    expect((await store.getOrder(o.orderId))!.generation).toEqual(done.generation);
    expect((await store.getIssuance(o.orderId))!.contentHash).toBe(hash);
    // 저장된 리포트도 발급 기록의 내용과 같다(늦은 실행이 덮어쓰지 않았다)
    expect(reportContentHash((await store.getReport(o.orderId))!, done.topicIds)).toBe(hash);
  });
});

describe('발급 기록', () => {
  it('한 번 만들면 다시 만들 수 없고, 돌려받은 객체를 고쳐도 저장값은 그대로이며, 사건만 덧붙는다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    const rec = (await store.getIssuance(o.orderId))!;
    await expect(store.createIssuance({ ...rec, contentHash: 'x' })).rejects.toBeInstanceOf(IssuanceImmutable);
    rec.contentHash = 'tampered';
    rec.events.push({ type: 'email_sent', at: 'x' });
    const fresh = (await store.getIssuance(o.orderId))!;
    expect(fresh.contentHash).not.toBe('tampered');
    expect(fresh.events).toEqual([]);
    // 저장소에는 발급 기록을 고치거나 지우는 기능이 없다
    for (const name of ['updateIssuance', 'deleteIssuance', 'removeIssuance']) expect(name in store).toBe(false);
    const at = new Date('2026-10-21T03:00:00Z');
    expect(await recordIssuanceEvent(store, o.orderId, 'pdf_download', at)).toBe(true);
    expect((await store.getIssuance(o.orderId))!.events).toEqual([{ type: 'pdf_download', at: at.toISOString() }]);
    expect((await store.getIssuance(o.orderId))!.contentHash).toBe(fresh.contentHash);
    expect(await recordIssuanceEvent(store, 'SJ20261021-AAAAAAAA', 'pdf_download')).toBe(false);
  });

  it('발급 기록과 로그에 생년월일시·이름·이메일 원문이 없다', async () => {
    const logs: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')));
    }
    const store = new MemoryStore();
    const email = 'secret.person@example.com';
    const o = await paidOrder(store, { deliveryMethods: ['pdf', 'email'], email });
    const label = (await store.getOrder(o.orderId))!.pendingBirth!.label;
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    await recordIssuanceEvent(store, o.orderId, 'pdf_download');
    const text = JSON.stringify(await store.getIssuance(o.orderId)) + '\n' + logs.join('\n');
    // 연도 숫자만(1990)으로 찾으면 무작위 해시·키에 우연히 들어가 가끔 실패했다. 원문에 쓰이는 꼴로 찾는다
    for (const needle of [BIRTH.name, email, label, '1990년', '1990-05-15', '"year":1990', '5월 15일', '14:30', 'busan', '부산']) expect(text).not.toContain(needle);
  });
});

describe('결제 수단 설정', () => {
  it('화면 5 목록은 7개이고 기본으로 카카오페이만 켜져 있다', () => {
    const list = paymentMethods({});
    expect(list.map((m) => m.name)).toEqual(['카카오페이', '토스페이', '네이버페이', '페이코', '삼성페이', '신용·체크카드', '계좌이체']);
    expect(list.filter((m) => m.enabled).map((m) => m.id)).toEqual(['kakaopay']);
  });

  it('꺼진 수단으로는 주문·결제 준비·승인 요청이 모두 거부된다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    await expect(newOrder(store, { paymentMethod: 'tosspay' })).rejects.toMatchObject({ errors: { payment: expect.any(String) } });
    const o = await newOrder(store);
    await expect(preparePayment(store, provider, { orderId: o.orderId, token: o.accessToken, methodId: 'tosspay', origin: () => 'http://x' })).rejects.toBeInstanceOf(OrderInputError);
    await expect(preparePayment(store, provider, { orderId: o.orderId, token: o.accessToken, methodId: 'bitcoin', origin: () => 'http://x' })).rejects.toBeInstanceOf(OrderInputError);
    // 결제창을 연 뒤 수단이 꺼진 경우
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    vi.stubEnv('PAYMENT_METHODS_ENABLED', 'tosspay');
    await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount })).rejects.toMatchObject({ code: 'METHOD_DISABLED' });
    expect(provider.confirmCalls).toBe(0);
  });

  it('설정에서 토스페이를 켜면 목록에서 고를 수 있고 목 어댑터로 결제된다', async () => {
    vi.stubEnv('PAYMENT_METHODS_ENABLED', 'kakaopay,tosspay');
    expect(paymentMethods().filter((m) => m.enabled).map((m) => m.id)).toEqual(['kakaopay', 'tosspay']);
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store, { paymentMethod: 'tosspay' });
    const { redirectUrl } = await preparePayment(store, provider, { orderId: o.orderId, token: o.accessToken, methodId: 'tosspay', origin: () => 'http://x' });
    const paymentKey = new URL(redirectUrl, 'http://x').searchParams.get('paymentKey')!;
    expect(provider.session(paymentKey)!.methodCode).toBe('TOSSPAY');
    provider.authorize(paymentKey, 'success', o.amount);
    await confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: o.amount });
    expect((await store.getOrder(o.orderId))!).toMatchObject({ status: 'paid', paymentMethod: 'tosspay' });
  });
});

describe('운영 환경에서는 목 결제가 없다', () => {
  it('PAYMENT_PROVIDER=mock이어도 운영에서는 결제 어댑터가 없고 결제 준비·승인이 거부된다', async () => {
    expect(getPaymentProvider({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' })).toBeNull();
    expect(getPaymentProvider({ NODE_ENV: 'test' })).toBeNull();
    expect(getPaymentProvider({ NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock' })).not.toBeNull();
    const store = new MemoryStore();
    const o = await newOrder(store);
    vi.stubEnv('NODE_ENV', 'production');
    const provider = getPaymentProvider();
    await expect(preparePayment(store, provider, { orderId: o.orderId, token: o.accessToken, methodId: 'kakaopay', origin: () => 'http://x' })).rejects.toBeInstanceOf(PaymentUnavailable);
    await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey: 'k', amount: o.amount })).rejects.toBeInstanceOf(PaymentUnavailable);
  });

  it('운영에서 목 결제창 인증 API는 404다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PAYMENT_PROVIDER', 'mock');
    const form = new FormData();
    form.set('paymentKey', 'mock_x');
    form.set('outcome', 'success');
    form.set('amount', '1');
    const res = await mockPgRoute(new Request('http://x/api/dev/mock-pg', { method: 'POST', body: form }) as never);
    expect(res.status).toBe(404);
  });

  it('운영에서는 APP_ORIGIN만 쓰고, 없으면 요청 주소로 대신하지 않는다', () => {
    expect(appOrigin('http://evil.example', { NODE_ENV: 'production', APP_ORIGIN: 'https://saju.example.com/' })).toBe('https://saju.example.com');
    expect(() => appOrigin('http://evil.example', { NODE_ENV: 'production' })).toThrow(AppOriginMissing);
    expect(appOrigin('http://localhost:3100', { NODE_ENV: 'development' })).toBe('http://localhost:3100');
  });
});

describe('주문 상태 머신', () => {
  it('허용된 이동만 된다', () => {
    expect(canTransition('created', 'paid')).toBe(true);
    expect(canTransition('created', 'generating')).toBe(false);
    expect(canTransition('done', 'generating')).toBe(false);
    expect(canTransition('refunded', 'paid')).toBe(false);
    expect(canTransition('generating', 'refunded')).toBe(false);
    expect(() => transition({ status: 'created' } as never, 'done')).toThrow(InvalidTransition);
  });

  it('PaymentRejected 코드에는 사용자 입력이 들어가지 않는다', () => {
    expect(new PaymentRejected('AMOUNT_MISMATCH').message).toBe('결제 승인 거부: AMOUNT_MISMATCH');
  });
});

describe('출생 정보가 지워진 결제 전 주문(D-054: 주문 30일 뒤 정리)', () => {
  const dropBirth = (store: MemoryStore, id: string) => store.updateOrder(id, (o) => ({ ...o, pendingBirth: null }));

  it('결제만 하고 생성을 시작하지 않은 주문도 출생 정보가 지워지면 다시 생성하지 않고 환불 안내로 간다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    await dropBirth(store, o.orderId);
    await expect(startGeneration(store, o.orderId, o.accessToken, runtime())).rejects.toBeInstanceOf(RetryLimitReached);
    const after = (await store.getOrder(o.orderId))!;
    expect(after.status).toBe('paid');
    expect(after.generation.runs).toBe(0);
  });

  it('PG 연결 오류 이력이 있는 주문이 승인 요청에서 만료로 거절되면 단정하지 않는 코드·표시·운영 확인 로그(주문번호만)를 남긴다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    await store.updateOrder(o.orderId, (x) => ({ ...x, pendingBirth: null, payment: { ...x.payment, lastError: 'PG_UNREACHABLE' } }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = await confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount }).catch((e) => e);
    expect((err as PaymentRejected).code).toBe('ORDER_EXPIRED_CHECK');
    expect(provider.confirmCalls).toBe(0);
    // 결제 상태는 건드리지 않고 거절한다(승인 여부 모름 이력이 그대로 남아 다시 와도 같은 안내)
    expect((await store.getOrder(o.orderId))!.payment.lastError).toBe('PG_UNREACHABLE');
    const line = warn.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('[결제 확인 필요]'));
    expect(line).toContain(o.orderId);
    expect(line).not.toContain(BIRTH.name);
    // 문구는 "돈은 빠져나가지 않았어요"라고 단정하지 않는다
    expect(payFailureMessage('ORDER_EXPIRED_CHECK')).not.toContain('빠져나가지 않았어요');
  });

  it('PG 연결 오류 이력이 있는 주문은 결제창을 다시 열 때도 단정하지 않는 코드로 거절하고, 다시 와도 표시가 남아 같은 코드다', async () => {
    const store = new MemoryStore();
    const o = await newOrder(store);
    await store.updateOrder(o.orderId, (x) => ({ ...x, pendingBirth: null, payment: { ...x.payment, stage: 'ready', lastError: 'PG_UNREACHABLE' } }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prep = () => preparePayment(store, new MockPaymentProvider(), { orderId: o.orderId, token: o.accessToken, methodId: 'kakaopay', origin: () => 'http://x' }).catch((e) => e);
    // 예전 기록(전용 칸 없이 lastError만 있는 주문)도 단정하지 않는 코드로 거절한다
    expect(((await prep()) as PaymentRejected).code).toBe('ORDER_EXPIRED_CHECK');
    expect(((await prep()) as PaymentRejected).code).toBe('ORDER_EXPIRED_CHECK');
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('[결제 확인 필요]'))).toHaveLength(2);
  });

  it('결제창을 열 때 거절하고 새로 주문하게 한다', async () => {
    const store = new MemoryStore();
    const o = await newOrder(store);
    await dropBirth(store, o.orderId);
    const err = await preparePayment(store, new MockPaymentProvider(), { orderId: o.orderId, token: o.accessToken, methodId: 'kakaopay', origin: () => 'http://x' }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRejected);
    expect((err as PaymentRejected).code).toBe('ORDER_EXPIRED');
  });

  it('결제창을 연 뒤 정리됐으면 승인 요청을 PG에 보내지 않는다(돈이 빠져나가지 않는다)', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    await dropBirth(store, o.orderId);
    const err = await confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount }).catch((e) => e);
    expect((err as PaymentRejected).code).toBe('ORDER_EXPIRED');
    expect(provider.confirmCalls).toBe(0);
    const after = (await store.getOrder(o.orderId))!;
    expect(after.status).toBe('created');
    // 승인 요청 전에 거절해 결제 상태는 그대로다(결제창을 다시 열어도 결제창 열기에서 같은 이유로 거절된다)
    expect(after.payment.stage).toBe('ready');
  });
});

describe('승인 여부를 모르는 결제(D-054: 전용 칸)', () => {
  /** 승인 요청을 한 번 PG 연결 오류로 끝낸 주문 */
  async function unreachableOnce(store: MemoryStore, provider = new MockPaymentProvider()) {
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    const spy = vi.spyOn(provider, 'confirm').mockRejectedValueOnce(new Error('network'));
    await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount })).rejects.toMatchObject({ code: 'PG_UNREACHABLE' });
    spy.mockRestore();
    return { o, provider, paymentKey, returnedAmount };
  }

  it('PG 연결 오류로 끝난 결제 키를 전용 칸에 남기고, 결제창 재열기·다른 오류에도 지우지 않는다', async () => {
    const store = new MemoryStore();
    const { o, provider, paymentKey } = await unreachableOnce(store);
    const first = (await store.getOrder(o.orderId))!.payment.uncertain!;
    expect(first.paymentKeys).toEqual([paymentKey]);
    // 결제창을 다시 열어도 남는다
    const again = await authorizeViaMock(store, provider, o, 'fail');
    expect((await store.getOrder(o.orderId))!.payment.uncertain).toEqual(first);
    // 다른 오류(카드 거절)로 끝나도 남는다
    await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey: again.paymentKey, amount: again.returnedAmount })).rejects.toBeInstanceOf(PaymentRejected);
    expect((await store.getOrder(o.orderId))!.payment.uncertain).toEqual(first);
  });

  it('같은 결제 키가 실제로 승인되면 그 키를 칸에서 빼고, 다른 결제 키로 승인되면 남긴다(이중 결제 확인용)', async () => {
    const same = new MemoryStore();
    const a = await unreachableOnce(same);
    await confirmPayment(same, a.provider, { orderId: a.o.orderId, token: a.o.accessToken, paymentKey: a.paymentKey, amount: a.returnedAmount });
    expect((await same.getOrder(a.o.orderId))!.payment.uncertain).toBeNull();

    const other = new MemoryStore();
    const b = await unreachableOnce(other);
    const next = await authorizeViaMock(other, b.provider, b.o);
    await confirmPayment(other, b.provider, { orderId: b.o.orderId, token: b.o.accessToken, paymentKey: next.paymentKey, amount: next.returnedAmount });
    const after = (await other.getOrder(b.o.orderId))!;
    expect(after.status).toBe('paid');
    expect(after.payment.uncertain?.paymentKeys).toEqual([b.paymentKey]);
  });

  it('만료 뒤에는 결제창 열기·승인 요청·같은 결제의 다시 온 승인 요청 모두 "결제 확인 필요"로 거절하고 PG를 부르지 않는다', async () => {
    const store = new MemoryStore();
    const { o, provider, paymentKey, returnedAmount } = await unreachableOnce(store);
    await store.updateOrder(o.orderId, (x) => ({ ...x, pendingBirth: null }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const calls = provider.confirmCalls;
    const req = { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount };
    expect(((await confirmPayment(store, provider, req).catch((e) => e)) as PaymentRejected).code).toBe('ORDER_EXPIRED_CHECK');
    // 같은 결제를 다시 승인 요청해도 같은 안내(예전에는 결제 키 검사에 먼저 걸려 일반 실패 문구였다)
    expect(((await confirmPayment(store, provider, req).catch((e) => e)) as PaymentRejected).code).toBe('ORDER_EXPIRED_CHECK');
    const prep = await preparePayment(store, provider, { orderId: o.orderId, token: o.accessToken, methodId: 'kakaopay', origin: () => 'http://x' }).catch((e) => e);
    expect((prep as PaymentRejected).code).toBe('ORDER_EXPIRED_CHECK');
    expect(provider.confirmCalls).toBe(calls);
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith('[결제 확인 필요]'))).toHaveLength(3);
    expect((await store.getOrder(o.orderId))!.payment.uncertain?.paymentKeys).toEqual([paymentKey]);
  });

  it('승인 여부를 모르는 결제가 없는 만료 주문의 문구는 결제 여부를 단정하지 않는다', () => {
    expect(payFailureMessage('ORDER_EXPIRED')).toContain('결제는 진행하지 않았어요');
    expect(payFailureMessage('ORDER_EXPIRED')).toContain('고객센터');
    for (const code of ['ORDER_EXPIRED', 'ORDER_EXPIRED_CHECK']) expect(payFailureMessage(code)).not.toContain('빠져나가지 않았어요');
  });
});

describe('승인 여부 모름: 취소 실패와 운영자 확인(D-054 리뷰 MEDIUM 2건)', () => {
  it('승인 금액이 달라 취소했는데 취소까지 실패하면 그 결제 키를 승인 여부 모름 칸에 넣는다(경고·보류·"결제 확인 필요")', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    vi.spyOn(provider, 'confirm').mockResolvedValueOnce({ ok: true, transactionId: 'tx', approvedAmount: o.amount + 1, approvedAt: new Date().toISOString() } as ConfirmResult);
    vi.spyOn(provider, 'cancel').mockRejectedValueOnce(new Error('network'));
    await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount })).rejects.toMatchObject({ code: 'APPROVED_AMOUNT_MISMATCH' });
    const after = (await store.getOrder(o.orderId))!;
    expect(after.payment.lastError).toBe('APPROVED_AMOUNT_MISMATCH_CANCEL_FAILED');
    expect(after.payment.uncertain?.paymentKeys).toEqual([paymentKey]);
    expect((await store.listOrdersWithUncertainPayment()).map((x) => x.id)).toEqual([o.orderId]);
    // 만료 뒤 거절은 "결제 확인 필요"
    await store.updateOrder(o.orderId, (x) => ({ ...x, pendingBirth: null }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = await preparePayment(store, provider, { orderId: o.orderId, token: o.accessToken, methodId: 'kakaopay', origin: () => 'http://x' }).catch((e) => e);
    expect((err as PaymentRejected).code).toBe('ORDER_EXPIRED_CHECK');
  });

  it('취소에 성공하면 승인 여부 모름 칸에 넣지 않는다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await newOrder(store);
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o);
    vi.spyOn(provider, 'confirm').mockResolvedValueOnce({ ok: true, transactionId: 'tx', approvedAmount: o.amount + 1, approvedAt: new Date().toISOString() } as ConfirmResult);
    vi.spyOn(provider, 'cancel').mockResolvedValueOnce({ ok: true, cancelledAt: new Date().toISOString() } as never);
    await expect(confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount })).rejects.toBeInstanceOf(PaymentRejected);
    expect((await store.getOrder(o.orderId))!.payment.uncertain ?? null).toBeNull();
  });

  it('운영자가 PG에서 확인한 결과를 기록하면 그 키가 빠지고, 모두 빠지면 경고 대상에서 빠진다(예전 기록 포함)', async () => {
    const store = new MemoryStore();
    const o = await newOrder(store);
    await store.updateOrder(o.orderId, (x) => ({ ...x, payment: { ...x.payment, uncertain: { since: new Date().toISOString(), paymentKeys: ['pk_a', 'pk_b'] } } }));
    const lines: string[] = [];
    const run = (argv: string[]) => runAdmin(argv, { store, provider: null, out: (l) => lines.push(l) });
    expect(await run(['payments', 'uncertain'])).toBe(0);
    expect(lines.join('\n')).toContain('pk_a');
    expect(await run(['payments', 'resolve', o.orderId, '--result', 'not-approved', '--key', 'pk_a', '--note', 'PG 화면 미승인'])).toBe(0);
    expect((await store.getOrder(o.orderId))!.payment.uncertain?.paymentKeys).toEqual(['pk_b']);
    expect(await run(['payments', 'resolve', o.orderId, '--result', 'approved-cancelled'])).toBe(0);
    const after = (await store.getOrder(o.orderId))!;
    expect(after.payment.uncertain).toBeNull();
    expect(after.payment.uncertainChecks?.map((c) => [c.paymentKey, c.result])).toEqual([['pk_a', 'not-approved'], ['pk_b', 'approved-cancelled']]);
    expect(await store.listOrdersWithUncertainPayment()).toEqual([]);
    // 없는 키·결과 값·대상 아님은 오류
    expect(await run(['payments', 'resolve', o.orderId, '--result', 'not-approved'])).toBe(1);
    expect(await run(['payments', 'resolve', o.orderId, '--result', 'oops'])).toBe(1);
    // 예전 기록(lastError만 있는 주문)도 끝낼 수 있다
    const legacy = await newOrder(store);
    await store.updateOrder(legacy.orderId, (x) => ({ ...x, payment: { ...x.payment, lastError: 'PG_UNREACHABLE' } }));
    expect(await run(['payments', 'resolve', legacy.orderId, '--result', 'not-approved'])).toBe(0);
    expect(await store.listOrdersWithUncertainPayment()).toEqual([]);
  });
});
