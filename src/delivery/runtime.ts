// 앱이 쓰는 전달 의존성 묶음(저장소, PDF 저장소, PDF 생성기, 메일 어댑터, 서비스 주소)
import { appOrigin, pdfRenderOrigin } from '../config/origin';
import { renderReportPdf } from '../report/pdf';
import { getStore } from '../store';
import { RENDER_TOKEN_HEADER, type DeliveryDeps } from './deliver';
import { getEmailProvider } from './email';
import { getPdfStore } from './pdfStore';

/** requestOrigin: 개발·테스트에서 APP_ORIGIN이 없을 때 쓰는 요청 주소 */
export function deliveryDeps(requestOrigin = `http://localhost:${process.env.PORT ?? 3000}`): DeliveryDeps {
  return {
    store: getStore(),
    pdfs: getPdfStore(),
    renderPdf: (origin, orderId, token) => renderReportPdf(origin, orderId, { header: RENDER_TOKEN_HEADER, value: token }),
    email: getEmailProvider(),
    origin: () => appOrigin(requestOrigin),
    renderOrigin: () => pdfRenderOrigin(),
  };
}
