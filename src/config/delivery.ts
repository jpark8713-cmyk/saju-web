// 결과물 전달 설정 (SPEC Phase 5, 사업자 결정 2026-10-21 D-033). 만료 기간은 이 파일 한 곳에서만 바꾼다.
// 결제 화면·이메일·링크 만료 화면·처리방침 문구가 모두 이 값을 쓴다.

/** 다운로드 링크와 보관 기간(일). 리포트가 완성된 때부터 센다. 이 기간이 지나면 PDF·리포트·이메일 주소를 지운다 */
export const DOWNLOAD_LINK_TTL_DAYS = 30;

export const DOWNLOAD_LINK_TTL_MS = DOWNLOAD_LINK_TTL_DAYS * 86_400_000;

/** 화면·이메일에 쓰는 기간 문구 (예: "30일") */
export const DOWNLOAD_LINK_TTL_TEXT = `${DOWNLOAD_LINK_TTL_DAYS}일`;

/**
 * 완성되지 않은 주문(결제 전·생성 실패 등)의 이메일 주소 보관 기간(일). 주문을 만든 날부터 센다(사업자 결정 2026-10-21, D-034).
 * 환불된 주문의 이메일은 환불 처리 때 바로 지운다.
 */
export const UNFINISHED_ORDER_EMAIL_RETENTION_DAYS = 30;

/** 메일 발송 시도 횟수(첫 시도 포함, SPEC: 최대 3회) */
export const EMAIL_MAX_ATTEMPTS = 3;

/** 재시도 전 기다리는 시간(점점 늘어난다). 길이는 EMAIL_MAX_ATTEMPTS - 1 */
export const EMAIL_RETRY_DELAYS_MS: readonly number[] = Object.freeze([10_000, 60_000]);

/** 서버가 PDF를 만들 때 인쇄 페이지를 여는 내부 토큰의 유효 시간 */
export const RENDER_TOKEN_TTL_MS = 5 * 60_000;

/** 한국 날짜로 "2026년 11월 20일" */
export function koreanDate(iso: string): string {
  const k = new Date(Date.parse(iso) + 9 * 3_600_000);
  return `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}
