// 운영 빌드: 목 결제가 없고(버튼 꺼짐, 결제창·API 404, 번들에 코드 없음), 결제 수단은 기본 설정대로(카카오페이만) 보인다(D-025·D-028).
// 시작 거부 조건과 예행 모드(D-058): 같은 빌드를 PW_PORT+1에 따로 띄워 본다(이 파일이 띄우고 이 파일이 끈다).
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { toCheckout, toPreview } from './helpers';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))));
  return nested.flat();
}

test('운영 클라이언트 번들에 목 결제 코드가 없다', async () => {
  const files = (await filesUnder(join(process.cwd(), process.env.NEXT_DIST_DIR || '.next', 'static'))).filter((f) => f.endsWith('.js'));
  expect(files.length).toBeGreaterThan(0);
  const hits: string[] = [];
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    for (const needle of ['/api/dev/mock-pg', 'mock-pg-submit', 'success-genfail', '목 결제창', '/api/dev/outbox', 'mock-pg-processed', '이미 처리된 결제']) if (text.includes(needle)) hits.push(`${f}: ${needle}`);
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

test('예행 모드 서버(목 결제 없음): 모든 화면 위에 배너, 상태 확인 주소에 모드', async ({ page, request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', mode: 'rehearsal' });
  for (const path of ['/', '/legal/terms']) {
    await page.goto(path);
    await expect(page.getByTestId('rehearsal-banner')).toHaveText('리허설 서버 — 실제 결제 아님');
  }
});

test('예행 배너가 있어도 정적 페이지는 정적으로 만들어진다(D-059)', async () => {
  const manifest = JSON.parse(await readFile(join(process.cwd(), process.env.NEXT_DIST_DIR || '.next', 'prerender-manifest.json'), 'utf8'));
  const routes = Object.keys(manifest.routes);
  for (const r of ['/', '/input', '/preview', '/legal/terms', '/legal/refund', '/legal/privacy']) expect(routes).toContain(r);
});

// ---- 같은 빌드를 다른 설정으로 따로 띄우기(D-058) ----
const PORT2 = Number(process.env.PW_PORT || 3200) + 1;
const NEXT_BIN = join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
const BASE_ENV = {
  NODE_ENV: 'production',
  APP_ORIGIN: `http://localhost:${PORT2}`,
  REFUND_ID_SECRET: 'e2e-only-secret-0123456789-0123456789',
  TRUST_PROXY: 'true',
};

/** next start를 띄워 시작 거부(종료 코드 1)면 출력을, 뜨면 'ready'를 돌려준다. 뜬 서버는 stop()으로 끈다 */
function startServer(extra: Record<string, string>) {
  const db = join(tmpdir(), `saju-e2e-guard-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const env = { ...process.env, ...BASE_ENV, DATABASE_URL: `file:${db}`, ...extra } as NodeJS.ProcessEnv;
  // 경우마다 넣지 않은 개발용 값은 빈 값으로 못 박는다(next start가 읽는 .env 파일 값이 끼어들지 않게)
  for (const k of ['PAYMENT_PROVIDER', 'ENABLE_FAKE_LLM', 'REHEARSAL_MODE', 'PAYMENT_CLIENT_KEY', 'PAYMENT_SECRET_KEY']) if (!(k in extra)) env[k] = '';
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT2)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d: Buffer) => (out += String(d)));
  child.stderr.on('data', (d: Buffer) => (out += String(d)));
  const result = new Promise<{ exited: number | null; out: string } | 'ready'>((resolve) => {
    child.on('exit', (code: number | null) => resolve({ exited: code, out }));
    const poll = async () => {
      for (let i = 0; i < 120; i++) {
        if (child.exitCode !== null) return;
        try {
          const r = await fetch(`http://localhost:${PORT2}/api/health`);
          if (r.ok) return resolve('ready');
        } catch {}
        await new Promise((s) => setTimeout(s, 500));
      }
    };
    void poll();
  });
  const stop = () => new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.on('exit', () => resolve());
    child.kill();
  });
  return { result, stop };
}

test.describe('운영 빌드 시작 거부(D-058)', () => {
  test.describe.configure({ timeout: 120_000 });
  const cases: [string, Record<string, string>, RegExp][] = [
    ['NODE_ENV=development', { NODE_ENV: 'development' }, /NODE_ENV가 development/u],
    ['NODE_ENV=test', { NODE_ENV: 'test' }, /NODE_ENV가 test/u],
    ['가짜 LLM(예행 모드여도)', { ENABLE_FAKE_LLM: 'true', REHEARSAL_MODE: '1' }, /ENABLE_FAKE_LLM/u],
    ['예행 모드 없이 목 결제', { PAYMENT_PROVIDER: 'mock' }, /PAYMENT_PROVIDER=mock/u],
    ['검수 전 주제 판매(지금 주제 상태)', {}, /검수\(reviewed\)를 마치지 않은 판매 주제/u],
    ['예행 모드 + 실제 PG', { REHEARSAL_MODE: '1', PAYMENT_PROVIDER: 'kakaopay' }, /실제 PG/u],
  ];
  for (const [name, extra, reason] of cases) {
    test(`${name} → 시작하지 않는다`, async () => {
      const s = startServer(extra);
      const r = await s.result;
      await s.stop();
      expect(r).not.toBe('ready');
      if (r === 'ready') return;
      expect(r.exited).toBe(1);
      expect(r.out).toContain('[시작 점검] 서버를 시작하지 않아요');
      expect(r.out).toMatch(reason);
    });
  }

  test('예행 모드 + 목 결제는 뜬다: 배너, 모드 rehearsal, 목 결제창 열림', async ({ page }) => {
    const s = startServer({ REHEARSAL_MODE: '1', PAYMENT_PROVIDER: 'mock' });
    try {
      expect(await s.result).toBe('ready');
      const health = await fetch(`http://localhost:${PORT2}/api/health`);
      expect(await health.json()).toEqual({ status: 'ok', mode: 'rehearsal' });
      await page.goto(`http://localhost:${PORT2}/`);
      await expect(page.getByTestId('rehearsal-banner')).toBeVisible();
      const mock = await page.goto(`http://localhost:${PORT2}/dev/mock-pg?paymentKey=x`);
      expect(mock!.status()).toBe(200);
      await expect(page.getByTestId('mock-pg-processed')).toBeVisible();
    } finally {
      await s.stop();
    }
  });
});
