// 리포트 PDF: 헤드리스 Chromium(Playwright)으로 인쇄용 페이지(/report/[orderId]/print)를 A4 PDF로 만든다.
// 화면 리포트와 같은 템플릿(ReportDocument)을 쓴다. 글꼴은 앱에 포함된 Noto Serif KR·Noto Sans KR이며,
// 모든 글꼴 파일이 내려받아진 뒤(document.fonts.ready) 저장한다(D-025: 호스팅 서버에도 Chromium과 이 글꼴이 필요).
import { chromium } from 'playwright';
import { ORDER_TOKEN_HEADER } from '../orders/access';

export async function renderReportPdf(baseUrl: string, orderId: string, token: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    // 토큰은 URL이 아니라 헤더로 넘긴다(주소·로그에 남지 않게)
    const context = await browser.newContext({ extraHTTPHeaders: { [ORDER_TOKEN_HEADER]: token } });
    const page = await context.newPage();
    const res = await page.goto(`${baseUrl}/report/${encodeURIComponent(orderId)}/print`, { waitUntil: 'networkidle' });
    if (!res || !res.ok()) throw new Error(`인쇄용 페이지를 열 수 없습니다 (HTTP ${res?.status() ?? '없음'})`);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
