// 다운로드 링크 메일 문구. 만료 기간과 날짜를 분명히 적는다(D-033).
import { DOWNLOAD_LINK_TTL_TEXT, koreanDate } from '../config/delivery';
import { SERVICE } from '../config/business';

export function downloadEmail(args: { orderId: string; link: string; expiresAt: string }): { subject: string; text: string } {
  const until = koreanDate(args.expiresAt);
  return {
    subject: `${SERVICE.name} 사주 리포트 다운로드 링크 (주문번호 ${args.orderId})`,
    text: [
      '주문하신 사주 리포트가 준비됐어요.',
      '',
      `아래 링크에서 PDF를 받을 수 있어요. 링크는 ${until}까지(리포트 완성일부터 ${DOWNLOAD_LINK_TTL_TEXT}) 쓸 수 있어요.`,
      args.link,
      '',
      `${until}이 지나면 PDF·리포트·이메일 주소를 삭제해요. 그 전에 PDF를 저장해 두세요.`,
      '링크가 열리지 않으면 "링크 다시 받기" 화면에서 주문번호와 이메일로 새 링크를 받을 수 있어요.',
      '',
      `주문번호: ${args.orderId}`,
    ].join('\n'),
  };
}
