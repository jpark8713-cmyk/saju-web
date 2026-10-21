// 발급 기록 (SPEC Phase 4). 리포트 생성이 끝나면 한 번 만들고, 이후에는 다운로드·발송 사건만 덧붙인다.
// 생년월일시·이름·이메일 원문은 넣지 않는다. 내용 해시에는 표지 이름·생년월일 표기를 넣지 않는다.
import { createHash } from 'node:crypto';
import type { IssuanceEventType, IssuanceRecord, Order, Report, Store } from '../store/types';

/** 리포트 내용 해시. 저장된 리포트로 다시 계산해 발급 당시 내용과 같은지 확인할 수 있다 */
export function reportContentHash(report: Pick<Report, 'chart' | 'evidence' | 'body'>, topicIds: readonly string[]): string {
  const canonical = JSON.stringify({ chart: report.chart, evidence: report.evidence, body: report.body, topicIds: [...topicIds] });
  return createHash('sha256').update(canonical).digest('hex');
}

export function buildIssuance(order: Order, report: Pick<Report, 'chart' | 'evidence' | 'body'>, generatedAt: string): IssuanceRecord {
  const p = order.payment;
  if (p.stage !== 'approved' || !p.provider || !p.transactionId || p.approvedAmount === null || !p.approvedAt) {
    throw new Error('결제 승인 정보가 없는 주문에는 발급 기록을 만들 수 없습니다');
  }
  return {
    orderId: order.id,
    payment: { provider: p.provider, method: order.paymentMethod, transactionId: p.transactionId, approvedAmount: p.approvedAmount, approvedAt: p.approvedAt },
    generatedAt,
    contentHash: reportContentHash(report, order.topicIds),
    topicIds: [...order.topicIds],
    events: [],
  };
}

export async function recordIssuanceEvent(store: Store, orderId: string, type: IssuanceEventType, now = new Date()): Promise<boolean> {
  return store.appendIssuanceEvent(orderId, { type, at: now.toISOString() });
}
