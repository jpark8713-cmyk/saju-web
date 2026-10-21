// 리포트 조회 (GET /api/reports/:orderId, 인쇄용 페이지). 주문 소유를 확인한 뒤, 생성이 끝난 주문만 보여 준다.
// 보관 기간이 지나 지운 리포트는 ReportExpired(410)다. 인쇄 페이지는 서버의 내부 토큰으로도 열 수 있다(D-033).
import { renderTokenMatches } from '../delivery/deliver';
import { deliveryOf } from '../delivery/state';
import { buildReportView, type ReportView } from '../report/view';
import type { Order, Store } from '../store/types';
import { AccessDenied, authorizedOrder } from './access';
import { ORDER_ID_RE } from './ids';

export class ReportNotReady extends Error {
  constructor() {
    super('리포트가 아직 준비되지 않았습니다');
    this.name = 'ReportNotReady';
  }
}

export class ReportExpired extends Error {
  constructor() {
    super('보관 기간이 지나 리포트를 삭제했습니다');
    this.name = 'ReportExpired';
  }
}

async function viewOf(store: Store, order: Order): Promise<ReportView> {
  const d = deliveryOf(order);
  // 정리 전이라도 보관 기간이 지났으면 보여 주지 않는다(이메일 링크와 같은 기준, D-034)
  if (d.purgedAt || (d.expiresAt && Date.parse(d.expiresAt) <= Date.now())) throw new ReportExpired();
  const report = order.status === 'done' ? await store.getReport(order.id) : null;
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

export async function reportViewFor(store: Store, orderId: string, token: string | null): Promise<ReportView> {
  return viewOf(store, await authorizedOrder(store, orderId, token));
}

/** 인쇄 페이지용: 고객 토큰 또는 서버가 PDF를 만들 때 쓰는 내부 토큰 */
export async function reportViewForPrint(store: Store, orderId: string, orderToken: string | null, renderToken: string | null): Promise<ReportView> {
  if (orderToken) return reportViewFor(store, orderId, orderToken);
  if (!ORDER_ID_RE.test(orderId)) throw new AccessDenied();
  const order = await store.getOrder(orderId);
  if (!order || !renderTokenMatches(order, renderToken)) throw new AccessDenied();
  return viewOf(store, order);
}
