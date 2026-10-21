// 결과물 전달 (SPEC Phase 5, D-033). 리포트가 완성되면(done) 받는 방법대로 처리한다.
// - PDF: 서버가 PDF를 만들어 데이터 폴더에 저장한다(이메일만 골라도 링크가 가리킬 PDF가 필요해 만든다).
// - 이메일: 다운로드 토큰(원문은 저장하지 않고 해시만)을 만들고 링크를 메일로 보낸다. 실패하면 간격을 늘려 최대 3번 시도하고
//   발송 기록(DeliveryLog)을 남긴다. 최종 실패해도 화면에서 PDF를 받을 수 있다.
// - 선택하지 않은 방법은 실행하지 않는다. 주문 1건당 처음 메일은 1통만 보낸다(중복 요청에도).
// 로그·발송 기록에는 받는 사람 주소·링크·토큰을 남기지 않는다.
import { DOWNLOAD_LINK_TTL_MS, EMAIL_MAX_ATTEMPTS, EMAIL_RETRY_DELAYS_MS, RENDER_TOKEN_TTL_MS } from '../config/delivery';
import { hashToken, newAccessToken, tokenMatches } from '../orders/ids';
import { recordIssuanceEvent } from '../orders/issuance';
import type { DeliveryLog, Order, Store } from '../store/types';
import type { EmailProvider } from './email';
import { downloadEmail } from './messages';
import type { PdfStore } from './pdfStore';
import { deliveryOf, withDelivery } from './state';

export const RENDER_TOKEN_HEADER = 'x-render-token';

export interface DeliveryDeps {
  store: Store;
  pdfs: PdfStore;
  /** 인쇄 페이지를 열어 PDF를 만든다(src/report/pdf.ts). 토큰은 x-render-token 헤더로 넘긴다 */
  renderPdf: (origin: string, orderId: string, renderToken: string) => Promise<Buffer>;
  email: EmailProvider | null;
  /** 서비스 주소(APP_ORIGIN) */
  origin: () => string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  retryDelays?: readonly number[];
}

const nowOf = (d: DeliveryDeps) => (d.now ? d.now() : new Date());
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function wantsPdfFile(o: Order): boolean {
  return o.deliveryMethods.includes('pdf') || o.deliveryMethods.includes('email');
}

/** 완성 시각 + 보관 기간 */
export function expiryFrom(finishedAt: string): string {
  return new Date(Date.parse(finishedAt) + DOWNLOAD_LINK_TTL_MS).toISOString();
}

/** 보관 기간 안이고 아직 지우지 않은 완성 주문인지 */
export function isDeliverable(o: Order, now: Date): boolean {
  const d = deliveryOf(o);
  return o.status === 'done' && !d.purgedAt && !!d.expiresAt && Date.parse(d.expiresAt) > now.getTime();
}

/** 인쇄 페이지에 온 내부 토큰이 이 주문의 것이고 아직 유효한지 */
export function renderTokenMatches(o: Order, token: string | null, now = new Date()): boolean {
  const t = deliveryOf(o).renderToken;
  return !!t && Date.parse(t.expiresAt) > now.getTime() && tokenMatches(token, t.hash);
}

// 같은 주문의 PDF를 동시에 두 번 만들지 않는다(서버 한 대 기준)
const inflight = new Map<string, Promise<Buffer>>();

/** 저장된 PDF를 돌려준다. 없으면 만들어 저장한다 */
export async function ensureStoredPdf(deps: DeliveryDeps, orderId: string): Promise<Buffer> {
  const saved = deps.pdfs.read(orderId);
  if (saved) return saved;
  const running = inflight.get(orderId);
  if (running) return running;
  const job = (async () => {
    const raw = newAccessToken();
    const issued = nowOf(deps);
    await deps.store.updateOrder(orderId, (o) =>
      withDelivery(o, (d) => ({ ...d, renderToken: { hash: hashToken(raw), expiresAt: new Date(issued.getTime() + RENDER_TOKEN_TTL_MS).toISOString() } })),
    );
    try {
      const pdf = await deps.renderPdf(deps.origin(), orderId, raw);
      const sha256 = deps.pdfs.write(orderId, pdf);
      await deps.store.updateOrder(orderId, (o) =>
        withDelivery(o, (d) => ({ ...d, renderToken: null, pdf: { stored: true, sha256, createdAt: nowOf(deps).toISOString(), lastError: null } })),
      );
      return pdf;
    } catch (e) {
      await deps.store.updateOrder(orderId, (o) => withDelivery(o, (d) => ({ ...d, renderToken: null, pdf: { ...d.pdf, lastError: 'RENDER_FAILED' } })));
      throw e;
    }
  })();
  inflight.set(orderId, job);
  try {
    return await job;
  } finally {
    inflight.delete(orderId);
  }
}

/** 새 다운로드 토큰. 이 주문의 이전 토큰은 무효로 한다. 원문은 돌려주기만 하고 저장하지 않는다 */
export async function issueDownloadToken(store: Store, order: Order, now: Date): Promise<string> {
  const expiresAt = deliveryOf(order).expiresAt;
  if (!expiresAt) throw new Error('보관 기간이 정해지지 않은 주문입니다');
  await store.revokeDownloadTokens(order.id, now.toISOString());
  const raw = newAccessToken();
  await store.createDownloadToken({ tokenHash: hashToken(raw), orderId: order.id, createdAt: now.toISOString(), expiresAt, revokedAt: null });
  return raw;
}

async function log(store: Store, entry: DeliveryLog): Promise<void> {
  await store.appendDeliveryLog(entry);
}

/**
 * 다운로드 링크 메일을 보낸다(최대 EMAIL_MAX_ATTEMPTS번, 간격을 늘려 재시도). 성공하면 true.
 * reason=initial은 주문당 한 번만(email.status가 none일 때만) 보낸다. resend는 보내는 중이 아니면 보낸다.
 */
export async function sendDownloadEmail(deps: DeliveryDeps, orderId: string, reason: DeliveryLog['reason']): Promise<boolean> {
  const claim = { ok: false };
  const order = await deps.store.updateOrder(orderId, (o) => {
    const d = deliveryOf(o);
    const allowed = reason === 'initial' ? d.email.status === 'none' : d.email.status !== 'sending';
    if (!allowed || !o.deliveryMethods.includes('email') || !o.email || !isDeliverable(o, nowOf(deps))) return o;
    claim.ok = true;
    return withDelivery(o, (x) => ({ ...x, email: { ...x.email, status: 'sending' } }));
  });
  if (!claim.ok || !order?.email) return false;

  const raw = await issueDownloadToken(deps.store, order, nowOf(deps));
  const msg = downloadEmail({ orderId, link: `${deps.origin()}/api/download/${raw}`, expiresAt: deliveryOf(order).expiresAt! });
  const delays = deps.retryDelays ?? EMAIL_RETRY_DELAYS_MS;
  const sleep = deps.sleep ?? defaultSleep;
  let lastCode: string | null = null;
  for (let attempt = 1; attempt <= EMAIL_MAX_ATTEMPTS; attempt++) {
    let result;
    try {
      result = deps.email ? await deps.email.send({ to: order.email, orderId, ...msg }) : { ok: false as const, code: 'NO_PROVIDER' };
    } catch {
      result = { ok: false as const, code: 'SEND_ERROR' };
    }
    const at = nowOf(deps).toISOString();
    await log(deps.store, { orderId, channel: 'email', reason, attempt, outcome: result.ok ? 'sent' : 'failed', code: result.ok ? null : result.code, at });
    if (result.ok) {
      await deps.store.updateOrder(orderId, (o) => withDelivery(o, (d) => ({ ...d, email: { status: 'sent', attempts: d.email.attempts + attempt, sentAt: at, lastError: null } })));
      await recordIssuanceEvent(deps.store, orderId, 'email_sent', new Date(at));
      return true;
    }
    lastCode = result.code;
    if (attempt < EMAIL_MAX_ATTEMPTS) await sleep(delays[attempt - 1] ?? delays.at(-1) ?? 0);
  }
  await deps.store.updateOrder(orderId, (o) =>
    withDelivery(o, (d) => ({ ...d, email: { ...d.email, status: 'failed', attempts: d.email.attempts + EMAIL_MAX_ATTEMPTS, lastError: lastCode } })),
  );
  return false;
}

/** 리포트가 완성되면 부른다. 선택한 방법만 실행하고, 실패해도 던지지 않는다(실패 코드는 주문·발송 기록에 남는다) */
export async function deliverOnDone(deps: DeliveryDeps, orderId: string): Promise<void> {
  const order = await deps.store.getOrder(orderId);
  if (!order || !isDeliverable(order, nowOf(deps))) return;
  const jobs: Promise<unknown>[] = [];
  if (wantsPdfFile(order)) jobs.push(ensureStoredPdf(deps, orderId));
  if (order.deliveryMethods.includes('email')) jobs.push(sendDownloadEmail(deps, orderId, 'initial'));
  await Promise.allSettled(jobs);
}

/** 서버가 메일을 보내는 도중에 멈췄던 주문을 이어서 보낸다(서버 시작 때) */
export async function resumeEmailDeliveries(deps: DeliveryDeps): Promise<number> {
  const stuck = await deps.store.listOrdersWithEmailStatus('sending');
  for (const o of stuck) {
    await deps.store.updateOrder(o.id, (x) => withDelivery(x, (d) => ({ ...d, email: { ...d.email, status: 'none' } })));
    void sendDownloadEmail(deps, o.id, 'initial');
  }
  return stuck.length;
}

/** 이메일 링크로 PDF 받기. 토큰이 없거나·무효·만료이거나 주문이 보관 기간을 넘었으면 null */
export async function pdfForDownloadToken(deps: DeliveryDeps, rawToken: string): Promise<{ orderId: string; pdf: Buffer } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(rawToken)) return null;
  const now = nowOf(deps);
  const t = await deps.store.findDownloadToken(hashToken(rawToken));
  if (!t || t.revokedAt || Date.parse(t.expiresAt) <= now.getTime()) return null;
  const order = await deps.store.getOrder(t.orderId);
  if (!order || !isDeliverable(order, now)) return null;
  const pdf = await ensureStoredPdf(deps, order.id);
  await recordIssuanceEvent(deps.store, order.id, 'pdf_download', now);
  return { orderId: order.id, pdf };
}
