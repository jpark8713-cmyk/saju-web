// 화면 A: 결제 실패 (PG의 실패 복귀 주소이기도 하다)
import { Page } from '../../../components/Page';
import { PayFailed } from './PayFailed';

export default async function PayFailedPage(props: PageProps<'/checkout/failed'>) {
  const q = await props.searchParams;
  return (
    <Page testId="screen-pay-failed">
      <PayFailed code={typeof q.code === 'string' ? q.code : null} />
    </Page>
  );
}
