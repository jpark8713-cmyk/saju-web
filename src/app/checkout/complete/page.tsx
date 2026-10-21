// 결제창에서 돌아오는 주소(PG의 성공 복귀 주소). 서버에 승인을 요청한 뒤 화면 6으로 간다.
import { Page } from '../../../components/Page';
import { ConfirmPayment } from './ConfirmPayment';

export default async function CheckoutCompletePage(props: PageProps<'/checkout/complete'>) {
  const q = await props.searchParams;
  const pick = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
  return (
    <Page testId="screen-pay-confirm">
      <ConfirmPayment orderId={pick(q.orderId)} paymentKey={pick(q.paymentKey)} amount={pick(q.amount)} />
    </Page>
  );
}
