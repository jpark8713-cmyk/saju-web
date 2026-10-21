// 운영 빌드: 목 결제가 없고(버튼 꺼짐, 결제창·API 404, 번들에 코드 없음), 결제 수단은 기본 설정대로(카카오페이만) 보인다(D-025·D-028).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { toCheckout, toPreview } from './helpers';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))));
  return nested.flat();
}

test('운영 클라이언트 번들에 목 결제 코드가 없다', async () => {
  const files = (await filesUnder(join(process.cwd(), '.next', 'static'))).filter((f) => f.endsWith('.js'));
  expect(files.length).toBeGreaterThan(0);
  const hits: string[] = [];
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    for (const needle of ['/api/dev/mock-pg', 'mock-pg-submit', 'success-genfail', '목 결제창', '/api/dev/outbox']) if (text.includes(needle)) hits.push(`${f}: ${needle}`);
  }
  expect(hits).toEqual([]);
});

test('운영 빌드에는 목 결제가 없고 결제 수단은 카카오페이만 고를 수 있다', async ({ page, request }) => {
  await toPreview(page);
  await toCheckout(page, []);
  await expect(page.getByTestId('payment-not-ready')).toBeVisible();
  await page.getByTestId('agree-terms').check();
  await expect(page.getByTestId('pay-button')).toBeDisabled();

  // 화면 5: 수단 7개, 카카오페이만 선택 가능, 나머지는 "준비 중"
  const ids = ['kakaopay', 'tosspay', 'naverpay', 'payco', 'samsungpay', 'card', 'transfer'];
  for (const id of ids) await expect(page.getByTestId(`method-${id}`)).toBeVisible();
  await expect(page.getByTestId('method-kakaopay').locator('input')).toBeEnabled();
  for (const id of ids.slice(1)) {
    await expect(page.getByTestId(`method-${id}`).locator('input')).toBeDisabled();
    await expect(page.getByTestId(`method-${id}`)).toContainText('준비 중');
  }

  const order = await page.evaluate(() => JSON.parse(sessionStorage.getItem('saju.order')!));
  const headers = { 'x-order-token': order.accessToken };
  const prepare = await request.post('/api/payments/prepare', { headers, data: { orderId: order.orderId, paymentMethod: 'kakaopay' } });
  expect(prepare.status()).toBe(503);
  const confirm = await request.post('/api/payments/confirm', { headers, data: { orderId: order.orderId, paymentKey: 'mock_x', amount: order.amount } });
  expect(confirm.status()).toBe(503);
  const mockPg = await request.post('/api/dev/mock-pg', { form: { paymentKey: 'mock_x', outcome: 'success', amount: '1' } });
  expect(mockPg.status()).toBe(404);
  // 개발용 메일 보관함도 운영에서는 404
  expect((await request.get('/api/dev/outbox')).status()).toBe(404);
  const mockPage = await page.goto('/dev/mock-pg?paymentKey=mock_x');
  expect(mockPage!.status()).toBe(404);
  // 결제되지 않았으므로 생성도 시작되지 않는다
  const gen = await request.post('/api/reports/generate', { headers, data: { orderId: order.orderId } });
  expect(gen.status()).toBe(409);
});
