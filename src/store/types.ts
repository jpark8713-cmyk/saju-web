// 저장소 인터페이스. Phase 3은 메모리 구현만 두고, DB 종류는 Phase 4에서 NCP 구성과 함께 정한다(D-025).
// 주문 기록에는 생년월일시·이름을 넣지 않는다(SPEC 1장). 출생 정보는 생성이 끝날 때까지만 `pendingBirth`에 임시로 둔다.
import type { PriceBreakdown } from '../config/prices';
import type { Evidence, SajuChart, SajuInput } from '../engine/types';
import type { ReportBody } from '../llm/types';

export type OrderStatus = 'created' | 'paid' | 'generating' | 'done' | 'failed' | 'refunded';
export type DeliveryMethod = 'pdf' | 'email';

export interface Order {
  /** 주문번호 (소비자에게 보여 준다) */
  id: string;
  /** 주문 소유 확인용 토큰의 SHA-256 해시. 원문은 저장하지 않는다 */
  accessTokenHash: string;
  status: OrderStatus;
  amount: number;
  breakdown: PriceBreakdown;
  topicIds: string[];
  deliveryMethods: DeliveryMethod[];
  /** 이메일 받기를 골랐을 때만 */
  email: string | null;
  paymentMethod: string;
  /** "올해"로 볼 연도 (주문 시점에 고정) */
  referenceYear: number;
  createdAt: string;
  paidAt: string | null;
  /** 생성이 끝나면(성공) 지운다. 실패하면 재시도 동안만 남긴다 */
  pendingBirth: { input: SajuInput; name: string | null; label: string } | null;
  generation: {
    runs: number;
    startedAt: string | null;
    finishedAt: string | null;
    /** 실패 이유 코드 (사용자 입력·문장 원문 없음) */
    lastFailure: 'validation' | 'moderationUnavailable' | 'interrupted' | null;
  };
  /** 개발 전용: 가짜 결제에서 "생성 실패"를 고른 주문 (운영에서는 항상 false) */
  devForceGenerationFailure: boolean;
}

export interface Report {
  orderId: string;
  /** 표지에만 쓴다. 리포트와 함께 삭제된다 */
  name: string | null;
  /** 표지의 생년월일시 표기. 리포트와 함께 삭제된다 */
  birthLabel: string;
  chart: SajuChart;
  evidence: Evidence[];
  body: ReportBody;
  createdAt: string;
}

export interface RefundRequest {
  /** 접수번호 */
  id: string;
  orderId: string;
  reason: 'not_generated' | 'duplicate' | 'changed_mind' | 'other';
  detail: string | null;
  /** 처리 결과 안내용. 처리 완료 후 삭제한다(Phase 4) */
  email: string | null;
  status: 'received' | 'approved' | 'rejected' | 'refunded';
  createdAt: string;
}

export interface Store {
  createOrder(order: Order): Promise<void>;
  getOrder(id: string): Promise<Order | null>;
  /** 갱신 함수를 받아 새 객체로 바꿔 넣는다(원본을 고치지 않는다) */
  updateOrder(id: string, update: (o: Order) => Order): Promise<Order | null>;
  saveReport(report: Report): Promise<void>;
  getReport(orderId: string): Promise<Report | null>;
  findRefundByOrder(orderId: string): Promise<RefundRequest | null>;
  createRefund(refund: RefundRequest): Promise<void>;
}
