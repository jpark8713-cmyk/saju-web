// Phase 4 환불: 본인 확인(기기값·주문 이메일), HMAC 접수번호와 같은 모양의 응답, 횟수 제한, 접수만(자동 취소 없음),
// 운영자 관리 스크립트(조회·처리 기록·이메일 삭제·발급 기록 함께 보기)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as refundRoute } from '../../src/app/api/orders/[id]/refund-request/route';
import { runAdmin } from '../../src/admin/cli';
import { AdminError, processRefund, showRefund } from '../../src/admin/refunds';
import { REFUND_PER_IP, REFUND_PER_ORDER } from '../../src/config/limits';
import { refundIdSecret, SecretMissing } from '../../src/config/secrets';
import { createOrder } from '../../src/orders/create';
import { startGeneration } from '../../src/orders/generation';
import { refundIdFor, requestRefund, type RefundContext } from '../../src/orders/refund';
import { REFUND_ACK_MESSAGE, REFUND_ID_RE } from '../../src/orders/refundForm';
import { MockPaymentProvider } from '../../src/payments/mock';
import { getStore } from '../../src/store';
import { MemoryStore } from '../../src/store/memory';
import { clientIp } from '../../src/web/clientIp';
import { RateLimited, RateLimiter } from '../../src/web/rateLimit';
import { mockEnv, ORDER, paidOrder, runtime } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const SECRET = 'test-secret-0123456789-0123456789-abcdef';
const ctx = (store: MemoryStore, over: Partial<RefundContext> = {}): RefundContext => ({
  store, limiter: new RateLimiter(), ip: '203.0.113.7', token: null, env: { NODE_ENV: 'test', REFUND_ID_SECRET: SECRET }, ...over,
});
const body = (orderId: string, over: Record<string, unknown> = {}) => ({ orderId, reason: 'not_generated', detail: null, email: 'reply@example.com', ...over });
const MISSING = 'SJ20261021-ZZZZZZZZ';

describe('본인 확인과 저장', () => {
  it('이 브라우저의 주문 토큰이 맞으면 접수하고, 회신 이메일은 환불 건에만 저장한다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    const ack = await requestRefund(ctx(store, { token: o.accessToken }), o.orderId, body(o.orderId));
    expect(ack).toEqual({ refundId: expect.stringMatching(REFUND_ID_RE), orderId: o.orderId, message: REFUND_ACK_MESSAGE });
    const saved = (await store.findRefundByOrder(o.orderId))!;
    expect(saved).toMatchObject({ id: ack.refundId, verifiedBy: 'device', email: 'reply@example.com', status: 'received', processedAt: null });
    expect((await store.getOrder(o.orderId))!.email).toBeNull();
  });

  it('이메일로 받기 주문은 주문 때 입력한 이메일(대소문자 무시)로 확인한다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { deliveryMethods: ['email'], email: 'Buyer@Example.com' });
    await requestRefund(ctx(store), o.orderId, body(o.orderId, { orderEmail: ' buyer@example.COM ' }));
    expect((await store.findRefundByOrder(o.orderId))!).toMatchObject({ verifiedBy: 'orderEmail', email: 'reply@example.com' });
    expect((await store.getOrder(o.orderId))!.email).toBe('Buyer@Example.com');
  });

  it('PDF만 받는 주문은 이메일로는 확인되지 않는다(기기값만)', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    const ack = await requestRefund(ctx(store), o.orderId, body(o.orderId, { orderEmail: 'reply@example.com' }));
    expect(ack.message).toBe(REFUND_ACK_MESSAGE);
    expect(await store.findRefundByOrder(o.orderId)).toBeNull();
  });

  it('틀린 토큰·틀린 이메일·결제 전 주문은 저장하지 않는다', async () => {
    const store = new MemoryStore();
    const paid = await paidOrder(store, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    await requestRefund(ctx(store, { token: 'wrong' }), paid.orderId, body(paid.orderId));
    await requestRefund(ctx(store), paid.orderId, body(paid.orderId, { orderEmail: 'other@example.com' }));
    await requestRefund(ctx(store), paid.orderId, body(paid.orderId));
    expect(await store.findRefundByOrder(paid.orderId)).toBeNull();
    mockEnv();
    const created = await createOrder(store, ORDER());
    await requestRefund(ctx(store, { token: created.accessToken }), created.orderId, body(created.orderId));
    expect(await store.findRefundByOrder(created.orderId)).toBeNull();
  });
});

describe('주문 유무와 관계없이 같은 모양의 응답', () => {
  it('없는 주문, 본인 확인 실패, 실제 접수 모두 같은 키·같은 문구이고 접수번호는 HMAC으로 정해진다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    const real = await requestRefund(ctx(store, { token: o.accessToken }), o.orderId, body(o.orderId));
    const wrongProof = await requestRefund(ctx(store, { token: 'wrong' }), o.orderId, body(o.orderId));
    const missing = await requestRefund(ctx(store), MISSING, body(MISSING));
    for (const a of [real, wrongProof, missing]) {
      expect(Object.keys(a).sort()).toEqual(['message', 'orderId', 'refundId']);
      expect(a.message).toBe(REFUND_ACK_MESSAGE);
      expect(a.refundId).toMatch(REFUND_ID_RE);
    }
    expect(real.refundId).toBe(refundIdFor(o.orderId, { token: o.accessToken, orderEmail: null }, SECRET));
    expect(wrongProof.refundId).toBe(refundIdFor(o.orderId, { token: 'wrong', orderEmail: null }, SECRET));
    expect(missing.refundId).toBe(refundIdFor(MISSING, { token: null, orderEmail: null }, SECRET));
    // 같은 입력이면 같은 번호(주문이 없어도), 입력이 다르면 다른 번호
    expect((await requestRefund(ctx(store), MISSING, body(MISSING))).refundId).toBe(missing.refundId);
    expect((await requestRefund(ctx(store), MISSING, body(MISSING, { orderEmail: 'a@example.com' }))).refundId).not.toBe(missing.refundId);
    expect(refundIdFor(MISSING, { token: null, orderEmail: null }, 'another-secret-0123456789-0123456789')).not.toBe(missing.refundId);
  });

  it('같은 주문을 다시 접수하면 본인 확인이 된 요청에만 기존 접수번호를 준다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { deliveryMethods: ['pdf', 'email'], email: 'buyer@example.com' });
    const first = await requestRefund(ctx(store, { token: o.accessToken }), o.orderId, body(o.orderId));
    // 다른 확인 수단(주문 이메일)으로 다시 접수해도 같은 접수번호
    const again = await requestRefund(ctx(store), o.orderId, body(o.orderId, { orderEmail: 'buyer@example.com', email: 'new@example.com' }));
    expect(again.refundId).toBe(first.refundId);
    expect((await store.findRefundByOrder(o.orderId))!.email).toBe('reply@example.com');
    // 확인이 안 되는 요청에는 저장된 번호를 주지 않는다(접수가 있는지 드러내지 않는다)
    const stranger = await requestRefund(ctx(store), o.orderId, body(o.orderId, { orderEmail: 'x@example.com' }));
    expect(stranger.refundId).not.toBe(first.refundId);
    expect(stranger.refundId).toBe(refundIdFor(o.orderId, { token: null, orderEmail: 'x@example.com' }, SECRET));
  });

  it('API 응답도 주문이 있든 없든 202에 같은 키다', async () => {
    vi.stubEnv('REFUND_ID_SECRET', SECRET);
    const store = getStore() as MemoryStore;
    const o = await paidOrder(store);
    const call = (orderId: string, token?: string) =>
      refundRoute(
        new Request(`http://x/api/orders/${orderId}/refund-request`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { 'x-order-token': token } : {}) },
          body: JSON.stringify(body(orderId)),
        }),
        { params: Promise.resolve({ id: orderId }) } as never,
      );
    const responses = [await call(o.orderId, o.accessToken), await call(o.orderId), await call(MISSING)];
    for (const r of responses) {
      expect(r.status).toBe(202);
      expect(Object.keys(await r.json()).sort()).toEqual(['message', 'orderId', 'refundId']);
    }
  });

  it('형식 오류는 주문 유무와 관계없이 400', async () => {
    const store = new MemoryStore();
    await expect(requestRefund(ctx(store), MISSING, body(MISSING, { email: 'bad' }))).rejects.toMatchObject({ errors: { email: expect.any(String) } });
    await expect(requestRefund(ctx(store), MISSING, body(MISSING, { orderEmail: 'bad' }))).rejects.toMatchObject({ errors: { orderEmail: expect.any(String) } });
    await expect(requestRefund(ctx(store), 'nope', body('nope'))).rejects.toMatchObject({ errors: { orderId: expect.any(String) } });
  });

  it('운영에서 HMAC 비밀값이 없으면 접수번호를 만들지 않는다', () => {
    expect(() => refundIdSecret({ NODE_ENV: 'production' })).toThrow(SecretMissing);
    expect(() => refundIdSecret({ NODE_ENV: 'production', REFUND_ID_SECRET: 'short' })).toThrow(SecretMissing);
    expect(refundIdSecret({ NODE_ENV: 'production', REFUND_ID_SECRET: SECRET })).toBe(SECRET);
  });
});

describe('횟수 제한', () => {
  it('주문번호당 한도를 넘긴 미확인 요청도 같은 접수 응답을 받고 저장되지 않는다(없는 주문번호도 같다)', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { deliveryMethods: ['email'], email: 'victim@example.com' });
    const c = ctx(store);
    const acks = [];
    for (let i = 0; i < REFUND_PER_ORDER.max + 3; i++) {
      acks.push(await requestRefund({ ...c, ip: `198.51.100.${i}` }, o.orderId, body(o.orderId, { orderEmail: `guess${i}@example.com` })));
      acks.push(await requestRefund({ ...c, ip: `198.51.100.${i}` }, MISSING, body(MISSING, { orderEmail: `guess${i}@example.com` })));
    }
    for (const a of acks) expect(Object.keys(a).sort()).toEqual(['message', 'orderId', 'refundId']);
    expect(await store.listRefunds()).toHaveLength(0);
  });

  it('한도를 넘긴 뒤에는 맞는 주문 이메일도 받지 않고 같은 응답을 준다(이메일 대입 방지), 기기값은 받는다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { deliveryMethods: ['pdf', 'email'], email: 'victim@example.com' });
    const c = ctx(store);
    for (let i = 0; i < REFUND_PER_ORDER.max; i++) await requestRefund({ ...c, ip: `198.51.100.${i}` }, o.orderId, body(o.orderId, { orderEmail: `guess${i}@example.com` }));
    const right = await requestRefund({ ...c, ip: '198.51.100.90' }, o.orderId, body(o.orderId, { orderEmail: 'victim@example.com' }));
    const wrong = await requestRefund({ ...c, ip: '198.51.100.91' }, o.orderId, body(o.orderId, { orderEmail: 'nope@example.com' }));
    // 맞는 이메일과 틀린 이메일의 응답은 모양이 같고, 번호는 각자 입력의 HMAC이다
    expect(right).toEqual({ refundId: refundIdFor(o.orderId, { token: null, orderEmail: 'victim@example.com' }, SECRET), orderId: o.orderId, message: REFUND_ACK_MESSAGE });
    expect(wrong).toEqual({ refundId: refundIdFor(o.orderId, { token: null, orderEmail: 'nope@example.com' }, SECRET), orderId: o.orderId, message: REFUND_ACK_MESSAGE });
    expect(await store.findRefundByOrder(o.orderId)).toBeNull();
    // 결제한 브라우저(기기값)는 그대로 접수된다
    const ack = await requestRefund({ ...c, ip: '198.51.100.92', token: o.accessToken }, o.orderId, body(o.orderId));
    expect((await store.findRefundByOrder(o.orderId))!).toMatchObject({ id: ack.refundId, verifiedBy: 'device' });
  });

  it('한도 구간이 지나면 주문 이메일 대조를 다시 한다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { deliveryMethods: ['email'], email: 'victim@example.com' });
    const t0 = new Date('2026-10-21T00:00:00Z');
    const c = ctx(store, { now: t0 });
    for (let i = 0; i < REFUND_PER_ORDER.max; i++) await requestRefund({ ...c, ip: `198.51.100.${i}` }, o.orderId, body(o.orderId, { orderEmail: `guess${i}@example.com` }));
    await requestRefund({ ...c, now: new Date(t0.getTime() + REFUND_PER_ORDER.windowMs + 60_000) }, o.orderId, body(o.orderId, { orderEmail: 'victim@example.com' }));
    expect((await store.findRefundByOrder(o.orderId))!.verifiedBy).toBe('orderEmail');
  });

  it('IP 하나당 한도를 넘으면 다른 주문번호도 거부한다', async () => {
    const store = new MemoryStore();
    const c = ctx(store);
    const ids = Array.from({ length: REFUND_PER_IP.max + 1 }, (_, i) => `SJ20261021-${'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[i]!.repeat(8)}`);
    for (const id of ids.slice(0, REFUND_PER_IP.max)) await requestRefund(c, id, body(id));
    await expect(requestRefund(c, ids[REFUND_PER_IP.max]!, body(ids[REFUND_PER_IP.max]!))).rejects.toBeInstanceOf(RateLimited);
  });

  it('IP 한도를 넘은 요청은 주문번호 키를 만들지 않는다', async () => {
    const store = new MemoryStore();
    const limiter = new RateLimiter();
    const c = ctx(store, { limiter });
    for (let i = 0; i < REFUND_PER_IP.max; i++) await requestRefund(c, MISSING, body(MISSING)).catch(() => undefined);
    const before = limiter.size;
    const ids = ['SJ20261021-AAAAAAAA', 'SJ20261021-BBBBBBBB', 'SJ20261021-CCCCCCCC'];
    for (const id of ids) await expect(requestRefund(c, id, body(id))).rejects.toBeInstanceOf(RateLimited);
    expect(limiter.size).toBe(before);
  });

  it('키 수가 상한에 닿으면 가장 오래 쓰이지 않은 키를 지우고 새 키를 받는다(정상 고객이 막히지 않는다)', () => {
    const l = new RateLimiter(100);
    const lim = { max: 5, windowMs: 60 * 60_000 };
    for (let i = 0; i < 100; i++) expect(l.hit(`k${i}`, lim, 1000)).toBe(true);
    // k0을 다시 써서 가장 최근으로 올린다 → 다음에 지워질 키는 k1
    expect(l.hit('k0', lim, 1000)).toBe(true);
    expect(l.hit('new', lim, 1000)).toBe(true);
    expect(l.size).toBe(100);
    expect(l.evicted).toBe(1);
    expect(l.count('k0', 1000)).toBe(2);
    expect(l.count('k1', 1000)).toBe(0);
    // 구간이 지나고 청소가 돌면 지난 키가 사라진다
    expect(l.hit('later', lim, 1000 + lim.windowMs + 60_000)).toBe(true);
    expect(l.size).toBe(1);
  });

  it('키를 대량으로 채워도 호출이 빠르고 메모리는 상한을 넘지 않으며, 새 IP는 막히지 않는다', () => {
    const lim = { max: 5, windowMs: 60 * 60_000 };
    const big = new RateLimiter();
    const t0 = performance.now();
    for (let i = 0; i < 120_000; i++) big.hit(`refund:ip:attacker-${i}`, lim, 5000);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(big.size).toBe(50_000);
    expect(big.hit('refund:ip:198.51.100.5', lim, 5000)).toBe(true);
  });

  it('한도 구간이 지나면 다시 받는다', () => {
    const l = new RateLimiter();
    const lim = { max: 1, windowMs: 1000 };
    expect(l.hit('k', lim, 0)).toBe(true);
    expect(l.hit('k', lim, 500)).toBe(false);
    expect(l.hit('k', lim, 1000)).toBe(true);
  });

  it('프록시를 믿도록 설정하지 않으면 X-Real-IP 헤더를 무시한다', () => {
    const req = new Request('http://x', { headers: { 'x-real-ip': '1.2.3.4' } });
    expect(clientIp(req, {})).toBe('direct');
    expect(clientIp(req, { TRUST_PROXY: 'true' })).toBe('1.2.3.4');
  });

  it('IPv6는 /64 묶음으로 센다(주소를 바꿔도 같은 키)', () => {
    const ip = (v: string) => clientIp(new Request('http://x', { headers: { 'x-real-ip': v } }), { TRUST_PROXY: 'true' });
    expect(ip('2001:db8:1:2::5')).toBe('2001:db8:1:2::/64');
    expect(ip('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(ip('2001:0DB8:0001:0002:ffff::1')).toBe('2001:db8:1:2::/64');
    expect(ip('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ip('2001:db8::ffff:1')).toBe(ip('2001:db8::2'));
    expect(ip('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(ip('192.0.2.1')).toBe('192.0.2.1');
  });
});

describe('동시 접수', () => {
  it('같은 입력으로 동시에 접수해도 접수는 하나이고 둘 다 같은 접수번호를 받는다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store);
    const c = ctx(store, { token: o.accessToken });
    const [a, b] = await Promise.all([requestRefund(c, o.orderId, body(o.orderId)), requestRefund(c, o.orderId, body(o.orderId))]);
    expect(a.refundId).toBe(b.refundId);
    expect(await store.listRefunds()).toHaveLength(1);
  });

  it('기기값과 주문 이메일로 동시에 접수해도 접수는 하나다', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { deliveryMethods: ['pdf', 'email'], email: 'buyer@example.com' });
    const [a, b] = await Promise.all([
      requestRefund(ctx(store, { token: o.accessToken }), o.orderId, body(o.orderId)),
      requestRefund(ctx(store), o.orderId, body(o.orderId, { orderEmail: 'buyer@example.com' })),
    ]);
    expect(a.refundId).toBe(b.refundId);
    expect(await store.listRefunds()).toHaveLength(1);
  });
});

describe('접수만 하고 자동 처리하지 않는다', () => {
  it('접수해도 결제 취소가 일어나지 않고 주문 상태가 그대로다', async () => {
    const store = new MemoryStore();
    const provider = new MockPaymentProvider();
    const cancel = vi.spyOn(provider, 'cancel');
    const o = await paidOrder(store, {}, provider);
    await requestRefund(ctx(store, { token: o.accessToken }), o.orderId, body(o.orderId));
    expect(cancel).not.toHaveBeenCalled();
    expect((await store.getOrder(o.orderId))!.status).toBe('paid');
    expect((await store.getOrder(o.orderId))!.payment.stage).toBe('approved');
  });
});

describe('운영자 관리 스크립트', () => {
  async function received(store: MemoryStore, generate = true) {
    const provider = new MockPaymentProvider();
    const o = await paidOrder(store, {}, provider);
    if (generate) await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    const ack = await requestRefund(ctx(store, { token: o.accessToken }), o.orderId, body(o.orderId));
    return { o, provider, refundId: ack.refundId };
  }

  it('조회 결과에 해당 주문의 발급 기록이 함께 나오고, 주문의 이메일·출생 정보는 나오지 않는다', async () => {
    const store = new MemoryStore();
    const { o, refundId } = await received(store);
    const detail = await showRefund(store, refundId);
    expect(detail.issuance).toEqual(await store.getIssuance(o.orderId));
    expect(detail.issuance).not.toBeNull();
    expect(detail.order).not.toHaveProperty('email');
    expect(detail.order).not.toHaveProperty('pendingBirth');
    expect(detail.order).not.toHaveProperty('accessTokenHash');
    expect(detail.replyMatchesOrderEmail).toBeNull();
  });

  it('회신 이메일이 주문 이메일과 다르면 조회에서 알려 준다(주문 이메일 원문은 보여 주지 않는다)', async () => {
    const store = new MemoryStore();
    const o = await paidOrder(store, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    const ack = await requestRefund(ctx(store), o.orderId, body(o.orderId, { orderEmail: 'buyer@example.com', email: 'someone@example.com' }));
    const lines: string[] = [];
    expect(await runAdmin(['refunds', 'show', ack.refundId], { store, provider: null, out: (l) => void lines.push(l) })).toBe(0);
    const text = lines.join(' ');
    expect(JSON.parse(lines[0]!).replyMatchesOrderEmail).toBe(false);
    expect(text).toContain('주의: 회신 이메일이 주문 때 이메일과 달라요');
    expect(text).not.toContain('buyer@example.com');
  });

  it('환불 처리: 결제를 취소하고 처리 일시·결과를 기록하며 회신 이메일을 지운다', async () => {
    const store = new MemoryStore();
    const { o, provider, refundId } = await received(store);
    const now = new Date('2026-10-22T05:00:00Z');
    const r = await processRefund(store, provider, refundId, { outcome: 'refunded', note: '생성 실패' }, now);
    expect(r).toMatchObject({ status: 'refunded', processedAt: now.toISOString(), email: null, result: { outcome: 'refunded', note: '생성 실패', cancelledAmount: o.amount } });
    const order = (await store.getOrder(o.orderId))!;
    expect(order.status).toBe('refunded');
    expect(order.payment.stage).toBe('cancelled');
    await expect(processRefund(store, provider, refundId, { outcome: 'refunded', note: null })).rejects.toBeInstanceOf(AdminError);
  });

  it('거절 처리: 결제를 취소하지 않고 기록하며 회신 이메일을 지운다', async () => {
    const store = new MemoryStore();
    const { o, provider, refundId } = await received(store);
    const cancel = vi.spyOn(provider, 'cancel');
    const r = await processRefund(store, provider, refundId, { outcome: 'rejected', note: '발행 완료' });
    expect(r).toMatchObject({ status: 'rejected', email: null, result: { outcome: 'rejected', cancelledAmount: null } });
    expect(r.processedAt).not.toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    expect((await store.getOrder(o.orderId))!.status).toBe('done');
  });

  it('결제 취소가 실패하면 아무것도 바꾸지 않는다', async () => {
    const store = new MemoryStore();
    const { o, provider, refundId } = await received(store);
    vi.spyOn(provider, 'cancel').mockResolvedValue({ ok: false, code: 'PG_ERROR' });
    await expect(processRefund(store, provider, refundId, { outcome: 'refunded', note: null })).rejects.toBeInstanceOf(AdminError);
    expect((await store.getRefund(refundId))!).toMatchObject({ status: 'received', email: 'reply@example.com', processedAt: null });
    expect((await store.getOrder(o.orderId))!.status).toBe('done');
  });

  it('PG 관리 화면에서 직접 취소했으면 어댑터 없이 기록만 한다', async () => {
    const store = new MemoryStore();
    const { o, refundId } = await received(store);
    const r = await processRefund(store, null, refundId, { outcome: 'refunded', note: null, cancelledExternally: true });
    expect(r.status).toBe('refunded');
    expect((await store.getOrder(o.orderId))!.status).toBe('refunded');
  });

  it('명령줄: list·show·process·recover-stuck과 사용법 오류', async () => {
    const store = new MemoryStore();
    const { provider, refundId } = await received(store, false);
    const lines: string[] = [];
    const deps = { store, provider, out: (l: string) => void lines.push(l) };
    expect(await runAdmin(['refunds', 'list', '--status', 'received'], deps)).toBe(0);
    expect(JSON.parse(lines.at(-1)!)).toEqual([expect.objectContaining({ refundId, status: 'received', orderStatus: 'paid' })]);
    expect(await runAdmin(['refunds', 'show', refundId], deps)).toBe(0);
    expect(await runAdmin(['refunds', 'process', refundId, '--result', 'maybe'], deps)).toBe(1);
    expect(await runAdmin(['refunds', 'process', refundId, '--result', 'refunded', '--note', '확인'], deps)).toBe(0);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ refundId, status: 'refunded' });
    expect(await runAdmin(['orders', 'recover-stuck'], deps)).toBe(0);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ recovered: [] });
    expect(await runAdmin(['refunds', 'show', 'RF20261021-AAAAAAAA'], deps)).toBe(1);
    expect(await runAdmin([], deps)).toBe(2);
  });
});
