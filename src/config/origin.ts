// 이 서비스의 기준 주소. 결제창 복귀 주소와 메일 링크에 쓴다(PDF 생성기는 같은 서버 안 주소 pdfRenderOrigin, D-059).
// 운영에서는 APP_ORIGIN 환경변수만 쓴다. 요청의 Host 헤더를 믿지 않는다(D-026 LOW, D-028).
// 개발·테스트에서 값이 없으면 요청 주소를 쓴다.
import { isDevRuntime, type Env } from './flags';

export class AppOriginMissing extends Error {
  constructor() {
    super('APP_ORIGIN 환경변수가 없습니다');
    this.name = 'AppOriginMissing';
  }
}

/**
 * PDF 생성기(서버 안의 헤드리스 브라우저)가 인쇄 화면을 여는 주소(D-059). 공개 주소(APP_ORIGIN)가 아니라 같은 서버의 포트로 바로 연다.
 * 그래서 nginx 기본 인증·NCP ACG(예행 서버 접근 제한)에 막히지 않고, 서버 자신의 공인 IP를 허용할 필요가 없다.
 * PORT는 Next가 실제로 듣는 포트로 채운다(next dev·start 모두). PDF_RENDER_ORIGIN으로 바꿀 수 있다.
 */
export function pdfRenderOrigin(env: Env = process.env): string {
  const configured = env.PDF_RENDER_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  return `http://127.0.0.1:${env.PORT || 3000}`;
}

export function appOrigin(requestOrigin: string, env: Env = process.env): string {
  const configured = env.APP_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  if (isDevRuntime(env)) return requestOrigin;
  throw new AppOriginMissing();
}
