// 화면 E: 환불 요청 접수 완료. 주문 확인 결과와 관계없이 같은 화면을 보여 준다(D-028).
import { Page } from '../../../components/Page';
import { BUSINESS } from '../../../config/business';
import { REFUND_PROCESSING_PERIOD } from '../../../config/legal';
import { REFUND_ACK_MESSAGE, REFUND_ID_RE } from '../../../orders/refundForm';

const ORDER_RE = /^SJ\d{8}-[A-HJ-NP-Z2-9]{8}$/;

export default async function RefundDonePage(props: PageProps<'/refund/done'>) {
  const q = await props.searchParams;
  const refundId = typeof q.refundId === 'string' && REFUND_ID_RE.test(q.refundId) ? q.refundId : null;
  const orderId = typeof q.orderId === 'string' && ORDER_RE.test(q.orderId) ? q.orderId : null;
  return (
    <Page testId="screen-refund-done">
      <h1 className="h1">환불 요청을 받았어요</h1>
      <div className="box section" style={{ gap: 4 }}>
        <div>
          접수번호 <strong data-testid="refund-id">{refundId ?? '확인할 수 없음'}</strong>
        </div>
        <div>
          주문번호 <strong>{orderId ?? '확인할 수 없음'}</strong>
        </div>
        <div>처리 예정 기간 {REFUND_PROCESSING_PERIOD}</div>
      </div>
      <p className="meta" style={{ margin: 0 }} data-testid="refund-ack">
        {REFUND_ACK_MESSAGE} 주문 정보를 확인한 뒤 결과를 보내 드려요.
      </p>
      <p className="hint" style={{ margin: 0 }}>
        며칠이 지나도 연락이 없으면 고객센터 이메일({BUSINESS.supportEmail})로 주문번호와 접수번호를 보내 주세요.
      </p>
      <a href="/" className="button secondary">
        처음으로
      </a>
    </Page>
  );
}
