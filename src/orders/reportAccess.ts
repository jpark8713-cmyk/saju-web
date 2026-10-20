// 리포트 조회 (GET /api/reports/:orderId, 인쇄용 페이지). 주문 소유를 확인한 뒤, 생성이 끝난 주문만 보여 준다.
import { buildReportView, type ReportView } from '../report/view';
import type { Store } from '../store/types';
import { authorizedOrder } from './access';

export class ReportNotReady extends Error {
  constructor() {
    super('리포트가 아직 준비되지 않았습니다');
    this.name = 'ReportNotReady';
  }
}

export async function reportViewFor(store: Store, orderId: string, token: string | null): Promise<ReportView> {
  const order = await authorizedOrder(store, orderId, token);
  const report = order.status === 'done' ? await store.getReport(orderId) : null;
  if (!report) throw new ReportNotReady();
  return buildReportView({
    chart: report.chart,
    evidence: report.evidence,
    body: report.body,
    topicIds: order.topicIds,
    name: report.name,
    birthLabel: report.birthLabel,
  });
}
