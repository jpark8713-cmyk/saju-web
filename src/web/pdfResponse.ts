// PDF 내려받기 응답 (화면 7의 다운로드와 이메일 링크가 같이 쓴다)
export function pdfResponse(orderId: string, pdf: Buffer): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="saju-report-${orderId}.pdf"`,
      'cache-control': 'no-store',
    },
  });
}
