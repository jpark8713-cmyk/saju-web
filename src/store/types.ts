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
  /**
   * 승인 여부를 모르는 결제(D-054): 승인 요청이 PG 연결 오류로 끝난 결제 키들과 처음 그렇게 된 시각.
   * 결제창을 다시 열거나 다른 오류가 나도 지우지 않는다. 그 결제 키가 실제로 승인되면 그 키만 뺀다(나머지는 운영자가 PG에서 확인).
   * 예전 주문 기록에는 없다
   */
  uncertain?: { since: string; paymentKeys: string[] } | null;
  /** 운영자가 승인 여부 모름 결제를 PG에서 확인한 기록(관리 명령 payments resolve, D-054) */
  uncertainChecks?: { paymentKey: string | null; result: 'not-approved' | 'approved-cancelled' | 'approved-kept'; at: string; note: string | null }[];
}

/** 결과물 전달 상태 (SPEC Phase 5, D-033) */
export interface DeliveryState {
  /** 리포트 완성 시각 + 보관 기간. 이 시각이 지나면 PDF·리포트·이메일 주소를 지운다 */
  expiresAt: string | null;
  pdf: {
    /** 데이터 폴더에 저장된 PDF가 있는지 */
    stored: boolean;
    sha256: string | null;
    createdAt: string | null;
    lastError: string | null;
  };
  email: {
    status: 'none' | 'sending' | 'sent' | 'failed';
    attempts: number;
    sentAt: string | null;
    lastError: string | null;
  };
  /**
   * 서버가 PDF를 만들 때만 쓰는 인쇄 페이지 토큰(해시). 몇 분 뒤 만료된다.
   * 만들 때마다 따로 하나씩 두고 끝나면 자기 것만 지운다(동시에 만들어도 서로 덮어쓰지 않게, D-034)
   */
  renderTokens: { hash: string; expiresAt: string }[];
  /** 보관 기간이 지나 PDF·리포트·이메일을 지운 시각 */
  purgedAt: string | null;
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
  /** 결과물 전달 (Phase 5 이전에 만든 주문에는 없을 수 있다: deliveryOf로 읽는다) */
  delivery?: DeliveryState;
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
    /** 생성 중 칸별 진행 상태(D-052, 대기 화면). 새 실행을 시작하면 지운다. 칸 이름과 상태만 담는다 */
    progress?: GenerationProgress[];
  };
  /** 개발 전용: 목 결제창에서 "생성 실패"를 고른 주문 (운영에서는 항상 false) */
  devForceGenerationFailure: boolean;
}

/** 칸 하나의 진행 상태(D-052): 대기 → 쓰는 중 → 확인 중(AI 검수) → 완료, 또는 사실 문장으로 채움 */
export interface GenerationProgress {
  /** 작업 이름: base, topic:<id>, monthly, decade, periods:child */
  label: string;
  /** 화면에 보이는 칸 이름 */
  name: string;
  state: 'waiting' | 'writing' | 'checking' | 'done' | 'templated';
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

/** 이메일 다운로드 링크 토큰. 원문은 저장하지 않고 SHA-256 해시만 저장한다(SPEC Phase 5) */
export interface DownloadToken {
  tokenHash: string;
  orderId: string;
  createdAt: string;
  expiresAt: string;
  /** 재발송으로 새 토큰을 주거나 보관 기간이 끝나면 무효로 한다 */
  revokedAt: string | null;
}

/** 발송 기록. 받는 사람 주소·링크는 넣지 않는다 */
export interface DeliveryLog {
  orderId: string;
  channel: 'email';
  reason: 'initial' | 'resend';
  attempt: number;
  outcome: 'sent' | 'failed';
  /** 실패 이유 코드 */
  code: string | null;
  at: string;
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
  /**
   * 리포트 저장과 주문 갱신(완성 표시·보관 기간)을 한 번에 한다. 갱신 함수가 null을 돌려주면 둘 다 하지 않는다.
   * 도중에 서버가 멈춰도 보관 기간 없는 리포트만 남는 일이 없다(D-036). 저장했으면 갱신된 주문, 아니면 null
   */
  saveReportWith(report: Report, update: (o: Order) => Order | null): Promise<Order | null>;
  getReport(orderId: string): Promise<Report | null>;
  /** 보관 기간이 지난 리포트를 지운다 */
  deleteReport(orderId: string): Promise<void>;
  /**
   * 정리할 주문: 보관 기간(delivery.expiresAt)이 지났는데 아직 지우지 않았거나(정리 표시 없음),
   * 정리 표시와 관계없이 리포트·이메일·출생 정보가 남은 주문(D-035). PDF 파일은 정리 쪽에서 폴더를 따로 훑는다.
   */
  listOrdersToPurge(now: Date): Promise<Order[]>;
  /** 전달을 마저 해야 하는 주문(이메일 발송이 도중에 멈춘 주문) */
  listOrdersWithEmailStatus(status: DeliveryState['email']['status']): Promise<Order[]>;
  createDownloadToken(token: DownloadToken): Promise<void>;
  findDownloadToken(tokenHash: string): Promise<DownloadToken | null>;
  /** 주문의 유효한 토큰을 모두 무효로 한다(exceptHash는 남긴다). 바꾼 개수 */
  revokeDownloadTokens(orderId: string, at: string, exceptHash?: string): Promise<number>;
  /** 토큰 하나를 무효로 한다 */
  revokeDownloadToken(tokenHash: string, at: string): Promise<void>;
  /** 완성(done)되지 않았고 이메일이 남아 있으며 createdBefore 이전에 만든 주문 (이메일 정리용, D-034) */
  listUnfinishedOrdersWithEmail(createdBefore: Date): Promise<Order[]>;
  /** 완성되지 않았고 출생 정보가 남은 주문 중 결제 시각(없으면 주문 시각)이 before 이전인 것 */
  listUnfinishedOrdersWithBirth(before: Date): Promise<Order[]>;
  /** 승인 여부를 모르는 결제가 남은 주문(D-054, 예전 기록의 lastError PG_UNREACHABLE 포함) */
  listOrdersWithUncertainPayment(): Promise<Order[]>;
  appendDeliveryLog(log: DeliveryLog): Promise<void>;
  listDeliveryLogs(orderId: string): Promise<DeliveryLog[]>;
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
