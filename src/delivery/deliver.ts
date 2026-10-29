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
  /** 서비스 주소(APP_ORIGIN). 메일의 다운로드 링크에 쓴다 */
  origin: () => string;
  /** PDF 생성기가 여는 주소(같은 서버 안, D-059). 없으면 origin() */
  renderOrigin?: () => string;
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
  return deliveryOf(o).renderTokens.some((t) => Date.parse(t.expiresAt) > now.getTime() && tokenMatches(token, t.hash));
}

class PdfExpired extends Error {
  constructor() {
    super('보관 기간이 지나 PDF를 만들지 않습니다');
    this.name = 'PdfExpired';
  }
}

// 같은 주문의 PDF를 동시에 두 번 만들지 않는다. 개발 서버가 모듈을 다시 불러와도 같은 표를 쓰도록 globalThis에 둔다(D-034)
const INFLIGHT = Symbol.for('saju.pdfInflight');
type WithInflight = typeof globalThis & { [INFLIGHT]?: Map<string, Promise<Buffer>> };
const inflight = () => ((globalThis as WithInflight)[INFLIGHT] ??= new Map());

/** 보관 기간이 지났거나 정리된 주문이면 PDF를 만들거나 남기지 않는다 */
async function stillKeepable(store: Store, orderId: string, now: Date): Promise<boolean> {
  const o = await store.getOrder(orderId);
  const d = o ? deliveryOf(o) : null;
  return !!o && !!d && !d.purgedAt && (!d.expiresAt || Date.parse(d.expiresAt) > now.getTime());
}

/** 테스트에서 동시 생성을 재현할 때만 직접 부른다(보통은 ensureStoredPdf) */
export async function renderAndStore(deps: DeliveryDeps, orderId: string): Promise<Buffer> {
  const raw = newAccessToken();
  const mine = hashToken(raw);
  const issued = nowOf(deps);
  // 이 생성만 쓰는 토큰을 더한다. 다른 생성의 토큰은 건드리지 않는다
  await deps.store.updateOrder(orderId, (o) =>
    withDelivery(o, (d) => ({
      ...d,
      renderTokens: [...d.renderTokens.filter((t) => Date.parse(t.expiresAt) > issued.getTime()), { hash: mine, expiresAt: new Date(issued.getTime() + RENDER_TOKEN_TTL_MS).toISOString() }],
    })),
  );
  const dropMine = (patch: (d: ReturnType<typeof deliveryOf>) => ReturnType<typeof deliveryOf>) =>
    deps.store.updateOrder(orderId, (o) => withDelivery(o, (d) => patch({ ...d, renderTokens: d.renderTokens.filter((t) => t.hash !== mine) })));
  try {
    const pdf = await deps.renderPdf((deps.renderOrigin ?? deps.origin)(), orderId, raw);
    // 만드는 사이에 보관 기간 정리가 돌았으면 저장하지 않는다(정리 뒤에 PDF가 남지 않게)
    if (!(await stillKeepable(deps.store, orderId, nowOf(deps)))) throw new PdfExpired();
    const sha256 = deps.pdfs.write(orderId, pdf);
    // 저장 직후에도 한 번 더 본다: 그 사이 정리됐으면 방금 쓴 파일을 지운다
    if (!(await stillKeepable(deps.store, orderId, nowOf(deps)))) {
      deps.pdfs.delete(orderId);
      throw new PdfExpired();
    }
    // 그 사이 정리됐으면 저장 표시를 남기지 않는다
    await dropMine((d) => (d.purgedAt ? d : { ...d, pdf: { stored: true, sha256, createdAt: nowOf(deps).toISOString(), lastError: null } }));
    return pdf;
  } catch (e) {
    await dropMine((d) => ({ ...d, pdf: { ...d.pdf, lastError: e instanceof PdfExpired ? 'EXPIRED' : 'RENDER_FAILED' } }));
    // 다른 생성이 먼저 저장했으면 그것을 쓴다
    const saved = e instanceof PdfExpired ? null : deps.pdfs.read(orderId);
    if (saved) return saved;
    throw e;
  }
}

/** 저장된 PDF를 돌려준다. 없으면 만들어 저장한다 */
export async function ensureStoredPdf(deps: DeliveryDeps, orderId: string): Promise<Buffer> {
  const saved = deps.pdfs.read(orderId);
  if (saved) return saved;
  const table = inflight();
  const running = table.get(orderId);
  if (running) return running;
  const job = renderAndStore(deps, orderId);
  table.set(orderId, job);
  try {
    return await job;
  } finally {
    if (table.get(orderId) === job) table.delete(orderId);
  }
}

/** 새 다운로드 토큰을 만든다. 이전 토큰은 여기서 무효로 하지 않는다(메일이 실제로 나간 뒤에 무효로 한다, D-034) */
export async function issueDownloadToken(store: Store, order: Order, now: Date): Promise<{ raw: string; hash: string }> {
  const expiresAt = deliveryOf(order).expiresAt;
  if (!expiresAt) throw new Error('보관 기간이 정해지지 않은 주문입니다');
  const raw = newAccessToken();
  const hash = hashToken(raw);
  await store.createDownloadToken({ tokenHash: hash, orderId: order.id, createdAt: now.toISOString(), expiresAt, revokedAt: null });
  return { raw, hash };
}

async function log(store: Store, entry: DeliveryLog): Promise<void> {
  await store.appendDeliveryLog(entry);
}

/** 저장소 쓰기를 짧은 간격으로 몇 번 다시 시도한다(SQLite 잠금 등 잠깐의 실패) */
async function retryStore<T>(work: () => Promise<T>, deps: DeliveryDeps, tries = 4): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  for (let i = 1; ; i++) {
    try {
      return await work();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(250 * i);
    }
  }
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

  const token = await issueDownloadToken(deps.store, order, nowOf(deps));
  const msg = downloadEmail({ orderId, link: `${deps.origin()}/api/download/${token.raw}`, expiresAt: deliveryOf(order).expiresAt! });
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
      // 메일은 이미 나갔다. 이후 저장이 잠깐 실패해도 "보내는 중"으로 남아 다음 서버 시작 때 같은 메일이 또 나가지 않게,
      // 이전 링크 무효화 실패는 넘기고(다음 재발송 때 다시 무효화된다) 상태 기록은 몇 번 다시 시도한다(D-035)
      await deps.store.revokeDownloadTokens(orderId, at, token.hash).catch(() => 0);
      await retryStore(() => deps.store.updateOrder(orderId, (o) => withDelivery(o, (d) => ({ ...d, email: { status: 'sent', attempts: d.email.attempts + attempt, sentAt: at, lastError: null } }))), deps);
      await recordIssuanceEvent(deps.store, orderId, 'email_sent', new Date(at)).catch(() => false);
      return true;
    }
    lastCode = result.code;
    if (attempt < EMAIL_MAX_ATTEMPTS) await sleep(delays[attempt - 1] ?? delays.at(-1) ?? 0);
  }
  // 보내지 못한 새 링크만 무효로 한다(이전 링크는 그대로 쓸 수 있다)
  await deps.store.revokeDownloadToken(token.hash, nowOf(deps).toISOString());
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

/**
 * 서버가 멈춰 처음 메일이 나가지 못한 주문을 이어서 보낸다(서버 시작 때, D-034).
 * - 보내는 도중(sending)에 멈춘 주문
 * - 완성(done) 직후, 보내기 시작 전에 멈춘 주문(이메일로 받기, 상태 none, 보관 기간 안)
 */
export async function resumeEmailDeliveries(deps: DeliveryDeps): Promise<number> {
  const now = nowOf(deps);
  const stuck = await deps.store.listOrdersWithEmailStatus('sending');
  const notStarted = (await deps.store.listOrdersWithEmailStatus('none')).filter((o) => o.deliveryMethods.includes('email') && !!o.email && isDeliverable(o, now));
  for (const o of stuck) await deps.store.updateOrder(o.id, (x) => withDelivery(x, (d) => ({ ...d, email: { ...d.email, status: 'none' } })));
  const targets = [...stuck, ...notStarted];
  for (const o of targets) {
    // 실패(저장소 오류 등)해도 서버가 죽지 않게 받아 둔다. 실패 코드는 주문·발송 기록에 남는다
    void sendDownloadEmail(deps, o.id, 'initial').catch(() => undefined);
  }
  return targets.length;
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
