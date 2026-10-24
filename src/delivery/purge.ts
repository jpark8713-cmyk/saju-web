// 보관 기간 정리 (SPEC 1장 보관 정책, D-033·D-034·D-035). 매시간 백업 타이머가 백업보다 먼저 부른다(npm run db:purge).
// - 완성된 주문: 완성일부터 30일이 지나면 PDF·리포트·이메일 주소·생성 전 출생 정보를 지우고 링크를 무효로 한다.
// - 완성되지 않은 주문(결제 전·생성 실패 등): 주문을 만든 날부터 30일이 지나면 이메일 주소를 지운다.
//   출생 정보는 결제한 날(결제 전이면 주문일)부터 30일이 지나면 지운다(사업자 승인 2026-10-23). 그 뒤에는 다시 생성할 수 없다.
// 주문 기록(번호·금액·결제 승인·상태)과 발급 기록은 남긴다. 지운 뒤에도 Object Storage 백업에는 최대 7일 남는다(TODO(owner): 처리방침).
//
// 정리 대상은 "정리됨" 표시와 관계없이 보관 기간이 지났는데 무엇이든 남은 주문이다(D-035).
// "정리됨" 표시는 모두 지운 뒤에만 남긴다. 도중에 실패하거나 서버가 멈춰도 다음 정리가 남은 것을 다시 잡는다.
// 정리하는 사이 PDF가 다시 저장되는 것은 PDF 쪽의 "보관 기간이 지났는지" 확인(저장 전·후)이 막는다.
// 한 주문이 실패해도 나머지 주문과 미완성 주문 이메일 정리는 계속한다.
import { STALE_PDF_PART_MS, UNFINISHED_ORDER_EMAIL_RETENTION_DAYS } from '../config/delivery';
import { UNCERTAIN_PAYMENT_ALERT_MS, UNCERTAIN_PAYMENT_BIRTH_MAX_DAYS, UNFINISHED_ORDER_BIRTH_RETENTION_DAYS } from '../config/generation';
import type { Order, Store } from '../store/types';
import type { PdfStore } from './pdfStore';
import { deliveryOf, withDelivery } from './state';

export interface PurgeResult {
  orders: number;
  pdfs: number;
  /** 쓰다 멈춘 PDF 임시 파일을 지운 건수 */
  partFiles: number;
  tokens: number;
  /** 완성되지 않은 주문에서 이메일 주소를 지운 건수 */
  unfinishedEmails: number;
  /** 완성되지 않은 주문에서 출생 정보를 지운 건수 */
  unfinishedBirths: number;
  /** 승인 여부를 모르는 결제가 하루 넘게 남은 주문 수(운영자 확인 필요, D-054) */
  uncertainPayments: number;
  /** 도중에 실패해 다음 정리 때 다시 시도할 건수 */
  failed: number;
}

const isExpired = (o: Order | null, now: Date) => {
  const at = o ? deliveryOf(o).expiresAt : null;
  return !!at && Date.parse(at) <= now.getTime();
};

/** 승인 여부를 모르는 결제가 처음 생긴 시각(ms). 예전 기록(lastError만 있음)은 결제 시각·주문 시각으로 본다 */
function uncertainSince(o: Order): number {
  return Date.parse(o.payment.uncertain?.since ?? o.paidAt ?? o.createdAt);
}

/** 출생 정보 정리를 미루는 주문: 승인 여부를 모르는 결제가 있고, 그 상태가 된 지 상한(60일)이 안 됨 */
function uncertainHold(o: Order, now: Date): boolean {
  const uncertain = !!o.payment.uncertain?.paymentKeys.length || o.payment.lastError === 'PG_UNREACHABLE';
  return uncertain && uncertainSince(o) > now.getTime() - UNCERTAIN_PAYMENT_BIRTH_MAX_DAYS * 86_400_000;
}

async function purgeOne(store: Store, pdfs: PdfStore, o: Order, now: Date, result: PurgeResult): Promise<void> {
  if (pdfs.delete(o.id)) result.pdfs += 1;
  await store.deleteReport(o.id);
  result.tokens += await store.revokeDownloadTokens(o.id, now.toISOString());
  await store.updateOrder(o.id, (x) =>
    withDelivery({ ...x, email: null, pendingBirth: null }, (d) => ({
      ...d,
      renderTokens: [],
      pdf: { ...d.pdf, stored: false },
      // 모두 지운 뒤에만 표시한다(이미 표시돼 있으면 그 시각을 둔다)
      purgedAt: d.purgedAt ?? now.toISOString(),
    })),
  );
  result.orders += 1;
}

export async function purgeExpired(store: Store, pdfs: PdfStore, now = new Date()): Promise<PurgeResult> {
  const result: PurgeResult = { orders: 0, pdfs: 0, partFiles: 0, tokens: 0, unfinishedEmails: 0, unfinishedBirths: 0, uncertainPayments: 0, failed: 0 };

  for (const o of await store.listOrdersToPurge(now)) {
    try {
      await purgeOne(store, pdfs, o, now, result);
    } catch {
      result.failed += 1;
    }
  }

  // PDF 폴더도 따로 훑는다: 보관 기간이 지났거나 없는 주문의 PDF가 남아 있으면 지운다(표시 뒤에 남은 파일까지)
  for (const id of pdfs.list()) {
    try {
      const o = await store.getOrder(id);
      if ((!o || isExpired(o, now)) && pdfs.delete(id)) result.pdfs += 1;
    } catch {
      result.failed += 1;
    }
  }

  // 서버가 PDF를 쓰다 멈춰 남은 임시 파일도 지운다(쓰는 중인 파일은 건드리지 않게 한 시간 지난 것만, D-036)
  try {
    result.partFiles = pdfs.deleteStaleParts(new Date(now.getTime() - STALE_PDF_PART_MS));
  } catch {
    result.failed += 1;
  }

  const cutoff = new Date(now.getTime() - UNFINISHED_ORDER_EMAIL_RETENTION_DAYS * 86_400_000);
  let unfinished: Order[] = [];
  try {
    unfinished = await store.listUnfinishedOrdersWithEmail(cutoff);
  } catch {
    result.failed += 1;
  }
  for (const o of unfinished) {
    try {
      const updated = await store.updateOrder(o.id, (x) => (x.status !== 'done' && x.email ? { ...x, email: null } : x));
      if (updated && updated.email === null) result.unfinishedEmails += 1;
    } catch {
      result.failed += 1;
    }
  }

  // 완성되지 않은 주문의 출생 정보: 결제(없으면 주문)부터 보관 기간이 지나면 지운다. 생성 중인 주문은 건드리지 않는다
  const birthCutoff = new Date(now.getTime() - UNFINISHED_ORDER_BIRTH_RETENTION_DAYS * 86_400_000);
  let withBirth: Order[] = [];
  try {
    withBirth = await store.listUnfinishedOrdersWithBirth(birthCutoff);
  } catch {
    result.failed += 1;
  }
  for (const o of withBirth) {
    try {
      const updated = await store.updateOrder(o.id, (x) =>
        // 생성 중, 결제 승인 중인 주문은 건드리지 않는다. 승인 여부를 모르는 결제가 있는 주문은 운영자 확인을 기다리되 상한(60일)이 지나면 지운다
        x.status !== 'done' && x.status !== 'generating' && x.payment.stage !== 'confirming' && !uncertainHold(x, now) && x.pendingBirth
          ? { ...x, pendingBirth: null }
          : x,
      );
      if (updated && updated.pendingBirth === null) result.unfinishedBirths += 1;
    } catch {
      result.failed += 1;
    }
  }

  // 승인 여부를 모르는 결제가 하루 넘게 남은 주문: 운영자가 PG에서 확인하도록 정리 때마다 로그(주문번호만)
  try {
    const stale = (await store.listOrdersWithUncertainPayment()).filter((o) => uncertainSince(o) <= now.getTime() - UNCERTAIN_PAYMENT_ALERT_MS);
    result.uncertainPayments = stale.length;
    if (stale.length) console.warn(`[결제 확인 필요] 승인 여부를 모르는 결제 ${stale.length}건(24시간 넘음): ${stale.map((o) => o.id).join(', ')}`);
  } catch {
    result.failed += 1;
  }
  return result;
}
