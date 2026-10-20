// 메모리 저장소. 서버를 다시 켜면 비워진다(개발·테스트용, Phase 4에서 DB 구현으로 바꾼다).
// 개발 서버가 모듈을 다시 불러와도 같은 저장소를 쓰도록 globalThis에 한 번만 만든다.
import type { Order, RefundRequest, Report, Store } from './types';

export class MemoryStore implements Store {
  private readonly orders = new Map<string, Order>();
  private readonly reports = new Map<string, Report>();
  private readonly refunds = new Map<string, RefundRequest>();

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

  async createRefund(refund: RefundRequest): Promise<void> {
    this.refunds.set(refund.id, structuredClone(refund));
  }
}

const KEY = Symbol.for('saju.store');
type WithStore = typeof globalThis & { [KEY]?: Store };

/** 앱 전체가 쓰는 저장소 (Phase 4에서 DB 구현을 고르는 자리) */
export function getStore(): Store {
  const g = globalThis as WithStore;
  g[KEY] ??= new MemoryStore();
  return g[KEY];
}
