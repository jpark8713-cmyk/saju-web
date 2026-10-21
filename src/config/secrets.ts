// 서버 비밀값. 환경변수로만 받는다(SPEC 0장). 값은 로그·응답에 내보내지 않는다.
import { randomBytes } from 'node:crypto';
import { isDevRuntime, type Env } from './flags';

export class SecretMissing extends Error {
  constructor(name: string) {
    super(`${name} 환경변수가 없거나 너무 짧습니다(32자 이상)`);
    this.name = 'SecretMissing';
  }
}

const KEY = Symbol.for('saju.devRefundSecret');
type WithSecret = typeof globalThis & { [KEY]?: string };

/**
 * 환불 접수번호를 정하는 HMAC 키(D-028). 운영에서는 REFUND_ID_SECRET(32자 이상)이 꼭 있어야 한다.
 * 개발·테스트에서 값이 없으면 프로세스마다 임의 키를 만든다(서버를 다시 켜면 접수번호가 바뀐다).
 */
export function refundIdSecret(env: Env = process.env): string {
  const v = env.REFUND_ID_SECRET?.trim();
  if (v && v.length >= 32) return v;
  if (!isDevRuntime(env)) throw new SecretMissing('REFUND_ID_SECRET');
  const g = globalThis as WithSecret;
  g[KEY] ??= randomBytes(32).toString('hex');
  return g[KEY];
}
