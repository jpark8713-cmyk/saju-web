// 화면 5: 주문 확인·결제. 가짜 결제 버튼은 서버가 개발 환경에서만 켠다(운영 빌드에서는 그려지지 않는다, D-025).
import { Page } from '../../components/Page';
import { isFakePaymentEnabled } from '../../config/flags';
import { Checkout } from './Checkout';

// 요청마다 환경 플래그를 다시 읽는다(빌드 시점 값으로 굳지 않게)
export const dynamic = 'force-dynamic';

export default function CheckoutPage() {
  return (
    <Page testId="screen-checkout">
      <h1 className="h1">주문 확인·결제</h1>
      <Checkout fakePayment={isFakePaymentEnabled()} />
    </Page>
  );
}
