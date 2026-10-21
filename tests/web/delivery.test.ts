// Phase 5 결과물 전달: PDF 저장, 이메일 링크(콘솔 발송), 토큰, 재시도·발송 기록, 재발송 제한, 보관 기간 정리, 로그 개인정보
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_LINK_TTL_DAYS, DOWNLOAD_LINK_TTL_MS, EMAIL_MAX_ATTEMPTS } from '../../src/config/delivery';
import { RESEND_PER_IP, RESEND_PER_ORDER } from '../../src/config/limits';
import { deliverOnDone, ensureStoredPdf, pdfForDownloadToken, renderAndStore, resumeEmailDeliveries, sendDownloadEmail, type DeliveryDeps } from '../../src/delivery/deliver';
import { ConsoleEmailProvider } from '../../src/delivery/email';
import { downloadEmail } from '../../src/delivery/messages';
import { PdfStore } from '../../src/delivery/pdfStore';
import { purgeExpired } from '../../src/delivery/purge';
import { requestResend, RESEND_MESSAGE } from '../../src/delivery/resend';
import { deliveryOf, withDelivery } from '../../src/delivery/state';
import { createOrder } from '../../src/orders/create';
import { orderStatus, startGeneration } from '../../src/orders/generation';
import { hashToken } from '../../src/orders/ids';
import { reportViewFor, ReportExpired } from '../../src/orders/reportAccess';
import { MemoryStore } from '../../src/store/memory';
import { SqliteStore } from '../../src/store/sqlite';
import type { Store } from '../../src/store/types';
import { RateLimited, RateLimiter } from '../../src/web/rateLimit';
import { BIRTH, mockEnv, ORDER, paidOrder, runtime } from './helpers';

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'saju-delivery-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FAKE_PDF = Buffer.from('%PDF-1.7 fake report');

function makeDeps(store: Store, over: Partial<DeliveryDeps> = {}) {
  const email = new ConsoleEmailProvider();
  const renders: string[] = [];
  const deps: DeliveryDeps = {
    store,
    pdfs: new PdfStore(join(tempDir(), 'pdf')),
    renderPdf: async (_origin, orderId, token) => {
      // 인쇄 페이지는 내부 토큰으로만 열린다: 주문에 그 토큰의 해시가 걸려 있어야 한다
      const o = await store.getOrder(orderId);
      if (!deliveryOf(o!).renderTokens.some((t) => t.hash === hashToken(token))) throw new Error('render token mismatch');
      renders.push(orderId);
      return FAKE_PDF;
    },
    email,
    origin: () => 'https://saju.example.com',
    sleep: async () => undefined,
    ...over,
  };
  return { deps, email, renders };
}

/** 주문 → 결제 → 생성 완료(전달까지) */
async function doneOrder(store: Store, deps: DeliveryDeps, over: Record<string, unknown> = {}) {
  const o = await paidOrder(store, over);
  await (await startGeneration(store, o.orderId, o.accessToken, runtime(), new Date(), (id) => deliverOnDone(deps, id))).job;
  return o;
}

const linkTokenOf = (text: string) => /\/api\/download\/([A-Za-z0-9_-]+)/.exec(text)![1]!;

describe('받는 방법', () => {
  it('받는 방법을 모두 빼면 주문할 수 없다(서버)', async () => {
    mockEnv();
    await expect(createOrder(new MemoryStore(), ORDER({ deliveryMethods: [] }))).rejects.toMatchObject({ errors: { delivery: expect.any(String) } });
  });

  it('PDF만: 이메일을 받지도 저장하지도 보내지도 않고, PDF는 저장되어 받을 수 있다', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['pdf'], email: 'ignored@example.com' });
    const saved = (await store.getOrder(o.orderId))!;
    expect(saved.email).toBeNull();
    expect(email.outbox).toHaveLength(0);
    expect(await store.listDeliveryLogs(o.orderId)).toEqual([]);
    expect(deliveryOf(saved).pdf).toMatchObject({ stored: true, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(deps.pdfs.read(o.orderId)).toEqual(FAKE_PDF);
  });

  it('이메일만: 메일 1통에 링크가 있고, 그 링크로 PDF를 받는다(링크가 가리킬 PDF도 만든다)', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    expect(email.outbox).toHaveLength(1);
    expect(email.outbox[0]!.to).toBe('buyer@example.com');
    const got = await pdfForDownloadToken(deps, linkTokenOf(email.outbox[0]!.text));
    expect(got).toEqual({ orderId: o.orderId, pdf: FAKE_PDF });
    expect(deliveryOf((await store.getOrder(o.orderId))!).email).toMatchObject({ status: 'sent', attempts: 1 });
    const events = (await store.getIssuance(o.orderId))!.events.map((e) => e.type);
    expect(events).toEqual(['email_sent', 'pdf_download']);
  });

  it('둘 다: PDF가 저장되고 메일도 1통 간다', async () => {
    const store = new MemoryStore();
    const { deps, email, renders } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['pdf', 'email'], email: 'buyer@example.com' });
    expect(email.outbox).toHaveLength(1);
    expect(renders).toEqual([o.orderId]);
    expect(deps.pdfs.has(o.orderId)).toBe(true);
  });
});

describe('메일은 주문당 1통', () => {
  it('완성 처리가 여러 번 불려도(중복 요청) 처음 메일은 1통이다', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    await Promise.all([deliverOnDone(deps, o.orderId), deliverOnDone(deps, o.orderId), sendDownloadEmail(deps, o.orderId, 'initial')]);
    expect(email.outbox).toHaveLength(1);
  });
});

describe('다운로드 토큰', () => {
  it('원문은 저장되지 않고 해시로만 찾으며, 없는·만료·재발송으로 바뀐 토큰은 거부한다', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    const first = linkTokenOf(email.outbox[0]!.text);
    // 토큰 원문은 저장소 어디에도 없다
    const dump = JSON.stringify([await store.getOrder(o.orderId), await store.findDownloadToken(hashToken(first)), await store.listDeliveryLogs(o.orderId)]);
    expect(dump).not.toContain(first);
    expect(await store.findDownloadToken(first)).toBeNull();

    expect(await pdfForDownloadToken(deps, 'A'.repeat(43))).toBeNull();
    expect(await pdfForDownloadToken(deps, '../../etc/passwd')).toBeNull();
    // 재발송하면 이전 링크는 무효
    await sendDownloadEmail(deps, o.orderId, 'resend');
    const second = linkTokenOf(email.outbox[1]!.text);
    expect(await pdfForDownloadToken(deps, first)).toBeNull();
    expect(await pdfForDownloadToken(deps, second)).not.toBeNull();
    // 기간이 지나면 거부
    const later = { ...deps, now: () => new Date(Date.now() + DOWNLOAD_LINK_TTL_MS + 60_000) };
    expect(await pdfForDownloadToken(later, second)).toBeNull();
  });

  it('토큰은 자기 주문의 PDF만 준다(다른 주문의 PDF는 받을 수 없다)', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    const a = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'a@example.com' });
    const b = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'b@example.com' });
    const tokenA = linkTokenOf(email.outbox.find((m) => m.orderId === a.orderId)!.text);
    expect((await pdfForDownloadToken(deps, tokenA))!.orderId).toBe(a.orderId);
    expect((await pdfForDownloadToken(deps, tokenA))!.orderId).not.toBe(b.orderId);
  });

  it('메일의 만료 기간은 설정값(30일)과 날짜를 적는다', () => {
    const m = downloadEmail({ orderId: 'SJ20261021-AAAAAAAA', link: 'https://x/api/download/t', expiresAt: '2026-11-20T03:00:00.000Z' });
    expect(DOWNLOAD_LINK_TTL_DAYS).toBe(30);
    expect(m.text).toContain('2026년 11월 20일까지');
    expect(m.text).toContain('30일');
  });

  it('보관 기간은 완성 시각부터 30일이다', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    const o = await doneOrder(store, deps);
    const saved = (await store.getOrder(o.orderId))!;
    expect(Date.parse(deliveryOf(saved).expiresAt!) - Date.parse(saved.generation.finishedAt!)).toBe(DOWNLOAD_LINK_TTL_MS);
    expect((await orderStatus(store, o.orderId, o.accessToken)).expiresAt).toBe(deliveryOf(saved).expiresAt);
  });
});

describe('발송 실패', () => {
  it('간격을 늘려 최대 3번 시도하고, 모두 실패하면 기록을 남기며 화면에서 PDF는 받을 수 있다', async () => {
    const store = new MemoryStore();
    const slept: number[] = [];
    const { deps, email } = makeDeps(store, { sleep: async (ms) => void slept.push(ms) });
    email.failNext = 99;
    const o = await doneOrder(store, deps, { deliveryMethods: ['pdf', 'email'], email: 'buyer@example.com' });
    const logs = await store.listDeliveryLogs(o.orderId);
    expect(logs.map((l) => [l.attempt, l.outcome, l.code])).toEqual(Array.from({ length: EMAIL_MAX_ATTEMPTS }, (_, i) => [i + 1, 'failed', 'CONSOLE_FORCED_FAILURE']));
    expect(slept).toHaveLength(EMAIL_MAX_ATTEMPTS - 1);
    expect(slept[1]!).toBeGreaterThan(slept[0]!);
    expect(deliveryOf((await store.getOrder(o.orderId))!).email).toMatchObject({ status: 'failed', lastError: 'CONSOLE_FORCED_FAILURE' });
    // 화면 다운로드(주문 토큰)는 그대로 된다
    await reportViewFor(store, o.orderId, o.accessToken);
    expect(await ensureStoredPdf(deps, o.orderId)).toEqual(FAKE_PDF);
  });

  it('두 번 실패하고 세 번째에 보내면 성공으로 기록한다', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    email.failNext = 2;
    const o = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    expect((await store.listDeliveryLogs(o.orderId)).map((l) => l.outcome)).toEqual(['failed', 'failed', 'sent']);
    expect(email.outbox).toHaveLength(1);
  });

  it('운영처럼 메일 어댑터가 없으면 실패로 기록하고 PDF는 받을 수 있다', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store, { email: null });
    const o = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    expect((await store.listDeliveryLogs(o.orderId)).every((l) => l.code === 'NO_PROVIDER')).toBe(true);
    expect(deps.pdfs.has(o.orderId)).toBe(true);
  });

  it('보내는 도중 서버가 멈췄던 주문은 서버를 켤 때 이어서 보낸다', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store, { email: null });
    const o = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    await store.updateOrder(o.orderId, (x) => withDelivery(x, (d) => ({ ...d, email: { ...d.email, status: 'sending' } })));
    const live = { ...deps, email };
    expect(await resumeEmailDeliveries(live)).toBe(1);
    await vi.waitFor(() => expect(email.outbox).toHaveLength(1));
  });
});

describe('재발송', () => {
  const ctx = (deps: DeliveryDeps, over: Partial<{ ip: string; limiter: RateLimiter }> = {}) => ({ deps, limiter: new RateLimiter(), ip: '203.0.113.9', ...over });

  it('주문번호와 이메일이 맞을 때만 새 링크를 보내고, 응답은 언제나 같다', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'Buyer@Example.com' });
    const pdfOnly = await doneOrder(store, deps, { deliveryMethods: ['pdf'] });
    const cases = [
      { orderId: o.orderId, email: 'buyer@example.com' },
      { orderId: o.orderId, email: 'other@example.com' },
      { orderId: 'SJ20261021-ZZZZZZZZ', email: 'buyer@example.com' },
      { orderId: pdfOnly.orderId, email: 'buyer@example.com' },
    ];
    const results = [];
    for (const c of cases) results.push(await requestResend(ctx(deps), c));
    expect(results.map((r) => r.message)).toEqual(Array(4).fill(RESEND_MESSAGE));
    expect(results.map((r) => r.job !== null)).toEqual([true, false, false, false]);
    await results[0]!.job;
    expect(email.outbox).toHaveLength(2);
    expect(email.outbox[1]!.to).toBe('Buyer@Example.com');
  });

  it('주문 1건당 시간당 3회, IP당 시간당 10회를 넘으면 거부한다(주문을 찾기 전에 센다)', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    const limiter = new RateLimiter();
    const id = 'SJ20261021-ZZZZZZZZ';
    expect(RESEND_PER_ORDER.max).toBe(3);
    expect(RESEND_PER_IP.max).toBe(10);
    for (let i = 0; i < 3; i++) await requestResend(ctx(deps, { limiter, ip: `198.51.100.${i}` }), { orderId: id, email: 'a@example.com' });
    await expect(requestResend(ctx(deps, { limiter, ip: '198.51.100.50' }), { orderId: id, email: 'a@example.com' })).rejects.toBeInstanceOf(RateLimited);
    const ipLimiter = new RateLimiter();
    const ids = Array.from({ length: 11 }, (_, i) => `SJ20261021-${'ABCDEFGHJKLM'[i]!.repeat(8)}`);
    for (const x of ids.slice(0, 10)) await requestResend(ctx(deps, { limiter: ipLimiter }), { orderId: x, email: 'a@example.com' });
    await expect(requestResend(ctx(deps, { limiter: ipLimiter }), { orderId: ids[10]!, email: 'a@example.com' })).rejects.toBeInstanceOf(RateLimited);
  });

  it('보관 기간이 지난 주문에는 보내지 않는다', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    const later = { ...deps, now: () => new Date(Date.now() + DOWNLOAD_LINK_TTL_MS + 60_000) };
    expect((await requestResend(ctx(later), { orderId: o.orderId, email: 'buyer@example.com' })).job).toBeNull();
  });
});

describe.each([
  ['메모리', () => new MemoryStore() as Store],
  ['SQLite', () => new SqliteStore(join(tempDir(), 'saju.db')) as Store],
])('보관 기간 정리 (%s)', (_name, make) => {
  it('30일이 지나면 PDF·리포트·이메일 주소·토큰을 지우고 주문·발급 기록은 남긴다', async () => {
    const store = make();
    const { deps, email } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['pdf', 'email'], email: 'buyer@example.com' });
    const keep = await doneOrder(store, deps, { deliveryMethods: ['pdf'] });
    const token = linkTokenOf(email.outbox[0]!.text);
    const expiresAt = Date.parse(deliveryOf((await store.getOrder(o.orderId))!).expiresAt!);

    // 기간 전에는 아무것도 지우지 않는다
    expect((await purgeExpired(store, deps.pdfs, new Date(expiresAt - 1000))).orders).toBe(0);
    // 다른 주문은 아직 기간 안이 되도록 그 주문의 만료를 늦춘다
    await store.updateOrder(keep.orderId, (x) => withDelivery(x, (d) => ({ ...d, expiresAt: new Date(expiresAt + 86_400_000).toISOString() })));
    const r = await purgeExpired(store, deps.pdfs, new Date(expiresAt + 1000));
    expect(r).toMatchObject({ orders: 1, pdfs: 1, tokens: 1 });

    const after = (await store.getOrder(o.orderId))!;
    expect(after.email).toBeNull();
    expect(after.status).toBe('done');
    expect(after.amount).toBeGreaterThan(0);
    expect(deliveryOf(after).purgedAt).not.toBeNull();
    expect(await store.getReport(o.orderId)).toBeNull();
    expect(deps.pdfs.has(o.orderId)).toBe(false);
    expect(await store.getIssuance(o.orderId)).not.toBeNull();
    expect(await pdfForDownloadToken(deps, token)).toBeNull();
    await expect(reportViewFor(store, o.orderId, o.accessToken)).rejects.toBeInstanceOf(ReportExpired);
    expect((await orderStatus(store, o.orderId, o.accessToken)).stage).toBe('expired');
    // 다른 주문은 그대로
    expect(deps.pdfs.has(keep.orderId)).toBe(true);
    // 다시 돌려도 더 지울 것이 없다
    expect((await purgeExpired(store, deps.pdfs, new Date(expiresAt + 2000))).orders).toBe(0);
    if (store instanceof SqliteStore) store.close();
  });
});

describe('저장한 PDF 파일', () => {
  it('소유자만 읽고 쓸 수 있고(리눅스 600), 반쯤 쓴 파일이 남지 않는다', () => {
    const pdfs = new PdfStore(join(tempDir(), 'pdf'));
    pdfs.write('SJ20261021-AAAAAAAA', FAKE_PDF);
    if (process.platform !== 'win32') expect(statSync(join(pdfs.dir, 'SJ20261021-AAAAAAAA.pdf')).mode & 0o777).toBe(0o600);
    expect(readdirSync(pdfs.dir)).toEqual(['SJ20261021-AAAAAAAA.pdf']);
    expect(() => pdfs.write('../evil', FAKE_PDF)).toThrow();
  });
});

describe('로그에 개인정보가 없다', () => {
  it('전달 전 과정(성공·실패·재발송·정리)의 로그에 이메일·생년월일시·이름·토큰이 없다', async () => {
    const logs: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')));
    }
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    email.failNext = 1;
    const addr = 'secret.buyer@example.com';
    const o = await doneOrder(store, deps, { deliveryMethods: ['pdf', 'email'], email: addr });
    const token = linkTokenOf(email.outbox[0]!.text);
    await pdfForDownloadToken(deps, token);
    await (await requestResend({ deps, limiter: new RateLimiter(), ip: '203.0.113.1' }, { orderId: o.orderId, email: addr })).job;
    await purgeExpired(store, deps.pdfs, new Date(Date.now() + DOWNLOAD_LINK_TTL_MS + 60_000));
    const text = logs.join('\n') + JSON.stringify(await store.listDeliveryLogs(o.orderId));
    for (const needle of [addr, token, BIRTH.name, '1990', '14:30']) expect(text).not.toContain(needle);
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('4차 수정 (D-034)', () => {
  function gate() {
    let open = () => {};
    const p = new Promise<void>((r) => (open = r));
    return { p, open: () => open() };
  }

  it('PDF를 동시에 두 번 만들어도 서로의 내부 토큰을 지우지 않는다', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'a@example.com' }); // PDF는 이미 저장됨
    deps.pdfs.delete(o.orderId);
    const gA = gate();
    const gB = gate();
    let calls = 0;
    let tokenLost = 0;
    const racing: DeliveryDeps = {
      ...deps,
      renderPdf: async (_origin, orderId, token) => {
        const g = calls++ === 0 ? gA : gB;
        await g.p;
        // 렌더가 끝날 때까지 자기 토큰이 살아 있어야 한다(다른 생성이 지우면 인쇄 페이지가 404)
        const ok = deliveryOf((await store.getOrder(orderId))!).renderTokens.some((t) => t.hash === hashToken(token));
        if (!ok) {
          tokenLost += 1;
          throw new Error('render token removed by another render');
        }
        return FAKE_PDF;
      },
    };
    const a = renderAndStore(racing, o.orderId);
    const b = renderAndStore(racing, o.orderId);
    await vi.waitFor(() => expect(calls).toBe(2));
    gB.open();
    await expect(b).resolves.toEqual(FAKE_PDF);
    gA.open();
    await expect(a).resolves.toEqual(FAKE_PDF);
    // 두 렌더 모두 자기 토큰으로 끝까지 열렸다(다른 생성이 저장한 PDF로 대신하지 않았다)
    expect(tokenLost).toBe(0);
    expect(deliveryOf((await store.getOrder(o.orderId))!).renderTokens).toEqual([]);
  });

  it('PDF를 만드는 사이 보관 기간 정리가 돌면 저장하지 않는다(정리 뒤에 PDF가 남지 않는다)', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['pdf'] });
    deps.pdfs.delete(o.orderId);
    const g = gate();
    const slow: DeliveryDeps = { ...deps, renderPdf: async () => (await g.p, FAKE_PDF) };
    const job = ensureStoredPdf(slow, o.orderId);
    await vi.waitFor(async () => expect(deliveryOf((await store.getOrder(o.orderId))!).renderTokens).toHaveLength(1));
    await purgeExpired(store, deps.pdfs, new Date(Date.now() + DOWNLOAD_LINK_TTL_MS + 60_000));
    g.open();
    await expect(job).rejects.toThrow();
    expect(deps.pdfs.has(o.orderId)).toBe(false);
  });

  it('재발송 메일이 3번 모두 실패하면 이전 링크는 그대로 쓸 수 있고, 성공하면 그때 이전 링크가 무효가 된다', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    const first = linkTokenOf(email.outbox[0]!.text);
    email.failNext = 99;
    expect(await sendDownloadEmail(deps, o.orderId, 'resend')).toBe(false);
    expect(await pdfForDownloadToken(deps, first)).not.toBeNull();
    email.failNext = 0;
    expect(await sendDownloadEmail(deps, o.orderId, 'resend')).toBe(true);
    const second = linkTokenOf(email.outbox[1]!.text);
    expect(await pdfForDownloadToken(deps, first)).toBeNull();
    expect(await pdfForDownloadToken(deps, second)).not.toBeNull();
  });

  it('완성되지 않은 주문의 이메일은 주문일부터 30일 뒤 지운다(그 전에는 남긴다)', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    mockEnv();
    const unpaid = await createOrder(store, ORDER({ deliveryMethods: ['email'], email: 'unpaid@example.com' }));
    const failed = await paidOrder(store, { deliveryMethods: ['email'], email: 'failed@example.com' });
    await (await startGeneration(store, failed.orderId, failed.accessToken, runtime('fail'))).job;
    const done = await doneOrder(store, deps, { deliveryMethods: ['email'], email: 'done@example.com' });
    const created = Date.parse((await store.getOrder(unpaid.orderId))!.createdAt);
    const day = 86_400_000;
    expect((await purgeExpired(store, deps.pdfs, new Date(created + 29 * day))).unfinishedEmails).toBe(0);
    const r = await purgeExpired(store, deps.pdfs, new Date(created + 30 * day + 60_000));
    expect(r.unfinishedEmails).toBe(2);
    expect((await store.getOrder(unpaid.orderId))!.email).toBeNull();
    expect((await store.getOrder(failed.orderId))!.email).toBeNull();
    // 완성된 주문은 완성일 기준(이번 정리에서 함께 지워졌는지는 완성일 + 30일로 정해진다)
    const doneOrderNow = (await store.getOrder(done.orderId))!;
    expect(doneOrderNow.status).toBe('done');
  });

  it('보관 기간이 지났으면 정리 전이라도 화면 리포트·PDF를 보여 주지 않는다', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    const o = await doneOrder(store, deps);
    await store.updateOrder(o.orderId, (x) => withDelivery(x, (d) => ({ ...d, expiresAt: new Date(Date.now() - 1000).toISOString() })));
    await expect(reportViewFor(store, o.orderId, o.accessToken)).rejects.toBeInstanceOf(ReportExpired);
    expect((await orderStatus(store, o.orderId, o.accessToken)).stage).toBe('expired');
  });

  it('완성 직후(메일을 보내기 전) 서버가 멈춘 주문도 서버를 켤 때 처음 메일을 보낸다', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    // 완성까지는 갔지만 전달 단계를 못 탄 주문(onDone 없음)
    const o = await paidOrder(store, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    expect(deliveryOf((await store.getOrder(o.orderId))!).email.status).toBe('none');
    expect(await resumeEmailDeliveries(deps)).toBe(1);
    await vi.waitFor(() => expect(email.outbox).toHaveLength(1));
  });

  it('서버 시작 때 이어 보내기가 저장소 오류로 실패해도 프로세스를 죽이지 않는다', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    const o = await paidOrder(store, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const broken = { ...deps, store: Object.assign(Object.create(Object.getPrototypeOf(store)), store, { updateOrder: async () => { throw new Error('SQLITE_BUSY'); } }) as Store };
      broken.store.listOrdersWithEmailStatus = store.listOrdersWithEmailStatus.bind(store);
      await resumeEmailDeliveries(broken);
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('정리 도중 실패 (D-035)', () => {
  const expireNow = (store: Store, id: string) =>
    store.updateOrder(id, (x) => withDelivery(x, (d) => ({ ...d, expiresAt: new Date(Date.now() - 60_000).toISOString() })));

  it('삭제와 되돌리기(정리 표시)가 연달아 실패한 뒤 다음 정리가 리포트를 지운다. 그 사이 다른 주문과 미완성 주문 이메일 정리는 계속된다', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    const bad = await doneOrder(store, deps, { deliveryMethods: ['pdf'] });
    const good = await doneOrder(store, deps, { deliveryMethods: ['pdf'] });
    mockEnv();
    const unpaid = await createOrder(store, ORDER({ deliveryMethods: ['email'], email: 'unpaid@example.com' }));
    await expireNow(store, bad.orderId);
    await expireNow(store, good.orderId);
    const now = new Date(Date.now() + 31 * 86_400_000);

    // 첫 정리: bad 주문에서 리포트 삭제와 정리 표시(주문 갱신)가 모두 실패한다
    const realDeleteReport = store.deleteReport.bind(store);
    const realUpdate = store.updateOrder.bind(store);
    store.deleteReport = async (id) => {
      if (id === bad.orderId) throw new Error('SQLITE_BUSY');
      return realDeleteReport(id);
    };
    store.updateOrder = async (id, fn) => {
      if (id === bad.orderId) throw new Error('SQLITE_BUSY');
      return realUpdate(id, fn);
    };
    const first = await purgeExpired(store, deps.pdfs, now);
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect(await store.getReport(bad.orderId)).not.toBeNull();
    expect(deliveryOf((await store.getOrder(bad.orderId))!).purgedAt).toBeNull();
    // 다른 주문과 미완성 주문 이메일은 정리됐다
    expect(await store.getReport(good.orderId)).toBeNull();
    expect(deliveryOf((await store.getOrder(good.orderId))!).purgedAt).not.toBeNull();
    expect((await store.getOrder(unpaid.orderId))!.email).toBeNull();

    // 저장소가 회복된 뒤 다음 정리가 남은 리포트를 지우고 그때 표시한다
    store.deleteReport = realDeleteReport;
    store.updateOrder = realUpdate;
    const second = await purgeExpired(store, deps.pdfs, now);
    expect(second.failed).toBe(0);
    expect(await store.getReport(bad.orderId)).toBeNull();
    expect(deps.pdfs.has(bad.orderId)).toBe(false);
    expect(deliveryOf((await store.getOrder(bad.orderId))!).purgedAt).not.toBeNull();
  });

  it.each([
    ['메모리', () => new MemoryStore() as Store],
    ['SQLite', () => new SqliteStore(join(tempDir(), 'saju.db')) as Store],
  ])('정리 표시가 있어도 리포트·이메일·출생 정보가 남아 있으면 다시 정리 대상으로 잡는다(표시 뒤 멈춘 경우, %s)', async (_name, make) => {
    const store = make();
    const { deps } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['pdf', 'email'], email: 'buyer@example.com' });
    await expireNow(store, o.orderId);
    // 예전 방식으로 표시만 먼저 남고 지우지 못한 상태
    await store.updateOrder(o.orderId, (x) => withDelivery(x, (d) => ({ ...d, purgedAt: new Date().toISOString() })));
    const r = await purgeExpired(store, deps.pdfs, new Date());
    expect(r.orders).toBe(1);
    expect(await store.getReport(o.orderId)).toBeNull();
    expect((await store.getOrder(o.orderId))!.email).toBeNull();
    expect(deps.pdfs.has(o.orderId)).toBe(false);
    // 다 지운 뒤에는 더 잡지 않는다
    expect((await purgeExpired(store, deps.pdfs, new Date())).orders).toBe(0);
    if (store instanceof SqliteStore) store.close();
  });

  it('PDF 폴더에 보관 기간이 지난 주문의 파일이 남아 있으면 지운다', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    const o = await doneOrder(store, deps, { deliveryMethods: ['pdf'] });
    await expireNow(store, o.orderId);
    await purgeExpired(store, deps.pdfs, new Date());
    // 정리 뒤에 어떤 이유로 파일이 다시 생긴 경우
    deps.pdfs.write(o.orderId, FAKE_PDF);
    const r = await purgeExpired(store, deps.pdfs, new Date());
    expect(r.pdfs).toBe(1);
    expect(deps.pdfs.has(o.orderId)).toBe(false);
  });
});

describe('낮은 위험 (D-035)', () => {
  it('서버 시작 때 이어 보내는 건수에 이메일이 지워진 주문은 넣지 않는다', async () => {
    const store = new MemoryStore();
    const { deps } = makeDeps(store);
    const o = await paidOrder(store, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    await store.updateOrder(o.orderId, (x) => ({ ...x, email: null }));
    expect(await resumeEmailDeliveries(deps)).toBe(0);
  });

  it('메일이 나간 직후 저장이 잠깐 실패해도 "보낸" 상태로 기록되어 서버를 다시 켜도 같은 메일이 또 나가지 않는다', async () => {
    const store = new MemoryStore();
    const { deps, email } = makeDeps(store);
    const o = await paidOrder(store, { deliveryMethods: ['email'], email: 'buyer@example.com' });
    await (await startGeneration(store, o.orderId, o.accessToken, runtime())).job;
    const realRevoke = store.revokeDownloadTokens.bind(store);
    const realUpdate = store.updateOrder.bind(store);
    let sentSeen = false;
    let failedOnce = false;
    store.revokeDownloadTokens = async () => {
      throw new Error('SQLITE_BUSY');
    };
    store.updateOrder = async (id, fn) => {
      // 메일이 나간 뒤 첫 "보냄" 기록만 한 번 실패시킨다
      if (email.outbox.length > 0 && !failedOnce) {
        failedOnce = true;
        throw new Error('SQLITE_BUSY');
      }
      return realUpdate(id, fn);
    };
    expect(await sendDownloadEmail(deps, o.orderId, 'initial')).toBe(true);
    store.revokeDownloadTokens = realRevoke;
    store.updateOrder = realUpdate;
    sentSeen = deliveryOf((await store.getOrder(o.orderId))!).email.status === 'sent';
    expect(sentSeen).toBe(true);
    expect(await resumeEmailDeliveries(deps)).toBe(0);
    expect(email.outbox).toHaveLength(1);
  });
});
