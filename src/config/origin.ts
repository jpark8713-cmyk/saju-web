// 이 서비스의 기준 주소. PDF 생성기(헤드리스 브라우저)와 결제창 복귀 주소에 쓴다.
// 운영에서는 APP_ORIGIN 환경변수만 쓴다. 요청의 Host 헤더를 믿지 않는다(D-026 LOW, D-028).
// 개발·테스트에서 값이 없으면 요청 주소를 쓴다.
import { isDevRuntime, type Env } from './flags';

export class AppOriginMissing extends Error {
  constructor() {
    super('APP_ORIGIN 환경변수가 없습니다');
    this.name = 'AppOriginMissing';
  }
}

export function appOrigin(requestOrigin: string, env: Env = process.env): string {
  const configured = env.APP_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  if (isDevRuntime(env)) return requestOrigin;
  throw new AppOriginMissing();
}
