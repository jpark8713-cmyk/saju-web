// PDF 레이아웃(A4): 화면 7과 같은 ReportDocument 템플릿을 PDF 모드로 그린다. PDF 생성기(src/report/pdf.ts)만 연다.
// 주문 토큰은 헤더(x-order-token)로만 받는다. 토큰이 틀리거나 생성 전이면 404.
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Footer } from '../../../../components/Footer';
import { ReportDocument } from '../../../../components/ReportDocument';
import { ORDER_TOKEN_HEADER } from '../../../../orders/access';
import { reportViewFor } from '../../../../orders/reportAccess';
import { getStore } from '../../../../store/memory';

export default async function PrintPage(props: PageProps<'/report/[orderId]/print'>) {
  const { orderId } = await props.params;
  const token = (await headers()).get(ORDER_TOKEN_HEADER);
  const view = await reportViewFor(getStore(), orderId, token).catch(() => null);
  if (!view) notFound();
  return (
    <main className="page print-page" data-testid="screen-pdf">
      <ReportDocument view={view} mode="pdf" />
      <Footer />
    </main>
  );
}
