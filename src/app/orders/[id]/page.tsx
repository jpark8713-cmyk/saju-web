// 화면 6·7·B: 생성 중 → 리포트 받기 / 생성 실패
import { Page } from '../../../components/Page';
import { OrderView } from './OrderView';

export default async function OrderPage(props: PageProps<'/orders/[id]'>) {
  const { id } = await props.params;
  return (
    <Page testId="screen-order">
      <OrderView orderId={id} />
    </Page>
  );
}
