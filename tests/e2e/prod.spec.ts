// 운영 빌드: 가짜 결제 버튼이 없고, 결제 버튼은 꺼져 있고, 가짜 결제 API는 404다(D-025).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { toCheckout, toPreview } from './helpers';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))));
  return nested.flat();
}

test('운영 클라이언트 번들에 가짜 결제 코드가 없다', async () => {
  const files = (await filesUnder(join(process.cwd(), '.next', 'static'))).filter((f) => f.endsWith('.js'));
  expect(files.length).toBeGreaterThan(0);
  const hits: string[] = [];
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    for (const needle of ['/api/dev/fake-payment', 'success-genfail', 'dev-fake-payment']) if (text.includes(needle)) hits.push(`${f}: ${needle}`);
  }
  expect(hits).toEqual([]);
});

test('운영 빌드에는 가짜 결제가 없다', async ({ page, request }) => {
  await toPreview(page);
  await toCheckout(page, []);
  await expect(page.getByTestId('dev-fake-payment')).toHaveCount(0);
  await expect(page.getByTestId('payment-not-ready')).toBeVisible();
  await page.getByTestId('agree-terms').check();
  await expect(page.getByTestId('pay-button')).toBeDisabled();
  expect(await page.content()).not.toContain('개발용 가짜 결제');

  const order = await page.evaluate(() => JSON.parse(sessionStorage.getItem('saju.order')!));
  const res = await request.post('/api/dev/fake-payment', {
    headers: { 'x-order-token': order.accessToken },
    data: { orderId: order.orderId, outcome: 'success' },
  });
  expect(res.status()).toBe(404);
  // 결제되지 않았으므로 생성도 시작되지 않는다
  const gen = await request.post('/api/reports/generate', { headers: { 'x-order-token': order.accessToken }, data: { orderId: order.orderId } });
  expect(gen.status()).toBe(409);
});
