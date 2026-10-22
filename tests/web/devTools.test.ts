// 개발 전용 도구: 실제 풀이 모드에서도 생성 실패 재현(화면 B)은 API를 부르지 않는다,
// 이미 처리한 목 결제창을 다시 제출하면 404 대신 안내 화면으로 보낸다. 운영 환경에서는 둘 다 동작하지 않는다.
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as mockPgRoute } from '../../src/app/api/dev/mock-pg/route';
import { DevFakeTransport } from '../../src/llm/devFake';
import { llmRuntime } from '../../src/llm/runtime';
import { AnthropicTransport } from '../../src/llm/transport';
import { createOrder } from '../../src/orders/create';
import { startGeneration } from '../../src/orders/generation';
import { confirmPayment, preparePayment } from '../../src/orders/payment';
import { sharedMockProvider } from '../../src/payments';
import { MockPaymentProvider } from '../../src/payments/mock';
import { MemoryStore } from '../../src/store/memory';
import { authorizeViaMock, mockEnv, ORDER } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// 실제 API 클라이언트는 만들기만 하고 부르지 않는다(키는 가짜)
const FAKE_KEY = 'test-key-not-a-real-key-0000000000';

describe('생성 실패 재현은 실제 풀이 모드에서도 API를 부르지 않는다', () => {
  it('개발·테스트 환경에서 forceFailure면 ENABLE_FAKE_LLM 없이도 가짜 실패 전송을 쓴다', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const r = llmRuntime({ forceFailure: true }, { NODE_ENV });
      expect(r.transport).toBeInstanceOf(DevFakeTransport);
    }
  });

  it('실패 재현이 아니면 실제 풀이 모드는 실제 API 전송을 쓴다(비용은 성공 선택 때만)', () => {
    vi.stubEnv('LLM_API_KEY', FAKE_KEY);
    expect(llmRuntime({ forceFailure: false }, { NODE_ENV: 'development' }).transport).toBeInstanceOf(AnthropicTransport);
    expect(llmRuntime({}, { NODE_ENV: 'development', ENABLE_FAKE_LLM: 'true' }).transport).toBeInstanceOf(DevFakeTransport);
  });

  it('운영(production·비어 있음·staging)에서는 forceFailure를 무시한다', () => {
    vi.stubEnv('LLM_API_KEY', FAKE_KEY);
    for (const NODE_ENV of ['production', undefined, '', 'staging']) {
      expect(llmRuntime({ forceFailure: true }, { NODE_ENV, ENABLE_FAKE_LLM: 'true' }).transport).toBeInstanceOf(AnthropicTransport);
    }
  });

  it('화면 B를 고른 주문은 처음 생성도 다시 시도도 API 없이 실패한다(키가 없어도 개발용 API 오류로 끝남, D-050)', async () => {
    mockEnv();
    vi.stubEnv('ENABLE_FAKE_LLM', '');
    vi.stubEnv('LLM_API_KEY', '');
    const create = vi.spyOn(AnthropicTransport.prototype, 'complete');
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const o = await createOrder(store, ORDER());
    const { paymentKey, returnedAmount } = await authorizeViaMock(store, provider, o, 'success-genfail');
    await confirmPayment(store, provider, { orderId: o.orderId, token: o.accessToken, paymentKey, amount: returnedAmount });
    // 생성 라우트와 같은 방식으로 런타임을 고른다
    const runtimeFor = (order: { devForceGenerationFailure: boolean }) => llmRuntime({ forceFailure: order.devForceGenerationFailure });
    for (let run = 0; run < 2; run++) {
      await (await startGeneration(store, o.orderId, o.accessToken, runtimeFor)).job;
      const saved = (await store.getOrder(o.orderId))!;
      expect(saved.status).toBe('failed');
      expect(saved.generation.lastFailure).toBe('interrupted');
    }
    expect(create).not.toHaveBeenCalled();
  });
});

describe('이미 처리한 목 결제창을 다시 제출하면 안내 화면으로 보낸다', () => {
  const submit = (paymentKey: string, outcome: string, amount: number) => {
    const form = new FormData();
    form.set('paymentKey', paymentKey);
    form.set('outcome', outcome);
    form.set('amount', String(amount));
    return mockPgRoute(new NextRequest('http://x/api/dev/mock-pg', { method: 'POST', body: form }));
  };

  async function openMockPg() {
    mockEnv();
    const store = new MemoryStore();
    const o = await createOrder(store, ORDER());
    const { redirectUrl } = await preparePayment(store, sharedMockProvider(), { orderId: o.orderId, token: o.accessToken, methodId: 'kakaopay', origin: () => 'http://x' });
    return { o, paymentKey: new URL(redirectUrl, 'http://x').searchParams.get('paymentKey')! };
  }

  it('처음 제출은 PG처럼 복귀 주소로, 다시 제출하면(뒤로 가기) 결제창 주소로 보내고 결제 상태는 바꾸지 않는다', async () => {
    const { o, paymentKey } = await openMockPg();
    const first = await submit(paymentKey, 'success', o.amount);
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toContain('/checkout/complete');
    for (const outcome of ['fail', 'success-genfail', 'success']) {
      const again = await submit(paymentKey, outcome, o.amount);
      expect(again.status).toBe(303);
      expect(new URL(again.headers.get('location')!).pathname + new URL(again.headers.get('location')!).search).toBe(`/dev/mock-pg?paymentKey=${paymentKey}`);
    }
    expect(sharedMockProvider().session(paymentKey)!.state).toBe('authorized');
    expect(sharedMockProvider().session(paymentKey)!.devGenFail).toBe(false);
  });

  it('없는 결제창(서버를 다시 켠 뒤)도 결제창 주소로 보낸다', async () => {
    mockEnv();
    const res = await submit('mock_unknown', 'fail', 1);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/dev/mock-pg?paymentKey=mock_unknown');
  });

  it('운영에서는 이미 처리한 결제창도 없는 결제창도 404다(안내 화면으로 보내지 않는다)', async () => {
    const { o, paymentKey } = await openMockPg();
    await submit(paymentKey, 'success', o.amount);
    vi.stubEnv('NODE_ENV', 'production');
    for (const key of [paymentKey, 'mock_unknown']) {
      const res = await submit(key, 'fail', o.amount);
      expect(res.status).toBe(404);
      expect(res.headers.get('location')).toBeNull();
    }
  });
});
