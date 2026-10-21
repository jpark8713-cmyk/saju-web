// 화면 5: 주문 확인·결제. 결제 수단 목록과 결제 가능 여부는 서버 설정에서 정한다(D-028).
// 운영에서 결제 어댑터가 없으면(실제 PG 연동 전) 결제하기 버튼을 꺼 둔다. 목 결제는 운영에서 만들어지지 않는다.
import { Page } from '../../components/Page';
import { paymentMethods } from '../../config/paymentMethods';
import { getPaymentProvider } from '../../payments';
import { Checkout } from './Checkout';

// 요청마다 환경 설정을 다시 읽는다(빌드 시점 값으로 굳지 않게)
export const dynamic = 'force-dynamic';

export default function CheckoutPage() {
  const provider = getPaymentProvider();
  // 설정에서 켜진 수단 중 어댑터가 처리할 수 있는 것만 고를 수 있다. 어댑터가 없으면 설정대로 보여 주고 결제하기만 끈다
  const listed = paymentMethods().map((m) => ({ ...m, enabled: m.enabled && (!provider || provider.supports(m.id)) }));
  return (
    <Page testId="screen-checkout">
      <h1 className="h1">주문 확인·결제</h1>
      <Checkout methods={listed} paymentReady={!!provider} />
    </Page>
  );
}
