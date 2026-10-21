// 보관 기간 정리 (SPEC 1장 보관 정책, D-033·D-034·D-035). 매시간 백업 타이머가 백업보다 먼저 부른다(npm run db:purge).
// - 완성된 주문: 완성일부터 30일이 지나면 PDF·리포트·이메일 주소·생성 전 출생 정보를 지우고 링크를 무효로 한다.
// - 완성되지 않은 주문(결제 전·생성 실패 등): 주문을 만든 날부터 30일이 지나면 이메일 주소를 지운다.
// 주문 기록(번호·금액·결제 승인·상태)과 발급 기록은 남긴다. 지운 뒤에도 Object Storage 백업에는 최대 7일 남는다(TODO(owner): 처리방침).
//
// 정리 대상은 "정리됨" 표시와 관계없이 보관 기간이 지났는데 무엇이든 남은 주문이다(D-035).
// "정리됨" 표시는 모두 지운 뒤에만 남긴다. 도중에 실패하거나 서버가 멈춰도 다음 정리가 남은 것을 다시 잡는다.
// 정리하는 사이 PDF가 다시 저장되는 것은 PDF 쪽의 "보관 기간이 지났는지" 확인(저장 전·후)이 막는다.
// 한 주문이 실패해도 나머지 주문과 미완성 주문 이메일 정리는 계속한다.
import { UNFINISHED_ORDER_EMAIL_RETENTION_DAYS } from '../config/delivery';
import type { Order, Store } from '../store/types';
import type { PdfStore } from './pdfStore';
import { deliveryOf, withDelivery } from './state';

export interface PurgeResult {
  orders: number;
  pdfs: number;
  tokens: number;
  /** 완성되지 않은 주문에서 이메일 주소를 지운 건수 */
  unfinishedEmails: number;
  /** 도중에 실패해 다음 정리 때 다시 시도할 건수 */
  failed: number;
}

const isExpired = (o: Order | null, now: Date) => {
  const at = o ? deliveryOf(o).expiresAt : null;
  return !!at && Date.parse(at) <= now.getTime();
};

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
  const result: PurgeResult = { orders: 0, pdfs: 0, tokens: 0, unfinishedEmails: 0, failed: 0 };

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
  return result;
}
