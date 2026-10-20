// 환불 요청 화면(D)과 서버가 함께 쓰는 값. 브라우저에서도 불러오므로 서버 전용 모듈(node:crypto 등)을 가져오지 않는다.

export const REFUND_REASONS = [
  { id: 'not_generated', label: '리포트를 받지 못했어요' },
  { id: 'duplicate', label: '중복으로 결제됐어요' },
  { id: 'changed_mind', label: '단순 변심이에요' },
  { id: 'other', label: '기타' },
] as const;

export const REFUND_DETAIL_MAX = 500;
