// 요청 횟수 제한 (D-027, D-028, 사업자 확정 2026-10-21 D-030).
// IP별 속도 제한의 주 방어선은 앞단 nginx(deploy/nginx.conf)이고, 앱의 이 값은 한 번 더 세는 것이다.

export interface WindowLimit {
  max: number;
  windowMs: number;
}

/** 환불 접수: 주문번호 하나당 (없는 주문번호도 똑같이 센다) */
export const REFUND_PER_ORDER: WindowLimit = Object.freeze({ max: 5, windowMs: 60 * 60_000 });

/** 환불 접수: 접속 주소(IP) 하나당 */
export const REFUND_PER_IP: WindowLimit = Object.freeze({ max: 20, windowMs: 60 * 60_000 });
