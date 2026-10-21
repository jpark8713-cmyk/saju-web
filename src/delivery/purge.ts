// 보관 기간이 지난 주문의 PDF·리포트·이메일 주소를 지운다 (SPEC 1장 보관 정책, D-033).
// 매시간 백업 타이머가 백업보다 먼저 부른다(npm run db:purge). 주문 기록(번호·금액·결제 승인·상태)과 발급 기록은 남긴다.
// 지운 뒤에도 Object Storage 백업에는 최대 7일 남는다(TODO(owner): 처리방침에 적기).
import type { Store } from '../store/types';
import type { PdfStore } from './pdfStore';
import { withDelivery } from './state';

export interface PurgeResult {
  orders: number;
  pdfs: number;
  tokens: number;
}

export async function purgeExpired(store: Store, pdfs: PdfStore, now = new Date()): Promise<PurgeResult> {
  const result: PurgeResult = { orders: 0, pdfs: 0, tokens: 0 };
  for (const o of await store.listOrdersToPurge(now)) {
    if (pdfs.delete(o.id)) result.pdfs += 1;
    await store.deleteReport(o.id);
    result.tokens += await store.revokeDownloadTokens(o.id, now.toISOString());
    await store.updateOrder(o.id, (x) =>
      withDelivery({ ...x, email: null, pendingBirth: null }, (d) => ({ ...d, renderToken: null, pdf: { ...d.pdf, stored: false }, purgedAt: now.toISOString() })),
    );
    result.orders += 1;
  }
  return result;
}
