// 결제 실패 코드 → 화면 A 문구. 주소창으로 들어온 코드는 이 표에 있는 것만 문구로 바꾸고, 나머지는 기본 문구를 쓴다.
// (주소에 실린 임의 문장을 그대로 보여 주지 않는다)

const MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  USER_CANCEL: '결제 창에서 결제를 취소했어요.',
  AMOUNT_MISMATCH: '결제 금액이 주문 금액과 달라 결제를 진행하지 않았어요. 돈은 빠져나가지 않았어요.',
  APPROVED_AMOUNT_MISMATCH: '승인된 금액이 주문 금액과 달라 결제를 바로 취소했어요.',
  METHOD_DISABLED: '지금은 쓸 수 없는 결제 수단이에요. 다른 수단을 골라 주세요.',
  UNKNOWN_PAYMENT: '결제 정보가 맞지 않아요. 결제를 처음부터 다시 진행해 주세요.',
  NOT_AUTHORIZED: '결제 인증이 끝나지 않았어요. 다시 결제해 주세요.',
  PG_UNREACHABLE: '결제사와 연결이 잠시 끊겼어요. 잠시 후 다시 시도해 주세요.',
  ALREADY_PROCESSED: '이미 처리된 주문이에요.',
  // 결제 여부를 단정하지 않는다(D-054: 승인 여부를 모르는 결제가 있을 수 있다)
  ORDER_EXPIRED: '주문한 지 30일이 지나 입력하신 출생 정보를 지웠어요. 결제는 진행하지 않았어요. 혹시 결제가 됐다면 주문번호와 함께 고객센터로 알려 주세요. 리포트를 받으시려면 처음부터 다시 주문해 주세요.',
  // 앞서 결제사 연결이 끊긴 주문: 결제됐는지 모르므로 단정하지 않는다(D-054 리뷰)
  ORDER_EXPIRED_CHECK: '주문한 지 30일이 지나 입력하신 출생 정보를 지웠어요. 앞서 결제사와 연결이 끊긴 적이 있어 결제가 됐는지 확인이 필요해요. 새로 주문하기 전에 주문번호와 함께 고객센터로 알려 주세요. 결제된 것으로 확인되면 취소해 드려요.',
});

export const DEFAULT_PAY_FAILURE = '결제 화면이 닫혔거나 승인되지 않았어요.';

export function payFailureMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || DEFAULT_PAY_FAILURE;
}
