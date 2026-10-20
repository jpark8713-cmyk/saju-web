// 화면 E: 환불 요청 접수 완료
import { Page } from '../../../components/Page';
import { REFUND_PROCESSING_PERIOD } from '../../../config/legal';

const SAFE_ID = /^[A-Z]{2}\d{8}-[A-Z0-9]{8}$/;

export default async function RefundDonePage(props: PageProps<'/refund/done'>) {
  const q = await props.searchParams;
  const refundId = typeof q.refundId === 'string' && SAFE_ID.test(q.refundId) ? q.refundId : null;
  const orderId = typeof q.orderId === 'string' && SAFE_ID.test(q.orderId) ? q.orderId : null;
  return (
    <Page testId="screen-refund-done">
      <h1 className="h1">환불 요청을 접수했어요</h1>
      <div className="box section" style={{ gap: 4 }}>
        <div>
          접수번호 <strong data-testid="refund-id">{refundId ?? '확인할 수 없음'}</strong>
        </div>
        <div>
          주문번호 <strong>{orderId ?? '확인할 수 없음'}</strong>
        </div>
        <div>처리 예정 기간 {REFUND_PROCESSING_PERIOD}</div>
      </div>
      <p className="meta" style={{ margin: 0 }}>
        처리 결과는 입력하신 이메일로 알려 드려요. 같은 주문으로 다시 요청하시면 같은 접수번호를 보여 드려요.
      </p>
      <a href="/" className="button secondary">
        처음으로
      </a>
    </Page>
  );
}
