// POST /api/delivery/resend: 링크 재발송 요청(화면 C). 주문·이메일 일치 여부와 관계없이 같은 응답을 준다(주문 존재 여부 비노출).
// 실제 토큰 재발급·메일 발송·횟수 제한은 Phase 5에서 구현한다. 요청 내용(주문번호·이메일)은 기록하지 않는다.
import { json } from '../../../../web/http';

export const RESEND_MESSAGE = '주문번호와 이메일이 일치하면 새 다운로드 링크를 보내 드려요. 몇 분 안에 메일이 오지 않으면 입력한 내용을 다시 확인해 주세요.';

export async function POST(): Promise<Response> {
  return json({ message: RESEND_MESSAGE });
}
