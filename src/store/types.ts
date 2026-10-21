// 저장소 인터페이스. Phase 3·4는 메모리 구현만 두고, DB 종류는 NCP 구성과 함께 정해 마지막 단계에서 연결한다(D-025, D-028).
// 주문 기록에는 생년월일시·이름을 넣지 않는다(SPEC 1장). 출생 정보는 생성이 끝날 때까지만 `pendingBirth`에 임시로 둔다.
import type { PriceBreakdown } from '../config/prices';
import type { Evidence, SajuChart, SajuInput } from '../engine/types';
import type { ReportBody } from '../llm/types';

export type OrderStatus = 'created' | 'paid' | 'generating' | 'done' | 'failed' | 'refunded';
export type DeliveryMethod = 'pdf' | 'email';

/** 결제 진행 상태. 주문 상태(status)와 따로 둔다: 승인 요청 중복을 막는 잠금과 PG 승인 정보를 담는다 */
export interface PaymentState {
  /** 결제 어댑터 id (예: mock) */
  provider: string | null;
  /** PG가 발급한 결제 키. 결제창을 열 때마다 새로 받는다 */
  paymentKey: string | null;
  stage: 'none' | 'ready' | 'confirming' | 'approved' | 'cancelled';
  /** 승인 요청을 시작한 시각(잠금). 오래되면 같은 결제 키로 다시 승인을 요청할 수 있다 */
  confirmingAt: string | null;
  /** PG 승인 번호 */
  transactionId: string | null;
  approvedAmount: number | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  /** 마지막 승인 실패 이유 코드 (사용자 입력 없음) */
  lastError: string | null;
}

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
  payment: PaymentState;
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
  /** 개발 전용: 목 결제창에서 "생성 실패"를 고른 주문 (운영에서는 항상 false) */
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

export type RefundStatus = 'received' | 'approved' | 'rejected' | 'refunded';

export interface RefundRequest {
  /** 접수번호 (HMAC으로 정해진다, D-028) */
  id: string;
  orderId: string;
  reason: 'not_generated' | 'duplicate' | 'changed_mind' | 'other';
  detail: string | null;
  /** 처리 결과를 회신할 이메일. 이 환불 건에만 저장하고 처리가 끝나면 지운다 */
  email: string | null;
  /** 접수 때 본인 확인 방법 */
  verifiedBy: 'orderEmail' | 'device';
  status: RefundStatus;
  createdAt: string;
  /** 운영자 처리 기록 (관리 스크립트) */
  processedAt: string | null;
  result: { outcome: 'refunded' | 'rejected'; note: string | null; cancelledAmount: number | null } | null;
}

export type IssuanceEventType = 'pdf_download' | 'email_sent';

/**
 * 발급 기록. 리포트가 만들어진 사실을 증명한다(결제 승인·생성 완료·내용 해시).
 * 한 번 만들면 고칠 수도 지울 수도 없고, 다운로드·발송 사건만 덧붙일 수 있다.
 * 생년월일시·이름·이메일 원문은 넣지 않는다.
 */
export interface IssuanceRecord {
  orderId: string;
  payment: {
    provider: string;
    method: string;
    transactionId: string;
    approvedAmount: number;
    approvedAt: string;
  };
  generatedAt: string;
  /** 리포트 내용(차트·근거·본문·주제)의 SHA-256. 표지 이름·생년월일 표기는 넣지 않는다 */
  contentHash: string;
  topicIds: string[];
  events: { type: IssuanceEventType; at: string }[];
}

export class IssuanceImmutable extends Error {
  constructor() {
    super('발급 기록은 고치거나 지울 수 없습니다');
    this.name = 'IssuanceImmutable';
  }
}

export interface Store {
  createOrder(order: Order): Promise<void>;
  getOrder(id: string): Promise<Order | null>;
  /** 갱신 함수를 받아 새 객체로 바꿔 넣는다(원본을 고치지 않는다). 갱신 함수 안의 확인과 저장은 한 번에 일어난다 */
  updateOrder(id: string, update: (o: Order) => Order): Promise<Order | null>;
  /** 상태로 주문 찾기 (멈춘 생성 복구용) */
  listOrdersByStatus(status: Order['status']): Promise<Order[]>;
  saveReport(report: Report): Promise<void>;
  getReport(orderId: string): Promise<Report | null>;
  findRefundByOrder(orderId: string): Promise<RefundRequest | null>;
  getRefund(id: string): Promise<RefundRequest | null>;
  listRefunds(status?: RefundStatus): Promise<RefundRequest[]>;
  /** 같은 주문의 접수가 없을 때만 저장하고, 있으면 그것을 돌려준다(확인과 저장이 한 번에 일어난다) */
  createRefundIfAbsent(refund: RefundRequest): Promise<RefundRequest>;
  updateRefund(id: string, update: (r: RefundRequest) => RefundRequest): Promise<RefundRequest | null>;
  /** 이미 있으면 IssuanceImmutable */
  createIssuance(record: IssuanceRecord): Promise<void>;
  getIssuance(orderId: string): Promise<IssuanceRecord | null>;
  /** 사건만 덧붙인다. 기록이 없으면 false */
  appendIssuanceEvent(orderId: string, event: { type: IssuanceEventType; at: string }): Promise<boolean>;
}
