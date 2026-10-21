// 메모리 저장소. 서버를 다시 켜면 비워진다(개발·테스트 전용, 운영은 SQLite: src/store/sqlite.ts, D-030).
// 별도 프로세스(관리 스크립트)와는 데이터를 공유하지 않는다.
import {
  IssuanceImmutable,
  type IssuanceEventType,
  type IssuanceRecord,
  type Order,
  type RefundRequest,
  type RefundStatus,
  type Report,
  type Store,
} from './types';

export class MemoryStore implements Store {
  private readonly orders = new Map<string, Order>();
  private readonly reports = new Map<string, Report>();
  private readonly refunds = new Map<string, RefundRequest>();
  private readonly issuances = new Map<string, IssuanceRecord>();

  async createOrder(order: Order): Promise<void> {
    if (this.orders.has(order.id)) throw new Error('주문번호 중복');
    this.orders.set(order.id, structuredClone(order));
  }

  async getOrder(id: string): Promise<Order | null> {
    const o = this.orders.get(id);
    return o ? structuredClone(o) : null;
  }

  async updateOrder(id: string, update: (o: Order) => Order): Promise<Order | null> {
    const current = this.orders.get(id);
    if (!current) return null;
    const next = update(structuredClone(current));
    this.orders.set(id, structuredClone(next));
    return structuredClone(next);
  }

  async listOrdersByStatus(status: Order['status']): Promise<Order[]> {
    return [...this.orders.values()].filter((o) => o.status === status).map((o) => structuredClone(o));
  }

  async saveReport(report: Report): Promise<void> {
    this.reports.set(report.orderId, structuredClone(report));
  }

  async getReport(orderId: string): Promise<Report | null> {
    const r = this.reports.get(orderId);
    return r ? structuredClone(r) : null;
  }

  async findRefundByOrder(orderId: string): Promise<RefundRequest | null> {
    const r = [...this.refunds.values()].find((x) => x.orderId === orderId);
    return r ? structuredClone(r) : null;
  }

  async getRefund(id: string): Promise<RefundRequest | null> {
    const r = this.refunds.get(id);
    return r ? structuredClone(r) : null;
  }

  async listRefunds(status?: RefundStatus): Promise<RefundRequest[]> {
    return [...this.refunds.values()].filter((r) => !status || r.status === status).map((r) => structuredClone(r));
  }

  async createRefundIfAbsent(refund: RefundRequest): Promise<RefundRequest> {
    // await 없이 확인하고 저장하므로 동시에 온 요청 사이에 끼어들 틈이 없다
    const existing = [...this.refunds.values()].find((x) => x.orderId === refund.orderId);
    if (existing) return structuredClone(existing);
    if (this.refunds.has(refund.id)) throw new Error('접수번호 중복');
    this.refunds.set(refund.id, structuredClone(refund));
    return structuredClone(refund);
  }

  async updateRefund(id: string, update: (r: RefundRequest) => RefundRequest): Promise<RefundRequest | null> {
    const current = this.refunds.get(id);
    if (!current) return null;
    const next = update(structuredClone(current));
    this.refunds.set(id, structuredClone(next));
    return structuredClone(next);
  }

  async createIssuance(record: IssuanceRecord): Promise<void> {
    if (this.issuances.has(record.orderId)) throw new IssuanceImmutable();
    this.issuances.set(record.orderId, structuredClone(record));
  }

  async getIssuance(orderId: string): Promise<IssuanceRecord | null> {
    const r = this.issuances.get(orderId);
    return r ? structuredClone(r) : null;
  }

  async appendIssuanceEvent(orderId: string, event: { type: IssuanceEventType; at: string }): Promise<boolean> {
    const current = this.issuances.get(orderId);
    if (!current) return false;
    // 기존 필드는 그대로 두고 사건 목록 끝에만 붙인다
    this.issuances.set(orderId, { ...current, events: [...current.events, { type: event.type, at: event.at }] });
    return true;
  }
}
