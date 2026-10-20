// 화면 D: 환불 요청 입력 (화면 B에서 오면 주문번호가 미리 채워진다)
import { Page } from '../../components/Page';
import { RefundForm } from './RefundForm';

export default async function RefundPage(props: PageProps<'/refund'>) {
  const q = await props.searchParams;
  const orderId = typeof q.orderId === 'string' ? q.orderId : '';
  return (
    <Page testId="screen-refund">
      <h1 className="h1">환불 요청</h1>
      <RefundForm initialOrderId={orderId} />
    </Page>
  );
}
