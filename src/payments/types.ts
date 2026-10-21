// 결제 어댑터 인터페이스 (SPEC Phase 4). PG마다 구현체 하나를 둔다.
// 흐름: prepare(결제창 주소 받기) → 고객이 PG 결제창에서 인증 → confirm(서버가 서버 계산 금액으로 승인 요청) → 필요하면 cancel.
// PG별 결제 수단 코드 변환은 각 구현체 안의 표 한곳에서만 한다.

export interface PrepareInput {
  orderId: string;
  /** 서버가 계산한 금액 */
  amount: number;
  orderName: string;
  methodId: string;
  /** 인증이 끝나면 PG가 돌려보낼 주소 (paymentKey·orderId·amount가 붙는다) */
  successUrl: string;
  /** 실패·취소 때 돌려보낼 주소 (code가 붙는다) */
  failUrl: string;
}

export interface PrepareResult {
  paymentKey: string;
  /** 고객 브라우저를 보낼 결제창 주소 */
  redirectUrl: string;
}

export interface ConfirmInput {
  paymentKey: string;
  orderId: string;
  /** 서버가 계산한 금액. 클라이언트가 보낸 금액이 아니다 */
  amount: number;
}

export type ConfirmResult =
  | {
      ok: true;
      transactionId: string;
      approvedAmount: number;
      approvedAt: string;
      /** 목 결제창에서만: "결제 성공 후 생성 실패"를 고른 결제 */
      devForceGenerationFailure?: boolean;
    }
  | { ok: false; code: string };

export interface CancelInput {
  paymentKey: string;
  orderId: string;
  amount: number;
  reason: string;
}

export type CancelResult = { ok: true; cancelledAt: string; cancelledAmount: number } | { ok: false; code: string };

export interface PaymentProvider {
  readonly id: string;
  /** 이 어댑터가 해당 결제 수단을 처리할 수 있는지 */
  supports(methodId: string): boolean;
  prepare(input: PrepareInput): Promise<PrepareResult>;
  /** 같은 paymentKey로 다시 불러도 결제는 한 번만 승인된다(멱등) */
  confirm(input: ConfirmInput): Promise<ConfirmResult>;
  cancel(input: CancelInput): Promise<CancelResult>;
}
