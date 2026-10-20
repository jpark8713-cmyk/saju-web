// 주문번호·접근 토큰·접수번호. 토큰은 원문을 저장하지 않고 SHA-256 해시만 저장한다(SPEC 0장 5번).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(O·0·I·1) 제외

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

function kstDate(now: Date): string {
  const k = new Date(now.getTime() + 9 * 3_600_000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}${String(k.getUTCDate()).padStart(2, '0')}`;
}

/** 주문번호: SJ + 한국 날짜 + 8자리 (예: SJ20261020-K7M2Q9XA) */
export function newOrderId(now = new Date()): string {
  return `SJ${kstDate(now)}-${randomCode(8)}`;
}

export const ORDER_ID_RE = /^SJ\d{8}-[A-HJ-NP-Z2-9]{8}$/;

/** 환불 요청 접수번호 */
export function newRefundId(now = new Date()): string {
  return `RF${kstDate(now)}-${randomCode(8)}`;
}

/** 주문 소유 확인용 토큰 (브라우저 세션에만 보관) */
export function newAccessToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenMatches(token: string | null | undefined, hash: string): boolean {
  if (!token) return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
