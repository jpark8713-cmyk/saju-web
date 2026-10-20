// 화면 A: 결제 실패
import { Page } from '../../../components/Page';
import { PayFailed } from './PayFailed';

export default function PayFailedPage() {
  return (
    <Page testId="screen-pay-failed">
      <PayFailed />
    </Page>
  );
}
