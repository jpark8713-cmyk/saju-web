// PDF 레이아웃(A4): 화면 7과 같은 ReportDocument 템플릿을 PDF 모드로 그린다. PDF 생성기(src/report/pdf.ts)만 연다.
// 토큰은 헤더로만 받는다: 고객의 주문 토큰(x-order-token) 또는 서버가 PDF를 만들 때 쓰는 내부 토큰(x-render-token).
// 토큰이 틀리거나 생성 전·보관 기간 후면 404.
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Footer } from '../../../../components/Footer';
import { ReportDocument } from '../../../../components/ReportDocument';
import { RENDER_TOKEN_HEADER } from '../../../../delivery/deliver';
import { ORDER_TOKEN_HEADER } from '../../../../orders/access';
import { reportViewForPrint } from '../../../../orders/reportAccess';
import { getStore } from '../../../../store';

export default async function PrintPage(props: PageProps<'/report/[orderId]/print'>) {
  const { orderId } = await props.params;
  const h = await headers();
  const view = await reportViewForPrint(getStore(), orderId, h.get(ORDER_TOKEN_HEADER), h.get(RENDER_TOKEN_HEADER)).catch(() => null);
  if (!view) notFound();
  return (
    <main className="page print-page" data-testid="screen-pdf">
      <ReportDocument view={view} mode="pdf" />
      <Footer />
    </main>
  );
}
