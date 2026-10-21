// 환불 요청 화면(D·E)과 서버가 함께 쓰는 값. 브라우저에서도 불러오므로 서버 전용 모듈(node:crypto 등)을 가져오지 않는다.

export const REFUND_REASONS = [
  { id: 'not_generated', label: '리포트를 받지 못했어요' },
  { id: 'duplicate', label: '중복으로 결제됐어요' },
  { id: 'changed_mind', label: '단순 변심이에요' },
  { id: 'other', label: '기타' },
] as const;

export const REFUND_DETAIL_MAX = 500;

/**
 * 접수 응답 문구. 주문이 있든 없든, 본인 확인이 되든 안 되든 같은 문구를 준다(D-028).
 * 실제 접수는 주문과 본인 확인이 맞을 때만 저장한다.
 */
export const REFUND_ACK_MESSAGE = '확인 결과는 이메일로 알려드려요.';

/** 접수번호 모양 (RF + 주문 날짜 + 8자리) */
export const REFUND_ID_RE = /^RF\d{8}-[A-HJ-NP-Z2-9]{8}$/;
